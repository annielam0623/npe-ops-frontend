"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { usePhoneInfo } from "@/components/ui/phone";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  askQuickStats,
  cardExportUrl,
  createQuickStatsCard,
  deleteQuickStatsCard,
  downloadQuickStatsExcel,
  fetchQuickStatsCards,
  fetchQuickStatsHistory,
  logExportUrl,
  QUICK_STATS_HISTORY_MAX,
  QUICK_STATS_HISTORY_STEP,
  QUICK_STATS_MAX_QUESTION,
  renameQuickStatsCard,
  runQuickStatsCard,
} from "@/lib/quick-stats-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import type { QuickStatsCard, QuickStatsLogRow } from "@/types/quick-stats";

import { CardsPanel, type RenameDraft } from "./cards-panel";
import { HistoryPanel } from "./history-panel";
import {
  AskingCard,
  ResultCard,
  type RunView,
  type SaveState,
} from "./result-card";
import { BOX_ERR, BTN_BLUE, CARD, CARD_H, CARD_TITLE, laStamp } from "./styles";

/**
 * G373 Quick Stats（Annie 2026-11-20「动手」；preview v1 https://claude.ai/artifact/ULDTQ1GevPbDGgKEQhKF1S，
 * 2026-11-23「同意推荐，动手」：Q1 A Settings 最后、Q2 A Ask → 结果 → 卡片 → History、Q3 A 所有人的记录带 By、Q4 A 删卡先确认）。
 * 只 Super Admin（后端每个接口 require_superadmin，别人 403）；不加开关。
 * 数据：问题 → 后端交给 Claude 写一条只读 SELECT → 生产只读账号跑 → 这里显示；卡片 / 记录存在后端
 * （quick_stats_cards / quick_stats_log）；Excel 由后端用同一条 SQL 再跑一次生成。
 */

const EXAMPLES = [
  "Sends in the last 30 days by type and status",
  "Orders with MTLV in the next 30 days",
  "Guests per pickup hotel, last 7 days",
];

type Running = { card?: string } | null;

