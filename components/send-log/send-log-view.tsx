"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import {
  type DateRange,
  DateRangePresets,
  presetRange,
  rangeLabel,
} from "@/components/ui/date-range-presets";
import {
  FILTER_BAR_CLASS,
  FILTER_BUTTON_CLASS,
  FILTER_COUNT_CLASS,
  FILTER_TEXT_BUTTON_CLASS,
  FilterDivider,
  FilterSearch,
  FilterSelect,
} from "@/components/ui/filter-bar";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { HowToUse } from "@/components/ui/how-to-use";
import { describeError, isStatus } from "@/lib/api-errors";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import {
  buildSendLogExportUrl,
  fetchSendLog,
  SEND_LOG_PAGE_SIZE,
} from "@/lib/send-log-api";
import { cn } from "@/lib/utils";
import type { SendLogPage, SendLogQuery } from "@/types";

import { laToday, MODULE_STYLES, MODULES, STATUS_OPTIONS } from "./config";
import { batchFromUrl, SendBatches } from "./send-batches";
import { ErrorsTable, SendLogTable } from "./send-log-table";

type ViewState =
  | { kind: "loading"; previous: SendLogPage | null }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: SendLogPage };

function initialQuery(): SendLogQuery {
  return {
    from: "",
    to: "",
    module: "",
    channel: "",
    status: "",
    mtlv: false,
    orderNumber: "",
    page: 1,
  };
}

/** 卡片：Total（全部）/ 三个模块 / MTLV。 */
type CardKey = SendLogQuery["module"] | "mtlv";

