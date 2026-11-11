"use client";

import { type ReactNode, useEffect, useState } from "react";

import {
  LineIcon,
  type LineIconName,
} from "@/components/dispatch-manifest/line-icons";
import { cn } from "@/lib/utils";
import type {
  ManifestTextLayer,
  ManifestTextSize,
  ManifestTextSizeChange,
  ManifestVersion,
} from "@/types";

/**
 * G197 字号编辑（preview https://claude.ai/artifact/BnkQnUK4XrxA8NzrYqA5ZK 第 2 版，Annie 2026-10-27「197动手」，选项全定）：
 * 三层 全页 / 整列（列键）/ 整行（订单号）；每层 `d`（整数 px，−2..+10，步长 1）+ `bold`（不设 = 跟下一层）。
 * 叠加：大小相加后夹在 −2..+10；粗细取最具体的一层（整行 > 整列 > 全页）。手机（< 600px）最多 +4，只在屏幕上，打印照存的。
 * 默认字号照纸本（G198 Q1）：正文 16.5px 粗体、人数 19px。
 * 三版式各有默认（Annie 10-28 17:3x）：General / Lankun 同上；Marcello 是字大的 General，照打印模板放大
 * （格里 10.5pt → 13.5pt、人数 16 → 20px）⇒ 屏幕上正文 21px、人数 24px。调过的 d 加在版式的默认上。
 */
export const TEXT_MIN = -2;
export const TEXT_MAX = 10;
export const PHONE_MAX = 4;

/** 表格每一列的键（存「整列」用，定了别改）。 */
export type ManifestColumnKey =
  | "order_number"
  | "pickup_time"
  | "pickup_location"
  | "last_name"
  | "first_name"
  | "phone"
  | "pax"
  | "ticket"
  | "notes"
  | "boarding"
  | "lunch";

type Base = {
  cell: [px: number, bold: boolean];
  pax: [px: number, bold: boolean];
};
const BASE: Record<ManifestVersion, Base> = {
  general: { cell: [16.5, true], pax: [19, true] },
  lankun: { cell: [16.5, true], pax: [19, true] },
  marcello: { cell: [21, true], pax: [24, true] },
  west: { cell: [16.5, true], pax: [19, true] },
};

/** 表头 / 节标题的字号（Marcello 一起放大，Q24）。 */
export const HEAD_PX: Record<ManifestVersion, { th: number; section: number }> =
  {
    general: { th: 9.5, section: 17 },
    lankun: { th: 9.5, section: 17 },
    marcello: { th: 12, section: 21 },
    west: { th: 9.5, section: 17 },
  };

/** 版式默认字号（Text 页显示「16.5 px」这种用）：正文 / 人数。 */
export const BASE_PX: Record<ManifestVersion, { cell: number; pax: number }> = {
  general: { cell: BASE.general.cell[0], pax: BASE.general.pax[0] },
  lankun: { cell: BASE.lankun.cell[0], pax: BASE.lankun.pax[0] },
  marcello: { cell: BASE.marcello.cell[0], pax: BASE.marcello.pax[0] },
  west: { cell: BASE.west.cell[0], pax: BASE.west.pax[0] },
};

export const EMPTY_TEXT_SIZE: ManifestTextSize = {
  page: {},
  columns: {},
  rows: {},
};

const clamp = (n: number, max: number) => Math.max(TEXT_MIN, Math.min(max, n));

/** 每天的起点（版式设置 Text 页，置顶 92 第 2 批）：在版式默认上加减 d px；bold 不设 = 照版式默认。 */
export interface TextStart {
  d: number;
  bold?: boolean;
}

/** 一格最后的字号 / 粗细（每格都用它，没存过设定时就是纸本默认）。start = 每天的起点（正文 / 人数）；当天 Aa 再加在上面。 */
export function cellText(
  ts: ManifestTextSize | null | undefined,
  col: ManifestColumnKey,
  order: string | null,
  phone: boolean,
  version: ManifestVersion = "general",
  start?: { cell?: TextStart; pax?: TextStart },
): { fontSize: string; fontWeight: number; changed: boolean } {
  const base = BASE[version] ?? BASE.general;
  const [px0, bold0] = col === "pax" ? base.pax : base.cell;
  const s0 = col === "pax" ? start?.pax : start?.cell;
  const px = px0 + (s0?.d ?? 0);
  const baseBold = s0?.bold ?? bold0;
  const layers = ts
    ? [ts.page, ts.columns[col], order ? ts.rows[order] : undefined]
    : [];
  let d = 0;
  let bold = baseBold;
  let changed = false;
  for (const l of layers) {
    if (!l) continue;
    if (l.d) {
      d += l.d;
      changed = true;
    }
    if (l.bold !== undefined) {
      bold = l.bold;
      changed = true;
    }
  }
  d = clamp(d, phone ? Math.min(PHONE_MAX, TEXT_MAX) : TEXT_MAX);
  return {
    fontSize: `${px + d}px`,
    fontWeight: bold ? (col === "pax" ? 800 : 700) : 400,
    changed,
  };
}

