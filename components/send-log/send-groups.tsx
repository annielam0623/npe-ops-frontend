"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { fetchSendBatch, fetchSendLogGroupRows } from "@/lib/send-log-api";
import { cn } from "@/lib/utils";
import type {
  SendBatchDelivery,
  SendBatchDetail,
  SendBatchSummary,
  SendLogGroup,
  SendLogGroupRow,
  SendLogQuery,
} from "@/types";

import { isKnownModule } from "./config";
import { LOG_COLUMNS, LogRow, ModuleBadge, TH_CLASS } from "./send-log-table";

type GroupState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; detail: SendBatchDetail; rows: SendLogGroupRow[] };

/** 搜订单号时自动展开的组数上限（搜「CHD」这类很短的会命中很多组，不能一下子全打开）。 */
const AUTO_OPEN_MAX = 10;

/** 地址栏 ?batch=<id>（发送页的 View this send 带过来）。 */
export function batchFromUrl(): number | null {
  const v = new URLSearchParams(window.location.search).get("batch");
  return v && /^\d{1,15}$/.test(v) && Number(v) > 0 ? Number(v) : null;
}

/** 一组的明细（没在列表里的 ?batch= 那一组）当成组头。 */
function groupFromDetail(d: SendBatchDetail): SendLogGroup {
  return {
    batch_id: d.id,
    module: d.module,
    tour_type: d.tour_type,
    tour_label: d.tour_label,
    tour_date: d.tour_date,
    send_type: d.send_type,
    sent_by: d.sent_by,
    started_at: "",
    started_at_label: d.started_at,
    summary: d.summary,
    matched_rows: d.summary.sent + d.summary.failed,
    matched_orders: [],
  };
}

/**
 * G230（Annie 2026-11-01）：Send Log 整页按组——一次发送一组，新的在前，默认收起；点开先看小结，再看逐条。
 * 筛选 / 搜单号时组里只放符合的那几条，组头写「1 of 6 in this send match」（题 3 甲）；
 * 搜单号、或从发送页 View this send（?batch=）进来时，对应的组自动展开（题 4 甲）。
 * 父组件按筛选条件给 key：换筛选就重新来（展开的、取过的明细都清掉，matched 跟着筛选变）。
 */
