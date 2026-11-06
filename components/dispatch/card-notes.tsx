"use client";

import { useEffect, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import {
  type CardNote,
  type CardNoteKind,
  type CardNotes,
  fetchCardNotes,
  saveCardNote,
} from "@/lib/dispatch-api";
import { LA_TIME_ZONE } from "@/lib/la-date";
import { cn } from "@/lib/utils";

/**
 * G266 ② 卡片 Notes（Annie「G266 Dispatch同意推荐，动手」，preview X7ptbfdS5zbqgqUNb8fSmg 题 4 A；
 * Annie 催「我要的在卡片下方写notes的地方呢」）：Send to driver / Send to guide 每张卡最下面一个框，每天一份，
 * 只给 staff 看。蓝色 Save 才存（绿字 Saved. / 红字原话），有没存的改动时换日期 / 跳页 / 关标签页要拦（父组件管）。
 * 没有 dispatch.edit 也没有 dispatch.send ⇒ 只能看。接口 404（后端没上）/ 403（partner）⇒ 整块不出。
 */

export const NOTES_MAX = 2000;

const WHEN = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** 旧 `.rp-box` 里的蓝色提交键（蓝色只给提交）。 */
const SAVE_BTN =
  "h-8 rounded-[7px] border border-[#3b82f6] bg-[#3b82f6] px-3 text-[13px] font-semibold whitespace-nowrap text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b82f6] disabled:cursor-not-allowed disabled:opacity-50";

const COPY: Record<CardNoteKind, { who: string; placeholder: string }> = {
  driver: {
    who: "Drivers never see this.",
    placeholder: "Notes about today's texts to drivers",
  },
  guide: {
    who: "Guides never see this.",
    placeholder: "Notes about today's texts to guides",
  },
};

export type CardNotesState =
  { kind: "loading" } | { kind: "none" } | { kind: "ready"; data: CardNotes };

/** 这一天两张卡的 Notes：面板真显示出来才取；404 / 403 ⇒ none（不出）。 */
export function useCardNotes(
  date: string,
  active: boolean,
  onUnauthorized: () => void,
) {
  const [state, setState] = useState<CardNotesState>({ kind: "loading" });
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (!active || asked) return;
    setAsked(true);
    fetchCardNotes(date)
      .then((data) => setState({ kind: "ready", data }))
      .catch((e) => {
        if (isStatus(e, 401)) onUnauthorized();
        setState({ kind: "none" });
      });
  }, [active, asked, date, onUnauthorized]);
  const replace = (card: CardNoteKind, note: CardNote) =>
    setState((s) =>
      s.kind === "ready"
        ? { kind: "ready", data: { ...s.data, [card]: note } }
        : s,
    );
  return { state, replace };
}

export function CardNotesBox({
  date,
  card,
  note,
  canEdit,
  onSaved,
  draftText,
  onDraft,
  onUnauthorized,
}: {
  date: string;
  card: CardNoteKind;
  note: CardNote;
  canEdit: boolean;
  onSaved: (note: CardNote) => void;
  /**
   * 没存的字放在父组件（Dispatch 页）：Assign 存好后 Send 面板会重建，字不能丢（Annie：没存的改动不能悄悄丢掉）。
   * undefined = 没改；onDraft(null) = 跟已存的一样了 / 存好了。
   */
  draftText?: string;
  onDraft: (card: CardNoteKind, text: string | null) => void;
  onUnauthorized: () => void;
}) {
  const draft = draftText ?? note.text;
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const dirty = draftText !== undefined && draftText !== note.text;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setResult(null);
    try {
      const saved = await saveCardNote(date, card, draft);
      onSaved(saved);
      onDraft(card, null);
      setResult({ ok: true, text: "Saved." });
    } catch (e) {
      if (isStatus(e, 401)) onUnauthorized();
      else setResult({ ok: false, text: describeError(e) });
    } finally {
      setSaving(false);
    }
  }

  const id = `card-notes-${card}`;
  return (
    <div
      data-card-notes={card}
      className="flex flex-col gap-1.5 border-t border-[#e5e7eb] bg-[#fbfaf7] px-[18px] py-3 text-[#1a1a1a]"
    >
      <div className="flex flex-wrap items-baseline gap-2.5">
        <label htmlFor={id} className="text-[13px] font-bold text-[#111827]">
          Notes
        </label>
        <span className="text-[12px] text-[#6b7280]">
          For staff only. {COPY[card].who}
        </span>
      </div>
      <textarea
        id={id}
        rows={2}
        maxLength={NOTES_MAX}
        readOnly={!canEdit}
        placeholder={canEdit ? COPY[card].placeholder : "No notes."}
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          onDraft(card, v === note.text ? null : v);
          setResult(null);
        }}
        className={cn(
          "w-full resize-y rounded-[7px] border border-[#d1d5db] bg-white px-2.5 py-1.5 text-[13px] text-[#1a1a1a] outline-none focus:border-[#3b82f6]",
          !canEdit && "bg-[#f9fafb] text-[#4b5563]",
        )}
      />
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[12px] text-[#6b7280]">
        {note.updated_at ? (
          <span data-notes-edited>
            Last edited by {note.updated_by || "staff"} on{" "}
            {WHEN.format(new Date(note.updated_at)).replace(/\s/g, " ")}
          </span>
        ) : null}
        {canEdit ? (
          <span data-notes-count>
            {draft.length} / {NOTES_MAX}
          </span>
        ) : null}
        {result ? (
          <span
            role={result.ok ? "status" : "alert"}
            className={result.ok ? "text-[#3B6D11]" : "text-[#A32D2D]"}
          >
            {result.text}
          </span>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            data-notes-save
            disabled={!dirty || saving}
            onClick={() => void save()}
            className={SAVE_BTN}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