export function SendLogView() {
  // from 为空表示还没在浏览器里算出洛杉矶的今天（避免服务端 / 浏览器不一致）。
  const [query, setQuery] = useState<SendLogQuery>(initialQuery);
  const [range, setRange] = useState<DateRange | null>(null);
  const [view, setView] = useState<ViewState>({
    kind: "loading",
    previous: null,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [orderDraft, setOrderDraft] = useState("");
  /** 发送页的 View this send 带 ?batch= 过来：那一批展开。 */
  const [targetBatch, setTargetBatch] = useState<number | null>(null);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const today = presetRange("today");
    setTargetBatch(batchFromUrl());
    setRange((r) => r ?? today);
    setQuery((q) => (q.from ? q : { ...q, from: today.from, to: today.to }));
  }, []);

  useEffect(() => {
    if (!query.from) {
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

  // 订单号边打边查：停 400ms 才发请求（同 Order Log）。
  useEffect(() => {
    const next = orderDraft.trim();
    const t = setTimeout(() => {
      setQuery((q) =>
        q.orderNumber !== next ? { ...q, orderNumber: next, page: 1 } : q,
      );
    }, 400);
    return () => clearTimeout(t);
  }, [orderDraft]);

  const data =
    view.kind === "ready"
      ? view.data
      : view.kind === "loading"
        ? view.previous
        : null;
  const today = query.from ? laToday() : "";
  const activeCard: CardKey = query.mtlv ? "mtlv" : query.module;
  const pages = data ? Math.ceil(data.total / SEND_LOG_PAGE_SIZE) : 0;
  /** 按订单号搜着（不限日期）。 */
  const searching = !!query.orderNumber;

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
            by date (Los Angeles time)
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
              active={activeCard}
              onSelect={(key) =>
                updateFilter(
                  key === "mtlv"
                    ? { module: "", mtlv: true }
                    : { module: key, mtlv: false },
                )
              }
            />

            <div className={FILTER_BAR_CLASS}>
              {range ? (
                <DateRangePresets
                  value={range}
                  max={today || undefined}
                  disabled={searching}
                  onChange={(r) => {
                    // 搜索时点日期：清掉搜索，回到按日期看。
                    setOrderDraft("");
                    setRange(r);
                    updateFilter({ from: r.from, to: r.to, orderNumber: "" });
                  }}
                />
              ) : null}
              <FilterSearch
                id="order-number"
                label="Search order number (all dates)"
                placeholder="Search order # (all dates)"
                value={orderDraft}
                onChange={setOrderDraft}
              />
              {searching ? (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                  Searching all dates
                </span>
              ) : null}
              <FilterDivider />
              <FilterSelect
                label="Module"
                value={query.module}
                onChange={(v) =>
                  updateFilter({ module: v as SendLogQuery["module"] })
                }
              >
                <option value="">All</option>
                {MODULES.map((m) => (
                  <option key={m} value={m}>
                    {MODULE_STYLES[m].label}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                label="Type"
                value={query.channel}
                onChange={(v) =>
                  updateFilter({ channel: v as SendLogQuery["channel"] })
                }
              >
                <option value="">All</option>
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
              </FilterSelect>
              <FilterSelect
                label="Status"
                value={query.status}
                onChange={(v) => updateFilter({ status: v })}
              >
                <option value="">All</option>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </FilterSelect>
              <button
                type="button"
                onClick={() => {
                  const r = presetRange("today");
                  setOrderDraft("");
                  setRange(r);
                  setQuery({ ...initialQuery(), from: r.from, to: r.to });
                }}
                className={FILTER_TEXT_BUTTON_CLASS}
              >
                Reset
              </button>
              <span className={FILTER_COUNT_CLASS}>
                {data ? `${data.total} records` : "— records"}
              </span>
            </div>

            {/* Send batches 只按日期列；搜订单号时先收起来，免得看成这一单的批次。 */}
            {query.from && !searching ? (
              <SendBatches
                from={query.from}
                to={query.to}
                target={targetBatch}
                onUnauthorized={redirectToLogin}
              />
            ) : null}

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
                {/* 导出只按日期范围和模块过滤（后端接口如此），与表格上的渠道 / 状态 / MTLV 筛选无关；
                    也不认订单号，所以搜索时关掉，免得以为导出的是搜索结果。 */}
                <a
                  aria-disabled={searching || undefined}
                  href={
                    query.from && !searching
                      ? buildSendLogExportUrl({
                          from: query.from,
                          to: query.to,
                          module: query.module,
                        })
                      : undefined
                  }
                  title={
                    searching
                      ? "Export works by date. Clear the search to export."
                      : `CSV of ${range ? rangeLabel(range) : "the selected dates"} and the selected module (ignores Type, Status and MTLV)`
                  }
                  className={cn(
                    FILTER_BUTTON_CLASS,
                    searching && "pointer-events-none opacity-50",
                  )}
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
                  <SendLogTable
                    rows={data.rows}
                    onMtlvClick={() => updateFilter({ module: "", mtlv: true })}
                  />
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
        <HowToUse
          title="How to use — Send Log"
          items={[
            "The page shows today's messages. For other days pick Yesterday, This Week, This Month, or Custom (both dates, then Apply).",
            "To find one order, type its number in the search box (part of it works too). The search covers all dates; the date buttons turn grey, Send batches is hidden and Export is off (it works by date). Clear the box (✕) or pick a date to go back.",
            "Click Tour Conf, Morning P/U, Tickets or MTLV to show only those. Total Sent shows all. Type and Status narrow it further.",
            "Email and SMS show each guest's result. A dash means that channel was not used.",
            "Failures are listed in the Errors box below the list.",
            "Click ⬇ Export to download the selected dates and module as a CSV (Type, Status and MTLV are not applied).",
            "Send batches lists each send from Tickets Reminder and Tour Confirmation (including Last Minute), newest first, for the dates you picked. The title shows when it was sent, the tour, the tour date, who sent it, and how many were sent, failed or skipped.",
            "Click a batch to open it: how many rows were in the file, whether each email and SMS was delivered, every message, and every skipped order with the reason. Click ↻ Refresh to update the delivery results. View this send on a send page opens its batch here.",
            "Not sent means those orders were never sent in this batch: the page lost contact, or the send stopped with an error. Wait a few minutes, then send again from the same page: orders already sent are skipped and never sent twice.",
          ]}
          warning="A failed message: reach the guest through the other channel."
        />
      </div>
    </main>
  );
}

function StatCards({
  data,
  active,
  onSelect,
}: {
  data: SendLogPage | null;
  active: CardKey;
  onSelect: (key: CardKey) => void;
}) {
  const cards: {
    key: CardKey;
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
    { key: "mtlv", label: "MTLV", value: data?.stats.mtlv, accent: "#b45309" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
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
