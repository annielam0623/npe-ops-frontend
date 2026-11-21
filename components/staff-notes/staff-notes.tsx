"use client";

import { useEffect, useId, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  createStaffNote,
  noteAuthor,
  STAFF_NOTE_MAX,
  type MentionDirectory,
  type StaffNote,
  type StaffNoteCreate,
  type StaffNoteProduct,
  type StaffNoteSource,
} from "@/lib/staff-notes-api";
import { cn } from "@/lib/utils";

import {
  effectiveMentions,
  MentionTextarea,
  NoteText,
  type PickedMention,
} from "./mentions";

/** 一张单里的一个产品（多产品时写 ★ Note 要选；Q2 B）。 */
export type NoteProduct = StaffNoteProduct;

export const SOURCE_LABEL: Record<StaffNoteSource, string> = {
  tracking: "Tracking",
  manifest: "Main manifest",
  order_details: "Order details",
  migrated: "Moved from old Notes",
};

const DT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "numeric",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "2026-11-21 09:14"（洛杉矶）/ ISO → "11/21/2026, 9:14 AM"；认不出原样返回。 */
export function formatNoteTime(raw: string): string {
  const plain = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(raw);
  if (plain) {
    const [, y, m, d, hh, mm] = plain;
    const h = Number(hh);
    const ap = h < 12 ? "AM" : "PM";
    return `${Number(m)}/${Number(d)}/${y}, ${h % 12 || 12}:${mm} ${ap}`;
  }
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? raw : DT.format(t);
}

/** 灰色产品标签（Order details / Tracking 里每条后面，Q2 B）；整单的（product_code null）写「Order note」（后端 (a)）。 */
export function ProductTag({
  note,
  dark = false,
}: {
  note: Pick<StaffNote, "product_code" | "product_name">;
  dark?: boolean;
}) {
  const label = note.product_code
    ? (note.product_name ?? "").trim() || note.product_code
    : "Order note";
  return (
    <span
      data-note-product
      className={cn(
        "ml-1 inline-block rounded-[4px] border px-[5px] text-[10.5px] font-semibold",
        dark
          ? "border-white/15 bg-white/[.06] text-[#cfe0f5]"
          : "border-[#dde1e6] bg-[#eef0f3] text-[#3a3f47]",
      )}
    >
      {label}
    </span>
  );
}

/** 「Notified: ZZ Test Lily, ZZ Test Dispatch (6 people)」；没 @ 任何人 ⇒ null。 */
export function notifiedLine(note: StaffNote): string | null {
  const parts = [
    ...(note.mentions ?? []).map((m) => m.name),
    ...(note.mention_teams ?? []).map((t) =>
      typeof t.notified === "number"
        ? `${t.name} (${t.notified} ${t.notified === 1 ? "person" : "people"})`
        : t.name,
    ),
  ].filter(Boolean);
  return parts.length ? `Notified: ${parts.join(", ")}` : null;
}

/**
 * ★ Note 名单（最新在上，调用方排好）。showProduct：Order details / Tracking 每条带产品标签；
 * Main manifest 一行一个产品，只给整单的标「Order note」。
 */
