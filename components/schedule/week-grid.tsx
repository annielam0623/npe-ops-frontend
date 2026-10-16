"use client";

import { useEffect, useRef, useState } from "react";

import { formatClock, hasBadTimeRange } from "@/lib/schedule-time";
import { shiftYmd } from "@/lib/la-date";
import { cn } from "@/lib/utils";
import type {
  ScheduleEmployee,
  ScheduleShiftType,
  ScheduleSlot,
} from "@/types";

import { DAY_LABELS, personDotColor, shiftColorClass } from "./config";

/** "roster" 或某个时段的 id——「选中谁、从哪选的」，用来在点第二下时知道原来那格要不要清空。 */
type Selection = { employeeId: number; origin: "roster" | number } | null;

interface WeekGridProps {
  weekStart: string;
  employees: ScheduleEmployee[];
  slots: ScheduleSlot[];
  shiftTypes: ScheduleShiftType[];
  canEdit: boolean;
  onPlace: (
    employeeId: number,
    toSlotId: number,
    fromSlotId: number | null,
  ) => void;
  onCreateSlot: (date: string, shiftType: ScheduleShiftType) => void;
  onDeleteSlot: (slotId: number) => void;
  onUpdateTime: (slotId: number, startTime: string, endTime: string) => void;
}

export function WeekGrid({
  weekStart,
  employees,
  slots,
  shiftTypes,
  canEdit,
  onPlace,
  onCreateSlot,
  onDeleteSlot,
  onUpdateTime,
}: WeekGridProps) {
  const [selected, setSelected] = useState<Selection>(null);
  // 同一时间只能有一个时段在改时间（切去改别的 / 点外面 = 退出不存，不触发整页重画）。
  const [editingSlotId, setEditingSlotId] = useState<number | null>(null);
  const [openAddMenuDate, setOpenAddMenuDate] = useState<string | null>(null);

  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const dates = DAY_LABELS.map((_, i) => shiftYmd(weekStart, i));

  function toggleSelect(employeeId: number, origin: "roster" | number) {
    setSelected((prev) =>
      prev && prev.employeeId === employeeId && prev.origin === origin
        ? null
        : { employeeId, origin },
    );
  }

  function place(toSlotId: number) {
    if (!selected) return;
    onPlace(
      selected.employeeId,
      toSlotId,
      selected.origin === "roster" ? null : selected.origin,
    );
    setSelected(null);
  }

  return (
    <div>
      {canEdit ? (
        <>
          <div className="mb-1 flex flex-wrap items-center gap-2 rounded-[12px] border border-white/10 bg-white/[.04] px-3.5 py-3">
            <span className="mr-1 text-[11px] font-semibold tracking-[.06em] text-white/35 uppercase">
              Employees
            </span>
            {employees.map((e) => (
              <PersonChip
                key={e.id}
                employee={e}
                selected={
                  selected?.employeeId === e.id && selected.origin === "roster"
                }
                draggable
                onDragStart={(ev) => {
                  ev.dataTransfer.setData("text/employee", String(e.id));
                  ev.dataTransfer.setData("text/origin", "roster");
                }}
                onClick={() => toggleSelect(e.id, "roster")}
              />
            ))}
          </div>
          <p className="mb-4 min-h-[1.4em] text-[11.5px] text-sky-300">
            {selected
              ? `${employeeById.get(selected.employeeId)?.name} selected — click a slot to place them, or click their name again to cancel.`
              : " "}
          </p>
        </>
      ) : null}

      <div className="sch-week-grid grid grid-cols-[repeat(7,140px)] gap-2.5 overflow-x-auto pb-1">
        {dates.map((date, i) => {
          const daySlots = slots.filter((s) => s.date === date);
          return (
            <div key={date} className="flex flex-col gap-2">
              <div className="pb-0.5 text-center">
                <div className="text-[11px] font-bold tracking-[.04em] text-white/55 uppercase">
                  {DAY_LABELS[i]}
                </div>
                <div className="font-mono text-[11px] text-white/35">
                  {date.slice(5).replace("-", "/")}
                </div>
              </div>

              {daySlots.map((slot) => (
                <SlotCard
                  key={slot.id}
                  slot={slot}
                  employee={
                    slot.employee_id != null
                      ? employeeById.get(slot.employee_id)
                      : undefined
                  }
                  shiftTypes={shiftTypes}
                  canEdit={canEdit}
                  isSelectedOccupant={
                    selected?.origin === slot.id &&
                    selected.employeeId === slot.employee_id
                  }
                  placeable={!!selected}
                  editing={editingSlotId === slot.id}
                  onStartEdit={() => setEditingSlotId(slot.id)}
                  onStopEdit={() => setEditingSlotId(null)}
                  onSaveTime={(start, end) => onUpdateTime(slot.id, start, end)}
                  onRemove={() => onDeleteSlot(slot.id)}
                  onSelectOccupant={() =>
                    slot.employee_id != null &&
                    toggleSelect(slot.employee_id, slot.id)
                  }
                  onCardClick={() => place(slot.id)}
                  onDrop={(employeeId, origin) =>
                    onPlace(
                      employeeId,
                      slot.id,
                      origin === "roster" ? null : origin,
                    )
                  }
                />
              ))}

              {canEdit ? (
                <AddSlot
                  open={openAddMenuDate === date}
                  shiftTypes={shiftTypes.filter((t) => t.is_active)}
                  onToggle={() =>
                    setOpenAddMenuDate((d) => (d === date ? null : date))
                  }
                  onPick={(type) => {
                    onCreateSlot(date, type);
                    setOpenAddMenuDate(null);
                  }}
                />
              ) : daySlots.length === 0 ? (
                <p className="px-1 text-[11px] text-white/30">No shifts</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PersonChip({
  employee,
  selected,
  draggable,
  onDragStart,
  onClick,
}: {
  employee: ScheduleEmployee;
  selected: boolean;
  draggable: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold text-white/90 transition select-none",
        selected
          ? "border-sky-400/60 bg-sky-400/20 shadow-[0_0_0_2px_rgba(56,189,248,.35)]"
          : "border-white/10 bg-white/[.07] hover:border-sky-400/50",
      )}
    >
      <span
        className="h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ backgroundColor: personDotColor(employee.id) }}
      />
      {employee.name}
    </button>
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
      <div className="flex flex-col gap-1">
        {shiftTypes.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onPick(t)}
            className="cursor-pointer rounded-[8px] border border-white/10 bg-white/[.07] px-2 py-1.5 text-left text-[11.5px] font-semibold text-white/85 transition hover:border-sky-400/50 hover:text-sky-300"
          >
            {t.label} · {formatClock(t.default_start_time)}–
            {formatClock(t.default_end_time)}
          </button>
        ))}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className="cursor-pointer rounded-[10px] border border-dashed border-white/15 px-2 py-1.5 text-[11.5px] font-semibold text-white/35 transition hover:border-sky-400/50 hover:text-sky-300"
    >
      + slot
    </button>
  );
}

function SlotCard({
  slot,
  employee,
  shiftTypes,
  canEdit,
  isSelectedOccupant,
  placeable,
  editing,
  onStartEdit,
  onStopEdit,
  onSaveTime,
  onRemove,
  onSelectOccupant,
  onCardClick,
  onDrop,
}: {
  slot: ScheduleSlot;
  employee: ScheduleEmployee | undefined;
  shiftTypes: ScheduleShiftType[];
  canEdit: boolean;
  isSelectedOccupant: boolean;
  placeable: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onSaveTime: (start: string, end: string) => void;
  onRemove: () => void;
  onSelectOccupant: () => void;
  onCardClick: () => void;
  onDrop: (employeeId: number, origin: "roster" | number) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const label =
    shiftTypes.find((t) => t.key === slot.shift_type)?.label ?? slot.shift_type;
  const badRange = hasBadTimeRange(slot.start_time, slot.end_time);

  return (
    <div
      onClick={() => canEdit && placeable && onCardClick()}
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
              const employeeId = Number(
                e.dataTransfer.getData("text/employee"),
              );
              const originRaw = e.dataTransfer.getData("text/origin");
              if (!employeeId) return;
              onDrop(
                employeeId,
                originRaw === "roster" ? "roster" : Number(originRaw),
              );
            }
          : undefined
      }
      className={cn(
        "flex min-h-[64px] flex-col justify-center gap-1 rounded-[10px] border px-2.5 py-2 transition",
        employee
          ? "border-white/10 bg-white/[.04]"
          : "border-dashed border-red-400/60 bg-red-500/[.08]",
        canEdit && placeable && "cursor-pointer hover:border-sky-400/50",
        dragOver && "border-emerald-400/60 bg-emerald-400/[.14]",
        badRange && "border-amber-400/50 bg-amber-400/10",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={cn(
            "inline-block w-fit rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold",
            shiftColorClass(slot.shift_type),
          )}
        >
          {label}
        </span>
        {canEdit ? (
          <button
            type="button"
            title="Remove this slot"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="cursor-pointer rounded px-1 text-[13px] leading-none text-white/35 hover:bg-red-500/15 hover:text-red-300"
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
            "w-fit font-mono text-[10.5px] text-white/40",
            canEdit && "cursor-text hover:text-sky-300 hover:underline",
          )}
        >
          {formatClock(slot.start_time)} – {formatClock(slot.end_time)}
        </button>
      )}
      {badRange ? (
        <span className="text-[10px] leading-tight text-amber-200">
          End isn&apos;t after start
        </span>
      ) : null}

      {employee ? (
        <button
          type="button"
          draggable={canEdit}
          onDragStart={(e) => {
            e.dataTransfer.setData("text/employee", String(employee.id));
            e.dataTransfer.setData("text/origin", String(slot.id));
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (canEdit) onSelectOccupant();
          }}
          className={cn(
            "inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-white/90",
            canEdit && "cursor-pointer",
            isSelectedOccupant &&
              "rounded-md bg-sky-400/20 px-1 ring-2 ring-sky-400/60",
          )}
        >
          <span
            className="h-[7px] w-[7px] shrink-0 rounded-full"
            style={{ backgroundColor: personDotColor(employee.id) }}
          />
          {employee.name}
        </button>
      ) : (
        <span className="text-[11.5px] font-semibold text-red-300">
          — needs someone —
        </span>
      )}
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
        className="w-[78px] rounded border border-white/10 bg-[#070f1a] px-1 py-0.5 font-mono text-[10.5px] text-white/90"
      />
      <span className="text-white/35">–</span>
      <input
        type="time"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        className="w-[78px] rounded border border-white/10 bg-[#070f1a] px-1 py-0.5 font-mono text-[10.5px] text-white/90"
      />
      <button
        type="button"
        onClick={() => onSave(start, end)}
        className="cursor-pointer rounded border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-400/20"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="cursor-pointer rounded border border-white/10 bg-white/[.04] px-1.5 py-0.5 text-[10px] font-semibold text-white/60 hover:bg-red-500/15 hover:text-red-300"
      >
        Cancel
      </button>
    </div>
  );
}
