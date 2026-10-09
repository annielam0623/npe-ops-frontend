import type { ForecastCrewDay } from "@/types";

import { composeReadableLine, formatLongDate, isPastDay } from "./config";
import { CREW_ROW_BG } from "./styles";

/**
 * 某个块某一天的 Driver / Guide 格子。
 * CCL 已经发过名单（source: "ccl"）：只读，不可点。
 * staff 自己排的（source: "plan"）：当天不是过去（判据同接口会拒的「过去的日子」）时可点，打开编辑框；
 * 过去的日子即使是 plan 来源也不给点——接口本来就会用「past day」拒掉，这里提前不让点，省一次失败请求。
 */
export function CrewCell({
  day,
  today,
  manifestId,
  blockName,
  crewDay,
  onOpenEditor,
}: {
  day: string;
  today: string;
  manifestId: number;
  blockName: string;
  crewDay: ForecastCrewDay;
  onOpenEditor: () => void;
}) {
  const isToday = day === today;
  const baseClass = `border-t border-white/10 align-top text-[11px] leading-tight ${
    isToday ? "ring-1 ring-inset ring-sky-400/50" : ""
  }`;

  if (crewDay.source === "ccl") {
    return (
      <td
        data-day={day}
        data-block={manifestId}
        data-kind="crew-ccl"
        className={`${baseClass} px-1.5 py-1.5`}
        style={{ backgroundColor: CREW_ROW_BG }}
      >
        <Tag label="CCL" tone="ccl" />
        {crewDay.closed ? (
          <div className="mt-1 text-amber-300/90">
            Closed{crewDay.closed_note ? `: ${crewDay.closed_note}` : ""}
          </div>
        ) : crewDay.lines.length ? (
          <div className="mt-1 space-y-0.5 text-white/70">
            {crewDay.lines.map((line, i) => (
              <div key={i}>{composeReadableLine(line)}</div>
            ))}
          </div>
        ) : (
          <div className="mt-1 text-white/30">—</div>
        )}
      </td>
    );
  }

  const names = crewDay.guides.map((g) => g.name);
  const past = isPastDay(day, today);

  if (past) {
    return (
      <td
        data-day={day}
        data-block={manifestId}
        data-kind="crew-plan-past"
        className={`${baseClass} px-1.5 py-1.5 text-white/40`}
        style={{ backgroundColor: CREW_ROW_BG }}
      >
        <Tag label="Plan" tone="plan-dim" />
        {names.length ? (
          <div className="mt-1 space-y-0.5">
            {names.map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </div>
        ) : (
          <div className="mt-1">—</div>
        )}
      </td>
    );
  }

  return (
    <td
      data-day={day}
      data-block={manifestId}
      data-kind="crew-plan"
      className={`${baseClass} p-0`}
      style={{ backgroundColor: CREW_ROW_BG }}
    >
      <button
        type="button"
        onClick={onOpenEditor}
        aria-label={`Edit guides — ${blockName}, ${formatLongDate(day)}`}
        className="group block w-full px-1.5 py-1.5 text-left hover:bg-white/[.06] focus:bg-white/[.08] focus:outline-none"
      >
        <Tag label="Plan" tone="plan" />
        {names.length ? (
          <div className="mt-1 space-y-0.5 text-white/85">
            {names.map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </div>
        ) : (
          <div className="mt-1 text-white/35">—</div>
        )}
        <div className="mt-1 text-sky-300 opacity-0 group-hover:opacity-100 group-focus:opacity-100">
          + guide
        </div>
      </button>
    </td>
  );
}

function Tag({
  label,
  tone,
}: {
  label: string;
  tone: "ccl" | "plan" | "plan-dim";
}) {
  const toneClass =
    tone === "ccl"
      ? "border-white/15 bg-white/[.08] text-white/60"
      : tone === "plan"
        ? "border-sky-400/30 bg-sky-400/15 text-sky-300"
        : "border-white/10 bg-white/[.04] text-white/35";
  return (
    <span
      className={`inline-block rounded-full border px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide ${toneClass}`}
    >
      {label}
    </span>
  );
}
