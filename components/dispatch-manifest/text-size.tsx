"use client";

import { useEffect, useState } from "react";

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
  | "bus"
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

export const EMPTY_TEXT_SIZE: ManifestTextSize = {
  page: {},
  columns: {},
  rows: {},
};

const clamp = (n: number, max: number) => Math.max(TEXT_MIN, Math.min(max, n));

/** 一格最后的字号 / 粗细（每格都用它，没存过设定时就是纸本默认）。 */
export function cellText(
  ts: ManifestTextSize | null | undefined,
  col: ManifestColumnKey,
  order: string | null,
  phone: boolean,
  version: ManifestVersion = "general",
): { fontSize: string; fontWeight: number; changed: boolean } {
  const base = BASE[version] ?? BASE.general;
  const [px, baseBold] = col === "pax" ? base.pax : base.cell;
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

export type TextPick =
  | { kind: "page" }
  | { kind: "column"; id: ManifestColumnKey }
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
  "cursor-pointer border-r border-[#9aa] bg-white px-2.5 py-1 text-[12px] font-bold text-[#222] last:border-r-0 disabled:cursor-default disabled:opacity-40 aria-pressed:bg-[#1f2937] aria-pressed:text-white";

/** 表格上方的编辑条（白底虚线框，同 preview）。蓝色只有 Save。 */
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
  onSave,
  saving,
}: {
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
  onSave: () => void;
  saving: boolean;
}) {
  const any = picks.length > 0;
  const d = current.d ?? 0;
  return (
    <div
      role="group"
      aria-label="Text size"
      data-text-size-toolbar
      className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-lg border border-dashed border-[#8a94a0] bg-white px-2.5 py-2 text-[12px] text-[#333]"
    >
      <span className="font-bold">Change</span>
      <span className={SEG}>
        {(
          [
            ["column", "Whole column"],
            ["row", "Whole row"],
            ["page", "Whole page"],
          ] as const
        ).map(([m, label]) => (
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
      <span className="font-bold">Size</span>
      <span className={SEG}>
        <button
          type="button"
          aria-label="Smaller"
          disabled={!any || d <= TEXT_MIN || saving}
          onClick={() => onStep(-1)}
          className={CHIP}
        >
          A−
        </button>
        <button
          type="button"
          aria-label="Bigger"
          disabled={!any || d >= TEXT_MAX || saving}
          onClick={() => onStep(1)}
          className={CHIP}
        >
          A+
        </button>
      </span>
      <span
        data-text-size-value
        className="inline-block min-w-16 text-center font-bold text-[#222] tabular-nums"
      >
        {any ? (d ? `${d > 0 ? "+" : ""}${d} px` : "Default") : "—"}
      </span>
      <span className="font-bold">Weight</span>
      <span className={SEG}>
        <button
          type="button"
          aria-pressed={current.bold === false}
          disabled={!any || saving}
          onClick={() => onBold(false)}
          className={CHIP}
        >
          Regular
        </button>
        <button
          type="button"
          aria-pressed={current.bold === true}
          disabled={!any || saving}
          onClick={() => onBold(true)}
          className={CHIP}
        >
          Bold
        </button>
      </span>
      <span className="flex-1" />
      <button
        type="button"
        disabled={!any || saving}
        onClick={onResetSelection}
        className="cursor-pointer text-[12px] text-[#1d4ed8] underline disabled:cursor-default disabled:opacity-40"
      >
        Reset selection
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={onResetAll}
        className="cursor-pointer text-[12px] text-[#1d4ed8] underline disabled:opacity-40"
      >
        Reset whole table
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={onCancel}
        className="cursor-pointer rounded-[7px] border border-[#9aa] bg-white px-2.5 py-1 text-[12px] font-bold text-[#222] disabled:opacity-60"
      >
        Cancel
      </button>
      <button
        type="button"
        data-text-size-save
        disabled={saving}
        onClick={onSave}
        className="cursor-pointer rounded-[7px] border border-[#3b82f6] bg-[#3b82f6] px-3.5 py-1 text-[12px] font-bold text-white disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <span className="basis-full text-[#555]">
        Picked:{" "}
        <b className="text-[#111]">
          {pickedLabel || "nothing yet — click the table"}
        </b>
      </span>
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
