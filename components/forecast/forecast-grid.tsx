import type { Forecast60Day } from "@/types";

import { CrewCell } from "./crew-cell";
import {
  formatHeaderDay,
  isAllZero,
  tierForTotal,
  tierSwatch,
  visibleSubRows,
} from "./config";
import {
  CREW_ROW_BG,
  DAY_COL_WIDTH,
  FIRST_COL_WIDTH,
  HEADER_BG,
  HEADER_TODAY_BG,
  SUB_ROW_BG,
  TOTAL_ROW_BG,
} from "./styles";

/**
 * 横向滚动的大表：一块一个巴士团路线，60 天。首列和表头 sticky（表格自己有固定高度、自己滚动，
 * 不跟页面滚动条争——sticky 的格子都显式写自己的背景色，见 styles.ts 顶部注释）。
 */
export function ForecastGrid({
  data,
  colorByVehicle,
  hideZero,
  onOpenEditor,
}: {
  data: Forecast60Day;
  colorByVehicle: boolean;
  hideZero: boolean;
  onOpenEditor: (manifestId: number, dayIndex: number) => void;
}) {
  const blocks = hideZero
    ? data.blocks.filter((b) => !isAllZero(b.total))
    : data.blocks;
  const useTiers = colorByVehicle && data.vehicle_tiers.length > 0;

  return (
    <div className="max-h-[72vh] overflow-auto rounded-[14px] border border-white/10">
      <table
        className="border-collapse text-[12.5px]"
        style={{ tableLayout: "fixed", width: FIRST_COL_WIDTH + DAY_COL_WIDTH * data.days.length }}
      >
        <colgroup>
          <col style={{ width: FIRST_COL_WIDTH }} />
          {data.days.map((d) => (
            <col key={d} style={{ width: DAY_COL_WIDTH }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 left-0 z-30 border-b border-white/10 px-2 py-2 text-left"
              style={{ backgroundColor: HEADER_BG }}
            />
            {data.days.map((day) => {
              const isToday = day === data.today;
              return (
                <th
                  key={day}
                  scope="col"
                  data-day={day}
                  data-today={isToday || undefined}
                  className={`sticky top-0 z-20 border-b border-white/10 px-1 py-2 text-center font-semibold whitespace-nowrap ${
                    isToday ? "text-sky-200" : "text-white/60"
                  }`}
                  style={{
                    backgroundColor: isToday ? HEADER_TODAY_BG : HEADER_BG,
                  }}
                >
                  {formatHeaderDay(day)}
                  {isToday ? <div className="text-[9px] font-normal text-sky-300/80">Today</div> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {blocks.map((block) => {
            const subRows = visibleSubRows(block.rows, block.total, hideZero);
            return (
              <Block
                key={block.manifest_id}
                block={block}
                subRows={subRows}
                days={data.days}
                today={data.today}
                useTiers={useTiers}
                tiers={data.vehicle_tiers}
                onOpenEditor={onOpenEditor}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Block({
  block,
  subRows,
  days,
  today,
  useTiers,
  tiers,
  onOpenEditor,
}: {
  block: Forecast60Day["blocks"][number];
  subRows: Forecast60Day["blocks"][number]["rows"];
  days: string[];
  today: string;
  useTiers: boolean;
  tiers: Forecast60Day["vehicle_tiers"];
  onOpenEditor: (manifestId: number, dayIndex: number) => void;
}) {
  return (
    <>
      <tr data-block={block.manifest_id} data-kind="total">
        <td
          className="sticky left-0 z-10 border-t-[3px] border-white/25 px-2 py-1.5 align-middle font-bold whitespace-nowrap"
          style={{ backgroundColor: TOTAL_ROW_BG }}
        >
          {block.name}
          {!block.is_active ? (
            <span className="ml-1.5 text-[10px] font-normal text-white/40">
              (inactive)
            </span>
          ) : null}
          <span className="ml-1.5 text-[9px] font-normal tracking-wide text-white/45 uppercase">
            Total
          </span>
        </td>
        {days.map((day, i) => {
          const value = block.total[i] ?? 0;
          const isToday = day === today;
          const tier = useTiers ? tierForTotal(value, tiers) : null;
          const swatch = tier ? tierSwatch(tier.color) : null;
          return (
            <td
              key={day}
              data-day={day}
              data-block={block.manifest_id}
              data-kind="total-cell"
              className={`border-t-[3px] border-white/25 text-center font-bold tabular-nums ${
                isToday ? "ring-1 ring-inset ring-sky-400/50" : ""
              }`}
              style={{
                backgroundColor: swatch ? swatch.bg : TOTAL_ROW_BG,
                color: swatch ? swatch.text : undefined,
              }}
            >
              {value}
            </td>
          );
        })}
      </tr>

      {subRows.map((row, rowIdx) => (
        <tr key={rowIdx} data-block={block.manifest_id} data-kind="sub" data-label={row.label}>
          <td
            className="sticky left-0 z-10 border-t border-white/10 py-1 pr-2 pl-6 whitespace-nowrap text-white/70"
            style={{ backgroundColor: SUB_ROW_BG }}
          >
            {row.label}
          </td>
          {days.map((day, i) => {
            const isToday = day === today;
            return (
              <td
                key={day}
                data-day={day}
                className={`border-t border-white/10 text-center tabular-nums text-white/70 ${
                  isToday ? "ring-1 ring-inset ring-sky-400/50" : ""
                }`}
                style={{ backgroundColor: SUB_ROW_BG }}
              >
                {row.values[i] ?? 0}
              </td>
            );
          })}
        </tr>
      ))}

      <tr data-block={block.manifest_id} data-kind="crew">
        <td
          className="sticky left-0 z-10 border-t border-white/10 px-2 py-1.5 align-top text-xs font-medium whitespace-nowrap text-white/70"
          style={{ backgroundColor: CREW_ROW_BG }}
        >
          Driver / Guide
        </td>
        {days.map((day, i) => (
          <CrewCell
            key={day}
            day={day}
            today={today}
            manifestId={block.manifest_id}
            blockName={block.name}
            crewDay={block.crew[i]}
            onOpenEditor={() => onOpenEditor(block.manifest_id, i)}
          />
        ))}
      </tr>
    </>
  );
}
