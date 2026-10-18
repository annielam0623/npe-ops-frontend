"use client";

import { useEffect, useRef, useState } from "react";

import { laToday, shiftYmd } from "@/lib/la-date";
import { formatClock, hasBadTimeRange } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import type {
  ScheduleEmployee,
  ScheduleShiftType,
  ScheduleSlot,
} from "@/types";

import { DAY_LABELS, personDotColor, shiftCardClass } from "./config";

interface WeekGridProps {
  weekStart: string;
  /** 在职的人；已经按「自己在最上面」排好。 */
  employees: ScheduleEmployee[];
  /** 当前登录的人对应的名单项（按名字对上），没对上就是 null。 */
  meId: number | null;
  slots: ScheduleSlot[];
  shiftTypes: ScheduleShiftType[];
  canEdit: boolean;
  /** 把一个时段换给某个人（`null` = 清空，变回 Unassigned）。 */
  onAssign: (slotId: number, employeeId: number | null) => void;
  /** 在某一天加一个时段，`employeeId` 为 null 就是还没人的时段。 */
  onCreateSlot: (
    date: string,
    shiftType: ScheduleShiftType,
    employeeId: number | null,
  ) => void;
  onDeleteSlot: (slotId: number) => void;
  onUpdateTime: (slotId: number, startTime: string, endTime: string) => void;
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
  shiftTypes,
  canEdit,
  onAssign,
  onCreateSlot,
  onDeleteSlot,
  onUpdateTime,
}: WeekGridProps) {
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  // 同一时间只能有一个时段在改时间（切去改别的 / 点外面 = 退出不存）。
  const [editingSlotId, setEditingSlotId] = useState<number | null>(null);
  const [addMenuKey, setAddMenuKey] = useState<string | null>(null);

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
    // 时段是属于某一天的：只能换给同一天的人，拖到别的天不动。
    if (!slot || slot.date !== date) return;
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
    const key = `${employeeId ?? "needs"}|${date}`;
    const targetable =
      canEdit && selectedSlot != null && selectedSlot.date === date;
    return (
      <Cell
        key={key}
        cellKey={key}
        today={date === today}
        mine={employeeId != null && employeeId === meId}
        needs={employeeId == null}
        targetable={targetable}
        canEdit={canEdit}
        onClick={() => clickCell(date, employeeId)}
        onDropSlot={(slotId) => dropOn(slotId, date, employeeId)}
      >
        {cellSlots.length === 0 && employeeId != null ? <OffCard /> : null}
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
            editing={editingSlotId === slot.id}
            onSelect={() =>
              setSelectedSlotId((id) => (id === slot.id ? null : slot.id))
            }
            onStartEdit={() => setEditingSlotId(slot.id)}
            onStopEdit={() => setEditingSlotId(null)}
            onSaveTime={(start, end) => onUpdateTime(slot.id, start, end)}
            onRemove={() => onDeleteSlot(slot.id)}
          />
        ))}
        {canEdit ? (
          <AddSlot
            open={addMenuKey === key}
            shiftTypes={activeShiftTypes}
            onToggle={() => setAddMenuKey((k) => (k === key ? null : key))}
            onPick={(type) => {
              onCreateSlot(date, type, employeeId);
              setAddMenuKey(null);
            }}
          />
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
          />
        ))}
      </div>
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
}: {
  employee: ScheduleEmployee;
  mine: boolean;
  cells: React.ReactNode[];
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
      </div>
      {cells}
    </>
  );
}

