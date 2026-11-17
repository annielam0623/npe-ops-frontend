"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  CANYON_PARAM,
  MANIFEST_DOWNLOAD_URL,
  manifestPrintUrl,
} from "@/lib/dispatch-manifest-api";
import { cn } from "@/lib/utils";

import { LineIcon } from "./line-icons";

/**
 * Bus Manifest 的「View only」（151，Annie 2026-11-16「全部同意推荐」「动手」，preview 第 4 版
 * https://claude.ai/artifact/3RS1yP6wErhpT9wJdXLuY5 ）：
 * - 「就是一个view，跟print的预览是一样的，就是这个bus manifest打印出来后的样子，整页显示」⇒ 直接用后端打印页
 *   （/admin/dispatch/manifest/print，admin/tour_manifest_print.html）来画，不另写一套，看到的就是打出来的。
 * - 「然后是全屏显示」⇒ 盖住整个 ops（顶栏、侧栏、shortcut、页头都不出），只剩纸 + 一条细栏；
 *   电脑 / Android 用浏览器真全屏（点键时请求），iPhone Safari 没有这个 API，就是页面内全屏。
 * - 「可以打印可以下载，就是不需要编辑」⇒ 细栏：团名 · 日期、All / A / B、Print、Download、✕（电脑 Esc）。
 * - 题 ⑩ A：手机上整张纸缩到屏宽，两指放大看细节。
 * - 题 ⑪ A：只看不记 Printed，按 Print 才记 ⇒ 看的时候带 view=1（后端「只看」开关：不记、不出它自己那条黑栏）；
 *   按 Print 换成不带 view=1 的打印页（后端照旧记一条 Printed），载入后直接出浏览器打印框。
 *   后端还没上「只看」开关时，那条黑栏由这里藏掉（同源页面），纸样不受影响。
 */

/** 151 View only（preview 第 4 版 How to use 第 5、6 句原文，Annie「全部同意推荐」）。 */
export const VIEW_ONLY_HOW_TO = [
  "Click View only to see the Bus Manifest exactly as it prints, one sheet after another, full screen. Nothing can be changed there; Print and Download work as on the page. Click ✕ (or press Esc on a computer) to go back. On an iPhone the browser bar stays at the top.",
  "On a phone, View only fits each sheet to the screen width. Turn the phone sideways or pinch to zoom in.",
] as const;

/** 网址上的参数：view=all 看全部车，view=<车字母> 只看那一台（入口页 Bus Manifests 点车也是这样进来的）。 */
export const VIEW_PARAM = "view";
/** 给后端打印页的「只看」开关（题 ⑪ A；以后端合同为准）。 */
export const PRINT_VIEW_FLAG = "view";

/** 点键时请求浏览器真全屏（必须在点击里调）；iPhone Safari 没有 requestFullscreen，什么也不做。 */
export function enterFullscreen(): void {
  const el = document.documentElement;
  if (document.fullscreenElement || typeof el.requestFullscreen !== "function")
    return;
  el.requestFullscreen().catch(() => undefined);
}

export interface PaperBus {
  /** 车字母（bus_key），网址上用它。 */
  key: string;
  /** 排车 id：打印页的 bus 参数。 */
  id: number;
}

const BAR_KEY =
  "inline-flex h-[30px] cursor-pointer items-center justify-center gap-1.5 rounded-[8px] border border-white/30 bg-transparent px-3 text-[12.5px] font-semibold whitespace-nowrap text-[#e2e8f0] hover:bg-white/10 disabled:cursor-default disabled:opacity-50 max-sm:px-2";

