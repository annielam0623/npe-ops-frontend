"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import {
  DUP_BADGE,
  RED_BOX,
  RESULT_SUMMARY,
  ResultStat,
  SEND_ANYWAY_ALL,
  SEND_ANYWAY_LABEL,
  SEND_ICON,
  sendButtonClass,
  SendProgress,
  type SendTheme,
  SendTypePicker,
  STOP_BOX,
  TABLE,
  TABLE_WRAP,
  TD,
  TH,
  TR,
  YELLOW_BOX,
} from "@/components/tickets-send/legacy-ui";
import { SEND_TYPES, sendTypeShort } from "@/components/tickets-send/config";
import { Modal } from "@/components/ui/modal";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  broadcastManifest,
  checkManifestBroadcast,
  fetchManifestPage,
  sendManifestTickets,
  sendManifestTour,
} from "@/lib/manifests-api";
import { chunk, SEND_BATCH_SIZE } from "@/lib/send-batches";
import { sendBatchHref } from "@/lib/send-log-api";
import { expandForCount, smsCheck, smsProblem } from "@/lib/sms-limit";
import { fetchTourTypes } from "@/lib/tour-send-api";
import { cn } from "@/lib/utils";
import type {
  ManifestBroadcastCheck,
  ManifestBroadcastResult,
  ManifestRow,
  ManifestListSection,
  ManifestSendSkipped,
  ManifestSendTicketsResult,
  ManifestSendTourResult,
  ManifestTabKey,
  TicketsSendType,
  TourTypeOption,
} from "@/types";

import {
  formatLaDateTime,
  guestPickupTime,
  paxOf,
  plural,
  SEND_TABLE_FIELDS,
  STAFF_CFM_KEY,
  sentAt,
  sentLabel,
  CHECK_BIG,
} from "./config";

/**
 * Manifests 页勾选客人后的三个发送弹窗（后端 main-manifest-sections ②③，Annie 2026-10-09 定，样稿第 3 版）：
 * Send message（自定义消息，记进 Broadcasting Log）、Send tour confirmation（巴士团确认，每节手选 tour type）、
 * Send reminder（门票提醒，用 staff 的 Cfm #）。⚠️ 都是真实发送。
 *
 * 发确认 / 提醒和发送页一样分小批（每批 10 位）依次发：一次发太多会超过线上 Cloudflare 的约 100 秒，
 * 浏览器报错时后端还在发，staff 以为失败再点一次就会重复发给客人。某一批出错就停，写明哪些「可能已发」。
 * 自定义消息是一次请求（一次发送记一条 Broadcasting Log，同 Tracking 页的群发）。
 */

/** 消息正文上限（Annie 2026-10-25「设为5000字」，邮件也管）；后端 BROADCAST_MAX_CHARS 是 20,000，比这宽。SMS 另有 300 字的限制。 */
const MESSAGE_MAX = 5000;
const DEFAULT_MESSAGE =
  "Hi {first_name}, this is National Park Express about your tour on {tour_date}. ";

// 格式和发送页统一（Annie 2026-10-12：整个系统的发送页面格式必须一样）：框、名单表、标签、结果数字
// 都用发送页的 components/tickets-send/legacy-ui（照旧 send_tour.html），不在这里另写一套。
/** 发送页没有绿框（旧页面的成功只用数字）；这里的「已发出」一句话用同样的框形，配旧页面 .status-ok 的绿。 */
const OK_BOX =
  "rounded-[10px] border border-[#bfe0c9] bg-[#eef7f0] px-4 py-3 text-[12px] leading-[1.8] text-[#3B6D11]";
const NOTE_BOX = cn(YELLOW_BOX, "mb-0");
const ERR_BOX = cn(RED_BOX, "mb-0 max-w-none");

/** 定宽表格里放不下的文字截成省略号（不压到下一格）。 */
const CLIP = "overflow-hidden text-ellipsis";

/** 旧页面 .status-ok / .status-fail。 */
function statusClass(text: string): string {
  if (/^failed/i.test(text)) return "text-[#A32D2D]";
  if (/^sent/i.test(text)) return "font-medium text-[#3B6D11]";
  return "text-[#BA7517]";
}

/**
 * 发送键（Annie 2026-10-17：Manifests 上所有发送键用全站提交蓝 #3b82f6，点一下立刻变灰 + Sending…，不能再点）。
 * busy 的样子：灰底、转圈、不可点。
 */
const SEND_BLUE = cn(
  DARK_PRIMARY_BUTTON_CLASS,
  "inline-flex items-center gap-2",
);
const SEND_BUSY =
  "inline-flex cursor-not-allowed items-center gap-2 rounded-md border border-[#aaa] bg-[#aaa] px-4 py-2 text-sm font-medium text-white";
const sendClass = (busy: boolean) => (busy ? SEND_BUSY : SEND_BLUE);
function Spin() {
  return (
    <span
      aria-hidden
      className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent motion-reduce:animate-none"
    />
  );
}

function distinctOrders(rows: readonly ManifestRow[]): string[] {
  return [...new Set(rows.map((r) => r.order_number))];
}

/**
 * 渠道（Annie 2026-10-20「改回」#3，旧页面有 Both / SMS Only / Email Only）：后端 G154 认 send_sms / send_email 两个布尔，
 * 两个都缺省 = SMS + Email（旧行为）。选 Both 就不传，旧后端也照常发。
 */
function channelFlags(type: TicketsSendType): {
  send_sms?: boolean;
  send_email?: boolean;
} {
  return type === "combined"
    ? {}
    : { send_sms: type === "sms", send_email: type === "email" };
}

/** 句子里的渠道：email and SMS / SMS only / email only。 */
function channelWords(type: TicketsSendType): string {
  return type === "sms"
    ? "SMS only"
    : type === "email"
      ? "email only"
      : "email and SMS";
}

/** Send Log 批次号（后端 G164）：缺失、null、不是正整数都当没有批次，不显示 View this send。 */
function validBatchIds(ids: readonly unknown[]): number[] {
  return [
    ...new Set(
      ids.filter((n): n is number => Number.isInteger(n) && (n as number) > 0),
    ),
  ];
}

