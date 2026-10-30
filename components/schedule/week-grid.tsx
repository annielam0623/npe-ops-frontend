"use client";

import { useEffect, useRef, useState } from "react";

import { laToday, shiftYmd } from "@/lib/la-date";
import { gapRangeShort } from "@/lib/schedule-gaps";
import { readRecentShifts, type RecentShift } from "@/lib/schedule-recent";
import { formatClock, hasBadTimeRange } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import type {
  ScheduleEmployee,
  ScheduleGap,
  SchedulePendingChange,
  ScheduleShiftType,
  ScheduleSlot,
  ScheduleTimeOff,
} from "@/types";

import {
  AddShiftDialog,
  cleanNote,
  type AddShiftInput,
  type AddTimeOffInput,
} from "./add-shift-dialog";
import {
  DAY_LABELS,
  personDotColor,
  shiftCardClass,
  TIME_OFF_LABEL,
} from "./config";
import { sentTime } from "./send-changes-dialog";
import { TimeEditPopup } from "./time-edit-popup";
import { gapSentence, type SlotMark } from "./week-draft";

interface WeekGridProps {
  weekStart: string;
  /** 在职的人；已经按「自己在最上面」排好。 */
  employees: ScheduleEmployee[];
  /** 当前登录的人对应的名单项（按名字对上），没对上就是 null。 */
  meId: number | null;
  slots: ScheduleSlot[];
  /** 这一周所有人的休假；undefined = 后端还没带这个字段（还没上线），页面不提供「加休假」。 */
  timeOff: ScheduleTimeOff[] | undefined;
  shiftTypes: ScheduleShiftType[];
  canEdit: boolean;
  /** 把一个时段换给某个人（`null` = 清空，变回 Unassigned）。 */
  onAssign: (slotId: number, employeeId: number | null) => void;
  /** 在某一天加一个时段，`employeeId` 为 null 就是还没人的时段。 */
  /** 一次加好几天：每天一个同样的班（先建再派给这个人，没人就留在 Unassigned）。 */
  onCreateSlots: (input: {
    dates: string[];
    shiftType: ScheduleShiftType;
    employeeId: number | null;
    start: string;
    end: string;
    note: string | null;
  }) => void;
  /** 工作时段起止：新班的默认时间（后端没有每种班次的默认时间）。 */
  workWindow: { start_time: string; end_time: string };
  onDeleteSlot: (slotId: number) => void;
  onUpdateTime: (slotId: number, startTime: string, endTime: string) => void;
  /** 改 / 清除备注（`null` = 清除）。 */
  onSaveNote: (slotId: number, note: string | null) => void;
  /** 录休假；返回 null = 成功，文字 = 后端原话（窗口里红框显示）。 */
  onSetTimeOff: (
    employeeId: number,
    input: AddTimeOffInput,
  ) => Promise<string | null>;
  onDeleteTimeOff: (id: number) => void;
  /** 有空档的日子（后端 gaps 按日期分好）：列头下面标红点 + 时间（Annie Q5）。只给能改排班的人传。 */
  gapsByDay?: Map<string, ScheduleGap[]>;
  /** 点列头的红点：跳到下面 Day timeline 的那一天。 */
  onGapDay?: (date: string) => void;
  /**
   * 整周一个 Save（B9）：页面上没存的改动的标记（slot id → moved / time / new / note / deleted）。
   * slots 已经是「库里的 + 暂存」（删掉的也在里面，带 deleted 标记）。
   */
  marks?: Map<number, SlotMark>;
  /** 搬过的班原来在谁那一格（slot id → 原来的 employee_id）：原位置画一个淡的琥珀虚线影子。 */
  movedFrom?: Map<number, number | null>;
  /** 删掉还没存的班点 Undo。 */
  onUndoDelete?: (slotId: number) => void;
  /** 后端 400 指出的那一个班（op_index → slot）：标红。 */
  errorSlotId?: number | null;
  /** 这张卡新造成的空档（页面上的改动算的，置顶 17）：卡片变红、写明空档多长。 */
  gapNotes?: Map<number, ScheduleGap[]>;
  /** 已发布的周每个人改了什么（只给能改排班的人传）：行上出「N changes · Send to confirm」，改过的格子标琥珀色。 */
  pendingChanges?: SchedulePendingChange[];
  onSendChanges?: (employeeId: number) => void;
  /**
   * 页面上有没存的改动（整周一个 Save）：Send to confirm 灰着、旁边灰字 Save first。发出去的是库里的改动，
   * 没存的不在里面（Annie 2026-10-30 置顶 12「同意」，方案 A）。
   */
  sendBlocked?: boolean;
}

