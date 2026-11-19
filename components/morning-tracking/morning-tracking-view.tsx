"use client";

import { HowToUse } from "@/components/ui/how-to-use";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  TrackingBanner,
  TrackingNotice,
} from "@/components/tracking-ui/banners";
import { trackingFont } from "@/components/tracking-ui/font";
import {
  ConversationModal,
  type ConversationTarget,
} from "@/components/ui/conversation-modal";
import { describeError, isStatus } from "@/lib/api-errors";
import { toggleTakeAction } from "@/lib/booking-notes-api";
import { isYmd, laMinuteOfDay, laToday, shiftYmd } from "@/lib/la-date";
import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import {
  buildMorningExportUrl,
  fetchLiveDrivers,
  fetchMorningTracking,
  saveTrackingMark,
} from "@/lib/morning-tracking-api";
import { usePageVisibility } from "@/lib/page-visibility";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { usePermissions } from "@/lib/staff-permissions";
import { fetchUserPref, saveUserPref } from "@/lib/user-prefs-api";
import { cn, takeSearchParam } from "@/lib/utils";
import { ChatNotFound } from "@/components/tracking-ui/chat-not-found";
import { useOpenChatFromUrl } from "@/lib/open-chat-param";
import type {
  LiveDrivers,
  MorningTracking,
  MorningTrackingRow,
  TrackingMarkCol,
  TrackingMarkValue,
} from "@/types";

import {
  type ColumnKey,
  computeStats,
  type TrackingStats,
  DEFAULT_COLUMN_ORDER,
  emailBadgeOf,
  hasLiveMarks,
  hasSplitMarks,
  LOCAL_COLUMN_ORDER_KEY,
  matchesSearch,
  noShowBadge,
  orderRows,
  parseColumnOrder,
  POLL_INTERVAL_MS,
  smsBadgeOf,
  summarizeDrivers,
} from "./config";
import { PageShortcutBar } from "@/components/nav/page-shortcut-bar";
import { PhoneMore, PhoneShortcutStar } from "@/components/ui/phone";
import { useIsPhone } from "@/lib/phone";
import { LiveDriversBoard } from "./live-drivers";
import { PhoneTrackingList } from "./phone-tracking-list";
import { TrackingTable } from "./tracking-table";
import { type MarkEditing, markKey, type MarkSaveStatus } from "./mark-cell";
import { replaceUrl, useLeaveGuard } from "@/lib/use-leave-guard";
import { setVisibleInterval } from "@/lib/visible-poll";

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: MorningTracking };

/** WhatsApp 窗口倒计时自己走，不等 60 秒一轮。 */
const CLOCK_TICK_MS = 30_000;
/** Live drivers 页签每 30 秒刷新一次（Annie 2026-11-02「我要30秒刷新relay」）；Tracking 页签照旧 60 秒。 */
const LIVE_POLL_MS = 30_000;
/** 新冒出来的 No show 那一行带 NEW 多久。 */
const NEW_NO_SHOW_MS = 5 * 60_000;

type LiveState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: LiveDrivers };

function readLocalOrder(): ColumnKey[] | null {
  try {
    return parseColumnOrder(
      window.localStorage.getItem(LOCAL_COLUMN_ORDER_KEY),
    );
  } catch {
    return null;
  }
}

function writeLocalOrder(order: ColumnKey[]) {
  try {
    window.localStorage.setItem(LOCAL_COLUMN_ORDER_KEY, JSON.stringify(order));
  } catch {
    // 隐私模式等存不了时只是下次回到默认顺序。
  }
}

