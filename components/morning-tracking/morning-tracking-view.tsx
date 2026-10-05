"use client";

import { HowToUse } from "@/components/ui/how-to-use";
import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import {
  ConversationModal,
  type ConversationTarget,
} from "@/components/ui/conversation-modal";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { toggleTakeAction } from "@/lib/booking-notes-api";
import { isYmd, laMinuteOfDay, laToday, shiftYmd } from "@/lib/la-date";
import {
  buildMorningExportUrl,
  fetchMorningTracking,
} from "@/lib/morning-tracking-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { fetchUserPref, saveUserPref } from "@/lib/user-prefs-api";
import { cn } from "@/lib/utils";
import type { MorningTracking, MorningTrackingRow } from "@/types";

import {
  type ColumnKey,
  computeStats,
  DEFAULT_COLUMN_ORDER,
  emailBadgeOf,
  formatYmd,
  LOCAL_COLUMN_ORDER_KEY,
  matchesSearch,
  orderRows,
  parseColumnOrder,
  POLL_INTERVAL_MS,
  smsBadgeOf,
  summarizeDrivers,
} from "./config";
import { TrackingTable } from "./tracking-table";

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: MorningTracking };

/** WhatsApp 窗口倒计时自己走，不等 60 秒一轮。 */
const CLOCK_TICK_MS = 30_000;

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
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const redirectingRef = useRef(false);
  /** 只认最新一次请求的结果：换日期以后，旧日期晚到的响应丢掉。 */
  const requestSeqRef = useRef(0);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  // 要看哪天：地址栏 ?date=（dashboard 的消息卡片会带），否则洛杉矶的今天。
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("date");
    setDate(isYmd(fromUrl) ? fromUrl : laToday());
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
    void load(date, false);
  }, [date, load]);

  const data = state.kind === "ready" ? state.data : null;
  const endMinute = data?.tracking_window.end_minute ?? null;
  const endLabel = data?.tracking_window.end_label ?? "";

  // 自动刷新：只在看今天、且没过追踪窗口时（每轮都重新算「今天」和「几点」）。
  useEffect(() => {
    if (!date || endMinute === null) {
      return;
    }
    const timer = setInterval(() => {
      if (date === laToday() && laMinuteOfDay() < endMinute) {
        void load(date, true);
      } else {
        setNow(Date.now());
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
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
        if (remote) {
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
    setColumnOrder(order);
    writeLocalOrder(order);
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
    setDate(next);
  }

  async function toggleAction(row: MorningTrackingRow) {
    if (togglingId !== null) {
      return;
    }
    setTogglingId(row.id);
    setActionError(null);
    try {
      await toggleTakeAction(row.id);
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
      setTogglingId(null);
    }
  }

  const allRows = useMemo(() => data?.rows ?? [], [data]);
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

  const today = date ? laToday(new Date(now)) : "";
  const pollNotice = !data
    ? ""
    : date !== today
      ? "Auto-refresh is off for other dates."
      : endMinute !== null && laMinuteOfDay(new Date(now)) >= endMinute
        ? `Auto-refresh stopped at ${endLabel} — new replies show on the dashboard.`
        : `Auto-refreshes every minute until ${endLabel}.`;

  const placeholder =
    state.kind === "loading"
      ? "Loading…"
      : state.kind === "error"
        ? "Failed to load."
        : filtered.length === 0
          ? "No records found."
          : null;

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Link
              href="/dashboard"
              className="text-xs font-medium text-stone-500 hover:text-stone-800"
            >
              ← Dashboard
            </Link>
            <h1 className="text-2xl font-semibold text-stone-900">
              Morning Pickup Tracking
            </h1>
            <p className="text-sm text-stone-500">
              Who has checked in for today&rsquo;s pickup, and guest replies to
              the morning message (Los Angeles time)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={date ? buildMorningExportUrl(date) : undefined}
              title="Excel of the morning messages sent for this date"
              className={SECONDARY_BUTTON_CLASS}
            >
              ⬇ Export
            </a>
            <button
              type="button"
              onClick={() => date && void load(date, false)}
              disabled={!date || state.kind === "loading"}
              className={SECONDARY_BUTTON_CLASS}
            >
              ↻ Refresh
            </button>
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
                aria-label="Date"
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
              <button
                type="button"
                onClick={() => changeDate(laToday())}
                disabled={!date || date === today}
                className={SECONDARY_BUTTON_CLASS}
              >
                Today
              </button>
              {date ? (
                <span className="ml-1 text-sm font-medium text-stone-600">
                  {formatYmd(date)}
                </span>
              ) : null}
              {pollNotice ? (
                <span className="ml-auto text-xs text-stone-500">
                  {pollNotice}
                </span>
              ) : null}
            </div>

            {state.kind === "error" ? (
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => void load(date, false)}
              >
                Could not load check-ins: {state.message}
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

            {drivers.length ? (
              <div
                role="group"
                aria-label="Filter by driver"
                className="flex flex-wrap gap-2"
              >
                <DriverPill
                  active={!activeDriver}
                  onClick={() => setDriver("")}
                >
                  All <span className="opacity-60">{allRows.length}</span>
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
            ) : null}

            <section
              aria-label="Summary"
              className="grid grid-cols-2 gap-3 lg:grid-cols-4"
            >
              <StatCard label="Total" value={stats ? stats.total : "—"} />
              <StatCard
                label="Checked In"
                value={stats ? stats.checkedIn : "—"}
                valueClass="text-emerald-600"
              />
              <StatCard
                label="Pending"
                value={stats ? stats.pending : "—"}
                valueClass="text-orange-600"
              />
              <StatCard
                label="Check-in Rate"
                title="Checked in / successfully sent SMS"
                value={
                  stats ? (stats.rate === null ? "—" : `${stats.rate}%`) : "—"
                }
              />
            </section>

            <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
                <div className="flex flex-col">
                  <h2 className="text-sm font-semibold text-stone-900">
                    Check-in Log
                  </h2>
                  <span className="text-xs font-semibold text-[#185FA5]">
                    Click a Bus # to see live tracking (opens Samsara in a new
                    tab)
                  </span>
                  <span className="text-xs text-stone-400">
                    ⇆ Drag column headers to reorder
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search order #, name, phone…"
                    aria-label="Search"
                    className="w-64 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none"
                  />
                  <span className="text-xs whitespace-nowrap text-stone-500">
                    {data ? `${filtered.length} records` : ""}
                  </span>
                </div>
              </div>
              <TrackingTable
                rows={filtered}
                allRows={allRows}
                columnOrder={columnOrder}
                onReorder={reorderColumns}
                onOpenConversation={(row) =>
                  setConversation({
                    bookingId: row.id,
                    orderNumber: row.order_number,
                    guestName: row.name,
                    phone: row.phone,
                    email: row.email,
                    smsBadge: smsBadgeOf(row.sms_status),
                    emailBadge: emailBadgeOf(row.email_state),
                    actionTakenBy: row.action_taken_by,
                  })
                }
                onToggleAction={(row) => void toggleAction(row)}
                togglingId={togglingId}
                now={now}
                placeholder={placeholder}
              />
            </section>
          </>
        )}
        <HowToUse
          title="How to use — Morning Pickup Tracking"
          items={[
            "Pick the date (‹ ›, the date box or Today). Click a driver to see only their guests. The search box finds an order #, name or phone.",
            "Check-in shows ✓ Checked In or ⏳ Pending.",
            "Click a number in Bus # to see where that bus is now. Samsara opens in a new tab. A number you cannot click has no live map: it is not in Settings → Vehicles, or that vehicle has no Samsara link.",
            "Click a Notes or WhatsApp cell to read and reply: tick SMS to guest or Email to guest, click Send →.",
            "When a message is handled, click ✓ Mark as actioned (or Take action in the table).",
            "The whole list refreshes every minute until the cut-off. Click ↻ Refresh any time. ⬇ Export downloads the day.",
            "Drag a column header to move it. The order is saved to your account and is the same as on the old admin page.",
          ]}
          warning="Saved, but NOT delivered: the guest did not get it, reach them another way. Not sent: click Send → again."
        />
      </div>

      {conversation ? (
        <ConversationModal
          key={conversation.orderNumber}
          target={conversation}
          source={{ kind: "order", line: "morning" }}
          onClose={() => setConversation(null)}
          onChanged={() => void load(date, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}
    </main>
  );
}

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
        "rounded-full border px-3 py-1 text-sm transition",
        active
          ? "border-stone-800 bg-stone-800 text-white"
          : "border-stone-300 bg-white text-stone-700 hover:border-stone-400",
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
        {value}
      </div>
    </div>
  );
}
