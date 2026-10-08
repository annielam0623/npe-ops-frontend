"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { HowToUse } from "@/components/ui/how-to-use";
import { describeError, isStatus } from "@/lib/api-errors";
import { isYmd } from "@/lib/la-date";
import {
  fetchMorningResponse,
  fetchSendStats,
  fetchTicketsResponse,
  fetchTourResponse,
  type OpsQuery,
} from "@/lib/ops-summary-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type {
  ChannelStats,
  MorningResponseStats,
  OpsRange,
  SendStats,
  TicketsResponseStats,
  TourResponseStats,
} from "@/types";

type Section<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

const RANGES: readonly { value: OpsRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

const MODULE_LABELS: Record<string, string> = {
  tour_confirmation: "Tour Confirmation",
  morning_pickup: "Morning Pickup",
  tickets_reminder: "Tickets Reminder",
};

const CHANNEL_TAG: Record<string, string> = {
  email: "bg-[#E6F1FB] text-[#185FA5]",
  sms: "bg-[#EAF3DE] text-[#3B6D11]",
  both: "bg-[#EEEDFE] text-[#534AB7]",
};

const pct = (part: number, total: number) =>
  total ? Math.round((part / total) * 100) : 0;

/**
 * 每一块单独拉、单独报错（旧页面一个接口失败四块都变成 Failed to load）。
 */
function useSection<T>(
  query: OpsQuery | null,
  fetcher: (q: OpsQuery, s?: AbortSignal) => Promise<T>,
  onUnauthorized: () => void,
): Section<T> {
  const [state, setState] = useState<Section<T>>({ kind: "loading" });
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetcher(query, controller.signal)
      .then((data) => setState({ kind: "ready", data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) {
          onUnauthorizedRef.current();
          return;
        }
        setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [query, fetcher]);
  return state;
}

export function OpsSummaryView() {
  const [range, setRange] = useState<OpsRange>("today");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [customError, setCustomError] = useState<string | null>(null);
  const [query, setQuery] = useState<OpsQuery | null>({ range: "today" });
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  const send = useSection<SendStats>(query, fetchSendStats, redirectToLogin);
  const tour = useSection<TourResponseStats>(
    query,
    fetchTourResponse,
    redirectToLogin,
  );
  const tickets = useSection<TicketsResponseStats>(
    query,
    fetchTicketsResponse,
    redirectToLogin,
  );
  const morning = useSection<MorningResponseStats>(
    query,
    fetchMorningResponse,
    redirectToLogin,
  );

  function chooseRange(next: OpsRange) {
    setRange(next);
    setCustomError(null);
    // Custom 要填好两个日期点 Apply 才查。
    if (next !== "custom") setQuery({ range: next });
  }

  function applyCustom() {
    if (!isYmd(custom.from) || !isYmd(custom.to)) {
      setCustomError("Fill in both dates.");
      return;
    }
    if (custom.from > custom.to) {
      setCustomError("The start date is after the end date.");
      return;
    }
    setCustomError(null);
    setQuery({ range: "custom", dateFrom: custom.from, dateTo: custom.to });
  }

  const customPending =
    range === "custom" &&
    (query?.range !== "custom" ||
      query.dateFrom !== custom.from ||
      query.dateTo !== custom.to);

  return (
    <main className="text-stone-800">
      {/* 旧页面 .os-controls：直接放在深色底上。 */}
      <div className="mb-6 flex flex-wrap items-center gap-2.5">
        <div
          role="group"
          aria-label="Range"
          className="flex overflow-hidden rounded-[7px] border-[0.5px] border-black/15"
        >
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              aria-pressed={range === r.value}
              onClick={() => chooseRange(r.value)}
              className={cn(
                "h-8 cursor-pointer px-3.5 text-[13px] transition-colors duration-100",
                range === r.value
                  ? "bg-[#1a1a1a] text-white"
                  : "bg-white text-[#555]",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        {range === "custom" ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              aria-label="From"
              value={custom.from}
              onChange={(e) =>
                setCustom((c) => ({ ...c, from: e.target.value }))
              }
              className={DATE_INPUT}
            />
            <span className="text-[13px] text-[#aaa]">to</span>
            <input
              type="date"
              aria-label="To"
              value={custom.to}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              className={DATE_INPUT}
            />
            {/* 旧后台 base.html 的 .btn（深色底上的按钮）。 */}
            <button
              type="button"
              onClick={applyCustom}
              className="inline-flex h-8 cursor-pointer items-center justify-center rounded-[10px] border border-white/10 bg-white/[.04] px-3.5 text-[13px] font-[650] text-white transition hover:bg-white/[.08]"
            >
              Apply
            </button>
            {customError ? (
              <span role="alert" className="text-[12px] text-[#fca5a5]">
                {customError}
              </span>
            ) : customPending ? (
              <span className="text-[12px] text-[#fcd34d]">
                Not applied yet — the numbers below are still for the previous
                range.
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      <Block title="Send Statistics" state={send}>
        {(data) => <SendStatsCards data={data} />}
      </Block>
      <Block title="Guest Response — Tour Confirmation" state={tour}>
        {(d) => (
          <StatGrid
            items={[
              { label: "Total Sent", value: d.total },
              {
                label: "YES",
                value: d.yes,
                sub: withAvg(d.pct_yes, d.avg_hours_yes),
                color: "text-[#3B6D11]",
              },
              {
                label: "Modify",
                value: d.modify,
                sub: withAvg(d.pct_modify, d.avg_hours_modify),
                color: "text-[#BA7517]",
              },
              {
                label: "No Reply",
                value: d.pending,
                sub: `${d.pct_pending}%`,
                color: "text-[#185FA5]",
              },
            ]}
          />
        )}
      </Block>
      <Block title="Guest Response — Tickets Reminder" state={tickets}>
        {(d) => (
          <StatGrid
            items={[
              { label: "Total Sent", value: d.total },
              {
                label: "Confirmed",
                value: d.yes,
                sub: `${d.pct_yes}%`,
                color: "text-[#3B6D11]",
              },
              {
                label: "Pending",
                value: d.pending,
                sub: `${d.pct_pending}%`,
                color: "text-[#185FA5]",
              },
            ]}
          />
        )}
      </Block>
      <Block title="Guest Response — Morning Pickup" state={morning}>
        {(d) => (
          <StatGrid
            items={[
              { label: "Total Sent", value: d.total },
              {
                label: "Checked In",
                value: d.checked_in,
                sub: `${d.pct_checked_in}%`,
                color: "text-[#3B6D11]",
              },
              {
                label: "Not Yet",
                value: d.not_yet,
                sub: `${d.pct_not_yet}%`,
                color: "text-[#185FA5]",
              },
            ]}
          />
        )}
      </Block>

      <HowToUse
        title="How to use — Operations Summary"
        items={[
          "Pick Today, This Week, This Month, or Custom (both dates, then Apply).",
          "Messages are counted by the day they were sent, not the tour date.",
          "Send Statistics: sent, success and failed for each module and channel.",
          "Guest Response: how many guests answered, for each module.",
        ]}
      />
    </main>
  );
}

/** 旧页面 .os-custom input */
const DATE_INPUT =
  "h-8 cursor-pointer rounded-[7px] border-[0.5px] border-black/15 bg-white px-2.5 text-[13px] text-[#1a1a1a] focus:outline-none";
/** 旧页面 .os-card */
const CARD =
  "mb-3.5 rounded-[10px] border-[0.5px] border-black/10 bg-white px-5 py-[18px]";
/** 旧页面 .os-loading（深色底上） */
const LOADING = "py-4 text-[13px] text-[#aaa]";

/** avg 为 null 时不写（旧页面 0 也不写；0 小时是真实值，照写）。 */
function withAvg(pctValue: number, avg: number | null): string {
  return avg === null ? `${pctValue}%` : `${pctValue}% avg ${avg}h`;
}

/** 旧页面 .os-section + .os-section-title。 */
function Block<T>({
  title,
  state,
  children,
}: {
  title: string;
  state: Section<T>;
  children: (data: T) => ReactNode;
}) {
  return (
    <section aria-label={title} className="mb-7">
      <h2 className="mb-3 text-[13px] font-semibold tracking-[0.06em] text-[#888] uppercase">
        {title}
      </h2>
      {state.kind === "loading" ? (
        <p className={LOADING}>Loading...</p>
      ) : state.kind === "error" ? (
        <p role="alert" className="py-4 text-[13px] text-[#fca5a5]">
          Failed to load: {state.message}
        </p>
      ) : (
        children(state.data)
      )}
    </section>
  );
}

/** 旧页面 .os-card 里的 .stat-grid / .stat-box。 */
function StatGrid({
  items,
}: {
  items: { label: string; value: number; sub?: string; color?: string }[];
}) {
  return (
    <div className={CARD}>
      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
        {items.map((i) => (
          <div key={i.label} className="rounded-lg bg-[#f9f8f6] px-3.5 py-3">
            <div className="mb-1 text-[12px] text-[#999]">{i.label}</div>
            <div
              className={cn(
                "text-[22px] font-medium tabular-nums",
                i.color ?? "text-[#1a1a1a]",
              )}
            >
              {i.value.toLocaleString("en-US")}
            </div>
            {i.sub ? (
              <div className="mt-0.5 text-[11px] text-[#aaa]">{i.sub}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 旧页面 .send-table th / td。 */
const TH =
  "border-b border-black/[.08] px-3 py-[7px] text-left font-semibold text-[#555]";
const TD = "border-b-[0.5px] border-black/5 px-3 py-[7px] text-[#1a1a1a]";

function SendStatsCards({ data }: { data: SendStats }) {
  const modules = Object.entries(data)
    .map(([mod, channels]) => ({
      mod,
      channels: Object.entries(channels).filter(([, c]) => c.total > 0) as [
        string,
        ChannelStats,
      ][],
    }))
    .filter((m) => m.channels.length);
  if (!modules.length) {
    return <p className={LOADING}>No data</p>;
  }
  return (
    <div>
      {modules.map(({ mod, channels }) => {
        const total = channels.reduce((s, [, c]) => s + c.total, 0);
        const success = channels.reduce((s, [, c]) => s + c.success, 0);
        return (
          <div key={mod} className={CARD}>
            <div className="mb-3.5 text-[12px] font-semibold tracking-[0.05em] text-[#888] uppercase">
              {MODULE_LABELS[mod] ?? mod}{" "}
              <span className="ml-2 text-[11px] font-normal tracking-normal text-[#aaa] normal-case">
                {total.toLocaleString("en-US")} sent · {pct(success, total)}%
                success
              </span>
            </div>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>Channel</th>
                  <th className={TH}>Sent</th>
                  <th className={TH}>Success</th>
                  <th className={TH}>Failed</th>
                  <th className={TH}>Rate</th>
                </tr>
              </thead>
              <tbody>
                {channels.map(([ch, c]) => {
                  const rate = pct(c.success, c.total);
                  return (
                    <tr key={ch} className="[&:last-child>td]:border-b-0">
                      <td className={TD}>
                        <span
                          className={cn(
                            "inline-block rounded-[10px] px-[7px] py-0.5 text-[11px] font-medium",
                            CHANNEL_TAG[ch] ?? "bg-[#f1efe8] text-[#5f5e5a]",
                          )}
                        >
                          {ch}
                        </span>
                      </td>
                      <td className={cn(TD, "tabular-nums")}>
                        {c.total.toLocaleString("en-US")}
                      </td>
                      <td className={cn(TD, "tabular-nums")}>
                        {c.success.toLocaleString("en-US")}
                      </td>
                      <td className={cn(TD, "tabular-nums")}>
                        {c.failed.toLocaleString("en-US")}
                      </td>
                      <td className={TD}>
                        {/* 旧页面 .rate-bar：长度 = 百分数 px（最长 80、最短 2），后面写百分数。 */}
                        <span className="flex items-center gap-2">
                          <span
                            className="block h-1.5 max-w-20 min-w-0.5 rounded-[3px] bg-[#3B6D11]"
                            style={{ width: `${rate}px` }}
                          />
                          <span className="text-[12px] whitespace-nowrap text-[#555] tabular-nums">
                            {rate}%
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
