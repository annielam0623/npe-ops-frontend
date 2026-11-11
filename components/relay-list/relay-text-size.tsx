"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
} from "react";

import {
  EMPTY_TEXT_SIZE,
  editCellClass,
  isPicked,
  layerOf,
  TEXT_MAX,
  TEXT_MIN,
  type TextMode,
  type TextPick,
  TextSizeHistory,
  TextSizeToolbar,
  togglePick,
  updateLayers,
} from "@/components/dispatch-manifest/text-size";
import { LineIcon } from "@/components/dispatch-manifest/line-icons";
import { apiFetch } from "@/lib/api-client";
import { describeError, isStatus } from "@/lib/api-errors";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import type { RelayPull } from "@/lib/dispatch-api";
import type { ManifestTextSize, ManifestTextSizeChange } from "@/types";

/**
 * Relay Splits 当天的「Aa Text size」（置顶 92 Q5 A，Annie「relay split也需要可以自己调字体大小，设置就跟bus manifest一样」）：
 * 每张单（总表每轮一张、每台 relay 车一张）各调各的，整列 / 整行 / 整页、A− / A+（−2..+10 px）、Regular / Bold；
 * 只存这一天；Done 先留在页面上，页面顶上的蓝色 Save 才存；dispatch.edit 能改；每张单上方看最近 5 次。
 * 后端 07（task/print-layout-2 c71452ca，migrate_v157）：没有单独的 GET，字号跟着 GET /api/dispatch/relay-pull 来——
 *   summary_text_size = {relay | relay_2: {sheet, text_size, history}}；每台车 car.text_size_sheet / text_size / text_size_history
 *   （sheet = "car:<轮>:<车号>"，没车号 = null，这台车不能调）。relay-pull 没有 summary_text_size = 旧后端，不出 Aa 键。
 *   PUT /api/dispatch/relay-list/text-size {date, sheet, text_size} ⇒ {ok, sheet, text_size, text_size_history}（最近 5 次）。
 */

/** 列键同后端 relay_text_size.COLUMN_KEYS（第 6 列纸本叫 Tour，键是 product）。 */
export const RELAY_COLUMNS = [
  "time",
  "hotel",
  "qty",
  "name",
  "phone",
  "product",
  "order",
] as const;
export type RelayColumn = (typeof RELAY_COLUMNS)[number];

const COLUMN_LABEL: Record<RelayColumn, string> = {
  time: "Time",
  hotel: "Hotel",
  qty: "Qty",
  name: "Name",
  phone: "Phone",
  product: "Tour",
  order: "Order #",
};

interface SheetText {
  text_size: ManifestTextSize;
  history: ManifestTextSizeChange[];
}

const API = "/api/dispatch/relay-list/text-size";

/**
 * 当天行距（置顶 112 Q8–Q10 A + Annie「用-+是最好，一目了然，就是立刻可以看到效果就行了，不要让staff去判断px」）：
 * 一组 [−] [+] 同时调行内上下空白和酒店之间空隙，不显示 px；存在 text_size.spacing {row, gap}（后端 78 relay-spacing）。
 * 档位 k：酒店间 gap = 12 + 2k（k −3..+6 ⇒ 6–24px），行内 row = 默认 + k（车单默认 4、总表 2，夹在 1–10）。
 */
export const SPACING_MIN = -3;
export const SPACING_MAX = 6;
const GAP_DEFAULT = 12;
const rowDefault = (sheet: string) => (sheet.startsWith("summary:") ? 2 : 4);

export function spacingLevel(ts: ManifestTextSize): number {
  const g = ts.spacing?.gap;
  return typeof g === "number" ? Math.round((g - GAP_DEFAULT) / 2) : 0;
}

function spacingFor(sheet: string, k: number): ManifestTextSize["spacing"] {
  if (!k) return {};
  return {
    gap: GAP_DEFAULT + 2 * k,
    row: Math.max(1, Math.min(10, rowDefault(sheet) + k)),
  };
}

