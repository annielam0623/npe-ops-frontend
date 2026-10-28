"use client";

import { useState } from "react";

import { ChannelIcon, WhatsAppWindowPill } from "@/components/ui/channel-icon";
import { describeError, isStatus } from "@/lib/api-errors";
import { channelKey, isInbound, whatsappWindow } from "@/lib/channels";
import {
  postMultiAssign,
  postMultiReply,
  postMultiTakeAction,
} from "@/lib/dashboard-api";
import { usePermissions } from "@/lib/staff-permissions";
import { cn } from "@/lib/utils";
import type { MultiOrderOption, UnhandledMessage } from "@/types";

import { describeWaiting, formatOrderDates } from "./config";

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "email",
};

/** 不挂单的对话 / 不是一张卡该走的字段都在时才渲染；缺任何一样说明数据不对，不画半张卡。 */
type UnassignedItem = UnhandledMessage & {
  kind: "unassigned";
  address: string;
  orders: MultiOrderOption[];
  thread: {
    author: string;
    body: string;
    direction: string;
    failed: boolean;
  }[];
};

type Mode = "reply" | "assign" | "take" | null;

/**
 * dashboard「Multi Orders」窗口里不挂单的那种卡（号码 / 邮箱名下 ≥2 张没出发的单，
 * 来信不挂单）。先 Reply 问清楚是哪张单，再 Assign；不用回的 Take action。
 * ⚠️ Send → 会真实发短信 / 邮件给客人。
 *
 * 本地状态（展开的面板、草稿、选中的单）就放组件自己身上：父组件每 60 秒轮询一次新数据，
 * 只要这张卡的 `address` 还在列表里、React 用同一个 key 复用这个组件实例，草稿和展开状态
 * 天然不会被下一轮数据覆盖——不用像旧版手工在整块重画前后搬运 DOM 状态。
 */
