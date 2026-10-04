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
import { ConversationModal } from "@/components/ui/conversation-modal";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { toggleTakeAction } from "@/lib/booking-notes-api";
import { isYmd, laToday, shiftYmd } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import {
  buildTicketsExportUrl,
  fetchTicketsBroadcasts,
  fetchTicketsTracking,
  updateTicketStatus,
} from "@/lib/tickets-tracking-api";
import { cn } from "@/lib/utils";
import type {
  BroadcastLogEntry,
  TicketsTracking,
  TicketsTrackingRow,
} from "@/types";

import { ColumnPicker } from "./column-picker";
import {
  broadcastCandidates,
  COLUMN_PREFS_KEY,
  type ColumnPrefs,
  computeStats,
  defaultColumnPrefs,
  emailBadgeOf,
  matchesSearch,
  orderRows,
  parseColumnPrefs,
  POLL_INTERVAL_MS,
  productPills,
  smsBadgeOf,
  sumPax,
  type SystemColumnKey,
  toursOnDate,
  uploadedHeaders,
  visibleColumns,
} from "./config";
import { TicketsTable } from "./tickets-table";
import { UploadDialog } from "./upload-dialog";

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: TicketsTracking };

/** WhatsApp 窗口倒计时自己走，不等 60 秒一轮。 */
const CLOCK_TICK_MS = 30_000;
/** 新消息提示条最多直接列几单。 */
const BANNER_MAX = 3;

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

const messageCount = (r: TicketsTrackingRow) => r.notes_count + r.wa_count;

