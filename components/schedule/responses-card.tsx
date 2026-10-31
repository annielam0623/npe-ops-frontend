"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { shiftYmd } from "@/lib/la-date";
import {
  approveRequest,
  type ConfirmRequest,
  declineRequest,
  fetchWeekConfirmations,
  isUnavailable,
  type RequestSlot,
  type WeekConfirmations,
} from "@/lib/schedule-confirm-api";
import { formatRange } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import type {
  ScheduleEmployee,
  ScheduleShiftType,
  ScheduleSlot,
} from "@/types";

import {
  CARD,
  CARD_HEADER,
  DAY_LABELS,
  MUTED,
  personDotColor,
  shiftCardClass,
} from "./config";

const WHEN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});
const DEADLINE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
});

function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : WHEN.format(d);
}

function md(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

/** 同线上周表（week-grid.tsx）：130px 人名列 + 7 天。 */
const COLS = "grid-cols-[130px_repeat(7,minmax(118px,1fr))]";
const REQ_CARD =
  "border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.28)] text-[#fde68a]";
const SMALL_BTN =
  "cursor-pointer rounded-[5px] border px-2 py-px text-[10.5px] font-semibold disabled:opacity-50";

/** 还在走的请求：等对方（awaiting_peer）、等排班的人（pending）。 */
const OPEN_STATUSES = new Set(["awaiting_peer", "pending"]);

interface CellCard {
  key: string;
  shiftType: string;
  start: string;
  end: string;
  note: string;
  request?: ConfirmRequest;
}
interface SlotMark {
  ghost?: string;
  split?: { left: string; right: string; request: ConfirmRequest };
}

/**
 * 排班页里的「Responses」（周三确认）。G138 改版（Annie 2026-10-30「动手」，preview
 * https://claude.ai/artifact/X2bdxVr42yXA6CS8FEEiCc ③）：每人的回应 + 每条请求的状态；下面一张同线上周表的表，
 * 请求画成亮黄卡片（改天上、加班）或一分为二的格子（换班「Jing request / Lizzie original」），
 * 等排班的人处理的格子上 Approve / Decline（同意在前，Annie：「一般是accept之前，decline在后」）；
 * 换班还在等对方（awaiting_peer）时只写 Waiting for Lizzie，不能批。
 * 排班的人不收通知，只在这里看（Annie：「排版人和super admin只需要在管理界面看见他们的action就好」）。
 * 接口还没上线（404）、或这一周没发过确认时整块不显示，不报错。
 */
export function ResponsesCard({
  weekStart,
  canEdit,
  employees,
  slots,
  shiftTypes,
  onChanged,
  onUnauthorized,
  beforeEdit,
  onEdited,
  reloadKey = 0,
  onAnswers,
}: {
  weekStart: string;
  /**
   * 变了就重拉回应（G217 ef：Send to confirm 发送成功后，原来点 Looks good 的人被后端重置成 No answer；
   * 整周重拉不会重建这张卡，所以要单独通知）。
   */
  reloadKey?: number;
  /**
   * 每次读到回应都报上去：员工 id → answer（没读到 / 没这个功能 = 空表）。
   * 用在 Send to confirm 发送框：这个人当前是 Looks good 时提醒「发送会重置」（Annie 10-30 第 7b 条）。
   */
  onAnswers?: (answers: ReadonlyMap<number, string>) => void;
  canEdit: boolean;
  employees: ScheduleEmployee[];
  slots: ScheduleSlot[];
  shiftTypes: ScheduleShiftType[];
  /** Approve 之后要重拉这一周（班变了）。 */
  onChanged: () => void;
  onUnauthorized: () => void;
  /** 动手前先占住这一周（别人在改 ⇒ 返回 false、已弹提示）；没传就不占。 */
  beforeEdit?: () => Promise<boolean>;
  onEdited?: () => void;
}) {
  const [data, setData] = useState<WeekConfirmations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetchWeekConfirmations(weekStart, signal);
        if (signal?.aborted) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (signal?.aborted) return;
        setData(null);
        if (isUnavailable(e)) setError(null);
        else if (isStatus(e, 401)) onUnauthorized();
        else if (isStatus(e, 403)) setError(null);
        else setError(describeError(e));
      }
    },
    [weekStart, onUnauthorized],
  );

  useEffect(() => {
    onAnswers?.(
      new Map((data?.people ?? []).map((p) => [p.employee_id, p.answer])),
    );
  }, [data, onAnswers]);

  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load, reloadKey]);

  const act = useCallback(
    async (id: number, fn: (id: number) => Promise<unknown>) => {
      if (beforeEdit && !(await beforeEdit())) return;
      setBusyId(id);
      setActionError(null);
      try {
        await fn(id);
        onEdited?.();
        await load();
        onChanged();
      } catch (e) {
        if (isStatus(e, 401)) onUnauthorized();
        else setActionError(describeError(e));
      } finally {
        setBusyId(null);
      }
    },
    [beforeEdit, onEdited, load, onChanged, onUnauthorized],
  );

  const dates = useMemo(
    () => DAY_LABELS.map((_, i) => shiftYmd(weekStart, i)),
    [weekStart],
  );
  const dayOf = useCallback(
    (ymd: string) => DAY_LABELS[dates.indexOf(ymd)] ?? md(ymd),
    [dates],
  );
  const typeLabel = useCallback(
    (k: string) => shiftTypes.find((t) => t.key === k)?.label ?? k,
    [shiftTypes],
  );

  const view = useMemo(() => {
    if (!data) return null;
    const requests = data.requests ?? [];
    const marks = new Map<number, SlotMark>();
    const extras = new Map<string, CellCard[]>();
    const pushCard = (emp: number, date: string, c: CellCard) => {
      const k = `${emp}|${date}`;
      extras.set(k, [...(extras.get(k) ?? []), c]);
    };
    const fromSlot = (s: RequestSlot) => ({
      shiftType: s.shift_type,
      start: s.start_time,
      end: s.end_time,
    });
    for (const r of requests) {
      if (!OPEN_STATUSES.has(r.status)) continue;
      const who = r.from.name;
      if (r.kind === "swap" && r.my_slot && r.their_slot && r.peer) {
        marks.set(r.my_slot.id, { ghost: `↔ ${r.peer.name}` });
        marks.set(r.their_slot.id, {
          split: {
            left: `${who} request`,
            right: `${r.peer.name} original`,
            request: r,
          },
        });
        pushCard(r.from.employee_id, r.their_slot.date, {
          key: `r${r.id}a`,
          ...fromSlot(r.their_slot),
          note: `↔ from ${r.peer.name}`,
        });
        pushCard(r.peer.employee_id, r.my_slot.date, {
          key: `r${r.id}b`,
          ...fromSlot(r.my_slot),
          note: `↔ from ${who}`,
        });
      } else if (r.kind === "move" && r.my_slot && r.date) {
        marks.set(r.my_slot.id, { ghost: "asked to move" });
        pushCard(r.from.employee_id, r.date, {
          key: `r${r.id}`,
          ...fromSlot(r.my_slot),
          note: `${who} asked · moved from ${dayOf(r.my_slot.date)}`,
          request: r,
        });
      } else if (r.kind === "add" && r.date && r.shift_type) {
        const sample = slots.find((s) => s.shift_type === r.shift_type);
        pushCard(r.from.employee_id, r.date, {
          key: `r${r.id}`,
          shiftType: r.shift_type,
          start: sample?.start_time ?? "",
          end: sample?.end_time ?? "",
          note: `${who} asked · extra shift`,
          request: r,
        });
      }
    }
    // 表里的人：这一周有班的、或提了请求的
    const ids = new Set<number>();
    for (const s of slots) if (s.employee_id != null) ids.add(s.employee_id);
    for (const r of requests)
      if (OPEN_STATUSES.has(r.status)) ids.add(r.from.employee_id);
    const rows = employees.filter((e) => ids.has(e.id));
    const open = requests.filter((r) => OPEN_STATUSES.has(r.status)).length;
    return { requests, marks, extras, rows, open };
  }, [data, slots, employees, dayOf]);

  if (error)
    return (
      <p role="alert" className={cn("text-[12.5px]", MUTED)}>
        Could not load the schedule responses: {error}
      </p>
    );
  if (!data || !view) return null;
  if (!data.sent_at && data.people.length === 0 && !data.empty_draft)
    return null;

  const deadline = (() => {
    if (!data.deadline) return "";
    const t = Date.parse(data.deadline);
    return Number.isNaN(t) ? data.deadline : DEADLINE_FMT.format(t);
  })();

  const slotText = (s: RequestSlot | null) =>
    s ? `${dayOf(s.date)} ${typeLabel(s.shift_type)}` : "";
  const requestText = (r: ConfirmRequest) =>
    r.kind === "swap"
      ? `⇄ ${slotText(r.my_slot)} ↔ ${r.peer?.name ?? ""}'s ${slotText(r.their_slot)}`
      : r.kind === "move"
        ? `→ ${slotText(r.my_slot)} to ${r.date ? dayOf(r.date) : ""}`
        : `+ ${r.date ? dayOf(r.date) : ""} ${r.shift_type ? typeLabel(r.shift_type) : ""} (extra shift)`;

  const buttons = (r: ConfirmRequest) =>
    canEdit && r.status === "pending" ? (
      <span className="inline-flex shrink-0 gap-1">
        <button
          type="button"
          data-approve={r.id}
          disabled={busyId === r.id}
          onClick={() => void act(r.id, approveRequest)}
          className={cn(SMALL_BTN, "border-[#3b82f6] bg-[#3b82f6] text-white")}
        >
          Approve
        </button>
        <button
          type="button"
          data-decline={r.id}
          disabled={busyId === r.id}
          onClick={() => void act(r.id, declineRequest)}
          className={cn(SMALL_BTN, "border-white/40 text-white")}
        >
          Decline
        </button>
      </span>
    ) : r.status === "awaiting_peer" ? (
      <span className="text-[10.5px] font-semibold text-amber-200">
        Waiting for {r.peer?.name}
      </span>
    ) : null;

  return (
    <section className={CARD} data-responses>
      <div className={CARD_HEADER}>
        <h2 className="text-[14px] font-semibold text-white">
          Responses · week of {weekStart.slice(5).replace("-", "/")}
        </h2>
        <span className={cn(MUTED, "text-[12px]")} data-responses-meta>
          {data.sent_at ? `Sent ${when(data.sent_at)} · ` : ""}
          {deadline
            ? data.past_deadline
              ? `Deadline passed ${deadline} · `
              : `Answer by ${deadline} · `
            : ""}
          {data.people.length} {data.people.length === 1 ? "person" : "people"}
          {view.open
            ? ` · ${view.open} request${view.open === 1 ? "" : "s"}`
            : ""}
        </span>
      </div>
      {data.empty_draft ? (
        <p className="px-4 pt-3 text-[13px] text-amber-200" data-empty-draft>
          Wednesday&apos;s confirmation wasn&apos;t sent because the draft was
          empty.
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[11px] tracking-[.04em] text-white/55 uppercase">
              <th className="border-b border-white/10 px-3 py-2">Person</th>
              <th className="border-b border-white/10 px-3 py-2">Answer</th>
              <th className="border-b border-white/10 px-3 py-2">
                What they asked
              </th>
            </tr>
          </thead>
          <tbody>
            {data.people.map((p) => {
              const mine = view.requests.filter(
                (r) => r.from.employee_id === p.employee_id,
              );
              return (
                <tr key={p.employee_id} data-response={p.employee_id}>
                  <td className="border-b border-white/10 px-3 py-2">
                    {p.name}
                  </td>
                  <td className="border-b border-white/10 px-3 py-2">
                    {p.answer === "accepted" ? (
                      <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[11.5px] font-semibold text-emerald-300">
                        Accepted
                      </span>
                    ) : p.answer === "wants_changes" ? (
                      <span className="rounded-full bg-[#fcd34d] px-2.5 py-0.5 text-[11.5px] font-semibold text-[#1c1400]">
                        Wants changes
                      </span>
                    ) : p.answer === "counted_accepted" ? (
                      <span className="text-[12px] text-white/55">
                        No answer — counted as Looks good
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11.5px] font-semibold text-white/65">
                        No answer yet
                      </span>
                    )}{" "}
                    <span className="text-[12px] text-white/55">
                      {when(p.answered_at)}
                    </span>
                  </td>
                  <td className="border-b border-white/10 px-3 py-2 text-white/75">
                    {mine.length
                      ? mine.map((r) => (
                          <div key={r.id} data-asked={r.status}>
                            {requestText(r)}:{" "}
                            <span className={statusClass(r)}>
                              {statusText(r)}
                            </span>
                          </div>
                        ))
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {actionError ? (
        <p role="alert" className="px-4 pb-2 text-[13px] text-red-200">
          {actionError}
        </p>
      ) : null}
      {view.open ? (
        <div className="overflow-x-auto p-3" data-responses-grid>
          <div className={cn("grid min-w-[960px] gap-[2px]", COLS)}>
            <div className="pb-1.5 pl-2 text-[11px] font-bold tracking-[.06em] text-white/90 uppercase">
              Staff
            </div>
            {dates.map((d, i) => (
              <div
                key={d}
                className="pb-1.5 text-center text-[11px] font-bold tracking-[.06em] text-white/90 uppercase"
              >
                {DAY_LABELS[i]}
                <small className="block font-mono text-[10px] tracking-normal text-white/80">
                  {md(d)}
                </small>
              </div>
            ))}
            {view.rows.map((e) => (
              <ResponsesRow
                key={e.id}
                employee={e}
                dates={dates}
                slots={slots}
                marks={view.marks}
                extras={view.extras}
                typeLabel={typeLabel}
                buttons={buttons}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ResponsesRow({
  employee,
  dates,
  slots,
  marks,
  extras,
  typeLabel,
  buttons,
}: {
  employee: ScheduleEmployee;
  dates: string[];
  slots: ScheduleSlot[];
  marks: Map<number, SlotMark>;
  extras: Map<string, CellCard[]>;
  typeLabel: (k: string) => string;
  buttons: (r: ConfirmRequest) => ReactNode;
}) {
  return (
    <>
      <div className="flex items-center gap-[7px] rounded-[6px] bg-[#0b1727] p-2 text-[16px] font-bold text-white">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: personDotColor(employee.id) }}
        />
        {employee.name}
      </div>
      {dates.map((date) => {
        const own = slots.filter(
          (s) => s.employee_id === employee.id && s.date === date,
        );
        const extra = extras.get(`${employee.id}|${date}`) ?? [];
        return (
          <div
            key={date}
            data-rcell={`${employee.id}|${date}`}
            className="flex min-h-16 flex-col gap-[3px] rounded-[6px] bg-white/[.03] p-[3px]"
          >
            {own.map((s) => {
              const m = marks.get(s.id);
              const label = typeLabel(s.shift_type);
              if (m?.split)
                return (
                  <div
                    key={s.id}
                    className="flex flex-1 flex-col gap-[3px]"
                    data-split={m.split.request.id}
                  >
                    <div className="grid flex-1 grid-cols-2 gap-[3px]">
                      <div
                        className={cn(
                          "flex flex-col justify-center rounded-[6px] border px-1.5 py-1",
                          REQ_CARD,
                        )}
                      >
                        <small className="text-[10px] font-bold">
                          {m.split.left}
                        </small>
                        <b className="text-[12px]">{label}</b>
                      </div>
                      <div
                        className={cn(
                          "flex flex-col justify-center rounded-[6px] border px-1.5 py-1",
                          shiftCardClass(s.shift_type),
                        )}
                      >
                        <small className="text-[10px] font-bold">
                          {m.split.right}
                        </small>
                        <b className="text-[12px]">{label}</b>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      {m.split.request.status === "pending" ? (
                        <span className="text-[10.5px] font-semibold text-emerald-300">
                          {m.split.request.peer_timed_out
                            ? `${m.split.request.peer?.name} didn't reply`
                            : `${m.split.request.peer?.name} agreed`}
                        </span>
                      ) : null}
                      {buttons(m.split.request)}
                    </div>
                  </div>
                );
              return (
                <div
                  key={s.id}
                  className={cn(
                    "flex flex-1 flex-col justify-center gap-px rounded-[6px] border px-2 py-1",
                    shiftCardClass(s.shift_type),
                    m?.ghost && "border-dashed opacity-40",
                  )}
                >
                  <b className="text-[12.5px]">{label}</b>
                  <span className="font-mono text-[10.5px]">
                    {formatRange(s.start_time, s.end_time)}
                  </span>
                  {m?.ghost ? (
                    <small className="text-[10px] font-bold">{m.ghost}</small>
                  ) : null}
                </div>
              );
            })}
            {extra.map((c) => (
              <div key={c.key} className="flex flex-1 flex-col gap-[3px]">
                <div
                  data-req-card={c.request?.status ?? "swap"}
                  className={cn(
                    "flex flex-1 flex-col justify-center gap-px rounded-[6px] border px-2 py-1",
                    REQ_CARD,
                  )}
                >
                  <b className="text-[12.5px]">{typeLabel(c.shiftType)}</b>
                  <span className="font-mono text-[10.5px]">
                    {formatRange(c.start, c.end)}
                  </span>
                  <small className="text-[10px] font-bold">{c.note}</small>
                </div>
                {c.request ? (
                  <div className="flex justify-center">{buttons(c.request)}</div>
                ) : null}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function statusText(r: ConfirmRequest): string {
  const peer = r.peer?.name ?? "";
  switch (r.status) {
    case "awaiting_peer":
      return `Waiting for ${peer}`;
    case "pending":
      if (r.kind !== "swap") return "Waiting for you";
      return r.peer_timed_out
        ? `${peer} didn't reply — waiting for you`
        : `${peer} agreed — waiting for you`;
    case "approved":
      return "Approved";
    case "declined":
      return "Declined";
    case "peer_declined":
      return `${peer} declined`;
    case "closed":
      return "Closed when published";
  }
}

function statusClass(r: ConfirmRequest): string {
  if (r.status === "approved") return "font-semibold text-emerald-300";
  if (r.status === "declined" || r.status === "peer_declined")
    return "font-semibold text-red-300";
  if (r.status === "closed") return "text-white/50";
  return "font-semibold text-amber-200";
}