function nowLa(): string {
  return laStamp(new Date().toISOString());
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function QuickStatsView() {
  const info = usePhoneInfo("About this page");
  const [forbidden, setForbidden] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState<Running>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [resultSave, setResultSave] = useState<SaveState>({ kind: "idle" });
  const [resultExcelBusy, setResultExcelBusy] = useState(false);
  const [resultExcelError, setResultExcelError] = useState<string | null>(null);

  const [cards, setCards] = useState<QuickStatsCard[] | null>(null);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const [rename, setRename] = useState<RenameDraft | null>(null);
  const [renamedId, setRenamedId] = useState<number | null>(null);
  const [cardExcelId, setCardExcelId] = useState<number | null>(null);

  const [history, setHistory] = useState<QuickStatsLogRow[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(QUICK_STATS_HISTORY_STEP);
  const [loadingMore, setLoadingMore] = useState(false);
  const [logExcelId, setLogExcelId] = useState<number | null>(null);
  const [logSavingId, setLogSavingId] = useState<number | null>(null);
  const [savedLogIds, setSavedLogIds] = useState<Set<number>>(new Set());
  const [logSaveErrors, setLogSaveErrors] = useState<Record<number, string>>(
    {},
  );

  const [downloadError, setDownloadError] = useState<string | null>(null);

  const redirectingRef = useRef(false);
  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  /** 401 跳登录、403 整页换成一句话；处理了返回 true。 */
  const handleAuth = useCallback(
    (error: unknown): boolean => {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return true;
      }
      if (isStatus(error, 403)) {
        setForbidden(true);
        return true;
      }
      return false;
    },
    [redirectToLogin],
  );

  const loadCards = useCallback(async () => {
    try {
      const data = await fetchQuickStatsCards();
      setCards(data.cards);
      setCardsError(null);
    } catch (error) {
      if (!handleAuth(error))
        setCardsError(`Could not load the cards: ${describeError(error)}`);
    }
  }, [handleAuth]);

  const loadHistory = useCallback(
    async (limit: number) => {
      try {
        const data = await fetchQuickStatsHistory(limit);
        setHistory(data.items);
        setHistoryLimit(limit);
        setHistoryError(null);
      } catch (error) {
        if (!handleAuth(error))
          setHistoryError(
            `Could not load the history: ${describeError(error)}`,
          );
      }
    },
    [handleAuth],
  );

  useEffect(() => {
    void loadCards();
    void loadHistory(QUICK_STATS_HISTORY_STEP);
  }, [loadCards, loadHistory]);

  const renameDirty =
    !!rename &&
    rename.title.trim() !==
      (cards?.find((c) => c.id === rename.id)?.title ?? "").trim();
  useLeaveGuard(
    renameDirty,
    "The new card title is not saved. Leave this page anyway?",
  );

  /** 提问 / 跑卡片共用：503 记下来（Ask 不能再按），400 / 404 等原话显示。 */
  async function doRun(kind: "ask" | "card", card?: QuickStatsCard) {
    if (running) return;
    setRunning(kind === "card" && card ? { card: card.title } : {});
    setRun(null);
    setRunError(null);
    setResultSave({ kind: "idle" });
    setResultExcelError(null);
    try {
      const result =
        kind === "card" && card
          ? await runQuickStatsCard(card.id)
          : await askQuickStats(question.trim());
      setRun({
        result,
        at: nowLa(),
        card:
          kind === "card" && card
            ? { id: card.id, title: result.card?.title ?? card.title }
            : undefined,
      });
    } catch (error) {
      if (handleAuth(error)) return;
      if (isStatus(error, 503)) setSetupError(describeError(error));
      else setRunError(describeError(error));
    } finally {
      setRunning(null);
      void loadHistory(historyLimit);
    }
  }

  async function saveResultAsCard() {
    const logId = run?.result.log_id;
    if (logId === null || logId === undefined) return;
    setResultSave({ kind: "saving" });
    try {
      await createQuickStatsCard(logId);
      setResultSave({ kind: "saved" });
      setSavedLogIds((s) => new Set(s).add(logId));
      void loadCards();
    } catch (error) {
      if (handleAuth(error)) return;
      setResultSave({ kind: "error", message: describeError(error) });
    }
  }

  async function saveLogAsCard(row: QuickStatsLogRow) {
    setLogSavingId(row.id);
    setLogSaveErrors((m) => {
      const next = { ...m };
      delete next[row.id];
      return next;
    });
    try {
      await createQuickStatsCard(row.id);
      setSavedLogIds((s) => new Set(s).add(row.id));
      if (run?.result.log_id === row.id) setResultSave({ kind: "saved" });
      void loadCards();
    } catch (error) {
      if (handleAuth(error)) return;
      setLogSaveErrors((m) => ({ ...m, [row.id]: describeError(error) }));
    } finally {
      setLogSavingId(null);
    }
  }

  async function download(
    url: string,
    setBusy: (busy: boolean) => void,
    setError: (msg: string | null) => void,
  ) {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await downloadQuickStatsExcel(url);
      saveBlob(blob, filename);
    } catch (error) {
      if (handleAuth(error)) return;
      if (isStatus(error, 503)) setSetupError(describeError(error));
      setError(`Download failed: ${describeError(error)}`);
    } finally {
      setBusy(false);
      void loadHistory(historyLimit);
    }
  }

  function resultExcel() {
    if (!run) return;
    const url = run.card
      ? cardExportUrl(run.card.id)
      : run.result.log_id !== null
        ? logExportUrl(run.result.log_id)
        : null;
    if (!url) return;
    void download(url, setResultExcelBusy, setResultExcelError);
  }

  async function saveRename() {
    if (!rename || !rename.title.trim() || rename.saving) return;
    const { id } = rename;
    setRename({ ...rename, saving: true, error: null });
    try {
      const card = await renameQuickStatsCard(id, rename.title.trim());
      setCards((list) => list?.map((c) => (c.id === id ? card : c)) ?? list);
      setRename(null);
      setRenamedId(id);
      if (run?.card?.id === id)
        setRun({ ...run, card: { id, title: card.title } });
    } catch (error) {
      if (handleAuth(error)) return;
      setRename((r) =>
        r && r.id === id
          ? { ...r, saving: false, error: describeError(error) }
          : r,
      );
    }
  }

  async function deleteCard(card: QuickStatsCard): Promise<ActionResult> {
    try {
      await deleteQuickStatsCard(card.id);
      setCards((list) => list?.filter((c) => c.id !== card.id) ?? list);
      if (rename?.id === card.id) setRename(null);
      void loadCards();
      return { status: "ok" };
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      if (isStatus(error, 403)) setForbidden(true);
      return { status: "error", message: describeError(error) };
    }
  }

  async function showMore() {
    setLoadingMore(true);
    await loadHistory(
      Math.min(
        historyLimit + QUICK_STATS_HISTORY_STEP,
        QUICK_STATS_HISTORY_MAX,
      ),
    );
    setLoadingMore(false);
  }

  if (forbidden) {
    return (
      <main className="text-stone-800 night:text-white/90">
        <Panel>
          <p
            className="font-medium text-stone-800 night:text-white/90"
            data-qs-forbidden
          >
            Only a Super Admin can use Quick Stats.
          </p>
        </Panel>
      </main>
    );
  }

  const tooLong = question.length > QUICK_STATS_MAX_QUESTION;
  const askDisabled = !!running || !!setupError || !question.trim() || tooLong;
  const showExamples =
    history !== null && history.length === 0 && !running && !run;

  return (
    <main className="text-stone-800 night:text-white/90">
      <h2 className="sr-only">Quick Stats</h2>
      <p className="mb-4 text-[13px] leading-normal text-white/55 night:text-white/55">
        {info.button}
        <span className={cn(info.hide, "max-sm:mt-1 max-sm:block")}>
          Ask a question about our data in plain words (Chinese or English).
          Read only — nothing is ever changed. Super Admin only.
        </span>
      </p>

      {setupError ? (
        <div className={cn(BOX_ERR, "mb-4")} role="alert" data-qs-setup-error>
          {setupError}
        </div>
      ) : null}

      <section className={CARD} data-qs-ask>
        <div className={CARD_H}>
          <span className={CARD_TITLE}>Ask</span>
        </div>
        <form
          className="px-4 py-3.5 max-sm:px-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!askDisabled) void doRun("ask");
          }}
        >
          <textarea
            id="qs-question"
            aria-label="Question"
            value={question}
            disabled={!!running || !!setupError}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.ctrlKey || e.metaKey) &&
                !askDisabled
              ) {
                e.preventDefault();
                void doRun("ask");
              }
            }}
            placeholder="e.g. How many orders in the next 30 days include MTLV?"
            className="min-h-[74px] w-full resize-y rounded-[8px] border border-[#cbd2dc] bg-white px-[11px] py-[9px] text-[14px] leading-snug text-[#1a1a1a] focus:border-[#3b82f6] focus:outline-none disabled:bg-[#f6f7f9] disabled:text-[#6b7280] night:border-white/15 night:bg-white/[.04] night:text-white/90"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <span
              className={cn(
                "text-[12px] tabular-nums",
                tooLong ? "font-semibold text-[#b3261e]" : "text-[#888]",
              )}
              data-qs-count
            >
              {question.length.toLocaleString("en-US")} /{" "}
              {QUICK_STATS_MAX_QUESTION.toLocaleString("en-US")}
            </span>
            <span className="flex-1" />
            <button
              type="submit"
              className={BTN_BLUE}
              disabled={askDisabled}
              data-qs-ask-button
            >
              {running && !running.card ? "Asking…" : "Ask"}
            </button>
          </div>
          {showExamples ? (
            <div
              className="mt-2.5 flex flex-wrap items-center gap-1.5 max-sm:hidden"
              data-qs-examples
            >
              <span className="text-[12px] text-[#4b5563]">Try:</span>
              {EXAMPLES.map((ex, i) => (
                <span key={ex} className="inline-flex items-center gap-1.5">
                  {i > 0 ? (
                    <span className="text-[12px] text-[#4b5563]">·</span>
                  ) : null}
                  <button
                    type="button"
                    className="cursor-pointer text-[12px] text-[#185FA5] underline underline-offset-2"
                    onClick={() => setQuestion(ex)}
                  >
                    {ex}
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </form>
      </section>

      {running ? <AskingCard card={running.card} /> : null}
      {runError ? (
        <div
          className={cn(BOX_ERR, "mb-[18px]")}
          role="alert"
          data-qs-run-error
        >
          {runError}
        </div>
      ) : null}
      {run ? (
        <ResultCard
          run={run}
          save={
            run.result.log_id !== null && savedLogIds.has(run.result.log_id)
              ? { kind: "saved" }
              : resultSave
          }
          onSave={() => void saveResultAsCard()}
          onExcel={resultExcel}
          excelBusy={resultExcelBusy}
          excelError={resultExcelError}
        />
      ) : null}

      {downloadError ? (
        <div className="mb-[18px]">
          <ErrorBanner
            actionLabel="Dismiss"
            onAction={() => setDownloadError(null)}
          >
            {downloadError}
          </ErrorBanner>
        </div>
      ) : null}

      <CardsPanel
        cards={cards}
        loadError={cardsError}
        busy={!!running}
        rename={rename}
        renamedId={renamedId}
        excelBusyId={cardExcelId}
        onRun={(c) => void doRun("card", c)}
        onExcel={(c) =>
          void download(
            cardExportUrl(c.id),
            (b) => setCardExcelId(b ? c.id : null),
            setDownloadError,
          )
        }
        onStartRename={(c) => {
          setRenamedId(null);
          setRename({ id: c.id, title: c.title, saving: false, error: null });
        }}
        onRenameChange={(title) =>
          setRename((r) => (r ? { ...r, title, error: null } : r))
        }
        onRenameSave={() => void saveRename()}
        onRenameCancel={() => setRename(null)}
        onDelete={deleteCard}
      />

      <HistoryPanel
        items={history}
        loadError={historyError}
        canShowMore={
          !!history &&
          history.length >= historyLimit &&
          historyLimit < QUICK_STATS_HISTORY_MAX
        }
        loadingMore={loadingMore}
        savingId={logSavingId}
        savedIds={savedLogIds}
        saveErrors={logSaveErrors}
        excelBusyId={logExcelId}
        onShowMore={() => void showMore()}
        onExcel={(row) =>
          void download(
            logExportUrl(row.id),
            (b) => setLogExcelId(b ? row.id : null),
            setDownloadError,
          )
        }
        onSave={(row) => void saveLogAsCard(row)}
      />

      <HowToUse
        title="How to use — Quick Stats"
        items={[
          <>
            Type a question in plain words (Chinese or English), e.g. “sends in
            the last 30 days by type and status” or “how many orders in the next
            30 days include MTLV”, and press <b>Ask</b>. It usually takes 5–20
            seconds.
          </>,
          <>
            The answer is a table. Under it you see one line on what was
            counted, the tables used, and the SQL (press <b>SQL</b> to open it).
            Check the line to make sure it counted what you meant; if not, ask
            again in different words.
          </>,
          "Send results list every status exactly as saved in the send log (delivered, sent, queued, bounce, failed: …). Nothing is merged into “success” or “failed” for you.",
          "Order numbers follow the order flow: Order List → Main Manifest. Outside the Order List only confirmed orders are counted.",
          "At most 5,000 rows are shown. If there are more, a yellow box says so — ask a narrower question.",
          <>
            <b>Download Excel</b> runs the same query again and saves the result
            as a .xlsx file, so new orders that came in a moment ago can make it
            slightly different from the screen.
          </>,
          <>
            <b>Save as card</b> keeps the question and its SQL. <b>Run</b> on a
            card re-runs that same SQL right away, without the AI, so the
            numbers are always counted the same way. Cards are shared by all
            Super Admins. Use <b>Rename</b> to give a card a short title.
          </>,
          <>
            <b>History</b> lists every run (asks, card runs and Excel downloads)
            by everyone, newest first.
          </>,
          "Questions that ask to change data (delete an order, change a phone number…) are refused and nothing is run. Guest data and results are never sent to the AI — only your question and the table layout.",
        ]}
        warning="Super Admin only. Queries use a read-only database account and stop after 20 seconds."
      />
    </main>
  );
}
