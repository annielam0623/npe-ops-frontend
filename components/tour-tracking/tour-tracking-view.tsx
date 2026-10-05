"use client";

import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { BroadcastDialog } from "@/components/ui/broadcast-dialog";
import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { ColumnPicker } from "@/components/ui/column-picker";
import { ConversationModal } from "@/components/ui/conversation-modal";
import { ErrorBanner, Panel } from "@/components/ui/panel";
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
  const [pickerOpen, setPickerOpen] = useState(false);
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
    setVis(parseVis(readLocal(COLUMN_VIS_KEY)));
    const cached = parseLegacyOrder(readLocal(COLUMN_ORDER_CACHE_KEY));
    if (cached) setOrder(cached);
    const controller = new AbortController();
    // 列顺序跟着账号（tour_col_order，和旧页面共用、存列号）：本机缓存先画，账号里的到了再覆盖。
    // 没存过（null）或读不到就保持本机的（同旧页面）。
    fetchUserPref("tour_col_order", controller.signal)
      .then((raw) => {
        const remote = parseLegacyOrder(raw);
        if (remote) {
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
            .filter((r) => messageCount(r) > (previous.get(r.id) ?? 0))
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
    setOrder(next);
    const payload = toLegacyOrder(next);
    writeLocal(COLUMN_ORDER_CACHE_KEY, payload);
    saveUserPref("tour_col_order", payload).catch(() => {
      // 存不进账号时这台电脑上照样记得。
    });
  }

  function moveColumn(from: SystemColumnKey, to: SystemColumnKey) {
    const next = order.filter((k) => k !== from);
    next.splice(next.indexOf(to), 0, from);
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
      await load(date, true);
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
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Link
              href="/dashboard"
              className="text-xs font-medium text-stone-500 hover:text-stone-800"
            >
              ← Dashboard
            </Link>
            <h1 className="text-2xl font-semibold text-stone-900">
              Tour Confirmation Tracking
            </h1>
          </div>
          <Link
            href="/tour-confirmation/send"
            className={SECONDARY_BUTTON_CLASS}
          >
            Send
          </Link>
        </header>

        {state.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Staff access required</p>
            <p className="mt-1">This page is for back-office staff only.</p>
          </Panel>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label="Previous day"
                onClick={() => changeDate(shiftYmd(date, -1))}
                disabled={!date}
                className={cn(SECONDARY_BUTTON_CLASS, "px-3")}
              >
                ‹
              </button>
              <input
                type="date"
                aria-label="Tour date"
                value={date}
                onChange={(e) => changeDate(e.target.value)}
                className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none"
              />
              <button
                type="button"
                aria-label="Next day"
                onClick={() => changeDate(shiftYmd(date, 1))}
                disabled={!date}
                className={cn(SECONDARY_BUTTON_CLASS, "px-3")}
              >
                ›
              </button>
              <DayButton
                active={!!date && date === today}
                onClick={() => changeDate(laToday())}
              >
                Today
              </DayButton>
              <DayButton
                active={!!date && date === tomorrow}
                onClick={() => changeDate(shiftYmd(laToday(), 1))}
              >
                Tomorrow
              </DayButton>
              <span className="ml-auto text-xs text-stone-500">
                Auto-refreshes every minute.
              </span>
            </div>

            {typesError ? (
              <ErrorBanner>
                Could not load the tour list: {typesError} Tour buttons and
                lunch counts may be missing. Reload the page to try again.
              </ErrorBanner>
            ) : null}
            {state.kind === "error" ? (
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => void load(date, false)}
              >
                Could not load the tour list for this date: {state.message}
              </ErrorBanner>
            ) : null}
            {refreshError ? (
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => void load(date, true)}
              >
                Not updating — {refreshError}
              </ErrorBanner>
            ) : null}
            {actionError ? (
              <ErrorBanner
                actionLabel="Dismiss"
                onAction={() => setActionError(null)}
              >
                {actionError}
              </ErrorBanner>
            ) : null}

            {data ? (
              <div
                role="group"
                aria-label="Filter by tour"
                className="flex flex-wrap gap-2"
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

            <section aria-label="Summary" className="flex flex-wrap gap-3">
              <StatCard
                label="Total"
                value={stats?.total}
                active={!statusFilter}
                onClick={() => setStatusFilter("")}
              />
              <StatCard
                label="YES"
                value={stats?.yes}
                valueClass="text-emerald-700"
                active={statusFilter === "yes"}
                onClick={() => setStatusFilter("yes")}
              />
              <StatCard
                label="Modify"
                value={stats?.modify}
                valueClass="text-orange-600"
                active={statusFilter === "modify_req"}
                onClick={() => setStatusFilter("modify_req")}
              />
              <StatCard
                label="Pending"
                value={stats?.pending}
                valueClass="text-amber-600"
                active={statusFilter === "pending"}
                onClick={() => setStatusFilter("pending")}
              />
              <StatCard
                label="Cancel"
                value={stats?.cancel}
                valueClass="text-red-600"
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
              {stats?.lunch.map((g) => (
                <div
                  key={g.label}
                  data-lunch={g.label}
                  className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-2.5"
                >
                  <div className="text-xs font-semibold text-emerald-800">
                    {g.label}
                  </div>
                  <div className="mt-1 text-sm whitespace-nowrap text-stone-800 tabular-nums">
                    🦃 {g.turkey} · 🥗 {g.veggie}
                    {g.hasBeef ? ` · 🥩 ${g.beef}` : ""}
                  </div>
                </div>
              ))}
            </section>

            {broadcasts.length ? <BroadcastPanel items={broadcasts} /> : null}

            <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
              <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-stone-900">
                  Dashboard
                </h2>
                {bannerRows.length ? (
                  <span
                    role="status"
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800"
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
                        className="font-semibold underline hover:text-amber-950"
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
                      className="ml-1 text-sm leading-none hover:text-amber-950"
                    >
                      ×
                    </button>
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-stone-400">
                  ⇆ Drag column headers to reorder
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-2.5">
                <span className="text-xs whitespace-nowrap text-stone-500">
                  {data ? `${filtered.length} records` : "— records"}
                </span>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search order #, name, phone…"
                  aria-label="Search"
                  className="w-64 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none"
                />
                <select
                  aria-label="Status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm"
                >
                  {STATUS_FILTERS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <div className="ml-auto flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    ☰ Columns
                  </button>
                  <a
                    href={date ? buildTourExportUrl(date) : undefined}
                    title="Everything for this date: every column of the uploaded manifest, then the status columns"
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    ⬇ Download CSV
                  </a>
                  <button
                    type="button"
                    onClick={() => setUploadOpen(true)}
                    disabled={!date || !tourTypes.length}
                    title="Add orders that were not sent from this system"
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    ⬆ Upload
                  </button>
                  <button
                    type="button"
                    onClick={() => date && void load(date, false)}
                    disabled={!date || state.kind === "loading"}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    ↻ Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => setBroadcastOpen(true)}
                    disabled={!data}
                    className="rounded-md border border-orange-500 bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    📣 Broadcast
                  </button>
                </div>
              </div>
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
            </section>

            <HowToUse />
          </>
        )}
      </div>

      {pickerOpen ? (
        <ColumnPicker
          columns={SYSTEM_COLUMNS}
          prefs={vis}
          headers={headers}
          note="Hidden columns and uploaded-file columns are saved in this browser only. Column order (drag the headers) is saved to your account."
          onChange={updateVis}
          onReset={() => updateVis({ hide: [], file: [] })}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      {broadcastOpen && date ? (
        <BroadcastDialog
          module="tour"
          templateSet="tour"
          audience="mtlv"
          tourDate={date}
          tours={toursOnDate(allRows, meta)}
          candidates={broadcastCandidates(allRows)}
          onClose={() => setBroadcastOpen(false)}
          onSent={() => void load(date, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}

      {uploadOpen && date ? (
        <TourUploadDialog
          tourDate={date}
          tourTypes={tourTypes}
          onClose={() => setUploadOpen(false)}
          onInserted={() => void load(date, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}

      {lunchRow ? (
        <LunchDialog
          key={lunchRow.id}
          row={lunchRow}
          hasBeef={meta.hasBeef(lunchRow.tour_type)}
          onClose={() => setLunchId(null)}
          onSaved={() => void load(date, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}

      {conversationRow ? (
        <ConversationModal
          key={conversationRow.id}
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
          onChanged={() => void load(date, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}
    </main>
  );
}

function DayButton({
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
        "rounded-md border px-4 py-2 text-sm font-medium transition",
        active
          ? "border-stone-800 bg-stone-800 text-white"
          : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
      )}
    >
      {children}
    </button>
  );
}

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
        "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition",
        active
          ? "border-stone-800 bg-stone-800 text-white"
          : "border-stone-300 bg-white text-stone-700 hover:border-stone-400",
      )}
    >
      <span className="font-semibold">{label}</span>
      <span className="tabular-nums opacity-80">
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
      <div className="text-xs font-medium tracking-wide text-stone-500 uppercase">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold text-stone-900 tabular-nums",
          valueClass,
        )}
      >
        {value ?? "—"}
      </div>
    </>
  );
  const cls = cn(
    "min-w-[110px] rounded-lg border bg-white px-4 py-2.5 text-left",
    active ? "border-stone-800 ring-1 ring-stone-800" : "border-stone-200",
  );
  return onClick ? (
    <button
      type="button"
      aria-pressed={!!active}
      title={title ?? `Show ${label}`}
      onClick={onClick}
      className={cn(cls, "hover:border-stone-400")}
    >
      {body}
    </button>
  ) : (
    <div title={title} className={cls}>
      {body}
    </div>
  );
}

function BroadcastPanel({ items }: { items: BroadcastLogEntry[] }) {
  return (
    <section className="rounded-lg border border-orange-200 bg-orange-50/60 px-4 py-3">
      <h2 className="mb-2 text-sm font-semibold text-orange-900">
        📣 Broadcasts sent for this date ({items.length})
      </h2>
      <div className="flex flex-col gap-1.5">
        {items.map((b) => (
          <details
            key={b.id}
            className="rounded-md border border-orange-100 bg-white px-3 py-2 text-sm"
          >
            <summary className="cursor-pointer text-stone-800">
              <span className="font-semibold">
                {b.template_name || "Custom message"}
              </span>
              <span className="text-stone-500">
                {" "}
                · {b.created_at}
                {b.sent_by ? ` · ${b.sent_by}` : ""}
              </span>
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-stone-700">
              {b.message_body}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

function HowToUse() {
  return (
    <details className="max-w-3xl rounded-lg border border-[#d4e6c3] bg-[#f7f9f5] px-5 py-4 text-sm leading-relaxed text-[#4a5a3a]">
      <summary className="cursor-pointer font-semibold text-[#3B6D11]">
        📖 How to use — Tour Confirmation Tracking
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Pick the tour date with the arrows, the date box, Today or Tomorrow.
          Click a tour button to see one tour only.
        </li>
        <li>
          Click a number box (YES, Modify, Pending, Cancel) to see only those
          guests. Click Total to see everyone. The search box finds an order #,
          name or phone.
        </li>
        <li>
          To change a guest&rsquo;s status, pick it in the Status column, then
          click ✓ to save or ✕ to undo. Cancel also clears the lunch and the
          MTLV tickets.
        </li>
        <li>
          Click a lunch number (🦃 🥗 🥩) to edit the lunch selection. Only YES
          guests on tours with lunch have one.
        </li>
        <li>
          MTLV guests: 🏛️ MTLV shows how many tickets the guest asked for. Set
          🎟️ Tickets to Sent once you have sent them; it records who and when.
        </li>
        <li>
          Click a Notes or WhatsApp cell to read the guest&rsquo;s messages and
          reply. Click Take action when it is handled.
        </li>
        <li>
          ☰ Columns chooses what shows on the page. Untick a page column to
          hide it. Under From the uploaded file, tick any column of the manifest
          you uploaded to show it. Reset to default brings back the normal page.
          This choice is kept in this browser only.
        </li>
        <li>
          Drag a column header to move it. The order is saved to your account
          and is the same as on the old admin page.
        </li>
        <li>
          ⬇ Download CSV saves everything for this date, whatever columns are
          showing: every column of the uploaded manifest, then the status
          columns. Older orders have no manifest columns, so those cells are
          blank.
        </li>
        <li>
          ⬆ Upload adds orders that were not sent from this system. Choose the
          tour, then the CSV or .xlsx file. Orders already in the list are
          skipped unless you tick Insert anyway. Nothing is sent to guests.
        </li>
        <li>
          📣 Broadcast sends one message to many guests: pick the tours, General
          (everyone on those tours) or MTLV, the message and the channel. Untick
          anyone who should not get it.
        </li>
      </ol>
      <p className="mt-3 border-t border-[#d4e6c3] pt-3">
        ⚠️ If the list does not load, click ↻ Refresh or reload the page. If it
        still fails, take a screenshot and tell Annie.
      </p>
    </details>
  );
}
