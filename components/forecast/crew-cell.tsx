import type { ForecastCrewDay, ForecastCrewLine } from "@/types";

import {
  composeReadableLine,
  formatLongDate,
  isPastDay,
  mainRouteName,
} from "./config";
import { CREW_ROW_BG, colLine } from "./styles";

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
  section,
  blockName,
  crewDay,
  onOpenEditor,
}: {
  day: string;
  today: string;
  manifestId: number;
  /** 这个块自己的 section（空串 = 主块）；配 manifestId 才是块的唯一身份。 */
  section: string;
  blockName: string;
  crewDay: ForecastCrewDay;
  onOpenEditor: () => void;
}) {
  const isToday = day === today;
  const baseClass = `border-t border-white/10 align-top text-[10px] leading-tight ${colLine(
    isToday,
  )}`;

  if (crewDay.source === "ccl") {
    return (
      <td
        data-day={day}
        data-block={manifestId}
        data-section={section}
        data-kind="crew-ccl"
        className={`${baseClass} px-1.5 py-1.5`}
        style={{ backgroundColor: CREW_ROW_BG }}
      >
        {crewDay.closed ? (
          <div className="text-amber-300/90">
            Closed{crewDay.closed_note ? `: ${crewDay.closed_note}` : ""}
          </div>
        ) : crewDay.lines.length ? (
          <div className="space-y-0.5 text-white">
            {crewDay.lines.map((line, i) => (
              <div key={i}>
                <CrewLineText line={line} />
              </div>
            ))}
          </div>
        ) : crewDay.in_main_block ? (
          <div className="text-white">
            See {mainRouteName(blockName, section)}
          </div>
        ) : (
          <div className="text-white">—</div>
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
        data-section={section}
        data-kind="crew-plan-past"
        className={`${baseClass} px-1.5 py-1.5 text-white`}
        style={{ backgroundColor: CREW_ROW_BG }}
      >
        {names.length ? (
          <div className="space-y-0.5">
            {names.map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </div>
        ) : (
          <div>—</div>
        )}
      </td>
    );
  }

  return (
    <td
      data-day={day}
      data-block={manifestId}
      data-section={section}
      data-kind="crew-plan"
      className={`${baseClass} p-0`}
      style={{ backgroundColor: CREW_ROW_BG }}
    >
      <button
        type="button"
        onClick={onOpenEditor}
        aria-label={`Edit guides — ${blockName}, ${formatLongDate(day)}`}
        className="group block w-full px-1.5 py-1.5 text-center hover:bg-white/[.06] focus:bg-white/[.08] focus:outline-none"
      >
        {names.length ? (
          <div className="space-y-0.5 text-white">
            {names.map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </div>
        ) : (
          <div className="text-white">—</div>
        )}
        <div className="mt-1 text-sky-300 opacity-0 group-hover:opacity-100 group-focus:opacity-100">
          + guide
        </div>
      </button>
    </td>
  );
}

/**
 * CCL 的一行；车上没 GPS（G63：车号对上 Settings → Vehicles 里没接 Samsara 的车）⇒ 车号标红，同 CCL 表。
 * 车号在拼好的文字里找得到就就地标红，找不到就在后面补一个红色车号。
 */
function CrewLineText({ line }: { line: ForecastCrewLine }) {
  const text = composeReadableLine(line);
  const vehicle = typeof line.vehicle === "string" ? line.vehicle.trim() : "";
  if (!line.no_gps || !vehicle) return <>{text}</>;
  const red = (
    <span
      data-no-gps
      className="font-semibold text-red-400"
      title="No GPS on this vehicle"
    >
      {vehicle}
    </span>
  );
  const at = text.indexOf(vehicle);
  if (at < 0) {
    return (
      <>
        {text} · {red}
      </>
    );
  }
  return (
    <>
      {text.slice(0, at)}
      {red}
      {text.slice(at + vehicle.length)}
    </>
  );
}
