"use client";

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

import { clock, clockRange } from "@/lib/schedule-leave";
import type { LeaveCategory, OverviewLeaveRequest } from "@/lib/schedule-leave-api";
import { leaveCategoryLabel } from "@/lib/schedule-leave-api";
import { shiftColorOf, type ShiftColor } from "@/lib/schedule-shift-colors";
import { cn } from "@/lib/utils";
import type { ScheduleGap, ScheduleShiftType, ScheduleViolation } from "@/types";
import type { OverviewEmployee, OverviewWeekInfo } from "@/types/schedule-overview";

import type { DraftOff, DraftSlot, Key } from "./draft";

/*
 * 一周一块（N2，Annie：「就像现在的schedule example里那样一周周地竖排下来就好了。当半屏时就缩小时间的显示就好了」）。
 * 样子照 components/hr/schedule-example.tsx:120-151 的周卡 + preview v3 第 1 节：名字列 + Sun–Sat，每格班名 + 完整时间。
 * 半屏：时间一行，卡片窄了字跟着缩，最小 6px（同 Staff Schedule week-grid.tsx:1045 的 --tlen 做法）；
 * 手机（< 640px）：块里左右滑、名字列固定。
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** 白卡片上的班次颜色（同 schedule-example 的 Open / Mid / Close，其余照 Staff Schedule 的色名）。 */
const CARD: Record<ShiftColor, string> = {
  open: "border-emerald-600/40 bg-emerald-50 text-emerald-900",
  mid: "border-sky-600/40 bg-sky-50 text-sky-900",
  close: "border-purple-600/40 bg-purple-50 text-purple-900",
  amber: "border-amber-600/40 bg-amber-50 text-amber-900",
  rose: "border-rose-600/40 bg-rose-50 text-rose-900",
  teal: "border-teal-600/40 bg-teal-50 text-teal-900",
  orange: "border-orange-600/40 bg-orange-50 text-orange-900",
  grey: "border-slate-400/50 bg-slate-50 text-slate-800",
};

const OFF_CLS =
  "flex flex-1 items-center rounded-[6px] border border-yellow-600/40 bg-yellow-100 px-2 py-1 text-[12.5px] leading-tight font-bold text-yellow-900";
const LEAVE_CLS =
  "flex flex-1 flex-col justify-center rounded-[6px] border border-yellow-600/60 bg-amber-200 px-2 py-1 text-[12.5px] leading-tight font-extrabold text-yellow-900";
const PEND_CLS =
  "flex flex-1 flex-col justify-center rounded-[6px] border-[1.5px] border-dashed border-amber-600 bg-amber-50 px-2 py-1 text-[11px] leading-tight font-bold text-amber-800";

export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

export interface WeekBlockProps {
  week: string;
  info: OverviewWeekInfo | undefined;
  today: string;
  employees: OverviewEmployee[];
  slots: DraftSlot[];
  timeOff: DraftOff[];
  gaps: ScheduleGap[];
  violations: ScheduleViolation[];
  pending: OverviewLeaveRequest[];
  shiftTypes: ScheduleShiftType[];
  categories: LeaveCategory[];
  canEdit: boolean;
  /** 草稿里改过的班 / 假（虚线边）。 */
  changedKeys: ReadonlySet<Key>;
  /** 周标题条右边（Publish / Send to confirm）。 */
  actions?: ReactNode;
  onMove: (key: Key, employeeId: number | null, date: string) => void;
  onShift: (key: Key) => void;
  onCell: (employeeId: number | null, date: string) => void;
  onLeave: (off: DraftOff) => void;
  onPending: (r: OverviewLeaveRequest) => void;
  onFill: (gap: ScheduleGap) => void;
}

