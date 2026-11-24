"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PhoneMore } from "@/components/ui/phone";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/components/ui/action-result";
import type { QuickStatsCard } from "@/types/quick-stats";

import {
  BTN,
  BTN_BLUE,
  BTN_DANGER,
  CARD,
  CARD_H,
  CARD_SUB,
  CARD_TITLE,
  FOOT,
  GREEN,
  HINT,
  NUM,
  RED,
  SM,
  TABLE,
  TD,
  TH,
  laDayShort,
} from "./styles";

export interface RenameDraft {
  id: number;
  title: string;
  saving: boolean;
  error: string | null;
}

/** Saved cards：Run（蓝，重跑存好的 SQL、不经 AI）/ Excel / Rename（格子里改，按蓝色 Save 才存）/ Delete（先确认，Q4 A）。 */
export function CardsPanel({
  cards,
  loadError,
  busy,
  rename,
  renamedId,
  excelBusyId,
  onRun,
  onExcel,
  onStartRename,
  onRenameChange,
  onRenameSave,
  onRenameCancel,
  onDelete,
}: {
  cards: QuickStatsCard[] | null;
  loadError: string | null;
  /** 正在提问 / 跑卡片时 Run 不能点。 */
  busy: boolean;
  rename: RenameDraft | null;
  /** 刚改好名字的那张（显示绿字 Saved）。 */
  renamedId: number | null;
  excelBusyId: number | null;
  onRun: (card: QuickStatsCard) => void;
  onExcel: (card: QuickStatsCard) => void;
  onStartRename: (card: QuickStatsCard) => void;
  onRenameChange: (title: string) => void;
  onRenameSave: () => void;
  onRenameCancel: () => void;
  onDelete: (card: QuickStatsCard) => Promise<ActionResult>;
}) {
  const [confirmDelete, setConfirmDelete] = useState<QuickStatsCard | null>(
    null,
  );

  if (cards && cards.length === 0) {
    return (
      <section className={CARD} data-qs-cards>
        <div className={CARD_H}>
          <span className={CARD_TITLE}>
            Saved cards <span className={CARD_SUB}>0</span>
          </span>
        </div>
        <div
          className="px-4 py-[22px] text-center text-[13px] text-[#4b5563] night:text-white/55"
          data-qs-cards-empty
        >
          No saved cards yet. Ask a question, then press <b>Save as card</b> to
          keep it here.
        </div>
      </section>
    );
  }

  const actions = (c: QuickStatsCard, editing: boolean) => (
    <>
      <button
        type="button"
        className={cn(BTN_BLUE, SM)}
        disabled={busy}
        onClick={() => onRun(c)}
        data-qs-card-run
      >
        Run
      </button>
      <PhoneMore>
        <button
          type="button"
          className={cn(BTN, SM)}
          disabled={excelBusyId === c.id}
          onClick={() => onExcel(c)}
          data-qs-card-excel
        >
          {excelBusyId === c.id ? "Downloading…" : "Excel"}
        </button>
        {editing ? null : (
          <button
            type="button"
            className={cn(BTN, SM)}
            disabled={!!rename}
            onClick={() => onStartRename(c)}
            data-qs-card-rename
          >
            Rename
          </button>
        )}
        <button
          type="button"
          className={cn(BTN_DANGER, SM)}
          onClick={() => setConfirmDelete(c)}
          data-qs-card-delete
        >
          Delete
        </button>
      </PhoneMore>
    </>
  );

  const titleCell = (c: QuickStatsCard, where: "desk" | "phone") => {
    const editing = rename?.id === c.id;
    return (
      <>
        {editing ? (
          <div className="flex flex-wrap items-center gap-1.5" data-qs-rename>
            <input
              id={`qs-card-title-${where}-${c.id}`}
              aria-label="Card title"
              value={rename.title}
              maxLength={200}
              autoFocus
              disabled={rename.saving}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRenameSave();
                if (e.key === "Escape") onRenameCancel();
              }}
              className="min-w-[220px] rounded-[6px] border border-[#cbd2dc] bg-white px-2 py-[5px] text-[13px] text-[#1a1a1a] max-sm:w-full max-sm:min-w-0 night:border-white/15 night:bg-white/[.04] night:text-white/90"
            />
            <button
              type="button"
              className={cn(BTN_BLUE, SM)}
              disabled={rename.saving || !rename.title.trim()}
              onClick={onRenameSave}
              data-qs-rename-save
            >
              {rename.saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={cn(BTN, SM)}
              disabled={rename.saving}
              onClick={onRenameCancel}
            >
              Cancel
            </button>
            {rename.error ? (
              <span className={RED} role="alert">
                {rename.error}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="font-semibold break-words" data-qs-card-title>
            {c.title}
            {renamedId === c.id ? (
              <span className={cn(GREEN, "ml-2")} data-qs-renamed>
                Saved
              </span>
            ) : null}
          </div>
        )}
        <div className="mt-0.5 text-[12px] break-words text-[#4b5563] night:text-white/55">
          {c.question}
        </div>
      </>
    );
  };

  return (
    <section className={CARD} data-qs-cards>
      <div className={CARD_H}>
        <span className={CARD_TITLE}>
          Saved cards{" "}
          <span className={CARD_SUB}>{cards ? cards.length : ""}</span>
        </span>
        <span className={cn(HINT, "max-sm:hidden")}>
          Run re-runs the saved query as it is — no AI, same rules every time.
        </span>
      </div>
      {loadError ? (
        <div className={cn(FOOT, "border-t-0")}>
          <span className={RED} role="alert">
            {loadError}
          </span>
        </div>
      ) : !cards ? (
        <div className="px-4 py-[22px] text-center text-[13px] text-[#4b5563]">
          Loading…
        </div>
      ) : (
        <>
          <div className="overflow-x-auto max-sm:hidden">
            <table className={TABLE} data-qs-cards-table>
              <thead>
                <tr>
                  <th className={TH}>Card</th>
                  <th className={TH}>Saved by</th>
                  <th className={cn(TH, "text-right")}>Updated</th>
                  <th className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c.id} data-qs-card-id={c.id}>
                    <td className={TD}>{titleCell(c, "desk")}</td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      {c.created_by || "—"}
                    </td>
                    <td className={cn(TD, NUM)}>
                      {laDayShort(c.updated_at || c.created_at)}
                    </td>
                    <td className={cn(TD, "w-px")}>
                      <div className="flex flex-nowrap items-center gap-2">
                        {actions(c, rename?.id === c.id)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sm:hidden">
            {cards.map((c) => (
              <div
                key={c.id}
                className="border-b border-[#f0f1f3] px-3 py-[11px] last:border-b-0 night:border-white/10"
                data-qs-card-phone={c.id}
              >
                {titleCell(c, "phone")}
                <div className="mt-0.5 text-[12px] text-[#4b5563] night:text-white/55">
                  {c.created_by || "—"} ·{" "}
                  {laDayShort(c.updated_at || c.created_at)}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {actions(c, rename?.id === c.id)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete this card?"
          confirmLabel="Delete"
          busyLabel="Deleting…"
          danger
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const result = await onDelete(confirmDelete);
            if (result.status === "ok") setConfirmDelete(null);
            return result;
          }}
        >
          <p data-qs-delete-text>
            “{confirmDelete.title}” will be removed for all Super Admins. It
            cannot be restored from this page. Past runs stay in History.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
