"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import {
  buildSendLogExportUrl,
  fetchSendLog,
  SEND_LOG_PAGE_SIZE,
} from "@/lib/send-log-api";
import { cn } from "@/lib/utils";
import type { SendLogPage, SendLogQuery } from "@/types";

import {
  laToday,
  MODULE_STYLES,
  MODULES,
  shiftYmd,
  STATUS_OPTIONS,
} from "./config";
import { ErrorsTable, SendLogTable } from "./send-log-table";

type ViewState =
  | { kind: "loading"; previous: SendLogPage | null }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: SendLogPage };

const SELECT_CLASS =
  "rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none";

function initialQuery(): SendLogQuery {
  return { date: "", module: "", channel: "", status: "", page: 1 };
}

export function SendLogView() {
  // date 为空表示还没在浏览器里算出洛杉矶的今天（避免服务端 / 浏览器不一致）。
  const [query, setQuery] = useState<SendLogQuery>(initialQuery);
  const [view, setView] = useState<ViewState>({
    kind: "loading",
    previous: null,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    setQuery((q) => (q.date ? q : { ...q, date: laToday() }));
  }, []);

  useEffect(() => {
    if (!query.date) {
      return;
    }
    const controller = new AbortController();
    // 换筛选 / 翻页时保留上一页的数据，只把表格变淡，不闪成整页 Loading。
    setView((prev) => ({
      kind: "loading",
      previous:
        prev.kind === "ready"
          ? prev.data
          : prev.kind === "loading"
            ? prev.previous
            : null,
    }));
    fetchSendLog(query, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setView({ kind: "ready", data });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (isStatus(error, 401)) {
          redirectToLogin();
        } else if (isStatus(error, 403)) {
          setView({ kind: "forbidden" });
        } else {
          setView({ kind: "error", message: describeError(error) });
        }
      });
    return () => controller.abort();
  }, [query, reloadKey, redirectToLogin]);

  /** 改任何筛选条件都回到第 1 页。 */
  function updateFilter(patch: Partial<Omit<SendLogQuery, "page">>) {
    setQuery((q) => ({ ...q, ...patch, page: 1 }));
  }

  const data =
    view.kind === "ready"
      ? view.data
      : view.kind === "loading"
        ? view.previous
        : null;
  const today = query.date ? laToday() : "";
  const pages = data ? Math.ceil(data.total / SEND_LOG_PAGE_SIZE) : 0;

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            Notifications
          </span>
          <h1 className="text-2xl font-semibold text-stone-900">Send Log</h1>
          <p className="text-sm text-stone-500">
            Every tour confirmation, morning pickup and ticket reminder we sent,
            by day (Los Angeles time)
          </p>
        </header>

        {view.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Staff access required</p>
            <p className="mt-1">This page is for back-office staff only.</p>
          </Panel>
        ) : (
          <>
            <StatCards
              data={data}
              active={query.module}
              onSelect={(module) => updateFilter({ module })}
            />

            <div className="flex flex-wrap items-end gap-3 rounded-lg border border-stone-200 bg-white p-4">
              <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
                Date
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={query.date}
                    max={today || undefined}
                    required
                    onChange={(e) => {
                      // 清空或没填完整时不查询。
                      if (e.target.value)
                        updateFilter({ date: e.target.value });
                    }}
                    className={SELECT_CLASS}
                  />
                  <QuickDate
                    label="Today"
                    active={query.date === today}
                    onClick={() => updateFilter({ date: today })}
                  />
                  <QuickDate
                    label="Yesterday"
                    active={!!today && query.date === shiftYmd(today, -1)}
                    onClick={() => updateFilter({ date: shiftYmd(today, -1) })}
                  />
                </div>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
                Module
                <select
                  value={query.module}
                  onChange={(e) =>
                    updateFilter({
                      module: e.target.value as SendLogQuery["module"],
                    })
                  }
                  className={SELECT_CLASS}
                >
                  <option value="">All</option>
                  {MODULES.map((m) => (
                    <option key={m} value={m}>
                      {MODULE_STYLES[m].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
                Type
                <select
                  value={query.channel}
                  onChange={(e) =>
                    updateFilter({
                      channel: e.target.value as SendLogQuery["channel"],
                    })
                  }
                  className={SELECT_CLASS}
                >
                  <option value="">All</option>
                  <option value="EMAIL">Email</option>
                  <option value="SMS">SMS</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
                Status
                <select
                  value={query.status}
                  onChange={(e) => updateFilter({ status: e.target.value })}
                  className={SELECT_CLASS}
                >
                  <option value="">All</option>
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setQuery({ ...initialQuery(), date: laToday() })}
                className={SECONDARY_BUTTON_CLASS}
              >
                Reset
              </button>
              <span className="ml-auto self-center text-sm text-stone-500 tabular-nums">
                {data ? `${data.total} records` : "— records"}
              </span>
            </div>

            {view.kind === "error" ? (
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => setReloadKey((k) => k + 1)}
              >
                Failed to load the send log: {view.message}
              </ErrorBanner>
            ) : null}

            <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-stone-900">
                  Send Log
                </h2>
                {/* 导出只按日期和模块过滤（后端接口如此），与表格上的渠道 / 状态筛选无关。 */}
                <a
                  href={
                    query.date
                      ? buildSendLogExportUrl({
                          date: query.date,
                          module: query.module,
                        })
                      : undefined
                  }
                  title="CSV of the selected day and module (ignores Type / Status)"
                  className={SECONDARY_BUTTON_CLASS}
                >
                  ⬇ Export
                </a>
              </div>
              <div
                aria-busy={view.kind === "loading"}
                className={cn(
                  "transition-opacity",
                  view.kind === "loading" && data && "opacity-50",
                )}
              >
                {data ? (
                  <SendLogTable rows={data.rows} />
                ) : view.kind === "loading" ? (
                  <p className="px-4 py-10 text-center text-sm text-stone-400">
                    Loading...
                  </p>
                ) : null}
              </div>
            </section>

            {data && pages > 1 ? (
              <nav
                aria-label="Pagination"
                className="flex items-center justify-end gap-2 text-sm"
              >
                <span className="text-stone-500 tabular-nums">
                  Page {query.page} of {pages}
                </span>
                <button
                  type="button"
                  disabled={query.page <= 1}
                  onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}
                  className={SECONDARY_BUTTON_CLASS}
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  disabled={query.page >= pages}
                  onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}
                  className={SECONDARY_BUTTON_CLASS}
                >
                  Next →
                </button>
              </nav>
            ) : null}

            {data ? <ErrorsTable rows={data.rows} /> : null}
          </>
        )}
      </div>
    </main>
  );
}