/** 屏幕窄于 600px（手机）。 */
export function usePhoneWidth(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 599px)");
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}

/** column 的 id：Bus Manifest 是 ManifestColumnKey；Relay list 当天字号（置顶 92 Q5）用它自己的列键。 */
export type TextPick =
  | { kind: "page" }
  | { kind: "column"; id: string }
  | { kind: "row"; id: string };
export type TextMode = TextPick["kind"];

export function layerOf(ts: ManifestTextSize, p: TextPick): ManifestTextLayer {
  if (p.kind === "page") return ts.page;
  if (p.kind === "column") return ts.columns[p.id] ?? {};
  return ts.rows[p.id] ?? {};
}

/** 改选中的那几层（不可变更新）。`fn` 返回新的一层；空层直接删掉。 */
export function updateLayers(
  ts: ManifestTextSize,
  picks: TextPick[],
  fn: (l: ManifestTextLayer) => ManifestTextLayer,
): ManifestTextSize {
  const next: ManifestTextSize = {
    page: { ...ts.page },
    columns: { ...ts.columns },
    rows: { ...ts.rows },
  };
  const tidy = (l: ManifestTextLayer): ManifestTextLayer | null => {
    const out: ManifestTextLayer = {};
    if (l.d) out.d = clamp(l.d, TEXT_MAX);
    if (l.bold !== undefined) out.bold = l.bold;
    return Object.keys(out).length ? out : null;
  };
  for (const p of picks) {
    const t = tidy(fn(layerOf(next, p)));
    if (p.kind === "page") next.page = t ?? {};
    else if (p.kind === "column") {
      if (t) next.columns[p.id] = t;
      else delete next.columns[p.id];
    } else if (t) next.rows[p.id] = t;
    else delete next.rows[p.id];
  }
  return next;
}

export function samePick(a: TextPick, b: TextPick): boolean {
  if (a.kind === "page" || b.kind === "page") return a.kind === b.kind;
  return a.kind === b.kind && a.id === b.id;
}

/** 点一下：没选就加上，选了就去掉。 */
export function togglePick(picks: TextPick[], p: TextPick): TextPick[] {
  return picks.some((x) => samePick(x, p))
    ? picks.filter((x) => !samePick(x, p))
    : [...picks, p];
}

export function isPicked(
  picks: TextPick[],
  kind: TextMode,
  id?: string,
): boolean {
  return picks.some(
    (p) => p.kind === kind && (p.kind === "page" || p.id === id),
  );
}

const SEG = "inline-flex overflow-hidden rounded-[7px] border border-[#9aa]";
const CHIP =
  "cursor-pointer border-r border-[#9aa] bg-white px-2 py-[3px] text-[11.5px] font-bold text-[#222] last:border-r-0 disabled:cursor-default disabled:opacity-40 aria-pressed:bg-[#1f2937] aria-pressed:text-white";
/** 白键（Quick Actions、Cancel）：不能用时灰（置顶 114）。 */
const WHITE_KEY =
  "inline-flex cursor-pointer items-center justify-center rounded-[7px] border border-[#9aa] bg-white px-2 py-[3px] text-[11.5px] font-bold whitespace-nowrap text-[#222] disabled:cursor-default disabled:opacity-40";
/** Done：深灰 #1f2937 + ✓（置顶 114 Q4 A；不是提交键，真正存是页头的 Save）。 */
const DONE_KEY =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[7px] bg-[#1f2937] px-3 py-1 text-[11.5px] font-bold whitespace-nowrap text-white";
/** 手机编辑卡的键（置顶 114 M6 = 115 题 1：26px）；data-phone-keep，全站手机样式不再改它。 */
const P_CHIP =
  "h-[24px] cursor-pointer border-r border-[#9aa] bg-white text-[12px] font-bold text-[#222] last:border-r-0 disabled:cursor-default disabled:opacity-40 aria-pressed:bg-[#1f2937] aria-pressed:text-white";
const P_QUICK =
  "inline-flex h-[24px] cursor-pointer items-center rounded-[6px] border border-[#9aa] bg-white px-1.5 text-[11px] font-bold whitespace-nowrap text-[#222] disabled:cursor-default disabled:opacity-40";

/** 屏宽 < 640px（全站手机版的分界，同 components/ui/phone.tsx 用的 sm:）。 */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639.98px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow;
}

