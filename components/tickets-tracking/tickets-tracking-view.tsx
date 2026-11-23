"use client";

import {
  Fragment,
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
import {
  BROADCAST_COUNT_HOW_TO,
  BroadcastButton,
  BroadcastCountDot,
} from "@/components/tracking-ui/broadcast-button";
import { trackingFont } from "@/components/tracking-ui/font";
import { BroadcastDialog } from "@/components/ui/broadcast-dialog";
import { useTrackingSyncSwitch } from "@/components/tour-tracking/sync-switch";
import { TICKETS_SYNC_API } from "@/lib/tracking-sync-api";
import { ColumnPicker } from "@/components/ui/column-picker";
import { ConversationModal } from "@/components/ui/conversation-modal";
import { HowToUse } from "@/components/ui/how-to-use";
import { describeError, isStatus } from "@/lib/api-errors";
import { toggleTakeAction } from "@/lib/booking-notes-api";
import { isYmd, laToday, shiftYmd } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { withoutMoneyHeaders } from "@/lib/money-view";
import { usePermissions } from "@/lib/staff-permissions";
import { useTick } from "@/lib/use-tick";
import { fetchUserPref, saveUserPref } from "@/lib/user-prefs-api";
import {
  buildTicketsExportUrl,
  fetchTicketsBroadcasts,
  fetchTicketsTracking,
  updateTicketStatus,
} from "@/lib/tickets-tracking-api";
import { cn, takeSearchParam } from "@/lib/utils";
import { ChatNotFound } from "@/components/tracking-ui/chat-not-found";
import { useOpenChatFromUrl } from "@/lib/open-chat-param";
import type {
  BroadcastLogEntry,
  TicketsTracking,
  TicketsTrackingRow,
} from "@/types";

import {
  broadcastCandidates,
  COLUMN_PREFS_KEY,
  type ColumnPrefs,
  computeStats,
  broadcastableRows,
  hasSyncFields,
  isUnsent,
  SYNC_BROADCAST_HOW_TO,
  SYNC_HOW_TO,
  UNSENT_NOTE,
  UNSENT_ROW_BG,
  defaultColumnPrefs,
  emailBadgeOf,
  matchesSearch,
  orderRows,
  parseColumnPrefs,
  POLL_INTERVAL_MS,
  productPills,
  smsBadgeOf,
  sumPax,
  SYSTEM_COLUMNS,
  type SystemColumnKey,
  toursOnDate,
  uploadedHeaders,
  visibleColumns,
} from "./config";
import { TicketsTable } from "./tickets-table";
import { PageShortcutBar } from "@/components/nav/page-shortcut-bar";
import { PhoneMore, PhoneShortcutStar } from "@/components/ui/phone";
import { UploadDialog } from "./upload-dialog";
import { setVisibleInterval } from "@/lib/visible-poll";

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: TicketsTracking };

/** WhatsApp 窗口倒计时自己走，不等 60 秒一轮。 */
const CLOCK_TICK_MS = 30_000;
/** 新消息提示条最多直接列几单。 */
const BANNER_MAX = 3;
/** ⬆ Upload 键（同 Tour Tracking 题 7「所有人都隐藏」，Annie 2026-11-20 4⑥ B 门票页一起改）：false = 不出；弹窗和代码留着。 */
const SHOW_UPLOAD = false;

function readPrefs(): ColumnPrefs {
  try {
    return parseColumnPrefs(window.localStorage.getItem(COLUMN_PREFS_KEY));
  } catch {
    return defaultColumnPrefs();
  }
}

function writePrefs(prefs: ColumnPrefs) {
  try {
    window.localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 存不了时只是下次回到默认。
  }
}

function isPrefsJson(raw: string | null): raw is string {
  if (!raw) return false;
  try {
    const v: unknown = JSON.parse(raw);
    return !!v && typeof v === "object" && !Array.isArray(v);
  } catch {
    return false;
  }
}

const messageCount = (r: TicketsTrackingRow) => r.notes_count + r.wa_count;

