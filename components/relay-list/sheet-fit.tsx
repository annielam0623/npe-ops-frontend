"use client";

import { type RefObject, useEffect, useLayoutEffect, useState } from "react";

/**
 * Relay list 一张单超过一页 / 比纸宽时自动压空白（置顶 112，Annie「111， 112 全 A + 动手」，preview 第 4 版）。
 * 每张单（总表、每台车）各算各的，量的是屏幕上这张单自己的纸（A4 / Letter、横竖、页边距），屏幕 = 打印：
 * - 太宽（Q7 A）：格子左右内边距一步步压到 2px；还宽就把左右页边距一起变小（整张挪到纸中间），最少各留 5mm；还宽 ⇒ 黄框。不折行。
 * - 太高：酒店之间的空隙 12px → 最小 6px（每步 2px），再行内上下内边距 → 最小 1px（每步 1px），一页就停；
 *   空隙压过的单酒店间两条线变 2px 深灰（relay-list.css `[data-squeezed]`）；还超 ⇒ 黄框写几页。不缩字，压的时候不出字（Q5 A）。
 * 只写这张单 section 上的内联 CSS 变量 / padding，React 不管这几个属性；每次画完都从默认重新算。
 * 屏幕 = 打印（Annie「一定要看到得页面页面也就是打印得页面，不要yipreview打印」）：白纸就是一页纸的大小；
 * 超页时屏幕上画出第 2 页从哪开始（红虚线），超宽时画出纸的右边（红虚线），都只在屏幕上，字号 / 边距一变马上跟着变。
 */

const MM = 96 / 25.4;
const GAPS = [10, 8, 6];
/** 最少留的左右页边距（大多数打印机贴边 3–5mm 印不出来）。 */
const MIN_SIDE_MM = 5;
/** 量出来和纸高差 2px 以内也当放得下以外：留 2px 余量，免得打印时差一点点溢到第二页。 */
const SAFETY_PX = 2;

export interface SheetFit {
  /** 全压完要印几页（1 = 放得下）。 */
  pages: number;
  /** 全压完、挪完还比纸宽。 */
  wide: boolean;
  /** 一页纸多高（px，换页线画在它的整数倍上）。 */
  paperH: number;
}

const FIT_OK: SheetFit = { pages: 1, wide: false, paperH: 0 };

function contentHeight(sheet: HTMLElement): number {
  const top = sheet.getBoundingClientRect().top + parseFloat(getComputedStyle(sheet).paddingTop);
  let bottom = top;
  for (const el of Array.from(sheet.children))
    if (!el.hasAttribute("data-relay-fit-mark"))
      bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  return bottom - top;
}

function widest(sheet: HTMLElement): number {
  let w = 0;
  for (const t of Array.from(sheet.querySelectorAll("table")))
    w = Math.max(w, t.getBoundingClientRect().width);
  return w;
}