/** 这张单现在的行距（px）；没调 / 旧后端 = null（照 CSS 默认）。 */
export function useRelaySpacing(
  sheet: string | null,
): { row: number; gap: number } | null {
  const t = useContext(RelayTextContext);
  if (!t?.ready || !t.spacingReady || !sheet) return null;
  const sp = t.current(sheet).spacing;
  if (!sp || (sp.row === undefined && sp.gap === undefined)) return null;
  return { row: sp.row ?? rowDefault(sheet), gap: sp.gap ?? GAP_DEFAULT };
}

/** relay-pull 带的每张单的当天字号（键 = sheet）；null = 旧后端（没有 summary_text_size）。 */
function sheetsOf(pull: RelayPull | null): Record<string, SheetText> | null {
  if (!pull?.summary_text_size) return null;
  const out: Record<string, SheetText> = {};
  for (const s of Object.values(pull.summary_text_size))
    if (s?.sheet)
      out[s.sheet] = {
        text_size: s.text_size ?? EMPTY_TEXT_SIZE,
        history: s.history ?? [],
      };
  for (const blocks of Object.values(pull.rounds ?? {}))
    for (const b of blocks) {
      const sheet = b.car.text_size_sheet;
      if (sheet)
        out[sheet] = {
          text_size: b.car.text_size ?? EMPTY_TEXT_SIZE,
          history: b.car.text_size_history ?? [],
        };
    }
  return out;
}

function saveRelayTextSize(
  date: string,
  sheet: string,
  textSize: ManifestTextSize,
): Promise<{
  text_size: ManifestTextSize;
  text_size_history?: ManifestTextSizeChange[];
}> {
  return apiFetch(API, {
    method: "PUT",
    body: { date, sheet, text_size: textSize },
  });
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; text: string };

export interface RelayTextState {
  /** 后端有这个接口（没有 = 不出 Aa 键）。 */
  ready: boolean;
  /** 后端认 spacing（relay-pull 的 text_size 带 spacing 键）：才出 Spacing 那一行。 */
  spacingReady: boolean;
  spacingStep: (sheet: string, n: 1 | -1) => void;
  spacingReset: (sheet: string) => void;
  canEdit: boolean;
  sheets: Record<string, SheetText>;
  staged: Record<string, ManifestTextSize>;
  /**
   * 正在改的那张单（置顶 114 第 4 版：每张单的编辑卡一直显示，点哪张单的表格或卡片，哪张就是这一张；点选只在这一张上）。
   */
  editing: string | null;
  mode: TextMode;
  picks: TextPick[];
  save: SaveState;
  dirty: boolean;
  /** 换到这张单（点选清空）。 */
  activate: (sheet: string) => void;
  setMode: (sheet: string, m: TextMode) => void;
  pick: (sheet: string, p: TextPick) => void;
  step: (n: 1 | -1) => void;
  bold: (b: boolean) => void;
  resetSelection: () => void;
  resetAll: (sheet: string) => void;
  /** Cancel（手机）：这张单没存的改动全撤回，回到上次存的样子。 */
  cancel: (sheet: string) => void;
  /** Done（手机）：改完了，清掉点选（改动照旧留在页面上，按 Save 才存）。 */
  done: () => void;
  saveAll: () => Promise<void>;
  /** 这张单现在画的（编辑中的 → 暂存的 → 存好的）。 */
  current: (sheet: string) => ManifestTextSize;
}