export function SendGroups({
  groups,
  query,
  filtered,
  target,
  onUnauthorized,
  onMtlvClick,
}: {
  groups: SendLogGroup[];
  query: SendLogQuery;
  /** 有按行的筛选（订单号 / 渠道 / 状态 / MTLV）：组里只放符合的、组头写命中几条。 */
  filtered: boolean;
  target: number | null;
  onUnauthorized: () => void;
  onMtlvClick: () => void;
}) {
  const searching = !!query.orderNumber.trim();
  const [open, setOpen] = useState<ReadonlySet<number>>(
    () => new Set(target ? [target] : []),
  );
  const [states, setStates] = useState<Record<number, GroupState>>({});
  /** ?batch= 那一组不在这一页 / 这几天里：单独取来放最上面。 */
  const [extra, setExtra] = useState<SendLogGroup | null>(null);
  const scrolledRef = useRef(false);
  /** 每一组最近一次取明细的序号：连点 ↻ Refresh 时只认最后一次的结果。 */
  const seqRef = useRef<Map<number, number>>(new Map());

  const load = useCallback(
    async (id: number) => {
      const seq = (seqRef.current.get(id) ?? 0) + 1;
      seqRef.current.set(id, seq);
      const current = () => seqRef.current.get(id) === seq;
      setStates((d) => ({ ...d, [id]: { kind: "loading" } }));
      try {
        const [detail, rows] = await Promise.all([
          fetchSendBatch(id),
          fetchSendLogGroupRows(id, query),
        ]);
        if (!current()) return;
        setStates((d) => ({ ...d, [id]: { kind: "ready", detail, rows } }));
      } catch (error) {
        if (!current()) return;
        if (isStatus(error, 401)) onUnauthorized();
        else
          setStates((d) => ({
            ...d,
            [id]: { kind: "error", message: describeError(error) },
          }));
      }
    },
    [query, onUnauthorized],
  );

  // ?batch= 是挂载后才从地址栏读到的：读到就把那一组展开。
  useEffect(() => {
    if (target) setOpen((s) => (s.has(target) ? s : new Set(s).add(target)));
  }, [target]);

  // 搜单号：结果里的组自动展开（最多 AUTO_OPEN_MAX 组）。
  useEffect(() => {
    if (!searching) return;
    const ids = groups
      .slice(0, AUTO_OPEN_MAX)
      .map((g) => g.batch_id)
      .filter((id): id is number => id !== null);
    if (ids.length) setOpen((s) => new Set([...s, ...ids]));
  }, [groups, searching]);

  // ?batch= 那一组不在列表里（不在所选日期 / 不在这一页）：单独取来放最上面。搜单号时不加。
  const targetListed =
    !target || groups.some((g) => g.batch_id === target) || searching;
  useEffect(() => {
    if (targetListed || !target) return;
    const controller = new AbortController();
    fetchSendBatch(target, controller.signal)
      .then((one) => {
        if (controller.signal.aborted) return;
        setExtra(groupFromDetail(one));
      })
      .catch(() => {
        // 取不到（不存在 / 没权限）就算了，列表照常显示。
      });
    return () => controller.abort();
  }, [target, targetListed]);

  const shown = useMemo(
    () =>
      extra && !targetListed && extra.batch_id === target
        ? [extra, ...groups]
        : groups,
    [extra, targetListed, target, groups],
  );

  // 打开着的组：没取过明细就取。
  useEffect(() => {
    for (const g of shown)
      if (g.batch_id !== null && open.has(g.batch_id) && !states[g.batch_id])
        void load(g.batch_id);
  }, [shown, open, states, load]);

  // ?batch= 那一组：滚过去一次。
  useEffect(() => {
    if (!target || scrolledRef.current) return;
    const el = document.querySelector(`[data-batch="${target}"]`);
    if (el) {
      scrolledRef.current = true;
      el.scrollIntoView({ block: "start" });
    }
  }, [shown, target]);

  function toggle(id: number) {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (shown.length === 0) {
    return (
      <p className="p-6 text-center text-[12px] text-[#1a1a1a] night:text-white/35">
        No records found.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {LOG_COLUMNS.map((c) => (
              <th key={c} className={TH_CLASS}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        {shown.map((g, i) => {
          const id = g.batch_id;
          const isOpen = id !== null && open.has(id);
          const st = id !== null ? states[id] : undefined;
          return (
            <tbody
              key={id ?? `loose-${i}`}
              data-batch={id ?? undefined}
              className="text-[#1a1a1a] night:text-white/75"
            >
              <tr>
                <td
                  colSpan={LOG_COLUMNS.length}
                  className="border-b-[0.5px] border-black/[.08] p-0 night:border-white/10"
                >
                  <button
                    type="button"
                    aria-expanded={id !== null ? isOpen : undefined}
                    disabled={id === null}
                    onClick={() => id !== null && toggle(id)}
                    className={cn(
                      // 手机上表比屏宽：组头贴住左边、宽度不超过屏幕，不用左右拖也看得全。
                      "flex w-full cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1.5 px-2.5 py-[9px] text-left text-[12.5px] text-[#1a1a1a] disabled:cursor-default max-sm:sticky max-sm:left-0 max-sm:w-[calc(100vw-2rem)] night:text-white/90",
                      isOpen
                        ? "bg-[#fffaf0] night:bg-amber-400/10"
                        : "hover:bg-[#fafaf8] night:hover:bg-white/[.03]",
                      id !== null &&
                        id === target &&
                        "shadow-[inset_3px_0_0_#BA7517]",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "inline-block w-3 text-[#7c6a4a] transition-transform night:text-amber-200/70",
                        isOpen && "rotate-90",
                        id === null && "invisible",
                      )}
                    >
                      ▸
                    </span>
                    <span className="font-bold">
                      Sent at {g.started_at_label || "—"}
                    </span>
                    <GroupModule module={g.module} />
                    <span className="text-[#1a1a1a] night:text-white/55">
                      {g.tour_label || g.tour_type || "—"}
                      {g.tour_date ? ` · Tour date ${g.tour_date}` : ""} · by{" "}
                      {g.sent_by || "—"}
                    </span>
                    <Chips s={g.summary} />
                    {filtered ? (
                      <span
                        data-match
                        className="text-[11px] text-[#b45309] night:text-amber-200"
                      >
                        {g.matched_rows} of{" "}
                        {Math.max(
                          g.summary.sent + g.summary.failed,
                          g.matched_rows,
                        )}{" "}
                        in this send match
                      </span>
                    ) : null}
                  </button>
                </td>
              </tr>
              {isOpen ? (
                <GroupBody
                  state={st}
                  filtered={filtered}
                  searching={searching}
                  onRetry={() => {
                    if (id !== null) void load(id);
                  }}
                  onMtlvClick={onMtlvClick}
                />
              ) : null}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

/** 组头的模块：三个老模块用老标签（Last Minute 算团确认）；其他（早班、Farm-out、广播、回复客人等）先写 Other。 */
function GroupModule({ module }: { module: string }) {
  const m = module === "last_minute" ? "tour_confirmation" : module;
  if (isKnownModule(m)) return <ModuleBadge module={m} />;
  return (
    <span className="text-[11px] text-[#1a1a1a] night:text-white/55">
      Other
    </span>
  );
}

/** 组里每一行的底色和左边的线（preview：淡黄底、左边金线）。 */
const MEMBER =
  "[&>td:first-child]:pl-[22px] [&>td:first-child]:shadow-[inset_3px_0_0_#e7c88f]";
/** 底色和命中的黄底二选一（cn 不合并冲突的 class）。 */
const MEMBER_BG = "bg-[#fffdf8] night:bg-amber-400/[.04]";
/** 搜单号命中的行。 */
const HIT = "bg-[#FEF9C3] hover:bg-[#FEF9C3] night:bg-amber-300/15";
/** 小结那一格（跨整行；手机上贴住左边，不用左右拖）。 */
const SUM_TD =
  "border-b-[0.5px] border-black/[.05] bg-[#fffdf8] p-0 shadow-[inset_3px_0_0_#e7c88f] night:border-white/10 night:bg-amber-400/[.04]";
const SUM_BOX =
  "px-2.5 pt-2 pb-1.5 pl-[22px] text-[11.5px] leading-[1.7] text-[#1a1a1a] max-sm:sticky max-sm:left-0 max-sm:w-[calc(100vw-2rem)] night:text-white/75";

function GroupBody({
  state,
  filtered,
  searching,
  onRetry,
  onMtlvClick,
}: {
  state: GroupState | undefined;
  filtered: boolean;
  searching: boolean;
  onRetry: () => void;
  onMtlvClick: () => void;
}) {
  if (!state || state.kind === "loading") {
    return (
      <tr>
        <td colSpan={LOG_COLUMNS.length} className={SUM_TD}>
          <div className={SUM_BOX}>Loading…</div>
        </td>
      </tr>
    );
  }
  if (state.kind === "error") {
    return (
      <tr>
        <td colSpan={LOG_COLUMNS.length} className={SUM_TD}>
          <p
            role="alert"
            className={cn(SUM_BOX, "text-[#A32D2D] night:text-red-300")}
          >
            Failed to load this send: {state.message}{" "}
            <button type="button" onClick={onRetry} className="underline">
              Retry
            </button>
          </p>
        </td>
      </tr>
    );
  }
  const { detail, rows } = state;
  // 题 3 甲：有筛选时只放符合的那几条。
  const list = filtered ? rows.filter((r) => r.matched) : rows;
  return (
    <>
      <tr data-summary>
        <td colSpan={LOG_COLUMNS.length} className={SUM_TD}>
          <GroupSummary b={detail} onRefresh={onRetry} />
        </td>
      </tr>
      {list.length ? (
        list.map((r) => (
          <LogRow
            key={r.id}
            row={r}
            onMtlvClick={onMtlvClick}
            data-hit={searching && r.matched ? "" : undefined}
            className={cn(MEMBER, searching && r.matched ? HIT : MEMBER_BG)}
          />
        ))
      ) : (
        <tr>
          <td colSpan={LOG_COLUMNS.length} className={SUM_TD}>
            <div className={SUM_BOX}>
              {filtered
                ? "No messages in this send match."
                : "Nothing was sent in this send."}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function deliveryLine(c: SendBatchDelivery): string {
  return c.delivered + c.waiting + c.problem === 0
    ? "not used"
    : `${c.delivered} delivered · ${c.waiting} waiting for the carrier · ${c.problem} not delivered`;
}

/** 重发去哪一页（警告里写）。 */
function sendPage(module: string): string | null {
  if (module === "tickets_reminder") return "Tickets Reminder";
  if (module === "tour_confirmation" || module === "last_minute")
    return "Tour Confirmation";
  return null;
}

/** 组点开先看的一行小结（preview）：文件几行 · 邮件 / 短信送达 · ↻ Refresh；下面跳过的单和原因、没发出去的警告。 */
function GroupSummary({
  b,
  onRefresh,
}: {
  b: SendBatchDetail;
  onRefresh: () => void;
}) {
  const s = b.summary;
  const page = sendPage(b.module);
  return (
    <div className={SUM_BOX}>
      <div>
        {/* 单发、回复客人这类只有一条的，不写文件几行。 */}
        {s.file_rows > 1 ? (
          <>
            <b className="text-[#1a1a1a] night:text-white/90">
              {s.file_rows} rows in the file
            </b>
            {" · "}
          </>
        ) : null}
        📧 Email: {deliveryLine(s.email)} · 📱 SMS: {deliveryLine(s.sms)}
        <button
          type="button"
          onClick={onRefresh}
          className="ml-2 cursor-pointer rounded-[7px] border-[0.5px] border-black/15 bg-paper px-2 py-px text-[11.5px] text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/55"
        >
          ↻ Refresh
        </button>
      </div>
      {b.skipped.length ? (
        <div data-skips className="mt-0.5">
          Skipped:{" "}
          {b.skipped.map((x, i) => (
            <span key={i}>
              {i ? ", " : ""}
              <span className="font-medium text-[#378ADD] night:text-sky-300">
                {x.order_number || "—"}
              </span>
              {x.name ? ` ${x.name}` : ""} ({x.reason})
            </span>
          ))}
        </div>
      ) : null}
      {s.failed || s.not_sent ? (
        <p
          data-testid="batch-warn"
          className="my-1.5 rounded-lg border border-[#f0b4b4] bg-[#fdecec] px-3 py-1.5 text-[12px] leading-[1.6] text-[#7a1f1f] night:bg-red-500/10"
        >
          Some orders did not go out
          {s.not_sent
            ? ` (Not sent: the page lost contact before they were sent, or the send was stopped with an error${page ? ` on the ${page} page` : ""})`
            : ""}
          . If something really went wrong, wait a few minutes, then send again
          from {page ? `${page}: upload the file again` : "the same page"}.
          Orders already sent are skipped and never sent twice.
        </p>
      ) : null}
    </div>
  );
}

/** 旧页面 .chip。 */
const CHIP = "rounded-[10px] px-2 py-px text-[11px] font-semibold";

function Chips({ s }: { s: SendBatchSummary }) {
  return (
    <span className="flex flex-wrap gap-1" data-chips>
      <span
        className={cn(
          CHIP,
          "bg-[#EAF3DE] text-[#3B6D11] night:bg-emerald-400/10 night:text-emerald-300",
        )}
      >
        Sent {s.sent}
      </span>
      {s.failed ? (
        <span
          className={cn(
            CHIP,
            "bg-[#FCEBEB] text-[#A32D2D] night:bg-red-500/10 night:text-red-300",
          )}
        >
          Failed {s.failed}
        </span>
      ) : null}
      {s.skipped ? (
        <span
          className={cn(
            CHIP,
            "bg-[#f1efe8] text-[#1a1a1a] night:bg-white/[.04] night:text-white/65",
          )}
        >
          Skipped {s.skipped}
        </span>
      ) : null}
      {s.not_sent ? (
        <span
          className={cn(
            CHIP,
            "bg-[#E6F1FB] text-[#185FA5] night:bg-sky-400/[.08] night:text-sky-300",
          )}
        >
          Not sent {s.not_sent}
        </span>
      ) : null}
    </span>
  );
}
