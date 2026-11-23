"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import {
  BTN_DELETE_CLASS,
  BTN_EDIT_CLASS,
  FORM_INPUT_CLASS,
  INLINE_INPUT_CLASS,
  resultClass,
} from "@/components/pickup-locations/legacy-ui";
import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { usePhoneInfo } from "@/components/ui/phone";
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
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import type { QuickReply } from "@/types";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; replies: QuickReply[] };

type Note = { tone: "ok" | "error"; text: string } | null;

/** 提交键（Save / Add reply / Save order）：蓝色只给提交（Annie 2026-10-11）。 */
const SUBMIT_CLASS =
  "inline-flex cursor-pointer items-center justify-center rounded-[7px] border-none bg-[#3b82f6] font-semibold whitespace-nowrap text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:bg-[#aaa]";

const charCount = (text: string) => [...text.trim()].length;

/** 切走这个标签 / 离开页面时问的话（排序或 Bus map 暂存着没存）。 */
export const QUICK_REPLIES_UNSAVED =
  "You have quick reply changes you haven't saved (order or Bus map). Leave without saving them?";

/** 这个标签的 How to use（G349 Bus map 三句照 Annie 批的原文；排序那句照 preview 改成拖 + Save order）。 */
export const QUICK_REPLIES_HOW_TO = [
  "These are the one-tap texts relay and tour drivers can send to a guest. Drivers can only send these, not their own words.",
  "Drag ⠿ to change the order drivers see them in, then press Save order. Cancel puts the order back. On a keyboard, focus ⠿ and use the ↑ ↓ keys.",
  "Switch a reply off to hide it from drivers without deleting it. Drivers see changes the next time they open Messages.",
  `Up to ${QUICK_REPLY_MAX} characters, plain text only: no emoji and no { }. Each reply must be different.`,
  'Tick "Bus map" on a reply to add a link to the bus\'s location at the end of that text.',
  "The guest can open the link for 90 minutes after the driver sends it.",
  'Only the "can\'t find you" reply needs it. Untick it to stop adding the link.',
  "Only admins can add, edit, switch, move or delete replies. The Action Log above lists every change.",
  "This used to be its own page, Settings › Driver Quick Replies. The old link now opens this tab.",
];

/** 拖完的顺序（id 列表）套到当前列表上：新加的接在最后，删掉的去掉。 */
function inOrder(replies: QuickReply[], order: number[] | null): QuickReply[] {
  if (!order) return replies;
  const byId = new Map(replies.map((r) => [r.id, r]));
  const out = order
    .map((id) => byId.get(id))
    .filter((r): r is QuickReply => !!r);
  for (const r of replies) if (!order.includes(r.id)) out.push(r);
  return out;
}

/**
 * Content Studio › Team Messages › Driver Quick Replies（7c–e，Annie 2026-11-20「7c「A」7d「A」7e「A」| 动手」，
 * preview https://claude.ai/artifact/Q5XYrpnniHcacr6pskveXP ）：原来 Settings › Driver Quick Replies 单独一页（G98）搬进来当一个标签，
 * 旧网址跳到这里（7c A）。接口不变（/api/driver-quick-replies，全部 require_admin）。
 * - 排序（7d A）：拖 ⠿（鼠标、手机手指、键盘 ↑↓ 都行）先暂存，行变淡黄，上面黄条「Order changed — not saved」+ 蓝色 Save order / Cancel；
 *   按了才 PUT /order。没存的顺序离开页面 / 切标签要问。
 * - 加一句（蓝色 Add reply）、改一句（行内蓝色 Save）、开关、删除（先问）：点了就是结果，照旧马上存（同旧页面、同 preview）。
 * - Bus map（G349「BAA」）：勾先暂存，那一行的蓝色 Save 才存（同旧页面）。
 * - Action Log（7e A）：放在这个标签下面，读 /api/driver-quick-replies/action-log。
 */