export function WeekBlock(p: WeekBlockProps) {
  const dates = DAYS.map((_, i) => addDaysYmd(p.week, i));
  const [over, setOver] = useState<string | null>(null);
  const inWeek = (d: string) => d >= dates[0] && d <= dates[6];
  const slots = p.slots.filter((s) => inWeek(s.date));
  const people = p.employees.filter(
    (e) => e.is_active || slots.some((s) => s.employee_id === e.id),
  );
  const unassigned = slots.filter((s) => s.employee_id == null);
  const gaps = p.gaps.filter((g) => inWeek(g.date));
  const badSlots = new Map<Key, string[]>();
  for (const v of p.violations)
    for (const id of v.slot_ids ?? []) badSlots.set(id, [...(badSlots.get(id) ?? []), v.message]);
  const label = (k: string) => p.shiftTypes.find((t) => t.key === k)?.label ?? k;
  const catLabel = (o: DraftOff) => o.kind_label || leaveCategoryLabel(p.categories, o.kind);
  const status = p.info?.status ?? "draft";

  const drop = (emp: number | null, date: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!p.canEdit) return;
      e.preventDefault();
      setOver(`${emp}|${date}`);
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => {
      if (!p.canEdit) return;
      e.preventDefault();
      setOver(null);
      const raw = e.dataTransfer.getData("text/x-ov-slot");
      if (!raw) return;
      const key: Key = /^\d+$/.test(raw) ? Number(raw) : raw;
      p.onMove(key, emp, date);
    },
  });

  const shiftCard = (s: DraftSlot) => {
    const time = `${clock(s.start_time)} – ${clock(s.end_time)}`;
    const bad = badSlots.get(s.key);
    return (
      <div
        key={s.key}
        data-ov-shift={s.key}
        {...(p.canEdit ? { "data-ov-edit": "" } : {})}
        draggable={p.canEdit}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/x-ov-slot", String(s.key));
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (p.canEdit) p.onShift(s.key);
        }}
        title={bad ? bad.join("\n") : `${label(s.shift_type)} ${time}${s.note ? ` · ${s.note}` : ""}`}
        className={cn(
          "relative @container flex flex-1 flex-col justify-center rounded-[6px] border px-2 py-1 leading-tight",
          CARD[shiftColorOf(s.shift_type)],
          p.canEdit && "cursor-grab",
          p.changedKeys.has(s.key) && "border-dashed",
          bad && "outline-2 outline-offset-1 outline-orange-600",
        )}
        {...(bad ? { "data-ov-bad": "" } : {})}
      >
        {bad ? (
          <span className="absolute -top-1 -right-1 grid size-[13px] place-items-center rounded-full bg-orange-700 text-[9px] leading-none font-extrabold text-white">
            !
          </span>
        ) : null}
        <b className="text-[12.5px] max-sm:text-[11.5px]">{label(s.shift_type)}</b>
        <span
          data-ov-time
          style={{ "--tlen": (time.length * 0.55).toFixed(2) } as CSSProperties}
          className="overflow-hidden font-mono text-[clamp(6px,calc(100cqi/var(--tlen)),10.5px)] font-semibold whitespace-nowrap"
        >
          {time}
        </span>
        {s.note ? <span className="truncate text-[10px] opacity-75">{s.note}</span> : null}
      </div>
    );
  };

  const cell = (emp: number | null, date: string) => {
    const mine = slots
      .filter((s) => s.employee_id === emp && s.date === date)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    const off = emp == null ? undefined : p.timeOff.find((t) => t.employee_id === emp && t.date === date);
    const pend =
      emp == null
        ? undefined
        : p.pending.find((r) => r.employee_id === emp && r.date_from <= date && date <= r.date_to);
    const hourlyOff = off && off.start_time != null;
    const isToday = date === p.today;
    const key = `${emp}|${date}`;
    return (
      <div
        key={key}
        {...drop(emp, date)}
        onClick={() => {
          if (p.canEdit) p.onCell(emp, date);
        }}
        {...(p.canEdit ? { "data-ov-add-leave": "", "data-ov-cell": key } : {})}
        className={cn(
          "flex min-h-[46px] min-w-0 flex-col gap-[2px] rounded-[5px]",
          isToday && "bg-[#eef6ff]",
          over === key && "ring-2 ring-[#3b82f6]",
          p.canEdit && "cursor-pointer",
        )}
      >
        {mine.map(shiftCard)}
        {off && !hourlyOff ? (
          <button
            type="button"
            data-ov-leave={off.key}
            onClick={(e) => {
              e.stopPropagation();
              if (p.canEdit) p.onLeave(off);
            }}
            className={cn(LEAVE_CLS, "text-left", p.changedKeys.has(off.key) && "border-dashed")}
          >
            {catLabel(off)}
            <span className="text-[9.5px] font-semibold">all day</span>
          </button>
        ) : null}
        {off && hourlyOff ? (
          <button
            type="button"
            data-ov-leave={off.key}
            onClick={(e) => {
              e.stopPropagation();
              if (p.canEdit) p.onLeave(off);
            }}
            className={cn(
              "truncate rounded-[4px] bg-amber-200 px-1 text-left text-[9.5px] font-bold text-yellow-900",
              p.changedKeys.has(off.key) && "outline-1 outline-dashed outline-amber-700",
            )}
          >
            Leave {clockRange(off.start_time!, off.end_time!)} ({catLabel(off)})
          </button>
        ) : null}
        {pend ? (
          <button
            type="button"
            data-ov-pending={pend.id}
            onClick={(e) => {
              e.stopPropagation();
              p.onPending(pend);
            }}
            className={pend.start_time ? "truncate rounded-[4px] border border-dashed border-amber-600 bg-amber-50 px-1 text-left text-[9.5px] font-bold text-amber-800" : PEND_CLS + " text-left"}
          >
            {pend.start_time
              ? `${clockRange(pend.start_time, pend.end_time ?? pend.start_time)} ${pend.kind_label ?? ""}?`
              : `${pend.kind_label ?? "Leave"}?`}
            {pend.start_time ? null : <span className="font-semibold">waiting</span>}
          </button>
        ) : null}
        {emp != null && !mine.length && !off && !pend ? <div className={OFF_CLS}>Off</div> : null}
      </div>
    );
  };

  return (
    <section
      data-ov-week={p.week}
      className="overflow-hidden rounded-[10px] border-[0.5px] border-black/[.12]"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b-[0.5px] border-black/[.08] bg-[#fafaf9] px-2.5 py-[7px]">
        <b className="text-[12.5px]">
          Week of {md(p.week)} · {md(dates[0])} – {md(dates[6])}
        </b>
        {status === "published" ? (
          <span className="text-[11px] font-semibold text-[#15803d]">Published</span>
        ) : (
          <span className="text-[11px] font-semibold text-[#92400e]">Draft · not published</span>
        )}
        {gaps.length ? (
          <span className="text-[11px] font-semibold text-[#b91c1c]">
            · {gaps.length} {gaps.length === 1 ? "gap" : "gaps"}
          </span>
        ) : null}
        {p.actions ? <span className="ml-auto flex flex-wrap items-center gap-2">{p.actions}</span> : null}
      </div>
      <div className="overflow-x-auto">
        <div className="grid grid-cols-[96px_repeat(7,minmax(0,1fr))] gap-[2px] px-1.5 pt-1.5 pb-2 text-[11px] max-sm:min-w-max max-sm:grid-cols-[70px_repeat(7,104px)]">
          <div className="sticky left-0 z-[2] bg-white pl-1.5 text-[11px] font-bold tracking-[.06em] uppercase">
            Staff
          </div>
          {dates.map((d, i) => (
            <div
              key={d}
              data-ov-day={d}
              className={cn(
                "pb-1 text-center text-[11px] font-bold tracking-[.06em] text-[#1a1a1a] uppercase",
                d === p.today && "rounded-[5px] bg-[#eef6ff]",
              )}
            >
              {DAYS[i]}
              <small className="block font-mono text-[10px] font-medium tracking-normal normal-case">
                {md(d)}
              </small>
            </div>
          ))}
          {p.canEdit || unassigned.length ? (
            <>
              <div className="sticky left-0 z-[2] flex items-center bg-white pl-1.5 text-[12.5px] font-semibold text-[#64748b] max-sm:text-[11.5px]">
                Unassigned
              </div>
              {dates.map((d) => cell(null, d))}
            </>
          ) : null}
          {people.map((e) => (
            <Row key={e.id} name={e.name}>
              {dates.map((d) => cell(e.id, d))}
            </Row>
          ))}
          {gaps.length ? (
            <>
              <div className="sticky left-0 z-[2] flex items-center bg-white pl-1.5 text-[10.5px] font-semibold text-[#64748b]">
                Gaps
              </div>
              {dates.map((d) => (
                <div key={d} className="flex min-w-0 flex-col gap-[2px]">
                  {gaps
                    .filter((g) => g.date === d)
                    .map((g, i) => (
                      <div
                        key={i}
                        data-ov-gap={`${g.date} ${g.start_time}`}
                        className="rounded-[5px] border border-red-400 bg-red-100 px-[3px] py-[2px] text-[9.5px] leading-tight font-bold text-red-800"
                      >
                        Gap {clockRange(g.start_time, g.end_time)}
                        {p.canEdit ? (
                          <>
                            {" "}
                            <button
                              type="button"
                              data-ov-fill
                              data-ov-edit
                              onClick={() => p.onFill(g)}
                              className="cursor-pointer underline"
                            >
                              Fill
                            </button>
                          </>
                        ) : null}
                      </div>
                    ))}
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <div className="sticky left-0 z-[2] flex items-center truncate bg-white pl-1.5 text-[12.5px] font-bold text-[#1a1a1a] max-sm:text-[11.5px]">
        {name}
      </div>
      {children}
    </>
  );
}