export function MorningTrackingView() {
  const { partnerView, canSeeMoney, canRowTakeAction } = usePermissions();
  const canTakeMorning = canRowTakeAction("morning");
  // date 为空表示还没在浏览器里算出要看哪天（避免服务端 / 浏览器不一致）。
  const [date, setDate] = useState("");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // 自动刷新 / 静默重拉失败时不清空表格，只提示。
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [driver, setDriver] = useState("");
  const [columnOrder, setColumnOrder] = useState<ColumnKey[]>([
    ...DEFAULT_COLUMN_ORDER,
  ]);
  const [conversation, setConversation] = useState<ConversationTarget | null>(
    null,
  );
  /** 从 Live drivers 打开的回复框：短信和邮件同时发（Annie「email sms同时发」）。 */
  const [conversationBoth, setConversationBoth] = useState(false);
  // 文件夹页签（司机实时页 ⑪ A）：Tracking = 现在的表；Live drivers = 一人一列的司机页，先只 Super Admin（开关默认关）。
  const [tab, setTab] = useState<"tracking" | "live">("tracking");
  const [live, setLive] = useState<LiveState>({ kind: "idle" });
  const liveSeqRef = useRef(0);
  /** 司机刚标的 No show（bookings.id → 第一次看到的时间）：那一行闪三下、带 NEW 五分钟（⑥ A）。 */
  const [nsSeen, setNsSeen] = useState<Map<number, number>>(new Map());
  const nsKnownRef = useRef<Set<number> | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const redirectingRef = useRef(false);
  /** 只认最新一次请求的结果：换日期以后，旧日期晚到的响应丢掉。 */
  const requestSeqRef = useRef(0);
  /** 当前看的日期：写完 / 弹窗回调里重拉用它，点的时候那天已经换走了也不会把旧日期的行拉回来。 */
  const dateRef = useRef(date);
  dateRef.current = date;
  /** 这次打开后拖过列：账号里的列顺序晚到时不再覆盖。 */
  const orderTouchedRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  // 手机上只看今天（Annie 2026-11-01「然后morning只用显示今天的」，选 A：电脑版照旧能换日期）。
  const isPhone = useIsPhone();
  useEffect(() => {
    if (isPhone && date && date !== laToday()) setDate(laToday());
  }, [isPhone, date]);

  // 要看哪天：地址栏 ?date=（dashboard 的消息卡片会带），否则洛杉矶的今天。
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("date");
    setDate(isYmd(fromUrl) ? fromUrl : laToday());
    // dashboard 订单查询的「Open tracking →」带 ?q=单号：搜索框预填这一单。
    setSearch(takeSearchParam("q") ?? "");
  }, []);

  const load = useCallback(
    async (target: string, silent: boolean) => {
      const seq = ++requestSeqRef.current;
      if (!silent) {
        setState({ kind: "loading" });
      }
      try {
        const data = await fetchMorningTracking(target);
        if (seq !== requestSeqRef.current) {
          return;
        }
        setState({ kind: "ready", data });
        setRefreshError(null);
        setNow(Date.now());
        // 新冒出来的 No show：跟上一次比（第一次打开 / 换日期不算新的）。
        const ns = new Set(
          data.rows.filter((r) => r.ns_unhandled).map((r) => r.id),
        );
        const known = nsKnownRef.current;
        nsKnownRef.current = ns;
        if (known) {
          const fresh = [...ns].filter((id) => !known.has(id));
          if (fresh.length)
            setNsSeen((m) => {
              const next = new Map(m);
              for (const id of fresh) next.set(id, Date.now());
              return next;
            });
        }
      } catch (error) {
        if (seq !== requestSeqRef.current) {
          return;
        }
        if (isStatus(error, 401)) {
          redirectToLogin();
        } else if (isStatus(error, 403)) {
          setState({ kind: "forbidden" });
        } else if (silent) {
          setRefreshError(describeError(error));
        } else {
          setState({ kind: "error", message: describeError(error) });
        }
      }
    },
    [redirectToLogin],
  );

  const data = state.kind === "ready" ? state.data : null;
  const endMinute = data?.tracking_window.end_minute ?? null;
  const pageVisibility = usePageVisibility(redirectToLogin);
  const canLive =
    !partnerView && pageVisibility.visible("morning_live_drivers");

  const loadLive = useCallback(
    async (target: string, silent: boolean) => {
      const seq = ++liveSeqRef.current;
      if (!silent) setLive({ kind: "loading" });
      try {
        const data = await fetchLiveDrivers(target);
        if (seq !== liveSeqRef.current) return;
        setLive({ kind: "ready", data });
      } catch (error) {
        if (seq !== liveSeqRef.current) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setLive({ kind: "forbidden" });
        else if (silent) setRefreshError(describeError(error));
        else setLive({ kind: "error", message: describeError(error) });
      }
    },
    [redirectToLogin],
  );

  // 切到 Live drivers / 换日期：读一次司机页数据。
  useEffect(() => {
    if (tab === "live" && date && canLive) void loadLive(date, false);
  }, [tab, date, canLive, loadLive]);

  // 换日期：No show 的「新」从头算。
  useEffect(() => {
    nsKnownRef.current = null;
    setNsSeen(new Map());
  }, [date]);

  // Live drivers 页签每 30 秒刷新（表和司机页一起，统计卡、No show 跟着变）；同 Tracking：只在看今天、没过截止时间。
  useEffect(() => {
    if (tab !== "live" || !date || endMinute === null || !canLive) return;
    return setVisibleInterval(() => {
      if (date === laToday() && laMinuteOfDay() < endMinute) {
        void load(date, true);
        void loadLive(date, true);
      }
    }, LIVE_POLL_MS);
  }, [tab, date, endMinute, canLive, load, loadLive]);

  useEffect(() => {
    if (!date) {
      return;
    }
    // 地址栏跟着日期走，刷新 / 分享链接还是这一天。
    const url = new URL(window.location.href);
    url.searchParams.set("date", date);
    replaceUrl(url);
    void load(date, false);
  }, [date, load]);

  const endLabel = data?.tracking_window.end_label ?? "";

  // 自动刷新：只在看今天、且没过追踪窗口时（每轮都重新算「今天」和「几点」）。
  useEffect(() => {
    if (!date || endMinute === null) {
      return;
    }
    return setVisibleInterval(() => {
      if (date === laToday() && laMinuteOfDay() < endMinute) {
        void load(date, true);
      } else {
        setNow(Date.now());
      }
    }, POLL_INTERVAL_MS);
  }, [date, endMinute, load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // 列顺序：先用本机存的，再以账号偏好为准（和旧页面共用同一个偏好，两边互通）。
  useEffect(() => {
    const local = readLocalOrder();
    if (local) {
      setColumnOrder(local);
    }
    const controller = new AbortController();
    fetchUserPref("morning_col_order", controller.signal)
      .then((raw) => {
        const remote = parseColumnOrder(raw);
        if (remote && !orderTouchedRef.current) {
          setColumnOrder(remote);
          writeLocalOrder(remote);
        }
      })
      .catch(() => {
        // 拉不到就沿用本机的，不打扰。
      });
    return () => controller.abort();
  }, []);

  function reorderColumns(order: ColumnKey[]) {
    orderTouchedRef.current = true;
    setColumnOrder(order);
    writeLocalOrder(order);
    // partner 不存账号偏好（后端 G204 对 partner 的列 / 版面 key 回 403），只记在本机。
    if (partnerView) return;
    saveUserPref("morning_col_order", JSON.stringify(order)).catch(() => {
      // 存不到账号上时本机还有一份。
    });
  }

  // ── Relay / Bus 标记的编辑（No show 改方向，Annie 2026-11-17「动手」，N2 A / N7 A）──
  // 改的先暂存在页面上，按每格的 Save 才存（站内规矩：不改一点存一点）；每分钟刷新不冲掉暂存。
  const [staged, setStaged] = useState<
    ReadonlyMap<string, TrackingMarkValue | null>
  >(new Map());
  const [markStatus, setMarkStatus] = useState<
    ReadonlyMap<string, MarkSaveStatus>
  >(new Map());
  const unsaved = staged.size > 0;
  const UNSAVED_MSG =
    "You have No show marks you haven't saved. Leave without saving them?";
  useLeaveGuard(unsaved, UNSAVED_MSG);

  /** 有没存的改动时先问；答应丢掉就清空暂存。 */
  function confirmDiscard(): boolean {
    if (!unsaved) return true;
    if (!window.confirm(UNSAVED_MSG)) return false;
    setStaged(new Map());
    setMarkStatus(new Map());
    return true;
  }

  function stageMark(
    row: MorningTrackingRow,
    col: TrackingMarkCol,
    value: TrackingMarkValue | null | undefined,
  ) {
    const key = markKey(row.id, col);
    setStaged((m) => {
      const next = new Map(m);
      if (value === undefined) next.delete(key);
      else next.set(key, value);
      return next;
    });
    // 又改了：上一次的 Saved / 报错不再算数。
    setMarkStatus((m) => {
      if (!m.has(key)) return m;
      const next = new Map(m);
      next.delete(key);
      return next;
    });
  }

  async function saveMark(row: MorningTrackingRow, col: TrackingMarkCol) {
    const key = markKey(row.id, col);
    if (!staged.has(key) || markStatus.get(key)?.kind === "saving") return;
    const value = staged.get(key) ?? null;
    const setStatus = (s: MarkSaveStatus | null) =>
      setMarkStatus((m) => {
        const next = new Map(m);
        if (s) next.set(key, s);
        else next.delete(key);
        return next;
      });
    setStatus({ kind: "saving" });
    try {
      await saveTrackingMark({
        date: dateRef.current,
        bookingId: row.id,
        orderNumber: row.order_number,
        col,
        value,
      });
      setStaged((m) => {
        const next = new Map(m);
        next.delete(key);
        return next;
      });
      setStatus({ kind: "saved" });
      // 后端同一次写入已记成「已处理」：重拉一次拿新标记和「✓ 谁」。
      await load(dateRef.current, true);
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setStatus({ kind: "error", message: describeError(error) });
    }
  }

  function changeTab(next: "tracking" | "live") {
    if (next === tab) return;
    if (!confirmDiscard()) return;
    setTab(next);
  }

  function changeDate(next: string) {
    if (!isYmd(next) || next === date) {
      return;
    }
    if (!confirmDiscard()) return;
    setMarkStatus(new Map());
    setDriver("");
    setRefreshError(null);
    setLive({ kind: "idle" });
    setDate(next);
  }

  async function toggleAction(row: MorningTrackingRow, want: "on" | "off") {
    if (togglingId !== null) {
      return;
    }
    setTogglingId(row.id);
    setActionError(null);
    try {
      await toggleTakeAction(row.id, undefined, want);
      // 接口回的是用户名；重拉一次拿显示名，和其余行同一个口径。
      await load(dateRef.current, true);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
      } else {
        setActionError(
          `Could not update order ${row.order_number}: ${describeError(error)}`,
        );
      }
    } finally {
      setTogglingId(null);
    }
  }

  // 司机标记（Driver mark 列、No show 置顶 / 红底 / 页签数字）跟 Live drivers 同一个开关：开关没对我开时表跟以前一样。
  const allRows = useMemo(
    () =>
      (data?.rows ?? []).map((r) => {
        if (canLive) return r;
        // 开关没对我开：Relay / Bus 新键也拿掉（hasSplitMarks 按键在不在判）。
        const rest = { ...r };
        delete rest.relay_mark;
        delete rest.relay_original;
        delete rest.bus_mark;
        delete rest.bus_original;
        return {
          ...rest,
          live_status: undefined,
          live_status_at: undefined,
          ns_unhandled: false,
        };
      }),
    [data, canLive],
  );
  // 订单生命周期「Open chat →」：?chat=单号 ⇒ 这天有这单就打开对话框，没有就黄字（Annie「全部同意推荐。动手」）。
  const chatParam = useOpenChatFromUrl(data ? allRows : null, (row) =>
    openConversation(row, false),
  );
  const drivers = useMemo(() => summarizeDrivers(allRows), [allRows]);
  // 刷新以后这位司机没有单了，就回到 All（不能出现「All 亮着、其实还在按司机筛」）。
  const activeDriver = drivers.some((d) => d.driver === driver) ? driver : "";
  const filtered = useMemo(
    () =>
      orderRows(
        allRows.filter(
          (r) =>
            (!activeDriver || r.driver === activeDriver) &&
            matchesSearch(r, search),
        ),
      ),
    [allRows, activeDriver, search],
  );
  const stats = data ? computeStats(filtered) : null;
  const nsBadge = noShowBadge(allRows);
  const newNoShow = useMemo(
    () =>
      new Set(
        [...nsSeen]
          .filter(([, at]) => now - at < NEW_NO_SHOW_MS)
          .map(([id]) => id),
      ),
    [nsSeen, now],
  );
  const showMarks = hasLiveMarks(allRows);
  // No show 改方向（N9 A）：后端带了 Relay / Bus 分开的标记 ⇒ 出这两列、不出 Driver mark。
  const showSplit = hasSplitMarks(allRows);
  const markEditing: MarkEditing = {
    canEdit: canTakeMorning && showSplit,
    staged,
    status: markStatus,
    onStage: stageMark,
    onSave: (row, col) => void saveMark(row, col),
  };
  // 置顶 58：后端带了到 / 离时间才出 Arrived at / Left at 两列（旧后端没有这两个键）。
  const showArrivals = allRows.some((r) => "arrived_at" in r);
  const visibleColumns = columnOrder.filter(
    (k) =>
      // 没勾 See prices, agent & commission（orders.money_view，题 8）：Agent 列整列不出（后端给的是空字符串）。
      (canSeeMoney || k !== "agent_name") &&
      // 后端还没带司机标记（旧版）：Driver mark 列不出；带了 Relay / Bus 分开的新键（G321）：只出这两列。
      ((showMarks && !showSplit) || k !== "driver_mark") &&
      (showSplit || (k !== "relay_mark" && k !== "bus_mark")) &&
      (showArrivals || (k !== "arrived_at" && k !== "left_at")),
  );
  const livePeople = useMemo(() => {
    const people = live.kind === "ready" ? live.data.people : [];
    if (!activeDriver) return people;
    // 司机筛选：Tracking 的司机名跟这一列的名字对上（不分大小写，名字写法不一样时按名字开头）。
    const want = activeDriver.trim().toLowerCase();
    return people.filter((p) => {
      const n = p.name.trim().toLowerCase();
      return n === want || n.startsWith(want) || want.startsWith(n);
    });
  }, [live, activeDriver]);

  function openConversation(row: MorningTrackingRow, both: boolean) {
    setConversationBoth(both);
    setConversation({
      bookingId: row.id,
      orderNumber: row.order_number,
      guestName: row.name,
      phone: row.phone,
      email: row.email,
      smsBadge: smsBadgeOf(row.sms_status),
      emailBadge: emailBadgeOf(row.email_state),
      actionTakenBy: row.action_taken_by,
    });
  }

  /** Live drivers 每列点 Text / Messages 里的客人：按单号找 Tracking 那一行，打开同一个回复框（⑨）。 */
  function openGuest(orderNumber: string) {
    const row = allRows.find((r) => r.order_number === orderNumber);
    if (row) openConversation(row, true);
    else
      setActionError(
        `Order ${orderNumber} is not on this morning's tracking list, so it cannot be answered here. Use Orders.`,
      );
  }

  const today = date ? laToday(new Date(now)) : "";
  const pollNotice = !data
    ? ""
    : date !== today
      ? "Auto-refresh is off for other dates."
      : endMinute !== null && laMinuteOfDay(new Date(now)) >= endMinute
        ? `Auto-refresh stopped at ${endLabel} — new replies show on the dashboard.`
        : // 窗口内旧页面这里是空的（只有别的日期 / 过了截止才写一句），照旧。
          "";

  /** 顶栏状态灯（Annie 2026-11-17 整合样稿第 2 题 A）：刷新中 = 绿点闪，过了截止 = 灰点，别的日子 = 灰点 OFF；整句放 title。 */
  const refreshLight: {
    kind: "live" | "stopped" | "off";
    text: string;
    full: string;
  } | null =
    !data || !date
      ? null
      : date !== today
        ? { kind: "off", text: "Auto-refresh off", full: pollNotice }
        : endMinute === null
          ? null
          : laMinuteOfDay(new Date(now)) >= endMinute
            ? { kind: "stopped", text: `Stopped ${endLabel}`, full: pollNotice }
            : {
                kind: "live",
                text:
                  tab === "live" && canLive
                    ? "Live · every 30 sec"
                    : "Live · every 1 min",
                full: `Refreshing automatically until ${endLabel || "the cut-off"}.`,
              };

  const placeholder =
    state.kind === "loading"
      ? "Loading…"
      : state.kind === "error"
        ? "Failed to load."
        : filtered.length === 0
          ? "No records found."
          : null;

  return (
    // 整页照旧页面 tracking_morning.html（不套站点外框）：深色底 #0d1b2e、56px 顶栏、IBM Plex Sans。
    <main
      data-phone-compact
      className={cn(
        trackingFont.className,
        "min-h-screen bg-[#0d1b2e] leading-[normal] text-[#e0eaf6]",
      )}
    >
      {/* 最上面的 My shortcuts 条（Annie 2026-10-19：所有页面包括 tracking 页）；页面原来的 ← Back 去掉，页面顶栏钉在它下面（48px）。 */}
      <PageShortcutBar />
      <div className="sticky top-0 z-10 flex h-12 items-center justify-between gap-2 border-b border-white/[.08] bg-[#0a1628] px-3 sm:top-12 sm:h-14 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3.5">
          <PhoneShortcutStar />
          <h1 className="truncate text-[15px] font-bold text-white sm:text-[17px]">
            🔵 Morning Pickup Tracking
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* 自动刷新停了要说一声（同旧页面 #poll-notice）。 */}
          {refreshLight ? <RefreshLight {...refreshLight} /> : null}
          <PhoneMore label="More actions">
            <a
              href={date ? buildMorningExportUrl(date) : undefined}
              title="Excel of the morning messages sent for this date"
              className={BTN}
            >
              ⬇ Export
            </a>
          </PhoneMore>
          <button
            type="button"
            onClick={() => date && void load(date, false)}
            disabled={!date || state.kind === "loading"}
            className={cn(
              BTN,
              "border-[#1a6b3a] bg-[#1a6b3a] text-white hover:bg-[#145530] disabled:hover:bg-[#1a6b3a]",
            )}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      <div className="w-full px-3 py-3 sm:px-6 sm:py-5">
        {state.kind === "forbidden" ? (
          <TrackingNotice dark>
            <p className="font-semibold text-white">Staff access required</p>
            <p className="mt-1">This page is for back-office staff only.</p>
          </TrackingNotice>
        ) : (
          <>
            {/* Annie 2026-11-17「这个页面也要整合一下，空白的地方太多了，搞得有高科技感一些」，样稿 1/2/3/5 A、页签不动：
                日期 + 一行数字（原来 4 张大卡）；司机按钮 + 搜索并成一行，窗口窄了才折行。 */}
            <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-2 max-sm:mb-2">
              <div className="flex items-center gap-2 max-sm:hidden">
                <button
                  type="button"
                  aria-label="Previous day"
                  onClick={() => changeDate(shiftYmd(date, -1))}
                  disabled={!date}
                  className={NAV_BTN}
                >
                  ‹
                </button>
                <input
                  type="date"
                  aria-label="Date"
                  value={date}
                  onChange={(event) => changeDate(event.target.value)}
                  className="min-w-[140px] cursor-pointer rounded-[7px] border border-white/15 bg-[#1a2f4a] px-2.5 py-1.5 text-center font-[inherit] text-[14px] font-semibold text-white [color-scheme:dark] outline-none focus:border-[#185FA5]"
                />
                <button
                  type="button"
                  aria-label="Next day"
                  onClick={() => changeDate(shiftYmd(date, 1))}
                  disabled={!date}
                  className={NAV_BTN}
                >
                  ›
                </button>
                <button
                  type="button"
                  onClick={() => changeDate(laToday())}
                  disabled={!date || date === today}
                  className={cn(
                    BTN,
                    "border-[#c47a12] bg-[#c47a12] font-semibold text-white hover:bg-[#a86510] hover:text-white disabled:cursor-default disabled:hover:bg-[#c47a12]",
                  )}
                >
                  Today
                </button>
              </div>
              <span
                aria-hidden
                className="mx-1.5 h-[18px] w-px bg-white/[.12] max-sm:hidden"
              />
              {/* 手机上不出日期切换，只写今天；「Today · …」并进数字那一行（手机简化题 5 A）。 */}
              <SummaryStrip
                stats={stats}
                phoneToday={isPhone ? phoneDay(today) : null}
              />
            </div>

            {canLive ? (
              <div
                role="tablist"
                aria-label="Morning tracking views"
                className="mb-3 flex items-center gap-2 sm:mb-[18px]"
              >
                {(["tracking", "live"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    data-mt-tab={t}
                    onClick={() => changeTab(t)}
                    className={cn(
                      "relative",
                      tab === t
                        ? DARK_PRIMARY_BUTTON_CLASS
                        : DARK_SECONDARY_BUTTON_CLASS,
                    )}
                  >
                    {t === "tracking" ? "Tracking" : "Live drivers"}
                    {t === "live" &&
                    pageVisibility.visibilityOf("morning_live_drivers") ===
                      "super_admin_only" ? (
                      <span className="ml-1.5 text-[10px] font-bold text-[#fcd34d]">
                        Super Admin only
                      </span>
                    ) : null}
                    {/* 没处理的 No show：红数字；有 No show 都处理了：绿点（站内规矩）。 */}
                    {nsBadge.unhandled ? (
                      <span
                        data-ns-badge
                        className="absolute -top-[6px] -right-[6px] h-[17px] min-w-[17px] rounded-[9px] bg-[#ef4444] px-1 text-center text-[10.5px] leading-[17px] font-bold text-white shadow-[0_0_0_2px_#0d1b2e]"
                      >
                        {nsBadge.unhandled}
                      </span>
                    ) : nsBadge.any ? (
                      <span
                        data-ns-badge-ok
                        className="absolute -top-[4px] -right-[4px] size-2.5 rounded-full bg-[#22c55e] shadow-[0_0_0_2px_#0d1b2e]"
                      />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}

            {state.kind === "error" ? (
              <TrackingBanner
                dark
                actionLabel="Retry"
                onAction={() => void load(date, false)}
              >
                Could not load check-ins: {state.message}
              </TrackingBanner>
            ) : null}
            {chatParam.notFound ? (
              <ChatNotFound
                dark
                text={chatParam.notFound}
                onDismiss={chatParam.dismiss}
              />
            ) : null}
            {refreshError ? (
              <TrackingBanner
                dark
                actionLabel="Retry"
                onAction={() => void load(date, true)}
              >
                Not updating — {refreshError}
              </TrackingBanner>
            ) : null}
            {actionError ? (
              <TrackingBanner
                dark
                actionLabel="Dismiss"
                onAction={() => setActionError(null)}
              >
                {actionError}
              </TrackingBanner>
            ) : null}

            {/* 旧页面永远有 All（没有司机、还没加载完也有），照旧。 */}
            <div className="mb-3.5 flex flex-wrap items-center gap-1.5 max-sm:mb-2.5 max-sm:flex-nowrap">
              <div
                role="group"
                aria-label="Filter by driver"
                className="flex flex-wrap gap-1.5 max-sm:min-w-0 max-sm:flex-1 max-sm:flex-nowrap max-sm:overflow-x-auto"
              >
                <DriverPill
                  active={!activeDriver}
                  onClick={() => setDriver("")}
                >
                  {/* 加载完之前只写 All，加载后带人数（同旧页面）。 */}
                  All
                  {data ? (
                    <>
                      {" "}
                      <span className="text-[11px] opacity-70">
                        {allRows.length}
                      </span>
                    </>
                  ) : null}
                </DriverPill>
                {drivers.map((d) => (
                  <DriverPill
                    key={d.driver}
                    active={activeDriver === d.driver}
                    onClick={() => setDriver(d.driver)}
                    share={d.total ? d.checkedIn / d.total : 0}
                  >
                    {d.driver} {d.checkedIn}/{d.total}
                  </DriverPill>
                ))}
              </div>

              <div className="ml-2 flex flex-1 items-center gap-2 max-sm:hidden">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search order #, name, phone…"
                  aria-label="Search"
                  className="w-[220px] rounded-[7px] border border-white/15 bg-[#1a2f4a] px-3 py-[5px] text-[13px] text-[#e0eaf6] outline-none placeholder:text-[#5a7a9a] focus:border-[#185FA5] max-sm:hidden [&::-webkit-search-cancel-button]:appearance-none"
                />
                <span className="ml-auto font-mono text-[11.5px] tracking-[.06em] text-[#5a7a9a] uppercase">
                  {data ? `${filtered.length} records` : "— records"}
                </span>
              </div>
            </div>
            {/* 手机：搜索单独一行（司机按钮那行横着滑）。 */}
            <div className="mb-2.5 sm:hidden">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search order #, name, phone…"
                aria-label="Search"
                className="w-full rounded-[7px] border border-white/15 bg-[#1a2f4a] px-3 py-[5px] text-[13px] text-[#e0eaf6] outline-none placeholder:text-[#5a7a9a] focus:border-[#185FA5] [&::-webkit-search-cancel-button]:appearance-none"
              />
            </div>

            {tab === "live" && canLive ? (
              live.kind === "forbidden" ? (
                <TrackingNotice dark>
                  <p className="font-semibold text-white">
                    Live drivers is not open to you yet
                  </p>
                </TrackingNotice>
              ) : live.kind === "error" ? (
                <TrackingBanner
                  dark
                  actionLabel="Retry"
                  onAction={() => void loadLive(date, false)}
                >
                  Could not load the drivers&apos; pages: {live.message}
                </TrackingBanner>
              ) : live.kind === "ready" ? (
                <LiveDriversBoard
                  people={livePeople}
                  search={search}
                  onOpenGuest={openGuest}
                />
              ) : (
                <p className="p-7 text-center text-[#4a6a8a]">Loading…</p>
              )
            ) : // 手机（< 640px）：不要 Check-in Log 标题和表头，每位客人一行、点开看详情（Annie 2026-11-17「全部按推荐，动手」，
            // 样稿 2Tt9qzDzCYENfiAeEpdjn7）。电脑版照旧是整张表。
            isPhone ? (
              <PhoneTrackingList
                rows={filtered}
                columns={visibleColumns}
                onOpenConversation={(row) => openConversation(row, false)}
                newNoShow={newNoShow}
                onToggleAction={(row, want) => void toggleAction(row, want)}
                togglingId={togglingId}
                now={now}
                placeholder={placeholder}
              />
            ) : (
              <section className="overflow-hidden rounded-[12px] border border-white/[.08] bg-[#1a2f4a]">
                <div className="flex items-center justify-between border-b border-white/[.08] bg-[#0f2035] px-4 py-3">
                  <h2 className="text-[13px] font-semibold text-[#7ab3e0]">
                    Check-in Log
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  {/* 纯操作提示：手机上不显示（手机上也拖不了列）。 */}
                  <div className="mb-1 flex flex-wrap justify-between gap-x-4 gap-y-1 px-0.5 text-[11px] text-[#aaa] max-sm:hidden">
                    <span className="font-semibold text-[#5ba3d9]">
                      Click a Bus # to see live tracking (opens Samsara in a new
                      tab)
                    </span>
                    <span className="ml-auto">
                      ⇆ Drag columns to reorder · ↔ Drag edges to resize
                    </span>
                  </div>
                  <TrackingTable
                    rows={filtered}
                    columnOrder={visibleColumns}
                    onReorder={reorderColumns}
                    onOpenConversation={(row) => openConversation(row, false)}
                    newNoShow={newNoShow}
                    marks={markEditing}
                    onToggleAction={(row, want) => void toggleAction(row, want)}
                    togglingId={togglingId}
                    now={now}
                    placeholder={placeholder}
                  />
                </div>
              </section>
            )}
          </>
        )}
        <HowToUse
          dark
          title="How to use — Morning Pickup Tracking"
          items={[
            "Pick the date (‹ ›, the date box or Today). The numbers next to the date are for the guests you are looking at; the bar shows the check-in rate. Click a driver to see only their guests; the thin green line under each driver shows how many of their guests have checked in. The search box finds an order #, name or phone.",
            "On a phone, each guest is one line: a green dot means checked in, a red dot means not checked in yet. ⚠️ means something needs you (a No show or a message). Tap the line to see the guest's details, Chat and Take action; tap it again to close.",
            "Check-in shows ✓ Checked In or ⏳ Pending.",
            "Click a number in Bus # to see where that bus is now. Samsara opens in a new tab. A number you cannot click has no live map: it is not in Settings → Vehicles, or that vehicle has no Samsara link.",
            "Click a Driver name to see where that driver is right now, even if they switched buses after dispatch. A name you cannot click means we could not match that driver to a live vehicle.",
            'Guest Viewed shows when that guest opened their tracking link today. "—" means they have not clicked it yet. "Bus changed — ask the guest to open the link again" in red means the driver is on a different bus from the one the guest last opened: ask the guest to open the link in their text again and tap Track. You don\'t need to send a new link.',
            "\"Driver changed after send — link now follows …\" under a driver's name: the driver was changed in Dispatch after the text went out. The guest's link already follows the new driver. You don't need to send anything.",
            "Driver changed (with or without a bus change): change the driver on Dispatch → Assign and Save. The guest's tracking link then follows the new driver to the bus they are on. You don't need to text the guest again.",
            "Click a Notes or WhatsApp cell to read and reply: tick SMS to guest or Email to guest, click Send →. SMS can be at most 300 characters, plain characters only (no emoji, curly quotes or long dashes); if it is longer, send it by email.",
            "When your reply goes out to the guest (SMS or email sent), the message counts as handled and shows ✓ with your name. If no reply is needed, click ✓ Mark as actioned (or Take action in the table). If a new message comes in afterward, the cell goes back to ⚠️ Take action — clicking it once does not clear later messages too.",
            "A Phone AI message means a guest called and did not get their confirmation, or said our email or phone is wrong. The message says what the AI promised the guest, usually that it will be sent within 15 minutes: check any new email or phone with the guest, resend it, then click ✓ Mark as actioned. The same message also goes to reservations@.",
            "The whole list refreshes every minute until the cut-off. The light in the top bar shows LIVE (green, blinking) while it refreshes and STOPPED after the cut-off; point at it for details. Click ↻ Refresh any time. ⬇ Export downloads the day (on a phone it is under ⋯).",
            "Drag a column header to move it. The order is saved to your account and is the same as on the old admin page. Drag its right edge to make it wider or narrower; widths go back to normal when you reload the page.",
            // 司机实时页（开关对我开时才写）。
            ...(canLive
              ? [
                  "Live drivers shows each driver's and guide's phone page side by side, read-only. Picked up, Boarded and No show show the time they were marked. It refreshes every 30 seconds. Tap Text, or a guest in Messages, to reply: SMS and email go together from the company number, and the driver sees your reply in their conversation.",
                ]
              : []),
            // No show 改方向（Annie 2026-11-17「动手」）：后端带了 Relay / Bus 分开的标记才写这几条。
            // 第 3 版（Annie 2026-11-19「no show那个同意推荐，动手」，样稿 SvK1sLi1jFefZN2naHa6y5 原文）：staff 只在 Bus 列点 No show。
            ...(canLive && showSplit
              ? [
                  'Relay shows what the relay driver marked: Picked up or No show. Bus shows what the guide marked when guests got on the bus: Boarded or No show. Guests who board at Treasure Island have no relay, so Relay shows "—". The Bus mark is the final word on a No show.',
                  ...(canTakeMorning
                    ? [
                        "If a guest did not show up, click No show in the Bus column so it turns red, then click Save next to it. To take it back, click the red No show and click Save. Your change shows on Main manifest, the Bus Manifest page and the order page. The guide's own mark is kept: hover over the mark to see it.",
                      ]
                    : []),
                  "Only guests who were sent the morning pickup text are listed here. A guest who was not sent it has no row, so you can't change their mark on this page. The guide's Bus mark for that guest still shows on Main manifest, the Bus Manifest page and the order page.",
                  "When a driver or guide marks No show, that order moves to the top of Tracking in red, with ⚠️ Take action under the mark. Click it once you have dealt with it. Changing that row's Relay or Bus mark and saving also counts as dealt with. The red number on the tabs counts the No shows nobody has handled; a green dot means all are handled.",
                ]
              : canLive
                ? [
                    "When a driver or guide marks No show, that order moves to the top of Tracking in red, with ⚠️ Take action under Driver mark. Click it once you have dealt with it. The red number on the tabs counts the No shows nobody has handled; a green dot means all are handled.",
                  ]
                : []),
          ]}
          warning={
            <>
              Saved, but NOT delivered: the guest did not get it, reach them
              another way. Not sent: click Send → again.
              <br />
              ⚠️ Guest Viewed only works while live tracking links are turned
              on. If that is ever turned off, this column will show
              &quot;—&quot; even for guests who viewed an older-style link —
              that is expected, not a bug.
            </>
          }
        />
      </div>

      {conversation ? (
        <ConversationModal
          key={conversation.orderNumber}
          theme="morning"
          target={conversation}
          source={{ kind: "order", line: "morning" }}
          onClose={() => setConversation(null)}
          onChanged={() => {
            void load(dateRef.current, true);
            if (tab === "live") void loadLive(dateRef.current, true);
          }}
          onUnauthorized={redirectToLogin}
          sendBoth={conversationBoth}
        />
      ) : null}
    </main>
  );
}

/** 旧页面 .btn：深蓝底、浅蓝字。 */
const BTN =
  "inline-flex cursor-pointer items-center gap-[5px] rounded-[7px] border border-white/15 bg-[#1a2f4a] px-3.5 py-1.5 text-[12px] text-[#a0c0e0] no-underline transition-colors hover:bg-[#1e3a5f] hover:text-white disabled:opacity-60 max-sm:whitespace-nowrap max-sm:px-2.5 max-sm:py-1";

/** 手机上「Today · Sun, Nov 1」。 */
function phoneDay(ymd: string): string {
  if (!ymd) return "";
  return new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** 旧页面 .btn-nav：32px 方块的 ‹ ›。 */
const NAV_BTN =
  "flex size-8 cursor-pointer items-center justify-center rounded-[7px] border border-white/15 bg-[#1a2f4a] text-[16px] text-[#a0c0e0] hover:bg-[#1e3a5f] hover:text-white disabled:opacity-60";

function DriverPill({
  share,
  active,
  onClick,
  children,
}: {
  /** 0–1：这个司机的客人签到了多少；All 不传。 */
  share?: number;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "relative cursor-pointer overflow-hidden rounded-[5px] border px-2.5 pt-[3px] pb-1 font-mono text-[11.5px] font-semibold whitespace-nowrap tabular-nums",
        active
          ? "border-[#38bdf8] bg-[#38bdf8]/10 text-white"
          : "border-white/[.12] bg-[#13263d] text-[#b8cde4] hover:border-white/30 hover:text-white",
      )}
    >
      {children}
      {/* 这个司机的客人签到了多少（样稿第 3 题 A）。 */}
      {share !== undefined ? (
        <span
          aria-hidden
          data-driver-bar
          className="absolute bottom-0 left-0 h-[2px] bg-[#2ecc71]"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      ) : null}
    </button>
  );
}

/**
 * 原来 4 张大卡换成一行控制台数字（Annie 2026-11-17 整合样稿第 1、5 题 A）：等宽字、淡光，签到率后面一根细进度条；
 * 手机上进度条单独占一行。数字不能点（同原来的卡）。
 */
function SummaryStrip({
  stats,
  phoneToday,
}: {
  stats: TrackingStats | null;
  /** 手机上「Today · Tue, Nov 17」放在这一行最前面，标签缩短成 In / Rate（手机简化题 5 A）；电脑 null。 */
  phoneToday: string | null;
}) {
  const item = (
    key: string,
    label: string,
    value: string | number,
    cls = "text-white [text-shadow:0_0_10px_rgba(56,189,248,.35)]",
  ) => (
    <span data-stat={key} className="whitespace-nowrap">
      {label}
      <b
        className={cn(
          "ml-1.5 text-[15px] font-bold tracking-normal max-sm:text-[13px]",
          cls,
        )}
      >
        {value}
      </b>
    </span>
  );
  const rate = stats?.rate ?? null;
  return (
    <section
      aria-label="Summary"
      data-mt-stats
      className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] tracking-[.06em] text-[#5a7a9a] uppercase tabular-nums max-sm:w-full max-sm:gap-x-3 max-sm:text-[10px]"
    >
      {phoneToday ? (
        <span
          data-phone-today
          className="font-sans text-[13px] font-semibold tracking-normal whitespace-nowrap text-[#7ab3e0] normal-case"
        >
          Today · {phoneToday}
        </span>
      ) : null}
      {item("total", "Total", stats ? stats.total : "—")}
      {item(
        "in",
        phoneToday ? "In" : "Checked in",
        stats ? stats.checkedIn : "—",
        "text-[#2ecc71] [text-shadow:0_0_10px_rgba(46,204,113,.35)]",
      )}
      {item(
        "pending",
        "Pending",
        stats ? stats.pending : "—",
        "text-[#e67e22]",
      )}
      <span title="Checked in / successfully sent SMS" className="contents">
        {item(
          "rate",
          phoneToday ? "Rate" : "Check-in rate",
          stats ? (rate === null ? "—" : `${rate}%`) : "—",
        )}
      </span>
      <span
        data-rate-bar
        aria-hidden
        className="h-[5px] w-[120px] overflow-hidden rounded-[3px] bg-white/[.08] max-sm:w-full max-sm:basis-full"
      >
        <span
          className="block h-full bg-[linear-gradient(90deg,#22c55e,#38bdf8)] shadow-[0_0_8px_rgba(56,189,248,.65)]"
          style={{ width: `${rate ?? 0}%` }}
        />
      </span>
    </section>
  );
}

/** 顶栏状态灯（样稿第 2 题 A）：live = 绿点闪；stopped / off = 灰点。整句在 title 和读屏文字里。 */
function RefreshLight({
  kind,
  text,
  full,
}: {
  kind: "live" | "stopped" | "off";
  text: string;
  full: string;
}) {
  return (
    <span
      data-refresh-light={kind}
      title={full}
      className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#38bdf8]/20 bg-[#38bdf8]/[.06] px-2 py-0.5 font-mono text-[11px] tracking-[.06em] whitespace-nowrap text-[#7ab3e0] uppercase max-sm:px-1.5 max-sm:text-[10px]"
    >
      <span
        aria-hidden
        className={cn(
          "size-[7px] rounded-full",
          kind === "live"
            ? "bg-[#2ecc71] motion-safe:animate-[mt-pulse_1.8s_infinite]"
            : "bg-[#64748b]",
        )}
      />
      <span className="max-sm:hidden">{text}</span>
      <span className="sm:hidden">
        {kind === "live" ? "Live" : kind === "stopped" ? "Stopped" : "Off"}
      </span>
      <span className="sr-only">{full}</span>
    </span>
  );
}