function QuickDate({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm font-medium",
        active
          ? "border-stone-800 bg-stone-800 text-white"
          : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
      )}
    >
      {label}
    </button>
  );
}

function StatCards({
  data,
  active,
  onSelect,
}: {
  data: SendLogPage | null;
  active: SendLogQuery["module"];
  onSelect: (module: SendLogQuery["module"]) => void;
}) {
  const cards: {
    key: SendLogQuery["module"];
    label: string;
    value: number | undefined;
    accent: string;
  }[] = [
    {
      key: "",
      label: "Total Sent",
      value: data?.stats.total,
      accent: "#57534e",
    },
    ...MODULES.map((m) => ({
      key: m,
      label: MODULE_STYLES[m].cardLabel,
      value: data?.stats[m],
      accent: MODULE_STYLES[m].accent,
    })),
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((card) => (
        <button
          key={card.key || "total"}
          type="button"
          aria-pressed={active === card.key}
          onClick={() => onSelect(card.key)}
          style={{ "--ac": card.accent } as CSSProperties}
          className={cn(
            "flex flex-col items-start rounded-lg border bg-white px-4 py-3 text-left transition-colors hover:border-[var(--ac)]",
            active === card.key
              ? "border-[var(--ac)] ring-1 ring-[var(--ac)]"
              : "border-stone-200",
          )}
        >
          <span className="text-2xl font-semibold text-[var(--ac)] tabular-nums">
            {card.value ?? "—"}
          </span>
          <span className="text-xs font-medium text-stone-500">
            {card.label}
          </span>
        </button>
      ))}
    </div>
  );
}
