import { useEffect, useRef, useState } from "react";

import type {
  CanyonSnapshot,
  Forecast60Day,
  ForecastBlock,
  ForecastBlockCellKey,
  ForecastCellMeta,
  ForecastCrewDay,
  ForecastPageCellKey,
} from "@/types";

import {
  blockHasCanyon,
  canyonCell,
  canyonProductFor,
  type CanyonCell,
} from "./canyon";
import { CrewCell } from "./crew-cell";
import {
  allotmentAbbreviations,
  allotmentDiffersOn,
  cclExtraRows,
  cellValue,
  closedReason,
  describeAllotmentMeta,
  describeMeta,
  describeRunningMeta,
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
  colLine,
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

/** 小黄点：这格在表上手改过（G81）。父格要 relative。 */
function EditedDot() {
  return (
    <span
      aria-hidden
      data-day-edited
      className="pointer-events-none absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-amber-300"
    />
  );
}

/** 人数格里的 0：字更小、更暗、不加粗，免得和别的数字混在一起（Annie 2026-10-16）。 */
function Num({ text }: { text: string }) {
  return text === "0" ? (
    <span data-zero className="text-[10px] font-normal text-white/60">
      0
    </span>
  ) : (
    <>{text}</>
  );
}

/**
 * 日期那一行往下滚时固定在顶栏下面（Annie 2026-10-16：只固定日期行，页头别的文字不固定）。
 * 表放在 overflow-x:auto 的容器里，CSS 的 sticky top 对整页滚动不起作用，所以页面滚动时
 * 用 transform 把日期行往下推到顶栏正下方；推不出表的底部。顶栏高度读 [data-app-topbar] 的底边。
 */
function useStickyDateRow(wrapRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const head = wrap.querySelector("thead");
      if (!head) return;
      const bar = document.querySelector("[data-app-topbar]");
      const offset = bar ? bar.getBoundingClientRect().bottom : 0;
      const rect = wrap.getBoundingClientRect();
      const headH = head.getBoundingClientRect().height;
      const max = Math.max(0, rect.height - headH - 2);
      const shift = Math.min(max, Math.max(0, offset - rect.top));
      head.querySelectorAll("th").forEach((th) => {
        th.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [wrapRef]);
}

/**
 * 横向滚动的大表：一块一个巴士团路线，60 天。高度不设上限（Annie 2026-10-13：有多少产品就多高，
 * 不要大窗口里套小窗口），上下跟着整页滚，只在左右方向自己滚。首列 sticky（左右滚时留着）；
 * 日期行往下滚时固定在顶栏下面，见 useStickyDateRow。
 * sticky 的格子都显式写自己的背景色，见 styles.ts 顶部注释。
 */
export function ForecastGrid({
  data,
  colorByVehicle,
  hideZero,
  onOpenEditor,
  onOpenCell,
  onOpenRunning,
  onOpenAllotment,
  canyon,
}: {
  data: Forecast60Day;
  colorByVehicle: boolean;
  hideZero: boolean;
  onOpenEditor: (manifestId: number, section: string, dayIndex: number) => void;
  onOpenCell: (target: CellTarget) => void;
  /** G81：点粗体人数格 / Max allotments 格，改这一天。 */
  onOpenRunning: (block: ForecastBlock, dayIndex: number) => void;
  onOpenAllotment: (block: ForecastBlock, dayIndex: number) => void;
  /** Antelope 剩余座位快照；null = 后端没上线 / 读失败 ⇒ 这一行照旧（Max allotments）。 */
  canyon: CanyonSnapshot | null;
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
  const isPhone = useIsPhone();
  const firstColWidth = isPhone ? FIRST_COL_WIDTH_PHONE : FIRST_COL_WIDTH;
  const tableWidth = firstColWidth + dayWidths.reduce((a, w) => a + w, 0);

  const wrapRef = useRef<HTMLDivElement>(null);
  useStickyDateRow(wrapRef);

  const dayWidthsRef = useRef(dayWidths);
  dayWidthsRef.current = dayWidths;
  useLeadColumn(wrapRef, isPhone, dayWidthsRef);

  // 手机版（Annie 2026-10-16）：一打开，今天那一列就挨着左边固定列，昨天在左边（往左滑能看到）。
  const todayIndex = data.days.indexOf(data.today);
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (!isPhone || scrolledRef.current || todayIndex <= 0) return;
    const el = wrapRef.current;
    if (!el) return;
    scrolledRef.current = true;
    el.scrollLeft = dayWidths
      .slice(0, todayIndex)
      .reduce((sum, w) => sum + w, 0);
  }, [isPhone, todayIndex, dayWidths]);

  return (
    <div
      ref={wrapRef}
      data-forecast-grid
      className="overflow-x-auto rounded-[14px] border border-white/10"
    >
      <style>{LEAD_CSS}</style>
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
              className="sticky top-0 left-0 z-30 border-b border-white/10 px-2 py-2 text-left max-sm:shadow-[inset_-2px_0_0_rgba(255,255,255,.4),inset_0_-2px_0_rgba(255,255,255,.4)]"
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
                  className={`sticky top-0 z-20 border-b border-white/10 px-1 py-2 text-center font-semibold whitespace-nowrap max-sm:shadow-[inset_0_-2px_0_rgba(255,255,255,.4)] ${colLine(isToday)} ${
                    isToday ? "text-sky-200" : "text-white"
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
            const subRows = sortSubRowsForPhone(
              visibleSubRows(block.rows, block.total, hideZero),
              isPhone,
            );
            return (
              <Block
                key={`${block.manifest_id}:${block.section}`}
                data={data}
                block={block}
                subRows={subRows}
                useTiers={useTiers}
                onOpenEditor={onOpenEditor}
                onOpenCell={onOpenCell}
                onOpenRunning={onOpenRunning}
                onOpenAllotment={onOpenAllotment}
                canyon={canyon}
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
  onOpenRunning,
  onOpenAllotment,
  canyon,
}: {
  data: Forecast60Day;
  block: ForecastBlock;
  subRows: ForecastBlock["rows"];
  useTiers: boolean;
  onOpenEditor: (manifestId: number, section: string, dayIndex: number) => void;
  onOpenCell: (target: CellTarget) => void;
  onOpenRunning: (block: ForecastBlock, dayIndex: number) => void;
  onOpenAllotment: (block: ForecastBlock, dayIndex: number) => void;
  /** Antelope 剩余座位快照；null = 后端没上线 / 读失败 ⇒ 这一行照旧（Max allotments）。 */
  canyon: CanyonSnapshot | null;
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
      onOpenAllotment={onOpenAllotment}
      canyon={canyon}
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
          className={`sticky left-0 z-10 max-sm:shadow-[inset_-2px_0_0_rgba(255,255,255,.4)] ${totalTop} px-2 py-1.5 align-middle font-bold text-[#facc15] max-sm:leading-tight sm:whitespace-nowrap`}
          style={{ backgroundColor: TOTAL_ROW_BG }}
        >
          {block.name}
          {!block.is_active ? (
            <span className="ml-1.5 text-[10px] font-normal text-white">
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
          const runMeta = block.running_meta?.[i] ?? null;
          // 接口带了 running_meta（后端 G81 上线）才给点；过去的日子只读。
          const editable =
            block.running_meta !== undefined && !isPastDay(day, today);
          const text = cellValue(value, closed);
          return (
            <td
              key={day}
              data-day={day}
              data-block={block.manifest_id}
              data-section={block.section}
              data-kind="total-cell"
              data-closed={closed || undefined}
              title={closed ? closedReason(block, i) || undefined : undefined}
              className={`${totalTop} relative text-center font-bold tabular-nums ${colLine(isToday)}`}
              style={{
                backgroundColor: swatch ? swatch.bg : TOTAL_ROW_BG,
                color: swatch ? swatch.text : undefined,
              }}
            >
              {editable ? (
                <button
                  type="button"
                  data-edit="running"
                  aria-label={`Edit whether ${block.name} runs on ${formatLongDate(day)}`}
                  title={
                    runMeta
                      ? describeRunningMeta(runMeta)
                      : closed
                        ? closedReason(block, i) || undefined
                        : undefined
                  }
                  onClick={() => onOpenRunning(block, i)}
                  className="block h-full w-full px-1 py-1.5 font-bold hover:bg-white/[.08] focus:bg-white/[.1] focus:outline-none"
                >
                  <Num text={text} />
                </button>
              ) : (
                <Num text={text} />
              )}
              {runMeta ? <EditedDot /> : null}
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
            className="sticky left-0 z-10 border-t border-white/10 py-1 pr-2 pl-3 text-white max-sm:text-[10px] max-sm:leading-tight max-sm:whitespace-nowrap max-sm:shadow-[inset_-2px_0_0_rgba(255,255,255,.4)] sm:pl-6 sm:whitespace-nowrap"
            style={{ backgroundColor: SUB_ROW_BG }}
          >
            {row.label}
            {canyonProductFor(canyon, block, row.label) ? (
              // Antelope：格子里是「销售 / 剩余」（Annie 2026-10-16），行名后面小字说明。
              <span className="ml-1.5 text-[10px] font-normal text-white">
                Sold / <b className="font-semibold text-[#7dd3fc]">Avail</b>
              </span>
            ) : null}
          </td>
          {days.map((day, i) => {
            const isToday = day === today;
            const closed = isClosedDay(block, i);
            const product = canyonProductFor(canyon, block, row.label);
            return (
              <td
                key={day}
                data-day={day}
                data-closed={closed || undefined}
                title={closed ? closedReason(block, i) || undefined : undefined}
                className={`border-t border-white/10 text-center text-white tabular-nums ${colLine(isToday)}`}
                style={{ backgroundColor: SUB_ROW_BG }}
              >
                {product && canyon && !closed ? (
                  <SoldAvail
                    sold={row.values[i] ?? 0}
                    cell={canyonCell(canyon, product, block, data, i)}
                  />
                ) : (
                  <Num text={cellValue(row.values[i] ?? 0, closed)} />
                )}
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
          className="sticky left-0 z-10 border-t border-white/10 py-1.5 pr-2 pl-3 text-left align-middle text-xs font-medium text-white max-sm:leading-tight max-sm:shadow-[inset_-2px_0_0_rgba(255,255,255,.4)] sm:pl-6 sm:whitespace-nowrap"
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
  onOpenAllotment,
  canyon,
}: {
  row: CclExtraRow;
  data: Forecast60Day;
  block: ForecastBlock;
  top: boolean;
  onOpenCell: (target: CellTarget) => void;
  onOpenAllotment: (block: ForecastBlock, dayIndex: number) => void;
  /** Antelope 剩余座位快照；null = 后端没上线 / 读失败 ⇒ 这一行照旧（Max allotments）。 */
  canyon: CanyonSnapshot | null;
}) {
  const { days, today } = data;
  const border = top
    ? "border-t-[3px] border-white/25"
    : "border-t border-white/10";
  const abbreviations =
    row.kind === "allotments"
      ? allotmentAbbreviations(block.allotments ?? [])
      : null;
  // Antelope：这一行改成 Rezdy 剩余座位（Annie 2026-10-16）。最左边只留 U / L / X 和原来的时间，上限数字不写。
  const seatsMode = row.kind === "allotments" && blockHasCanyon(canyon, block);
  return (
    <tr
      data-block={block.manifest_id}
      data-section={block.section}
      data-kind="ccl"
      data-label={row.label}
    >
      <td
        // 逐单列订单那行可能很高：行名靠上，不然居中会被挤到屏幕外（Annie 2026-10-15 截图）。
        className={`sticky left-0 z-10 max-sm:shadow-[inset_-2px_0_0_rgba(255,255,255,.4)] ${border} py-1.5 pr-2 pl-3 text-left ${row.kind === "orders" ? "align-top" : "align-middle"} text-xs font-medium text-white max-sm:leading-tight sm:pl-6 sm:whitespace-nowrap`}
        style={{ backgroundColor: CREW_ROW_BG }}
      >
        {seatsMode ? "Session" : row.label}
        {!seatsMode && abbreviations && block.allotments?.length ? (
          // 上限只在最左边写一次（Annie 2026-10-15），格子里只写剩几位。
          <div className="mt-0.5 text-[10px] leading-[1.35] font-normal text-white tabular-nums">
            {block.allotments
              .filter((a) => a.normal_max !== null)
              .map((a) => (
                <div key={a.label} data-allot-normal={a.label}>
                  {abbreviations.get(a.label)} {a.normal_max}
                  {a.normal_time ? ` · ${a.normal_time}` : ""}
                </div>
              ))}
            <div className="text-white">cells: seats left</div>
          </div>
        ) : null}
      </td>
      {days.map((day, i) => {
        const ring = colLine(day === today);
        const base = `${border} ${ring} align-top text-center`;
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
              className={`${base} px-1.5 py-1.5 text-[11px] ${value ? "text-white" : "text-white"}`}
              style={style}
            >
              {value || "—"}
            </td>
          );
        }
        if (row.kind === "allotments" && seatsMode) {
          return (
            <SessionCell
              key={day}
              day={day}
              className={`${border} ${ring} text-center align-top`}
              block={block}
              dayIndex={i}
              abbreviations={abbreviations!}
              canyon={canyon!}
            />
          );
        }
        if (row.kind === "allotments") {
          return (
            <AllotmentCell
              key={day}
              day={day}
              // 居中（Annie 2026-10-16：「把 ULX 的数字居中」），三行之间仍左对齐、U / L / X 上下对齐。
              className={`${border} ${ring} text-center align-top`}
              block={block}
              dayIndex={i}
              abbreviations={abbreviations!}
              editable={!isPastDay(day, today)}
              onOpen={() => onOpenAllotment(block, i)}
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
                <div className="space-y-0.5 text-white">
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
                <div className="text-white">—</div>
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

/** 「销售 / 剩余」：销售数照常（0 变小），剩余带颜色，0 红、1–low_max 黄、其余浅蓝，数字一样大。 */
function SoldAvail({ sold, cell }: { sold: number; cell: CanyonCell }) {
  return (
    <span
      data-sold-avail
      data-state={cell.kind === "seats" ? cell.level : cell.kind}
    >
      <Num text={String(sold)} />
      <span className="font-normal text-white"> / </span>
      {cell.kind === "seats" ? (
        <span
          data-avail
          className="font-semibold"
          style={{
            color:
              cell.level === "full"
                ? "#f87171"
                : cell.level === "low"
                  ? "#fcd34d"
                  : SEATS_LEFT_COLOR,
          }}
        >
          {cell.value}
        </span>
      ) : (
        <span
          data-avail
          className="text-[10px] font-normal text-white/70"
          title={
            cell.kind === "nodata"
              ? "Rezdy has no 5:15 session that day"
              : "Not synced yet"
          }
        >
          {cell.kind === "nodata" ? "No data" : "Not synced"}
        </span>
      )}
    </span>
  );
}

/**
 * Session 一格：三个谷当天的出发时间，每档一行「U 12:40p」（Annie 2026-10-16）。
 * 时间取 allotments[].time[当天]（日期段优先，例如 11/2 起 X 改 1p）；没有就写「—」。不开团写「—」。
 */
function SessionCell({
  day,
  className,
  block,
  dayIndex,
  abbreviations,
  canyon,
}: {
  day: string;
  className: string;
  block: ForecastBlock;
  dayIndex: number;
  abbreviations: Map<string, string>;
  canyon: CanyonSnapshot;
}) {
  const closed = isClosedDay(block, dayIndex);
  const lines = (block.allotments ?? []).filter((a) =>
    canyonProductFor(canyon, block, a.label),
  );
  return (
    <td
      data-day={day}
      data-kind="session"
      className={`${className} px-1 py-1.5 text-[10.5px] whitespace-nowrap tabular-nums`}
      style={{ backgroundColor: CREW_ROW_BG }}
    >
      <div className="inline-block text-left text-white">
        {lines.map((a) => (
          <div key={a.label} data-session={a.label} className="h-4 leading-4">
            {abbreviations.get(a.label)}{" "}
            {closed ? "—" : a.time[dayIndex] || a.normal_time || "—"}
          </div>
        ))}
      </div>
    </td>
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
  editable,
  onOpen,
}: {
  day: string;
  className: string;
  block: ForecastBlock;
  dayIndex: number;
  abbreviations: Map<string, string>;
  editable: boolean;
  onOpen: () => void;
}) {
  const lines = isClosedDay(block, dayIndex)
    ? []
    : (block.allotments ?? []).filter(
        (a) => a.max[dayIndex] !== null && a.max[dayIndex] !== undefined,
      );
  const edited = (block.allotments ?? []).filter((a) => a.day_meta?.[dayIndex]);
  // 接口带了 day_meta（后端 G81 上线）、这天开团、有档可改才给点；过去的日子只读。
  const canEdit =
    editable &&
    !isClosedDay(block, dayIndex) &&
    Boolean(block.allotments?.length) &&
    block.allotments!.every((a) => a.day_meta !== undefined);
  const content = lines.length ? (
    <div className="inline-block text-left text-white">
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
    <div className="text-white">—</div>
  );
  return (
    <td
      data-day={day}
      data-kind="allotments"
      className={`${className} relative ${canEdit ? "p-0" : "px-1 py-1"} text-[9.5px] leading-[1.35] tracking-[-.01em] whitespace-nowrap tabular-nums`}
      style={{ backgroundColor: CREW_ROW_BG }}
    >
      {canEdit ? (
        <button
          type="button"
          data-edit="allotment"
          aria-label={`Edit max allotments for ${block.name} on ${formatLongDate(day)}`}
          title={
            edited.length
              ? edited
                  .map(
                    (a) =>
                      `${a.label}: ${describeAllotmentMeta(a.day_meta![dayIndex]!)}`,
                  )
                  .join("\n")
              : undefined
          }
          onClick={onOpen}
          className="block w-full px-1 py-1 hover:bg-white/[.06] focus:bg-white/[.08] focus:outline-none"
        >
          {content}
        </button>
      ) : (
        content
      )}
      {edited.length ? <EditedDot /> : null}
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
    <div className="text-[11px] leading-snug break-words whitespace-pre-wrap text-white">
      {value}
    </div>
  ) : (
    <div className="text-[10px] text-white">—</div>
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

/**
 * 手机版（Annie 2026-10-16）：亮框跟着屏幕走，永远套住挨着固定列的那一列（往左右滑时换列）。
 * 直接给那一列每个格子标 data-lead（不让整张表跟着滚动重画），样子见下面 LEAD_CSS。
 */
function useLeadColumn(
  wrapRef: React.RefObject<HTMLDivElement | null>,
  isPhone: boolean,
  widthsRef: React.RefObject<number[]>,
) {
  useEffect(() => {
    const el = wrapRef.current;
    if (!isPhone || !el) return;
    let frame = 0;
    let lead = -1;
    const apply = () => {
      frame = 0;
      const widths = widthsRef.current;
      let end = 0;
      let next = widths.length - 1;
      for (let i = 0; i < widths.length; i++) {
        end += widths[i];
        if (end - widths[i] / 2 > el.scrollLeft) {
          next = i;
          break;
        }
      }
      if (next === lead) return;
      lead = next;
      for (const cell of el.querySelectorAll("[data-lead]"))
        cell.removeAttribute("data-lead");
      for (const row of el.querySelectorAll("tr"))
        row.children[next + 1]?.setAttribute("data-lead", "");
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    // 表格内容变了（换数据、展开行）重新标一次。
    const mo = new MutationObserver(() => {
      lead = -1;
      onScroll();
    });
    mo.observe(el, { childList: true, subtree: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      mo.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [wrapRef, isPhone, widthsRef]);
}

// 滑动时停在整列上（亮框套住的那列是完整的）：固定列右边开始算，每个日期格靠它对齐。
const LEAD_CSS = `@media (max-width: 639px) {
  [data-forecast-grid] { scroll-snap-type: x mandatory; scroll-padding-left: ${FIRST_COL_WIDTH_PHONE}px; }
  [data-forecast-grid] th[data-day] { scroll-snap-align: start; }
  [data-forecast-grid] td[data-lead] { box-shadow: inset 1px 0 0 rgba(56,189,248,.8), inset -1px 0 0 rgba(56,189,248,.8); }
  [data-forecast-grid] th[data-lead] { box-shadow: inset 1px 0 0 rgba(56,189,248,.8), inset -1px 0 0 rgba(56,189,248,.8), inset 0 -2px 0 rgba(255,255,255,.4); }
}`;

/** 手机版分项顺序（Annie 2026-10-16）：Upper / Lower / X / VIP Lower / Secret / Outbound / Inbound；没列到的（如 West Rim Bus Tour）排最前、保持原顺序。 */
const PHONE_SUB_ORDER = [
  "upper",
  "lower",
  "x",
  "vip lower",
  "secret",
  "outbound",
  "inbound",
];
function sortSubRowsForPhone(
  rows: ForecastBlock["rows"],
  isPhone: boolean,
): ForecastBlock["rows"] {
  if (!isPhone) return rows;
  const rank = (label: string) => {
    const i = PHONE_SUB_ORDER.indexOf(label.trim().toLowerCase());
    return i;
  };
  return [...rows].sort((a, b) => rank(a.label) - rank(b.label));
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
