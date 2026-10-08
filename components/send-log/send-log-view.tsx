"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type DateRange,
  DateRangePresets,
  presetRange,
  rangeLabel,
} from "@/components/ui/date-range-presets";
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
import {
  BTN_RESET,
  FILTER_BAR,
  LegacySearch,
  LegacySelect,
  PAGE_BTN,
  RECORDS_COUNT,
  TABLE_CARD,
  TABLE_HEADER,
  TABLE_TITLE,
} from "./legacy";
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
    <main className="text-stone-800">
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

          <div className={cn(FILTER_BAR, "mb-4")}>
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
            <LegacySearch
              id="order-number"
              label="Search order number (all dates)"
              placeholder="Search order # (all dates)"
              value={orderDraft}
              onChange={setOrderDraft}
              className="w-[200px]"
            />
            {searching ? (
              <span className="rounded-[10px] bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-semibold text-[#b45309]">
                Searching all dates
              </span>
            ) : null}
            <LegacySelect
              label="Module"
              value={query.module}
              onChange={(v) =>
                updateFilter({ module: v as SendLogQuery["module"] })
              }
            >
              <option value="">All</option>
              {MODULES.map((m) => (
                <option key={m} value={m}>
                  {MODULE_STYLES[m].optionLabel}
                </option>
              ))}
            </LegacySelect>
            <LegacySelect
              label="Type"
              value={query.channel}
              onChange={(v) =>
                updateFilter({ channel: v as SendLogQuery["channel"] })
              }
            >
              <option value="">All</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
            </LegacySelect>
            <LegacySelect
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
            </LegacySelect>
            <button
              type="button"
              onClick={() => {
                const r = presetRange("today");
                setOrderDraft("");
                setRange(r);
                setQuery({ ...initialQuery(), from: r.from, to: r.to });
              }}
              className={BTN_RESET}
            >
              Reset
            </button>
            <span className={RECORDS_COUNT}>
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
            <div className="mb-4">
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => setReloadKey((k) => k + 1)}
              >
                Failed to load the send log: {view.message}
              </ErrorBanner>
            </div>
          ) : null}

          <section className={TABLE_CARD}>
            <div className={TABLE_HEADER}>
              <h2 className={TABLE_TITLE}>📋 Send Log</h2>
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
                  BTN_RESET,
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
                <p className="p-6 text-center text-[12px] text-[#ccc]">
                  Loading…
                </p>
              ) : null}
            </div>
          </section>

          {data && pages > 1 ? (
            <nav
              aria-label="Pagination"
              className="mt-3.5 flex items-center gap-1.5"
            >
              <span className="text-[12px] text-[#aaa] tabular-nums">
                Page {query.page} of {pages}
              </span>
              <button
                type="button"
                disabled={query.page <= 1}
                onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}
                className={PAGE_BTN}
              >
                ← Prev
              </button>
              <button
                type="button"
                disabled={query.page >= pages}
                onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}
                className={PAGE_BTN}
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
          "The page shows today's messages. For other days: 📅 → Yesterday, This Week, This Month, or Custom (both dates, then Apply).",
          "To find one order, type its number in the search box (part of it works too). The search covers all dates; the 📅 date button turns grey, Send batches is hidden and Export is off (it works by date). Clear the box (✕) or pick a date to go back.",
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
    </main>
  );
}

/** 旧页面 .stat-card 的数字颜色。 */
const CARD_NUM_COLOR: Record<CardKey, string> = {
  "": "text-[#1a1a1a]",
  tour_confirmation: "text-[#3B6D11]",
  morning_pickup: "text-[#185FA5]",
  tickets_reminder: "text-[#BA7517]",
  mtlv: "text-[#b45309]",
};

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
  }[] = [
    { key: "", label: "Total Sent", value: data?.stats.total },
    ...MODULES.map((m) => ({
      key: m,
      label: MODULE_STYLES[m].cardLabel,
      value: data?.stats[m],
    })),
    { key: "mtlv", label: "MTLV", value: data?.stats.mtlv },
  ];
  return (
    <div className="mb-[18px] flex flex-wrap gap-2.5">
      {cards.map((card) => (
        <button
          key={card.key || "total"}
          type="button"
          aria-pressed={active === card.key}
          onClick={() => onSelect(card.key)}
          className={cn(
            "min-w-[100px] cursor-pointer rounded-[10px] border-[0.5px] bg-white px-5 py-3 text-center transition-shadow",
            active === card.key
              ? "border-[#1a1a1a] shadow-[0_0_0_2px_#1a1a1a]"
              : "border-black/10 hover:shadow-[0_2px_8px_rgba(0,0,0,0.12)]",
          )}
        >
          <div
            className={cn(
              "text-[22px] font-bold tabular-nums",
              CARD_NUM_COLOR[card.key],
            )}
          >
            {card.value ?? "—"}
          </div>
          <div className="mt-0.5 text-[11px] text-[#aaa]">{card.label}</div>
        </button>
      ))}
    </div>
  );
}
