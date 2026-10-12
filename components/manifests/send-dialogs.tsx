"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  broadcastManifest,
  sendManifestTickets,
  sendManifestTour,
} from "@/lib/manifests-api";
import { chunk, SEND_BATCH_SIZE } from "@/lib/send-batches";
import { describeSmsLength, SMS_MAX } from "@/lib/sms-limit";
import { fetchTourTypes } from "@/lib/tour-send-api";
import { cn } from "@/lib/utils";
import type {
  ManifestBroadcastResult,
  ManifestRow,
  ManifestListSection,
  ManifestSendSkipped,
  ManifestSendTicketsResult,
  ManifestSendTourResult,
  TourTypeOption,
} from "@/types";

import { formatLaDateTime, plural, sentAt } from "./config";

/**
 * Manifests 页勾选客人后的三个发送弹窗（后端 main-manifest-sections ②③，Annie 2026-10-09 定，样稿第 3 版）：
 * Send message（自定义消息，记进 Broadcasting Log）、Send tour confirmation（巴士团确认，每节手选 tour type）、
 * Send reminder（门票提醒，用 staff 的 Cfm #）。⚠️ 都是真实发送。
 *
 * 发确认 / 提醒和发送页一样分小批（每批 10 位）依次发：一次发太多会超过线上 Cloudflare 的约 100 秒，
 * 浏览器报错时后端还在发，staff 以为失败再点一次就会重复发给客人。某一批出错就停，写明哪些「可能已发」。
 * 自定义消息是一次请求（一次发送记一条 Broadcasting Log，同 Tracking 页的群发）。
 */

/** 后端 BROADCAST_MAX_CHARS。 */
const MESSAGE_MAX = 2000;
const DEFAULT_MESSAGE =
  "Hi {first_name}, this is National Park Express about your tour on {tour_date}. ";

// night: = 全深色主题（lib/theme.ts），平时不生效。
const NOTE_BOX =
  "rounded-md bg-[#fbefd9] px-2.5 py-2 text-[12.5px] leading-[1.5] text-stone-800 night:bg-amber-400/10 night:text-amber-100";
const OK_BOX =
  "rounded-md bg-[#e1f1e8] px-2.5 py-2 text-[13px] text-stone-800 night:bg-emerald-400/10 night:text-emerald-100";
const ERR_BOX =
  "rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-[12.5px] text-red-800 night:border-red-500/30 night:bg-red-500/10 night:text-red-200";

function distinctOrders(rows: readonly ManifestRow[]): string[] {
  return [...new Set(rows.map((r) => r.order_number))];
}

/** 发送中关页面 / 刷新先问（同发送页）。 */
function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}

function DialogFrame({
  titleId,
  title,
  busy,
  onClose,
  footer,
  children,
}: {
  titleId: string;
  title: ReactNode;
  busy: boolean;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      panelClassName="flex max-h-[90vh] max-w-[640px] flex-col overflow-hidden"
      night
    >
      <div className="border-b border-stone-200 night:border-white/10 px-5 py-3.5">
        <h2 id={titleId} className="text-base font-semibold text-stone-900 night:text-white">
          {title}
        </h2>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4 text-[13px] text-stone-700 night:text-white/80">
        {children}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 night:border-white/10 px-5 py-3">
        {footer}
      </div>
    </Modal>
  );
}

// ── Send message ─────────────────────────────────────────────────────────────

type MessagePhase =
  | { kind: "edit"; error: string | null }
  | { kind: "review" }
  | { kind: "sending" }
  | { kind: "done"; result: ManifestBroadcastResult }
  | { kind: "failed"; message: string; maybeSent: boolean };