export function TicketsTrackingView() {
  // date 为空表示还没在浏览器里算出要看哪天（避免服务端 / 浏览器不一致）。
  const [date, setDate] = useState("");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [broadcasts, setBroadcasts] = useState<BroadcastLogEntry[]>([]);
  // 自动刷新 / 静默重拉失败时不清空表格，只提示。
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState("");
  const [prefs, setPrefs] = useState<ColumnPrefs>(defaultColumnPrefs);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  /** 自动刷新时消息数变多的单（提示条）；关掉以后等下一次有新消息再出现。 */
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
    setPrefs(readPrefs());
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
    const timer = setInterval(() => void load(date, true), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [date, load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  function updatePrefs(next: ColumnPrefs) {
    setPrefs(next);
    writePrefs(next);
  }

  function moveColumn(from: SystemColumnKey, to: SystemColumnKey) {
    const order = prefs.order.filter((k) => k !== from);
    order.splice(order.indexOf(to), 0, from);
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

  async function toggleAction(row: TicketsTrackingRow) {
    if (busyId !== null) {
      return;
    }
    setBusyId(row.id);
    setActionError(null);
    try {
      await toggleTakeAction(row.id, "tickets");
      // 接口回的是用户名；重拉一次拿显示名，和其余行同一个口径。
      await load(date, true);
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
    try {
      await updateTicketStatus({
        orderNumber: row.order_number,
        serviceDate: row.tour_date,
        confirmation: value,
      });
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
        value === "cancel" && isStatus(error, 400)
          ? `Order ${row.order_number} was not changed: the system can't save Cancel yet. Please update it in the old admin for now.`
          : `Order ${row.order_number} was not changed: ${describeError(error)}`,
      );
    } finally {
      setBusyId(null);
    }
  }

  const data = state.kind === "ready" ? state.data : null;
  const allRows = useMemo(() => data?.rows ?? [], [data]);
  const pills = useMemo(() => productPills(allRows), [allRows]);
  const headers = useMemo(() => uploadedHeaders(allRows), [allRows]);
  const columns = visibleColumns(prefs, headers);
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
  const stats = data ? computeStats(filtered) : null;
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
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1700px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Link
              href="/dashboard"
              className="text-xs font-medium text-stone-500 hover:text-stone-800"
            >
              ← Dashboard
            </Link>
            <h1 className="text-2xl font-semibold text-stone-900">
              Tickets Reminder Log
            </h1>
            <p className="text-sm text-stone-500">
              Stay on top of every ticket. Never miss a guest.
            </p>
          </div>
        </header>

        {state.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Staff access required</p>
            <p className="mt-1">This page is for back-office staff only.</p>
          </Panel>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
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
                aria-label="Service date"
                value={date}
                onChange={(event) => changeDate(event.target.value)}
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
              <span className="ml-auto text-xs text-stone-500">
                Auto-refreshes every minute.
              </span>
            </div>

            {state.kind === "error" ? (
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => void load(date, false)}
              >
                Could not load tickets: {state.message}
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
                <ProductPill
                  active={!product}
                  label="Total Guests"
                  yesPax={sumPax(
                    allRows.filter((r) => r.confirmation_status === "yes"),
                  )}
                  totalPax={sumPax(allRows)}
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

            <section
              aria-label="Summary"
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
            >
              <StatCard label="Total Orders" value={stats?.orders} />
              <StatCard
                label="YES"
                value={stats?.yes}
                valueClass="text-emerald-700"
              />
              <StatCard
                label="Reschedule"
                value={stats?.reschedule}
                valueClass="text-amber-600"
              />
              <StatCard
                label="Pending"
                value={stats?.pending}
                valueClass="text-stone-500"
              />
              <StatCard label="Cancelled" value={stats?.cancelled} />
              <StatCard
                label="Response Rate"
                title="Replied / reached by email or SMS"
                value={
                  stats
                    ? stats.responseRate === null
                      ? "—"
                      : `${stats.responseRate}%`
                    : undefined
                }
              />
            </section>

            {broadcasts.length ? <BroadcastPanel items={broadcasts} /> : null}

            <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
              <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-stone-900">
                  Tickets Reminder Log
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
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search order #, name, phone…"
                  aria-label="Search"
                  className="w-64 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none"
                />
                <span className="text-xs whitespace-nowrap text-stone-500">
                  {data
                    ? `${filtered.length} ${filtered.length === 1 ? "record" : "records"}`
                    : ""}
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    ☰ Columns
                  </button>
                  <a
                    href={date ? buildTicketsExportUrl(date) : undefined}
                    title="Everything for this date: every column of the uploaded manifest, then the status columns"
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    ⬇ Download CSV
                  </a>
                  <button
                    type="button"
                    onClick={() => setUploadOpen(true)}
                    disabled={!date}
                    title="Add orders that were not sent from this system"
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    ⬆ Upload
                  </button>
                  <button
                    type="button"
                    onClick={() => setBroadcastOpen(true)}
                    disabled={!data}
                    className="rounded-md border border-orange-500 bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    📣 Broadcast
                  </button>
                  <button
                    type="button"
                    onClick={() => date && void load(date, false)}
                    disabled={!date || state.kind === "loading"}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    ↻ Refresh
                  </button>
                </div>
              </div>
              <TicketsTable
                rows={filtered}
                allRows={allRows}
                columns={columns}
                onMoveColumn={moveColumn}
                onOpenConversation={(row) => setConversationId(row.id)}
                onToggleAction={(row) => void toggleAction(row)}
                onChangeStatus={(row, value) => void changeStatus(row, value)}
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
          prefs={prefs}
          headers={headers}
          onChange={updatePrefs}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      {broadcastOpen && date ? (
        <BroadcastDialog
          module="tickets"
          templateSet="tix"
          tourDate={date}
          tours={toursOnDate(allRows)}
          candidates={broadcastCandidates(allRows)}
          onClose={() => setBroadcastOpen(false)}
          onSent={() => void load(date, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}

      {uploadOpen && date ? (
        <UploadDialog
          serviceDate={date}
          onClose={() => setUploadOpen(false)}
          onInserted={() => void load(date, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}

      {conversationRow ? (
        <ConversationModal
          key={conversationRow.id}
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
        "flex flex-col items-center rounded-lg border px-3 py-1.5 text-xs transition",
        active
          ? "border-stone-800 bg-stone-800 text-white"
          : "border-stone-300 bg-white text-stone-700 hover:border-stone-400",
      )}
    >
      <span className="font-semibold">{label}</span>
      <span className="tabular-nums opacity-80">
        {yesPax}/{totalPax}
      </span>
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
  value: number | string | undefined;
  valueClass?: string;
  title?: string;
}) {
  return (
    <div
      title={title}
      className="rounded-lg border border-stone-200 bg-white px-4 py-3"
    >
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
    <details className="max-w-3xl rounded-lg border border-stone-200 bg-white px-5 py-4 text-sm leading-relaxed text-stone-600">
      <summary className="cursor-pointer font-semibold text-stone-800">
        📖 How to use — Tickets Reminder Tracking
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Pick the service date. Click a tour button to see one product only.
          The search box finds an order #, name or phone.
        </li>
        <li>
          To change a guest&rsquo;s status, pick it in the Status column. It
          saves right away.
        </li>
        <li>
          Click a Notes or WhatsApp cell to read the guest&rsquo;s messages and
          reply. Click Take action when it is handled.
        </li>
        <li>
          ☰ Columns chooses what shows on the page. Untick a page column to
          hide it. Under From the uploaded file, tick any column of the manifest
          you uploaded to show it. Reset to default brings back the normal page.
          Your choice is kept in this browser only.
        </li>
        <li>Drag a column header to move it.</li>
        <li>
          ⬇ Download CSV saves everything for this date, whatever columns are
          showing: every column of the uploaded manifest, then the status
          columns. Older orders have no manifest columns, so those cells are
          blank.
        </li>
        <li>
          ⬆ Upload adds orders that were not sent from this system. Choose the
          product, then the CSV or .xlsx file. Orders already in the list are
          skipped unless you tick Insert anyway.
        </li>
      </ol>
      <p className="mt-3 border-t border-stone-200 pt-3">
        ⚠️ If the list does not load, click ↻ Refresh or reload the page. If it
        still fails, take a screenshot and tell Annie.
      </p>
    </details>
  );
}
