"use client";

import { useEffect, useState } from "react";

import {
  emailBadgeOf as morningEmailBadge,
  smsBadgeOf as morningSmsBadge,
} from "@/components/morning-tracking/config";
import {
  emailBadgeOf as ticketsEmailBadge,
  smsBadgeOf as ticketsSmsBadge,
} from "@/components/tickets-tracking/config";
import {
  emailBadgeOf as tourEmailBadge,
  smsBadgeOf as tourSmsBadge,
} from "@/components/tour-tracking/config";
import {
  ConversationModal,
  type ConversationSource,
  type ConversationTarget,
  type ConversationTheme,
} from "@/components/ui/conversation-modal";
import { Modal } from "@/components/ui/modal";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchMorningTracking } from "@/lib/morning-tracking-api";
import { fetchTicketsTracking } from "@/lib/tickets-tracking-api";
import { fetchTourTracking } from "@/lib/tour-tracking-api";
import type { MessageLane, UnhandledMessage } from "@/types";

import { trackingHref } from "./config";

interface Loaded {
  theme: ConversationTheme;
  target: ConversationTarget;
  source: ConversationSource;
}

/** 这一栏的 tracking 页怎么读这一单（和三个 tracking 页自己打开对话时用的是同一套字段）。 */
async function loadTarget(
  lane: MessageLane,
  item: UnhandledMessage,
  signal: AbortSignal,
): Promise<Loaded | null> {
  const date = item.tour_date;
  if (lane === "morning") {
    const data = await fetchMorningTracking(date, signal);
    const row = data.rows.find((r) => r.order_number === item.order_number);
    return row
      ? {
          theme: "morning",
          source: { kind: "order", line: "morning" },
          target: {
            bookingId: row.id,
            orderNumber: row.order_number,
            guestName: row.name,
            phone: row.phone,
            email: row.email,
            smsBadge: morningSmsBadge(row.sms_status),
            emailBadge: morningEmailBadge(row.email_state),
            actionTakenBy: row.action_taken_by,
          },
        }
      : null;
  }
  if (lane === "tour") {
    const data = await fetchTourTracking(date, signal);
    const row = data.rows.find((r) => r.order_number === item.order_number);
    return row
      ? {
          theme: "tour",
          // 读这单所有线的对话、写的记成 tour（同 Tour tracking 页）。
          source: { kind: "order", line: "tour", readAllLines: true },
          target: {
            bookingId: row.id,
            orderNumber: row.order_number,
            guestName: row.guest_name || row.first_name,
            phone: row.phone,
            email: row.email,
            smsBadge: tourSmsBadge(row),
            emailBadge: tourEmailBadge(row),
            actionTakenBy: row.action_taken_by,
          },
        }
      : null;
  }
  const data = await fetchTicketsTracking(date, signal);
  const row = data.rows.find((r) => r.order_number === item.order_number);
  return row
    ? {
        theme: "tickets",
        source: { kind: "ticket" },
        target: {
          bookingId: row.id,
          orderNumber: row.order_number,
          guestName: row.guest_name,
          phone: row.phone,
          email: row.email,
          smsBadge: ticketsSmsBadge(row),
          emailBadge: ticketsEmailBadge(row),
          actionTakenBy: row.action_taken_by,
          guestForm: {
            body: row.guest_notes,
            submittedAt: row.submitted_at,
          },
        },
      }
    : null;
}

/** Multi Orders 窗口里的「一单多团期」卡不属于哪一栏：按它的 tracking 页路径认（认不出就当 Tour，巴士团）。 */
export function replyLaneOf(item: UnhandledMessage): MessageLane {
  if (item.track_url.includes("tickets-reminder")) return "tickets";
  if (item.track_url.includes("morning-pickup")) return "morning";
  return "tour";
}

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; loaded: Loaded };

/**
 * Dashboard 里点 Reply 直接弹的对话框（Annie 2026-10-24：「点击回复直接跳出对话框，不用回 tracking 页面，
 * 对话框跟 tracking 页面的对话框一模一样，只是多了 preview 的这些信息」）。
 * 就是三个 tracking 页那个 ConversationModal（同一个组件、同一套发送方式 / 接口 / 渠道），
 * 只是先按这张卡的订单号和团期把 tracking 行取出来，再多在标题下面写一行：产品 · 团期 · 渠道。
 * ⚠️ 里面的 Send → 会真实发短信 / 邮件给客人。
 */
export function ReplyDialog({
  lane,
  item,
  onClose,
  onChanged,
  onUnauthorized,
}: {
  lane: MessageLane;
  item: UnhandledMessage;
  onClose: () => void;
  /** 发了消息 / 写了备注 / Take action：Dashboard 要重拉未处理列表。 */
  onChanged: () => void;
  onUnauthorized: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    loadTarget(lane, item, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setState(loaded ? { kind: "ready", loaded } : { kind: "missing" });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [lane, item, onUnauthorized]);

  if (state.kind === "ready") {
    const { loaded } = state;
    const channel = item.channel ? item.channel : item.direction;
    const context = [
      item.trip || (item.trip_fallback ? `Pickup: ${item.trip_fallback}` : ""),
      item.tour_date ? `Tour date ${item.tour_date}` : "",
      channel ? `via ${channel}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <ConversationModal
        key={item.order_number}
        theme={loaded.theme}
        target={loaded.target}
        source={loaded.source}
        context={context}
        onClose={onClose}
        onChanged={onChanged}
        onUnauthorized={onUnauthorized}
      />
    );
  }

  return (
    <Modal titleId="reply-loading" onDismiss={onClose}>
      <h2 id="reply-loading" className="text-[15px] font-semibold">
        Order {item.order_number}
      </h2>
      {state.kind === "loading" ? (
        <p className="mt-2 text-sm text-[#1a1a1a]">Loading the conversation…</p>
      ) : (
        <>
          <p role="alert" className="mt-2 text-sm text-[#A32D2D]">
            {state.kind === "missing"
              ? `Could not find this order on the tracking page for ${item.tour_date}.`
              : `Could not load the conversation: ${state.message}`}
          </p>
          {item.track_url ? (
            <a
              href={trackingHref(item.track_url)}
              className="mt-2 inline-block text-sm font-semibold text-[#185FA5] underline"
            >
              Open the tracking page instead
            </a>
          ) : null}
        </>
      )}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}