export function MessageDialog({
  date,
  rows: rowsProp,
  onClose,
  onSent,
  onUnauthorized,
}: {
  date: string;
  rows: ManifestRow[];
  onClose: () => void;
  /** 发出去了（不论成败多少）：页面重拉、清掉勾选。 */
  onSent: () => void;
  onUnauthorized: () => void;
}) {
  // 打开时拍一份：发完页面会重拉、清掉勾选，弹窗里的名单不能跟着变。
  const [rows] = useState(rowsProp);
  const [text, setText] = useState(DEFAULT_MESSAGE);
  const [sms, setSms] = useState(true);
  const [email, setEmail] = useState(true);
  const [phase, setPhase] = useState<MessagePhase>({
    kind: "edit",
    error: null,
  });
  const guests = distinctOrders(rows).length;
  const busy = phase.kind === "sending";
  useLeaveGuard(busy);
  const channelText = [sms ? "SMS" : "", email ? "Email" : ""]
    .filter(Boolean)
    .join(" + ");
  const length = describeSmsLength(text.trim());

  function review() {
    const body = text.trim();
    let error: string | null = null;
    if (!body) error = "Please enter a message.";
    else if (!sms && !email) error = "Choose SMS, Email or both.";
    else if (body.length > MESSAGE_MAX)
      error = `The message is too long (${body.length.toLocaleString("en-US")} / ${MESSAGE_MAX.toLocaleString("en-US")} characters).`;
    else if (sms && body.length > SMS_MAX)
      error = `This message is too long for SMS (${body.length.toLocaleString("en-US")} / ${SMS_MAX.toLocaleString("en-US")} characters). Shorten it, or untick SMS.`;
    setPhase(error ? { kind: "edit", error } : { kind: "review" });
  }

  async function send() {
    setPhase({ kind: "sending" });
    try {
      const result = await broadcastManifest({
        date,
        row_keys: rows.map((r) => r.row_key),
        message: text.trim(),
        send_sms: sms,
        send_email: email,
      });
      setPhase({ kind: "done", result });
      onSent();
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      // 400：后端在发第一条之前整批拒了，确定没发（例如有人刚被取消，要 Reload）。
      const rejected = isStatus(error, 400);
      setPhase({
        kind: "failed",
        message:
          error instanceof TypeError
            ? "Could not reach the server."
            : describeError(error),
        maybeSent: !rejected,
      });
      if (!rejected) onSent();
    }
  }

  const titleId = "manifest-message-title";
  if (phase.kind === "done" || phase.kind === "failed") {
    return (
      <DialogFrame
        titleId={titleId}
        title={phase.kind === "done" ? "Sent" : "Not sent"}
        busy={false}
        onClose={onClose}
        footer={
          <button
            type="button"
            onClick={onClose}
            className={PRIMARY_BUTTON_CLASS}
          >
            Done
          </button>
        }
      >
        {phase.kind === "done" ? (
          <>
            <div role="status" className={OK_BOX}>
              {plural(phase.result.recipient_count, "guest")} · {channelText}.
              Saved in Broadcasting Log.
            </div>
            {phase.result.results.map((r) => (
              <p key={r.module}>
                {r.module === "tour" ? "Bus Tour" : "Tickets"}:{" "}
                {sms ? `SMS ${r.sms_sent} sent, ${r.sms_failed} failed` : ""}
                {sms && email ? " · " : ""}
                {email
                  ? `Email ${r.email_sent} sent, ${r.email_failed} failed`
                  : ""}
              </p>
            ))}
            <p className="text-stone-500 night:text-white/50">
              Replies show up in Tracking like any other guest reply.
            </p>
          </>
        ) : (
          <div role="alert" className={ERR_BOX}>
            {phase.maybeSent ? (
              <>
                <p className="font-semibold">
                  ⛔ Do not send again. Some or all messages may already have
                  gone out.
                </p>
                <p>
                  Check Broadcasting Log to see what was sent. ({phase.message})
                </p>
              </>
            ) : (
              <p>Nothing was sent: {phase.message}</p>
            )}
          </div>
        )}
      </DialogFrame>
    );
  }

  if (phase.kind === "review" || phase.kind === "sending") {
    return (
      <DialogFrame
        titleId={titleId}
        title={`Send this to ${plural(guests, "guest")}?`}
        busy={busy}
        onClose={onClose}
        footer={
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPhase({ kind: "edit", error: null })}
              className={SECONDARY_BUTTON_CLASS}
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send()}
              className={PRIMARY_BUTTON_CLASS}
            >
              {busy ? "Sending…" : "Yes, send now"}
            </button>
          </>
        }
      >
        <p>Channel: {channelText}</p>
        <div className={cn(OK_BOX, "whitespace-pre-wrap")}>{text.trim()}</div>
        <p className="text-stone-500 night:text-white/50">
          Messages go out to real guests and cannot be recalled.
        </p>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame
      titleId={titleId}
      title="Send message"
      busy={false}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={review}
            className={PRIMARY_BUTTON_CLASS}
          >
            Review
          </button>
        </>
      }
    >
      <p>
        {plural(guests, "guest")} (one message per order). Use {"{first_name}"}{" "}
        and {"{tour_date}"} to fill in each guest&rsquo;s details. This is
        logged in Broadcasting Log.
      </p>
      <textarea
        aria-label="Message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-[110px] w-full resize-y rounded-md border border-stone-300 night:border-white/15 night:bg-white/[.06] night:[color-scheme:dark] px-2 py-1.5 font-[inherit] text-[13px] text-stone-900 night:text-white"
      />
      {sms && text.trim() ? (
        <p
          className={cn(
            "text-[11px]",
            length.over ? "font-semibold text-red-700 night:text-red-300" : "text-stone-500 night:text-white/50",
          )}
        >
          {length.text}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3.5">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={sms}
            onChange={(e) => setSms(e.target.checked)}
          />{" "}
          SMS
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={email}
            onChange={(e) => setEmail(e.target.checked)}
          />{" "}
          Email
        </label>
      </div>
      {phase.error ? (
        <p role="alert" className={ERR_BOX}>
          {phase.error}
        </p>
      ) : null}
    </DialogFrame>
  );
}