function Cell({
  cellKey,
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
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      data-cell={cellKey}
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
function OffCard() {
  return (
    <div
      data-off
      className="flex flex-1 items-center rounded-[6px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.14)] px-2 py-1 text-[12.5px] leading-tight font-bold text-[#fde68a]"
    >
      Off
    </div>
  );
}

function AddSlot({
  open,
  shiftTypes,
  onToggle,
  onPick,
}: {
  open: boolean;
  shiftTypes: ScheduleShiftType[];
  onToggle: () => void;
  onPick: (type: ScheduleShiftType) => void;
}) {
  if (open) {
    return (
      <div
        className="flex flex-col gap-[2px]"
        onClick={(e) => e.stopPropagation()}
      >
        {shiftTypes.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onPick(t)}
            className="cursor-pointer rounded-[6px] border border-white/20 bg-white/[.08] px-2 py-1 text-left text-[11.5px] font-semibold text-white hover:border-sky-400/60 hover:text-sky-200"
          >
            + {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onToggle}
          className="cursor-pointer rounded-[6px] px-2 py-0.5 text-left text-[11px] text-white/70 hover:text-white"
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title="Add a shift"
      aria-label="Add a shift"
      // 不占版面：悬停（或键盘聚焦）这一格才出现在右下角，手机没有悬停就一直淡淡地显示；表里不再每格都多一行「+」。
      className="absolute right-0.5 bottom-0.5 cursor-pointer rounded bg-[#0b1727]/80 px-1.5 py-0.5 text-[13px] leading-none font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/15 hover:text-sky-200 focus:opacity-100 [@media(hover:none)]:opacity-60"
    >
      +
    </button>
  );
}

function SlotCard({
  slot,
  label,
  canEdit,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onStopEdit,
  onSaveTime,
  onRemove,
}: {
  slot: ScheduleSlot;
  label: string;
  canEdit: boolean;
  selected: boolean;
  editing: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onSaveTime: (start: string, end: string) => void;
  onRemove: () => void;
}) {
  const badRange = hasBadTimeRange(slot.start_time, slot.end_time);
  const needs = slot.employee_id == null;
  return (
    <div
      draggable={canEdit && !editing}
      onDragStart={(e) => {
        e.dataTransfer.setData(SLOT_MIME, String(slot.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => {
        if (!canEdit || editing) return;
        e.stopPropagation();
        onSelect();
      }}
      data-slot-id={slot.id}
      className={cn(
        "flex flex-1 flex-col justify-center gap-0.5 rounded-[6px] border px-2 py-1 text-[11px] leading-tight",
        needs
          ? "border-dashed border-red-400/70 bg-red-500/[.1] text-red-200"
          : shiftCardClass(slot.shift_type),
        badRange && "border-amber-400/60 bg-amber-400/[.12]",
        canEdit && "cursor-grab",
        selected && "ring-2 ring-sky-400/70",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <b className="text-[12.5px]">{label}</b>
        {canEdit ? (
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
      </div>
      {editing ? (
        <TimeEditor
          slot={slot}
          onSave={(s, e) => {
            onSaveTime(s, e);
            onStopEdit();
          }}
          onCancel={onStopEdit}
        />
      ) : (
        <button
          type="button"
          disabled={!canEdit}
          onClick={(e) => {
            e.stopPropagation();
            if (canEdit) onStartEdit();
          }}
          className={cn(
            "w-fit text-left font-mono text-[10.5px] font-semibold whitespace-nowrap text-white",
            canEdit && "cursor-text hover:text-sky-200 hover:underline",
          )}
        >
          {formatClock(slot.start_time)} – {formatClock(slot.end_time)}
        </button>
      )}
      {badRange ? (
        <span className="text-[10px] text-amber-200">
          End isn&apos;t after start
        </span>
      ) : null}
    </div>
  );
}

function TimeEditor({
  slot,
  onSave,
  onCancel,
}: {
  slot: ScheduleSlot;
  onSave: (start: string, end: string) => void;
  onCancel: () => void;
}) {
  const [start, setStart] = useState(slot.start_time);
  const [end, setEnd] = useState(slot.end_time);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点编辑框外面任何地方 = 退出不存，跟按 Cancel 一样安全（不会误点就存掉）。
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

  return (
    <div
      ref={rootRef}
      onClick={(e) => e.stopPropagation()}
      className="flex flex-wrap items-center gap-1"
    >
      <input
        type="time"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="w-[78px] rounded border border-white/20 bg-[#070f1a] px-1 py-0.5 font-mono text-[10.5px] text-white"
      />
      <span className="text-white/70">–</span>
      <input
        type="time"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        className="w-[78px] rounded border border-white/20 bg-[#070f1a] px-1 py-0.5 font-mono text-[10.5px] text-white"
      />
      <button
        type="button"
        onClick={() => onSave(start, end)}
        className="cursor-pointer rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-blue-400"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="cursor-pointer rounded border border-white/20 bg-white/[.06] px-1.5 py-0.5 text-[10px] font-semibold text-white/85 hover:bg-red-500/15 hover:text-red-200"
      >
        Cancel
      </button>
    </div>
  );
}