export function useRelayTextSize(
  date: string | null,
  canEdit: boolean,
  onUnauthorized: () => void,
  pull: RelayPull | null,
): RelayTextState {
  const [ready, setReady] = useState(false);
  const [sheets, setSheets] = useState<Record<string, SheetText>>({});
  const [staged, setStaged] = useState<Record<string, ManifestTextSize>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [mode, setMode] = useState<TextMode>("column");
  const [picks, setPicks] = useState<TextPick[]>([]);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  // 每次读 relay-pull（打开、存好颜色后重读）都换成后端那份。
  const [spacingReady, setSpacingReady] = useState(false);
  useEffect(() => {
    const got = sheetsOf(pull);
    setReady(got !== null);
    setSheets(got ?? {});
    setSpacingReady(
      !!got &&
        Object.values(got).some((s) => s.text_size.spacing !== undefined),
    );
  }, [pull]);

  const dirty = canEdit && Object.keys(staged).length > 0;
  useLeaveGuard(
    dirty,
    "Your text size changes are not saved. Leave without saving?",
  );

  const saved = useCallback(
    (sheet: string) => sheets[sheet]?.text_size ?? EMPTY_TEXT_SIZE,
    [sheets],
  );
  const current = (sheet: string) => staged[sheet] ?? saved(sheet);
  /** 改动直接暂存在这张单上（和存好的一样就不算没存）；按页头 Save 才存。 */
  const write = (sheet: string, next: ManifestTextSize) =>
    setStaged((st) => {
      const out = { ...st };
      if (JSON.stringify(next) === JSON.stringify(saved(sheet)))
        delete out[sheet];
      else out[sheet] = next;
      return out;
    });
  const activate = (sheet: string) => {
    if (editing === sheet) return;
    setEditing(sheet);
    setPicks(mode === "page" ? [{ kind: "page" }] : []);
    setSave({ kind: "idle" });
  };

  const change = (
    fn: (l: { d?: number; bold?: boolean }) => { d?: number; bold?: boolean },
  ) => {
    if (!editing || !picks.length) return;
    const cur = current(editing);
    // updateLayers 只认 page / columns / rows：spacing 要带回去。
    const next = updateLayers(cur, picks, fn);
    write(
      editing,
      cur.spacing !== undefined ? { ...next, spacing: cur.spacing } : next,
    );
  };
  const setLevel = (sheet: string, k: number) => {
    activate(sheet);
    write(sheet, {
      ...current(sheet),
      spacing: spacingFor(
        sheet,
        Math.max(SPACING_MIN, Math.min(SPACING_MAX, k)),
      ),
    });
  };

  return {
    ready,
    spacingReady,
    spacingStep: (sheet, n) =>
      setLevel(sheet, spacingLevel(current(sheet)) + n),
    spacingReset: (sheet) => setLevel(sheet, 0),
    canEdit,
    sheets,
    staged,
    editing,
    mode,
    picks,
    save,
    dirty,
    current,
    activate,
    setMode: (sheet, m) => {
      setEditing(sheet);
      setMode(m);
      setPicks(m === "page" ? [{ kind: "page" }] : []);
    },
    pick: (sheet, p) => {
      if (editing !== sheet) {
        setEditing(sheet);
        setPicks([p]);
        setSave({ kind: "idle" });
        return;
      }
      setPicks((ps) => togglePick(ps, p));
    },
    step: (n) => change((l) => ({ ...l, d: (l.d ?? 0) + n })),
    bold: (b) => change((l) => ({ ...l, bold: b })),
    resetSelection: () => change(() => ({})),
    resetAll: (sheet) => {
      // Reset whole table 只管字号；行距有自己的 Default spacing。
      const cur = current(sheet);
      activate(sheet);
      write(
        sheet,
        cur.spacing !== undefined
          ? { ...EMPTY_TEXT_SIZE, spacing: cur.spacing }
          : EMPTY_TEXT_SIZE,
      );
    },
    cancel: (sheet) => {
      setStaged((st) => {
        const out = { ...st };
        delete out[sheet];
        return out;
      });
      if (editing === sheet)
        setPicks(mode === "page" ? [{ kind: "page" }] : []);
    },
    done: () => {
      setEditing(null);
      setPicks([]);
    },
    saveAll: async () => {
      if (!date) return;
      const todo = Object.entries(staged);
      if (!todo.length) return;
      setSave({ kind: "saving" });
      const left: Record<string, ManifestTextSize> = {};
      const next = { ...sheets };
      let error: string | null = null;
      for (const [sheet, ts] of todo) {
        try {
          const r = await saveRelayTextSize(date, sheet, ts);
          next[sheet] = {
            text_size: r.text_size,
            history: r.text_size_history ?? [],
          };
        } catch (e) {
          if (isStatus(e, 401)) {
            onUnauthorized();
            return;
          }
          left[sheet] = ts;
          error ??= describeError(e);
        }
      }
      setSheets(next);
      setStaged(left);
      setSave(error ? { kind: "error", text: error } : { kind: "saved" });
    },
  };
}

