"use client";

import { useState } from "react";

import { shiftYmd } from "@/lib/la-date";
import { cn } from "@/lib/utils";

import { DAY_LABELS, shiftCardClass } from "./config";

const CHIP_MIME = "text/schedule-confirm-chip";

export interface BoardShift {
  key: string;
  label: string;
  /** 这一行的时间，如 "2:00 AM – 10:00 AM"（取这一周该班次第一个时段的）；没有就空。 */
  time: string;
}

export interface BoardPerson {
  name: string;
  /** 是不是正在看这页的人（名字边加一圈白线）。 */
  me?: boolean;
}

export interface BoardAddition {
  id: string | number;
  date: string;
  shift: string;
  name: string;
  /** draft = 还没发出去；pending = 等排班的人处理；approved 已变成正式的班；declined 被拒。 */
  status: "draft" | "pending" | "approved" | "declined";
  /** 右边的小键（排班的人那边：Approve / Decline）。 */
  actions?: React.ReactNode;
  onRemove?: () => void;
}

/**
 * 周三确认用的「班次 × 天」表（Annie 2026-10-19 看预览同意）：一行一个班次（Open / Mid / Close）、一列一天，
 * 格子里列出这个班次这一天的所有人；想加的人用亮黄色底挨在后面。列宽、班次颜色同排班页（config.ts）。
 * 员工页只读，只多一个可以放名字的动作（拖 / 点）；排班的人那边同一张表，亮黄色旁边有 Approve / Decline。
 */
export function ConfirmBoard({
  weekStart,
  shifts,
  people,
  additions,
  droppable,
  armed,
  onDropOn,
}: {
  weekStart: string;
  shifts: BoardShift[];
  /** key = `${date}|${shift_type}`。 */
  people: Record<string, BoardPerson[]>;
  additions: BoardAddition[];
  /** 能放名字（员工点了 Change 以后）。 */
  droppable?: boolean;
  /** 名字条已被点中：没有拖拽（手机）时点格子也能放。 */
  armed?: boolean;
  onDropOn?: (date: string, shift: string) => void;
}) {
  const [hot, setHot] = useState<string | null>(null);
  const dates = DAY_LABELS.map((_, i) => shiftYmd(weekStart, i));

  return (
    <div className="overflow-x-auto p-3" data-confirm-board>
      <div className="grid min-w-[940px] grid-cols-[130px_repeat(7,minmax(112px,1fr))] gap-[2px]">
        <div className="pb-1.5 pl-2 text-[11px] font-bold tracking-[.06em] text-white/90 uppercase">
          Shift
        </div>
        {dates.map((date, i) => (
          <div key={date} className="pb-1.5 text-center text-white/90">
            <div className="text-[11px] font-bold tracking-[.06em] uppercase">
              {DAY_LABELS[i]}
            </div>
            <div className="font-mono text-[10px] text-white/80">
              {date.slice(5).replace("-", "/")}
            </div>
          </div>
        ))}
        {shifts.map((s) => (
          <ShiftRow
            key={s.key}
            shift={s}
            dates={dates}
            people={people}
            additions={additions}
            droppable={!!droppable}
            armed={!!armed}
            hot={hot}
            setHot={setHot}
            onDropOn={onDropOn}
          />
        ))}
      </div>
    </div>
  );
}

function ShiftRow({
  shift,
  dates,
  people,
  additions,
  droppable,
  armed,
  hot,
  setHot,
  onDropOn,
}: {
  shift: BoardShift;
  dates: string[];
  people: Record<string, BoardPerson[]>;
  additions: BoardAddition[];
  droppable: boolean;
  armed: boolean;
  hot: string | null;
  setHot: (key: string | null) => void;
  onDropOn?: (date: string, shift: string) => void;
}) {
  const chip = shiftCardClass(shift.key);
  return (
    <>
      <div className="flex flex-col justify-center rounded-[6px] bg-[#0b1727] px-2 py-2">
        <span className="text-[16px] leading-tight font-bold text-white">
          {shift.label}
        </span>
        {shift.time ? (
          <span className="text-[10.5px] leading-tight text-white/70">
            {shift.time}
          </span>
        ) : null}
      </div>
      {dates.map((date) => {
        const key = `${date}|${shift.key}`;
        const here = people[key] ?? [];
        const adds = additions.filter(
          (a) => a.date === date && a.shift === shift.key,
        );
        const isHot = hot === key;
        return (
          <div
            key={key}
            data-cell={key}
            onDragOver={
              droppable
                ? (e) => {
                    if (!e.dataTransfer.types.includes(CHIP_MIME)) return;
                    e.preventDefault();
                    setHot(key);
                  }
                : undefined
            }
            onDragLeave={droppable ? () => setHot(null) : undefined}
            onDrop={
              droppable
                ? (e) => {
                    if (!e.dataTransfer.types.includes(CHIP_MIME)) return;
                    e.preventDefault();
                    setHot(null);
                    onDropOn?.(date, shift.key);
                  }
                : undefined
            }
            onClick={
              droppable && armed ? () => onDropOn?.(date, shift.key) : undefined
            }
            className={cn(
              "flex min-h-[78px] flex-col gap-1 rounded-[6px] bg-white/[.03] p-1",
              droppable && "outline-1 outline-amber-300/40 outline-dashed",
              droppable && armed && "cursor-pointer",
              isHot &&
                "bg-amber-300/15 outline-2 outline-amber-300 outline-solid",
            )}
          >
            {here.map((p, i) => (
              <div
                key={`${p.name}-${i}`}
                data-person={p.name}
                className={cn(
                  "rounded-[6px] border px-[7px] py-[3px] text-[12px] font-semibold",
                  chip,
                  p.me && "ring-1 ring-white/60",
                )}
              >
                {p.name}
              </div>
            ))}
            {adds.map((a) => (
              <Added key={a.id} a={a} />
            ))}
          </div>
        );
      })}
    </>
  );
}

function Added({ a }: { a: BoardAddition }) {
  if (a.status === "approved") return null;
  const declined = a.status === "declined";
  return (
    <div
      data-added={a.status}
      className={cn(
        "flex items-center justify-between gap-1.5 rounded-[6px] border px-[7px] py-[3px] text-[12px] font-semibold",
        declined
          ? "border-white/15 bg-white/[.04] text-white/40 line-through"
          : "border-[#fcd34d] bg-[#fcd34d] text-[#1c1400]",
      )}
    >
      <span>
        {a.name}{" "}
        <small className="font-medium no-underline opacity-80">
          {declined ? "declined" : a.status === "draft" ? "(you)" : "asked"}
        </small>
      </span>
      {a.onRemove ? (
        <button
          type="button"
          aria-label="Remove"
          onClick={a.onRemove}
          className="cursor-pointer text-[12px] leading-none"
        >
          ✕
        </button>
      ) : null}
      {a.actions}
    </div>
  );
}

export { CHIP_MIME };