export function PaperView({
  date,
  tour,
  title,
  dateLabel,
  buses,
  selected,
  canyonPages,
  canPrint,
  canDownload,
  guardPrint,
  guardDownload,
  onSelect,
  onClose,
  notOnBus,
  children,
}: {
  date: string;
  tour: number;
  title: string;
  dateLabel: string;
  buses: PaperBus[];
  /** "all" 或车字母。 */
  selected: string;
  canyonPages?: string[][];
  canPrint: boolean;
  canDownload: boolean;
  /** 餐不符等提醒（同页面上的 Print）：拦下了返回 true，之后由提醒里的「Print anyway」调 go。 */
  guardPrint: (busKey: string | null, go: () => void) => boolean;
  guardDownload: (go: () => void) => boolean;
  onSelect: (key: string) => void;
  onClose: () => void;
  /** 还没上车的客人（看全部车时提醒：打印页黑栏里原来那句，黑栏藏了就放到这条细栏里）。 */
  notOnBus?: { guests: number; pax: number } | null;
  /** 在全屏层上面弹的提醒（餐不符）：放在这一层里，才盖得住全屏层。 */
  children?: ReactNode;
}) {
  const bus = buses.find((b) => b.key === selected) ?? null;
  const base = manifestPrintUrl(date, tour, bus?.id, canyonPages);
  /** 按 Print 的次数：>0 ⇒ 载入不带 view=1 的打印页（后端记 Printed）并直接打印。 */
  const [printRun, setPrintRun] = useState(0);
  const src =
    printRun > 0 ? `${base}&p=${printRun}` : `${base}&${PRINT_VIEW_FLAG}=1`;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const printPending = useRef(false);
  /** 纸样原本的宽高（px）；量到之前 null。 */
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [boxW, setBoxW] = useState(0);
  const [failed, setFailed] = useState(false);

  // 换车：回到只看（不记 Printed）。
  const [lastSelected, setLastSelected] = useState(selected);
  if (lastSelected !== selected) {
    setLastSelected(selected);
    setPrintRun(0);
    setSize(null);
  }

  /** 量纸样本来的宽高：body 按内容宽（见 onLoad 塞的样式），不受框宽影响。 */
  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.body) return;
    const w = Math.ceil(doc.body.getBoundingClientRect().width);
    const h = Math.ceil(doc.body.scrollHeight);
    if (w > 0 && h > 0)
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
  }, []);

  function onLoad() {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.body) {
      setFailed(true);
      return;
    }
    setFailed(false);
    // 后端「只看」开关没上之前：打印页自己那条带 Print 键的黑栏在这里藏掉；纸本身不动。
    if (!doc.getElementById("ops-paper-view-style")) {
      const style = doc.createElement("style");
      style.id = "ops-paper-view-style";
      // 只改屏幕上的：藏黑栏；纸靠左排、body 按内容宽（打印页本来居中，框比纸窄时左边会被裁掉、也量不准宽度）。
      // 打印（@media print）不受影响。
      style.textContent =
        "@media screen { body > .bar { display: none !important; } html, body { overflow: hidden !important; } body { width: max-content !important; } .pages { align-items: flex-start !important; } }";
      doc.head?.appendChild(style);
    }
    doc.addEventListener("keydown", (e) => {
      if (e.key === "Escape") onCloseRef.current();
    });
    measure();
    // 打印页末尾的脚本会把太长的页拆开，量两次。
    window.setTimeout(measure, 300);
    window.setTimeout(measure, 1200);
    if (printPending.current) {
      printPending.current = false;
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }
  }

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // 盒子宽度（手机缩到屏宽，题 ⑩ A）。
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const update = () => setBoxW(box.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // Esc 关；真全屏时 Esc 先退出全屏（浏览器自己的），退出了就关。整页不能在底下滚。
  useEffect(() => {
    let wasFull = !!document.fullscreenElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement)
        onCloseRef.current();
    };
    const onFs = () => {
      if (document.fullscreenElement) wasFull = true;
      else if (wasFull) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      document.body.style.overflow = overflow;
      if (document.fullscreenElement)
        document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const scale = size && boxW ? Math.min(1, boxW / size.w) : 1;

  function print() {
    const go = () => {
      printPending.current = true;
      setPrintRun((n) => n + 1);
    };
    if (!guardPrint(bus?.key ?? null, go)) go();
  }

  function download() {
    const go = () => formRef.current?.submit();
    if (!guardDownload(go)) go();
  }

  const label = (key: string) => (key === "all" ? "All" : key);
  const choices = buses.length > 1 ? ["all", ...buses.map((b) => b.key)] : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} · View only`}
      data-paper-view
      className="fixed inset-0 z-[200] flex flex-col bg-[#e9ecef] print:hidden"
    >
      <div
        data-paper-bar
        className="flex flex-none items-center gap-2 bg-[#0b1724] py-2 pr-[max(12px,env(safe-area-inset-right))] pl-[max(12px,env(safe-area-inset-left))] text-[13px] text-[#e2e8f0] max-sm:gap-1.5"
      >
        <b className="min-w-0 truncate" data-paper-title>
          {title} · {dateLabel}
        </b>
        {choices.length ? (
          <span
            role="group"
            aria-label="Bus"
            className="inline-flex flex-none overflow-hidden rounded-[8px] border border-white/30"
          >
            {choices.map((key) => (
              <button
                key={key}
                type="button"
                data-paper-bus={key}
                aria-pressed={selected === key}
                onClick={() => onSelect(key)}
                className={cn(
                  "h-[28px] cursor-pointer px-2.5 text-[12.5px] font-semibold",
                  selected === key
                    ? "bg-[#e2e8f0] text-[#0b1724]"
                    : "bg-transparent text-[#e2e8f0] hover:bg-white/10",
                )}
              >
                {label(key)}
              </button>
            ))}
          </span>
        ) : null}
        {selected === "all" && notOnBus && notOnBus.guests > 0 ? (
          <span
            data-paper-not-on-bus
            className="min-w-0 truncate text-[12px] font-semibold text-[#fca5a5] max-sm:hidden"
          >
            {notOnBus.guests} booking{notOnBus.guests === 1 ? "" : "s"} (
            {notOnBus.pax} pax) not on a bus yet: not on these pages.
          </span>
        ) : null}
        <span className="flex-1" />
        {canPrint ? (
          <button
            type="button"
            data-paper-print
            aria-label="Print"
            onClick={print}
            className={BAR_KEY}
          >
            <LineIcon name="print" />
            <span className="max-sm:hidden">Print</span>
          </button>
        ) : null}
        {canDownload ? (
          <form
            ref={formRef}
            method="post"
            action={MANIFEST_DOWNLOAD_URL}
            className="m-0"
            onSubmit={(e) => {
              e.preventDefault();
              download();
            }}
          >
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="tour" value={tour} />
            {canyonPages?.length ? (
              <input
                type="hidden"
                name={CANYON_PARAM}
                value={JSON.stringify(canyonPages)}
              />
            ) : null}
            <button
              type="submit"
              data-paper-download
              aria-label="Download"
              className={BAR_KEY}
            >
              <LineIcon name="download" />
              <span className="max-sm:hidden">Download</span>
            </button>
          </form>
        ) : null}
        <button
          type="button"
          data-paper-close
          aria-label="Close View only"
          title="Close (Esc)"
          onClick={onClose}
          className={cn(BAR_KEY, "px-2.5 text-[15px]")}
        >
          ✕
        </button>
      </div>
      <div ref={boxRef} className="min-h-0 flex-1 overflow-auto">
        {failed ? (
          <p className="p-6 text-center text-[13px] text-[#b3261e]">
            Could not open the Bus Manifest. Close this and try again.
          </p>
        ) : null}
        <div
          className="relative mx-auto"
          style={
            size
              ? { width: size.w * scale, height: size.h * scale }
              : { width: "100%", height: "100%" }
          }
        >
          <iframe
            ref={frameRef}
            key={src}
            src={src}
            title={`${title} Bus Manifest`}
            data-paper-frame
            onLoad={onLoad}
            className="absolute top-0 left-0 border-0 bg-[#e9ecef]"
            style={
              size
                ? {
                    width: size.w,
                    height: size.h,
                    transform: `scale(${scale})`,
                    transformOrigin: "0 0",
                  }
                : { width: "100%", height: "100%", opacity: 0 }
            }
          />
        </div>
      </div>
      {children}
    </div>
  );
}