export const RelayTextContext = createContext<RelayTextState | null>(null);

/** 一格的字号（只管客人表格：基础字号 = 每天的起点；当天的整页 / 整列 / 整行加在上面）和编辑时的点选。 */
export function useRelayCellFont(sheet: string | null, basePx: number) {
  const t = useContext(RelayTextContext);
  return (col: RelayColumn, order: string) => {
    if (!t?.ready || !sheet)
      return {
        style: undefined as CSSProperties | undefined,
        className: "",
        onClick: undefined,
      };
    const ts = t.current(sheet);
    const layers = [ts.page, ts.columns[col], ts.rows[order]];
    let d = 0;
    let bold: boolean | undefined;
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
    d = Math.max(TEXT_MIN, Math.min(TEXT_MAX, d));
    const style: CSSProperties | undefined = changed
      ? {
          ...(d ? { fontSize: `${basePx + d}px` } : null),
          ...(bold !== undefined ? { fontWeight: bold ? 700 : 400 } : null),
        }
      : undefined;
    // 置顶 114 第 4 版：编辑卡一直在，能改的人点哪张单的格子都能选（点了别的单就换到那张）。
    if (!t.canEdit) return { style, className: "", onClick: undefined };
    const editing = t.editing === sheet;
    const selected =
      editing &&
      (isPicked(t.picks, "page") ||
        isPicked(t.picks, "column", col) ||
        isPicked(t.picks, "row", order));
    return {
      style,
      className: cn(editCellClass(selected, changed), "cursor-pointer"),
      onClick: () =>
        t.pick(
          sheet,
          t.mode === "row"
            ? { kind: "row", id: order }
            : { kind: "column", id: col },
        ),
    };
  };
}

/** 这张单当天「Whole page」加减了几 px（置顶 112 Q6 A：Total Pax 只跟整页走，不跟整列 / 整行）。 */
export function useRelayPageDelta(sheet: string | null): number {
  const t = useContext(RelayTextContext);
  if (!t?.ready || !sheet) return 0;
  const d = t.current(sheet).page?.d ?? 0;
  return Math.max(TEXT_MIN, Math.min(TEXT_MAX, d));
}

/**
 * 每张单上方（只在屏幕上）：编辑卡一直显示（置顶 114 第 4 版，Annie「我不要任何隐藏菜单，我要一目了然」），
 * 没有「Aa Text size」开关；上面一行是没存的提示和最近 5 次。点选只在正在改的那张单上（点哪张的表格或卡片就换到哪张）。
 */