export function QuickRepliesPanel({
  onDirtyChange,
  onUnauthorized,
}: {
  /** 有没存的排序 / Bus map（Content Studio 切标签、回模块网格时用来问）。 */
  onDirtyChange?: (dirty: boolean) => void;
  onUnauthorized: () => void;
}) {
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
  /** Bus map 勾刚存好的那一行（绿字 Saved，3 秒后消失）。 */
  const [busMapSaved, setBusMapSaved] = useState<number | null>(null);
  /** Bus map 勾先暂存在页面上（reply id → 要存的值），按那一行的 Save 才存（Annie 2026-11-19「BAA」「动手」）。 */
  const [busMapStaged, setBusMapStaged] = useState<
    ReadonlyMap<number, boolean>
  >(new Map());
  /** Bus map 存失败的那一行和后端原话（红字在那一行下面，暂存留着）。 */
  const [busMapError, setBusMapError] = useState<{
    id: number;
    text: string;
  } | null>(null);
  /** 拖过还没存的顺序（id 列表）；null = 没动。 */
  const [order, setOrder] = useState<number[] | null>(null);
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderNote, setOrderNote] = useState<Note>(null);
  /** 正在拖的那一句。 */
  const [dragId, setDragId] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const info = usePhoneInfo("About Driver Quick Replies");
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = busMapStaged.size > 0 || order !== null;
  useLeaveGuard(dirty, QUICK_REPLIES_UNSAVED);
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyRef.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => onDirtyRef.current?.(false), []);

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    },
    [],
  );

  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;
  const redirectToLogin = useCallback(() => unauthorizedRef.current(), []);

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
  const shown = inOrder(replies, order);
  const savedIndex = new Map(replies.map((r, i) => [r.id, i]));

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

  /**
   * Bus map 勾（G349，Annie 2026-11-19「bus map那个BAA」「我们现在的网站上全都都用先选后存的模式来设计了」「动手」）：
   * 点勾只暂存在页面上（再点回原样 = 撤掉），那一行出蓝色 Save + 「Not saved yet」，按了才 PATCH。
   */
  function stageBusMap(reply: QuickReply) {
    const current = busMapStaged.get(reply.id) ?? !!reply.add_bus_map;
    const next = !current;
    setBusMapStaged((m) => {
      const copy = new Map(m);
      if (next === !!reply.add_bus_map) copy.delete(reply.id);
      else copy.set(reply.id, next);
      return copy;
    });
    setBusMapSaved(null);
    if (busMapError?.id === reply.id) setBusMapError(null);
  }

  /** 存好绿字 Saved（3 秒）、勾照后端回的 add_bus_map；失败红字照后端原话，暂存留着可再按 Save。 */
  async function saveBusMap(reply: QuickReply) {
    const value = busMapStaged.get(reply.id);
    if (busyId !== null || value === undefined) return;
    setBusyId(reply.id);
    setBusMapError(null);
    setBusMapSaved(null);
    try {
      const saved = await updateQuickReply(reply.id, { add_bus_map: value });
      setReplies(replies.map((r) => (r.id === saved.id ? saved : r)));
      setBusMapStaged((m) => {
        const copy = new Map(m);
        copy.delete(reply.id);
        return copy;
      });
      setBusMapSaved(saved.id);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setBusMapSaved(null), 3000);
    } catch (error) {
      const text = failText(error);
      if (text)
        setBusMapError({
          id: reply.id,
          text: `Could not change Bus map for “${reply.body}”: ${text}`,
        });
    } finally {
      setBusyId(null);
    }
  }

  /** 把一句挪到第 to 个位置（to = 拿掉它以后的位置；只暂存）。挪回跟已存的一样 = 没改。 */
  function stageMove(id: number, to: number) {
    const list = shown.map((r) => r.id);
    const from = list.indexOf(id);
    if (from < 0 || to < 0 || to >= list.length || from === to) return;
    list.splice(from, 1);
    list.splice(to, 0, id);
    const same = list.every((x, i) => replies[i]?.id === x);
    setOrder(same ? null : list);
    setOrderNote(null);
  }

  /** 拖的时候：别的行里，中线在指针上面的有几行，就放到第几个位置。 */
  function dragOver(clientY: number) {
    if (dragId === null || !listRef.current) return;
    const others = [
      ...listRef.current.querySelectorAll<HTMLElement>("[data-reply-id]"),
    ].filter((el) => el.dataset.replyId !== String(dragId));
    const to = others.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2 < clientY;
    }).length;
    stageMove(dragId, to);
  }

  async function saveOrder() {
    if (!order || orderSaving) return;
    setOrderSaving(true);
    setOrderNote(null);
    try {
      const next = await reorderQuickReplies(shown.map((r) => r.id));
      setReplies(next);
      setOrder(null);
      setOrderNote({ tone: "ok", text: "Saved" });
    } catch (error) {
      const text = failText(error);
      if (text)
        setOrderNote({
          tone: "error",
          text: `Order not saved: ${text}${isStatus(error, 400) ? " Refresh the page to get the latest list." : ""}`,
        });
    } finally {
      setOrderSaving(false);
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
    setOrder((o) => (o ? o.filter((id) => id !== reply.id) : o));
    if (editing?.id === reply.id) setEditing(null);
    setBusMapStaged((m) => {
      if (!m.has(reply.id)) return m;
      const copy = new Map(m);
      copy.delete(reply.id);
      return copy;
    });
    setDeleting(null);
    return { status: "ok" };
  }

  if (view.kind === "forbidden")
    return (
      <div data-quick-replies>
        <Panel>
          <p className="font-medium text-stone-800 night:text-white/90">
            Admin access required
          </p>
          <p className="mt-1">
            Only admins can change the driver quick replies.
          </p>
        </Panel>
      </div>
    );
  if (view.kind === "error")
    return (
      <div data-quick-replies>
        <ErrorBanner
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Could not load the quick replies: {view.message}
        </ErrorBanner>
      </div>
    );

  const onCount = replies.filter((r) => r.active).length;
  return (
    <div data-quick-replies>
      {/* 手机规则：说明收进「i」，数字照样露着。 */}
      <p className="mb-3 text-[12px] text-[#cbd5e1] night:text-white/65">
        <span data-quick-replies-hint className={info.hide}>
          One-tap texts relay and tour drivers can send to a guest. Drivers can
          only send these, not their own words. Up to {QUICK_REPLY_MAX}{" "}
          characters, plain characters only.
        </span>
        {view.kind === "ready" ? (
          <span
            data-quick-reply-count
            className="ml-1.5 text-[#94a3b8] max-sm:ml-0"
          >
            {replies.length} replies · {onCount} on
          </span>
        ) : null}
        {info.button}
      </p>
      {/* 司机那边看到的样子（只列开着的，照已存的顺序——没存的顺序司机还看不到）。 */}
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

      {/* 7d A：拖过没存 ⇒ 黄条 + 蓝色 Save order；存好绿字 Saved；失败红字后端原话。 */}
      {order ? (
        <div
          data-order-bar
          className="mb-2.5 flex flex-wrap items-center gap-2.5 rounded-[8px] border border-[#fcd34d] bg-[#fffbeb] px-3 py-2 text-[12.5px] text-[#78350f]"
        >
          <b>Order changed — not saved.</b>
          <span className="flex-1" />
          <button
            type="button"
            data-order-cancel
            disabled={orderSaving}
            onClick={() => {
              setOrder(null);
              setOrderNote(null);
            }}
            className={BTN_EDIT_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            data-order-save
            disabled={orderSaving}
            onClick={() => void saveOrder()}
            className={cn(SUBMIT_CLASS, "h-[28px] px-3.5 text-[12px]")}
          >
            {orderSaving ? "Saving…" : "Save order"}
          </button>
        </div>
      ) : null}
      {orderNote ? (
        <p
          data-order-note
          role={orderNote.tone === "error" ? "alert" : "status"}
          className={cn(resultClass(orderNote.tone), "mb-2")}
        >
          {orderNote.text}
        </p>
      ) : null}

      <ul
        ref={listRef}
        data-quick-reply-list
        className="overflow-hidden rounded-[10px] border-[0.5px] border-black/10 night:border-white/10"
      >
        {view.kind === "loading" ? (
          <li className="bg-paper px-3 py-3 text-[12px] text-[#1a1a1a]">
            Loading…
          </li>
        ) : shown.length === 0 ? (
          <li className="bg-paper px-3 py-3 text-[12px] text-[#1a1a1a]">
            No quick replies yet. Add the first one below.
          </li>
        ) : (
          shown.map((r, i) => (
            <ReplyRow
              key={r.id}
              reply={r}
              moved={order !== null && savedIndex.get(r.id) !== i}
              dragging={dragId === r.id}
              busy={busyId !== null || orderSaving}
              saving={busyId === r.id}
              editing={editing?.id === r.id ? editing : null}
              onDragStart={() => setDragId(r.id)}
              onDragMove={dragOver}
              onDragEnd={() => setDragId(null)}
              onKeyMove={(by) => stageMove(r.id, i + by)}
              onToggle={() => void toggle(r)}
              busMapSaved={busMapSaved === r.id}
              busMapStaged={busMapStaged.get(r.id)}
              busMapError={busMapError?.id === r.id ? busMapError.text : null}
              onBusMap={() => stageBusMap(r)}
              onBusMapSave={() => void saveBusMap(r)}
              onEdit={() => setEditing({ id: r.id, text: r.body, error: null })}
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
        <Counter text={draft} dark />
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

      {/* 7e A：这个标签自己的 Action Log（谁加 / 改 / 开关 / 排序 / 删了哪句）。 */}
      {view.kind === "ready" ? (
        <div className="mt-5" data-quick-replies-log>
          <h3 className="mb-1.5 text-[10px] font-bold tracking-[.07em] text-[#9B8F88] uppercase">
            Action Log — Driver Quick Replies
          </h3>
          <ActionLogPanel
            refreshKey={logVersion}
            onUnauthorized={redirectToLogin}
            // G203 第四批：后端共用读接口（admin），what = Reply / Position / Shown to drivers / Bus map。
            load={(before, signal) =>
              fetchActionLog(
                "/api/driver-quick-replies/action-log",
                before,
                signal,
              )
            }
          />
        </div>
      ) : null}
      <div data-quick-replies-howto>
        <HowToUse
          title="How to use — Driver Quick Replies"
          items={QUICK_REPLIES_HOW_TO}
        />
      </div>

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
    </div>
  );
}

/** x / 80：超了红字。dark = 放在 Content Studio 深色编辑区里（不在白行里）。 */
function Counter({ text, dark = false }: { text: string; dark?: boolean }) {
  const n = charCount(text);
  return (
    <span
      data-counter
      className={cn(
        "text-[11.5px] whitespace-nowrap tabular-nums",
        n > QUICK_REPLY_MAX
          ? dark
            ? "font-semibold text-[#fca5a5]"
            : "font-semibold text-[#A32D2D] night:text-red-300"
          : dark
            ? "text-[#cbd5e1] night:text-white/55"
            : "text-[#1a1a1a] night:text-white/55",
      )}
    >
      {n} / {QUICK_REPLY_MAX}
    </span>
  );
}

function ReplyRow({
  reply: r,
  moved,
  dragging,
  busy,
  saving,
  editing,
  onDragStart,
  onDragMove,
  onDragEnd,
  onKeyMove,
  onToggle,
  busMapSaved,
  busMapStaged,
  busMapError,
  onBusMap,
  onBusMapSave,
  onEdit,
  onEditText,
  onSave,
  onCancel,
  onDelete,
}: {
  reply: QuickReply;
  /** 拖过、跟已存的位置不一样（淡黄）。 */
  moved: boolean;
  dragging: boolean;
  /** 有一处正在存：别的键先不能按（一次一件）。 */
  busy: boolean;
  saving: boolean;
  editing: { text: string; error: string | null } | null;
  onDragStart: () => void;
  onDragMove: (clientY: number) => void;
  onDragEnd: () => void;
  onKeyMove: (by: -1 | 1) => void;
  onToggle: () => void;
  /** Bus map 勾刚存好（绿字 Saved）。 */
  busMapSaved: boolean;
  /** 暂存的值；undefined = 没改。 */
  busMapStaged: boolean | undefined;
  /** 这一行 Bus map 存失败的红字。 */
  busMapError: string | null;
  onBusMap: () => void;
  onBusMapSave: () => void;
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
      data-moved={moved || undefined}
      className={cn(
        "border-b-[0.5px] border-black/[.08] px-3 py-2.5 last:border-b-0 night:border-white/10",
        dragging
          ? "relative z-[1] bg-[#eff6ff] shadow-[0_6px_18px_rgba(0,0,0,.25)] night:bg-sky-400/10"
          : moved
            ? "bg-[#fffbeb] night:bg-amber-400/10"
            : "bg-paper night:bg-white/[.03]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        {/* 7d A：拖动柄。pointer 事件（鼠标、手指一样），拖的时候抓住指针；键盘上 ↑↓ 挪一格。都只暂存。 */}
        <button
          type="button"
          data-drag-handle={r.id}
          aria-label={`Move “${r.body}”: drag, or use the up and down arrow keys`}
          title="Drag to change the order"
          disabled={busy}
          onPointerDown={(e) => {
            if (busy || e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            onDragStart();
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              onDragMove(e.clientY);
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            onDragEnd();
          }}
          onPointerCancel={onDragEnd}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              onKeyMove(e.key === "ArrowUp" ? -1 : 1);
            }
          }}
          className="flex h-[26px] w-[22px] flex-none cursor-grab touch-none items-center justify-center rounded-[5px] text-[16px] leading-none text-[#a8a29e] select-none hover:bg-black/5 hover:text-[#57534e] focus-visible:outline-2 focus-visible:outline-[#3b82f6] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
        >
          ⠿
        </button>
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
                // 手机上文字占满 ⠿ 后面的第一行，字数 / Bus map / 开关 / Edit / Delete 换到下一行（不然字被挤成一个字母一行）。
                "min-w-0 flex-1 text-[13px] font-semibold [overflow-wrap:anywhere] max-sm:basis-[calc(100%-34px)]",
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
            {/* G349 Bus map：字数后、开关前；绿勾（同开关的绿，不用蓝）；先选后存，改了出 Save。 */}
            <label
              data-bus-map={r.id}
              className={cn(
                "inline-flex items-center gap-[5px] text-[12px] whitespace-nowrap text-[#1a1a1a] night:text-white/80",
                busy ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              )}
            >
              <input
                type="checkbox"
                id={`bus-map-${r.id}`}
                checked={busMapStaged ?? !!r.add_bus_map}
                disabled={busy}
                onChange={onBusMap}
                aria-label={`Bus map link on “${r.body}”`}
                className="m-0 size-[15px] accent-[#16a34a]"
              />
              Bus map
            </label>
            {busMapStaged !== undefined ? (
              <>
                <button
                  type="button"
                  data-bus-map-save={r.id}
                  disabled={busy}
                  onClick={onBusMapSave}
                  className={cn(SUBMIT_CLASS, "h-[26px] px-3 text-[11px]")}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <span
                  data-bus-map-unsaved
                  className="text-[11px] text-[#6b6b66] night:text-white/55"
                >
                  Not saved yet
                </span>
              </>
            ) : null}
            {busMapSaved ? (
              <span
                data-bus-map-saved
                role="status"
                className="text-[11.5px] font-semibold text-[#15803d] night:text-emerald-300"
              >
                Saved
              </span>
            ) : null}
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
      {busMapError ? (
        <p role="alert" className={cn(resultClass("error"), "mt-1.5")}>
          {busMapError}
        </p>
      ) : null}
      {editing?.error ? (
        <p role="alert" className={cn(resultClass("error"), "mt-1.5")}>
          {editing.error}
        </p>
      ) : null}
    </li>
  );
}
