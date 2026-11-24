"use client";

import { PhoneMore } from "@/components/ui/phone";
import { QUICK_STATS_ROW_CAP } from "@/lib/quick-stats-api";
import { cn } from "@/lib/utils";
import type { QuickStatsCell, QuickStatsRunResult } from "@/types/quick-stats";

import {
  BOX_ERR,
  BOX_WARN,
  BTN,
  BTN_BLUE,
  CARD,
  CARD_H,
  FOOT,
  GREEN,
  NUM,
  RED,
  SM,
  TABLE,
  TD,
  TH,
  rowsLabel,
  took,
} from "./styles";

/** 一次运行的结果（提问或点卡片 Run）。 */
export interface RunView {
  result: QuickStatsRunResult;
  /** 洛杉矶时间，跑完那一刻。 */
  at: string;
  /** 从卡片跑的：卡片 id 和名字（不再显示 Save as card，Excel 走卡片的下载）。 */
  card?: { id: number; title: string };
}

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

const GROUPED = /(^|_)(id|year|yr)$/i;

function Cell({ value, col }: { value: QuickStatsCell; col: string }) {
  if (value === null || value === undefined)
    return (
      <td className={cn(TD, "text-[#888] italic night:text-white/35")}>null</td>
    );
  if (typeof value === "number")
    return (
      <td className={cn(TD, NUM)}>
        {GROUPED.test(col) ? String(value) : value.toLocaleString("en-US")}
      </td>
    );
  return <td className={cn(TD, "break-words")}>{String(value)}</td>;
}