/** 📋 View this send：每个批次一个链接（超过一批时标 1 of N）。 */
function ViewSendLinks({
  ids,
  theme,
}: {
  ids: readonly number[];
  theme: SendTheme;
}) {
  if (!ids.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id, i) => (
        <a
          key={id}
          href={sendBatchHref(id)}
          target="_blank"
          rel="noopener noreferrer"
          data-view-send={id}
          className={cn(sendButtonClass(theme), "inline-flex")}
        >
          📋 View this send{ids.length > 1 ? ` (${i + 1} of ${ids.length})` : ""}
        </a>
      ))}
    </div>
  );
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
      // 不传 night：里面用的是发送页的白底表格 / 标签，全深色主题下也和发送页一样保持白底。
      panelClassName="flex max-h-[90vh] max-w-[720px] flex-col overflow-hidden"
    >
      <div className="border-b border-stone-200 px-5 py-3.5 night:border-white/10">
        <h2
          id={titleId}
          className="text-base font-semibold text-stone-900"
        >
          {title}
        </h2>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4 text-[13px] text-[#1a1a1a]">
        {children}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 px-5 py-3 night:border-white/10">
        {footer}
      </div>
    </Modal>
  );
}

// DialogFrame 面板永远白底（153 行），但 SECONDARY_BUTTON_CLASS 自带给深色容器用的 night 变体
// （白字/深底），放这里会变成白底白字。去掉它的 night 部分，按钮固定浅色样子，不分主题。
const FRAME_SECONDARY_BUTTON_CLASS = SECONDARY_BUTTON_CLASS.replace(
  / night:\S+/g,
  "",
);

// ── Send message ─────────────────────────────────────────────────────────────

