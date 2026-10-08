"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  TrackingBanner,
  TrackingNotice,
} from "@/components/tracking-ui/banners";
import { trackingFont } from "@/components/tracking-ui/font";
import { BroadcastDialog } from "@/components/ui/broadcast-dialog";
import { ColumnPicker } from "@/components/ui/column-picker";
import { ConversationModal } from "@/components/ui/conversation-modal";
import { HowToUse } from "@/components/ui/how-to-use";
import { describeError, isStatus } from "@/lib/api-errors";
import { toggleTakeAction } from "@/lib/booking-notes-api";
import { isYmd, laToday, shiftYmd } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { fetchTourTypes } from "@/lib/tour-send-api";
import {
  buildTourExportUrl,
  fetchTourBroadcasts,
  fetchTourTracking,
  updateMtlvTicketStatus,
  updateTourConfirmation,
} from "@/lib/tour-tracking-api";
import { fetchUserPref, saveUserPref } from "@/lib/user-prefs-api";
import { cn } from "@/lib/utils";
import type {
  BroadcastLogEntry,
  TourTracking,
  TourTrackingRow,
  TourTypeOption,
} from "@/types";

import {
  broadcastCandidates,
  COLUMN_ORDER_CACHE_KEY,
  COLUMN_VIS_KEY,
  computeStats,
  defaultOrder,
  emailBadgeOf,
  matchesSearch,
  orderRows,
  parseLegacyOrder,
  parseVis,
  POLL_INTERVAL_MS,
  smsBadgeOf,
  statusOf,
  SYSTEM_COLUMNS,
  type SystemColumnKey,
  toLegacyOrder,
  type TourColumnVis,
  tourMeta,
  tourPills,
  toursOnDate,
  uploadedHeaders,
  visibleColumns,
} from "./config";
import { LunchDialog } from "./lunch-dialog";
import { TourTable } from "./tour-table";
import { TourUploadDialog } from "./tour-upload-dialog";

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: TourTracking };

/** WhatsApp 窗口倒计时自己走，不等 60 秒一轮。 */
const CLOCK_TICK_MS = 30_000;
/** 新消息提示条最多直接列几单。 */
const BANNER_MAX = 3;

const STATUS_FILTERS: readonly { value: string; label: string }[] = [
  { value: "", label: "All Statuses" },
  { value: "yes", label: "YES" },
  { value: "modify_req", label: "Modify" },
  { value: "pending", label: "Pending" },
  { value: "cancel", label: "Cancel" },
];

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 无痕窗口等存不了：只是下次不记得。
  }
}

const messageCount = (r: TourTrackingRow) => r.notes_count + r.wa_count;

