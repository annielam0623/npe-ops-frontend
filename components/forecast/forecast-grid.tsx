import { useEffect, useState } from "react";

import type { Forecast60Day, ForecastCrewDay } from "@/types";

import { CrewCell } from "./crew-cell";
import {
  cclExtraRows,
  cellValue,
  formatHeaderDay,
  isAllZero,
  isClosedDay,
  tierForTotal,
  tierSwatch,
  visibleSubRows,
} from "./config";
import {
  CREW_ROW_BG,
  CREW_DAY_COL_WIDTH,
  DAY_COL_WIDTH,
  FIRST_COL_WIDTH,
  FIRST_COL_WIDTH_PHONE,
  HEADER_BG,
  PHONE_QUERY,
  HEADER_TODAY_BG,
  SUB_ROW_BG,
  TOTAL_ROW_BG,
} from "./styles";

/**
 * 横向滚动的大表：一块一个巴士团路线，60 天。高度不设上限（Annie 2026-10-13：有多少产品就多高，
 * 不要大窗口里套小窗口），上下跟着整页滚，只在左右方向自己滚。首列 sticky（左右滚时留着）；
 * 表头的 sticky 在这种排法下不起作用（容器不上下滚），往下滚时日期行跟着表一起走。
 * sticky 的格子都显式写自己的背景色，见 styles.ts 顶部注释。
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
  onOpenEditor: (manifestId: number, section: string, dayIndex: number) => void;
}) {
  const blocks = hideZero
    ? data.blocks.filter((b) => !isAllZero(b.total))
    : data.blocks;
  const useTiers = colorByVehicle && data.vehicle_tiers.length > 0;
  // 哪几天有 Driver / Guide 内容（任何一块）：那几天的列加宽，安排最多两行（Annie 2026-10-13）。
  const dayWidths = data.days.map((_, i) =>
    blocks.some((b) => crewHasContent(b.crew[i]))
      ? CREW_DAY_COL_WIDTH
      : DAY_COL_WIDTH,
  );
  const firstColWidth = useIsPhone() ? FIRST_COL_WIDTH_PHONE : FIRST_COL_WIDTH;
  const tableWidth = firstColWidth + dayWidths.reduce((a, w) => a + w, 0);

  return (
    <div className="overflow-x-auto rounded-[14px] border border-white/10">
      <table
        className="border-collapse text-[12.5px]"
        style={{
          tableLayout: "fixed",
          width: tableWidth,
        }}
      >
        <colgroup>
          <col style={{ width: firstColWidth }} />
          {data.days.map((d, i) => (
            <col key={d} style={{ width: dayWidths[i] }} />
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
                  {isToday ? (
                    <div className="text-[9px] font-normal text-sky-300/80">
                      Today
                    </div>
                  ) : null}
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
                key={`${block.manifest_id}:${block.section}`}
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
  onOpenEditor: (manifestId: number, section: string, dayIndex: number) => void;
}) {
  const extra = cclExtraRows(block.name);
  // 块的粗分隔线画在这块第一行上（有 CCL 的「上面那行」时是它，否则是粗体人数行）。
  const totalTop = extra.before.length
    ? "border-t border-white/10"
    : "border-t-[3px] border-white/25";
  const ccl = (label: string, i: number) => (
    <CclRow
      key={label}
      label={label}
      days={days}
      today={today}
      block={block}
      top={i === 0 && label === extra.before[0]}
    />
  );
  return (
    <>
      {extra.before.map(ccl)}
      <tr
        data-block={block.manifest_id}
        data-section={block.section}
        data-kind="total"
      >
        <td
          className={`sticky left-0 z-10 ${totalTop} px-2 py-1.5 align-middle font-bold max-sm:leading-tight sm:whitespace-nowrap`}
          style={{ backgroundColor: TOTAL_ROW_BG }}
        >
          {block.name}
          {!block.is_active ? (
            <span className="ml-1.5 text-[10px] font-normal text-white/40">
              (inactive)
            </span>
          ) : null}
        </td>
        {days.map((day, i) => {
          const value = block.total[i] ?? 0;
          const closed = isClosedDay(block.crew[i]);
          const isToday = day === today;
          const tier = useTiers ? tierForTotal(value, tiers) : null;
          const swatch = tier ? tierSwatch(tier.color) : null;
          return (
            <td
              key={day}
              data-day={day}
              data-block={block.manifest_id}
              data-section={block.section}
              data-kind="total-cell"
              data-closed={closed || undefined}
              className={`${totalTop} text-center font-bold tabular-nums ${
                isToday ? "ring-1 ring-sky-400/50 ring-inset" : ""
              }`}
              style={{
                backgroundColor: swatch ? swatch.bg : TOTAL_ROW_BG,
                color: swatch ? swatch.text : undefined,
              }}
            >
              {cellValue(value, closed)}
            </td>
          );
        })}
      </tr>

      {subRows.map((row, rowIdx) => (
        <tr
          key={rowIdx}
          data-block={block.manifest_id}
          data-section={block.section}
          data-kind="sub"
          data-label={row.label}
        >
          <td
            className="sticky left-0 z-10 border-t border-white/10 py-1 pr-2 pl-3 text-white max-sm:leading-tight sm:pl-6 sm:whitespace-nowrap"
            style={{ backgroundColor: SUB_ROW_BG }}
          >
            {row.label}
          </td>
          {days.map((day, i) => {
            const isToday = day === today;
            const closed = isClosedDay(block.crew[i]);
            return (
              <td
                key={day}
                data-day={day}
                data-closed={closed || undefined}
                className={`border-t border-white/10 text-center text-white tabular-nums ${
                  isToday ? "ring-1 ring-sky-400/50 ring-inset" : ""
                }`}
                style={{ backgroundColor: SUB_ROW_BG }}
              >
                {cellValue(row.values[i] ?? 0, closed)}
              </td>
            );
          })}
        </tr>
      ))}

      {extra.afterSub.map(ccl)}

      <tr
        data-block={block.manifest_id}
        data-section={block.section}
        data-kind="crew"
      >
        <td
          className="sticky left-0 z-10 border-t border-white/10 py-1.5 pr-2 pl-3 text-left align-middle text-xs font-medium text-white/70 max-sm:leading-tight sm:pl-6 sm:whitespace-nowrap"
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
            section={block.section}
            blockName={block.name}
            crewDay={block.crew[i]}
            onOpenEditor={() =>
              onOpenEditor(block.manifest_id, block.section, i)
            }
          />
        ))}
      </tr>

      {extra.afterCrew.map(ccl)}
    </>
  );
}

/** CCL 表里有、ops 还没有数据的行：名字照 CCL，格子先空着（见 config.ts cclExtraRows）。 */
function CclRow({
  label,
  days,
  today,
  block,
  top,
}: {
  label: string;
  days: string[];
  today: string;
  block: Forecast60Day["blocks"][number];
  top: boolean;
}) {
  const border = top
    ? "border-t-[3px] border-white/25"
    : "border-t border-white/10";
  return (
    <tr
      data-block={block.manifest_id}
      data-section={block.section}
      data-kind="ccl"
      data-label={label}
    >
      <td
        className={`sticky left-0 z-10 ${border} py-1.5 pr-2 pl-3 text-left align-middle text-xs font-medium text-white/70 max-sm:leading-tight sm:pl-6 sm:whitespace-nowrap`}
        style={{ backgroundColor: CREW_ROW_BG }}
      >
        {label}
      </td>
      {days.map((day) => (
        <td
          key={day}
          data-day={day}
          className={`${border} h-7 ${
            day === today ? "ring-1 ring-sky-400/50 ring-inset" : ""
          }`}
          style={{ backgroundColor: CREW_ROW_BG }}
        />
      ))}
    </tr>
  );
}

/** 窄屏（手机）判断，跟着窗口宽度变。服务端渲染时按宽屏算。 */
function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isPhone;
}

/** 这一天这一块的 Driver / Guide 格子有没有东西要显示（没有就只有一个「—」，列不用加宽）。 */
function crewHasContent(crew: ForecastCrewDay | undefined): boolean {
  if (!crew) return false;
  if (crew.source === "ccl")
    return crew.closed || crew.lines.length > 0 || crew.in_main_block;
  return crew.guides.length > 0;
}
