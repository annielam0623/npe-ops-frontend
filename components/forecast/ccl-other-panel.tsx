import type { ForecastCrewLine } from "@/types";

import { composeReadableLine, formatLongDate } from "./config";

/**
 * CCL 发的、挂不上任何路线的行（Private Tour、读不懂的行）——不在任何 block 里，默认收起的小面板，
 * 按日期分组。接口「只有真的有行的日期才会出现在这里」，这里再防御性地过滤一次空数组。
 */
export function CclOtherPanel({
  cclOther,
}: {
  cclOther: Record<string, ForecastCrewLine[]>;
}) {
  const dates = Object.keys(cclOther)
    .filter((d) => (cclOther[d]?.length ?? 0) > 0)
    .sort();

  if (!dates.length) return null;

  return (
    <details className="rounded-[14px] border border-white/10 bg-white/[.032] px-5 py-4 text-sm">
      <summary className="cursor-pointer font-semibold text-white/80">
        CCL lines not matched to a route ({dates.length} day
        {dates.length === 1 ? "" : "s"})
      </summary>
      <div className="mt-3 space-y-3">
        {dates.map((date) => (
          <div key={date}>
            <div className="text-xs font-semibold text-white/50">
              {formatLongDate(date)}
            </div>
            <ul className="mt-1 space-y-0.5 pl-4 text-white/70">
              {cclOther[date].map((line, i) => (
                <li key={i} className="list-disc">
                  {composeReadableLine(line)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