// ── 确认 / 提醒共用：分批发、出错就停、Send anyway ─────────────────────────────

/** 一批：几位客人（行）+ 怎么发。 */
interface Batch<R> {
  rows: ManifestRow[];
  run: (anyway: { send_anyway?: string[]; preview_at?: string }) => Promise<R>;
}

interface Stop {
  reason: string;
  /** 断线 / 5xx：这一批发没发不知道。400：整批被拒，确定没发。 */
  maybeSent: boolean;
  uncertain: string[];
  notAttempted: string[];
}

/** 一行的发送结果，统一成表格里的样子。 */
interface Outcome {
  order: string;
  name: string;
  first: string;
  second: string;
  failed: boolean;
}

interface RunState {
  done: number;
  total: number;
  sent: number;
  outcomes: Outcome[];
  skipped: ManifestSendSkipped[];
  stop: Stop | null;
  /** 第一批的 checked_at：Send anyway 只重发这次之前发过的（不会把这次刚发的再发一遍）。 */
  checkedAt: string;
}

async function runBatches<R extends { checked_at: string }>(
  batches: Batch<R>[],
  anyway: { send_anyway?: string[]; preview_at?: string },
  read: (r: R) => {
    sent: number;
    outcomes: Outcome[];
    skipped: ManifestSendSkipped[];
  },
  onProgress: (s: RunState) => void,
  isAlive: () => boolean,
  onUnauthorized: () => void,
): Promise<RunState> {
  const state: RunState = {
    done: 0,
    total: batches.reduce((n, b) => n + b.rows.length, 0),
    sent: 0,
    outcomes: [],
    skipped: [],
    stop: null,
    checkedAt: "",
  };
  for (let i = 0; i < batches.length; i++) {
    // 弹窗已经关了 / 离开了页面：剩下的不发（没人看得到结果）。
    if (!isAlive()) break;
    const batch = batches[i];
    try {
      const res = await batch.run(anyway);
      if (typeof res?.checked_at !== "string")
        throw new Error("The server's reply was not understood.");
      const r = read(res);
      state.checkedAt ||= res.checked_at;
      state.sent += r.sent;
      state.outcomes.push(...r.outcomes);
      state.skipped.push(...r.skipped);
      state.done += batch.rows.length;
      onProgress({ ...state });
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        state.stop = {
          reason: "Your login expired.",
          maybeSent: false,
          uncertain: [],
          notAttempted: batches.slice(i).flatMap((b) => distinctOrders(b.rows)),
        };
        break;
      }
      const rejected = isStatus(error, 400);
      state.stop = {
        reason:
          error instanceof TypeError
            ? "Could not reach the server."
            : describeError(error),
        maybeSent: !rejected,
        uncertain: rejected ? [] : distinctOrders(batch.rows),
        notAttempted: [
          ...(rejected ? distinctOrders(batch.rows) : []),
          ...batches.slice(i + 1).flatMap((b) => distinctOrders(b.rows)),
        ],
      };
      break;
    }
  }
  onProgress({ ...state });
  return state;
}

