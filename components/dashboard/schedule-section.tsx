"use client";

import { useCallback, useEffect, useState } from "react";

import { OffCard } from "@/components/schedule/week-grid";
import {
  DAY_LABELS,
  personDotColor,
  shiftCardClass,
} from "@/components/schedule/config";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { laToday, shiftYmd, weekStartYmd } from "@/lib/la-date";
import {
  fetchScheduleEmployees,
  fetchScheduleSettings,
  fetchScheduleWeek,
} from "@/lib/schedule-api";
import { formatClock } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import type {
  ScheduleEmployee,
  ScheduleSettings,
  ScheduleSlot,
  ScheduleWeek,
} from "@/types";

import type { BlockGate } from "./widget-gates";

/** 名字一列 104px、每天一列 122px、格子高约 56px（Annie 2026-10-18 看预览定）。 */
const COLS = "grid-cols-[104px_repeat(7,122px)]";

type Shared = {
  settings: ScheduleSettings;
  employees: ScheduleEmployee[];
  meName: string | null;
};

type WeekState =
  | { kind: "loading" }
  | { kind: "not_published" }
  | { kind: "error"; message: string }
  | { kind: "ready"; week: ScheduleWeek };

function rangeLabel(weekStart: string): string {
  const fmt = (ymd: string) =>
    new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(weekStart)} – ${fmt(shiftYmd(weekStart, 6))}`;
}

/**
 * Dashboard 上的排班表：单独一块、占整行（不再和任务框并排，Annie 2026-10-18 看预览定）。
 * 只读，一行一个人、一列一天（版式同排班页），只显示已发布的周；改排班去 /schedule。
 * 不依赖任务接口：直接读排班接口，任务框没数据时这一块照样显示。
 */
export function ScheduleSection({
  onUnauthorized,
  gate,
}: {
  onUnauthorized: () => void;
  /** Super Admin 的「谁看得到」控件（key dashboard_week_schedule）；员工看不到时虚线框。 */
  gate?: BlockGate;
}) {
  const [shared, setShared] = useState<Shared | null>(null);
  const [hidden, setHidden] = useState(false);
  const [thisWeek] = useState(() => weekStartYmd(laToday()));
  const [weekStart, setWeekStart] = useState(thisWeek);
  const [week, setWeek] = useState<WeekState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  // 设置 + 名单 + 自己是谁：和具体哪一周无关，加载一次。
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      try {
        const [me, settings, employees] = await Promise.all([
          fetchCurrentUser(signal),
          fetchScheduleSettings(signal),
          fetchScheduleEmployees(signal),
        ]);
        if (signal.aborted) return;
        setShared({
          settings,
          employees: employees.filter((e) => e.is_active),
          meName: me.display_name?.trim().toLowerCase() ?? null,
        });
      } catch (error) {
        if (signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else if (isStatus(error, 403) || isStatus(error, 404)) setHidden(true);
        else setWeek({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [onUnauthorized, reloadKey]);

  const loadWeek = useCallback(
    async (signal: AbortSignal) => {
      setWeek({ kind: "loading" });
      try {
        const data = await fetchScheduleWeek(weekStart, signal);
        if (signal.aborted) return;
        // 主管读一个没人排过的周后端会顺手建草稿：Dashboard 只给看已发布的，草稿一律当「还没发布」。
        setWeek(
          data.status === "published"
            ? { kind: "ready", week: data }
            : { kind: "not_published" },
        );
      } catch (error) {
        if (signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else if (isStatus(error, 403)) setWeek({ kind: "not_published" });
        else setWeek({ kind: "error", message: describeError(error) });
      }
    },
    [weekStart, onUnauthorized],
  );

  useEffect(() => {
    if (!shared) return;
    const controller = new AbortController();
    void loadWeek(controller.signal);
    return () => controller.abort();
  }, [shared, loadWeek, reloadKey]);

  if (hidden) return null;

  const isThisWeek = weekStart === thisWeek;
  return (
    <section
      aria-label="Schedule"
      data-dashboard-schedule
      data-staff-hidden={gate?.hiddenFromStaff || undefined}
      className={cn(
        "db-section mb-[18px] rounded-[16px] border p-[18px]",
        gate?.hiddenFromStaff
          ? "border-dashed border-[#fbbf24]/50"
          : "border-white/[.14]",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="db-title text-[15px]">
          Schedule · {rangeLabel(weekStart)}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {gate?.staffSwitch ? (
            <span className="mr-2">{gate.staffSwitch}</span>
          ) : null}
          <WeekPill active={isThisWeek} onClick={() => setWeekStart(thisWeek)}>
            This week
          </WeekPill>
          <WeekPill
            active={weekStart === shiftYmd(thisWeek, 7)}
            onClick={() => setWeekStart(shiftYmd(thisWeek, 7))}
          >
            Next week
          </WeekPill>
          <a
            href={`/schedule?week=${weekStart}`}
            className="ml-1.5 text-[12.5px] font-semibold text-[#38bdf8] hover:text-[#7dd3fc]"
          >
            Open schedule →
          </a>
        </div>
      </div>
      {week.kind === "loading" || !shared ? (
        week.kind === "error" ? (
          <ErrorLine
            message={week.message}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        ) : (
          <p className="text-[12.5px] text-white/60">Loading…</p>
        )
      ) : week.kind === "not_published" ? (
        <p className="text-[13px] text-white/70">
          {isThisWeek ? "This" : "Next"} week&apos;s schedule hasn&apos;t been
          published yet.
        </p>
      ) : week.kind === "error" ? (
        <ErrorLine
          message={week.message}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : (
        <ScheduleTable weekStart={weekStart} week={week.week} shared={shared} />
      )}
    </section>
  );
}

function WeekPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-[8px] border px-3 py-1 text-[12px] font-bold text-white transition",
        active
          ? "border-sky-400/50 bg-sky-400/[.15] text-sky-300"
          : "border-white/20 hover:bg-white/[.08]",
      )}
    >
      {children}
    </button>
  );
}

function ErrorLine({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <p className="text-[12.5px] text-[#fca5a5]">
      Could not load the schedule: {message}{" "}
      <button
        type="button"
        onClick={onRetry}
        className="cursor-pointer text-[#38bdf8] hover:underline"
      >
        Retry
      </button>
    </p>
  );
}

function ScheduleTable({
  weekStart,
  week,
  shared,
}: {
  weekStart: string;
  week: ScheduleWeek;
  shared: Shared;
}) {
  const dates = DAY_LABELS.map((_, i) => shiftYmd(weekStart, i));
  const today = laToday();
  const label = (key: string) =>
    shared.settings.shift_types.find((t) => t.key === key)?.label ?? key;

  // 自己对应的那一行固定在最上面（按名字对名单，同排班页）。
  const me = shared.meName
    ? shared.employees.find(
        (e) => e.name.trim().toLowerCase() === shared.meName,
      )
    : undefined;
  const employees = me
    ? [me, ...shared.employees.filter((e) => e.id !== me.id)]
    : shared.employees;
  const unassigned = week.slots.filter((s) => s.employee_id == null);

  function cellSlots(employeeId: number | null, date: string): ScheduleSlot[] {
    return week.slots.filter(
      (s) => s.employee_id === employeeId && s.date === date,
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className={cn("grid w-max gap-[2px]", COLS)}>
        <div className="pb-1.5 pl-[22px] text-[11px] font-bold tracking-[.06em] text-white/90 uppercase">
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

        {unassigned.length > 0 ? (
          <>
            <NameCell tint="bg-red-500/[.08]">
              <span className="text-[15px] leading-tight font-bold text-red-200">
                Unassigned
              </span>
            </NameCell>
            {dates.map((date) => (
              <Cell key={date} today={date === today}>
                {cellSlots(null, date).map((s) => (
                  <ShiftCard key={s.id} slot={s} label={label(s.shift_type)} />
                ))}
              </Cell>
            ))}
          </>
        ) : null}

        {employees.map((e) => (
          <PersonCells
            key={e.id}
            employee={e}
            mine={e.id === me?.id}
            dates={dates}
            today={today}
            slotsFor={(date) => cellSlots(e.id, date)}
            label={label}
          />
        ))}
      </div>
    </div>
  );
}

function PersonCells({
  employee,
  mine,
  dates,
  today,
  slotsFor,
  label,
}: {
  employee: ScheduleEmployee;
  mine: boolean;
  dates: string[];
  today: string;
  slotsFor: (date: string) => ScheduleSlot[];
  label: (key: string) => string;
}) {
  return (
    <>
      <NameCell tint={mine ? "bg-sky-400/[.12]" : "bg-transparent"}>
        <span className="flex items-center gap-[7px] text-[15px] leading-tight font-bold text-white">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: personDotColor(employee.id) }}
          />
          <span className="min-w-0 break-words">{employee.name}</span>
        </span>
      </NameCell>
      {dates.map((date) => {
        const slots = slotsFor(date);
        return (
          <Cell key={date} today={date === today} mine={mine}>
            {slots.length === 0 ? <OffCard /> : null}
            {slots.map((s) => (
              <ShiftCard key={s.id} slot={s} label={label(s.shift_type)} />
            ))}
          </Cell>
        );
      })}
    </>
  );
}

function NameCell({
  tint,
  children,
}: {
  tint: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[56px] flex-col justify-center rounded-[6px] px-2",
        tint,
      )}
    >
      {children}
    </div>
  );
}

function Cell({
  today,
  mine,
  children,
}: {
  today: boolean;
  mine?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[56px] flex-col gap-[2px] rounded-[6px]",
        today && "bg-sky-400/[.05]",
        mine && "bg-sky-400/[.08]",
      )}
    >
      {children}
    </div>
  );
}

function ShiftCard({ slot, label }: { slot: ScheduleSlot; label: string }) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col justify-center gap-0.5 rounded-[6px] border px-2 py-1 text-[11px] leading-tight",
        slot.employee_id == null
          ? "border-dashed border-red-400/70 bg-red-500/[.1] text-red-200"
          : // 柔和玻璃块（preview v15 效果：半透明 + 描边）+ 按班次换色（Annie 2026-10-21：
            // 「我当时探讨的是色块的效果不是颜色」，玻璃质感保留，颜色改回按班次区分。
            shiftCardClass(slot.shift_type),
      )}
    >
      <b className="text-[12.5px]">{label}</b>
      <span className="font-mono text-[10px] font-semibold tracking-[-.2px] whitespace-nowrap text-white">
        {formatClock(slot.start_time)} – {formatClock(slot.end_time)}
      </span>
    </div>
  );
}
