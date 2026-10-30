"use client";

import { useEffect, useState } from "react";

import {
  personDotColor,
  shiftCardClass,
  TIME_OFF_LABEL,
} from "@/components/schedule/config";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { laToday, weekStartYmd } from "@/lib/la-date";
import {
  fetchScheduleEmployees,
  fetchScheduleSettings,
  fetchScheduleWeek,
} from "@/lib/schedule-api";
import { formatClock } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";
import type { ScheduleEmployee, ScheduleSettings, ScheduleWeek } from "@/types";

type State =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "not_published" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      settings: ScheduleSettings;
      employees: ScheduleEmployee[];
      week: ScheduleWeek;
      meName: string | null;
    };

/**
 * Today's team（Annie 2026-10-24「可以只显示今日，整周的放在页面最下面」，样子照 K2 样稿的 s-team）：
 * 今天谁上什么班，每人一行：名字 + 班次（Open / Mid / Close，带时间）；今天没排班的人写 Off，有休假写 PTO / Sick / Personal。
 * 整行宽，放在任务框和 Daily Operation Report 之间（05 2026-10-25 定）；「Full week ↗」滚到页面最底部的整周排班块。
 * 只读已发布的周；排班接口 403 / 404 时整块不画（同 ScheduleSection）。
 */
export function TodayTeamSection({
  onUnauthorized,
  staffSwitch,
  hiddenFromStaff,
}: {
  onUnauthorized: () => void;
  /** Super Admin 的「员工可见」开关（新板块默认只 Super Admin 可见，Annie 2026-10-25）；其他人不传。 */
  staffSwitch?: React.ReactNode;
  /** 还没放给员工（Super Admin 才看得到）：黄色虚线框，同 DOR。 */
  hiddenFromStaff?: boolean;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [today] = useState(() => laToday());

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setState({ kind: "loading" });
    (async () => {
      try {
        const [me, settings, employees, week] = await Promise.all([
          fetchCurrentUser(signal),
          fetchScheduleSettings(signal),
          fetchScheduleEmployees(signal),
          fetchScheduleWeek(weekStartYmd(today), signal),
        ]);
        if (signal.aborted) return;
        // 主管读没人排过的周后端会顺手建草稿：Dashboard 只给看已发布的。
        if (week.status !== "published") {
          setState({ kind: "not_published" });
          return;
        }
        setState({
          kind: "ready",
          settings,
          // 测试用的人（is_test，Annie 2026-10-30「不要把这两个人显示在dashbroad里」）：后端没滤也不出。
          employees: employees.filter((e) => e.is_active && !e.is_test),
          week,
          meName: me.display_name?.trim().toLowerCase() ?? null,
        });
      } catch (error) {
        if (signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else if (isStatus(error, 403) || isStatus(error, 404))
          setState({ kind: "hidden" });
        else setState({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [onUnauthorized, reloadKey, today]);

  if (state.kind === "hidden") return null;

  return (
    <section
      aria-label="Today's team"
      data-today-team
      data-staff-hidden={hiddenFromStaff || undefined}
      className={cn(
        "db-section mb-[18px] rounded-[16px] border p-[18px]",
        hiddenFromStaff
          ? "border-dashed border-[#fbbf24]/50"
          : "border-white/[.14]",
      )}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="db-title text-[15px]">Today&apos;s team</h2>
        <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
          {staffSwitch}
          <button
            type="button"
            onClick={() =>
              document
                .querySelector("[data-dashboard-schedule]")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            className="cursor-pointer text-[12.5px] font-semibold text-[#38bdf8] hover:text-[#7dd3fc]"
          >
            Full week ↗
          </button>
        </span>
      </div>
      {state.kind === "loading" ? (
        <p className="text-[12.5px] text-white/60">Loading…</p>
      ) : state.kind === "not_published" ? (
        <p className="text-[13px] text-white/70">
          Today&apos;s schedule hasn&apos;t been published yet.
        </p>
      ) : state.kind === "error" ? (
        <p className="text-[12.5px] text-[#fca5a5]">
          Could not load today&apos;s team: {state.message}{" "}
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="cursor-pointer text-[#38bdf8] hover:underline"
          >
            Retry
          </button>
        </p>
      ) : (
        <TeamRows state={state} today={today} />
      )}
    </section>
  );
}

function TeamRows({
  state,
  today,
}: {
  state: Extract<State, { kind: "ready" }>;
  today: string;
}) {
  const label = (key: string) =>
    state.settings.shift_types.find((t) => t.key === key)?.label ?? key;
  const slots = state.week.slots.filter((s) => s.date === today);
  // 今天上班的人在前（按上班时间），没排班的人在后；自己那一行淡蓝底（同排班块）。
  const firstStart = (id: number) =>
    slots
      .filter((s) => s.employee_id === id)
      .map((s) => s.start_time ?? "99:99")
      .sort()[0] ?? null;
  const people = [...state.employees].sort((a, b) => {
    const sa = firstStart(a.id);
    const sb = firstStart(b.id);
    if (sa && sb) return sa.localeCompare(sb);
    return sa ? -1 : sb ? 1 : 0;
  });

  return (
    <ul className="flex flex-col">
      {people.map((e) => {
        const mine = e.name.trim().toLowerCase() === state.meName;
        const mySlots = slots.filter((s) => s.employee_id === e.id);
        const off = (state.week.time_off ?? []).find(
          (t) => t.employee_id === e.id && t.date === today,
        );
        return (
          <li
            key={e.id}
            data-team-row={e.name}
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[.08] px-2 py-[7px] first:border-t-0",
              mine && "rounded-[6px] bg-sky-400/[.1]",
            )}
          >
            <span className="flex min-w-[140px] flex-1 items-center gap-[7px] text-[13.5px] font-semibold text-white">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: personDotColor(e.id) }}
              />
              {e.name}
            </span>
            {mySlots.length === 0 ? (
              <span
                data-team-off
                className="min-w-[62px] rounded-[6px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.14)] px-2.5 py-px text-center text-[11.5px] font-bold text-[#fde68a]"
              >
                {off ? (TIME_OFF_LABEL[off.kind] ?? "Off") : "Off"}
              </span>
            ) : (
              mySlots.map((s) => (
                <span
                  key={s.id}
                  data-team-shift={s.shift_type}
                  className={cn(
                    "flex items-baseline gap-2 rounded-[6px] border px-2.5 py-px text-[11.5px] font-bold",
                    shiftCardClass(s.shift_type),
                  )}
                >
                  {label(s.shift_type)}
                  <span className="font-mono text-[10.5px] font-semibold text-white">
                    {formatClock(s.start_time)} – {formatClock(s.end_time)}
                  </span>
                </span>
              ))
            )}
          </li>
        );
      })}
    </ul>
  );
}
