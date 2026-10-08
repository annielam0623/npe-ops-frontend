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
import { fetchUserPref, saveUserPref } from "@/lib/user-prefs-api";
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
  SYSTEM_COLUMNS,
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
    const timer = setInterval(() => void load(date, true), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [date, load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  function updatePrefs(next: ColumnPrefs) {
    prefsTouchedRef.current = true;
    setPrefs(next);
    writePrefs(next);
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

  async function toggleAction(row: TicketsTrackingRow) {
    if (busyId !== null) {
      return;
    }
    setBusyId(row.id);
    setActionError(null);
    try {
      await toggleTakeAction(row.id, "tickets");
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
    // 整页照旧页面 tracking_tickets.html（不套站点外框）：浅灰底 #f0f4f8、88px 星空顶栏、IBM Plex Sans。
    <main
      className={cn(
        trackingFont.className,
        "min-h-screen bg-[#f0f4f8] text-[14px] leading-[normal] font-medium text-[#1a2a3a]",
      )}
    >
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#dde3ea] bg-white px-5 py-2.5 shadow-[0_1px_6px_rgba(26,42,60,0.06)]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-pressed={!!date && date === today}
                onClick={() => changeDate(laToday())}
                className="cursor-pointer rounded-[7px] border-none bg-[#1a3a5c] px-3.5 py-1.5 text-[13px] font-bold tracking-[.5px] text-white hover:bg-[#0f2440]"
              >
                Today
              </button>
              <button
                type="button"
                aria-pressed={!!date && date === tomorrow}
                onClick={() => changeDate(shiftYmd(laToday(), 1))}
                className="cursor-pointer rounded-[7px] border border-[#dde3ea] bg-[#f0f4f8] px-3.5 py-1.5 text-[13px] font-semibold text-[#4a6080] hover:border-[#c0cdd9] hover:bg-[#e2e8f0]"
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
                className="h-[30px] min-w-[150px] cursor-pointer rounded-[7px] border border-[#dde3ea] bg-white px-2.5 font-[inherit] text-[13px] font-bold text-[#1a3a5c] [&::-webkit-calendar-picker-indicator]:hidden"
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
            <span className="text-[12px] text-[#6c8097]">
              Auto-refreshes every minute.
            </span>
          </div>

          {state.kind === "error" || refreshError || actionError ? (
            <div className="px-5 pt-3">
              {state.kind === "error" ? (
                <TrackingBanner
                  actionLabel="Retry"
                  onAction={() => void load(date, false)}
                >
                  Could not load tickets: {state.message}
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
            </div>
          ) : null}

          {data ? (
            <div
              role="group"
              aria-label="Filter by tour"
              className="flex flex-wrap gap-1.5 border-b border-[#dde3ea] bg-white px-5 py-2"
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
            className="flex flex-wrap gap-2.5 px-5 py-3"
          >
            <StatCard
              label="Total Orders"
              value={stats?.orders}
              valueClass="text-[#1a3a5c]"
            />
            <StatCard
              label="YES"
              value={stats?.yes}
              valueClass="text-[#166534]"
            />
            <StatCard
              label="Reschedule"
              value={stats?.reschedule}
              valueClass="text-[#c97a00]"
            />
            <StatCard
              label="Pending"
              value={stats?.pending}
              valueClass="text-[#6c8097]"
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

          <div className="flex items-center justify-start gap-2 px-5 pt-2 pb-3">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="🔍  Search order #, name, phone…"
              aria-label="Search"
              className="box-border h-8 w-[240px] rounded-lg border border-[#cbd5e1] bg-white px-3 font-[inherit] text-[12px] text-[#1a1a1a] outline-none [&::-webkit-search-cancel-button]:appearance-none"
            />
            <ColumnPicker
              columns={SYSTEM_COLUMNS}
              prefs={prefs}
              headers={headers}
              onChange={updatePrefs}
              onReset={() => updatePrefs(defaultColumnPrefs())}
              note="Saved to your account."
              buttonClassName={cn(REFRESH_BTN, "h-8 px-3.5")}
              menuTop={36}
            />
            <a
              href={date ? buildTicketsExportUrl(date) : undefined}
              title="Everything for this date: every column of the uploaded manifest, then the status columns"
              className="inline-flex h-8 cursor-pointer items-center rounded-[7px] border border-[#378ADD] bg-transparent px-3.5 text-[13px] font-semibold text-[#85B7EB] no-underline hover:bg-[rgba(55,138,221,0.14)]"
            >
              ⬇ Download CSV
            </a>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              disabled={!date}
              title="Add orders that were not sent from this system"
              className="h-8 cursor-pointer rounded-[7px] border-none bg-[#378ADD] px-3.5 text-[13px] font-semibold text-white hover:bg-[#2b74c0] disabled:opacity-60"
            >
              ⬆ Upload
            </button>
            <button
              type="button"
              onClick={() => date && void load(date, false)}
              disabled={!date || state.kind === "loading"}
              className={cn(REFRESH_BTN, "h-8 px-3.5")}
            >
              ↻ Refresh
            </button>
            <span className="ml-1 text-[12px] whitespace-nowrap text-[#aaa]">
              {data
                ? `${filtered.length} ${filtered.length === 1 ? "record" : "records"}`
                : "0 records"}
            </span>
            <button
              type="button"
              onClick={() => setBroadcastOpen(true)}
              disabled={!data}
              className="ml-auto flex h-8 cursor-pointer items-center gap-[5px] rounded-[7px] border-none bg-[linear-gradient(135deg,#ffce21,#ee8e00)] px-4 text-[12px] font-bold text-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              📣 Broadcast
            </button>
          </div>

          {broadcasts.length ? (
            <div className="px-5 pb-2">
              <BroadcastPanel items={broadcasts} />
            </div>
          ) : null}

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
              <span className="ml-auto text-[11px] whitespace-nowrap text-[#b3d9f7]">
                ⇆ Drag column headers to reorder
              </span>
            </div>
          </div>
          <div className="overflow-x-auto px-5 pb-6">
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
          </div>

          <div className="px-5">
            <HowToUse
              title="How to use — Tickets Reminder Tracking"
              items={[
                "Pick the service date. Click a tour button to see one product only. The search box finds an order #, name or phone.",
                "To change a guest’s status, pick it in the Status column. It saves right away.",
                "Click a Notes or WhatsApp cell to read the guest’s messages and reply. Click Take action when it is handled.",
                "☰ Columns chooses what shows on the page. Untick a page column to hide it. Under From the uploaded file, tick any column of the manifest you uploaded to show it. Reset to default brings back the normal page. Your choice is saved to your account, so it follows you to another computer.",
                "Drag a column header to move it.",
                "⬇ Download CSV saves everything for this date, whatever columns are showing: every column of the uploaded manifest, then the status columns. Older orders have no manifest columns, so those cells are blank.",
                "⬆ Upload adds orders that were not sent from this system. Choose the product, then the CSV or .xlsx file. Orders already in the list are skipped unless you tick Insert anyway.",
              ]}
              warning="If the list does not load, click ↻ Refresh or reload the page. If it still fails, take a screenshot and tell Annie."
            />
          </div>
        </>
      )}

      {broadcastOpen && date ? (
        <BroadcastDialog
          theme="tickets"
          module="tickets"
          templateSet="tix"
          tourDate={date}
          tours={toursOnDate(allRows)}
          candidates={broadcastCandidates(allRows)}
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

/** 旧页面 .btn-nav：30px 白色方块的 ‹ ›。 */
const NAV_BTN =
  "flex size-[30px] cursor-pointer items-center justify-center rounded-[7px] border border-[#dde3ea] bg-white text-[16px] leading-none text-[#4a6080] hover:bg-[#f0f4f8] disabled:opacity-60";

/**
 * 旧页面的星空顶栏（.top-bar：渐变底、星星、右边山的剪影、底边白色弧线）。
 * ← Back 和 Logout 都照旧页面放；Back 回 ops 的 dashboard。
 */
function HeroHeader() {
  return (
    <div className="relative flex h-[88px] items-center gap-3.5 overflow-hidden bg-[linear-gradient(135deg,#040d1a_0%,#071428_35%,#0d2045_65%,#123366_100%)] px-6 text-white shadow-[0_6px_28px_rgba(0,0,0,0.45)]">
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
      <div className="relative z-[3] flex-1">
        <Link href="/dashboard" className={cn(HERO_BTN, "mr-3 no-underline")}>
          ← Back
        </Link>
        <h1 className="m-0 text-[20px] font-bold tracking-[1px] uppercase [text-shadow:0_2px_14px_rgba(95,168,255,0.35)]">
          Tickets Reminder Log
        </h1>
        <div className="mt-0.5 text-[13px] font-medium tracking-[.5px] text-[rgba(180,200,230,0.8)]">
          Stay on top of every ticket. Never miss a guest.
        </div>
      </div>
      <a href="/auth/logout" className={cn(HERO_BTN, "relative z-[3]")}>
        Logout
      </a>
    </div>
  );
}

/** 旧页面 .logout-btn（← Back 和 Logout 都是它）。 */
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
        "inline-flex h-14 min-w-[80px] cursor-pointer flex-col items-center justify-center rounded-lg border px-3.5 text-[13px] whitespace-nowrap transition-all duration-150",
        active
          ? "border-[#185FA5] bg-[rgba(24,95,165,0.25)] text-white"
          : "border-[#14395f] bg-[#f5f8fc] text-[#5c6f86] hover:border-[#1a3a5c] hover:bg-[#f0f4ff] hover:text-[#1a3a5c]",
      )}
    >
      {label}
      <span
        className={cn(
          "mb-0.5 text-[15px] font-bold text-[#14395f] tabular-nums",
          active && "bg-white/25",
        )}
      >
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
      className="flex min-w-[76px] flex-col items-center rounded-[10px] border-[1.5px] border-[#dde3ea] bg-white px-3.5 py-2 shadow-[0_1px_4px_rgba(26,42,60,0.06)]"
    >
      <div className={cn("text-[26px] leading-[1.1] font-bold", valueClass)}>
        {value ?? "—"}
      </div>
      <div className="mt-0.5 text-[12px] font-semibold tracking-[.5px] text-[#6c8097] uppercase">
        {label}
      </div>
    </div>
  );
}

/** 当天发过的群发（同旧页面 #broadcast-panel：奶油色框，点一条展开正文）。 */
function BroadcastPanel({ items }: { items: BroadcastLogEntry[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#f0d080] bg-[#fffbea]">
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