export function SheetTextBar({
  sheet,
  orders,
}: {
  /** null = 这张单不能调（没车号）。 */
  sheet: string | null;
  /** 这张单上的订单号（整行选中时写名字用）。 */
  orders: string[];
}) {
  const t = useContext(RelayTextContext);
  if (!t?.ready || !sheet) return null;
  const active = t.editing === sheet;
  const picks = active ? t.picks : [];
  const history = t.sheets[sheet]?.history ?? [];
  const current = t.current(sheet);
  const layer = picks.length ? layerOf(current, picks[0]) : {};
  const label = picks
    .map((p) =>
      p.kind === "page"
        ? "Whole page"
        : p.kind === "column"
          ? `${COLUMN_LABEL[p.id as RelayColumn] ?? p.id} (column)`
          : orders.includes(p.id)
            ? `${p.id} (row)`
            : p.id,
    )
    .join(", ");
  return (
    <div
      data-relay-text-bar={sheet}
      data-active={active || undefined}
      className="rl-screen-only mx-auto mb-1.5 w-full max-w-[var(--rl-ph,297mm)] px-0.5"
    >
      {t.staged[sheet] || history.length ? (
        <div className="flex flex-wrap items-center gap-2.5">
          {t.staged[sheet] ? (
            <span
              data-relay-text-unsaved={sheet}
              className="text-[12px] font-semibold text-[#fbbf24]"
            >
              Text size not saved
            </span>
          ) : null}
          {history.length ? (
            <span className="[&_b]:!text-white [&_details]:text-[#cbd5e1] [&_summary]:text-[#cbd5e1]">
              <TextSizeHistory history={history} />
            </span>
          ) : null}
        </div>
      ) : null}
      {t.canEdit ? (
        <TextSizeToolbar
          always
          mode={t.mode}
          onMode={(m) => t.setMode(sheet, m)}
          picks={picks}
          pickedLabel={label}
          current={layer}
          onStep={t.step}
          onBold={t.bold}
          onResetSelection={t.resetSelection}
          onResetAll={() => t.resetAll(sheet)}
          onCancel={() => t.cancel(sheet)}
          onDone={t.done}
          spacing={
            t.spacingReady
              ? {
                  level: spacingLevel(current),
                  min: SPACING_MIN,
                  max: SPACING_MAX,
                  onStep: (n) => t.spacingStep(sheet, n),
                  onReset: () => t.spacingReset(sheet),
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

/**
 * 页面顶上（置顶 114 Q1/Q2 A、M1/M2 A）：「● 未存黄字｜Save」。Save 一直在，没改动时灰着（蓝色只给提交键）；
 * 存好绿字 Saved，存不上红字原话。手机上黄字缩成「1 not saved」，键 26px。
 */
export function RelayTextSave() {
  const t = useContext(RelayTextContext);
  if (!t?.ready || !t.canEdit) return null;
  const n = Object.keys(t.staged).length;
  const status =
    t.save.kind === "error"
      ? `Text size not saved: ${t.save.text}`
      : t.save.kind === "saved" && !n
        ? "Saved"
        : n === 1
          ? "1 sheet with text size not saved"
          : n
            ? `${n} sheets with text size not saved`
            : "";
  const tone = cn(
    "inline-flex items-center gap-1.5 font-semibold",
    t.save.kind === "error"
      ? "text-[#f87171]"
      : t.save.kind === "saved" && !n
        ? "text-[#4ade80]"
        : "text-[#fbbf24]",
  );
  const dot =
    n && t.save.kind !== "error" ? (
      <i className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#fbbf24]" />
    ) : null;
  return (
    <>
      {status ? (
        // 置顶 114 第 4 版：手机照参考图把整句写出来，排在标题下面一行（不再缩成「1 not saved」）。
        <span
          data-relay-text-status={t.save.kind}
          className={cn(
            tone,
            "text-[12.5px] max-sm:order-3 max-sm:basis-full max-sm:text-[12px]",
          )}
        >
          {dot}
          {status}
        </span>
      ) : null}
      <button
        type="button"
        data-relay-text-save
        data-phone-keep
        disabled={!n || t.save.kind === "saving"}
        onClick={() => void t.saveAll()}
        className="inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-[9px] bg-[#3b82f6] px-3.5 text-[13.5px] font-bold text-white disabled:cursor-default disabled:opacity-45 max-sm:order-1 max-sm:ml-auto max-sm:px-3 max-sm:text-[13px]"
      >
        <LineIcon name="save" />
        {t.save.kind === "saving" ? "Saving…" : "Save"}
      </button>
    </>
  );
}