export function ResultCard({
  run,
  save,
  onSave,
  onExcel,
  excelBusy,
  excelError,
}: {
  run: RunView;
  save: SaveState;
  onSave: () => void;
  onExcel: () => void;
  excelBusy: boolean;
  excelError: string | null;
}) {
  const r = run.result;
  const ok = r.outcome === "ok";
  const refused = r.outcome === "refused";
  const message = r.message?.trim() || "";
  const numericCol = r.columns.map((_, i) =>
    r.rows.some((row) => typeof row[i] === "number"),
  );
  const canSave = ok && !run.card && r.log_id !== null;
  const canExcel = ok && (run.card || r.log_id !== null);

  const meta = ok
    ? `${r.truncated ? `${QUICK_STATS_ROW_CAP.toLocaleString("en-US")} rows shown` : rowsLabel(r.row_count)} · ${took(r.duration_ms)} · ${run.at}`
    : refused
      ? `Nothing was run · ${run.at}`
      : `${took(r.duration_ms)} · ${run.at}`;

  return (
    <section className={CARD} aria-live="polite" data-qs-result={r.outcome}>
      <div className={cn(CARD_H, "items-start")}>
        <div className="min-w-0 flex-1 max-sm:basis-full">
          {run.card ? (
            <div className="mb-0.5 text-[12px] font-semibold text-[#4b5563] night:text-white/55">
              Card: {run.card.title}
            </div>
          ) : null}
          <div
            className="text-[14px] leading-snug font-semibold break-words"
            data-qs-question
          >
            {r.question}
          </div>
          {r.explanation ? (
            <div
              className="mt-1 text-[13px] leading-normal text-[#4b5563] night:text-white/60"
              data-qs-explanation
            >
              {r.explanation}
            </div>
          ) : null}
          <div
            className="mt-1.5 text-[12.5px] text-[#4b5563] night:text-white/55"
            data-qs-meta
          >
            {meta}
          </div>
        </div>
        {ok ? (
          <div className="flex flex-wrap items-center gap-2">
            {save.kind === "saved" ? (
              <span className={GREEN} data-qs-saved>
                Saved as a card
              </span>
            ) : null}
            {save.kind === "error" ? (
              <span className={RED} role="alert">
                {save.message}
              </span>
            ) : null}
            {canSave ? (
              <button
                type="button"
                className={cn(BTN_BLUE, SM)}
                disabled={save.kind === "saving" || save.kind === "saved"}
                onClick={onSave}
                data-qs-save-card
              >
                {save.kind === "saved"
                  ? "Saved"
                  : save.kind === "saving"
                    ? "Saving…"
                    : "Save as card"}
              </button>
            ) : null}
            {canExcel ? (
              <PhoneMore>
                <button
                  type="button"
                  className={cn(BTN, SM)}
                  disabled={excelBusy}
                  onClick={onExcel}
                  data-qs-excel
                >
                  {excelBusy ? "Downloading…" : "Download Excel"}
                </button>
              </PhoneMore>
            ) : null}
          </div>
        ) : null}
      </div>

      {excelError ? (
        <div className={cn(BOX_ERR, "mx-4 my-3 max-sm:mx-3")} role="alert">
          {excelError}
        </div>
      ) : null}

      {ok && r.truncated ? (
        <div className={BOX_WARN} data-qs-truncated>
          <b>
            Showing the first {QUICK_STATS_ROW_CAP.toLocaleString("en-US")}{" "}
            rows.
          </b>{" "}
          There are more. The Excel has the same{" "}
          {QUICK_STATS_ROW_CAP.toLocaleString("en-US")} rows. Ask a narrower
          question (a shorter date range, one product) to see the rest.
        </div>
      ) : null}

      {refused ? (
        <div className={BOX_WARN} data-qs-refused>
          {/^not run/i.test(message) ? null : <b>Not run. </b>}
          {message || "This is not a read-only statistics question."}
        </div>
      ) : null}

      {r.outcome === "error" ? (
        <div className={cn(BOX_ERR, "mx-4 my-3 max-sm:mx-3")} data-qs-error>
          {message || "The query could not be run."}
        </div>
      ) : null}

      {ok ? (
        r.columns.length === 0 || r.rows.length === 0 ? (
          <div
            className="px-4 py-6 text-center text-[13px] text-[#4b5563] night:text-white/55"
            data-qs-norows
          >
            No rows. The query ran and found nothing.
          </div>
        ) : (
          <div className="overflow-x-auto overscroll-x-contain">
            <table className={cn(TABLE, "max-sm:min-w-[520px]")} data-qs-table>
              <thead>
                <tr>
                  {r.columns.map((c, i) => (
                    <th
                      key={`${c}-${i}`}
                      className={cn(TH, numericCol[i] && "text-right")}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, ri) => (
                  <tr key={ri}>
                    {r.columns.map((c, ci) => (
                      <Cell key={ci} value={row[ci] ?? null} col={c} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {r.sql && !refused ? (
        <details
          className="border-t-[0.5px] border-black/[.08] night:border-white/10"
          data-qs-sql
        >
          <summary className="cursor-pointer px-4 py-2.5 text-[12.5px] font-semibold text-[#4b5563] max-sm:px-3 night:text-white/55">
            SQL
          </summary>
          <pre className="m-0 px-4 pb-3.5 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap text-[#1f2937] max-sm:px-3 night:text-white/80">
            {r.sql}
          </pre>
        </details>
      ) : null}
      {r.tables?.length && !refused ? (
        <div
          className={cn(
            FOOT,
            "text-[12.5px] text-[#4b5563] night:text-white/55",
          )}
          data-qs-tables
        >
          Tables used:{" "}
          {r.tables.map((t) => (
            <code
              key={t}
              className="mr-1 rounded-[4px] bg-[#f1f3f6] px-[5px] py-px font-mono text-[12px] text-[#1f2937] night:bg-white/10 night:text-white/80"
            >
              {t}
            </code>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function AskingCard({ card }: { card?: string }) {
  return (
    <section className={CARD} aria-live="polite" data-qs-asking>
      <div className="flex items-center gap-3 px-4 py-[26px] text-[13px] text-[#4b5563] night:text-white/60">
        <span
          aria-hidden
          className="h-[18px] w-[18px] flex-none animate-spin rounded-full border-[2.5px] border-[#dbe3ee] border-t-[#3b82f6] motion-reduce:animate-none"
        />
        <span>
          {card
            ? `Running the card “${card}”…`
            : "Writing the query and running it… This usually takes 5–20 seconds."}
        </span>
      </div>
    </section>
  );
}