export function TourTrackingView() {
  // date 为空表示还没在浏览器里算出要看哪天（避免服务端 / 浏览器不一致）。
  const [date, setDate] = useState("");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [tourTypes, setTourTypes] = useState<TourTypeOption[]>([]);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [broadcasts, setBroadcasts] = useState<BroadcastLogEntry[]>([]);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tourFilter, setTourFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [order, setOrder] = useState<SystemColumnKey[]>(defaultOrder);
  const [vis, setVis] = useState<TourColumnVis>({ hide: [], file: [] });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [lunchId, setLunchId] = useState<number | null>(null);
  /** 状态下拉改了还没按 ✓ 的（按行 id）。 */
  const [drafts, setDrafts] = useState<Map<number, string>>(new Map());
  const [busyId, setBusyId] = useState<number | null>(null);
  const [newMessageIds, setNewMessageIds] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const redirectingRef = useRef(false);
  /** 只认最新一次请求的结果：换日期以后，旧日期晚到的响应丢掉。 */
  const requestSeqRef = useRef(0);
  /** 当前看的日期：写完 / 弹窗回调里重拉用它，点的时候那天已经换走了也不会把旧日期的行拉回来。 */
  const dateRef = useRef(date);
  dateRef.current = date;
  /** 上一轮各单的消息数（按 id），用来发现新消息；换日期时清空。 */
  const lastCountsRef = useRef<Map<number, number> | null>(null);
  /** 这次打开后拖过列：账号里的列顺序晚到时不再覆盖。 */
  const orderTouchedRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("date");
    setDate(isYmd(fromUrl) ? fromUrl : laToday());
    setVis(parseVis(readLocal(COLUMN_VIS_KEY)));
    const cached = parseLegacyOrder(readLocal(COLUMN_ORDER_CACHE_KEY));
    if (cached) setOrder(cached);
    const controller = new AbortController();
    // 列顺序跟着账号（tour_col_order，和旧页面共用、存列号）：本机缓存先画，账号里的到了再覆盖。
    // 没存过（null）或读不到就保持本机的（同旧页面）。
    fetchUserPref("tour_col_order", controller.signal)
      .then((raw) => {
        const remote = parseLegacyOrder(raw);
        if (remote && !orderTouchedRef.current) {
          setOrder(remote);
          writeLocal(COLUMN_ORDER_CACHE_KEY, toLegacyOrder(remote));
        }
      })
      .catch(() => {
        // 用本机的。
      });
    fetchTourTypes(controller.signal)
      .then(setTourTypes)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else setTypesError(describeError(error));
      });
    return () => controller.abort();
  }, [redirectToLogin]);

  const load = useCallback(
    async (target: string, silent: boolean) => {
      const seq = ++requestSeqRef.current;
      if (!silent) setState({ kind: "loading" });
      try {
        const [data, sent] = await Promise.all([
          fetchTourTracking(target),
          // 群发记录只是参考信息，拉不到不影响表格。
          fetchTourBroadcasts(target).catch(() => null),
        ]);
        if (seq !== requestSeqRef.current) return;
        // 和上一轮比，消息数变多的单进提示条（第一轮只记基线，不提示）。
        const counts = new Map(data.rows.map((r) => [r.id, messageCount(r)]));
        const previous = lastCountsRef.current;
        if (previous) {
          const grown = data.rows
            // 上一轮没有的单（换到这天、刚补录的）不算新消息（同旧页面）。
            .filter(
              (r) =>
                previous.has(r.id) && messageCount(r) > previous.get(r.id)!,
            )
            .map((r) => r.id);
          if (grown.length)
            setNewMessageIds((ids) => [...new Set([...grown, ...ids])]);
        }
        lastCountsRef.current = counts;
        setState({ kind: "ready", data });
        if (sent) setBroadcasts(sent);
        setRefreshError(null);
        setNow(Date.now());
      } catch (error) {
        if (seq !== requestSeqRef.current) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setState({ kind: "forbidden" });
        else if (silent) setRefreshError(describeError(error));
        else setState({ kind: "error", message: describeError(error) });
      }
    },
    [redirectToLogin],
  );

  useEffect(() => {
    if (!date) return;
    // 地址栏跟着日期走，刷新 / 分享链接还是这一天。
    const url = new URL(window.location.href);
    url.searchParams.set("date", date);
    window.history.replaceState(null, "", url);
    lastCountsRef.current = null;
    setNewMessageIds([]);
    setBroadcasts([]);
    setDrafts(new Map());
    void load(date, false);
  }, [date, load]);

  // 每 60 秒静默重拉整表（不闪 Loading）。
  useEffect(() => {
    if (!date) return;
    const timer = setInterval(() => void load(date, true), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [date, load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  function saveOrder(next: SystemColumnKey[]) {
    orderTouchedRef.current = true;
    setOrder(next);
    const payload = toLegacyOrder(next);
    writeLocal(COLUMN_ORDER_CACHE_KEY, payload);
    saveUserPref("tour_col_order", payload).catch(() => {
      // 存不进账号时这台电脑上照样记得。
    });
  }

  function moveColumn(from: SystemColumnKey, to: SystemColumnKey) {
    // 往右拖放在目标后面、往左拖放在目标前面（同旧页面；列顺序和旧页面共用，落点必须一样）。
    const toIndex = order.indexOf(to);
    const next = order.filter((k) => k !== from);
    next.splice(toIndex, 0, from);
    saveOrder(next);
  }

  function updateVis(next: TourColumnVis) {
    setVis(next);
    writeLocal(COLUMN_VIS_KEY, JSON.stringify(next));
  }

  function changeDate(next: string) {
    if (!isYmd(next) || next === date) return;
    setTourFilter("");
    setRefreshError(null);
    setActionError(null);
    setDate(next);
  }

  /** 改完一单后静默重拉（午餐清零、MTLV 连带、显示名都以服务端为准）。 */
  async function mutate(
    row: TourTrackingRow,
    what: string,
    run: () => Promise<void>,
  ) {
    if (busyId !== null) return false;
    setBusyId(row.id);
    setActionError(null);
    try {
      await run();
      await load(dateRef.current, true);
      return true;
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else
        setActionError(
          `Order ${row.order_number}: ${what} was not saved. ${describeError(error)}`,
        );
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function setDraft(row: TourTrackingRow, value: string | null) {
    setDrafts((d) => {
      const next = new Map(d);
      if (value === null) next.delete(row.id);
      else next.set(row.id, value);
      return next;
    });
  }

  async function saveStatus(row: TourTrackingRow) {
    const value = drafts.get(row.id);
    if (value === undefined) return;
    const ok = await mutate(row, "the status", () =>
      updateTourConfirmation(row.id, value),
    );
    // 存好了才收起 ✓ / ✕；失败时保留改动，可以再点 ✓ 或点 ✕ 撤销（旧页面失败直接改回）。
    if (ok) setDraft(row, null);
  }

  const data = state.kind === "ready" ? state.data : null;
  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const meta = useMemo(() => tourMeta(tourTypes), [tourTypes]);
  const pills = useMemo(() => tourPills(allRows, meta), [allRows, meta]);
  const headers = useMemo(() => uploadedHeaders(allRows), [allRows]);
  const columns = visibleColumns(order, vis, headers);
  const filtered = useMemo(
    () =>
      orderRows(
        allRows.filter(
          (r) =>
            (!tourFilter || r.tour_type === tourFilter) &&
            matchesSearch(r, search) &&
            (!statusFilter || statusOf(r) === statusFilter),
        ),
      ),
    [allRows, tourFilter, search, statusFilter],
  );
  const stats = data ? computeStats(filtered, meta) : null;
  const today = date ? laToday(new Date(now)) : "";
  const tomorrow = today ? shiftYmd(today, 1) : "";
  const allReplied = allRows.filter((r) => statusOf(r) !== "pending").length;

  const conversationRow =
    conversationId === null
      ? null
      : (allRows.find((r) => r.id === conversationId) ?? null);
  const lunchRow =
    lunchId === null ? null : (allRows.find((r) => r.id === lunchId) ?? null);
  const bannerRows = newMessageIds
    .map((id) => allRows.find((r) => r.id === id))
    .filter((r): r is TourTrackingRow => !!r);

  const placeholder =
    state.kind === "loading"
      ? "Loading…"
      : state.kind === "error"
        ? "Failed to load. Please refresh."
        : filtered.length === 0
          ? "No records found."
          : null;

  return (
    // 整页照旧页面 tracking_tour.html（不套站点外框）：沙色底 #f4f0e6、64px 绿色顶栏、IBM Plex Sans。
    <main
      className={cn(
        trackingFont.className,
        "min-h-screen bg-[#f4f0e6] text-[14px] leading-[normal] font-medium text-[#1f2d25]",
      )}
    >
      <div className="relative flex h-16 items-center justify-between overflow-hidden bg-[linear-gradient(135deg,#1a3a2a_0%,#2f5e46_60%,#3a7055_100%)] px-6 shadow-[0_4px_20px_rgba(26,58,42,0.3)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: TOPBAR_GLOW }}
        />
        {/* 底边的沙色弧线（旧页面 .topbar::after）。 */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 -bottom-[18px] left-0 h-9 rounded-[50%_50%_0_0/100%_100%_0_0] bg-[#f4f0e6]"
        />
        <div className="relative z-[1] flex items-center gap-3.5">
          <Link href="/dashboard" className={TOPBAR_BTN}>
            ← Back
          </Link>
          <h1 className="text-[17px] font-bold tracking-[.2px] text-white">
            Tour Confirmation Tracking
          </h1>
        </div>
        {/* ops 才有：去发送页（旧页面顶栏右边是空的）。 */}
        <div className="relative z-[1] flex gap-2">
          <Link href="/tour-confirmation/send" className={TOPBAR_BTN}>
            Send
          </Link>
        </div>
      </div>

      <div className="mx-auto w-full px-6 pt-7 pb-6">
        {state.kind === "forbidden" ? (
          <TrackingNotice>
            <p className="font-semibold text-[#1a3a2a]">
              Staff access required
            </p>
            <p className="mt-1">This page is for back-office staff only.</p>
          </TrackingNotice>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2">
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
                aria-label="Tour date"
                value={date}
                onChange={(e) => changeDate(e.target.value)}
                className="min-w-[130px] cursor-pointer rounded-lg border border-[#d0e0d4] bg-white px-3 py-[5px] text-center font-[inherit] text-[13px] font-semibold shadow-[0_1px_4px_rgba(26,58,42,0.07)] outline-none focus:border-[#2f5e46]"
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
                aria-pressed={!!date && date === today}
                onClick={() => changeDate(laToday())}
                className={GREEN_BTN}
              >
                Today
              </button>
              <button
                type="button"
                aria-pressed={!!date && date === tomorrow}
                onClick={() => changeDate(shiftYmd(laToday(), 1))}
                className={BTN}
              >
                Tomorrow
              </button>
              <span className="ml-auto text-[12px] text-[#6b7d72]">
                Auto-refreshes every minute.
              </span>
            </div>

            {typesError ? (
              <TrackingBanner>
                Could not load the tour list: {typesError} Tour buttons and
                lunch counts may be missing. Reload the page to try again.
              </TrackingBanner>
            ) : null}
            {state.kind === "error" ? (
              <TrackingBanner
                actionLabel="Retry"
                onAction={() => void load(date, false)}
              >
                Could not load the tour list for this date: {state.message}
              </TrackingBanner>
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

            {data ? (
              <div
                role="group"
                aria-label="Filter by tour"
                className="mb-4 flex flex-wrap gap-1.5"
              >
                <TourPillButton
                  active={!tourFilter}
                  label="All"
                  replied={allReplied}
                  total={allRows.length}
                  onClick={() => setTourFilter("")}
                />
                {pills.map((p) => (
                  <TourPillButton
                    key={p.key}
                    active={tourFilter === p.key}
                    label={p.label}
                    replied={p.replied}
                    total={p.total}
                    onClick={() => setTourFilter(p.key)}
                  />
                ))}
              </div>
            ) : null}

            <section
              aria-label="Summary"
              className="mb-4 flex flex-wrap items-stretch gap-2.5"
            >
              <StatCard
                label="Total"
                value={stats?.total}
                title="Show all"
                active={false}
                onClick={() => setStatusFilter("")}
              />
              <StatCard
                label="YES"
                value={stats?.yes}
                valueClass="text-[#1e7a45]"
                title="Filter YES"
                active={statusFilter === "yes"}
                onClick={() => setStatusFilter("yes")}
              />
              <StatCard
                label="Modify"
                value={stats?.modify}
                valueClass="text-[#c97a00]"
                title="Filter Modify"
                active={statusFilter === "modify_req"}
                onClick={() => setStatusFilter("modify_req")}
              />
              <StatCard
                label="Pending"
                value={stats?.pending}
                valueClass="text-[#185FA5]"
                title="Filter Pending"
                active={statusFilter === "pending"}
                onClick={() => setStatusFilter("pending")}
              />
              <StatCard
                label="Cancel"
                value={stats?.cancel}
                valueClass="text-[#c94040]"
                title="Filter Cancel"
                active={statusFilter === "cancel"}
                onClick={() => setStatusFilter("cancel")}
              />
              <StatCard
                label="Response Rate"
                title="Replied (non-pending) / successfully sent"
                value={
                  stats
                    ? stats.responseRate === null
                      ? "—"
                      : `${stats.responseRate}%`
                    : undefined
                }
              />
              {stats?.lunch.length ? (
                <div className="flex flex-wrap gap-2">
                  {stats.lunch.map((g) => (
                    <div
                      key={g.label}
                      data-lunch={g.label}
                      className="flex flex-col justify-center rounded-[12px] border border-[#d0e0d4] bg-white/90 px-4 py-2.5 shadow-[0_2px_8px_rgba(26,58,42,0.07)]"
                    >
                      <div className="mb-1 text-[11px] font-bold tracking-[.04em] text-[#2f5e46] uppercase">
                        {g.label}
                      </div>
                      <div className="flex gap-2.5 text-[13px] font-semibold whitespace-nowrap">
                        🦃 {g.turkey} · 🥗 {g.veggie}
                        {g.hasBeef ? ` · 🥩 ${g.beef}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
              <span className="text-[12px] whitespace-nowrap text-[#6b7d72]">
                {data ? `${filtered.length} records` : "— records"}
              </span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order #, name, phone…"
                aria-label="Search"
                className="w-[220px] rounded-lg border border-[#d0e0d4] bg-white/90 px-3 py-1.5 font-[inherit] text-[13px] shadow-[0_1px_4px_rgba(26,58,42,0.06)] outline-none focus:border-[#2f5e46] [&::-webkit-search-cancel-button]:appearance-none"
              />
              <select
                aria-label="Status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="cursor-pointer rounded-lg border border-[#d0e0d4] bg-white/90 px-2.5 py-1.5 font-[inherit] text-[13px] shadow-[0_1px_4px_rgba(26,58,42,0.06)]"
              >
                {STATUS_FILTERS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <ColumnPicker
                columns={SYSTEM_COLUMNS}
                prefs={vis}
                headers={headers}
                note="Hidden columns and uploaded-file columns are saved in this browser only. Column order (drag the headers) is saved to your account."
                onChange={updateVis}
                onReset={() => updateVis({ hide: [], file: [] })}
                buttonClassName={BTN}
                menuTop={34}
              />
              <a
                href={date ? buildTourExportUrl(date) : undefined}
                title="Everything for this date: every column of the uploaded manifest, then the status columns"
                className={cn(
                  BTN,
                  "border-[#378ADD] text-[#185fa5] hover:border-[#378ADD] hover:bg-[#eaf3fc]",
                )}
              >
                ⬇ Download CSV
              </a>
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                disabled={!date || !tourTypes.length}
                title="Add orders that were not sent from this system"
                className="inline-flex cursor-pointer items-center gap-[5px] rounded-lg border-none bg-[#378ADD] px-[13px] py-[5px] font-[inherit] text-[12px] font-semibold text-white shadow-[0_1px_4px_rgba(26,58,42,0.07)] hover:bg-[#2b74c0] disabled:opacity-60"
              >
                ⬆ Upload
              </button>
              <button
                type="button"
                onClick={() => date && void load(date, false)}
                disabled={!date || state.kind === "loading"}
                className={GREEN_BTN}
              >
                ↻ Refresh
              </button>
              <button
                type="button"
                onClick={() => setBroadcastOpen(true)}
                disabled={!data}
                className="ml-auto flex cursor-pointer items-center gap-[5px] rounded-[7px] border-none bg-[linear-gradient(135deg,#ffce21,#ee8e00)] px-3.5 py-[5px] text-[12px] font-bold text-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                📣 Broadcast
              </button>
            </div>

            {broadcasts.length ? <BroadcastPanel items={broadcasts} /> : null}

            <section className="overflow-hidden rounded-[14px] border border-[#d0e0d4] bg-white/[.92] shadow-[0_4px_20px_rgba(26,58,42,0.08)]">
              <div className="flex items-center border-b border-[#d0e0d4] bg-[linear-gradient(180deg,#e8f2ea_0%,#ddeae0_100%)] px-[18px] py-[11px]">
                <h2 className="text-[13px] font-bold text-[#1a3a2a]">
                  Dashboard
                </h2>
                {bannerRows.length ? (
                  <span
                    role="status"
                    className="ml-2 inline-flex items-center gap-[5px] rounded-[5px] border border-[#f0c040] bg-[#fff8e1] px-2 py-0.5 text-[11px] text-[#856404]"
                  >
                    💬 New messages:
                    {bannerRows.slice(0, BANNER_MAX).map((r) => (
                      <button
                        key={r.id}
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
                <span className="ml-auto text-[11px] whitespace-nowrap text-[#9ED3A9]">
                  ⇆ Drag column headers to reorder
                </span>
              </div>
              <div className="relative max-h-[calc(100vh-64px-180px)] overflow-x-auto overflow-y-visible">
                <TourTable
                  rows={filtered}
                  columns={columns}
                  meta={meta}
                  onMoveColumn={moveColumn}
                  drafts={drafts}
                  onDraft={setDraft}
                  onSaveStatus={(row) => void saveStatus(row)}
                  onEditLunch={(row) => setLunchId(row.id)}
                  onTicketStatus={(row, value) =>
                    void mutate(row, "the MTLV ticket status", () =>
                      updateMtlvTicketStatus(row.id, value),
                    )
                  }
                  onOpenConversation={(row) => setConversationId(row.id)}
                  onToggleAction={(row) =>
                    void mutate(row, "Take action", async () => {
                      await toggleTakeAction(row.id);
                    })
                  }
                  busyId={busyId}
                  now={now}
                  placeholder={placeholder}
                />
              </div>
            </section>

            <HowToUse
              title="How to use — Tour Confirmation Tracking"
              items={[
                "Pick the tour date with the arrows, the date box, Today or Tomorrow. Click a tour button to see one tour only.",
                "Click a number box (YES, Modify, Pending, Cancel) to see only those guests. Click Total to see everyone. The search box finds an order #, name or phone.",
                "To change a guest’s status, pick it in the Status column, then click ✓ to save or ✕ to undo. Cancel also clears the lunch and the MTLV tickets.",
                "Click a lunch number (🦃 🥗 🥩) to edit the lunch selection. Only YES guests on tours with lunch have one.",
                "MTLV guests: 🏛️ MTLV shows how many tickets the guest asked for. Set 🎟️ Tickets to Sent once you have sent them; it records who and when.",
                "Click a Notes or WhatsApp cell to read the guest’s messages and reply. Click Take action when it is handled.",
                "☰ Columns chooses what shows on the page. Untick a page column to hide it. Under From the uploaded file, tick any column of the manifest you uploaded to show it. Reset to default brings back the normal page. This choice is kept in this browser only.",
                "Drag a column header to move it. The order is saved to your account and is the same as on the old admin page.",
                "⬇ Download CSV saves everything for this date, whatever columns are showing: every column of the uploaded manifest, then the status columns. Older orders have no manifest columns, so those cells are blank.",
                "⬆ Upload adds orders that were not sent from this system. Choose the tour, then the CSV or .xlsx file. Orders already in the list are skipped unless you tick Insert anyway. Nothing is sent to guests.",
                "📣 Broadcast sends one message to many guests: pick the tours, General (everyone on those tours) or MTLV, the message and the channel. Untick anyone who should not get it.",
              ]}
              warning="If the list does not load, click ↻ Refresh or reload the page. If it still fails, take a screenshot and tell Annie."
            />
          </>
        )}
      </div>

      {broadcastOpen && date ? (
        <BroadcastDialog
          theme="tour"
          module="tour"
          templateSet="tour"
          audience="mtlv"
          tourDate={date}
          tours={toursOnDate(allRows, meta)}
          candidates={broadcastCandidates(allRows)}
          onClose={() => setBroadcastOpen(false)}
          onSent={() => void load(dateRef.current, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}

      {uploadOpen && date ? (
        <TourUploadDialog
          tourDate={date}
          tourTypes={tourTypes}
          onClose={() => setUploadOpen(false)}
          onInserted={() => void load(dateRef.current, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}

      {lunchRow ? (
        <LunchDialog
          key={lunchRow.id}
          row={lunchRow}
          hasBeef={meta.hasBeef(lunchRow.tour_type)}
          onClose={() => setLunchId(null)}
          onSaved={() => void load(dateRef.current, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}

      {conversationRow ? (
        <ConversationModal
          key={conversationRow.id}
          theme="tour"
          target={{
            bookingId: conversationRow.id,
            orderNumber: conversationRow.order_number,
            guestName: conversationRow.guest_name || conversationRow.first_name,
            phone: conversationRow.phone,
            email: conversationRow.email,
            smsBadge: smsBadgeOf(conversationRow),
            emailBadge: emailBadgeOf(conversationRow),
            actionTakenBy: conversationRow.action_taken_by,
          }}
          // 读这单所有线的对话、写的记成 tour（同旧页面）。
          source={{ kind: "order", line: "tour", readAllLines: true }}
          onClose={() => setConversationId(null)}
          onChanged={() => void load(dateRef.current, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}
    </main>
  );
}

/** 旧页面 .topbar::before 的两团亮光。 */
const TOPBAR_GLOW =
  "radial-gradient(circle at 80% 30%, rgba(255,255,255,0.12), transparent 40%), url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='64'%3E%3Cellipse cx='700' cy='80' rx='320' ry='90' fill='rgba(255,255,255,0.04)'/%3E%3Cellipse cx='820' cy='20' rx='120' ry='60' fill='rgba(255,255,255,0.06)'/%3E%3C/svg%3E\") right center / auto 100% no-repeat";

/** 旧页面 .back-btn（顶栏里的 ← Back；ops 的 Send 也用它）。 */
const TOPBAR_BTN =
  "rounded-md border-[0.5px] border-white/35 px-2.5 py-1 text-[12px] text-white/80 no-underline hover:border-white/70 hover:text-white";

/** 旧页面 .btn：白底绿字。 */
const BTN =
  "inline-flex cursor-pointer items-center gap-[5px] rounded-lg border border-[#d0e0d4] bg-white px-[13px] py-[5px] font-[inherit] text-[12px] font-semibold text-[#2f5e46] no-underline shadow-[0_1px_4px_rgba(26,58,42,0.07)] hover:border-[#4f7f62] hover:bg-[#d4e8d8] disabled:opacity-60";

/** 旧页面 .btn.btn-green：深绿渐变白字。 */
const GREEN_BTN =
  "inline-flex cursor-pointer items-center gap-[5px] rounded-lg border-none bg-[linear-gradient(135deg,#2f5e46,#1a3a2a)] px-[13px] py-[5px] font-[inherit] text-[12px] font-semibold text-white shadow-[0_4px_12px_rgba(47,94,70,0.25)] hover:bg-[linear-gradient(135deg,#286645,#162e20)] disabled:opacity-60";

/** 旧页面 .btn-nav：30px 白色方块的 ‹ ›。 */
const NAV_BTN =
  "flex size-[30px] cursor-pointer items-center justify-center rounded-lg border border-[#d0e0d4] bg-white text-[15px] text-[#2f5e46] shadow-[0_1px_4px_rgba(26,58,42,0.07)] hover:bg-[#d4e8d8] disabled:opacity-60";

function TourPillButton({
  active,
  label,
  replied,
  total,
  onClick,
}: {
  active: boolean;
  label: string;
  replied: number;
  total: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title="Orders that replied / all orders"
      className={cn(
        "cursor-pointer rounded-full border px-[13px] py-[5px] text-[12px] font-semibold whitespace-nowrap",
        active
          ? "border-transparent bg-[linear-gradient(135deg,#2f5e46,#1a3a2a)] text-white shadow-[0_3px_10px_rgba(47,94,70,0.25)]"
          : "border-[#d0e0d4] bg-white/85 text-[#2f5e46] shadow-[0_1px_3px_rgba(26,58,42,0.06)] hover:border-[#4f7f62] hover:bg-[#d4e8d8]",
      )}
    >
      {label}
      <span
        className={cn(
          "ml-1 text-[11px] tabular-nums",
          active ? "opacity-80" : "opacity-75",
        )}
      >
        {replied}/{total}
      </span>
    </button>
  );
}

function StatCard({
  label,
  value,
  valueClass,
  title,
  active,
  onClick,
}: {
  label: string;
  value: number | string | undefined;
  valueClass?: string;
  title?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div
        className={cn(
          "text-[22px] leading-[1.2] font-extrabold text-[#1f2d25]",
          valueClass,
        )}
      >
        {value ?? "—"}
      </div>
      <div className="mt-0.5 text-[11px] font-medium text-[#6b7d72]">
        {label}
      </div>
    </>
  );
  const cls = cn(
    "flex min-w-[80px] cursor-pointer flex-col justify-center rounded-[12px] border px-5 py-2.5 text-center shadow-[0_2px_8px_rgba(26,58,42,0.07)] transition-[box-shadow,border-color] duration-150 hover:border-[#4f7f62] hover:shadow-[0_4px_14px_rgba(26,58,42,0.12)]",
    active
      ? "border-[1.5px] border-[#2f5e46] bg-[#d4e8d8]"
      : "border-[#d0e0d4] bg-white/90",
  );
  return onClick ? (
    <button
      type="button"
      aria-pressed={!!active}
      title={title ?? `Show ${label}`}
      onClick={onClick}
      className={cls}
    >
      {body}
    </button>
  ) : (
    <div title={title} className={cls}>
      {body}
    </div>
  );
}

/** 当天发过的群发（同旧页面 #broadcast-panel：奶油色框，点一条展开正文）。 */
function BroadcastPanel({ items }: { items: BroadcastLogEntry[] }) {
  return (
    <section className="mb-2.5 overflow-hidden rounded-lg border border-[#f0d080] bg-[#fffbea]">
      <h2 className="bg-[#fff3cd] px-3 py-1.5 text-[11px] font-bold text-[#7a4f00]">
        📣 Broadcasts sent for this date ({items.length})
      </h2>
      {items.map((b) => (
        <details key={b.id} className="group border-t border-[#f0dfae]">
          <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-2 px-3 py-[7px] text-[10px] text-[#8a6d1f] [&::-webkit-details-marker]:hidden">
            <span className="text-[9px] group-open:hidden">▶</span>
            <span className="hidden text-[9px] group-open:inline">▼</span>
            <span className="text-[11px] font-bold text-[#7a4f00]">
              {b.template_name || "Custom message"}
            </span>
            <span>{b.created_at}</span>
            <span>· {b.sent_by}</span>
          </summary>
          <p className="px-3 pb-2 text-[11px] leading-[1.5] whitespace-pre-wrap text-[#4a3a1a]">
            {b.message_body}
          </p>
        </details>
      ))}
    </section>
  );
}