export function StaffNoteList({
  notes,
  showProduct,
  dense = false,
}: {
  notes: readonly StaffNote[];
  showProduct: boolean;
  dense?: boolean;
}) {
  return (
    <ul data-staff-note-list>
      {notes.map((n) => {
        const notified = notifiedLine(n);
        return (
          <li
            key={n.id}
            data-staff-note={n.id}
            className={cn(
              "border-b-[0.5px] border-black/[.06] text-[12px] last:border-b-0 night:border-white/10",
              dense ? "py-1.5" : "py-2",
            )}
          >
            <div className="mb-[3px] text-[11px] text-[#1a1a1a] night:text-white/55">
              <b className="font-semibold">{noteAuthor(n)}</b> ·{" "}
              {formatNoteTime(n.created_at)}
              {n.source ? ` · ${SOURCE_LABEL[n.source] ?? n.source}` : ""}
              {showProduct || !n.product_code ? <ProductTag note={n} /> : null}
            </div>
            <div className="[overflow-wrap:anywhere] whitespace-pre-wrap text-[#1a1a1a] night:text-white/90">
              <NoteText
                text={n.body}
                mentions={n.mentions}
                teams={n.mention_teams}
              />
            </div>
            {notified ? (
              <div
                data-staff-note-notified
                className="mt-[3px] text-[11px] text-[#6b6f76] night:text-white/45"
              >
                {notified}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

type AddState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "added"; notified: string | null }
  | { kind: "error"; text: string };

/** 后端 404 = 这单不在 Order List；400 等照后端英文原话，前面加「Not saved.」（5e 2026-11-21）。 */
function errorText(e: unknown): string {
  if (isStatus(e, 404))
    return "Not saved. This order isn't in Order List yet, so notes can't be added.";
  return `Not saved. ${describeError(e)}`;
}

/**
 * 写 ★ Note 的框：@ 下拉 + 多产品时「For」选产品 + n / 2000 + 蓝色 Add note（点了马上存：只加不改，不走页面 Save）。
 * 成功：绿字「Added.」（有 @ 时带 Notified）；失败：红框，打的字留着。
 */
export function StaffNoteComposer({
  orderNumber,
  products,
  fixedProductCode,
  source,
  directory,
  onAdded,
  onDirty,
  onUnauthorized,
  compact = false,
  autoFocus = false,
}: {
  orderNumber: string;
  /** 这单的产品；只有一个 ⇒ 自动带，不出选择框。 */
  products: readonly NoteProduct[];
  /** Main manifest：这一行的产品，不出选择框。 */
  fixedProductCode?: string;
  source: Exclude<StaffNoteSource, "migrated">;
  directory: MentionDirectory | null;
  onAdded: (note: StaffNote) => void;
  onDirty?: (dirty: boolean) => void;
  onUnauthorized: () => void;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const uid = useId();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<PickedMention[]>([]);
  const [product, setProduct] = useState("");
  const [state, setState] = useState<AddState>({ kind: "idle" });
  const needPick = fixedProductCode === undefined && products.length > 1;
  const productCode =
    fixedProductCode ??
    (products.length === 1 ? products[0].code : product || null);
  const len = text.trim().length;
  const over = text.length > STAFF_NOTE_MAX;
  const dirty = text.trim().length > 0;
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);

  async function add() {
    const body = text.trim();
    if (!body || over || state.kind === "saving") return;
    if (needPick && !product) {
      setState({
        kind: "error",
        text: "Not saved. Choose which product this note is for.",
      });
      return;
    }
    setState({ kind: "saving" });
    const input: StaffNoteCreate = {
      order_number: orderNumber,
      product_code: productCode,
      body,
      source,
      ...effectiveMentions(body, picked),
    };
    try {
      const note = await createStaffNote(input);
      setText("");
      setPicked([]);
      setState({ kind: "added", notified: notifiedLine(note) });
      onAdded(note);
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setState({ kind: "error", text: errorText(e) });
    }
  }

  return (
    <div data-staff-note-composer>
      <MentionTextarea
        id={`${uid}-text`}
        ariaLabel={`Add a ★ Note for ${orderNumber}`}
        value={text}
        onChange={(t) => {
          setText(t);
          if (state.kind !== "saving") setState({ kind: "idle" });
        }}
        picked={picked}
        onPickedChange={setPicked}
        directory={directory}
        rows={compact ? 2 : 3}
        placeholder="Add a ★ Note… type @ to mention a teammate"
        disabled={state.kind === "saving"}
        className={cn(
          "block w-full resize-y rounded-md border bg-white px-[9px] py-[7px] font-[inherit] text-[13px] leading-[1.45] text-[#1a1a1a] focus:outline-2 focus:outline-[#3b82f6] max-sm:min-h-[44px] night:bg-[#0b1522] night:text-white",
          over ? "border-[#A32D2D]" : "border-[#cfd3d8] night:border-white/15",
          compact ? "min-h-[44px]" : "min-h-[60px]",
        )}
      />
      {autoFocus ? <AutoFocus id={`${uid}-text`} /> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
        {needPick ? (
          <label className="flex items-center gap-1.5 text-[11px] text-[#6b6f76] night:text-white/55">
            For
            <select
              data-staff-note-product
              value={product}
              onChange={(e) => {
                setProduct(e.target.value);
                if (state.kind === "error") setState({ kind: "idle" });
              }}
              className="h-7 max-w-[220px] rounded-md border border-[#cfd3d8] bg-white px-1.5 text-[12px] text-[#1a1a1a] night:border-white/15 night:bg-[#0b1522] night:text-white"
            >
              <option value="">Choose a product…</option>
              {products.map((p) => (
                <option key={p.code ?? p.name} value={p.code ?? ""}>
                  {p.name || p.code || "—"}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {state.kind === "added" ? (
          <span
            role="status"
            data-staff-note-added
            className="text-[12px] font-semibold text-[#1f7a3a] night:text-emerald-300"
          >
            Added.{state.notified ? ` ${state.notified}` : ""}
          </span>
        ) : null}
        <span
          data-staff-note-count
          className={cn(
            "text-[11px] tabular-nums",
            over
              ? "font-semibold text-[#A32D2D] night:text-red-300"
              : "text-[#6b6f76] night:text-white/45",
          )}
        >
          {over
            ? `${text.length} / ${STAFF_NOTE_MAX} — ${text.length - STAFF_NOTE_MAX} over the limit`
            : `${text.length} / ${STAFF_NOTE_MAX}`}
        </span>
        <button
          type="button"
          data-staff-note-add
          onClick={() => void add()}
          disabled={!len || over || state.kind === "saving"}
          className={cn(
            "ml-auto cursor-pointer rounded-md border border-[#3b82f6] bg-[#3b82f6] font-semibold text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-45",
            compact
              ? "h-[26px] px-2.5 text-[11px]"
              : "h-[30px] px-3.5 text-[12px]",
          )}
        >
          {state.kind === "saving" ? "Adding…" : "Add note"}
        </button>
      </div>
      {state.kind === "error" ? (
        <div
          role="alert"
          data-staff-note-error
          className="mt-2 rounded-md border border-[#f3b9b9] bg-[#fdecec] px-[9px] py-[7px] text-[12px] leading-[1.45] text-[#A32D2D] night:border-red-400/40 night:bg-red-400/10 night:text-red-300"
        >
          {state.text}
        </div>
      ) : null}
    </div>
  );
}

function AutoFocus({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.focus();
  }, [id]);
  return null;
}
