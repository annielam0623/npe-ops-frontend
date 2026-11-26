"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { ShiftChangeRequestsBar } from "@/components/hr/schedule-requests";
import type { ConfirmRequest } from "@/lib/schedule-confirm-api";
import { clockRange, dayLabel } from "@/lib/schedule-leave";
import type { OverviewLeaveRequest } from "@/lib/schedule-leave-api";
import { cn } from "@/lib/utils";
import type { ScheduleGap, ScheduleShiftType, ScheduleViolation } from "@/types";

/*
 * 页顶提醒栏（preview v3 第 1 节）：Leave requests（黄）、Gaps（红）、Rule problems（橙）、Shift change requests（灰，6e 的组件，N1 A）。
 * 没有内容的那条不出。手机上（< 640px）每条只露第一项 + 「+N」，点「+N」展开（同 6e 的改班栏）。
 * 只能批假的人（can_edit=false）：只有 Leave requests 能点；Gaps / Rule problems 只看不点；没有 Shift change requests（后端给 []）。
 */

const TONE = {
  leave: "border-[#f5d27a] bg-[#fffbeb] text-[#78350f]",
  gap: "border-[#f3a5a5] bg-[#fef2f2] text-[#991b1b]",
  rule: "border-[#f7b27a] bg-[#fff7ed] text-[#9a3412]",
} as const;

function Bar({
  tone,
  title,
  items,
  attr,
}: {
  tone: keyof typeof TONE;
  title: string;
  items: ReactNode[];
  attr: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-ov-alert={tone}
      {...attr}
      className={cn(
        "flex items-start gap-2.5 rounded-[8px] border px-2.5 py-[7px] text-[12.5px] max-sm:px-2 max-sm:py-1.5",
        TONE[tone],
      )}
    >
      <span className="min-w-[150px] font-extrabold whitespace-nowrap max-sm:min-w-0">{title}</span>
      <span className="flex min-w-0 flex-wrap gap-x-3.5 gap-y-1">
        {items.map((it, i) => (
          <span key={i} className={cn(i > 0 && !open && "max-sm:hidden", "min-w-0 max-sm:truncate")}>
            {it}
          </span>
        ))}
        {items.length > 1 && !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="cursor-pointer font-bold underline sm:hidden"
          >
            +{items.length - 1}
          </button>
        ) : null}
      </span>
    </div>
  );
}

const LINK = "cursor-pointer text-left underline underline-offset-2";

export function leaveRequestLine(r: OverviewLeaveRequest): string {
  const when =
    r.start_time && r.end_time
      ? `${dayLabel(r.date_from)} ${clockRange(r.start_time, r.end_time)}`
      : r.date_from === r.date_to
        ? dayLabel(r.date_from)
        : `${dayLabel(r.date_from)} – ${dayLabel(r.date_to)}`;
  const n = r.shifts?.length ?? 0;
  return `${r.employee_name} · ${when} · ${r.kind_label ?? r.kind}${!r.start_time && n ? ` (has ${n} ${n === 1 ? "shift" : "shifts"})` : ""}`;
}

export function gapLine(g: ScheduleGap, weekIsDraft: boolean): string {
  const why =
    g.reason?.kind === "leave"
      ? `${g.reason.employee_name ?? "Someone"} leave ${clockRange(g.start_time, g.end_time)}${g.reason.leave_kind_label ? ` (${g.reason.leave_kind_label})` : ""}`
      : "nobody on";
  return `${dayLabel(g.date)} ${clockRange(g.start_time, g.end_time)} · ${why}${weekIsDraft ? " · draft week" : ""}`;
}

export function AlertBars({
  canEdit,
  leaveRequests,
  gaps,
  violations,
  changeRequests,
  shiftTypes,
  isDraftWeek,
  onLeave,
  onGap,
  onRule,
  onChangeRequest,
}: {
  canEdit: boolean;
  leaveRequests: OverviewLeaveRequest[];
  gaps: ScheduleGap[];
  violations: ScheduleViolation[];
  changeRequests: ConfirmRequest[];
  shiftTypes: ScheduleShiftType[];
  isDraftWeek: (date: string) => boolean;
  onLeave: (r: OverviewLeaveRequest) => void;
  onGap: (g: ScheduleGap) => void;
  onRule: (v: ScheduleViolation) => void;
  onChangeRequest: (r: ConfirmRequest) => void;
}) {
  const pendingLeave = leaveRequests.filter((r) => r.status === "pending");
  const hasAny =
    pendingLeave.length || gaps.length || violations.length || (canEdit && changeRequests.length);
  if (!hasAny) return null;
  return (
    <div className="grid gap-1.5 px-3.5 py-2.5 max-sm:px-2.5 max-sm:py-2">
      {pendingLeave.length ? (
        <Bar
          tone="leave"
          title={`Leave requests · ${pendingLeave.length} waiting`}
          attr={{ "data-ov-leave-requests": "" }}
          items={pendingLeave.map((r) => (
            <button key={r.id} type="button" className={LINK} onClick={() => onLeave(r)}>
              {leaveRequestLine(r)}
            </button>
          ))}
        />
      ) : null}
      {gaps.length ? (
        <Bar
          tone="gap"
          title={`Gaps · ${gaps.length}`}
          attr={{ "data-ov-gaps": "" }}
          items={gaps.map((g, i) =>
            canEdit ? (
              <button key={i} type="button" className={LINK} data-ov-edit onClick={() => onGap(g)}>
                {gapLine(g, isDraftWeek(g.date))}
              </button>
            ) : (
              <span key={i}>{gapLine(g, isDraftWeek(g.date))}</span>
            ),
          )}
        />
      ) : null}
      {violations.length ? (
        <Bar
          tone="rule"
          title={`Rule problems · ${violations.length}`}
          attr={{ "data-ov-rules": "" }}
          items={violations.map((v, i) =>
            canEdit ? (
              <button key={i} type="button" className={LINK} onClick={() => onRule(v)}>
                {v.message}
              </button>
            ) : (
              <span key={i}>{v.message}</span>
            ),
          )}
        />
      ) : null}
      {canEdit && changeRequests.length ? (
        <div data-ov-alert="resp" data-ov-change-requests="">
          <ShiftChangeRequestsBar
            requests={changeRequests}
            shiftTypes={shiftTypes}
            onOpen={onChangeRequest}
          />
        </div>
      ) : null}
    </div>
  );
}
