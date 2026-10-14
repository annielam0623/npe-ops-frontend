"use client";

import {
  type DependencyList,
  type MouseEvent,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";

import { cn } from "@/lib/utils";

/**
 * 三个 tracking 页的「拖表头右边缘调列宽 + 按内容自动定列宽」，照旧页面搬（Annie 2026-10-14：
 * 「header 的宽窄没有办法调整」）。旧实现：tracking_morning.html `initColResize()` / `autoFitCols()`，
 * tracking_tour.html、tracking_tickets.html 同一套。
 *
 * - 拖：手柄贴在表头格右边 5px，按下后跟着鼠标改这一格的 `style.width`，最小 40px。
 *   ⛔ 列宽**不存**（Annie 2026-09-12：调宽多半是当天的临时反应，不是个人偏好；刷新回默认）。
 * - 自动列宽（Annie 2026-09-14 规格）：每列取所有格子「不折行要多宽」的第 90 百分位当列宽，表头宽是下限，
 *   不封上限，剩下约一成过长的自己折行。每次画完行都量；**人手拖过一次以后本屏不再量**
 *   （页面每分钟自动刷新，不守这条的话拖了等于白拖）。
 * - 表头格带 `data-autofit="skip"` 的列（Notes / WhatsApp：装的是客人整段的话）两头都跳过，保住它们的宽度。
 * - 表格要是 `table-layout:auto; width:max-content`（ops 的 `w-max`）：表头格的宽度相当于「至少这么宽、
 *   内容超过就折行」，和旧页面一样。
 */
export function useColumnSizing(
  tableRef: RefObject<HTMLTableElement | null>,
  deps: DependencyList,
) {
  const userResized = useRef(false);

  useLayoutEffect(() => {
    if (!userResized.current && tableRef.current) autoFitCols(tableRef.current);
    // deps 由调用方给（行、列顺序、显示哪些列），每次画完量一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return useCallback((event: MouseEvent<HTMLElement>) => {
    const handle = event.currentTarget;
    const cell = handle.parentElement;
    if (!cell) return;
    // 挡住表头格的原生拖列（拖列换位置）和选字。
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startW = cell.offsetWidth;
    handle.dataset.active = "true";
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (e: globalThis.MouseEvent) => {
      cell.style.width = `${Math.max(40, startW + e.clientX - startX)}px`;
    };
    const onUp = () => {
      userResized.current = true;
      delete handle.dataset.active;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);
}

/**
 * 表头格里的拖宽手柄。`hoverClass` 是各页旧样式里手柄悬停 / 拖动时的颜色。
 * 类名 `col-resizer` 给 globals.css 的 `table.afm .col-resizer`（量宽那一刻摘掉手柄）用。
 */
export function ColResizer({
  onMouseDown,
  hoverClass,
}: {
  onMouseDown: (event: MouseEvent<HTMLElement>) => void;
  hoverClass: string;
}) {
  return (
    <div
      aria-hidden
      onMouseDown={onMouseDown}
      // 点手柄不该触发表头格上的别的点击。
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "col-resizer absolute top-0 right-0 bottom-0 z-[2] w-[5px] cursor-col-resize bg-transparent",
        hoverClass,
      )}
    />
  );
}

/** 旧页面 `autoFitCols()` 原样：一次写 → 批量读 → 一次写，中间不插样式写入，浏览器只重排一次。 */
export function autoFitCols(table: HTMLTableElement) {
  const head = table.tHead?.rows[0];
  const tbody = table.tBodies[0];
  if (!head || !tbody || !tbody.rows.length) return;
  const rows = tbody.rows;
  const n = head.cells.length;
  // 「Loading…」「No records found.」那种 colspan 占位行：列数对不上，不量。
  if (!rows[0].cells.length || rows[0].cells.length !== n) return;

  const skip = (cell: HTMLTableCellElement) => cell.dataset.autofit === "skip";

  // ① 一次写：清掉上一轮的宽度，并临时禁止折行（.afm，见 globals.css）。
  for (let a = 0; a < n; a++) {
    if (!skip(head.cells[a])) head.cells[a].style.width = "";
  }
  table.classList.add("afm");

  // ② 批量读。⛔ 不能用 offsetWidth：同一列的格子一样宽，量到的是列宽。用 Range 框住格子里的内容量。
  const range = document.createRange();
  const contentW = (cell: HTMLTableCellElement) => {
    range.selectNodeContents(cell);
    return range.getBoundingClientRect().width;
  };
  const chromeW = (cell: HTMLTableCellElement) => {
    const s = window.getComputedStyle(cell);
    return (
      parseFloat(s.paddingLeft) +
      parseFloat(s.paddingRight) +
      parseFloat(s.borderLeftWidth) +
      parseFloat(s.borderRightWidth)
    );
  };
  const widths: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < rows.length; i++) {
    const cs = rows[i].cells;
    for (let c = 0; c < n && c < cs.length; c++)
      widths[c].push(contentW(cs[c]));
  }
  const headW: number[] = [];
  const padW: number[] = [];
  for (let d = 0; d < n; d++) {
    headW.push(contentW(head.cells[d]) + chromeW(head.cells[d]));
    padW.push(rows[0].cells[d] ? chromeW(rows[0].cells[d]) : 0);
  }

  // ③ 一次写：撤掉 nowrap，按 90 百分位定宽（最近秩法：n=10 取第 9 小）。表头不折行，是下限。
  table.classList.remove("afm");
  for (let e = 0; e < n; e++) {
    const hc = head.cells[e];
    if (skip(hc)) continue;
    const w = widths[e];
    if (!w.length) continue;
    w.sort((x, y) => x - y);
    const p90 = w[Math.max(0, Math.ceil(w.length * 0.9) - 1)] + padW[e];
    hc.style.width = `${Math.ceil(Math.max(p90, headW[e]))}px`;
  }
}
