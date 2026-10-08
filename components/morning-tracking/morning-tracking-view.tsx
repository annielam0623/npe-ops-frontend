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
    // 整页照旧页面 tracking_morning.html（不套站点外框）：深色底 #0d1b2e、56px 顶栏、IBM Plex Sans。
    <main
      className={cn(
        trackingFont.className,
        "min-h-screen bg-[#0d1b2e] leading-[normal] text-[#e0eaf6]",
      )}
    >
      <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-white/[.08] bg-[#0a1628] px-6">
        <div className="flex items-center gap-3.5">
          <Link
            href="/dashboard"
            className="rounded-md border border-white/15 px-2.5 py-1 text-[12px] text-[#7a9bbe] no-underline hover:border-white/30 hover:text-white"
          >
            ← Back
          </Link>
          <h1 className="text-[17px] font-bold text-white">
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

      <div className="w-full px-6 py-5">
        {state.kind === "forbidden" ? (
          <TrackingNotice dark>
            <p className="font-semibold text-white">Staff access required</p>
            <p className="mt-1">This page is for back-office staff only.</p>
          </TrackingNotice>
        ) : (
          <>
            <div className="mb-[18px] flex items-center gap-2">
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
              {date ? (
                <span className="ml-1 text-[12px] text-[#7a9bbe]">
                  {formatYmd(date)}
                </span>
              ) : null}
            </div>

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

            {drivers.length ? (
              <div
                role="group"
                aria-label="Filter by driver"
                className="mb-[18px] flex flex-wrap gap-1.5"
              >
                <DriverPill
                  active={!activeDriver}
                  onClick={() => setDriver("")}
                >
                  All{" "}
                  <span className="text-[11px] opacity-70">
                    {allRows.length}
                  </span>
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
              className="mb-5 flex flex-wrap gap-2.5"
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

            <section className="overflow-hidden rounded-[12px] border border-white/[.08] bg-[#1a2f4a]">
              <div className="flex items-center justify-between border-b border-white/[.08] bg-[#0f2035] px-4 py-3">
                <h2 className="text-[13px] font-semibold text-[#7ab3e0]">
                  Check-in Log
                </h2>
              </div>
              <div className="overflow-x-auto">
                <div className="mb-1 flex flex-wrap justify-between gap-x-4 gap-y-1 px-0.5 text-[11px] text-[#aaa]">
                  <span className="font-semibold text-[#5ba3d9]">
                    Click a Bus # to see live tracking (opens Samsara in a new
                    tab)
                  </span>
                  <span className="ml-auto">
                    ⇆ Drag column headers to reorder
                  </span>
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
              </div>
            </section>
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
            'Guest Viewed shows when that guest opened their tracking link today. "—" means they have not clicked it yet. If the van changed after that, you\'ll see "Wrong bus — resend link" in red: that guest is still looking at the old van and needs a fresh text with the new van number.',
            "Click a Notes or WhatsApp cell to read and reply: tick SMS to guest or Email to guest, click Send →.",
            "When a message is handled, click ✓ Mark as actioned (or Take action in the table).",
            "The whole list refreshes every minute until the cut-off. Click ↻ Refresh any time. ⬇ Export downloads the day.",
            "Drag a column header to move it. The order is saved to your account and is the same as on the old admin page.",
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
          onChanged={() => void load(dateRef.current, true)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}
    </main>
  );
}

/** 旧页面 .btn：深蓝底、浅蓝字。 */
const BTN =
  "inline-flex cursor-pointer items-center gap-[5px] rounded-[7px] border border-white/15 bg-[#1a2f4a] px-3.5 py-1.5 text-[12px] text-[#a0c0e0] no-underline transition-colors hover:bg-[#1e3a5f] hover:text-white disabled:opacity-60";

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
      className="min-w-[100px] rounded-[10px] border border-white/[.08] bg-[#1a2f4a] px-5 py-3 text-center"
    >
      <div
        className={cn(
          "text-[26px] font-bold text-white tabular-nums",
          valueClass,
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-[#7a9bbe]">{label}</div>
    </div>
  );
}