/** Relay list 才有的 Spacing 组（置顶 112）：管整张单，− / +，不写 px。 */
export interface SpacingControl {
  level: number;
  min: number;
  max: number;
  onStep: (n: 1 | -1) => void;
  onReset: () => void;
}

/** 电脑版编辑卡的一组：上面「图标 + 小标题」，下面键；组之间竖线。 */
function Group({
  icon,
  title,
  name,
  level,
  children,
}: {
  icon: LineIconName;
  title: string;
  name: string;
  /** 只有 Spacing 组：带 data-relay-spacing / data-level（检查用）。 */
  level?: number;
  children: ReactNode;
}) {
  return (
    <div
      data-text-size-group={name}
      {...(level !== undefined
        ? { "data-relay-spacing": "", "data-level": level }
        : null)}
      className="flex flex-col gap-1 border-r border-[#e2e5e9] px-2 py-1.5"
    >
      <span className="inline-flex items-center gap-1.5 font-bold text-[#333]">
        <LineIcon name={icon} />
        {title}
      </span>
      {children}
    </div>
  );
}

/** 手机编辑卡的一组（置顶 114 第 4 版，照参考图的排版；颜色用线上已有的：白底 + #e2e5e9 边，同电脑版组间竖线）：上面「图标 + 小标题」，下面键。 */
function PhoneGroup({
  icon,
  title,
  name,
  level,
  children,
}: {
  icon: LineIconName;
  title: string;
  name: string;
  level?: number;
  children: ReactNode;
}) {
  return (
    <div
      data-text-size-group={name}
      {...(level !== undefined
        ? { "data-relay-spacing": "", "data-level": level }
        : null)}
      className="flex min-w-0 flex-col items-start gap-1 rounded-[8px] border border-[#e2e5e9] bg-white px-1.5 py-1"
    >
      <span className="inline-flex items-center gap-1.5 font-bold text-[#333]">
        <LineIcon name={icon} />
        {title}
      </span>
      {children}
    </div>
  );
}

/**
 * 表格上方的编辑卡（置顶 114，Annie「你参考一下这个设计，仍然用我们的主色调，把所有的编辑功能键都弄成这样归类和显示」
 * →「114，115，107全选A。动手」；preview https://claude.ai/artifact/TopyompWt81k2rZL8uqoES 第 3 版）。
 * 电脑：白卡片横排几组（图标 + 小标题，竖线隔开）Apply To｜Text Size｜Font Weight｜Spacing（只 Relay list）｜Quick Actions｜Cancel / Done，
 * 卡片下边小灰字 Picked。手机（< 640px）：两行，不出小标题、不出 Picked；第 1 行最右 ✕ = Cancel，第 2 行最右 ✓ Done。
 * 只是挪位置、分组，键的作用不变。Done 不存：调好的字号留在页面上，跟整页 Save 一起存（Annie 10-29 Q2）。
 */
