import { useEffect, useState } from "react";

import type {
  Forecast60Day,
  ForecastBlock,
  ForecastBlockCellKey,
  ForecastCellMeta,
  ForecastCrewDay,
  ForecastPageCellKey,
} from "@/types";

import { CrewCell } from "./crew-cell";
import {
  allotmentAbbreviations,
  allotmentDiffersOn,
  cclExtraRows,
  cellValue,
  closedReason,
  describeMeta,
  formatHeaderDay,
  formatLongDate,
  hasAllotmentOn,
  isAllZero,
  isClosedDay,
  isPastDay,
  tierForTotal,
  tierSwatch,
  visibleSubRows,
  type CclExtraRow,
} from "./config";
import {
  ALLOT_DAY_COL_WIDTH,
  CREW_ROW_BG,
  CREW_DAY_COL_WIDTH,
  DAY_COL_WIDTH,
  FIRST_COL_WIDTH,
  FIRST_COL_WIDTH_PHONE,
  HEADER_BG,
  PHONE_QUERY,
  HEADER_TODAY_BG,
  SEATS_LEFT_COLOR,
  SUB_ROW_BG,
  TOTAL_ROW_BG,
} from "./styles";

/** 点一个手写格子要改的东西（G63）：块的格子带 manifestId / section；整页一行（major_events）不带。 */
export interface CellTarget {
  rowKey: ForecastBlockCellKey | ForecastPageCellKey;
  label: string;
  /** 弹框标题：块名，整页一行写 "All tours"。 */
  title: string;
  manifestId?: number;
  section: string;
  dayIndex: number;
}

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
  onOpenCell,
}: {
  data: Forecast60Day;
  colorByVehicle: boolean;
  hideZero: boolean;
  onOpenEditor: (manifestId: number, section: string, dayIndex: number) => void;
  onOpenCell: (target: CellTarget) => void;
}) {
  const blocks = hideZero
    ? data.blocks.filter((b) => !isAllZero(b.total))
    : data.blocks;
  const useTiers = colorByVehicle && data.vehicle_tiers.length > 0;
  // 哪几天有 Driver / Guide 或手写 / 订单内容（任何一块）：那几天的列加宽，最多两行（Annie 2026-10-13）；
  // 只有 Max allotments 的日子放到能放下每档一行（Annie 2026-10-15）。
  const dayWidths = data.days.map((_, i) =>
    blocks.some((b) => crewHasContent(b.crew[i]) || textHasContent(b, i)) ||
    Boolean(data.page_cells?.major_events?.[i])
      ? CREW_DAY_COL_WIDTH
      : blocks.some((b) => hasAllotmentOn(b, i))
        ? ALLOT_DAY_COL_WIDTH
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
                data={data}
                block={block}
                subRows={subRows}
                useTiers={useTiers}
                onOpenEditor={onOpenEditor}
                onOpenCell={onOpenCell}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Block({
  data,
  block,
  subRows,
  useTiers,
  onOpenEditor,
  onOpenCell,
}: {
  data: Forecast60Day;
  block: ForecastBlock;
  subRows: ForecastBlock["rows"];
  useTiers: boolean;
  onOpenEditor: (manifestId: number, section: string, dayIndex: number) => void;
  onOpenCell: (target: CellTarget) => void;
}) {
  const { days, today } = data;
  const extra = cclExtraRows(block);
  // 块的粗分隔线画在这块第一行上（有 CCL 的「上面那行」时是它，否则是粗体人数行）。
  const totalTop = extra.before.length
    ? "border-t border-white/10"
    : "border-t-[3px] border-white/25";
  const ccl = (row: CclExtraRow, i: number) => (
    <CclRow
      key={row.label}
      row={row}
      data={data}
      block={block}
      top={i === 0 && row === extra.before[0]}
      onOpenCell={onOpenCell}
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
          const closed = isClosedDay(block, i);
          const isToday = day === today;
          const tier = useTiers
            ? tierForTotal(value, data.vehicle_tiers)
            : null;
          const swatch = tier ? tierSwatch(tier.color) : null;
          return (
            <td
              key={day}
              data-day={day}
              data-block={block.manifest_id}
              data-section={block.section}
              data-kind="total-cell"
              data-closed={closed || undefined}
              title={closed ? closedReason(block, i) || undefined : undefined}
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
            const closed = isClosedDay(block, i);
            return (
              <td
                key={day}
                data-day={day}
                data-closed={closed || undefined}
                title={closed ? closedReason(block, i) || undefined : undefined}
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

/** CCL 表里粗体行 / 分项 / Driver·Guide 以外的行（见 config.ts cclExtraRows）。 */
function CclRow({
  row,
  data,
  block,
  top,
  onOpenCell,
}: {
  row: CclExtraRow;
  data: Forecast60Day;
  block: ForecastBlock;
  top: boolean;
  onOpenCell: (target: CellTarget) => void;
}) {
  const { days, today } = data;
  const border = top
    ? "border-t-[3px] border-white/25"
    : "border-t border-white/10";
  const abbreviations =
    row.kind === "allotments"
      ? allotmentAbbreviations(block.allotments ?? [])
      : null;
  return (
    <tr
      data-block={block.manifest_id}
      data-section={block.section}
      data-kind="ccl"
      data-label={row.label}
    >
      <td
        className={`sticky left-0 z-10 ${border} py-1.5 pr-2 pl-3 text-left align-middle text-xs font-medium text-white/70 max-sm:leading-tight sm:pl-6 sm:whitespace-nowrap`}
        style={{ backgroundColor: CREW_ROW_BG }}
      >
        {row.label}
        {abbreviations && block.allotments?.length ? (
          // 上限只在最左边写一次（Annie 2026-10-15），格子里只写剩几位。
          <div className="mt-0.5 text-[10px] leading-[1.35] font-normal text-white/80 tabular-nums">
            {block.allotments
              .filter((a) => a.normal_max !== null)
              .map((a) => (
                <div key={a.label} data-allot-normal={a.label}>
                  {abbreviations.get(a.label)} {a.normal_max}
                  {a.normal_time ? ` · ${a.normal_time}` : ""}
                </div>
              ))}
            <div className="text-white/45">cells: seats left</div>
          </div>
        ) : null}
      </td>
      {days.map((day, i) => {
        const ring = day === today ? "ring-1 ring-sky-400/50 ring-inset" : "";
        const base = `${border} ${ring} align-top text-left`;
        const style = { backgroundColor: CREW_ROW_BG };
        if (row.kind === "placeholder") {
          return (
            <td
              key={day}
              data-day={day}
              className={`${base} h-7`}
              style={style}
            />
          );
        }
        if (row.kind === "depart") {
          const value = block.depart_times?.[i] ?? "";
          return (
            <td
              key={day}
              data-day={day}
              className={`${base} px-1.5 py-1.5 text-[11px] ${value ? "text-white/85" : "text-white/40"}`}
              style={style}
            >
              {value || "—"}
            </td>
          );
        }
        if (row.kind === "allotments") {
          return (
            <AllotmentCell
              key={day}
              day={day}
              className={base}
              block={block}
              dayIndex={i}
              abbreviations={abbreviations!}
            />
          );
        }
        if (row.kind === "orders") {
          const orders = block.orders?.[i] ?? [];
          return (
            <td
              key={day}
              data-day={day}
              data-kind="orders"
              className={`${base} px-1.5 py-1.5 text-[10px] leading-snug`}
              style={style}
            >
              {orders.length ? (
                <div className="space-y-0.5 text-white/85">
                  {orders.map((o) => (
                    <div key={o.order_number}>
                      {[
                        o.order_number,
                        String(o.pax),
                        o.product,
                        [o.pickup_location, o.pickup_time]
                          .filter(Boolean)
                          .join(" "),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-white/30">—</div>
              )}
            </td>
          );
        }
        // 手写格子：块的（crew_notes / pax_tours / driver_vehicle）或整页一行的（major_events）。
        const value =
          row.kind === "page"
            ? (data.page_cells?.[row.key]?.[i] ?? "")
            : (block.cells?.[row.key]?.[i] ?? "");
        const meta: ForecastCellMeta | null | undefined =
          row.kind === "page"
            ? data.page_cells_meta?.[row.key]?.[i]
            : block.cells_meta?.[row.key]?.[i];
        return (
          <TextCell
            key={day}
            day={day}
            className={base}
            value={value}
            meta={meta}
            // 接口没带手写数据（后端 G63 还没上线）时不给点，免得点了只得到 Not Found。
            editable={
              !isPastDay(day, today) &&
              (row.kind === "page"
                ? data.page_cells !== undefined
                : block.cells !== undefined)
            }
            label={`${row.label} — ${row.kind === "page" ? "All tours" : block.name}, ${formatLongDate(day)}`}
            onOpen={() =>
              onOpenCell({
                rowKey: row.key,
                label: row.label,
                title: row.kind === "page" ? "All tours" : block.name,
                manifestId: row.kind === "page" ? undefined : block.manifest_id,
                section: row.kind === "page" ? "" : block.section,
                dayIndex: i,
              })
            }
          />
        );
      })}
    </tr>
  );
}

/**
 * Max allotments 一格：每档一行「U 18」，剩几位浅蓝、卖超红字负数（Annie 2026-10-15）；
 * 那天的上限 / 时间和平常不同（日期段）⇒ 后面补黄字「/20 11a」。不开团、那天没有上限 ⇒「—」。
 */
function AllotmentCell({
  day,
  className,
  block,
  dayIndex,
  abbreviations,
}: {
  day: string;
  className: string;
  block: ForecastBlock;
  dayIndex: number;
  abbreviations: Map<string, string>;
}) {
  const lines = isClosedDay(block, dayIndex)
    ? []
    : (block.allotments ?? []).filter(
        (a) => a.max[dayIndex] !== null && a.max[dayIndex] !== undefined,
      );
  return (
    <td
      data-day={day}
      data-kind="allotments"
      className={`${className} px-1 py-1 text-[9.5px] leading-[1.35] tracking-[-.01em] whitespace-nowrap tabular-nums`}
      style={{ backgroundColor: CREW_ROW_BG }}
    >
      {lines.length ? (
        <div className="text-white/85">
          {lines.map((a) => {
            const left = a.inventory[dayIndex] ?? 0;
            return (
              <div key={a.label} data-allot={a.label}>
                {abbreviations.get(a.label)}{" "}
                <span
                  className="font-semibold"
                  style={{ color: left < 0 ? "#f87171" : SEATS_LEFT_COLOR }}
                >
                  {left}
                </span>
                {allotmentDiffersOn(a, dayIndex) ? (
                  <span
                    className="text-amber-300"
                    title="Different cap on these dates"
                  >
                    {" "}
                    /{a.max[dayIndex]}
                    {a.time[dayIndex] ? ` ${a.time[dayIndex]}` : ""}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-white/40">—</div>
      )}
    </td>
  );
}

/** 手写格子：不是过去的日子可点开写（所有 staff，Annie 2026-10-15）；鼠标移上去看谁、何时写的。 */
function TextCell({
  day,
  className,
  value,
  meta,
  editable,
  label,
  onOpen,
}: {
  day: string;
  className: string;
  value: string;
  meta: ForecastCellMeta | null | undefined;
  editable: boolean;
  label: string;
  onOpen: () => void;
}) {
  const title = describeMeta(meta) || undefined;
  const content = value ? (
    <div className="text-[11px] leading-snug break-words whitespace-pre-wrap text-white/85">
      {value}
    </div>
  ) : (
    <div className="text-[10px] text-white/35">—</div>
  );
  if (!editable) {
    return (
      <td
        data-day={day}
        data-kind="cell-past"
        title={title}
        className={`${className} px-1.5 py-1.5`}
        style={{ backgroundColor: CREW_ROW_BG }}
      >
        {content}
      </td>
    );
  }
  return (
    <td
      data-day={day}
      data-kind="cell"
      className={`${className} p-0`}
      style={{ backgroundColor: CREW_ROW_BG }}
    >
      <button
        type="button"
        onClick={onOpen}
        title={title}
        aria-label={`Edit ${label}`}
        className="group block w-full px-1.5 py-1.5 text-left hover:bg-white/[.06] focus:bg-white/[.08] focus:outline-none"
      >
        {content}
        {value ? null : (
          <div className="mt-1 text-[10px] text-sky-300 opacity-0 group-hover:opacity-100 group-focus:opacity-100">
            + Add
          </div>
        )}
      </button>
    </td>
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

/** 这一天这一块有没有手写字或订单明细（有就和 Driver / Guide 一样加宽）。 */
function textHasContent(block: ForecastBlock, dayIndex: number): boolean {
  if (block.orders?.[dayIndex]?.length) return true;
  return Object.values(block.cells ?? {}).some((values) =>
    Boolean(values?.[dayIndex]),
  );
}