/** 量一次、压一次（直接改 sheet 的内联样式），返回结果。 */
export function fitSheet(sheet: HTMLElement, total: boolean): SheetFit {
  const s = sheet.style;
  s.removeProperty("--rl-gap");
  s.removeProperty("--rl-py");
  s.removeProperty("--rl-px");
  s.removeProperty("padding-left");
  s.removeProperty("padding-right");
  sheet.removeAttribute("data-squeezed");

  const cs = getComputedStyle(sheet);
  const padTop = parseFloat(cs.paddingTop);
  const padBottom = parseFloat(cs.paddingBottom);
  const side0 = parseFloat(cs.paddingLeft);
  const paperH = parseFloat(cs.minHeight);
  const limit = paperH - padTop - padBottom - SAFETY_PX;
  if (!(limit > 0)) return FIT_OK;

  // 左右：先压格子左右内边距，再挪到中间。
  let side = side0;
  const over = () => widest(sheet) - (sheet.clientWidth - 2 * side);
  if (over() > 0.5) {
    for (let px = total ? 4 : 5; px >= 2; px--) {
      s.setProperty("--rl-px", `${px}px`);
      if (over() <= 0.5) break;
    }
    if (over() > 0.5) {
      side = Math.max(Math.min(side0, MIN_SIDE_MM * MM), side0 - over() / 2);
      s.paddingLeft = `${side}px`;
      s.paddingRight = `${side}px`;
    }
  }
  const wide = over() > 0.5;

  // 上下：先酒店间空隙，再行内上下内边距。
  if (contentHeight(sheet) > limit) {
    sheet.setAttribute("data-squeezed", "");
    for (const g of GAPS) {
      s.setProperty("--rl-gap", `${g}px`);
      if (contentHeight(sheet) <= limit) break;
    }
    for (let py = total ? 1 : 3; py >= 1 && contentHeight(sheet) > limit; py--)
      s.setProperty("--rl-py", `${py}px`);
  }
  // 打印时第 2 页起从纸的最上面接着印（@page margin 0，上边距只在第一页）。
  const h = contentHeight(sheet);
  const pages = h <= limit ? 1 : Math.ceil((padTop + h) / paperH);
  return { pages, wide, paperH };
}

/**
 * 每次画完都重算（字号、纸张、边距、方向、名单变了都会重画）；字体晚到时再算一次。结果没变不触发重画。
 */
export function useSheetFit(
  ref: RefObject<HTMLElement | null>,
  total: boolean,
): SheetFit {
  const [fit, setFit] = useState<SheetFit>(FIT_OK);
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) setFontsTick((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, []);
  // 故意不写依赖：字号 / 纸张 / 边距 / 名单从好几个 context 来，每次画完都要重算；setFit 只在结果变了才换，不会一直重画。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = fitSheet(el, total);
    setFit((f) =>
      f.pages === next.pages && f.wide === next.wide && f.paperH === next.paperH
        ? f
        : next,
    );
  });
  void fontsTick;
  return fit;
}

/** 单子上方的黄框（只在屏幕上，照 legacy-ui 黄框 #f0d080 / #fff8e1 / #7C4A00）。放得下 = 什么都不出。 */
export function SheetFitWarn({ fit }: { fit: SheetFit }) {
  const tall = fit.pages > 1;
  if (!tall && !fit.wide) return null;
  const lead =
    tall && fit.wide
      ? `This sheet will print on ${fit.pages} pages and is too wide for the paper.`
      : tall
        ? `This sheet will print on ${fit.pages} pages.`
        : "This sheet is too wide for the paper.";
  return (
    <div
      role="status"
      data-relay-fit-warn
      data-pages={fit.pages}
      data-wide={fit.wide ? "1" : "0"}
      className="rl-screen-only mx-auto mb-2 w-full max-w-[var(--rl-ph,297mm)] rounded-[10px] border border-[#f0d080] bg-[#fff8e1] px-4 py-2.5 text-[12.5px] leading-[1.7] text-[#7C4A00]"
    >
      <b>{lead}</b> Make the text smaller.
    </div>
  );
}

/** 放在单子 section 里（只在屏幕上）：超页的换页线、超宽的纸边线。不参与量高（data-relay-fit-mark）。 */
export function SheetFitMarks({ fit }: { fit: SheetFit }) {
  return (
    <>
      {Array.from({ length: fit.pages - 1 }, (_, i) => (
        <div
          key={i}
          data-relay-fit-mark
          data-relay-page-break={i + 2}
          className="rl-screen-only rl-pagebreak"
          style={{ top: (i + 1) * fit.paperH }}
        >
          <span>Page {i + 2} starts here</span>
        </div>
      ))}
      {fit.wide ? (
        <div data-relay-fit-mark data-relay-paper-edge className="rl-screen-only rl-paperedge">
          <span>Paper edge — anything to the right is cut off</span>
        </div>
      ) : null}
    </>
  );
}
