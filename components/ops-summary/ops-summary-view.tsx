"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  FILTER_INPUT_CLASS,
  FILTER_PRIMARY_BUTTON_CLASS,
  Segmented,
} from "@/components/ui/filter-bar";
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
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            System
          </span>
          <h1 className="text-2xl font-semibold text-stone-900">
            Operations Summary
          </h1>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Range"
            value={range}
            options={RANGES}
            onChange={chooseRange}
          />
          {range === "custom" ? (
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
              <input
                type="date"
                aria-label="From"
                value={custom.from}
                onChange={(e) =>
                  setCustom((c) => ({ ...c, from: e.target.value }))
                }
                className={FILTER_INPUT_CLASS}
              />
              –
              <input
                type="date"
                aria-label="To"
                value={custom.to}
                onChange={(e) =>
                  setCustom((c) => ({ ...c, to: e.target.value }))
                }
                className={FILTER_INPUT_CLASS}
              />
              <button
                type="button"
                onClick={applyCustom}
                className={FILTER_PRIMARY_BUTTON_CLASS}
              >
                Apply
              </button>
              {customError ? (
                <span role="alert" className="text-xs text-red-700">
                  {customError}
                </span>
              ) : customPending ? (
                <span className="text-xs text-amber-700">
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

        <details className="max-w-3xl rounded-lg border border-sky-200 bg-sky-50 px-5 py-4 text-sm leading-relaxed text-stone-700">
          <summary className="cursor-pointer font-semibold text-sky-900">
            📖 How to use — Operations Summary
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Pick Today, This Week, This Month, or Custom (both dates, then
              Apply).
            </li>
            <li>
              Messages are counted by the day they were sent, not the tour date.
            </li>
            <li>
              Send Statistics: sent, success and failed for each module and
              channel.
            </li>
            <li>Guest Response: how many guests answered, for each module.</li>
          </ol>
        </details>
      </div>
    </main>
  );
}

/** avg 为 null 时不写（旧页面 0 也不写；0 小时是真实值，照写）。 */
function withAvg(pctValue: number, avg: number | null): string {
  return avg === null ? `${pctValue}%` : `${pctValue}% avg ${avg}h`;
}

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
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold tracking-wide text-stone-500 uppercase">
        {title}
      </h2>
      {state.kind === "loading" ? (
        <p className="text-sm text-stone-400">Loading...</p>
      ) : state.kind === "error" ? (
        <p role="alert" className="text-sm text-red-700">
          Failed to load: {state.message}
        </p>
      ) : (
        children(state.data)
      )}
    </section>
  );
}

function StatGrid({
  items,
}: {
  items: { label: string; value: number; sub?: string; color?: string }[];
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
      {items.map((i) => (
        <div
          key={i.label}
          className="rounded-lg border border-stone-200 bg-white px-4 py-3"
        >
          <div className="text-xs text-stone-500">{i.label}</div>
          <div
            className={cn("mt-1 text-[22px] font-medium tabular-nums", i.color)}
          >
            {i.value.toLocaleString("en-US")}
          </div>
          {i.sub ? <div className="text-xs text-stone-500">{i.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}

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
    return <p className="text-sm text-stone-500">No data</p>;
  }
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {modules.map(({ mod, channels }) => {
        const total = channels.reduce((s, [, c]) => s + c.total, 0);
        const success = channels.reduce((s, [, c]) => s + c.success, 0);
        return (
          <div
            key={mod}
            className="rounded-lg border border-stone-200 bg-white px-4 py-3"
          >
            <div className="mb-2 text-sm font-semibold text-stone-900">
              {MODULE_LABELS[mod] ?? mod}{" "}
              <span className="font-normal text-stone-500">
                {total.toLocaleString("en-US")} sent · {pct(success, total)}%
                success
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-stone-500">
                  <th className="py-1">Channel</th>
                  <th className="py-1">Sent</th>
                  <th className="py-1">Success</th>
                  <th className="py-1">Failed</th>
                  <th className="py-1">Rate</th>
                </tr>
              </thead>
              <tbody>
                {channels.map(([ch, c]) => {
                  const rate = pct(c.success, c.total);
                  return (
                    <tr key={ch} className="border-t border-stone-100">
                      <td className="py-1.5">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-semibold",
                            CHANNEL_TAG[ch] ?? "bg-stone-100 text-stone-600",
                          )}
                        >
                          {ch}
                        </span>
                      </td>
                      <td className="py-1.5 tabular-nums">
                        {c.total.toLocaleString("en-US")}
                      </td>
                      <td className="py-1.5 tabular-nums">
                        {c.success.toLocaleString("en-US")}
                      </td>
                      <td className="py-1.5 tabular-nums">
                        {c.failed.toLocaleString("en-US")}
                      </td>
                      <td className="py-1.5">
                        <span className="flex items-center gap-1.5 tabular-nums">
                          {rate}%
                          <span className="h-1.5 w-20 overflow-hidden rounded bg-stone-100">
                            <span
                              className="block h-full bg-[#3B6D11]"
                              style={{ width: `${rate}%` }}
                            />
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