export function MultiOrderCard({
  item,
  today,
  now,
  onChanged,
  onUnauthorized,
}: {
  item: UnassignedItem;
  /** 洛杉矶的今天，YYYY-MM-DD——判「这张单最近的团期是不是今天」用它，不用浏览器本地日期。 */
  today: string;
  now: number;
  /** 发送 / 转单 / Take action 成功：触发父组件立即重新拉取（不用等下一轮 60 秒）。 */
  onChanged: () => void;
  onUnauthorized: () => void;
}) {
  // Reply / Assign / Take action 都按 messages.reply（后端 d7 53a1a39d）；没有就只看。
  const canReply = usePermissions().canMessages("messages.reply");
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  function openMode(next: Mode) {
    setMode(next);
    setText("");
    setPicked(null);
    setError("");
  }

  /** 字符串原样显示（例如「Not sent」那句固定文案）；接口错误走 describeError 取 detail。 */
  function fail(err: unknown) {
    setSending(false);
    setError(typeof err === "string" ? err : describeError(err));
  }

  async function guard<T>(run: () => Promise<T>): Promise<T | undefined> {
    setSending(true);
    setError("");
    try {
      const result = await run();
      setSending(false);
      return result;
    } catch (err) {
      if (isStatus(err, 401)) {
        onUnauthorized();
        return undefined;
      }
      fail(err);
      return undefined;
    }
  }

  async function handleTakeTop() {
    if (item.orders.length > 0) {
      openMode("take");
      return;
    }
    const result = await guard(() => postMultiTakeAction(item.address));
    if (result) {
      openMode(null);
      onChanged();
    }
  }

  async function handleSend() {
    const body = text.trim();
    if (!body) {
      setError("Type a message first.");
      return;
    }
    const result = await guard(() => postMultiReply(item.address, body));
    if (!result) return;
    if (result.status === "sent") {
      openMode(null);
      onChanged();
      return;
    }
    fail("Not sent. The message did not go out; try again or call the guest.");
  }

  async function handleMove() {
    if (!picked) {
      setError("Pick an order first.");
      return;
    }
    const result = await guard(() => postMultiAssign(item.address, picked));
    if (result) {
      openMode(null);
      onChanged();
    }
  }

  async function handleClose() {
    if (!picked) {
      setError("Pick an order first.");
      return;
    }
    const result = await guard(() => postMultiTakeAction(item.address, picked));
    if (result) {
      openMode(null);
      onChanged();
    }
  }

  const channel = channelKey(item.channel, item.direction);
  const win =
    item.channel === "whatsapp"
      ? whatsappWindow(item.created_at, item.fallback_channel, now)
      : null;
  const replyChannelLabel =
    CHANNEL_LABEL[item.reply_channel ?? ""] ?? item.reply_channel ?? "";

  return (
    <div
      data-address={item.address}
      className={cn(
        "rounded-xl border border-white/[.09] bg-white/[.022] px-3.5 pt-3 pb-[13px]",
        item.channel === "whatsapp" && "shadow-[inset_3px_0_0_#25d366]",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {/* 红点 = 还欠着回应；绿点 = 我们已经回过、在等客人（Annie 2026-10-24 全站规则）。 */}
        <span
          aria-hidden
          data-status-dot={item.waiting ? "handled" : "unhandled"}
          className={cn(
            "size-2 shrink-0 self-center rounded-full",
            item.waiting ? "bg-[#28a745]" : "bg-[#dc3545]",
          )}
        />
        <span className="text-[12.5px] font-semibold">
          {item.name || item.address}
        </span>
        {item.name ? (
          <span className="font-mono text-xs text-white/60">
            {item.address}
          </span>
        ) : null}
      </div>

      <div className="mt-1.5 mb-[9px] flex flex-wrap items-center gap-[7px]">
        <span className="rounded-full border border-[#ec4899]/[.34] bg-[#ec4899]/[.13] px-[7px] py-0.5 text-[10.5px] font-bold">
          {item.orders.length} orders
        </span>
        <span aria-hidden className="text-[10px] text-white/40">
          ·
        </span>
        {win ? (
          <>
            <WhatsAppWindowPill win={win} dark />
            <span aria-hidden className="text-[10px] text-white/40">
              ·
            </span>
          </>
        ) : null}
        {item.waiting ? (
          <span className="inline-flex items-center gap-[7px]">
            {channel ? <ChannelIcon channel={channel} dark /> : null}
            <span className="text-[11.5px] font-semibold text-white/60">
              Replied · waiting for guest
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-[7px]">
            {channel ? <ChannelIcon channel={channel} dark /> : null}
            <span className="text-[11.5px] font-semibold text-[#fbbf24] tabular-nums">
              {describeWaiting(item, now)}
            </span>
          </span>
        )}
      </div>

      {/* 只有一句时显示截断正文；staff 已经回过（thread 有来回）就显示整段，Assign 前要看全。 */}
      {item.thread.length > 1 ? (
        <div className="mt-0.5 flex flex-col gap-1.5">
          {item.thread.map((m, i) => {
            const staff = !isInbound(m.direction);
            return (
              <div
                key={i}
                className={cn(
                  "rounded-lg px-[9px] py-1.5 text-[13px] leading-[1.5] [overflow-wrap:anywhere]",
                  staff ? "bg-[#38bdf8]/10" : "bg-white/[.04]",
                )}
              >
                <span className="block text-[10.5px] font-bold tracking-[.05em] text-white/40 uppercase">
                  {staff ? m.author || "Staff" : "Guest"}
                  {m.failed ? (
                    <>
                      {" "}
                      · <span className="text-[#f87171]">Not sent</span>
                    </>
                  ) : null}
                </span>
                {m.body}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="line-clamp-3 text-[13.5px] leading-[1.55] [overflow-wrap:anywhere] text-[#f8fafc]">
          {item.body}
        </p>
      )}

      {mode === "assign" || mode === "take" ? (
        <OrderPicker
          orders={item.orders}
          today={today}
          picked={picked}
          onPick={setPicked}
          sending={sending}
          error={error}
          legend={
            mode === "take"
              ? "Which order should this be filed under?"
              : "Which order is this about?"
          }
          primaryLabel={mode === "take" ? "Close under this order" : "Move"}
          onPrimary={mode === "take" ? handleClose : handleMove}
          onCancel={() => openMode(null)}
        />
      ) : (
        <>
          <ul className="mt-2.5 list-none border-t border-white/[.08] pl-0">
            {item.orders.map((o) => (
              <OrderRow key={o.order_number} order={o} today={today} />
            ))}
          </ul>
          {mode === "reply" ? (
            <div className="mt-2.5 flex flex-col gap-[7px]">
              <label
                htmlFor={`mo-text-${item.address}`}
                className="text-[11.5px] text-white/60"
              >
                Reply via {replyChannelLabel} to {item.address}
              </label>
              <textarea
                id={`mo-text-${item.address}`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={sending}
                autoFocus
                className="min-h-16 w-full resize-y rounded-lg border border-white/[.18] bg-black/25 px-2.5 py-2 text-[13px] text-[#f8fafc] outline-none disabled:opacity-60"
              />
              {error ? (
                <p role="alert" className="text-xs text-[#f87171]">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <MoButton primary onClick={handleSend} disabled={sending}>
                  Send
                </MoButton>
                <MoButton
                  link
                  onClick={() => openMode(null)}
                  disabled={sending}
                >
                  Cancel
                </MoButton>
              </div>
            </div>
          ) : canReply ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              <MoButton onClick={() => openMode("reply")} disabled={sending}>
                Reply
              </MoButton>
              <MoButton onClick={() => openMode("assign")} disabled={sending}>
                Assign to order
              </MoButton>
              <MoButton
                link
                onClick={() => void handleTakeTop()}
                disabled={sending}
              >
                Take action
              </MoButton>
              {error ? (
                <p role="alert" className="w-full text-xs text-[#f87171]">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function OrderRow({
  order,
  today,
}: {
  order: MultiOrderOption;
  today: string;
}) {
  const soon = order.dates[0] === today;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/[.06] py-[7px] text-[12.5px] last:border-b-0">
      <span className="font-mono text-xs">{order.order_number}</span>
      <span className="min-w-0 flex-1 text-white/60">{order.trip}</span>
      <span
        className={cn(
          "tabular-nums",
          soon ? "font-semibold text-[#fbbf24]" : "text-white/60",
        )}
      >
        {formatOrderDates(order.dates, today)}
      </span>
    </li>
  );
}

function OrderPicker({
  orders,
  today,
  picked,
  onPick,
  sending,
  error,
  legend,
  primaryLabel,
  onPrimary,
  onCancel,
}: {
  orders: MultiOrderOption[];
  today: string;
  picked: string | null;
  onPick: (value: string) => void;
  sending: boolean;
  error: string;
  legend: string;
  primaryLabel: string;
  onPrimary: () => void;
  onCancel: () => void;
}) {
  return (
    <fieldset className="mt-2.5 flex flex-col gap-1.5 rounded-lg border border-[#ec4899]/40 bg-[#ec4899]/[.08] px-[11px] py-[9px]">
      <legend className="px-1 text-xs font-semibold">{legend}</legend>
      {orders.map((o, i) => {
        const id = `mo-pick-${i}-${o.order_number}`;
        const soon = o.dates[0] === today;
        return (
          <label
            key={o.order_number}
            htmlFor={id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]"
          >
            <input
              id={id}
              type="radio"
              name={`mo-pick-${orders.map((x) => x.order_number).join("-")}`}
              value={o.order_number}
              checked={picked === o.order_number}
              onChange={() => onPick(o.order_number)}
              className="accent-[#ec4899]"
              disabled={sending}
            />{" "}
            <span className="font-mono text-xs">{o.order_number}</span>
            <span className="text-white/60">{o.trip}</span>
            <span
              className={cn(
                "tabular-nums",
                soon ? "font-semibold text-[#fbbf24]" : "text-white/60",
              )}
            >
              {formatOrderDates(o.dates, today)}
            </span>
          </label>
        );
      })}
      {error ? (
        <p role="alert" className="text-xs text-[#f87171]">
          {error}
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-2">
        <MoButton primary onClick={onPrimary} disabled={sending}>
          {primaryLabel}
        </MoButton>
        <MoButton link onClick={onCancel} disabled={sending}>
          Cancel
        </MoButton>
      </div>
    </fieldset>
  );
}

function MoButton({
  primary,
  link,
  disabled,
  onClick,
  children,
}: {
  primary?: boolean;
  link?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "cursor-pointer rounded-md text-[11.5px] font-semibold disabled:cursor-default disabled:opacity-50",
        link
          ? "border-0 bg-transparent px-0.5 py-1 text-[#f9a8d4] hover:text-[#fbcfe8]"
          : primary
            ? "border border-[#ec4899]/60 bg-[#ec4899]/[.18] px-2.5 py-1 text-[#fbcfe8] hover:bg-[#ec4899]/[.28]"
            : "border border-white/[.18] bg-white/[.05] px-2.5 py-1 text-[#f8fafc] hover:bg-white/[.1]",
      )}
    >
      {children}
    </button>
  );
}