export function TicketsTrackingView() {
  // date 为空表示还没在浏览器里算出要看哪天（避免服务端 / 浏览器不一致）。
  const [date, setDate] = useState("");
  // G281：开关改了就重读这一天。
  const reloadRef = useRef<() => void>(() => {});
  const syncSwitch = useTrackingSyncSwitch(
    () => reloadRef.current(),
    TICKETS_SYNC_API,
  );
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [broadcasts, setBroadcasts] = useState<BroadcastLogEntry[]>([]);
  // 自动刷新 / 静默重拉失败时不清空表格，只提示。
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState("");
  const [prefs, setPrefs] = useState<ColumnPrefs>(defaultColumnPrefs);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  // partner 不能群发（Annie 2026-10-27「发送只能是我们内部员工发送」）：没有 📣 Broadcast 键。
  const perms = usePermissions();
  // 员工也按勾（Annie 2026-10-30 置顶 10c）：没勾 broadcast.send 看不到群发键；总开关关着照旧全给，Super Admin 全给。
  const canBroadcast = useTick("broadcast.send");
  const noBroadcast = perms.partnerLacks("broadcast.send") || !canBroadcast;
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  /** 自动刷新时消息数变多的单（提示条）；关掉以后等下一次有新消息再出现。 */
  const [newMessageIds, setNewMessageIds] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const redirectingRef = useRef(false);
  /** 只认最新一次请求的结果：换日期以后，旧日期晚到的响应丢掉。 */
  const requestSeqRef = useRef(0);
  /** 当前看的日期：写完 / 弹窗回调里重拉用它，点的时候那天已经换走了也不会把旧日期的行拉回来。 */
  const dateRef = useRef(date);
  dateRef.current = date;
  /** 这次打开后改过列设置：账号里的晚到时不再覆盖。 */
  const prefsTouchedRef = useRef(false);
  /** 上一轮各单的消息数（按 id），用来发现新消息；换日期时清空。 */
  const lastCountsRef = useRef<Map<number, number> | null>(null);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("date");
    setDate(isYmd(fromUrl) ? fromUrl : laToday());
    // dashboard 订单查询的「Open tracking →」带 ?q=单号：搜索框预填这一单。
    setSearch(takeSearchParam("q") ?? "");
    setPrefs(readPrefs());
    // 列设置存在账号里（tickets_col_order，换电脑也在）：本机缓存先画，账号里的到了再覆盖。
    // 值的格式是本页定的 {order, hide, file}；读到不认识的就当没存过。
    const controller = new AbortController();
    fetchUserPref("tickets_col_order", controller.signal)
      .then((raw) => {
        if (!isPrefsJson(raw) || prefsTouchedRef.current) return;
        const remote = parseColumnPrefs(raw);
        setPrefs(remote);
        writePrefs(remote);
      })
      .catch(() => {
        // 读不到就用本机的。
      });
    return () => controller.abort();
  }, []);

  const load = useCallback(
    async (target: string, silent: boolean) => {
      const seq = ++requestSeqRef.current;
      if (!silent) {
        setState({ kind: "loading" });
      }
      try {
        const [data, sent] = await Promise.all([
          fetchTicketsTracking(target),
          // 群发记录只是参考信息，拉不到不影响表格。
          fetchTicketsBroadcasts(target).catch(() => null),
        ]);
        if (seq !== requestSeqRef.current) {
          return;
        }
        // 和上一轮比，消息数变多的单进提示条（第一轮只记基线，不提示）。
        const counts = new Map(data.rows.map((r) => [r.id, messageCount(r)]));
        const previous = lastCountsRef.current;
        if (previous) {
          const grown = data.rows
            .filter((r) => messageCount(r) > (previous.get(r.id) ?? 0))
            .map((r) => r.id);
          if (grown.length) {
            setNewMessageIds((ids) => [...new Set([...grown, ...ids])]);
          }
        }
        lastCountsRef.current = counts;
        setState({ kind: "ready", data });
        if (sent) {
          setBroadcasts(sent);
        }
        setRefreshError(null);
        setNow(Date.now());
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

  useEffect(() => {
    if (!date) {
      return;
    }
    // 地址栏跟着日期走，刷新 / 分享链接还是这一天。
    const url = new URL(window.location.href);
    url.searchParams.set("date", date);
    window.history.replaceState(null, "", url);
    lastCountsRef.current = null;
    setNewMessageIds([]);
    setBroadcasts([]);
    void load(date, false);
  }, [date, load]);

  // 每 60 秒静默重拉整表（不闪 Loading），全天都拉。
  useEffect(() => {
    if (!date) {
      return;
    }
    return setVisibleInterval(() => void load(date, true), POLL_INTERVAL_MS);
  }, [date, load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  function updatePrefs(next: ColumnPrefs) {
    prefsTouchedRef.current = true;
    setPrefs(next);
    writePrefs(next);
    // partner 不存账号偏好（后端 G204 对 partner 的列 / 版面 key 回 403），只记在本机。
    if (perms.partnerView) return;
    saveUserPref("tickets_col_order", JSON.stringify(next)).catch(() => {
      // 存不进账号时这台电脑上照样记得（本机缓存）。
    });
  }

  function moveColumn(from: SystemColumnKey, to: SystemColumnKey) {
    // 往右拖放在目标后面、往左拖放在目标前面（同旧页面）。
    const toIndex = prefs.order.indexOf(to);
    const order = prefs.order.filter((k) => k !== from);
    order.splice(toIndex, 0, from);
    updatePrefs({ ...prefs, order });
  }

  function changeDate(next: string) {
    if (!isYmd(next) || next === date) {
      return;
    }
    setProduct("");
    setRefreshError(null);
    setActionError(null);
    setDate(next);
  }

  async function toggleAction(row: TicketsTrackingRow, want: "on" | "off") {
    if (busyId !== null) {
      return;
    }
    setBusyId(row.id);
    setActionError(null);
    try {
      await toggleTakeAction(row.id, "tickets", want);
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
      setBusyId(null);
    }
  }

  /** 状态下拉选了还没按 ✓ 的（按行 id，B8）。 */
  const [drafts, setDrafts] = useState<ReadonlyMap<number, string>>(new Map());
  const [savedId, setSavedId] = useState<number | null>(null);
  function setDraft(row: TicketsTrackingRow, value: string | null) {
    setDrafts((d) => {
      const next = new Map(d);
      if (value === null) next.delete(row.id);
      else next.set(row.id, value);
      return next;
    });
  }
  // 选了状态没按 ✓ 就离开页面：先问（全站规矩）。
  useLeaveGuard(
    drafts.size > 0,
    "A status you picked is not saved yet (click ✓ to save it). Leave without saving?",
  );

  async function changeStatus(row: TicketsTrackingRow, value: string) {
    if (busyId !== null || state.kind !== "ready") {
      return;
    }
    const previous = state.data;
    // 后端按「CHD 号 + 服务日期」改，同单同天的其他产品行一起改。
    const sameOrder = (r: TicketsTrackingRow) =>
      r.order_number === row.order_number && r.tour_date === row.tour_date;
    setState({
      kind: "ready",
      data: {
        ...previous,
        rows: previous.rows.map((r) =>
          sameOrder(r) ? { ...r, confirmation_status: value } : r,
        ),
      },
    });
    setBusyId(row.id);
    setActionError(null);
    // 正在路上的自动刷新带的是改之前的状态，作废它；存好后再静默重拉一次，以服务端为准。
    requestSeqRef.current += 1;
    try {
      await updateTicketStatus({
        orderNumber: row.order_number,
        serviceDate: row.tour_date,
        confirmation: value,
      });
      // 存好了才收起 ✓ / ✕，闪一下绿字；失败时改动留着（下面 catch），可以再按 ✓。
      setDraft(row, null);
      setSavedId(row.id);
      setTimeout(() => setSavedId((id) => (id === row.id ? null : id)), 1400);
      await load(dateRef.current, true);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      // 改回原值（只动这几行，期间自动刷新带回来的其他变化保留）。
      const original = new Map(
        previous.rows
          .filter(sameOrder)
          .map((r) => [r.id, r.confirmation_status]),
      );
      setState((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              data: {
                ...current.data,
                rows: current.data.rows.map((r) =>
                  original.has(r.id)
                    ? { ...r, confirmation_status: original.get(r.id)! }
                    : r,
                ),
              },
            }
          : current,
      );
      setActionError(
        `Order ${row.order_number} was not changed: ${describeError(error)}`,
      );
    } finally {
      setBusyId(null);
    }
  }

  const data = state.kind === "ready" ? state.data : null;
  const allRows = useMemo(() => data?.rows ?? [], [data]);
  // 订单生命周期「Open chat →」：?chat=单号 ⇒ 这天有这单就打开对话框，没有就黄字（Annie「全部同意推荐。动手」）。
  const chatParam = useOpenChatFromUrl(data ? allRows : null, (row) =>
    setConversationId(row.id),
  );
  // G281：旧后端 / 看不到同步的人没有 send_state ⇒ 页面跟现在一样（没有 Order Status 列、灰行说明、To notify）。
  const sync = useMemo(() => hasSyncFields(allRows), [allRows]);
  // 产品按钮上的 YES / 总人数也只算发过的（题 4 A，同 Tour Tracking 的团胶囊）。
  const sentRows = useMemo(
    () => allRows.filter((r) => !isUnsent(r)),
    [allRows],
  );
  const pills = useMemo(() => productPills(sentRows), [sentRows]);
  // 没勾 orders.money_view（题 8）：上传名单里算钱 / 代理商的表头不出，Columns 里也勾不上。
  const headers = useMemo(
    () => withoutMoneyHeaders(uploadedHeaders(allRows), perms.canSeeMoney),
    [allRows, perms.canSeeMoney],
  );
  const columns = visibleColumns(prefs, headers).filter(
    (k) => sync || k !== "order_status",
  );
  const pickerColumns = sync
    ? SYSTEM_COLUMNS
    : SYSTEM_COLUMNS.filter((c) => c.key !== "order_status");
  const filtered = useMemo(
    () =>
      orderRows(
        allRows.filter(
          (r) =>
            (!product || r.tour_type === product) && matchesSearch(r, search),
        ),
      ),
    [allRows, product, search],
  );
  // G281 题 4 A：灰行（还没发提醒）不算进上面的数字和回复率。
  const stats = data
    ? computeStats(filtered.filter((r) => !isUnsent(r)))
    : null;
  reloadRef.current = () => {
    if (date) void load(date, false);
  };
  const unsentCount = filtered.filter(isUnsent).length;
  const today = date ? laToday(new Date(now)) : "";
  const tomorrow = today ? shiftYmd(today, 1) : "";

  const conversationRow =
    conversationId === null
      ? null
      : (allRows.find((r) => r.id === conversationId) ?? null);
  const bannerRows = newMessageIds
    .map((id) => allRows.find((r) => r.id === id))
    .filter((r): r is TicketsTrackingRow => !!r);

  const placeholder =
    state.kind === "loading"
      ? "Loading…"
      : state.kind === "error"
        ? "Failed to load. Please refresh."
        : filtered.length === 0
          ? "No records for this date."
          : null;

  return (
    // 整页照旧页面 tracking_tickets.html（不套站点外框）：浅灰底 #f0f4f8、88px 星空顶栏、IBM Plex Sans。
    <main
      data-phone-compact
      className={cn(
        trackingFont.className,
        "min-h-screen bg-[#f0f4f8] text-[14px] leading-[normal] font-medium text-[#1a2a3a]",
      )}
    >
      {/* 最上面的 My shortcuts 条（Annie 2026-10-19：所有页面包括 tracking 页）。 */}
      <PageShortcutBar />
      <HeroHeader />

      {state.kind === "forbidden" ? (
        <div className="p-5">
          <TrackingNotice>
            <p className="font-semibold text-[#1a3a5c]">
              Staff access required
            </p>
            <p className="mt-1">This page is for back-office staff only.</p>
          </TrackingNotice>
        </div>
      ) : (
        <>
          {/* 顶部压缩，同 Tour Tracking（Annie 2026-11-20 Excel 4⑥ B「门票页一起改」+「动手」）：
              第一行 = 日期 + 一行数字（原来 6 张卡；这页的卡本来不能点，照旧只看）+ 最右 Main manifest sync；
              第二行 = 团按钮（小长方形）+ 工具同一行，窗口窄了才折成两行。 */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-[#dde3ea] bg-paper px-5 py-2 shadow-[0_1px_6px_rgba(26,42,60,0.06)] max-sm:px-3 max-sm:py-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-pressed={!!date && date === today}
                onClick={() => changeDate(laToday())}
                className="cursor-pointer rounded-[7px] border-none bg-[#1a3a5c] px-[11px] py-[4px] text-[12px] font-bold tracking-[.5px] text-white hover:bg-[#0f2440]"
              >
                Today
              </button>
              <button
                type="button"
                aria-pressed={!!date && date === tomorrow}
                onClick={() => changeDate(shiftYmd(laToday(), 1))}
                className="cursor-pointer rounded-[7px] border border-[#dde3ea] bg-[#f0f4f8] px-[11px] py-[3px] text-[12px] font-semibold text-[#4a6080] hover:border-[#c0cdd9] hover:bg-[#e2e8f0]"
              >
                Tomorrow
              </button>
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
                aria-label="Service date"
                value={date}
                onChange={(event) => changeDate(event.target.value)}
                className="h-[26px] min-w-[130px] cursor-pointer rounded-[7px] border border-[#dde3ea] bg-paper px-2 font-[inherit] text-[12.5px] font-bold text-[#1a3a5c] max-sm:w-[116px] max-sm:min-w-0 max-sm:px-1.5 [&::-webkit-calendar-picker-indicator]:hidden"
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
            </div>

            <section
              aria-label="Summary"
              data-phone-stats
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12.5px] text-[#1a1a1a] sm:ml-2.5 max-sm:order-last max-sm:basis-full max-sm:text-[12px]"
            >
              {(
                [
                  ["Total Orders", stats?.orders, "text-[#1a3a5c]"],
                  ["YES", stats?.yes, "text-[#166534]"],
                  ["Reschedule", stats?.reschedule, "text-[#c97a00]"],
                  ["Pending", stats?.pending, "text-[#1a1a1a]"],
                  ["Cancelled", stats?.cancelled, ""],
                ] as const
              ).map(([label, value, color], i) => (
                <Fragment key={label}>
                  {i ? (
                    <span aria-hidden className="text-[#9aa6b2]">
                      ·
                    </span>
                  ) : null}
                  <span data-stat={label} className="whitespace-nowrap">
                    <b className={cn("font-extrabold tabular-nums", color)}>
                      {value ?? "—"}
                    </b>{" "}
                    {label}
                  </span>
                </Fragment>
              ))}
              {sync ? (
                <span
                  data-to-notify
                  className="whitespace-nowrap text-[#5b6470]"
                  title="Grey rows: ticket orders in the Main manifest whose reminder hasn't been sent yet"
                >
                  · <b className="tabular-nums">{unsentCount}</b> to notify
                </span>
              ) : null}
              <span
                data-stat="Response Rate"
                className="whitespace-nowrap"
                title="Replied / reached by email or SMS"
              >
                ·{" "}
                <b className="tabular-nums">
                  {stats
                    ? stats.responseRate === null
                      ? "—"
                      : `${stats.responseRate}%`
                    : "—"}
                </b>{" "}
                replied
              </span>
            </section>

            {/* G281 题 1 A：同 Tour Tracking 的「Main manifest sync」，只给 Super Admin，跟 Tour 的是两个开关；4④ A 放日期行最右。 */}
            {syncSwitch.control}
          </div>
          {syncSwitch.below}

          {state.kind === "error" ||
          refreshError ||
          actionError ||
          chatParam.notFound ? (
            <div className="px-5 pt-3">
              {state.kind === "error" ? (
                <TrackingBanner
                  actionLabel="Retry"
                  onAction={() => void load(date, false)}
                >
                  Could not load tickets: {state.message}
                </TrackingBanner>
              ) : null}
              {chatParam.notFound ? (
                <ChatNotFound
                  text={chatParam.notFound}
                  onDismiss={chatParam.dismiss}
                />
              ) : null}
              {refreshError ? (
                <TrackingBanner
                  actionLabel="Retry"
                  onAction={() => void load(date, true)}
                >
                  Not updating — {refreshError}
                </TrackingBanner>
              ) : null}
              {actionError ? (
                <TrackingBanner
                  actionLabel="Dismiss"
                  onAction={() => setActionError(null)}
                >
                  {actionError}
                </TrackingBanner>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-5 pt-2.5 pb-2.5 max-sm:block max-sm:px-3 max-sm:pt-2 max-sm:pb-2">
            {data ? (
              <div
                role="group"
                aria-label="Filter by tour"
                // 手机上排成一行、左右滑（手机版规则：统计一行）。
                className="flex flex-wrap gap-[5px] max-sm:mb-2 max-sm:flex-nowrap max-sm:overflow-x-auto"
              >
                <ProductPill
                  active={!product}
                  label="Total Guests"
                  yesPax={sumPax(
                    sentRows.filter((r) => r.confirmation_status === "yes"),
                  )}
                  totalPax={sumPax(sentRows)}
                  onClick={() => setProduct("")}
                />
                {pills.map((p) => (
                  <ProductPill
                    key={p.slug}
                    active={product === p.slug}
                    label={p.short}
                    yesPax={p.yesPax}
                    totalPax={p.totalPax}
                    onClick={() => setProduct(p.slug)}
                  />
                ))}
              </div>
            ) : null}

            <div
              data-tools-row
              className="flex grow flex-wrap items-center gap-1.5"
            >
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="🔍  Search order #, name, phone…"
                aria-label="Search"
                className="box-border h-[26px] w-[200px] rounded-[7px] border border-[#cbd5e1] bg-paper px-2.5 font-[inherit] text-[12px] text-[#1a1a1a] outline-none max-sm:w-auto max-sm:min-w-0 max-sm:flex-1 [&::-webkit-search-cancel-button]:appearance-none"
              />
              {/* 手机上 Columns / CSV / Broadcast 收进「⋯」（手机版规则：次要按钮）；当天发过群发 ⇒ ⋯ 上也标条数。 */}
              <PhoneMore
                label="More actions"
                // 浅色页：⋯ 用深色字和边（共用件默认是深色页的样子）。
                className="[&_[data-phone-more]]:border-[#cbd5e1] [&_[data-phone-more]]:bg-paper [&_[data-phone-more]]:text-[#1a3a5c]"
                badge={
                  !noBroadcast && broadcasts.length ? (
                    <BroadcastCountDot count={broadcasts.length} />
                  ) : undefined
                }
              >
                <ColumnPicker
                  columns={pickerColumns}
                  prefs={prefs}
                  headers={headers}
                  onChange={updatePrefs}
                  // 同旧页面 resetCols()：只复原显示哪些列（系统列全显示、上传列全不显示），不动列的顺序。
                  onReset={() => updatePrefs({ ...prefs, hide: [], file: [] })}
                  note="Saved to your account."
                  buttonClassName={cn(REFRESH_BTN, SMALL_BTN)}
                  menuTop={30}
                />
                {/* 4⑤ A：Download CSV ⇒「⬇ CSV」。 */}
                <a
                  href={date ? buildTicketsExportUrl(date) : undefined}
                  title="Download CSV: everything for this date — every column of the uploaded manifest, then the status columns"
                  className="inline-flex h-[26px] cursor-pointer items-center rounded-[7px] border border-[#378ADD] bg-transparent px-[9px] text-[11.5px] font-semibold text-[#185fa5] no-underline hover:bg-[rgba(55,138,221,0.14)]"
                >
                  ⬇ CSV
                </a>
                {/* ⬆ Upload 藏了（同 Tour Tracking 题 7「所有人都隐藏」，4⑥ B 一起改）：弹窗和代码留着，改 SHOW_UPLOAD 就能放回。 */}
                {SHOW_UPLOAD ? (
                  <button
                    type="button"
                    onClick={() => setUploadOpen(true)}
                    disabled={!date}
                    title="Add orders that were not sent from this system"
                    className="h-[26px] cursor-pointer rounded-[7px] border-none bg-[#378ADD] px-[9px] text-[11.5px] font-semibold text-white hover:bg-[#2b74c0] disabled:opacity-60"
                  >
                    ⬆ Upload
                  </button>
                ) : null}
                {noBroadcast ? null : (
                  <BroadcastButton
                    phone
                    items={broadcasts}
                    onOpen={() => setBroadcastOpen(true)}
                    disabled={!data}
                    className="self-start sm:hidden"
                  />
                )}
              </PhoneMore>
              <button
                type="button"
                onClick={() => date && void load(date, false)}
                disabled={!date || state.kind === "loading"}
                className={cn(REFRESH_BTN, SMALL_BTN)}
              >
                ↻ Refresh
              </button>
              <span className="ml-1 text-[12px] whitespace-nowrap text-[#1a1a1a] max-sm:hidden">
                {data
                  ? `${filtered.length} ${filtered.length === 1 ? "record" : "records"}`
                  : "0 records"}
              </span>
              {/* 4⑤ A：灰色图例进工具行，全句停上去看。 */}
              {sync ? (
                <span
                  data-unsent-note
                  title={UNSENT_NOTE}
                  className="inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap text-[#1a1a1a] max-sm:order-last max-sm:basis-full"
                >
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 shrink-0 rounded-[3px] border border-[#c7cad1]"
                    style={{ background: UNSENT_ROW_BG }}
                  />
                  Grey = not sent yet
                </span>
              ) : null}
              {/* 4③ A：键上标当天已发条数（0 不标），点小数字在键下展开当天列表；点键本身照旧开发送窗。 */}
              {noBroadcast ? null : (
                <BroadcastButton
                  items={broadcasts}
                  onOpen={() => setBroadcastOpen(true)}
                  disabled={!data}
                  className="ml-auto max-sm:hidden"
                />
              )}
            </div>
          </div>

          <div className="px-5 pb-1.5">
            <div className="flex items-center gap-2 rounded-t-lg border-[0.5px] border-[#b3d9f7] bg-[#dce8f5] px-3.5 py-2">
              <h2 className="text-[13px] font-semibold text-[#1a3a5c]">
                Tickets Reminder Log
              </h2>
              {bannerRows.length ? (
                <span
                  role="status"
                  className="ml-1 inline-flex items-center gap-[5px] rounded-[5px] border border-[#f0c040] bg-[#fff8e1] px-2 py-0.5 text-[11px] text-[#856404]"
                >
                  {/* 同旧页面：💬 单号 · 单号 · 单号 +N more（不写 New messages:）。 */}
                  💬
                  {bannerRows.slice(0, BANNER_MAX).map((r, i) => (
                    <Fragment key={r.id}>
                      {i ? <span aria-hidden>&nbsp;·&nbsp;</span> : null}
                      <button
                        type="button"
                        onClick={() => {
                          setConversationId(r.id);
                          setNewMessageIds((ids) =>
                            ids.filter((id) => id !== r.id),
                          );
                        }}
                        className="cursor-pointer font-semibold underline"
                      >
                        {r.order_number}
                      </button>
                    </Fragment>
                  ))}
                  {bannerRows.length > BANNER_MAX
                    ? `+${bannerRows.length - BANNER_MAX} more`
                    : null}
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => setNewMessageIds([])}
                    className="cursor-pointer pl-1 text-[13px] leading-none text-[#856404]"
                  >
                    ×
                  </button>
                </span>
              ) : null}
              {/* 纯操作提示：手机上不显示（手机版规则）。 */}
              <span className="ml-auto text-[11px] whitespace-nowrap text-[#b3d9f7] max-sm:hidden">
                ⇆ Drag to reorder · ↔ Drag to resize
              </span>
            </div>
          </div>
          <div className="overflow-x-auto px-5 pb-6 max-sm:px-3">
            <TicketsTable
              rows={filtered}
              columns={columns}
              onMoveColumn={moveColumn}
              onOpenConversation={(row) => setConversationId(row.id)}
              onToggleAction={(row, want) => void toggleAction(row, want)}
              onChangeStatus={(row, value) => void changeStatus(row, value)}
              drafts={drafts}
              onDraft={setDraft}
              savedId={savedId}
              busyId={busyId}
              now={now}
              placeholder={placeholder}
            />
          </div>

          <div className="px-5">
            <HowToUse
              title="How to use — Tickets Reminder Tracking"
              items={[
                // G281 题 5 A：开着同步（看得到灰行）才出这两条；第一条在最前。
                ...(sync ? [SYNC_HOW_TO] : []),
                "Pick the service date. Click a tour button to see one product only. The search box finds an order #, name or phone.",
                "To change a guest’s status, pick it in the Status column, then click ✓ next to it to save (✕ puts it back). Saved shows in green; if it can’t be saved, the reason shows in red at the top.",
                "Click a Notes or WhatsApp cell to read the guest’s messages and reply. When your reply goes out to the guest (SMS or email sent), it counts as handled and the cell shows ✓ with your name. If no reply is needed, click Take action. SMS can be at most 306 characters (134 if it has a character such as Δ), plain characters only (no emoji, accents such as á, or symbols such as € and { }; curly quotes and long dashes are changed to plain ones automatically); if your reply is longer, SMS to guest is greyed out and it goes by email only. Shorten it to use SMS again, then tick SMS to guest again.",
                "☰ Columns chooses what shows on the page. Untick a page column to hide it. Under From the uploaded file, tick any column of the manifest you uploaded to show it. Reset to default brings back the normal page. Your choice is saved to your account, so it follows you to another computer.",
                "Drag a column header to move it. Drag its right edge to make it wider.",
                // 4⑤ A 改名「⬇ CSV」；⬆ Upload 藏了，那句删掉（4⑥ B，同 Tour Tracking）。
                "⬇ CSV saves everything for this date, whatever columns are showing: every column of the uploaded manifest, then the status columns. Older orders have no manifest columns, so those cells are blank.",
                // 4③ A：Broadcast 键上的小数字。
                ...(noBroadcast ? [] : [BROADCAST_COUNT_HOW_TO]),
                // 这页 How to use 没有 Broadcast 那一条 ⇒ 放最后。
                ...(sync && !noBroadcast ? [SYNC_BROADCAST_HOW_TO] : []),
              ]}
              warning="If the list does not load, click ↻ Refresh or reload the page. If it still fails, take a screenshot and tell Annie."
            />
          </div>
        </>
      )}

      {broadcastOpen && date && !noBroadcast ? (
        <BroadcastDialog
          theme="tickets"
          module="tickets"
          templateSet="tix"
          tourDate={date}
          tours={toursOnDate(allRows)}
          candidates={broadcastCandidates(broadcastableRows(allRows))}
          onClose={() => setBroadcastOpen(false)}
          onSent={() => void load(dateRef.current, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}

      {uploadOpen && date ? (
        <UploadDialog
          serviceDate={date}
          onClose={() => setUploadOpen(false)}
          onInserted={() => void load(dateRef.current, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}

      {conversationRow ? (
        <ConversationModal
          key={conversationRow.id}
          theme="tickets"
          target={{
            bookingId: conversationRow.id,
            orderNumber: conversationRow.order_number,
            guestName: conversationRow.guest_name,
            phone: conversationRow.phone,
            email: conversationRow.email,
            smsBadge: smsBadgeOf(conversationRow),
            emailBadge: emailBadgeOf(conversationRow),
            actionTakenBy: conversationRow.action_taken_by,
            guestForm: {
              body: conversationRow.guest_notes,
              submittedAt: conversationRow.submitted_at,
            },
          }}
          source={{ kind: "ticket" }}
          onClose={() => setConversationId(null)}
          onChanged={() => void load(dateRef.current, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}
    </main>
  );
}

/** 旧页面 .btn-refresh：浅蓝底、青色字（☰ Columns 和 ↻ Refresh 共用）。 */
const REFRESH_BTN =
  "cursor-pointer rounded-[7px] border border-[#bae6fd] bg-[#e8f4f8] text-[13px] font-semibold text-[#0e7490] hover:bg-[#cceeff] disabled:opacity-60";

/** 4⑤ A：工具行按钮稍小。 */
const SMALL_BTN = "h-[26px] px-[9px] text-[11.5px]";

/** 旧页面 .btn-nav 的 ‹ ›（4⑤ A 改成 26px）。 */
const NAV_BTN =
  "flex size-[26px] cursor-pointer items-center justify-center rounded-[7px] border border-[#dde3ea] bg-paper text-[15px] leading-none text-[#4a6080] hover:bg-[#f0f4f8] disabled:opacity-60";

/**
 * 旧页面的星空顶栏（.top-bar：渐变底、星星、右边山的剪影、底边白色弧线）。
 * Logout 照旧页面放。原来的 ← Back 去掉了（Annie 2026-10-19：最上面有 My shortcuts 条，条里有 ← Back）。
 */
function HeroHeader() {
  return (
    <div className="relative flex h-[88px] items-center gap-3.5 overflow-hidden bg-[linear-gradient(135deg,#040d1a_0%,#071428_35%,#0d2045_65%,#123366_100%)] px-6 text-white shadow-[0_6px_28px_rgba(0,0,0,0.45)] max-sm:h-14 max-sm:gap-2 max-sm:px-3">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{ background: STARS }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 bottom-0 z-[1] h-full w-[52%] overflow-hidden"
      >
        <svg
          viewBox="0 0 600 90"
          preserveAspectRatio="xMaxYMax meet"
          className="h-full w-full"
        >
          <defs>
            <radialGradient id="tk-glow1" cx="75%" cy="30%" r="40%">
              <stop offset="0%" stopColor="rgba(95,168,255,0.18)" />
              <stop offset="100%" stopColor="rgba(95,168,255,0)" />
            </radialGradient>
            <radialGradient id="tk-glow2" cx="90%" cy="20%" r="25%">
              <stop offset="0%" stopColor="rgba(180,220,255,0.12)" />
              <stop offset="100%" stopColor="rgba(180,220,255,0)" />
            </radialGradient>
          </defs>
          <rect width="600" height="90" fill="url(#tk-glow1)" />
          <rect width="600" height="90" fill="url(#tk-glow2)" />
          <polygon
            points="200,90 280,42 320,58 370,28 420,50 480,18 540,38 600,20 600,90"
            fill="rgba(15,35,70,0.7)"
          />
          <polygon
            points="240,90 300,52 340,64 390,38 450,55 510,30 570,48 600,35 600,90"
            fill="rgba(10,25,55,0.8)"
          />
          <polygon
            points="280,90 350,58 400,72 460,44 520,62 580,42 600,50 600,90"
            fill="rgba(7,18,40,0.9)"
          />
          <line
            x1="350"
            y1="20"
            x2="600"
            y2="20"
            stroke="rgba(95,168,255,0.15)"
            strokeWidth="1"
          />
          <circle cx="420" cy="12" r="1" fill="rgba(255,255,255,0.8)" />
          <circle cx="460" cy="8" r="0.8" fill="rgba(255,255,255,0.6)" />
          <circle cx="500" cy="15" r="1" fill="rgba(255,255,255,0.7)" />
          <circle cx="540" cy="6" r="0.8" fill="rgba(255,255,255,0.5)" />
          <circle cx="570" cy="14" r="1.2" fill="rgba(255,255,255,0.9)" />
          <circle cx="590" cy="9" r="0.8" fill="rgba(255,255,255,0.6)" />
          <circle cx="480" cy="19" r="4" fill="rgba(95,168,255,0.25)" />
          <circle cx="480" cy="19" r="2" fill="rgba(150,210,255,0.7)" />
        </svg>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 -bottom-px left-0 z-[2] h-8"
      >
        <svg
          viewBox="0 0 1440 32"
          preserveAspectRatio="none"
          className="h-full w-full"
        >
          <path d="M0,32 Q720,0 1440,32 L1440,32 L0,32 Z" fill="#f0f4f8" />
        </svg>
      </div>
      <PhoneShortcutStar className="relative z-[3]" />
      <div className="relative z-[3] min-w-0 flex-1">
        <h1 className="m-0 text-[20px] font-bold tracking-[1px] uppercase [text-shadow:0_2px_14px_rgba(95,168,255,0.35)] max-sm:truncate max-sm:text-[15px] max-sm:tracking-normal">
          Tickets Reminder Log
        </h1>
        {/* 标语：手机上不显示（手机版规则：页头介绍不占地方）。 */}
        <div className="mt-0.5 text-[13px] font-medium tracking-[.5px] text-[rgba(180,200,230,0.8)] max-sm:hidden">
          Stay on top of every ticket. Never miss a guest.
        </div>
      </div>
      <a href="/auth/logout" className={cn(HERO_BTN, "relative z-[3]")}>
        Logout
      </a>
    </div>
  );
}

/** 旧页面 .logout-btn。 */
const HERO_BTN =
  "inline-block cursor-pointer rounded-lg border border-white/[.18] bg-white/10 px-4 py-1.5 text-[13px] font-semibold tracking-[.5px] whitespace-nowrap text-white transition-all hover:bg-white/20";

const STARS = [
  "8% 30%, rgba(255,255,255,0.9)",
  "18% 65%, rgba(255,255,255,0.5)",
  "30% 20%, rgba(255,255,255,0.7)",
  "42% 75%, rgba(255,255,255,0.4)",
  "55% 35%, rgba(255,255,255,0.6)",
  "64% 15%, rgba(255,255,255,0.5)",
  "74% 55%, rgba(255,255,255,0.35)",
  "83% 25%, rgba(255,255,255,0.6)",
  "91% 70%, rgba(255,255,255,0.45)",
  "96% 40%, rgba(255,255,255,0.7)",
]
  .map((s) => {
    const [at, color] = s.split(", ");
    return `radial-gradient(circle at ${at}, ${color} 1px, transparent 2px)`;
  })
  .join(", ");

function ProductPill({
  active,
  label,
  yesPax,
  totalPax,
  onClick,
}: {
  active: boolean;
  label: string;
  yesPax: number;
  totalPax: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title="Guests who replied YES / all guests"
      className={cn(
        "inline-flex cursor-pointer items-baseline gap-1 rounded-[5px] border px-[9px] py-[2px] text-[11.5px] font-semibold whitespace-nowrap transition-all duration-150 max-sm:shrink-0",
        active
          ? "border-[#185FA5] bg-[rgba(24,95,165,0.25)] text-white"
          : "border-[#14395f] bg-[#f5f8fc] text-[#1a1a1a] hover:border-[#1a3a5c] hover:bg-[#f0f4ff] hover:text-[#1a3a5c]",
      )}
    >
      {label}
      <span
        className={cn(
          "text-[11px] font-bold text-[#14395f] tabular-nums",
          active && "bg-white/25",
        )}
      >
        {yesPax}/{totalPax}
      </span>
    </button>
  );
}