const COLS = "grid-cols-[130px_repeat(7,minmax(118px,1fr))]";
const SLOT_MIME = "text/slot";

/**
 * 排班表：一行一个人、一列一天（Annie 2026-10-17 看预览定：员工一眼看到自己这周几点上班）。
 * 主管多一行 Unassigned，放还没人的时段；把卡片拖到同一天别人的格子里就换人，
 * 拖到 Unassigned 就清空。手机 / 没有拖拽时：点一张卡片选中，再点同一天的格子。
 */
export function WeekGrid({
  weekStart,
  employees,
  meId,
  slots,
  timeOff,
  shiftTypes,
  canEdit,
  onAssign,
  onCreateSlots,
  workWindow,
  onDeleteSlot,
  onUpdateTime,
  onSaveNote,
  onSetTimeOff,
  onDeleteTimeOff,
  gapsByDay,
  onGapDay,
  marks,
  movedFrom,
  onUndoDelete,
  errorSlotId = null,
  gapNotes,
  pendingChanges,
  onSendChanges,
  sendBlocked = false,
}: WeekGridProps) {
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  // 改时间的小窗（A8）：哪一张卡、卡片元素（量位置）。同一时间只开一个。
  const [timeEdit, setTimeEdit] = useState<{
    slotId: number;
    anchor: HTMLElement | null;
  } | null>(null);
  // 同理：同一时间只有一个时段在改备注。
  const [notingSlotId, setNotingSlotId] = useState<number | null>(null);
  const [adding, setAdding] = useState<{
    date: string;
    employeeId: number | null;
  } | null>(null);

  const dates = DAY_LABELS.map((_, i) => shiftYmd(weekStart, i));
  const today = laToday();
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const selectedSlot =
    selectedSlotId != null ? (slotById.get(selectedSlotId) ?? null) : null;
  const unassigned = slots.filter((s) => s.employee_id == null);
  const showNeeds = canEdit || unassigned.length > 0;
  const activeShiftTypes = shiftTypes.filter((t) => t.is_active);

  function dropOn(slotId: number, date: string, employeeId: number | null) {
    const slot = slotById.get(slotId);
    // 时段是属于某一天的：只能换给同一天的人，拖到别的天不动。删掉还没存的班不能拖。
    if (!slot || slot.date !== date || marks?.get(slotId)?.deleted) return;
    if (slot.employee_id === employeeId) return;
    onAssign(slotId, employeeId);
  }

  function clickCell(date: string, employeeId: number | null) {
    if (!canEdit || !selectedSlot) return;
    dropOn(selectedSlot.id, date, employeeId);
    setSelectedSlotId(null);
  }

  function renderCell(date: string, employeeId: number | null) {
    const cellSlots = slots.filter(
      (s) => s.date === date && s.employee_id === employeeId,
    );
    // 搬走还没存的班：原位置留一个淡的琥珀虚线影子（preview ①）。
    const ghosts = slots.filter(
      (s) =>
        s.date === date &&
        movedFrom?.has(s.id) &&
        movedFrom.get(s.id) === employeeId &&
        s.employee_id !== employeeId,
    );
    const key = `${employeeId ?? "needs"}|${date}`;
    const live = cellSlots.filter((s) => !marks?.get(s.id)?.deleted);
    const targetable =
      canEdit && selectedSlot != null && selectedSlot.date === date;
    const changed =
      employeeId != null &&
      !!pendingChanges
        ?.find((p) => p.employee_id === employeeId)
        ?.items.some((i) => i.date === date);
    return (
      <Cell
        key={key}
        cellKey={key}
        changed={changed}
        today={date === today}
        mine={employeeId != null && employeeId === meId}
        needs={employeeId == null}
        targetable={targetable}
        canEdit={canEdit}
        onClick={() => clickCell(date, employeeId)}
        onDropSlot={(slotId) => dropOn(slotId, date, employeeId)}
      >
        {live.length === 0 && employeeId != null ? (
          <OffOrTimeOffCard
            timeOff={(timeOff ?? []).find(
              (t) => t.employee_id === employeeId && t.date === date,
            )}
            canEdit={canEdit}
            onRemove={onDeleteTimeOff}
          />
        ) : null}
        {cellSlots.map((slot) => (
          <SlotCard
            key={slot.id}
            slot={slot}
            label={
              shiftTypes.find((t) => t.key === slot.shift_type)?.label ??
              slot.shift_type
            }
            canEdit={canEdit}
            selected={selectedSlotId === slot.id}
            mark={marks?.get(slot.id)}
            error={errorSlotId === slot.id}
            gaps={gapNotes?.get(slot.id)}
            onSelect={() =>
              setSelectedSlotId((id) => (id === slot.id ? null : slot.id))
            }
            onStartEdit={(anchor) => setTimeEdit({ slotId: slot.id, anchor })}
            noting={notingSlotId === slot.id}
            onStartNote={() => setNotingSlotId(slot.id)}
            onStopNote={() => setNotingSlotId(null)}
            onSaveNote={(note) => onSaveNote(slot.id, note)}
            onRemove={() => onDeleteSlot(slot.id)}
            onUndoDelete={() => onUndoDelete?.(slot.id)}
          />
        ))}
        {ghosts.map((slot) => (
          <div
            key={`ghost-${slot.id}`}
            data-moved-from={slot.id}
            aria-hidden
            className="flex flex-1 flex-col justify-center rounded-[6px] border border-dashed border-amber-400/60 px-2 py-1 text-[11px] leading-tight text-white/40"
          >
            <b className="text-[12.5px]">
              {shiftTypes.find((t) => t.key === slot.shift_type)?.label ??
                slot.shift_type}
            </b>
            <span className="font-mono text-[10.5px]">
              {formatClock(slot.start_time)} – {formatClock(slot.end_time)}
            </span>
          </div>
        ))}
        {canEdit ? (
          <AddSlotButton onClick={() => setAdding({ date, employeeId })} />
        ) : null}
      </Cell>
    );
  }

  return (
    <div className="overflow-x-auto p-3" data-sch-grid>
      <div className={cn("grid min-w-[960px] gap-[2px]", COLS)}>
        <div className="pb-1.5 pl-[25px] text-[11px] font-bold tracking-[.06em] text-white/90 uppercase">
          Staff
        </div>
        {dates.map((date, i) => (
          <div
            key={date}
            className={cn(
              "pb-1.5 text-center",
              date === today ? "text-sky-300" : "text-white/90",
            )}
          >
            <div className="text-[11px] font-bold tracking-[.06em] uppercase">
              {DAY_LABELS[i]}
            </div>
            <div className="font-mono text-[10px] text-white/80">
              {date.slice(5).replace("-", "/")}
            </div>
            {gapsByDay?.get(date)?.length ? (
              <button
                type="button"
                data-grid-gap={date}
                onClick={() => onGapDay?.(date)}
                title="Nobody is scheduled at this time. Click to see it in the Day timeline."
                className="mx-auto mt-0.5 flex cursor-pointer items-center justify-center gap-1 text-[10.5px] font-semibold text-red-300 hover:text-red-200"
              >
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-full bg-red-500"
                />
                Gap {gapRangeShort(gapsByDay.get(date)![0])}
                {gapsByDay.get(date)!.length > 1
                  ? ` +${gapsByDay.get(date)!.length - 1}`
                  : ""}
              </button>
            ) : null}
          </div>
        ))}

        {showNeeds ? (
          <>
            <div className="sticky left-0 z-[1] flex flex-col justify-center rounded-[6px] bg-[#1b0d12] px-2 py-1.5">
              <span className="text-[17px] leading-tight font-bold text-red-200">
                Unassigned
              </span>
              {canEdit ? (
                <span className="text-[10.5px] leading-tight text-white/80">
                  Drag a shift here to take someone off it
                </span>
              ) : null}
            </div>
            {dates.map((date) => renderCell(date, null))}
          </>
        ) : null}

        {employees.map((e) => (
          <PersonRow
            key={e.id}
            employee={e}
            mine={e.id === meId}
            cells={dates.map((date) => renderCell(date, e.id))}
            change={pendingChanges?.find((p) => p.employee_id === e.id)}
            onSendChanges={
              onSendChanges ? () => onSendChanges(e.id) : undefined
            }
            sendBlocked={sendBlocked}
          />
        ))}
      </div>
      {canEdit && adding ? (
        <AddShiftForCell
          weekStart={weekStart}
          date={adding.date}
          employee={employees.find((e) => e.id === adding.employeeId) ?? null}
          shiftTypes={activeShiftTypes}
          slots={slots}
          workWindow={workWindow}
          onSubmit={(input) => {
            onCreateSlots({ ...input, employeeId: adding.employeeId });
            setAdding(null);
          }}
          onSubmitTimeOff={
            adding.employeeId != null && timeOff !== undefined
              ? async (input) => {
                  const message = await onSetTimeOff(
                    adding.employeeId as number,
                    input,
                  );
                  if (message === null) setAdding(null);
                  return message;
                }
              : undefined
          }
          onClose={() => setAdding(null)}
        />
      ) : null}
      {canEdit && timeEdit && slotById.get(timeEdit.slotId)
        ? (() => {
            const slot = slotById.get(timeEdit.slotId)!;
            const who =
              slot.employee_id == null
                ? "Unassigned"
                : (employees.find((e) => e.id === slot.employee_id)?.name ??
                  "Someone");
            const [y, m, d] = slot.date.split("-").map(Number);
            const day = `${DAY_LABELS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${m}/${d}`;
            const type =
              shiftTypes.find((t) => t.key === slot.shift_type)?.label ??
              slot.shift_type;
            return (
              <TimeEditPopup
                key={slot.id}
                anchor={timeEdit.anchor}
                title={`${who} · ${day} · ${type}`}
                start={slot.start_time}
                end={slot.end_time}
                onDone={(start, end) => {
                  onUpdateTime(slot.id, start, end);
                  setTimeEdit(null);
                }}
                onClose={() => setTimeEdit(null)}
              />
            );
          })()
        : null}
      {canEdit && selectedSlot ? (
        <p className="mt-2 text-[11.5px] text-sky-300">
          Card selected — click a cell on{" "}
          {selectedSlot.date.slice(5).replace("-", "/")} to move it, or click
          the card again to cancel.
        </p>
      ) : null}
    </div>
  );
}

