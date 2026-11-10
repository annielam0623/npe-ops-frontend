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
  canEdit: boolean;
  sheets: Record<string, SheetText>;
  staged: Record<string, ManifestTextSize>;
  editing: string | null;
  draft: ManifestTextSize | null;
  mode: TextMode;
  picks: TextPick[];
  save: SaveState;
  dirty: boolean;
  open: (sheet: string) => void;
  close: () => void;
  setMode: (m: TextMode) => void;
  pick: (p: TextPick) => void;
  step: (n: 1 | -1) => void;
  bold: (b: boolean) => void;
  resetSelection: () => void;
  resetAll: () => void;
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
  const [draft, setDraft] = useState<ManifestTextSize | null>(null);
  const [mode, setMode] = useState<TextMode>("column");
  const [picks, setPicks] = useState<TextPick[]>([]);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  // 每次读 relay-pull（打开、存好颜色后重读）都换成后端那份。
  useEffect(() => {
    const got = sheetsOf(pull);
    setReady(got !== null);
    setSheets(got ?? {});
  }, [pull]);

  const dirty = canEdit && (Object.keys(staged).length > 0 || draft !== null);
  useLeaveGuard(
    dirty,
    "Your text size changes are not saved. Leave without saving?",
  );

  const saved = useCallback(
    (sheet: string) => sheets[sheet]?.text_size ?? EMPTY_TEXT_SIZE,
    [sheets],
  );
  const current = (sheet: string) =>
    (editing === sheet ? draft : null) ?? staged[sheet] ?? saved(sheet);

  const change = (fn: (l: { d?: number; bold?: boolean }) => { d?: number; bold?: boolean }) => {
    if (!draft || !picks.length) return;
    setDraft(updateLayers(draft, picks, fn));
  };

  return {
    ready,
    canEdit,
    sheets,
    staged,
    editing,
    draft,
    mode,
    picks,
    save,
    dirty,
    current,
    open: (sheet) => {
      setEditing(sheet);
      setDraft(staged[sheet] ?? saved(sheet));
      setPicks([]);
      setMode("column");
      setSave({ kind: "idle" });
    },
    close: () => {
      setEditing(null);
      setDraft(null);
      setPicks([]);
    },
    setMode: (m) => {
      setMode(m);
      setPicks(m === "page" ? [{ kind: "page" }] : []);
    },
    pick: (p) => setPicks((ps) => togglePick(ps, p)),
    step: (n) => change((l) => ({ ...l, d: (l.d ?? 0) + n })),
    bold: (b) => change((l) => ({ ...l, bold: b })),
    resetSelection: () => change(() => ({})),
    resetAll: () => {
      setDraft(EMPTY_TEXT_SIZE);
      setPicks([]);
    },
    done: () => {
      if (editing && draft) {
        const same =
          JSON.stringify(draft) === JSON.stringify(saved(editing));
        setStaged((s) => {
          const next = { ...s };
          if (same) delete next[editing];
          else next[editing] = draft;
          return next;
        });
      }
      setEditing(null);
      setDraft(null);
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
      return { style: undefined as CSSProperties | undefined, className: "", onClick: undefined };
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
    const editing = t.editing === sheet;
    if (!editing) return { style, className: "", onClick: undefined };
    const selected =
      isPicked(t.picks, "page") ||
      isPicked(t.picks, "column", col) ||
      isPicked(t.picks, "row", order);
    return {
      style,
      className: cn(editCellClass(selected, changed), "cursor-pointer"),
      onClick: () =>
        t.pick(
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

/** 每张单上方（只在屏幕上）：「Aa Text size」键、没存的提示、最近 5 次，编辑时下面是编辑条。 */
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
  const editing = t.editing === sheet;
  const history = t.sheets[sheet]?.history ?? [];
  const current = t.draft ?? EMPTY_TEXT_SIZE;
  const layer = t.picks.length ? layerOf(current, t.picks[0]) : {};
  const label = t.picks
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
      className="rl-screen-only mx-auto mb-1.5 w-full max-w-[var(--rl-ph,297mm)] px-0.5"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        {t.canEdit ? (
          <button
            type="button"
            data-relay-text-open={sheet}
            onClick={() => (editing ? t.close() : t.open(sheet))}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-black/25 bg-paper px-3 text-[12px] font-bold text-[#111]"
          >
            {editing ? "Close text size" : "Aa Text size"}
          </button>
        ) : null}
        {t.staged[sheet] && !editing ? (
          <span
            data-relay-text-unsaved={sheet}
            className="text-[12px] font-semibold text-[#fbbf24]"
          >
            Text size not saved
          </span>
        ) : null}
        {history.length ? (
          <span className="[&_details]:text-[#cbd5e1] [&_b]:!text-white [&_summary]:text-[#cbd5e1]">
            <TextSizeHistory history={history} />
          </span>
        ) : null}
      </div>
      {editing ? (
        <TextSizeToolbar
          mode={t.mode}
          onMode={t.setMode}
          picks={t.picks}
          pickedLabel={label}
          current={layer}
          onStep={t.step}
          onBold={t.bold}
          onResetSelection={t.resetSelection}
          onResetAll={t.resetAll}
          onCancel={t.close}
          onDone={t.done}
        />
      ) : null}
    </div>
  );
}

/** 页面顶上：有没存的当天字号时出蓝色 Save（提交键）+ Saving… / 绿 Saved / 红字。 */
export function RelayTextSave() {
  const t = useContext(RelayTextContext);
  if (!t?.ready || !t.canEdit) return null;
  const n = Object.keys(t.staged).length;
  if (!n && t.save.kind === "idle") return null;
  return (
    <>
      {n ? (
        <button
          type="button"
          data-relay-text-save
          disabled={t.save.kind === "saving"}
          onClick={() => void t.saveAll()}
          className="inline-flex h-8 cursor-pointer items-center rounded-[8px] bg-[#3b82f6] px-[18px] text-[13px] font-bold text-white disabled:opacity-60"
        >
          {t.save.kind === "saving" ? "Saving…" : "Save"}
        </button>
      ) : null}
      <span
        data-relay-text-status={t.save.kind}
        className={cn(
          "text-[12.5px] font-semibold",
          t.save.kind === "saved" && "text-[#4ade80]",
          t.save.kind === "error" && "text-[#f87171]",
          (t.save.kind === "idle" || t.save.kind === "saving") && "text-[#fbbf24]",
        )}
      >
        {t.save.kind === "error"
          ? `Text size not saved: ${t.save.text}`
          : t.save.kind === "saved" && !n
            ? "Saved"
            : n === 1
              ? "1 sheet with text size not saved"
              : `${n} sheets with text size not saved`}
      </span>
    </>
  );
}
