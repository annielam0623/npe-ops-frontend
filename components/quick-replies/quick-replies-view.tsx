"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import {
  BTN_DELETE_CLASS,
  BTN_EDIT_CLASS,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_TITLE_CLASS,
  FORM_INPUT_CLASS,
  INLINE_INPUT_CLASS,
  LegacyHowTo,
  LegacyPageHeader,
  resultClass,
} from "@/components/pickup-locations/legacy-ui";
import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { fetchActionLog } from "@/lib/action-log";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  createQuickReply,
  deleteQuickReply,
  fetchQuickReplies,
  QUICK_REPLY_MAX,
  quickReplyProblem,
  reorderQuickReplies,
  updateQuickReply,
} from "@/lib/quick-replies-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { QuickReply } from "@/types";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; replies: QuickReply[] };

type Note = { tone: "ok" | "error"; text: string } | null;

/** 提交键（Save / Add）：蓝色只给提交（Annie 2026-10-11）。 */
const SUBMIT_CLASS =
  "inline-flex cursor-pointer items-center justify-center rounded-[7px] border-none bg-[#3b82f6] font-semibold whitespace-nowrap text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:bg-[#aaa]";

const charCount = (text: string) => [...text.trim()].length;

/**
 * Settings › Driver Quick Replies（G98，preview https://claude.ai/artifact/WaXwRvN6D51mCGtCeuzP9r ，Annie 2026-10-28「动手」）：
 * 司机一键发给客人的几句话。只有 admin（含 superadmin）能改（Annie 10-18「目前放 admin」），不要占位符（「2 不需要」）。
 * 比 preview 多的（接口有）：开 / 关一句、页面最底的 Action Log。排序用 ↑↓ 键（不是拖），灰框。
 */