function StopBox({ stop }: { stop: Stop }) {
  return (
    <div role="alert" className={ERR_BOX}>
      {stop.maybeSent ? (
        <>
          <p className="font-semibold">
            ⛔ Stop. Do not send again. The page lost contact with the server,
            and some messages may already have been sent.
          </p>
          <p>Open the Send Log to see which messages went out.</p>
          <p className="text-[11px]">({stop.reason})</p>
        </>
      ) : (
        <p className="font-semibold">Sending stopped: {stop.reason}</p>
      )}
      {stop.uncertain.length ? (
        <p>
          {plural(stop.uncertain.length, "order")} ({stop.uncertain.join(", ")})
          may or may not have been sent.
        </p>
      ) : null}
      {stop.notAttempted.length ? (
        <p>
          {plural(stop.notAttempted.length, "order")}{" "}
          {stop.notAttempted.length === 1 ? "was" : "were"} not sent:{" "}
          {stop.notAttempted.join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

function OutcomeTable({
  heads,
  outcomes,
}: {
  heads: [string, string];
  outcomes: Outcome[];
}) {
  if (!outcomes.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="text-left text-[11px] text-stone-500 night:text-white/50">
          <tr>
            {["Order #", "Guest", ...heads].map((h) => (
              <th
                key={h}
                className="border-b border-stone-200 night:border-white/10 px-2 py-1 font-medium"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {outcomes.map((o, i) => (
            <tr key={`${o.order}-${i}`} data-outcome={o.order}>
              <td className="border-b border-stone-100 night:border-white/[.06] px-2 py-1 font-mono text-[12px]">
                {o.order}
              </td>
              <td className="border-b border-stone-100 night:border-white/[.06] px-2 py-1">{o.name}</td>
              <td
                className={cn(
                  "border-b border-stone-100 night:border-white/[.06] px-2 py-1",
                  /^failed/i.test(o.first) && "text-red-700 night:text-red-300",
                )}
              >
                {o.first}
              </td>
              <td
                className={cn(
                  "border-b border-stone-100 night:border-white/[.06] px-2 py-1",
                  /^failed/i.test(o.second) && "text-red-700 night:text-red-300",
                )}
              >
                {o.second}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 跳过的「已发过」：勾上的再发一次（同发送页的 Send anyway）。 */
function AnywayPicker({
  skipped,
  picked,
  onPick,
  disabled,
}: {
  skipped: ManifestSendSkipped[];
  picked: string[];
  onPick: (next: string[]) => void;
  disabled: boolean;
}) {
  const already = skipped.filter((s) => s.reason === "already_sent");
  const other = skipped.filter((s) => s.reason !== "already_sent");
  if (!skipped.length) return null;
  return (
    <div className={NOTE_BOX}>
      {already.length ? (
        <>
          <p className="mb-1 font-semibold">
            Already sent, skipped ({already.length}). Tick a guest and click
            Send anyway to send it again:
          </p>
          <div className="flex flex-col gap-1">
            {already.map((s) => {
              const order = s.order_number ?? s.chd_number ?? "";
              return (
                <label key={order} className="inline-flex items-start gap-1.5">
                  <input
                    type="checkbox"
                    data-anyway={order}
                    checked={picked.includes(order)}
                    disabled={disabled}
                    onChange={(e) =>
                      onPick(
                        e.target.checked
                          ? [...picked, order]
                          : picked.filter((o) => o !== order),
                      )
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-mono text-[12px]">{order}</span>{" "}
                    {s.name} — {s.message}
                  </span>
                </label>
              );
            })}
          </div>
        </>
      ) : null}
      {other.length ? (
        <p className={cn(already.length && "mt-2")}>
          Skipped:{" "}
          {other
            .map(
              (s) => `${s.order_number ?? s.chd_number ?? ""} (${s.message})`,
            )
            .join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function Progress({ run }: { run: RunState }) {
  return (
    <p role="status" className="text-stone-600 night:text-white/60">
      Sending… {run.done} of {run.total} done — keep this page open until the
      results appear.
    </p>
  );
}

function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return () => alive.current;
}

// ── Send tour confirmation ───────────────────────────────────────────────────

interface TourGroup {
  key: string;
  title: string;
  rows: ManifestRow[];
}

function tourOutcomes(res: ManifestSendTourResult) {
  return {
    sent: res.sent,
    outcomes: res.groups.flatMap((g) =>
      g.results.map((r) => ({
        order: r.order,
        name: r.name,
        first: r.email_status || "—",
        second: (r.sms_status || "—").replace(/^sent:.*/, "sent"),
        failed:
          /^failed/i.test(r.email_status) || /^failed/i.test(r.sms_status),
      })),
    ),
    skipped: res.groups.flatMap((g) => g.skipped ?? []),
  };
}

export function TourConfirmDialog({
  date,
  rows: rowsProp,
  sections,
  pillLabel,
  onClose,
  onSent,
  onUnauthorized,
}: {
  date: string;
  rows: ManifestRow[];
  sections: ManifestListSection[];
  /** 不分节时整组的名字（胶囊名）。 */
  pillLabel: string;
  onClose: () => void;
  onSent: () => void;
  onUnauthorized: () => void;
}) {
  // 打开时拍一份（同上）。
  const [rows] = useState(rowsProp);
  const [types, setTypes] = useState<TourTypeOption[] | null>(null);
  const [typesError, setTypesError] = useState("");
  /** 每节选的 tour type；"" = Don't send。Annie 2026-10-09 下午定：不预选，staff 手选。 */
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [run, setRun] = useState<RunState | null>(null);
  const [sending, setSending] = useState(false);
  const [anyway, setAnyway] = useState<string[]>([]);
  /** 上一轮按节分好的批，Send anyway 照着同样的 tour type 再发。 */
  const planRef = useRef<{ tourType: string; rows: ManifestRow[] }[]>([]);
  /** 设成 Don't send、没发的人数（点 Send 时记下）。 */
  const [dontSend, setDontSend] = useState(0);
  const isAlive = useAlive();
  useLeaveGuard(sending);

  useEffect(() => {
    const controller = new AbortController();
    fetchTourTypes(controller.signal)
      .then(setTypes)
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 401)) onUnauthorized();
        else setTypesError(describeError(e));
      });
    return () => controller.abort();
  }, [onUnauthorized]);

  const titleOf = new Map(sections.map((s) => [s.key, s.title]));
  const groups: TourGroup[] = [];
  for (const r of rows) {
    const key = sections.length ? (r.section ?? "") : "";
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = {
        key,
        title: (sections.length && titleOf.get(key)) || pillLabel,
        rows: [],
      };
      groups.push(g);
    }
    g.rows.push(r);
  }
  const alreadySent = rows.filter((r) => sentAt(r, "bus"));

  function batchesFor(plan: { tourType: string; rows: ManifestRow[] }[]) {
    return plan.flatMap((p) =>
      chunk(p.rows, SEND_BATCH_SIZE).map((part) => ({
        rows: part,
        run: (extra: { send_anyway?: string[]; preview_at?: string }) =>
          sendManifestTour({
            date,
            groups: [
              { tour_type: p.tourType, row_keys: part.map((r) => r.row_key) },
            ],
            ...extra,
          }),
      })),
    );
  }

  async function go(
    plan: { tourType: string; rows: ManifestRow[] }[],
    extra: { send_anyway?: string[]; preview_at?: string },
  ) {
    setSending(true);
    setError("");
    const result = await runBatches(
      batchesFor(plan),
      extra,
      tourOutcomes,
      setRun,
      isAlive,
      onUnauthorized,
    );
    setSending(false);
    setAnyway([]);
    if (result.done > 0 || result.stop?.maybeSent) onSent();
  }

  function start() {
    const plan = groups
      .filter((g) => picks[g.key])
      .map((g) => ({ tourType: picks[g.key], rows: g.rows }));
    if (!plan.length) {
      setError("Pick a tour type for at least one section.");
      return;
    }
    planRef.current = plan;
    setDontSend(
      groups
        .filter((g) => !picks[g.key])
        .reduce((n, g) => n + g.rows.length, 0),
    );
    void go(plan, {});
  }

  function sendAnyway() {
    if (!run) return;
    const orders = new Set(anyway);
    const plan = planRef.current
      .map((p) => ({
        tourType: p.tourType,
        rows: p.rows.filter((r) => orders.has(r.order_number)),
      }))
      .filter((p) => p.rows.length);
    void go(plan, { send_anyway: [...orders], preview_at: run.checkedAt });
  }

  const titleId = "manifest-tour-title";
  if (run) {
    const failed = run.outcomes.filter((o) => o.failed).length;
    return (
      <DialogFrame
        titleId={titleId}
        title={sending ? "Sending tour confirmations…" : "Sent"}
        busy={sending}
        onClose={onClose}
        footer={
          <>
            {anyway.length ? (
              <button
                type="button"
                disabled={sending}
                onClick={sendAnyway}
                className={SECONDARY_BUTTON_CLASS}
              >
                Send anyway to {plural(anyway.length, "guest")}
              </button>
            ) : null}
            <button
              type="button"
              disabled={sending}
              onClick={onClose}
              className={PRIMARY_BUTTON_CLASS}
            >
              Done
            </button>
          </>
        }
      >
        {sending ? <Progress run={run} /> : null}
        {run.stop ? <StopBox stop={run.stop} /> : null}
        {!sending ? (
          <div role="status" className={OK_BOX}>
            {plural(run.sent, "confirmation")} sent (email + SMS).
            {failed ? ` ${failed} with a failed channel, see below.` : ""}
            {run.skipped.length ? ` ${run.skipped.length} skipped.` : ""}
            {dontSend ? ` ${dontSend} not sent, no tour type.` : ""}
          </div>
        ) : null}
        <AnywayPicker
          skipped={run.skipped}
          picked={anyway}
          onPick={setAnyway}
          disabled={sending}
        />
        <OutcomeTable heads={["Email", "SMS"]} outcomes={run.outcomes} />
        <p className="text-stone-500 night:text-white/50">
          Each guest gets the same confirmation page as from the Tour
          Confirmation page, and the send counts on both pages.
        </p>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame
      titleId={titleId}
      title="Send tour confirmation"
      busy={false}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!types}
            onClick={start}
            className={PRIMARY_BUTTON_CLASS}
          >
            Send
          </button>
        </>
      }
    >
      <p>
        Check the tour type for each section. It sets lunch, the tour name and
        the photo the guest sees. Confirmations go out by email and SMS. MTLV is
        not included; use the Tour Confirmation page for MTLV.
      </p>
      {typesError ? (
        <p role="alert" className={ERR_BOX}>
          Could not load the tour types: {typesError}
        </p>
      ) : null}
      {groups.map((g) => {
        const skip = g.rows.filter((r) => sentAt(r, "bus")).length;
        return (
          <div
            key={g.key}
            data-group={g.title}
            className="grid grid-cols-1 items-center gap-2.5 border-b border-stone-200 night:border-white/10 py-2 sm:grid-cols-[1fr_minmax(0,260px)]"
          >
            <div>
              <b className="text-stone-900 night:text-white">{g.title}</b>
              <small className="block text-stone-500 night:text-white/50">
                {g.rows.length} selected
                {skip ? ` · ${skip} already sent, will be skipped` : ""}
              </small>
            </div>
            <select
              aria-label={`Tour type for ${g.title}`}
              value={picks[g.key] ?? ""}
              disabled={!types}
              onChange={(e) =>
                setPicks((p) => ({ ...p, [g.key]: e.target.value }))
              }
              className="w-full rounded-md border border-stone-300 night:border-white/15 night:bg-white/[.06] night:[color-scheme:dark] bg-white px-2 py-1.5 text-[13px] text-stone-900 night:text-white"
            >
              <option value="">— Don&apos;t send —</option>
              {(types ?? []).map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      {alreadySent.length ? (
        <div className={NOTE_BOX}>
          Already sent, skipped:{" "}
          {alreadySent
            .map(
              (r) =>
                `${r.order_number} (${formatLaDateTime(sentAt(r, "bus"))})`,
            )
            .join(", ")}
          . To send again, use Send anyway on the next step.
        </div>
      ) : null}
      {error ? (
        <p role="alert" className={ERR_BOX}>
          {error}
        </p>
      ) : null}
    </DialogFrame>
  );
}

// ── Send reminder ────────────────────────────────────────────────────────────

function ticketOutcomes(res: ManifestSendTicketsResult) {
  return {
    sent: res.sent,
    outcomes: res.results.map((r) => ({
      order: r.chd_number,
      name: r.name,
      // 后端只回真假、不回原因（没号码 / 没邮箱也是 false），所以写 not sent，不写 failed。
      first: r.sms_ok ? "sent" : "not sent",
      second: r.email_ok ? "sent" : "not sent",
      failed: !r.sms_ok && !r.email_ok,
    })),
    skipped: res.skipped ?? [],
  };
}

export function ReminderDialog({
  date,
  rows: rowsProp,
  tourTypeLabel,
  onClose,
  onSent,
  onUnauthorized,
}: {
  date: string;
  rows: ManifestRow[];
  /** 胶囊名 = Products 里的门票 tour type。 */
  tourTypeLabel: string;
  onClose: () => void;
  onSent: () => void;
  onUnauthorized: () => void;
}) {
  // 打开时拍一份（同上）。
  const [rows] = useState(rowsProp);
  const [run, setRun] = useState<RunState | null>(null);
  const [sending, setSending] = useState(false);
  const [anyway, setAnyway] = useState<string[]>([]);
  const isAlive = useAlive();
  useLeaveGuard(sending);
  const alreadySent = rows.filter((r) => sentAt(r, "tickets"));

  async function go(
    picked: ManifestRow[],
    extra: { send_anyway?: string[]; preview_at?: string },
  ) {
    setSending(true);
    const batches = chunk(picked, SEND_BATCH_SIZE).map((part) => ({
      rows: part,
      run: (x: { send_anyway?: string[]; preview_at?: string }) =>
        sendManifestTickets({
          date,
          row_keys: part.map((r) => r.row_key),
          ...x,
        }),
    }));
    const result = await runBatches(
      batches,
      extra,
      ticketOutcomes,
      setRun,
      isAlive,
      onUnauthorized,
    );
    setSending(false);
    setAnyway([]);
    if (result.done > 0 || result.stop?.maybeSent) onSent();
  }

  const titleId = "manifest-reminder-title";
  if (run) {
    const failed = run.outcomes.filter((o) => o.failed).length;
    return (
      <DialogFrame
        titleId={titleId}
        title={sending ? "Sending reminders…" : "Sent"}
        busy={sending}
        onClose={onClose}
        footer={
          <>
            {anyway.length ? (
              <button
                type="button"
                disabled={sending}
                onClick={() => {
                  const orders = new Set(anyway);
                  void go(
                    rows.filter((r) => orders.has(r.order_number)),
                    { send_anyway: [...orders], preview_at: run.checkedAt },
                  );
                }}
                className={SECONDARY_BUTTON_CLASS}
              >
                Send anyway to {plural(anyway.length, "guest")}
              </button>
            ) : null}
            <button
              type="button"
              disabled={sending}
              onClick={onClose}
              className={PRIMARY_BUTTON_CLASS}
            >
              Done
            </button>
          </>
        }
      >
        {sending ? <Progress run={run} /> : null}
        {run.stop ? <StopBox stop={run.stop} /> : null}
        {!sending ? (
          <div role="status" className={OK_BOX}>
            {plural(run.sent, "reminder")} sent.
            {failed ? ` ${failed} not sent by SMS or email, see below.` : ""}
            {run.skipped.length ? ` ${run.skipped.length} skipped.` : ""} Sent
            rows move to the bottom of the list.
          </div>
        ) : null}
        <AnywayPicker
          skipped={run.skipped}
          picked={anyway}
          onPick={setAnyway}
          disabled={sending}
        />
        <OutcomeTable heads={["SMS", "Email"]} outcomes={run.outcomes} />
      </DialogFrame>
    );
  }

  return (
    <DialogFrame
      titleId={titleId}
      title="Send reminder"
      busy={false}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void go(rows, {})}
            className={PRIMARY_BUTTON_CLASS}
          >
            Send {plural(rows.length, "reminder")}
          </button>
        </>
      }
    >
      <p>
        {plural(rows.length, "guest")} · tour type: {tourTypeLabel}. The
        reminder uses the Cfm # shown on the page and goes out by SMS and email.
      </p>
      {alreadySent.length ? (
        <div className={NOTE_BOX}>
          Already sent, skipped:{" "}
          {alreadySent
            .map(
              (r) =>
                `${r.order_number} (${formatLaDateTime(sentAt(r, "tickets"))})`,
            )
            .join(", ")}
          . To send again, use Send anyway on the next step.
        </div>
      ) : null}
    </DialogFrame>
  );
}
