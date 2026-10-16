import { cn } from "@/lib/utils";
import type { WeekScheduleRow } from "@/types";

/**
 * Dashboard 上的本周排班小表（只读，D5「员工能看整周已发布的排班」）。
 * ⚠️ 预览用：阶段二（在线排班）的数据结构是 d3 在另一条分支上定的，这里先用占位形状展示版式，
 * 字段名等阶段二接口定了要对一遍，不是最终形状。
 */
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SHIFT_CLASS: Record<WeekScheduleRow["days"][number]["shift"], string> = {
  open: "border-[#c8a24a]/50 bg-[#c8a24a]/[.14] text-[#e8c878]",
  mid: "border-[#8a6fd9]/50 bg-[#8a6fd9]/[.14] text-[#b4a3ef]",
  close: "border-[#5b9bd9]/50 bg-[#5b9bd9]/[.14] text-[#8fc0ea]",
  off: "border-white/10 bg-white/[.02] text-white/35",
};

export function WeekScheduleWidget({
  weekLabel,
  dayDates,
  todayIndex,
  rows,
}: {
  weekLabel: string;
  dayDates: string[];
  todayIndex: number;
  rows: WeekScheduleRow[];
}) {
  return (
    <section
      aria-label="Schedule"
      className="rounded-[16px] border border-white/10 bg-white/[.032] p-[18px]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13.5px] font-bold">Schedule · {weekLabel}</h2>
        <a
          href="/schedule"
          className="text-[12px] font-semibold text-[#38bdf8] hover:text-[#7dd3fc]"
        >
          Edit schedule →
        </a>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-[11.5px]">
          <thead>
            <tr>
              <th className="w-[72px] p-1 text-left font-semibold text-white/40">
                Staff
              </th>
              {DAY_LABELS.map((d, i) => (
                <th
                  key={d}
                  className={cn(
                    "p-1 text-center font-semibold whitespace-nowrap",
                    i === todayIndex ? "text-[#38bdf8]" : "text-white/40",
                  )}
                >
                  {d} {dayDates[i]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.username}>
                <td className="p-1 pr-2 font-semibold whitespace-nowrap text-white/75">
                  {row.display_name}
                </td>
                {row.days.map((day, i) => (
                  <td
                    key={i}
                    className={cn(
                      "p-1 text-center",
                      i === todayIndex && "bg-[#38bdf8]/[.06]",
                    )}
                  >
                    <div
                      className={cn(
                        "mx-auto flex max-w-[76px] flex-col items-center rounded-[8px] border px-1 py-[3px] leading-[1.25]",
                        SHIFT_CLASS[day.shift],
                      )}
                    >
                      <span className="font-bold whitespace-nowrap capitalize">
                        {day.shift === "off" ? "Off" : day.shift}
                      </span>
                      {day.time ? (
                        <span className="text-[10px] whitespace-nowrap opacity-80">
                          {day.time}
                        </span>
                      ) : null}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
