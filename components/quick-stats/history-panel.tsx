"use client";

import { cn } from "@/lib/utils";
import type { QuickStatsLogRow } from "@/types/quick-stats";

import {
  BTN,
  BTN_BLUE,
  CARD,
  CARD_H,
  CARD_SUB,
  CARD_TITLE,
  FOOT,
  GREEN,
  HINT,
  NUM,
  OUTCOME_CLASS,
  RED,
  SM,
  TABLE,
  TD,
  TH,
  laStamp,
  rowsLabel,
  took,
} from "./styles";

const SOURCE_LABEL: Record<string, string> = {
  ask: "Ask",
  card: "Card",
  export: "Excel",
};

function resultLine(row: QuickStatsLogRow): string {
  if (row.outcome === "ok")
    return row.truncated
      ? `${rowsLabel(row.row_count)} (more not shown)`
      : rowsLabel(row.row_count);
  if (row.outcome === "started") return "Running or stopped before it finished";
  return row.error || "";
}

/** History：所有人（Q3 A，By 列）、最新在上；Show more 每次多 50 条、最多 200。 */
export function HistoryPanel({
  items,
  loadError,
  canShowMore,
  loadingMore,
  savingId,
  savedIds,
  saveErrors,
  excelBusyId,
  onShowMore,
  onExcel,
  onSave,
}: {
  items: QuickStatsLogRow[] | null;
  loadError: string | null;
  canShowMore: boolean;
  loadingMore: boolean;
  savingId: number | null;
  savedIds: ReadonlySet<number>;
  saveErrors: Readonly<Record<number, string>>;
  excelBusyId: number | null;
  onShowMore: () => void;
  onExcel: (row: QuickStatsLogRow) => void;
  onSave: (row: QuickStatsLogRow) => void;
}) {
  if (items && items.length === 0 && !loadError) {
    return (
      <section className={CARD} data-qs-history>
        <div className={CARD_H}>
          <span className={CARD_TITLE}>History</span>
        </div>
        <div
          className="px-4 py-[22px] text-center text-[13px] text-[#4b5563] night:text-white/55"
          data-qs-history-empty
        >
          No runs yet.
        </div>
      </section>
    );
  }
  return (
    <section className={CARD} data-qs-history>
      <div className={CARD_H}>
        <span className={CARD_TITLE}>
          History{" "}
          <span className={CARD_SUB}>
            latest {items ? items.length : ""} · everyone
          </span>
        </span>
      </div>
      {loadError ? (
        <div className={cn(FOOT, "border-t-0")}>
          <span className={RED} role="alert">
            {loadError}
          </span>
        </div>
      ) : !items ? (
        <div className="px-4 py-[22px] text-center text-[13px] text-[#4b5563]">
          Loading…
        </div>
      ) : (
        <>
          <div className="overflow-x-auto overscroll-x-contain">
            <table
              className={cn(TABLE, "max-sm:min-w-[640px]")}
              data-qs-history-table
            >
              <thead>
                <tr>
                  <th className={TH}>When (LA)</th>
                  <th className={TH}>By</th>
                  <th className={TH}>From</th>
                  <th className={TH}>Question</th>
                  <th className={TH}>Result</th>
                  <th className={cn(TH, "text-right")}>Took</th>
                  <th className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const sql = row.sql || row.sql_text || "";
                  const ok = row.outcome === "ok" && !!sql;
                  const showActions = ok && row.source !== "export";
                  // 从卡片跑的已经是卡片了，不再给 Save as card。
                  const canSave = showActions && row.source !== "card";
                  const saved = savedIds.has(row.id);
                  return (
                    <tr key={row.id} data-qs-log-id={row.id}>
                      <td className={cn(TD, "whitespace-nowrap tabular-nums")}>
                        {laStamp(row.asked_at)}
                      </td>
                      <td className={cn(TD, "whitespace-nowrap")} data-qs-by>
                        {row.username || "—"}
                      </td>
                      <td className={TD}>
                        <span
                          className="rounded-[4px] bg-[#f1f3f6] px-1.5 py-px text-[11px] whitespace-nowrap text-[#374151] night:bg-white/10 night:text-white/70"
                          data-qs-source
                        >
                          {SOURCE_LABEL[row.source] ?? row.source}
                        </span>
                      </td>
                      <td
                        className={cn(
                          TD,
                          "max-w-[420px] min-w-[240px] leading-snug max-sm:min-w-[200px]",
                        )}
                      >
                        {sql || row.explanation ? (
                          <details>
                            <summary className="cursor-pointer break-words">
                              {row.question}
                            </summary>
                            {row.explanation ? (
                              <div className={cn(HINT, "mt-1")}>
                                {row.explanation}
                              </div>
                            ) : null}
                            {sql ? (
                              <pre className="m-0 mt-1 font-mono text-[11.5px] break-words whitespace-pre-wrap text-[#888] night:text-white/45">
                                {sql}
                              </pre>
                            ) : null}
                          </details>
                        ) : (
                          <div className="break-words">{row.question}</div>
                        )}
                      </td>
                      <td className={cn(TD, "min-w-[150px]")}>
                        <span
                          className={OUTCOME_CLASS[row.outcome] ?? ""}
                          data-qs-outcome
                        >
                          {row.outcome}
                        </span>
                        <div className={cn(HINT, "break-words")}>
                          {resultLine(row)}
                        </div>
                      </td>
                      <td className={cn(TD, NUM)}>{took(row.duration_ms)}</td>
                      <td className={cn(TD, "w-px")}>
                        {showActions ? (
                          <div className="flex flex-col items-start gap-1.5">
                            <button
                              type="button"
                              className={cn(BTN, SM)}
                              disabled={excelBusyId === row.id}
                              onClick={() => onExcel(row)}
                              data-qs-log-excel
                            >
                              {excelBusyId === row.id
                                ? "Downloading…"
                                : "Excel"}
                            </button>
                            {canSave ? (
                              saved ? (
                                <span className={GREEN} data-qs-log-saved>
                                  Saved as a card
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className={cn(BTN_BLUE, SM)}
                                  disabled={savingId === row.id}
                                  onClick={() => onSave(row)}
                                  data-qs-log-save
                                >
                                  {savingId === row.id
                                    ? "Saving…"
                                    : "Save as card"}
                                </button>
                              )
                            ) : null}
                            {saveErrors[row.id] ? (
                              <span className={RED} role="alert">
                                {saveErrors[row.id]}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canShowMore ? (
            <div className={FOOT}>
              <button
                type="button"
                className={cn(BTN, SM)}
                disabled={loadingMore}
                onClick={onShowMore}
                data-qs-show-more
              >
                {loadingMore ? "Loading…" : "Show more"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