export function QuickRepliesView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [logVersion, setLogVersion] = useState(0);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addNote, setAddNote] = useState<Note>(null);
  const [editing, setEditing] = useState<{
    id: number;
    text: string;
    error: string | null;
  } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<QuickReply | null>(null);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setView({ kind: "loading" });
    (async () => {
      try {
        const me = await fetchCurrentUser(signal);
        if (signal.aborted) return;
        if (!me.is_admin && !me.is_superadmin) {
          setView({ kind: "forbidden" });
          return;
        }
        const replies = await fetchQuickReplies(signal);
        if (!signal.aborted) setView({ kind: "ready", replies });
      } catch (error) {
        if (signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setView({ kind: "forbidden" });
        else setView({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  const replies = view.kind === "ready" ? view.replies : [];
  const onCount = replies.filter((r) => r.active).length;

  function setReplies(next: QuickReply[]) {
    setView({ kind: "ready", replies: next });
    setLogVersion((v) => v + 1);
  }

  /** 改动失败：401 跳登录；其余写后端原话（400 的 detail 是给人看的）。返回 null = 正在跳登录。 */
  function failText(error: unknown): string | null {
    if (isStatus(error, 401)) {
      redirectToLogin();
      return null;
    }
    if (error instanceof TypeError)
      return "Could not reach the server. Check your connection and try again - nothing was changed.";
    return describeError(error);
  }

  async function addReply() {
    if (adding) return;
    const problem = quickReplyProblem(draft, replies);
    if (problem) {
      setAddNote({ tone: "error", text: problem });
      return;
    }
    setAdding(true);
    setAddNote(null);
    try {
      const reply = await createQuickReply(draft.trim());
      setReplies([...replies, reply]);
      setDraft("");
      setAddNote({
        tone: "ok",
        text: `✓ Added. Drivers see it the next time they open Messages.`,
      });
    } catch (error) {
      const text = failText(error);
      if (text) setAddNote({ tone: "error", text });
    } finally {
      setAdding(false);
    }
  }

  async function saveEdit() {
    if (!editing || busyId !== null) return;
    const reply = replies.find((r) => r.id === editing.id);
    if (!reply) return;
    if (editing.text.trim() === reply.body) {
      setEditing(null);
      return;
    }
    const problem = quickReplyProblem(
      editing.text,
      replies.filter((r) => r.id !== editing.id),
    );
    if (problem) {
      setEditing({ ...editing, error: problem });
      return;
    }
    setBusyId(reply.id);
    try {
      const saved = await updateQuickReply(reply.id, {
        body: editing.text.trim(),
      });
      setReplies(replies.map((r) => (r.id === saved.id ? saved : r)));
      setEditing(null);
    } catch (error) {
      const text = failText(error);
      if (text) setEditing((e) => (e ? { ...e, error: text } : e));
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(reply: QuickReply) {
    if (busyId !== null) return;
    setBusyId(reply.id);
    setActionError(null);
    try {
      const saved = await updateQuickReply(reply.id, { active: !reply.active });
      setReplies(replies.map((r) => (r.id === saved.id ? saved : r)));
    } catch (error) {
      const text = failText(error);
      if (text) setActionError(`Could not switch “${reply.body}”: ${text}`);
    } finally {
      setBusyId(null);
    }
  }

  async function move(index: number, by: -1 | 1) {
    const to = index + by;
    if (busyId !== null || to < 0 || to >= replies.length) return;
    const next = [...replies];
    [next[index], next[to]] = [next[to], next[index]];
    const reply = replies[index];
    setBusyId(reply.id);
    setActionError(null);
    try {
      setReplies(await reorderQuickReplies(next.map((r) => r.id)));
    } catch (error) {
      const text = failText(error);
      if (text)
        setActionError(
          `Could not move “${reply.body}”: ${text}${isStatus(error, 400) ? " Refresh the page to get the latest list." : ""}`,
        );
    } finally {
      setBusyId(null);
    }
  }

  async function doDelete(reply: QuickReply): Promise<ActionResult> {
    try {
      await deleteQuickReply(reply.id);
    } catch (error) {
      const text = failText(error);
      return text === null
        ? { status: "redirecting" }
        : { status: "error", message: text };
    }
    setReplies(replies.filter((r) => r.id !== reply.id));
    if (editing?.id === reply.id) setEditing(null);
    setDeleting(null);
    return { status: "ok" };
  }

  return (
    <main className="text-stone-800 night:text-white/90">
      <LegacyPageHeader
        title="💬 Driver Quick Replies"
        count={
          view.kind === "ready"
            ? `${replies.length} replies · ${onCount} on`
            : null
        }
      />

      {view.kind === "forbidden" ? (
        <Panel>
          <p className="font-medium text-stone-800 night:text-white/90">
            Admin access required
          </p>
          <p className="mt-1">
            Only admins can change the driver quick replies.
          </p>
        </Panel>
      ) : view.kind === "error" ? (
        <ErrorBanner
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Could not load the quick replies: {view.message}
        </ErrorBanner>
      ) : (
        <>
          <LegacyHowTo title="How to use">
            <li>
              These are the one-tap texts relay and tour drivers can send to a
              guest. Drivers can only send these, not their own words.
            </li>
            <li>Use ↑ ↓ to change the order drivers see them in.</li>
            <li>
              Switch a reply off to hide it from drivers without deleting it.
              Drivers see changes the next time they open Messages.
            </li>
            <li>
              Up to {QUICK_REPLY_MAX} characters, plain text only: no emoji and
              no {"{ }"}. Each reply must be different.
            </li>
          </LegacyHowTo>

          <section className={CARD_CLASS} data-quick-replies>
            <div className={CARD_HEADER_CLASS}>
              <h2 className={CARD_TITLE_CLASS}>Driver quick replies</h2>
            </div>
            <div className="px-5 py-4">
              <p className="mb-3 text-[12px] text-[#1a1a1a] night:text-white/55">
                One-tap texts relay and tour drivers can send to a guest.
              </p>
              {/* 照 preview：司机那边看到的样子（只列开着的）。 */}
              <div
                data-driver-preview
                className="mb-4 flex flex-wrap items-center gap-2.5 rounded-[10px] bg-[#0b1724] px-3 py-2.5"
              >
                <small className="text-[11px] font-bold tracking-[.08em] text-[#94a3b8] uppercase">
                  What the driver sees
                </small>
                {replies.filter((r) => r.active).length ? (
                  replies
                    .filter((r) => r.active)
                    .map((r) => (
                      <span
                        key={r.id}
                        className="rounded-[10px] bg-[#2563eb] px-3 py-2 text-[13px] font-bold text-white"
                      >
                        {r.body}
                      </span>
                    ))
                ) : (
                  <span className="text-[12px] text-[#94a3b8]">
                    {view.kind === "loading"
                      ? "Loading…"
                      : "No replies are switched on."}
                  </span>
                )}
              </div>

              {actionError ? (
                <p role="alert" className={cn(resultClass("error"), "mb-2")}>
                  {actionError}
                </p>
              ) : null}

              <ul className="overflow-hidden rounded-[10px] border-[0.5px] border-black/10 night:border-white/10">
                {view.kind === "loading" ? (
                  <li className="px-3 py-3 text-[12px]">Loading…</li>
                ) : replies.length === 0 ? (
                  <li className="px-3 py-3 text-[12px]">
                    No quick replies yet. Add the first one below.
                  </li>
                ) : (
                  replies.map((r, i) => (
                    <ReplyRow
                      key={r.id}
                      reply={r}
                      first={i === 0}
                      last={i === replies.length - 1}
                      busy={busyId !== null}
                      saving={busyId === r.id}
                      editing={editing?.id === r.id ? editing : null}
                      onUp={() => void move(i, -1)}
                      onDown={() => void move(i, 1)}
                      onToggle={() => void toggle(r)}
                      onEdit={() =>
                        setEditing({ id: r.id, text: r.body, error: null })
                      }
                      onEditText={(text) =>
                        setEditing((e) => (e ? { ...e, text, error: null } : e))
                      }
                      onSave={() => void saveEdit()}
                      onCancel={() => setEditing(null)}
                      onDelete={() => setDeleting(r)}
                    />
                  ))
                )}
              </ul>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void addReply();
                }}
                className="mt-4 flex flex-wrap items-center gap-2.5"
              >
                <input
                  id="new-quick-reply"
                  aria-label="New reply"
                  value={draft}
                  placeholder={`New reply, up to ${QUICK_REPLY_MAX} characters`}
                  autoComplete="off"
                  disabled={adding || view.kind !== "ready"}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setAddNote(null);
                  }}
                  className={cn(FORM_INPUT_CLASS, "min-w-[200px] flex-1")}
                />
                <Counter text={draft} />
                <button
                  type="submit"
                  disabled={adding || view.kind !== "ready" || !draft.trim()}
                  className={cn(SUBMIT_CLASS, "h-9 px-5 text-[13px]")}
                >
                  {adding ? "Adding…" : "Add reply"}
                </button>
              </form>
              {addNote ? (
                <p
                  role={addNote.tone === "error" ? "alert" : "status"}
                  className={cn(resultClass(addNote.tone), "mt-2")}
                >
                  {addNote.text}
                </p>
              ) : null}
            </div>
          </section>

          {view.kind === "ready" ? (
            <ActionLogPanel
              refreshKey={logVersion}
              onUnauthorized={redirectToLogin}
              // G203 第四批：后端共用读接口（admin），what = Reply / Position / Shown to drivers；旧的 /log 不再用。
              load={(before, signal) =>
                fetchActionLog(
                  "/api/driver-quick-replies/action-log",
                  before,
                  signal,
                )
              }
            />
          ) : null}
        </>
      )}

      {deleting ? (
        <ConfirmDialog
          title="Delete this quick reply?"
          confirmLabel="Delete"
          busyLabel="Deleting…"
          danger
          onConfirm={() => doDelete(deleting)}
          onClose={() => setDeleting(null)}
        >
          <p>“{deleting.body}”</p>
          <p>
            Drivers will no longer see it. To hide it for now and keep it for
            later, switch it off instead.
          </p>
        </ConfirmDialog>
      ) : null}
    </main>
  );
}

/** x / 80：超了红字。 */
function Counter({ text }: { text: string }) {
  const n = charCount(text);
  return (
    <span
      data-counter
      className={cn(
        "text-[11.5px] whitespace-nowrap tabular-nums",
        n > QUICK_REPLY_MAX
          ? "font-semibold text-[#A32D2D] night:text-red-300"
          : "text-[#1a1a1a] night:text-white/55",
      )}
    >
      {n} / {QUICK_REPLY_MAX}
    </span>
  );
}

function ReplyRow({
  reply: r,
  first,
  last,
  busy,
  saving,
  editing,
  onUp,
  onDown,
  onToggle,
  onEdit,
  onEditText,
  onSave,
  onCancel,
  onDelete,
}: {
  reply: QuickReply;
  first: boolean;
  last: boolean;
  /** 有一处正在存：别的键先不能按（一次一件）。 */
  busy: boolean;
  saving: boolean;
  editing: { text: string; error: string | null } | null;
  onUp: () => void;
  onDown: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onEditText: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      data-reply-id={r.id}
      data-off={r.active ? undefined : ""}
      className="border-b-[0.5px] border-black/[.08] bg-paper px-3 py-2.5 last:border-b-0 night:border-white/10 night:bg-white/[.03]"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex gap-1">
          <button
            type="button"
            aria-label={`Move “${r.body}” up`}
            disabled={first || busy}
            onClick={onUp}
            className={BTN_EDIT_CLASS}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move “${r.body}” down`}
            disabled={last || busy}
            onClick={onDown}
            className={BTN_EDIT_CLASS}
          >
            ↓
          </button>
        </span>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSave();
            }}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          >
            <input
              id={`quick-reply-${r.id}`}
              aria-label="Reply text"
              value={editing.text}
              autoFocus
              disabled={saving}
              onChange={(e) => onEditText(e.target.value)}
              className={cn(INLINE_INPUT_CLASS, "min-w-[180px] flex-1")}
            />
            <Counter text={editing.text} />
            <button
              type="submit"
              disabled={saving || !editing.text.trim()}
              className={cn(SUBMIT_CLASS, "h-[26px] px-3 text-[11px]")}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onCancel}
              className={BTN_EDIT_CLASS}
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <span
              className={cn(
                "min-w-0 flex-1 text-[13px] font-semibold [overflow-wrap:anywhere]",
                r.active
                  ? "text-[#1a1a1a] night:text-white/90"
                  : "text-[#9a9a95] night:text-white/35",
              )}
            >
              {r.body}
              {r.active ? null : (
                <span className="ml-2 text-[11px] font-normal">
                  Off — drivers don&apos;t see it
                </span>
              )}
            </span>
            <span className="text-[11.5px] whitespace-nowrap text-[#1a1a1a] tabular-nums night:text-white/55">
              {charCount(r.body)} / {QUICK_REPLY_MAX}
            </span>
            {/* 开 / 关：绿 / 灰的开关（不用蓝色，同 preview）。 */}
            <button
              type="button"
              role="switch"
              aria-checked={r.active}
              aria-label={`Show “${r.body}” to drivers`}
              disabled={busy}
              onClick={onToggle}
              className={cn(
                "relative h-[22px] w-[38px] flex-none cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                r.active ? "bg-[#16a34a]" : "bg-[#cbd5e1] night:bg-white/20",
              )}
            >
              <span
                className={cn(
                  "absolute top-[3px] h-4 w-4 rounded-full bg-white transition-[left]",
                  r.active ? "left-[19px]" : "left-[3px]",
                )}
              />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onEdit}
              className={BTN_EDIT_CLASS}
            >
              Edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className={BTN_DELETE_CLASS}
            >
              Delete
            </button>
          </>
        )}
      </div>
      {editing?.error ? (
        <p role="alert" className={cn(resultClass("error"), "mt-1.5")}>
          {editing.error}
        </p>
      ) : null}
    </li>
  );
}