type MessagePhase =
  | { kind: "edit"; error: string | null }
  | { kind: "checking" }
  /** 勾着 SMS 又超过两段：问要不要改发 Email（Annie 2026-10-15「最多两段，否则发邮件」）。 */
  | { kind: "tooLong" }
  /** check = 谁这个团期已经收过一模一样的消息（G62）。 */
  | { kind: "review"; check: ManifestBroadcastCheck }
  | { kind: "sending"; check: ManifestBroadcastCheck }
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
  /** 收过这条消息、勾了 Send anyway 的订单号。 */
  const [anyway, setAnyway] = useState<ReadonlySet<string>>(() => new Set());
  const guests = distinctOrders(rows).length;
  const busy = phase.kind === "sending" || phase.kind === "checking";
  useLeaveGuard(phase.kind === "sending");
  const channelText = [sms ? "SMS" : "", email ? "Email" : ""]
    .filter(Boolean)
    .join(" + ");
  // 字数按最坏情况算：{first_name} 换成名单里最长的名字、{tour_date} 换成日期（同 Tracking 群发）。
  const firstNames = rows.map(
    (r) =>
      String(r.values.guest_name ?? "")
        .trim()
        .split(/\s+/)[0] ?? "",
  );
  const smsText = expandForCount(text.trim(), firstNames, date);
  // 300 个字符、不能有特殊字符（Annie 2026-10-15）；特殊字符只查 staff 写的原文。
  const length = smsCheck(smsText, "Email", text.trim());
  /** 名单里有邮箱列、但邮箱是空的订单数（没有邮箱列就不说）。 */
  const noEmail = distinctOrders(
    rows.filter(
      (r) => "email" in r.values && !String(r.values.email ?? "").trim(),
    ),
  ).length;

  /**
   * 校验 → 问后端谁已经收过这条一模一样的消息（同一团期，Tracking 发的也算）→ 确认页。
   * emailOnly：刚在「太长」那一步选了只发 Email（勾选的 state 还没更新）。
   */
  async function review(opts: { emailOnly?: boolean } = {}) {
    const body = text.trim();
    const useSms = opts.emailOnly ? false : sms;
    const useEmail = opts.emailOnly ? true : email;
    let error: string | null = null;
    if (!body) error = "Please enter a message.";
    else if (!useSms && !useEmail) error = "Choose SMS, Email or both.";
    else if (body.length > MESSAGE_MAX)
      error = `The message is too long (${body.length.toLocaleString("en-US")} / ${MESSAGE_MAX.toLocaleString("en-US")} characters).`;
    if (error) {
      setPhase({ kind: "edit", error });
      return;
    }
    if (useSms && length.over) {
      setPhase({ kind: "tooLong" });
      return;
    }
    setPhase({ kind: "checking" });
    try {
      const check = await checkManifestBroadcast({
        date,
        row_keys: rows.map((r) => r.row_key),
        message: body,
      });
      setAnyway(new Set());
      setPhase({ kind: "review", check });
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setPhase({
        kind: "edit",
        error: `Could not check who already got this message: ${e instanceof TypeError ? "could not reach the server." : describeError(e)}`,
      });
    }
  }

  async function send(check: ManifestBroadcastCheck) {
    setPhase({ kind: "sending", check });
    try {
      const again = check.already_sent
        .map((s) => s.order_number)
        .filter((o) => anyway.has(o));
      const result = await broadcastManifest({
        date,
        row_keys: rows.map((r) => r.row_key),
        message: text.trim(),
        send_sms: sms,
        send_email: email,
        ...(again.length
          ? { send_anyway: again, preview_at: check.checked_at }
          : {}),
      });
      setPhase({ kind: "done", result });
      onSent();
    } catch (error) {
      if (isStatus(error, 401)) {
        onUnauthorized();
        return;
      }
      // 400：后端在发第一条之前整批拒了，确定没发（例如有人刚被取消，要 Reload）。
      // 409：同一团期别人正在群发，什么都没发（G62）。
      const rejected = isStatus(error, 400) || isStatus(error, 409);
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
          <button type="button" onClick={onClose} className={SEND_BLUE}>
            Done
          </button>
        }
      >
        {phase.kind === "done" ? (
          <>
            {phase.result.results.length ? (
              <div role="status" className={OK_BOX}>
                {plural(phase.result.recipient_count, "order")} · {channelText}.
                Saved in Broadcasting Log.
              </div>
            ) : (
              <div role="status" className={NOTE_BOX}>
                Nothing was sent: everyone already got this message.
              </div>
            )}
            {phase.result.skipped?.length ? (
              <p data-broadcast-skipped>
                Skipped {phase.result.skipped.length} (already got this
                message):{" "}
                {phase.result.skipped.map((s) => s.order_number).join(", ")}.
              </p>
            ) : null}
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
            <p className="text-[#1a1a1a]">
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

  if (phase.kind === "tooLong") {
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
              onClick={() => setPhase({ kind: "edit", error: null })}
              className={FRAME_SECONDARY_BUTTON_CLASS}
            >
              No, edit the message
            </button>
            <button
              type="button"
              onClick={() => {
                setSms(false);
                setEmail(true);
                void review({ emailOnly: true });
              }}
              className={SEND_BLUE}
            >
              Yes, use Email only
            </button>
          </>
        }
      >
        <div data-too-long role="alert" className={ERR_BOX}>
          <p className="font-semibold">
            {smsProblem(
              length,
              ", counting the longest guest name and the date",
            )}
          </p>
          <p>Send it by Email only instead?</p>
          {noEmail ? (
            <p>
              {noEmail} selected {noEmail === 1 ? "order has" : "orders have"}{" "}
              no email and will not receive it.
            </p>
          ) : null}
        </div>
      </DialogFrame>
    );
  }

  if (phase.kind === "review" || phase.kind === "sending") {
    const { check } = phase;
    const already = check.already_sent;
    const againCount = already.filter((s) => anyway.has(s.order_number)).length;
    const toSend = Math.max(0, guests - already.length) + againCount;
    const allAgain = already.length > 0 && againCount === already.length;
    const nameOf = new Map(
      rows.map((r) => [r.order_number, String(r.values.guest_name ?? "")]),
    );
    const toggle = (orders: string[], on: boolean) =>
      setAnyway((prev) => {
        const next = new Set(prev);
        for (const o of orders)
          if (on) next.add(o);
          else next.delete(o);
        return next;
      });
    return (
      <DialogFrame
        titleId={titleId}
        title={`Send this to ${plural(toSend, "order")}?`}
        busy={busy}
        onClose={onClose}
        footer={
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPhase({ kind: "edit", error: null })}
              className={FRAME_SECONDARY_BUTTON_CLASS}
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy || !toSend}
              onClick={() => void send(check)}
              className={sendClass(busy)}
            >
              {busy ? <Spin /> : null}
              {busy ? "Sending…" : "Yes, send now"}
            </button>
          </>
        }
      >
        <p>Channel: {channelText}</p>
        <div className={cn(OK_BOX, "whitespace-pre-wrap")}>{text.trim()}</div>
        {already.length ? (
          <>
            <div data-broadcast-already className={NOTE_BOX}>
              {already.length === guests
                ? toSend
                  ? `All ${plural(guests, "order")} already got this exact message for this tour date. Only the ones ticked Send anyway get it again.`
                  : "Everyone already got this message. Tick Send anyway to send it again."
                : `${already.length} of ${plural(guests, "order")} already got this exact message for this tour date. They are skipped unless you tick Send anyway.`}
            </div>
            <ListTable
              label="Already got this message"
              heads={[
                "Order #",
                "Guest",
                "Status",
                <label key="all" className={SEND_ANYWAY_ALL}>
                  <input
                    type="checkbox"
                    className={CHECK_BIG}
                    checked={allAgain}
                    disabled={busy}
                    onChange={(e) =>
                      toggle(
                        already.map((s) => s.order_number),
                        e.target.checked,
                      )
                    }
                  />
                  Send anyway (all)
                </label>,
              ]}
            >
              {already.map((s) => (
                <tr
                  key={s.order_number}
                  data-already={s.order_number}
                  className={cn(TR, "bg-[#fff8e1]")}
                >
                  <td className={TD}>{s.order_number}</td>
                  <td className={TD}>{nameOf.get(s.order_number) ?? ""}</td>
                  <td className={TD}>
                    <span className={DUP_BADGE}>
                      Sent by {s.sent_by || "staff"} on{" "}
                      {formatLaDateTime(s.sent_at)}
                    </span>
                  </td>
                  <td className={TD}>
                    <label className={SEND_ANYWAY_LABEL}>
                      <input
                        type="checkbox"
                        className={CHECK_BIG}
                        data-anyway={s.order_number}
                        checked={anyway.has(s.order_number)}
                        disabled={busy}
                        onChange={(e) =>
                          toggle([s.order_number], e.target.checked)
                        }
                      />
                      Send anyway
                    </label>
                  </td>
                </tr>
              ))}
            </ListTable>
          </>
        ) : null}
        <p className="text-[#1a1a1a]">
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
            className={FRAME_SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void review()}
            className={sendClass(busy)}
          >
            {phase.kind === "checking" ? <Spin /> : null}
            {phase.kind === "checking" ? "Checking…" : "Review"}
          </button>
        </>
      }
    >
      <p>
        {plural(guests, "order")} (one message per order). Use {"{first_name}"}{" "}
        and {"{tour_date}"} to fill in each guest&rsquo;s details. This is
        logged in Broadcasting Log. Orders that already got the exact same
        message for this tour date are skipped unless you tick Send anyway.
      </p>
      <textarea
        aria-label="Message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-[110px] w-full resize-y rounded-md border border-stone-300 px-2 py-1.5 font-[inherit] text-[13px] text-stone-900 night:border-white/15 night:bg-white/[.06] night:text-white night:[color-scheme:dark]"
      />
      {sms && text.trim() ? (
        <p
          data-sms-count
          className={cn(
            "text-[11px]",
            length.over
              ? "font-semibold text-red-700"
              : "text-[#1a1a1a]",
          )}
        >
          {length.text}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3.5">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            className={CHECK_BIG}
            checked={sms}
            onChange={(e) => setSms(e.target.checked)}
          />{" "}
          SMS
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            className={CHECK_BIG}
            checked={email}
            onChange={(e) => setEmail(e.target.checked)}
          />{" "}
          Email
        </label>
      </div>
      {phase.kind === "edit" && phase.error ? (
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
  /** 断线 / 5xx / 后面几批被拒：这一批发没发不知道。 */
  maybeSent: boolean;
  /** 第 1 批被服务器拒（400）：确定什么都没发，弹窗回到发送前，发送键可再点（旧页面：留在预览页、红字写在发送键旁）。 */
  retry?: boolean;
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
  /** 这次发出去的各批在 Send Log 里的批次号（后端 G164）；没有就是空。 */
  batchIds: number[];
}

async function runBatches<R extends { checked_at: string }>(
  batches: Batch<R>[],
  anyway: { send_anyway?: string[]; preview_at?: string },
  read: (r: R) => {
    sent: number;
    outcomes: Outcome[];
    skipped: ManifestSendSkipped[];
    batchIds: number[];
  },
  onProgress: (s: RunState) => void,
  isAlive: () => boolean,
  onUnauthorized: () => void,
): Promise<RunState> {
  const state: RunState = {
    done: 0,
    total: batches.reduce((n, b) => n + distinctOrders(b.rows).length, 0),
    sent: 0,
    outcomes: [],
    skipped: [],
    stop: null,
    checkedAt: "",
    batchIds: [],
  };
  // 点下去就切到进度画面（不等第一批返回），不然这段时间页面看起来没反应。
  onProgress({ ...state });
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
      state.batchIds = validBatchIds([...state.batchIds, ...r.batchIds]);
      state.done += distinctOrders(batch.rows).length;
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
      // 只有第 1 批的 400 算「确定没发」（同旧页面 Tickets / Tour 发送页，Annie 2026-10-20「改回」#2）；
      // 后面几批的 400 和断线、5xx 一样当「可能已发」。
      const rejected = isStatus(error, 400) && i === 0;
      state.stop = {
        reason:
          error instanceof TypeError
            ? "Could not reach the server."
            : describeError(error),
        maybeSent: !rejected,
        retry: rejected,
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

function StopBox({
  stop,
  batchIds = [],
  theme,
}: {
  stop: Stop;
  batchIds?: readonly number[];
  theme?: SendTheme;
}) {
  return (
    <div role="alert" className={cn(STOP_BOX, "max-w-none")}>
      {stop.maybeSent ? (
        <>
          <p className="font-semibold">
            ⛔ Stop. Do not click Send again. The page lost contact with the
            server, and some or all messages may already have been sent.
          </p>
          <p>
            {batchIds.length && theme
              ? "Click View this send to see which messages went out."
              : "Open the Send Log to see which messages went out."}
          </p>
          {batchIds.length && theme ? (
            <ViewSendLinks ids={batchIds} theme={theme} />
          ) : null}
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

/** 发送页的白底名单表（.preview-card 里的 table.preview-tbl）。 */
function ListTable({
  label,
  heads,
  widths,
  children,
}: {
  label: string;
  heads: ReactNode[];
  /** 各列宽度：几节各一张表时列对得齐。 */
  widths?: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border-[0.5px] border-black/10 bg-paper">
      <div className={TABLE_WRAP}>
        <table
          aria-label={label}
          className={cn(TABLE, widths && "table-fixed")}
          // 定宽要表格本身是整宽（TABLE 是 w-auto，table-fixed 不生效，几张表列就对不齐）。
          style={widths ? { width: "100%" } : undefined}
        >
          {widths ? (
            <colgroup>
              {widths.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
          ) : null}
          <thead>
            <tr>
              {heads.map((h, i) => (
                <th key={i} className={TH}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * 发之前的名单：每单一行（同发送页的预览表）。已发过的整行淡黄、带「Sent by 谁 on 时间」标签，
 * 发的时候会跳过（重发在下一步勾 Send anyway）。
 */
/**
 * 发之前名单表的勾选（Annie 2026-10-13：所有发送表格都要全选、单选、Send anyway）：
 * - 没发过的默认勾上，可以逐个取消；表头 Select all 只管没发过的（同早班页，免得一下把发过的也勾上）。
 * - 发过的默认不发，勾 Send anyway 才发（行里那个勾选框跟着它、不能单独点）；表头 Send anyway (all) 全勾 / 全不勾。
 */
interface SendChoice {
  chosen: (r: ManifestRow) => boolean;
  again: (r: ManifestRow) => boolean;
  setChosen: (rows: ManifestRow[], on: boolean) => void;
  setAgain: (rows: ManifestRow[], on: boolean) => void;
}

/**
 * 往返 shuttle 的回程那一行不发团确认（G36，Annie：团确认跟着去程发过了）：不勾、不能勾，后端也会整批拒。
 */
function noTourConfirmation(r: ManifestRow, tab: ManifestTabKey): boolean {
  return tab === "bus" && r.leg === "return";
}

function useSendChoice(tab: ManifestTabKey): SendChoice {
  /** 没发过、被取消勾选的行。 */
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  /** 发过、勾了 Send anyway 的行。 */
  const [on, setOn] = useState<ReadonlySet<string>>(() => new Set());
  const update = (set: typeof setOff) => (rows: ManifestRow[], add: boolean) =>
    set((prev) => {
      const next = new Set(prev);
      for (const r of rows)
        if (add) next.add(r.row_key);
        else next.delete(r.row_key);
      return next;
    });
  const again = (r: ManifestRow) =>
    !noTourConfirmation(r, tab) && !!sentAt(r, tab) && on.has(r.row_key);
  return {
    chosen: (r) =>
      noTourConfirmation(r, tab)
        ? false
        : sentAt(r, tab)
          ? again(r)
          : !off.has(r.row_key),
    again,
    setChosen: (rows, add) => update(setOff)(rows, !add),
    setAgain: update(setOn),
  };
}

/**
 * Send anyway 在第一步就勾的：后端只重发「最近一次发送不晚于 preview_at」的单。preview_at 用页面上显示的那个发送时间
 * （勾的几单里最晚的，原样字符串）——看名单这段时间里有人又发过，后端照样跳过，不会重复发。
 */
function anywayExtra(
  rows: ManifestRow[],
  choice: SendChoice,
  tab: ManifestTabKey,
): { send_anyway?: string[]; preview_at?: string } {
  const again = rows.filter((r) => choice.again(r));
  if (!again.length) return {};
  const latest = again
    .map((r) => sentAt(r, tab))
    .reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
  return {
    send_anyway: [...new Set(again.map((r) => r.order_number))],
    preview_at: latest,
  };
}

function GuestTable({
  label,
  rows,
  tab,
  choice,
}: {
  label: string;
  rows: ManifestRow[];
  tab: ManifestTabKey;
  choice: SendChoice;
}) {
  const extra = tab === "bus" ? "Pickup time" : "Cfm #";
  const fresh = rows.filter(
    (r) => !sentAt(r, tab) && !noTourConfirmation(r, tab),
  );
  const done = rows.filter(
    (r) => sentAt(r, tab) && !noTourConfirmation(r, tab),
  );
  const allFresh = fresh.length > 0 && fresh.every((r) => choice.chosen(r));
  const allAgain = done.length > 0 && done.every((r) => choice.again(r));
  return (
    <ListTable
      label={label}
      heads={[
        <input
          key="all"
          type="checkbox"
          className={CHECK_BIG}
          aria-label={`Select all in ${label}`}
          checked={allFresh}
          disabled={!fresh.length}
          onChange={(e) => choice.setChosen(fresh, e.target.checked)}
        />,
        "Order #",
        "Guest",
        "Pax",
        extra,
        "Status",
        done.length ? (
          <label key="again" className={SEND_ANYWAY_ALL}>
            <input
              type="checkbox"
              className={CHECK_BIG}
              checked={allAgain}
              onChange={(e) => choice.setAgain(done, e.target.checked)}
            />
            Send anyway (all)
          </label>
        ) : (
          ""
        ),
      ]}
      widths={["4%", "13%", "16%", "5%", "11%", "33%", "18%"]}
    >
      {rows.map((r) => {
        const back = noTourConfirmation(r, tab);
        const sent = back ? "" : sentLabel(r, tab);
        const extraValue =
          tab === "bus" ? guestPickupTime(r) : r.values[STAFF_CFM_KEY];
        return (
          <tr
            key={r.row_key}
            data-order={r.order_number}
            data-leg={r.leg ?? undefined}
            className={cn(
              TR,
              back ? "bg-[#fafafa] text-[#999]" : sent && "bg-[#fff8e1]",
            )}
          >
            <td className={TD}>
              <input
                type="checkbox"
                className={CHECK_BIG}
                data-pick={r.order_number}
                aria-label={`Send to ${r.order_number}`}
                checked={choice.chosen(r)}
                // 发过的单由 Send anyway 决定，这个框只跟着显示；回程那行不发团确认。
                disabled={!!sent || back}
                onChange={(e) => choice.setChosen([r], e.target.checked)}
              />
            </td>
            <td className={cn(TD, CLIP)}>{r.order_number}</td>
            <td className={cn(TD, CLIP)}>
              {String(r.values.guest_name ?? "")}
            </td>
            <td className={cn(TD, "font-bold")}>{paxOf(r) || ""}</td>
            <td className={cn(TD, CLIP)}>
              {extraValue ? (
                String(extraValue)
              ) : (
                <span className="text-[#1a1a1a]">—</span>
              )}
            </td>
            <td className={cn(TD, "whitespace-normal")}>
              {back ? (
                <span className="inline-block rounded-md bg-[#eeeeec] px-1.5 py-0.5 text-[10px] text-[#777]">
                  Return trip: no tour confirmation
                </span>
              ) : sent ? (
                <span
                  className={cn(DUP_BADGE, "inline-block whitespace-normal")}
                >
                  {sent}
                </span>
              ) : null}
            </td>
            <td className={TD}>
              {sent ? (
                <label className={SEND_ANYWAY_LABEL}>
                  <input
                    type="checkbox"
                    className={CHECK_BIG}
                    data-again={r.order_number}
                    checked={choice.again(r)}
                    onChange={(e) => choice.setAgain([r], e.target.checked)}
                  />
                  Send anyway
                </label>
              ) : null}
            </td>
          </tr>
        );
      })}
    </ListTable>
  );
}

/** 发完的逐单结果（同发送页 Send Results 的表）。 */
function OutcomeTable({
  heads,
  outcomes,
}: {
  heads: [string, string];
  outcomes: Outcome[];
}) {
  if (!outcomes.length) return null;
  return (
    <ListTable label="Send results" heads={["Order #", "Guest", ...heads]}>
      {outcomes.map((o, i) => (
        <tr key={`${o.order}-${i}`} data-outcome={o.order} className={TR}>
          <td className={TD}>{o.order}</td>
          <td className={TD}>{o.name}</td>
          <td className={cn(TD, statusClass(o.first))}>{o.first}</td>
          <td className={cn(TD, statusClass(o.second))}>{o.second}</td>
        </tr>
      ))}
    </ListTable>
  );
}

/** 跳过的单（同发送页）：整行淡黄、带原因标签；已发过的可以勾 Send anyway 再发一次。 */
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
  if (!skipped.length) return null;
  const orderOf = (s: ManifestSendSkipped) =>
    s.order_number ?? s.chd_number ?? "";
  const canPickReason = (r?: string) => r === "already_sent" || r === "no_cfm";
  const pickable = skipped.filter((s) => canPickReason(s.reason)).map(orderOf);
  const all = pickable.length > 0 && pickable.every((o) => picked.includes(o));
  return (
    <>
      <p className="text-[12px] font-semibold text-[#7C4A00]">
        Skipped ({skipped.length})
        {pickable.length
          ? ". To send again, tick Send anyway and click the Send anyway button below."
          : ""}
      </p>
      <ListTable
        label="Skipped"
        heads={[
          "Order #",
          "Guest",
          "Status",
          pickable.length ? (
            <label key="all" className={SEND_ANYWAY_ALL}>
              <input
                type="checkbox"
                className={CHECK_BIG}
                checked={all}
                disabled={disabled}
                onChange={(e) => onPick(e.target.checked ? pickable : [])}
              />
              Send anyway (all)
            </label>
          ) : (
            ""
          ),
        ]}
      >
        {skipped.map((s) => {
          const order = orderOf(s);
          const canPick = canPickReason(s.reason);
          return (
            <tr
              key={`${order}-${s.reason ?? ""}`}
              data-skipped={order}
              className={cn(TR, "bg-[#fff8e1]")}
            >
              <td className={TD}>{order}</td>
              <td className={TD}>{s.name}</td>
              <td className={TD}>
                <span className={DUP_BADGE}>{s.message}</span>
              </td>
              <td className={TD}>
                {canPick ? (
                  <label className={SEND_ANYWAY_LABEL}>
                    <input
                      type="checkbox"
                      className={CHECK_BIG}
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
                    />
                    Send anyway
                  </label>
                ) : null}
              </td>
            </tr>
          );
        })}
      </ListTable>
    </>
  );
}

function Progress({ run, theme }: { run: RunState; theme: SendTheme }) {
  return (
    <SendProgress done={run.done} total={run.total} theme={theme}>
      Sending… {run.done} of {run.total} orders done — keep this page open until
      the results appear.
    </SendProgress>
  );
}

/** 结果数字（同发送页 .result-summary）。 */
function ResultNumbers({
  run,
  failed,
  notSent = 0,
}: {
  run: RunState;
  failed: number;
  notSent?: number;
}) {
  return (
    <>
      <div className={cn(RESULT_SUMMARY, "mb-0")}>
        <ResultStat label="Sent" value={run.sent} className="text-[#3B6D11]" />
        <ResultStat label="Failed" value={failed} className="text-[#A32D2D]" />
        <ResultStat
          label="Skipped"
          value={run.skipped.length}
          className="text-[#BA7517]"
        />
        {notSent ? (
          <ResultStat
            label="Not sent"
            value={notSent}
            className="text-[#1a1a1a]"
          />
        ) : null}
        {/* 和三个发送页一样最后一格是 Total：这次涉及的全部订单（发了的 + 跳过的 + 没发的）。Annie 2026-10-23 #24d。 */}
        <ResultStat
          label="Total"
          value={run.outcomes.length + run.skipped.length + notSent}
        />
      </div>
      <p data-stat-unit className="text-[11px] text-[#1a1a1a]">
        Counted in orders.
      </p>
    </>
  );
}

/**
 * 名单表要的列（客人名、上车时间、谁发的）：列表按 staff 选的列拉，不一定有；弹窗打开时按这一颗胶囊
 * 补拉一次、按 row_key 并进来。拉不到就照原样显示（标签只写时间）。只影响显示，发送只用 row_key。
 */
function useSendTableRows(
  date: string,
  tab: ManifestTabKey,
  pill: string,
  rows: ManifestRow[],
): ManifestRow[] {
  const [extra, setExtra] = useState<Map<string, ManifestRow["values"]>>(
    () => new Map(),
  );
  useEffect(() => {
    const controller = new AbortController();
    fetchManifestPage(
      { date, tab, pill, fields: SEND_TABLE_FIELDS[tab] },
      controller.signal,
    )
      .then((page) =>
        setExtra(new Map(page.rows.map((r) => [r.row_key, r.values]))),
      )
      .catch(() => {});
    return () => controller.abort();
  }, [date, tab, pill]);
  return rows.map((r) => {
    const more = extra.get(r.row_key);
    return more
      ? { ...r, values: { ...more, ...r.values, ...pickSet(more) } }
      : r;
  });
}

/** 补拉回来的列里有值的那些（列表里同名的列可能是 staff 没选、值为空）。 */
function pickSet(values: ManifestRow["values"]): ManifestRow["values"] {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== null && v !== undefined),
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

function tourOutcomes(res: ManifestSendTourResult, type: TicketsSendType) {
  // 没选的渠道写 —（没发，不算失败）。
  const useEmail = type !== "sms";
  const useSms = type !== "email";
  return {
    sent: res.sent,
    outcomes: res.groups.flatMap((g) =>
      g.results.map((r) => ({
        order: r.order,
        name: r.name,
        first: useEmail ? r.email_status || "—" : "—",
        second: useSms
          ? (r.sms_status || "—").replace(/^sent:.*/, "sent")
          : "—",
        failed:
          (useEmail && /^failed/i.test(r.email_status)) ||
          (useSms && /^failed/i.test(r.sms_status)),
      })),
    ),
    skipped: res.groups.flatMap((g) => g.skipped ?? []),
    batchIds: validBatchIds(res.groups.map((g) => g.batch_id)),
  };
}

export function TourConfirmDialog({
  lane,
  date,
  rows: rowsProp,
  pill,
  sections,
  pillLabel,
  onClose,
  onSent,
  onUnauthorized,
}: {
  date: string;
  rows: ManifestRow[];
  /** 当前胶囊（名单表补拉列用）。 */
  pill: string;
  sections: ManifestListSection[];
  /** 不分节时整组的名字（胶囊名）。 */
  pillLabel: string;
  onClose: () => void;
  onSent: () => void;
  onUnauthorized: () => void;
  /** "last_minute" = Last Minute 键（同一个弹窗，请求带 lane）。 */
  lane?: "last_minute";
}) {
  const lastMinute = lane === "last_minute";
  // 打开时拍一份（同上）。
  const [snapshot] = useState(rowsProp);
  const rows = useSendTableRows(date, "bus", pill, snapshot);
  const [types, setTypes] = useState<TourTypeOption[] | null>(null);
  const [typesError, setTypesError] = useState("");
  /**
   * 每节 staff 自己选过的 tour type；"" = Don't send。没选过的节用产品的默认值（Annie 2026-10-14 定，
   * 取代 10-09「不预选」）：这一节勾的客人都是同一个默认值才预填，混着或没配就空着让 staff 选。
   */
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [run, setRun] = useState<RunState | null>(null);
  const [sending, setSending] = useState(false);
  const [anyway, setAnyway] = useState<string[]>([]);
  const [sendType, setSendType] = useState<TicketsSendType>("combined");
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
  const choice = useSendChoice("bus");

  /** 这一节产品的默认 tour type：勾的客人（没勾就看全部）只有一个、而且下拉里有，才预填。 */
  function defaultFor(g: TourGroup): {
    key: string;
    why: "" | "mixed" | "unset";
  } {
    const ticked = g.rows.filter((r) => choice.chosen(r));
    const keys = new Set(
      (ticked.length ? ticked : g.rows).map((r) =>
        String(r.values.bus_tour_type ?? ""),
      ),
    );
    if (keys.size > 1) return { key: "", why: "mixed" };
    const [only = ""] = [...keys];
    return only && types?.some((t) => t.key === only)
      ? { key: only, why: "" }
      : { key: "", why: "unset" };
  }
  /** 这一节现在用的 tour type：staff 选过的优先，没选过用产品的默认值。 */
  const pickFor = (g: TourGroup) =>
    g.key in picks ? picks[g.key] : defaultFor(g).key;

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
            ...(lastMinute ? { lane } : {}),
            ...channelFlags(sendType),
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
      (r) => tourOutcomes(r, sendType),
      setRun,
      isAlive,
      onUnauthorized,
    );
    setSending(false);
    setAnyway([]);
    // 第 1 批被服务器拒：什么都没发，回到发送前，原因写在弹窗里，发送键可再点。
    if (result.stop?.retry) {
      setRun(null);
      setError(result.stop.reason);
      return;
    }
    if (result.done > 0 || result.stop?.maybeSent) onSent();
  }

  function start() {
    const chosen = groups.map((g) => ({
      ...g,
      rows: g.rows.filter((r) => choice.chosen(r)),
    }));
    if (!chosen.some((g) => g.rows.length)) {
      setError("Tick at least one order.");
      return;
    }
    const plan = chosen
      .map((g, i) => ({ tourType: pickFor(groups[i]), rows: g.rows }))
      .filter((p) => p.tourType && p.rows.length);
    if (!plan.length) {
      setError("Pick a tour type for at least one section with ticked guests.");
      return;
    }
    planRef.current = plan;
    setDontSend(
      chosen
        .filter((_, i) => !pickFor(groups[i]))
        .reduce((n, g) => n + g.rows.length, 0),
    );
    void go(
      plan,
      anywayExtra(
        plan.flatMap((p) => p.rows),
        choice,
        "bus",
      ),
    );
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
        title={
          sending
            ? lastMinute
              ? "Sending Last Minute Order…"
              : "Sending tour confirmations…"
            : "Sent"
        }
        busy={sending}
        onClose={onClose}
        footer={
          <>
            {anyway.length ? (
              <button
                type="button"
                disabled={sending}
                onClick={sendAnyway}
                className={FRAME_SECONDARY_BUTTON_CLASS}
              >
                {sending ? <Spin /> : null}
                {sending
                  ? "Sending…"
                  : `Send anyway to ${plural(anyway.length, "order")}`}
              </button>
            ) : null}
            <button
              type="button"
              disabled={sending}
              onClick={onClose}
              className={sendClass(sending)}
            >
              {sending ? <Spin /> : null}
              {sending ? "Sending…" : "Done"}
            </button>
          </>
        }
      >
        {sending ? <Progress run={run} theme="green" /> : null}
        {run.stop ? (
          <StopBox stop={run.stop} batchIds={run.batchIds} theme="green" />
        ) : null}
        {!sending ? (
          <>
            <ResultNumbers run={run} failed={failed} notSent={dontSend} />
            <div role="status" className={OK_BOX}>
              {plural(run.sent, "order")} sent
              {lastMinute ? " as Last Minute Order" : ""} ({sendType === "combined" ? "email + SMS" : channelWords(sendType)}).
              {failed ? ` ${failed} with a failed channel, see below.` : ""}
              {run.skipped.length ? ` ${run.skipped.length} skipped.` : ""}
              {dontSend ? ` ${dontSend} not sent, no tour type.` : ""}
            </div>
          </>
        ) : null}
        {!sending && !run.stop ? (
          <ViewSendLinks ids={run.batchIds} theme="green" />
        ) : null}
        <OutcomeTable heads={["Email", "SMS"]} outcomes={run.outcomes} />
        <AnywayPicker
          skipped={run.skipped}
          picked={anyway}
          onPick={setAnyway}
          disabled={sending}
        />
        {lastMinute ? null : (
          <p className="text-[12px] text-[#1a1a1a]">
            Each guest gets the same confirmation page as from the Tour
            Confirmation page, and the send counts on both pages.
          </p>
        )}
      </DialogFrame>
    );
  }

  return (
    <DialogFrame
      titleId={titleId}
      title={lastMinute ? "Send Last Minute Order" : "Send tour confirmation"}
      busy={sending}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            disabled={sending}
            onClick={onClose}
            className={FRAME_SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!types || sending}
            onClick={start}
            className={sendClass(sending)}
          >
            {sending ? <Spin /> : null}
            {sending
              ? "Sending…"
              : `${SEND_ICON[sendType]} Send (${sendTypeShort(sendType)})`}
          </button>
        </>
      }
    >
      <p>
        Check the tour type for each section. It sets lunch, the tour name and
        the photo the guest sees.{" "}
        {lastMinute
          ? `These go out as a Last Minute Order by ${channelWords(sendType)}: lunch and pick-up info in one message, no second confirmation.`
          : `Confirmations go out by ${channelWords(sendType)}.`}{" "}
        MTLV is not included; use the Tour Confirmation page for MTLV.
      </p>
      {typesError ? (
        <p role="alert" className={ERR_BOX}>
          Could not load the tour types: {typesError}
        </p>
      ) : null}
      {groups.map((g) => {
        const skip = g.rows.filter((r) => sentAt(r, "bus")).length;
        const ticked = g.rows.filter((r) => choice.chosen(r)).length;
        const again = g.rows.filter((r) => choice.again(r)).length;
        const picked = g.key in picks;
        const def = defaultFor(g);
        return (
          <div key={g.key} data-group={g.title} className="flex flex-col gap-2">
            <div className="grid grid-cols-1 items-center gap-2.5 sm:grid-cols-[1fr_minmax(0,260px)]">
              <div>
                <b className="text-[13px] text-[#1a1a1a]">{g.title}</b>
                <small className="block text-[11px] text-[#1a1a1a]">
                  {ticked} of {g.rows.length} ticked
                  {skip
                    ? ` · ${skip} already sent${again ? `, ${again} to send again` : ", skipped"}`
                    : ""}
                </small>
              </div>
              <div>
                <select
                  aria-label={`Tour type for ${g.title}`}
                  value={pickFor(g)}
                  disabled={!types}
                  onChange={(e) =>
                    setPicks((p) => ({ ...p, [g.key]: e.target.value }))
                  }
                  className="w-full rounded-md border border-stone-300 bg-paper px-2 py-1.5 text-[13px] text-stone-900"
                >
                  <option value="">— Don&apos;t send —</option>
                  {(types ?? []).map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {/* 预填的来源 / 没预填的原因（Annie 2026-10-15 看过预览）；staff 自己改过就不再写。 */}
                {!picked && types ? (
                  def.key ? (
                    <small
                      data-tour-default="products"
                      className="mt-0.5 block text-[11px] text-[#15803d]"
                    >
                      From Products
                    </small>
                  ) : (
                    <small
                      data-tour-default={def.why}
                      className="mt-0.5 block text-[11px] text-[#9a3412]"
                    >
                      {def.why === "mixed"
                        ? "Products in this section have different tour types. Pick one."
                        : "No tour type set in Products. Pick one."}
                    </small>
                  )
                ) : null}
              </div>
            </div>
            <GuestTable
              label={`Guests in ${g.title}`}
              rows={g.rows}
              tab="bus"
              choice={choice}
            />
          </div>
        );
      })}
      {alreadySent.length ? (
        <div className={NOTE_BOX}>
          Already sent (highlighted): {alreadySent.length}. They are skipped
          unless you tick Send anyway.
        </div>
      ) : null}
      <SendTypePicker
        types={SEND_TYPES}
        value={sendType}
        onChange={setSendType}
      />
      {error ? (
        <p role="alert" className={ERR_BOX}>
          {error}
        </p>
      ) : null}
    </DialogFrame>
  );
}

// ── Send reminder ────────────────────────────────────────────────────────────

function ticketOutcomes(
  res: ManifestSendTicketsResult,
  type: TicketsSendType,
) {
  const useSms = type !== "email";
  const useEmail = type !== "sms";
  return {
    sent: res.sent,
    outcomes: res.results.map((r) => ({
      order: r.chd_number,
      name: r.name,
      // 后端只回真假、不回原因（没号码 / 没邮箱也是 false），所以写 not sent，不写 failed。没选的渠道写 —。
      // 列顺序 Email、SMS，同三个发送页和 Tour 弹窗（Annie 2026-10-23 #24b）。
      first: useEmail ? (r.email_ok ? "sent" : "not sent") : "—",
      second: useSms ? (r.sms_ok ? "sent" : "not sent") : "—",
      failed: !(useSms && r.sms_ok) && !(useEmail && r.email_ok),
    })),
    batchIds: validBatchIds([res.batch_id]),
    skipped: [
      ...(res.skipped ?? []),
      // G129：缺 Cfm # 没发的单，列在「Skipped」里；能覆盖的可以勾 Send anyway（reason = no_cfm）。
      ...(res.blocked ?? []).map((b) => ({
        order_number: b.order_number,
        name: "",
        reason: b.can_override ? "no_cfm" : "blocked",
        message: b.reasons.join("; "),
      })),
    ],
  };
}

export function ReminderDialog({
  date,
  rows: rowsProp,
  pill,
  tourTypeLabel,
  onClose,
  onSent,
  onUnauthorized,
  noCfmOrders = [],
}: {
  date: string;
  rows: ManifestRow[];
  /** 当前胶囊（名单表补拉列用）。 */
  pill: string;
  /** 胶囊名 = Products 里的门票 tour type。 */
  tourTypeLabel: string;
  onClose: () => void;
  onSent: () => void;
  onUnauthorized: () => void;
  /** G129：缺 Cfm # 的单，staff 在确认条上点了 Send anyway：照发，确认号栏留空（订单号进 send_anyway）。 */
  noCfmOrders?: string[];
}) {
  // 打开时拍一份（同上）。
  const [snapshot] = useState(rowsProp);
  const rows = useSendTableRows(date, "tickets", pill, snapshot);
  const [run, setRun] = useState<RunState | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [anyway, setAnyway] = useState<string[]>([]);
  const [sendType, setSendType] = useState<TicketsSendType>("combined");
  const isAlive = useAlive();
  useLeaveGuard(sending);
  const alreadySent = rows.filter((r) => sentAt(r, "tickets"));
  const choice = useSendChoice("tickets");
  const ticked = rows.filter((r) => choice.chosen(r));

  async function go(
    picked: ManifestRow[],
    extra: { send_anyway?: string[]; preview_at?: string },
  ) {
    setSending(true);
    setError("");
    const batches = chunk(picked, SEND_BATCH_SIZE).map((part) => ({
      rows: part,
      run: (x: { send_anyway?: string[]; preview_at?: string }) =>
        sendManifestTickets({
          date,
          row_keys: part.map((r) => r.row_key),
          ...channelFlags(sendType),
          ...x,
        }),
    }));
    const result = await runBatches(
      batches,
      extra,
      (r) => ticketOutcomes(r, sendType),
      setRun,
      isAlive,
      onUnauthorized,
    );
    setSending(false);
    setAnyway([]);
    // 第 1 批被服务器拒：什么都没发，回到发送前，原因写在弹窗里，发送键可再点。
    if (result.stop?.retry) {
      setRun(null);
      setError(result.stop.reason);
      return;
    }
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
                className={FRAME_SECONDARY_BUTTON_CLASS}
              >
                {sending ? <Spin /> : null}
                {sending
                  ? "Sending…"
                  : `Send anyway to ${plural(anyway.length, "order")}`}
              </button>
            ) : null}
            <button
              type="button"
              disabled={sending}
              onClick={onClose}
              className={sendClass(sending)}
            >
              {sending ? <Spin /> : null}
              {sending ? "Sending…" : "Done"}
            </button>
          </>
        }
      >
        {sending ? <Progress run={run} theme="blue" /> : null}
        {run.stop ? (
          <StopBox stop={run.stop} batchIds={run.batchIds} theme="blue" />
        ) : null}
        {!sending ? (
          <>
            <ResultNumbers run={run} failed={failed} />
            <div role="status" className={OK_BOX}>
              {plural(run.sent, "order")} sent.
              {failed ? ` ${failed} not sent by SMS or email, see below.` : ""}
              {run.skipped.length ? ` ${run.skipped.length} skipped.` : ""} Sent
              rows move to the bottom of the list.
            </div>
          </>
        ) : null}
        {!sending && !run.stop ? (
          <ViewSendLinks ids={run.batchIds} theme="blue" />
        ) : null}
        <OutcomeTable heads={["Email", "SMS"]} outcomes={run.outcomes} />
        <AnywayPicker
          skipped={run.skipped}
          picked={anyway}
          onPick={setAnyway}
          disabled={sending}
        />
      </DialogFrame>
    );
  }

  return (
    <DialogFrame
      titleId={titleId}
      title="Send reminder"
      busy={sending}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            disabled={sending}
            onClick={onClose}
            className={FRAME_SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ticked.length || sending}
            onClick={() => {
              const extra = anywayExtra(ticked, choice, "tickets");
              // 缺 Cfm # 且还没发过的单：订单号放进 send_anyway（后端不需要 preview_at）。
              const over = noCfmOrders.filter((o) =>
                ticked.some(
                  (r) => r.order_number === o && !sentAt(r, "tickets"),
                ),
              );
              void go(
                ticked,
                over.length
                  ? {
                      ...extra,
                      send_anyway: [
                        ...new Set([...(extra.send_anyway ?? []), ...over]),
                      ],
                    }
                  : extra,
              );
            }}
            className={sendClass(sending)}
          >
            {sending ? <Spin /> : null}
            {sending
              ? "Sending…"
              : `${SEND_ICON[sendType]} Send ${plural(ticked.length, "reminder")} (${sendTypeShort(sendType)})`}
          </button>
        </>
      }
    >
      <p>
        {plural(distinctOrders(rows).length, "order")} · tour type:{" "}
        {tourTypeLabel}. The reminder uses the Cfm # shown on the page and goes
        out by{" "}
        {sendType === "sms"
          ? "SMS only"
          : sendType === "email"
            ? "email only"
            : "SMS and email"}
        .
      </p>
      <GuestTable label="Guests" rows={rows} tab="tickets" choice={choice} />
      <SendTypePicker
        types={SEND_TYPES}
        value={sendType}
        onChange={setSendType}
      />
      {error ? (
        <p role="alert" className={ERR_BOX}>
          {error}
        </p>
      ) : null}
      {noCfmOrders.length ? (
        <div data-send-anyway-note className={NOTE_BOX}>
          No Cfm # for {noCfmOrders.join(", ")}.{" "}
          {noCfmOrders.length === 1 ? "It goes" : "They go"} out with the Cfm #
          left blank. This is recorded in Send Log.
        </div>
      ) : null}
      {alreadySent.length ? (
        <div className={NOTE_BOX}>
          Already sent (highlighted): {alreadySent.length}. They are skipped
          unless you tick Send anyway.
        </div>
      ) : null}
    </DialogFrame>
  );
}
