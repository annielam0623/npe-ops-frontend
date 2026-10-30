"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { shiftYmd } from "@/lib/la-date";
import {
  approveRequest,
  declineRequest,
  fetchWeekConfirmations,
  isUnavailable,
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
  type BoardAddition,
  type BoardPerson,
  type BoardShift,
  ConfirmBoard,
} from "./confirm-board";
import { CARD, CARD_HEADER, DAY_LABELS, MUTED } from "./config";

const WHEN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : WHEN.format(d);
}

/**
 * 排班页里的「Responses」（周三确认，Annie 2026-10-19「现在动手」）：下周的班发出确认后，各人的回应
 * （Accepted / Wants changes / No answer）；想加的班用亮黄色挨在同一格里，旁边 Approve / Decline。
 * Approve = 变成正式的班（后端加一个时段 + 通知本人），Decline = 亮黄色消失、通知本人；没处理前真正的排班不变。
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
  /** Approve 之后要重拉这一周（多了一个正式的时段）。 */
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

  const empById = useMemo(
    () => new Map(employees.map((e) => [e.id, e.name])),
    [employees],
  );

  async function act(id: number, fn: (id: number) => Promise<unknown>) {
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
  }

  const view = useMemo(() => {
    if (!data) return null;
    const types = shiftTypes
      .filter((t) => t.is_active || slots.some((s) => s.shift_type === t.key))
      .filter((t) => slots.some((s) => s.shift_type === t.key));
    const shifts: BoardShift[] = types.map((t) => {
      const first = slots
        .filter((s) => s.shift_type === t.key)
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      return {
        key: t.key,
        label: t.label,
        time: first ? formatRange(first.start_time, first.end_time) : "",
      };
    });
    const people: Record<string, BoardPerson[]> = {};
    for (const s of slots) {
      if (s.employee_id == null) continue;
      const k = `${s.date}|${s.shift_type}`;
      (people[k] ??= []).push({ name: empById.get(s.employee_id) ?? "—" });
    }
    return { shifts, people };
  }, [data, shiftTypes, slots, empById]);

  if (error)
    return (
      <p role="alert" className={cn("text-[12.5px]", MUTED)}>
        Could not load the schedule responses: {error}
      </p>
    );
  if (!data || !view) return null;
  if (!data.sent_at && data.people.length === 0) return null;

  const additions: BoardAddition[] = data.people.flatMap((p) =>
    p.requests
      .filter((r) => r.status !== "approved")
      .map((r): BoardAddition => ({
        id: `r${r.id}`,
        date: r.date,
        shift: r.shift_type,
        name: p.name,
        status: r.status,
        actions:
          r.status === "pending" && canEdit ? (
            <span className="flex shrink-0 gap-1">
              <button
                type="button"
                data-approve={r.id}
                disabled={busyId === r.id}
                onClick={() => void act(r.id, approveRequest)}
                className="cursor-pointer rounded border border-[#1c1400] px-1.5 text-[11px] font-semibold disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                data-decline={r.id}
                disabled={busyId === r.id}
                onClick={() => void act(r.id, declineRequest)}
                className="cursor-pointer rounded border border-[#1c1400] px-1.5 text-[11px] font-semibold disabled:opacity-50"
              >
                Decline
              </button>
            </span>
          ) : undefined,
      })),
  );

  const dates = DAY_LABELS.map((_, i) => shiftYmd(weekStart, i));
  const askText = (p: WeekConfirmations["people"][number]) => {
    const rs = p.requests.filter((r) => r.status !== "approved");
    if (!rs.length) return "—";
    return rs
      .map((r) => {
        const label =
          shiftTypes.find((t) => t.key === r.shift_type)?.label ?? r.shift_type;
        return `${DAY_LABELS[dates.indexOf(r.date)] ?? r.date} ${label}${
          r.status === "declined" ? " (declined)" : ""
        }`;
      })
      .join(", ");
  };

  return (
    <section className={CARD} data-responses>
      <div className={CARD_HEADER}>
        <h2 className="text-[14px] font-semibold text-white">
          Responses · week of {weekStart.slice(5).replace("-", "/")}
        </h2>
        <span className={cn(MUTED, "text-[12px]")}>
          {data.sent_at ? `Sent ${when(data.sent_at)} · ` : ""}
          {data.people.length} {data.people.length === 1 ? "person" : "people"}
        </span>
      </div>
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
            {data.people.map((p) => (
              <tr key={p.employee_id} data-response={p.employee_id}>
                <td className="border-b border-white/10 px-3 py-2">{p.name}</td>
                <td className="border-b border-white/10 px-3 py-2">
                  {p.answer === "accepted" ? (
                    <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[11.5px] font-semibold text-emerald-300">
                      Accepted
                    </span>
                  ) : p.answer === "wants_changes" ? (
                    <span className="rounded-full bg-[#fcd34d] px-2.5 py-0.5 text-[11.5px] font-semibold text-[#1c1400]">
                      Wants changes
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
                  {askText(p)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actionError ? (
        <p role="alert" className="px-4 pb-2 text-[13px] text-red-200">
          {actionError}
        </p>
      ) : null}
      {additions.length ? (
        <ConfirmBoard
          weekStart={weekStart}
          shifts={view.shifts}
          people={view.people}
          additions={additions}
        />
      ) : null}
    </section>
  );
}
