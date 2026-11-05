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
} from "@/lib/morning-tracking-api";
import { usePageVisibility } from "@/lib/page-visibility";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { usePermissions } from "@/lib/staff-permissions";
import { fetchUserPref, saveUserPref } from "@/lib/user-prefs-api";
import { cn, takeSearchParam } from "@/lib/utils";
import type { LiveDrivers, MorningTracking, MorningTrackingRow } from "@/types";

import {
  type ColumnKey,
  computeStats,
  DEFAULT_COLUMN_ORDER,
  emailBadgeOf,
  hasLiveMarks,
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
import { PhoneShortcutStar } from "@/components/ui/phone";
import { useIsPhone } from "@/lib/phone";
import { LiveDriversBoard } from "./live-drivers";
import { TrackingTable } from "./tracking-table";
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
  const { partnerView, canSeeMoney } = usePermissions();
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
    window.history.replaceState(null, "", url);
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

  function changeDate(next: string) {
    if (!isYmd(next) || next === date) {
      return;
    }
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
      (data?.rows ?? []).map((r) =>
        canLive
          ? r
          : {
              ...r,
              live_status: undefined,
              live_status_at: undefined,
              ns_unhandled: false,
            },
      ),
    [data, canLive],
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
  // 置顶 58：后端带了到 / 离时间才出 Arrived at / Left at 两列（旧后端没有这两个键）。
  const showArrivals = allRows.some((r) => "arrived_at" in r);
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
          {pollNotice ? (
            <span className="max-w-[320px] text-[12px] text-[#8fb4d4]">
              {pollNotice}
            </span>
          ) : null}
          <a
            href={date ? buildMorningExportUrl(date) : undefined}
            title="Excel of the morning messages sent for this date"
            className={BTN}
          >
            ⬇ Export
          </a>
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
            {/* 手机上不出日期切换，只写今天。 */}
            <p
              data-phone-today
              className="mb-2 text-[14px] font-semibold text-[#7ab3e0] sm:hidden"
            >
              Today · {phoneDay(today)}
            </p>
            <div className="mb-[18px] flex items-center gap-2 max-sm:hidden">
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
                    onClick={() => setTab(t)}
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
            <div
              role="group"
              aria-label="Filter by driver"
              className="mb-3 flex flex-wrap gap-1.5 sm:mb-[18px]"
            >
              <DriverPill active={!activeDriver} onClick={() => setDriver("")}>
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
                >
                  {d.driver}: {d.checkedIn}/{d.total}
                </DriverPill>
              ))}
            </div>

            <section
              aria-label="Summary"
              className="mb-3 flex flex-wrap gap-2.5 max-sm:flex-nowrap max-sm:gap-1.5 sm:mb-5"
            >
              <StatCard label="Total" value={stats ? stats.total : "—"} />
              <StatCard
                label="Checked In"
                value={stats ? stats.checkedIn : "—"}
                valueClass="text-[#2ecc71]"
              />
              <StatCard
                label="Pending"
                value={stats ? stats.pending : "—"}
                valueClass="text-[#e67e22]"
              />
              <StatCard
                label="Check-in Rate"
                title="Checked in / successfully sent SMS"
                value={
                  stats ? (stats.rate === null ? "—" : `${stats.rate}%`) : "—"
                }
              />
            </section>

            <div className="mb-3.5 flex items-center gap-2.5">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search order #, name, phone…"
                aria-label="Search"
                className="w-[220px] rounded-[7px] border border-white/15 bg-[#1a2f4a] px-3 py-[7px] text-[13px] text-[#e0eaf6] outline-none placeholder:text-[#5a7a9a] focus:border-[#185FA5] [&::-webkit-search-cancel-button]:appearance-none"
              />
              <span className="ml-auto text-[12px] text-[#5a7a9a]">
                {data ? `${filtered.length} records` : "— records"}
              </span>
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
                    columnOrder={columnOrder.filter(
                      (k) =>
                        // 没勾 See prices, agent & commission（orders.money_view，题 8）：Agent 列整列不出（后端给的是空字符串）。
                        (canSeeMoney || k !== "agent_name") &&
                        // 后端还没带司机标记（旧版）：Driver mark 列不出。
                        (showMarks || k !== "driver_mark") &&
                        (showArrivals ||
                          (k !== "arrived_at" && k !== "left_at")),
                    )}
                    onReorder={reorderColumns}
                    onOpenConversation={(row) => openConversation(row, false)}
                    newNoShow={newNoShow}
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
            "Pick the date (‹ ›, the date box or Today). Click a driver to see only their guests. The search box finds an order #, name or phone.",
            "Check-in shows ✓ Checked In or ⏳ Pending.",
            "Click a number in Bus # to see where that bus is now. Samsara opens in a new tab. A number you cannot click has no live map: it is not in Settings → Vehicles, or that vehicle has no Samsara link.",
            "Click a Driver name to see where that driver is right now, even if they switched buses after dispatch. A name you cannot click means we could not match that driver to a live vehicle.",
            'Guest Viewed shows when that guest opened their tracking link today. "—" means they have not clicked it yet. "Bus changed — ask the guest to open the link again" in red means the driver is on a different bus from the one the guest last opened: ask the guest to open the link in their text again and tap Track. You don\'t need to send a new link.',
            "\"Driver changed after send — link now follows …\" under a driver's name: the driver was changed in Dispatch after the text went out. The guest's link already follows the new driver. You don't need to send anything.",
            "Driver changed (with or without a bus change): change the driver on Dispatch → Assign and Save. The guest's tracking link then follows the new driver to the bus they are on. You don't need to text the guest again.",
            "Click a Notes or WhatsApp cell to read and reply: tick SMS to guest or Email to guest, click Send →. SMS can be at most 300 characters, plain characters only (no emoji, curly quotes or long dashes); if it is longer, send it by email.",
            "When a message is handled, click ✓ Mark as actioned (or Take action in the table). If a new message comes in afterward, the cell goes back to ⚠️ Take action — clicking it once does not clear later messages too.",
            "A Phone AI message means a guest called and did not get their confirmation, or said our email or phone is wrong. The message says what the AI promised the guest, usually that it will be sent within 15 minutes: check any new email or phone with the guest, resend it, then click ✓ Mark as actioned. The same message also goes to reservations@.",
            "The whole list refreshes every minute until the cut-off. Click ↻ Refresh any time. ⬇ Export downloads the day.",
            "Drag a column header to move it. The order is saved to your account and is the same as on the old admin page. Drag its right edge to make it wider or narrower; widths go back to normal when you reload the page.",
            // 司机实时页（开关对我开时才写）。
            ...(canLive
              ? [
                  "Live drivers shows each driver's and guide's phone page side by side, read-only. Picked up, Boarded and No show show the time they were marked. It refreshes every 30 seconds. Tap Text, or a guest in Messages, to reply: SMS and email go together from the company number, and the driver sees your reply in their conversation.",
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
  active,
  onClick,
  children,
}: {
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
        "cursor-pointer rounded-[20px] border px-3.5 py-1 text-[12px] font-semibold whitespace-nowrap",
        active
          ? "border-[#185FA5] bg-[#185FA5] text-white"
          : "border-white/[.12] bg-[#1a2f4a] text-[#7a9bbe] hover:border-white/30 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function StatCard({
  label,
  value,
  valueClass,
  title,
}: {
  label: string;
  value: number | string;
  valueClass?: string;
  title?: string;
}) {
  return (
    <div
      title={title}
      className="min-w-[100px] rounded-[10px] border border-white/[.08] bg-[#1a2f4a] px-5 py-3 text-center max-sm:min-w-0 max-sm:flex-1 max-sm:px-1 max-sm:py-1.5"
    >
      <div
        className={cn(
          "text-[26px] font-bold text-white tabular-nums max-sm:text-[18px]",
          valueClass,
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-[#7a9bbe] max-sm:text-[10px] max-sm:leading-tight">
        {label}
      </div>
    </div>
  );
}