export function TextSizeToolbar({
  mode,
  onMode,
  picks,
  pickedLabel,
  current,
  onStep,
  onBold,
  onResetSelection,
  onResetAll,
  onCancel,
  onDone,
  spacing,
  always = false,
}: {
  /** Relay list 的 Spacing（置顶 112）；Bus Manifest 不给。 */
  spacing?: SpacingControl;
  /**
   * 编辑卡一直显示（置顶 114 第 4 版，Annie「我不要任何隐藏菜单，我要一目了然」）：电脑版照参考图不出 Cancel / Done
   * （改动直接留在页面上，按页头 Save 存）；手机版照图底部仍有 Cancel / Done。
   */
  always?: boolean;
  mode: TextMode;
  onMode: (m: TextMode) => void;
  picks: TextPick[];
  pickedLabel: string;
  current: ManifestTextLayer;
  onStep: (n: 1 | -1) => void;
  onBold: (bold: boolean) => void;
  onResetSelection: () => void;
  onResetAll: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const narrow = useNarrow();
  const any = picks.length > 0;
  const d = current.d ?? 0;
  const modes = [
    ["column", "Column", "Col"],
    ["row", "Row", "Row"],
    ["page", "Page", "Page"],
  ] as const;
  /** Quick Actions 三个白键（手机收进「Reset…」）。 */
  const quick = (cls: string) => (
    <>
      <button
        type="button"
        data-phone-keep
        disabled={!any}
        onClick={onResetSelection}
        className={cls}
      >
        Reset Selection
      </button>
      <button
        type="button"
        data-phone-keep
        onClick={onResetAll}
        className={cls}
      >
        Reset Whole Table
      </button>
      {spacing ? (
        <button
          type="button"
          data-phone-keep
          data-relay-spacing-default
          disabled={spacing.level === 0}
          onClick={spacing.onReset}
          className={cls}
        >
          Default Spacing
        </button>
      ) : null}
    </>
  );
  const spacingKeys = (cls: string) =>
    spacing ? (
      <span className={SEG}>
        <button
          type="button"
          data-phone-keep
          aria-label="Less space"
          data-relay-spacing-less
          disabled={spacing.level <= spacing.min}
          onClick={() => spacing.onStep(-1)}
          className={cls}
        >
          −
        </button>
        <button
          type="button"
          data-phone-keep
          aria-label="More space"
          data-relay-spacing-more
          disabled={spacing.level >= spacing.max}
          onClick={() => spacing.onStep(1)}
          className={cls}
        >
          +
        </button>
      </span>
    ) : null;
  const sizeKeys = (cls: string) => (
    <span className={SEG}>
      <button
        type="button"
        data-phone-keep
        aria-label="Smaller"
        disabled={!any || d <= TEXT_MIN}
        onClick={() => onStep(-1)}
        className={cls}
      >
        A−
      </button>
      <button
        type="button"
        data-phone-keep
        aria-label="Bigger"
        disabled={!any || d >= TEXT_MAX}
        onClick={() => onStep(1)}
        className={cls}
      >
        A+
      </button>
    </span>
  );

  if (narrow)
    // 手机（置顶 114 第 4 版）：照参考图竖排——Apply To｜Text Size + Font Weight｜Spacing + Quick Actions｜Cancel / Done，
    // 每组带图标 + 小标题，键名写全，不收进任何菜单（原来的「Reset…」展开成三个键）。
    return (
      <div
        role="group"
        aria-label="Text size"
        data-text-size-toolbar
        data-text-size-phone
        className="mt-1.5 flex flex-col gap-1 rounded-[10px] bg-white p-1 font-[Arial,sans-serif] text-[12px] text-[#222]"
      >
        <PhoneGroup icon="apply" title="Apply To" name="apply">
          <span className="flex w-full overflow-hidden rounded-[7px] border border-[#9aa]">
            {modes.map(([m, label]) => (
              <button
                key={m}
                type="button"
                data-phone-keep
                aria-pressed={mode === m}
                onClick={() => onMode(m)}
                className={cn(P_CHIP, "flex-1 px-3")}
              >
                {label}
              </button>
            ))}
          </span>
        </PhoneGroup>
        <div
          className={cn(
            "grid gap-1",
            spacing ? "grid-cols-[auto_auto_1fr]" : "grid-cols-2",
          )}
        >
          <PhoneGroup icon="size" title="Text Size" name="size">
            {sizeKeys(cn(P_CHIP, "px-2.5"))}
          </PhoneGroup>
          <PhoneGroup icon="bold" title="Font Weight" name="weight">
            <span className={SEG}>
              <button
                type="button"
                data-phone-keep
                aria-pressed={current.bold === false}
                disabled={!any}
                onClick={() => onBold(false)}
                className={cn(P_CHIP, "px-2")}
              >
                Regular
              </button>
              <button
                type="button"
                data-phone-keep
                aria-pressed={current.bold === true}
                disabled={!any}
                onClick={() => onBold(true)}
                className={cn(P_CHIP, "px-2")}
              >
                Bold
              </button>
            </span>
          </PhoneGroup>
          {spacing ? (
            <PhoneGroup
              icon="space"
              title="Spacing"
              name="spacing"
              level={spacing.level}
            >
              {spacingKeys(cn(P_CHIP, "px-2.5"))}
            </PhoneGroup>
          ) : null}
        </div>
        <PhoneGroup icon="reset" title="Quick Actions" name="quick">
          <span className="flex w-full flex-nowrap gap-1 [&>button]:min-w-0 [&>button]:flex-1 [&>button]:justify-center">
            {quick(P_QUICK)}
          </span>
        </PhoneGroup>
        <div data-text-size-group="finish" className="grid grid-cols-2 gap-1">
          <button
            type="button"
            data-phone-keep
            data-text-size-cancel
            onClick={onCancel}
            className="inline-flex h-[28px] cursor-pointer items-center justify-center rounded-[8px] border border-[#9aa] bg-white text-[12px] font-bold text-[#222]"
          >
            Cancel
          </button>
          <button
            type="button"
            data-phone-keep
            data-text-size-done
            onClick={onDone}
            className="inline-flex h-[28px] cursor-pointer items-center justify-center gap-1.5 rounded-[8px] bg-[#1f2937] text-[12px] font-bold text-white"
          >
            <LineIcon name="check" className="h-3.5 w-3.5" />
            Done
          </button>
        </div>
        <div data-text-size-picked className="px-1 text-[11.5px] text-[#666]">
          Picked:{" "}
          <b className="text-[#111]">
            {pickedLabel || "nothing yet — tap the table"}
          </b>
        </div>
      </div>
    );

  return (
    <div
      role="group"
      aria-label="Text size"
      data-text-size-toolbar
      className="mt-1.5 overflow-hidden rounded-[10px] border border-black/10 bg-white font-[Arial,sans-serif] text-[11.5px] text-[#222]"
    >
      <div className="flex flex-wrap items-stretch">
        <Group icon="apply" title="Apply To" name="apply">
          <span className={SEG}>
            {modes.map(([m, label]) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => onMode(m)}
                className={CHIP}
              >
                {label}
              </button>
            ))}
          </span>
        </Group>
        <Group icon="size" title="Text Size" name="size">
          <span className="inline-flex items-center gap-2">
            {sizeKeys(CHIP)}
            <span
              data-text-size-value
              className="inline-block min-w-10 text-[11.5px] font-bold text-[#555] tabular-nums"
            >
              {any ? (d ? `${d > 0 ? "+" : ""}${d} px` : "Default") : "—"}
            </span>
          </span>
        </Group>
        <Group icon="bold" title="Font Weight" name="weight">
          <span className={SEG}>
            <button
              type="button"
              aria-pressed={current.bold === false}
              disabled={!any}
              onClick={() => onBold(false)}
              className={CHIP}
            >
              Regular
            </button>
            <button
              type="button"
              aria-pressed={current.bold === true}
              disabled={!any}
              onClick={() => onBold(true)}
              className={CHIP}
            >
              Bold
            </button>
          </span>
        </Group>
        {spacing ? (
          <Group
            icon="space"
            title="Spacing"
            name="spacing"
            level={spacing.level}
          >
            {spacingKeys(CHIP)}
          </Group>
        ) : null}
        <Group icon="reset" title="Quick Actions" name="quick">
          <span className="flex flex-nowrap gap-1">{quick(WHITE_KEY)}</span>
        </Group>
        {always ? null : (
          <div
            data-text-size-group="finish"
            className="ml-auto flex items-center gap-1.5 px-2.5 py-2.5"
          >
            <button type="button" onClick={onCancel} className={WHITE_KEY}>
              Cancel
            </button>
            <button
              type="button"
              data-text-size-done
              onClick={onDone}
              className={DONE_KEY}
            >
              <LineIcon name="check" className="h-3.5 w-3.5" />
              Done
            </button>
          </div>
        )}
      </div>
      <div
        data-text-size-picked
        className="px-4 pb-2 text-[11.5px] text-[#666]"
      >
        Picked:{" "}
        <b className="text-[#111]">
          {pickedLabel || "nothing yet — click the table"}
        </b>
      </div>
    </div>
  );
}

/** 色条下面「Text size changes」：默认收起，点开看最近 5 条（打印不印，partner 看不到）。 */
export function TextSizeHistory({
  history,
}: {
  history: ManifestTextSizeChange[];
}) {
  if (!history.length) return null;
  const [last] = history;
  return (
    <details
      data-text-size-history
      className="mx-0.5 mt-1.5 text-[11.5px] text-[#555] print:hidden"
    >
      <summary className="cursor-pointer">
        Text size changes · last by <b className="text-[#333]">{last.by}</b> ·{" "}
        {last.at}
      </summary>
      <ul className="mt-1 ml-3.5 flex flex-col gap-0.5">
        {history.slice(0, 5).map((h, i) => (
          <li key={i}>
            <b className="text-[#333]">{h.by}</b> · {h.at} · {h.what}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** 编辑时选中格的蓝框、改过格的橙线（同 preview）。 */
export function editCellClass(selected: boolean, changed: boolean): string {
  return cn(
    selected && "outline-2 -outline-offset-2 outline-[#2563eb]",
    changed && "shadow-[inset_3px_0_0_#f59e0b]",
  );
}
