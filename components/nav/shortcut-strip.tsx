"use client";

import {
  type CSSProperties,
  type DragEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { SoonTag } from "@/components/nav/app-frame";
import {
  NAV_MODULES,
  NAV_SIDEBAR_IDS,
  type NavModuleId,
  TRACKING_WIDGET_ID,
  isActive,
  isNavModuleId,
  isPinnable,
} from "@/components/nav/nav-config";
import { NAV_DRAG_TYPE, useNav } from "@/components/nav/nav-context";
import { TrackingWidget } from "@/components/nav/tracking-widget";
import { PageLink } from "@/components/ui/page-link";
import { cn } from "@/lib/utils";

import { shortcutColor } from "@/components/dashboard/shortcut-icon";

/** 拖进来的条目 id（侧栏条目、条上的块都带这个类型）。 */
function draggedId(e: DragEvent): NavModuleId | null {
  const id = e.dataTransfer.getData(NAV_DRAG_TYPE);
  return isNavModuleId(id) ? id : null;
}
const carriesModule = (e: DragEvent) =>
  e.dataTransfer.types.includes(NAV_DRAG_TYPE);

/**
 * 永远直接显示的五个（Annie 2026-10-24：「我要我设置的那几个基本的永远在里头，不转行不被折叠」「tracking也是永远在」）：
 * 窄了一起缩小，不换行、不收进「…」；「…」只收其余的。
 */
export const MUST_SHOW: ReadonlySet<NavModuleId> = new Set<NavModuleId>([
  "dashboard",
  "manifests",
  "forecast",
  "dispatch",
  TRACKING_WIDGET_ID,
]);

/** 缩小的下限：比这再窄就不再缩，药丸那一排改成可横向滑动（什么都不丢）。 */
const MIN_SCALE = 0.65;

export interface FitInput {
  /** 每个药丸在原始字号下的宽度（px），按显示顺序。 */
  widths: number[];
  /** 这个药丸是不是必显的。 */
  must: boolean[];
  /** 「…」按钮的宽度。 */
  more: number;
  /** Tracking 小部件的宽度：带「Tracking」字的 / 只剩三个圆圈的；没有小部件就都是 0。 */
  trackFull: number;
  trackShort: number;
  /** 「My shortcuts」几个字的宽度（顶栏条没有，传 0）。 */
  label: number;
  /** 一行可用的宽度。 */
  avail: number;
  /** 药丸之间的间距（px，原始字号）。 */
  gap: number;
}

/**
 * 窄了的顺序（Annie 2026-10-24 两次强调：「宽屏不折叠，你就缩小 shortcut 来适应」）：
 * ① 先把两处文字标签藏起来（「My shortcuts」「Tracking」，只留药丸和三个圆圈）；
 * ② 还放不下，**整条一起缩小**（所有药丸、Tracking、「…」按钮一起，下限 MIN_SCALE），不收进「…」；
 * ③ 缩到下限还放不下（真的很窄，比如手机），才把非必显的从最后一个开始收进「…」，字号停在下限；
 * ④ 只剩必显的五个还放不下，药丸那一排改成可横向滑动（什么都不丢）。
 * 宽度够就是原始大小（scale = 1），从来不会比原始大；越窄字号只会变小或不变（收进「…」之后字号也停在下限，不会跳大）。
 * 纯函数：宽度都由调用方量好传进来。
 */
export function fitShortcuts(input: FitInput): {
  show: boolean[];
  scale: number;
  hideLabels: boolean;
} {
  const { widths, must, more, trackFull, trackShort, label, avail, gap } =
    input;
  const show = widths.map(() => true);
  const chips = () =>
    widths.reduce((sum, w, i) => (show[i] ? sum + w + gap : sum), 0);
  const total = (labels: boolean) =>
    more +
    gap +
    (trackFull ? (labels ? trackFull : trackShort) + gap : 0) +
    (labels && label ? label + gap : 0) +
    chips();
  // ① 全部原样放得下
  if (total(true) <= avail) return { show, scale: 1, hideLabels: false };
  // ①' 藏掉文字就放得下
  if (total(false) <= avail) return { show, scale: 1, hideLabels: true };
  // ② 整条缩小（0.985 留一点余量给边框这类不跟字号走的像素）
  const fitScale = (avail / total(false)) * 0.985;
  if (fitScale >= MIN_SCALE) return { show, scale: fitScale, hideLabels: true };
  // ③ 缩到下限也放不下：非必显的从最后一个收进「…」，字号停在下限
  while (total(false) * MIN_SCALE * 1.015 > avail) {
    let last = -1;
    for (let i = widths.length - 1; i >= 0; i--) {
      if (show[i] && !must[i]) {
        last = i;
        break;
      }
    }
    if (last < 0) break;
    show[last] = false;
  }
  return { show, scale: MIN_SCALE, hideLabels: true };
}

type Variant = "page" | "bar";

const BASE_PX: Record<Variant, number> = { page: 13, bar: 12.5 };

/**
 * My shortcuts 的一行条（Annie 2026-10-24，K2 的样子）：Dashboard 页里是一张卡片（variant=page），
 * 其他页面是顶栏下面钉着的条（variant=bar，最左边 ← Back）。同一份 shortcuts、同一套拖拽 / × / 保存逻辑。
 * - 一行、不换行；Tracking 小部件在最左；窄了先藏文字、再整条缩小；缩到下限还放不下才把非必显的收进「…」菜单（里面还有 + 添加和 Reset to default），
 *   先藏文字、再整条缩小，实在缩到下限还放不下才收进「…」。
 * - 已经在它所属的页面，那一页的 shortcut 不显示（省地方）；匹配沿用侧栏「当前页高亮」的判断。
 */
export function ShortcutStrip({
  variant,
  pathname,
  leading,
}: {
  variant: Variant;
  pathname: string;
  leading?: ReactNode;
}) {
  const {
    shortcuts,
    labels,
    saving,
    saveError,
    setShortcuts,
    resetShortcuts,
    retrySave,
  } = useNav();
  const [over, setOver] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const list = shortcuts ?? [];
  const ready = shortcuts !== null;
  const bar = variant === "bar";
  const base = BASE_PX[variant];

  // 条上的药丸（不含 Tracking 小部件：它固定在最左）；当前页的不显示；bar 里 Dashboard 固定在最前、不能拖走 / 移除。
  const isHere = (id: NavModuleId) => {
    const m = NAV_MODULES[id];
    return !!m.href && isActive(m, pathname);
  };
  const chips = list.filter(
    (id) =>
      id !== TRACKING_WIDGET_ID && !isHere(id) && !(bar && id === "dashboard"),
  );
  const items: NavModuleId[] =
    bar && !isHere("dashboard") ? ["dashboard", ...chips] : chips;
  const hasTracking = list.includes(TRACKING_WIDGET_ID);
  const fixedFirst = (id: NavModuleId) => bar && id === "dashboard";

  /** 放到 beforeId 前面（没有就放最后）；已经在条上的就是挪位置。 */
  const place = (id: NavModuleId, beforeId: NavModuleId | null) => {
    if (bar && id === "dashboard") return;
    const rest = list.filter((x) => x !== id);
    const i = beforeId ? rest.indexOf(beforeId) : -1;
    if (i < 0) rest.push(id);
    else rest.splice(i, 0, id);
    if (rest.join() !== list.join()) setShortcuts(rest);
  };

  // ── 量宽度、决定哪些收进「…」、要不要缩小 ──
  const scalableRef = useRef<HTMLDivElement>(null);
  const measurerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{
    hidden: string[];
    scale: number;
    hideLabels: boolean;
  }>({ hidden: [], scale: 1, hideLabels: false });
  const itemsKey = items.join(",");
  const labelsKey = items.map((id) => labels[id]).join("|");

  const measure = () => {
    const box = scalableRef.current;
    const m = measurerRef.current;
    if (!box || !m) return;
    const widths = items.map(
      (id) =>
        m.querySelector<HTMLElement>(`[data-m-chip="${id}"]`)?.offsetWidth ?? 0,
    );
    const w = (sel: string) =>
      m.querySelector<HTMLElement>(sel)?.offsetWidth ?? 0;
    const result = fitShortcuts({
      widths,
      must: items.map((id) => MUST_SHOW.has(id) || fixedFirst(id)),
      more: w("[data-m-more]"),
      trackFull: hasTracking ? w("[data-m-track]") : 0,
      trackShort: hasTracking ? w("[data-m-track-short]") : 0,
      label: bar ? 0 : w("[data-m-label]"),
      avail: box.clientWidth,
      gap: base * 0.6,
    });
    const hidden = items.filter((_, i) => !result.show[i]);
    setFit((prev) =>
      prev.hidden.join() === hidden.join() &&
      prev.hideLabels === result.hideLabels &&
      Math.abs(prev.scale - result.scale) < 0.004
        ? prev
        : { hidden, scale: result.scale, hideLabels: result.hideLabels },
    );
  };

  useLayoutEffect(measure, [itemsKey, labelsKey, hasTracking, pathname, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const box = scalableRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    return () => ro.disconnect();
  }); // 每次渲染重新挂：measure 用的是当次的 items

  const hiddenSet = new Set(fit.hidden);
  const visible = items.filter((id) => !hiddenSet.has(id));
  const overflow = items.filter((id) => hiddenSet.has(id));

  // ── 一个药丸 ──
  const chip = (id: NavModuleId, live: boolean) => {
    const m = NAV_MODULES[id];
    const fixedOne = fixedFirst(id);
    const ac = shortcutColor(id);
    return (
      <li
        key={id}
        {...(live
          ? {
              "data-shortcut": id,
              draggable: !saving && !fixedOne,
              onDragStart: (e: DragEvent) => {
                e.dataTransfer.setData(NAV_DRAG_TYPE, id);
                e.dataTransfer.setData("text/plain", labels[id]);
                e.dataTransfer.effectAllowed = "move";
              },
              onDragOver: (e: DragEvent) => {
                if (saving || !carriesModule(e)) return;
                e.preventDefault();
                setOver(true);
              },
              onDrop: (e: DragEvent) => {
                e.stopPropagation();
                setOver(false);
                const dragged = draggedId(e);
                if (!dragged) return;
                e.preventDefault();
                if (dragged !== id) place(dragged, id);
              },
            }
          : { "data-m-chip": id })}
        style={{ "--ac": ac } as CSSProperties}
        className={cn(
          "flex shrink-0 items-center border font-semibold whitespace-nowrap text-white transition",
          bar
            ? "h-[2.56em] rounded-[.72em] border-white/10 bg-white/[.04] hover:border-white/20 hover:bg-white/[.07]"
            : "rounded-[.8em] border-[color-mix(in_srgb,var(--ac)_35%,rgba(255,255,255,.15))] bg-[color-mix(in_srgb,var(--ac)_10%,transparent)] hover:border-[color-mix(in_srgb,var(--ac)_55%,rgba(255,255,255,.2))]",
          !fixedOne && "cursor-grab active:cursor-grabbing",
        )}
      >
        <PageLink
          href={m.href!}
          draggable={false}
          tabIndex={live ? undefined : -1}
          className={cn(
            "flex h-full items-center gap-[.5em] text-white no-underline",
            bar ? "pl-[.95em]" : "py-[.3em] pl-[.85em]",
            fixedOne ? "pr-[.95em]" : "pr-[.2em]",
          )}
        >
          {bar ? (
            <span
              aria-hidden
              className="size-[.5em] shrink-0 rounded-full"
              style={{ background: m.dot ?? "rgba(255,255,255,.4)" }}
            />
          ) : null}
          {labels[id]}
          {m.upcoming ? <SoonTag /> : null}
        </PageLink>
        {fixedOne ? null : (
          <button
            type="button"
            aria-label={`Remove ${labels[id]} from shortcuts`}
            disabled={saving || !live}
            tabIndex={live ? undefined : -1}
            onClick={() => setShortcuts(list.filter((x) => x !== id))}
            className="flex h-full w-[1.7em] items-center justify-center text-[.95em] text-white/45 hover:text-white disabled:cursor-wait"
          >
            ×
          </button>
        )}
      </li>
    );
  };

  const moreButton = (live: boolean) => (
    <button
      type="button"
      {...(live ? {} : { "data-m-more": "" })}
      aria-label="More shortcuts"
      aria-haspopup="menu"
      aria-expanded={live ? menuOpen : false}
      tabIndex={live ? undefined : -1}
      disabled={!ready}
      onClick={() => live && setMenuOpen((o) => !o)}
      className={cn(
        "flex shrink-0 items-center justify-center border border-white/15 font-bold text-white/80 hover:bg-white/[.08] disabled:opacity-50",
        bar
          ? "h-[2.56em] rounded-[.72em] px-[.8em]"
          : "rounded-[.8em] px-[.75em] py-[.3em]",
      )}
    >
      …
    </button>
  );

  const trackingBlock = (live: boolean, short = false) => (
    <div
      {...(live
        ? { "data-shortcut": TRACKING_WIDGET_ID }
        : short
          ? { "data-m-track-short": "" }
          : { "data-m-track": "" })}
      className={cn(
        "flex shrink-0 items-center rounded-[.8em] border whitespace-nowrap",
        "border-[color-mix(in_srgb,#38bdf8_30%,rgba(255,255,255,.15))] bg-white/[.03]",
        bar ? "h-[2.56em]" : "py-[.2em]",
      )}
    >
      <TrackingWidget
        label={labels[TRACKING_WIDGET_ID]}
        compact
        hideLabel={short || (live && fit.hideLabels)}
      />
      <button
        type="button"
        aria-label={`Remove ${labels[TRACKING_WIDGET_ID]} from shortcuts`}
        disabled={saving || !live}
        tabIndex={live ? undefined : -1}
        onClick={() =>
          setShortcuts(list.filter((x) => x !== TRACKING_WIDGET_ID))
        }
        className="flex h-full w-[1.7em] items-center justify-center text-[.95em] text-white/45 hover:text-white disabled:cursor-wait"
      >
        ×
      </button>
    </div>
  );

  // 「…」菜单里「+ 添加」列的：还没在条上的、能钉的页面。
  const addable = NAV_SIDEBAR_IDS.filter(
    (id) => isPinnable(id) && !list.includes(id) && id !== TRACKING_WIDGET_ID,
  );

  return (
    <section
      aria-label="My shortcuts"
      data-shortcut-strip={variant}
      data-fit-scale={fit.scale.toFixed(2)}
      data-fit-hidden={fit.hidden.join(",")}
      data-fit-labels={fit.hideLabels ? "hidden" : "shown"}
      onDragOver={(e) => {
        if (!ready || saving || !carriesModule(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        const id = draggedId(e);
        if (!id) return;
        e.preventDefault();
        place(id, null);
      }}
      className={cn(
        "flex items-center gap-2 transition-colors",
        bar
          ? cn(
              "min-h-12 border-b px-4 py-2 sm:px-7",
              over
                ? "border-[#38bdf8]/50 bg-[#38bdf8]/[.08]"
                : "border-white/[.06] bg-[rgba(5,11,19,.56)]",
            )
          : cn(
              "db-section mb-[18px] rounded-[16px] border px-4 py-2.5",
              over
                ? "border-[#38bdf8]/70 bg-[#38bdf8]/[.06]"
                : "border-white/[.14]",
            ),
      )}
    >
      {leading}
      <div
        ref={scalableRef}
        style={{ fontSize: `${base * fit.scale}px` }}
        className="relative flex min-w-0 flex-1 items-center gap-[.6em]"
        aria-busy={saving}
      >
        {bar || fit.hideLabels ? null : (
          <span
            className="db-title shrink-0 text-[.92em] font-bold tracking-[.03em] whitespace-nowrap text-white/70"
            title="Drag a page here from the ☰ menu, or click its pin · drag to reorder · × to remove"
          >
            My shortcuts
          </span>
        )}
        {/* Tracking 在最左（Annie 2026-10-24「可以把tracking放到左边么」）：「My shortcuts」标签之后、药丸之前；标签藏起来时就是整条最左。 */}
        {ready && hasTracking ? (
          <div className="shrink-0">{trackingBlock(true)}</div>
        ) : null}
        {!ready ? (
          <span className="text-[.95em] text-white/60">Loading…</span>
        ) : (
          <ul className="m-0 flex min-w-0 [scrollbar-width:none] list-none items-center gap-[.6em] overflow-x-auto p-0">
            {visible.map((id) => chip(id, true))}
            {items.length === 0 ? (
              <li className="shrink-0 px-1 text-[.95em] whitespace-nowrap text-white/50">
                Drag a page here from the ☰ menu, or click its pin
              </li>
            ) : null}
          </ul>
        )}
        {ready ? (
          <div className="relative shrink-0">
            {moreButton(true)}
            {menuOpen ? (
              <ShortcutMenu
                overflow={overflow}
                labels={labels}
                addable={addable}
                saving={saving}
                onClose={() => setMenuOpen(false)}
                onAdd={(id) => {
                  setMenuOpen(false);
                  setShortcuts([...list, id]);
                }}
                onRemove={(id) => setShortcuts(list.filter((x) => x !== id))}
                onReset={() => {
                  setMenuOpen(false);
                  resetShortcuts();
                }}
              />
            ) : null}
          </div>
        ) : null}

        {/* 量宽度用的隐藏副本：原始字号、不占位、不能点（aria-hidden + inert）。外面套一层 0×0 + overflow-hidden，
            副本很宽，不套的话会把整页撑出横向滚动条。 */}
        <div
          aria-hidden
          className="pointer-events-none invisible absolute top-0 left-0 h-0 w-0 overflow-hidden"
        >
          <div
            ref={measurerRef}
            {...({ inert: true } as object)}
            style={{ fontSize: `${base}px` }}
            className="flex w-max items-center gap-[.6em]"
          >
            {bar ? null : (
              <span
                data-m-label
                className="shrink-0 text-[.92em] font-bold tracking-[.03em] whitespace-nowrap"
              >
                My shortcuts
              </span>
            )}
            {items.map((id) => chip(id, false))}
            {moreButton(false)}
            {hasTracking ? trackingBlock(false) : null}
            {hasTracking ? trackingBlock(false, true) : null}
          </div>
        </div>
      </div>
      {saveError ? (
        <span
          role="alert"
          className="flex shrink-0 items-center gap-2 text-xs text-[#fca5a5]"
        >
          Couldn&rsquo;t save ({saveError.replace(/\.$/, "")}). Back to how it
          was.
          <button
            type="button"
            disabled={saving}
            onClick={retrySave}
            className="rounded-md border border-white/20 px-2 py-0.5 font-semibold text-white hover:bg-white/10"
          >
            Try again
          </button>
        </span>
      ) : null}
    </section>
  );
}

/** 「…」菜单：被收起的 shortcut、+ 添加一个页面、Reset to default。点外面或按 Esc 关。 */
function ShortcutMenu({
  overflow,
  labels,
  addable,
  saving,
  onClose,
  onAdd,
  onRemove,
  onReset,
}: {
  overflow: NavModuleId[];
  labels: Record<NavModuleId, string>;
  addable: readonly NavModuleId[];
  saving: boolean;
  onClose: () => void;
  onAdd: (id: NavModuleId) => void;
  onRemove: (id: NavModuleId) => void;
  onReset: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const item =
    "flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-[13px] text-white no-underline hover:bg-white/[.08]";

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="More shortcuts"
      data-shortcut-menu
      className="absolute top-[calc(100%+6px)] right-0 z-50 w-64 rounded-xl border border-white/20 bg-[#0f2238] p-1.5 text-[13px] font-normal text-white shadow-[0_16px_40px_rgba(0,0,0,.55)]"
      style={{ fontSize: "13px" }}
    >
      {overflow.length ? (
        <>
          <p className="px-2.5 pt-1 pb-0.5 text-[11px] font-bold tracking-[.06em] text-white/45 uppercase">
            More shortcuts
          </p>
          {overflow.map((id) => (
            <div key={id} className="flex items-center">
              <PageLink
                href={NAV_MODULES[id].href!}
                role="menuitem"
                data-menu-shortcut={id}
                className={item}
              >
                {labels[id]}
              </PageLink>
              <button
                type="button"
                aria-label={`Remove ${labels[id]} from shortcuts`}
                disabled={saving}
                onClick={() => onRemove(id)}
                className="px-2 text-white/45 hover:text-white disabled:cursor-wait"
              >
                ×
              </button>
            </div>
          ))}
          <div className="my-1 border-t border-white/10" />
        </>
      ) : null}
      <button
        type="button"
        role="menuitem"
        aria-expanded={adding}
        onClick={() => setAdding((a) => !a)}
        className={item}
      >
        <span>+ Add a shortcut</span>
        <span aria-hidden className="text-white/45">
          {adding ? "▴" : "▾"}
        </span>
      </button>
      {adding ? (
        <div className="max-h-56 overflow-y-auto pl-2">
          {addable.length === 0 ? (
            <p className="px-2.5 py-1.5 text-white/50">
              Everything is already here.
            </p>
          ) : (
            addable.map((id) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                data-menu-add={id}
                disabled={saving}
                onClick={() => onAdd(id)}
                className={item}
              >
                {labels[id]}
              </button>
            ))
          )}
        </div>
      ) : null}
      <div className="my-1 border-t border-white/10" />
      <button
        type="button"
        role="menuitem"
        disabled={saving}
        onClick={onReset}
        className={cn(item, "text-[#38bdf8]")}
      >
        Reset to default
      </button>
    </div>
  );
}