function PersonRow({
  employee,
  mine,
  cells,
  change,
  onSendChanges,
  sendBlocked = false,
}: {
  employee: ScheduleEmployee;
  mine: boolean;
  cells: React.ReactNode[];
  /** 这个人这周和上次发布不一样（Annie 10-29「员工确认」）。 */
  change?: SchedulePendingChange;
  onSendChanges?: () => void;
  sendBlocked?: boolean;
}) {
  return (
    <>
      <div
        className={cn(
          "sticky left-0 z-[1] flex flex-col justify-center rounded-[6px] px-2 py-1.5",
          mine ? "bg-[#0c2a3f]" : "bg-[#0b1727]",
        )}
      >
        <span className="flex items-center gap-[7px] text-[17px] leading-tight font-bold text-white">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: personDotColor(employee.id) }}
          />
          <span className="min-w-0 break-words">{employee.name}</span>
        </span>
        {change && change.items.length > 0 && onSendChanges ? (
          <span
            data-person-changes={employee.id}
            className="mt-1 flex flex-wrap items-center gap-1 pl-[17px]"
          >
            {change.sent_at ? (
              // 发过了：淡黄标签（同发送页的「Sent by … on …」）。
              <span className="rounded-md bg-[#FAEEDA] px-1.5 py-px text-[10px] whitespace-nowrap text-[#BA7517]">
                Sent to {employee.name} {sentTime(change.sent_at)}
              </span>
            ) : (
              <span className="rounded-full bg-amber-500/20 px-[7px] text-[10px] font-bold whitespace-nowrap text-amber-300">
                {change.items.length}{" "}
                {change.items.length === 1 ? "change" : "changes"}
              </span>
            )}
            <button
              type="button"
              data-send-to-confirm={employee.id}
              onClick={onSendChanges}
              disabled={sendBlocked}
              title={sendBlocked ? "Save your changes first." : undefined}
              className="cursor-pointer rounded-[6px] border border-sky-300/45 px-[7px] py-px text-[10.5px] font-semibold whitespace-nowrap text-sky-300 hover:bg-sky-300/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {change.sent_at ? "Send again" : "Send to confirm"}
            </button>
            {sendBlocked ? (
              <span
                data-send-save-first
                className="text-[10px] whitespace-nowrap text-white/55"
              >
                Save first
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      {cells}
    </>
  );
}

function Cell({
  cellKey,
  changed = false,
  today,
  mine,
  needs,
  targetable,
  canEdit,
  onClick,
  onDropSlot,
  children,
}: {
  cellKey: string;
  today: boolean;
  mine: boolean;
  needs: boolean;
  targetable: boolean;
  canEdit: boolean;
  onClick: () => void;
  onDropSlot: (slotId: number) => void;
  children: React.ReactNode;
  /** 已发布后改过、还没 Publish again 的格子：琥珀色框。 */
  changed?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      data-cell={cellKey}
      data-changed={changed || undefined}
      onClick={targetable ? onClick : undefined}
      onDragOver={
        canEdit
          ? (e) => {
              e.preventDefault();
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={canEdit ? () => setDragOver(false) : undefined}
      onDrop={
        canEdit
          ? (e) => {
              e.preventDefault();
              setDragOver(false);
              const id = Number(e.dataTransfer.getData(SLOT_MIME));
              if (id) onDropSlot(id);
            }
          : undefined
      }
      className={cn(
        "group relative flex min-h-[52px] flex-col gap-[2px] rounded-[6px] p-0",
        changed && "outline-2 outline-offset-[-2px] outline-amber-500",
        today && "bg-sky-400/[.05]",
        mine && "bg-sky-400/[.08]",
        needs && "bg-red-500/[.04]",
        targetable && "cursor-pointer outline outline-1 outline-sky-400/50",
        dragOver && "bg-emerald-400/[.14]",
      )}
    >
      {children}
    </div>
  );
}

/** 这个人这天没有班：浅黄色的 Off 格（Annie 2026-10-18 选色卡 A；样式同班次卡片，圆角 / 边框 / 左边写字）。 */
export function OffCard() {
  return (
    <div
      data-off
      className="flex flex-1 items-center rounded-[6px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.14)] px-2 py-1 text-[12.5px] leading-tight font-bold text-[#fde68a]"
    >
      Off
    </div>
  );
}

/** 有休假就写 PTO / Sick / Personal（比 Off 深一档的黄，Annie 选的色卡 A）+ 备注小字；没有就是 Off。 */
function OffOrTimeOffCard({
  timeOff,
  canEdit,
  onRemove,
}: {
  timeOff: ScheduleTimeOff | undefined;
  canEdit: boolean;
  onRemove: (id: number) => void;
}) {
  if (!timeOff) return <OffCard />;
  return (
    <div
      data-time-off={timeOff.kind}
      className="relative flex flex-1 flex-col justify-center gap-0.5 rounded-[6px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.28)] px-2 py-1 text-[#fde68a]"
    >
      <b className="text-[12.5px] leading-tight">
        {TIME_OFF_LABEL[timeOff.kind] ?? timeOff.kind}
      </b>
      {canEdit ? (
        <button
          type="button"
          title="Remove this time off"
          aria-label="Remove this time off"
          data-remove-time-off
          onClick={(e) => {
            e.stopPropagation();
            onRemove(timeOff.id);
          }}
          className="absolute top-0.5 right-1 cursor-pointer rounded px-1 text-[13px] leading-none text-white/70 hover:bg-red-500/20 hover:text-red-200"
        >
          ×
        </button>
      ) : null}
      {timeOff.note ? (
        <span className="text-[10px] leading-tight font-semibold break-words">
          {timeOff.note}
        </span>
      ) : null}
    </div>
  );
}

function AddSlotButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="Add a shift"
      aria-label="Add a shift"
      // 不占版面：悬停（或键盘聚焦）这一格才出现在右下角，手机没有悬停就一直淡淡地显示。
      className="absolute right-0.5 bottom-0.5 cursor-pointer rounded bg-[#0b1727]/80 px-1.5 py-0.5 text-[13px] leading-none font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/15 hover:text-sky-200 focus:opacity-100 [@media(hover:none)]:opacity-60"
    >
      +
    </button>
  );
}

/** 卡片右上角的琥珀色小字：没存的改动（preview ①：moved / time / new / note）。 */
function markWords(mark: SlotMark | undefined): string[] {
  if (!mark || mark.deleted) return [];
  if (mark.isNew) return ["new"];
  return [
    mark.moved ? "moved" : "",
    mark.time ? "time" : "",
    mark.note ? "note" : "",
  ].filter(Boolean);
}

function SlotCard({
  slot,
  label,
  canEdit,
  selected,
  mark,
  error,
  gaps,
  onSelect,
  onStartEdit,
  noting,
  onStartNote,
  onStopNote,
  onSaveNote,
  onRemove,
  onUndoDelete,
}: {
  slot: ScheduleSlot;
  label: string;
  canEdit: boolean;
  selected: boolean;
  /** 没存的改动（整周一个 Save）；undefined = 和库里一样。 */
  mark?: SlotMark;
  /** 后端 400 指出的就是这一个：标红。 */
  error: boolean;
  /** 这张卡新造成的空档：红框 + 淡红底，时间下面一句（Annie 10-30「这个格子就变红色，告诉排班的人有一小时的gap」）。 */
  gaps?: ScheduleGap[];
  onSelect: () => void;
  /** 点时间：开改时间小窗（A8），传卡片元素量位置。 */
  onStartEdit: (anchor: HTMLElement | null) => void;
  noting: boolean;
  onStartNote: () => void;
  onStopNote: () => void;
  onSaveNote: (note: string | null) => void;
  onRemove: () => void;
  onUndoDelete: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const badRange = hasBadTimeRange(slot.start_time, slot.end_time);
  const needs = slot.employee_id == null;
  const deleted = mark?.deleted === true;
  const words = markWords(mark);
  const changed = words.length > 0;
  const live = canEdit && !deleted;
  return (
    <div
      ref={cardRef}
      draggable={live}
      onDragStart={(e) => {
        e.dataTransfer.setData(SLOT_MIME, String(slot.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => {
        if (!live) return;
        e.stopPropagation();
        onSelect();
      }}
      data-slot-id={slot.id}
      data-mark={deleted ? "deleted" : words.join(" ") || undefined}
      data-slot-error={error || undefined}
      className={cn(
        "group/card flex flex-1 flex-col justify-center gap-0.5 rounded-[6px] border px-2 py-1 text-[11px] leading-tight",
        needs
          ? "border-dashed border-red-400/70 bg-red-500/[.1] text-red-200"
          : shiftCardClass(slot.shift_type),
        badRange && "border-amber-400/60 bg-amber-400/[.12]",
        // 没存的改动：琥珀框（同 Bus Manifest 那份）；删掉的灰掉、琥珀虚线，名字和时间划线。
        changed && "border-amber-400 ring-1 ring-amber-400/60",
        deleted &&
          "border-dashed border-amber-400/70 bg-white/[.04] text-white/40 opacity-70",
        error && "border-red-500 ring-2 ring-red-500/70",
        // 造成空档：红的优先于琥珀色（没存的改动）和删掉的灰。
        gaps?.length &&
          "border-2 border-solid border-red-500 bg-red-500/[.16] opacity-100 ring-0",
        live && "cursor-grab",
        selected && "ring-2 ring-sky-400/70",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <b className={cn("text-[12.5px]", deleted && "line-through")}>
          {label}
        </b>
        <span className="flex items-center gap-1">
          {words.length ? (
            <span
              data-mark-words
              className="rounded bg-amber-400/20 px-1 text-[9.5px] font-bold text-amber-300"
            >
              {words.join(" · ")}
            </span>
          ) : null}
          {canEdit && deleted ? (
            <button
              type="button"
              data-undo-delete
              title="Put this shift back"
              onClick={(e) => {
                e.stopPropagation();
                onUndoDelete();
              }}
              className="cursor-pointer rounded px-1 text-[10.5px] font-semibold text-amber-300 hover:bg-amber-400/15"
            >
              Undo
            </button>
          ) : canEdit ? (
            <button
              type="button"
              title="Remove this shift"
              aria-label="Remove this shift"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="cursor-pointer rounded px-1 text-[13px] leading-none text-white/70 hover:bg-red-500/20 hover:text-red-200"
            >
              ×
            </button>
          ) : null}
        </span>
      </div>
      <button
        type="button"
        disabled={!live}
        onClick={(e) => {
          e.stopPropagation();
          if (live) onStartEdit(cardRef.current);
        }}
        className={cn(
          "w-fit text-left font-mono text-[10.5px] font-semibold whitespace-nowrap",
          deleted ? "text-white/40 line-through" : "text-white",
          live && "cursor-text hover:text-sky-200 hover:underline",
        )}
      >
        {formatClock(slot.start_time)} – {formatClock(slot.end_time)}
      </button>
      {gaps?.length ? (
        <span
          data-gap-note
          className="text-[10.5px] leading-tight font-bold text-[#fecaca]"
        >
          {gapSentence(gaps)}
        </span>
      ) : null}
      {badRange && !deleted ? (
        <span className="text-[10px] text-amber-200">
          End isn&apos;t after start
        </span>
      ) : null}
      {deleted ? (
        <span className="text-[10px] text-amber-300">
          Removed · not saved yet
        </span>
      ) : noting ? (
        <NoteEditor
          initial={slot.note ?? ""}
          onSave={(note) => {
            onSaveNote(note);
            onStopNote();
          }}
          onCancel={onStopNote}
        />
      ) : slot.note ? (
        canEdit ? (
          <button
            type="button"
            data-slot-note
            title="Edit note"
            onClick={(e) => {
              e.stopPropagation();
              onStartNote();
            }}
            className="w-fit cursor-text text-left text-[10px] leading-tight font-semibold break-words text-[#fde68a] hover:underline"
          >
            {slot.note}
          </button>
        ) : (
          <span
            data-slot-note
            className="text-[10px] leading-tight font-semibold break-words text-[#fde68a]"
          >
            {slot.note}
          </span>
        )
      ) : canEdit ? (
        // 没有备注：悬停（或聚焦）这张卡才出现「+ note」，手机没有悬停就一直淡淡地显示。
        <button
          type="button"
          data-add-note
          onClick={(e) => {
            e.stopPropagation();
            onStartNote();
          }}
          className="w-fit cursor-pointer text-left text-[10px] leading-tight text-white/55 opacity-0 transition-opacity group-hover/card:opacity-100 hover:text-sky-200 focus:opacity-100 [@media(hover:none)]:opacity-60"
        >
          + note
        </button>
      ) : null}
    </div>
  );
}

/** 改备注的小输入框：Enter / Done 把备注放到页面上（整周 Save 才存，B9 Q1），Esc / Cancel / 点外面 = 不改；清空再 Done = 删掉备注。 */
function NoteEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (note: string | null) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onCancel();
      }
    }
    document.addEventListener("click", onOutsideClick);
    return () => document.removeEventListener("click", onOutsideClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function save() {
    const trimmed = value.trim();
    onSave(trimmed === "" ? null : trimmed);
  }

  return (
    <div
      ref={rootRef}
      onClick={(e) => e.stopPropagation()}
      className="flex flex-col gap-1"
    >
      <input
        type="text"
        autoFocus
        data-note-editor
        aria-label="Note"
        value={value}
        maxLength={120}
        onChange={(e) => setValue(cleanNote(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
        className="w-full rounded border border-white/25 bg-[#070f1a] px-1.5 py-0.5 text-[11px] text-white"
      />
      <div className="flex gap-1">
        <button
          type="button"
          data-note-save
          onClick={save}
          className="cursor-pointer rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#0b1727] hover:bg-white/90"
        >
          Done
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded border border-white/20 bg-white/[.06] px-1.5 py-0.5 text-[10px] font-semibold text-white/85 hover:bg-red-500/15 hover:text-red-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** 这个人最近排过的班：这一周里已经有的 + 这台浏览器记着的，去掉重复。 */
function AddShiftForCell({
  weekStart,
  date,
  employee,
  shiftTypes,
  slots,
  workWindow,
  onSubmit,
  onSubmitTimeOff,
  onClose,
}: {
  weekStart: string;
  date: string;
  employee: ScheduleEmployee | null;
  shiftTypes: ScheduleShiftType[];
  slots: ScheduleSlot[];
  workWindow: { start_time: string; end_time: string };
  onSubmit: (input: AddShiftInput) => void;
  onSubmitTimeOff?: (input: AddTimeOffInput) => Promise<string | null>;
  onClose: () => void;
}) {
  const [recents] = useState<RecentShift[]>(() => {
    if (!employee) return [];
    const fromWeek = slots
      .filter((s) => s.employee_id === employee.id)
      .map((s) => ({
        type: s.shift_type,
        start: s.start_time,
        end: s.end_time,
      }));
    const seen = new Set<string>();
    return [...fromWeek, ...readRecentShifts(employee.id)]
      .filter((r) => {
        const k = `${r.type}|${r.start}|${r.end}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 8);
  });
  return (
    <AddShiftDialog
      weekStart={weekStart}
      date={date}
      employeeName={employee?.name ?? null}
      shiftTypes={shiftTypes}
      recents={recents}
      defaultStart={workWindow.start_time}
      defaultEnd={workWindow.end_time}
      onSubmit={onSubmit}
      onSubmitTimeOff={onSubmitTimeOff}
      onClose={onClose}
    />
  );
}
