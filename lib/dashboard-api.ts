import { apiFetch } from "@/lib/api-client";
import type { MultiAssignResult, MultiReplyResult, UnhandledMessages } from "@/types";

/** staff 及以上可调；纯读。未登录抛 401 的 ApiError。 */
export function fetchUnhandledMessages(
  signal?: AbortSignal,
): Promise<UnhandledMessages> {
  return apiFetch<UnhandledMessages>("/api/notifications/unhandled", {
    cache: "no-store",
    signal,
  });
}

// ── Multi Orders 卡片上的三个动作（号码 / 邮箱名下有 ≥2 张没出发的单、来信不挂单的对话）──
// 不在 /api 下，host 不认库里没有的地址一律 404（见后端 booking_notes.py 的说明）。
// ⚠️ reply 会真实发短信 / 邮件给客人。

export function postMultiReply(
  address: string,
  body: string,
): Promise<MultiReplyResult> {
  return apiFetch<MultiReplyResult>("/booking-notes/multi/reply", {
    method: "POST",
    body: { address, body },
  });
}

export function postMultiAssign(
  address: string,
  orderNumber: string,
): Promise<MultiAssignResult> {
  return apiFetch<MultiAssignResult>("/booking-notes/multi/assign", {
    method: "POST",
    body: { address, order_number: orderNumber },
  });
}

/** 不传 orderNumber：仅当这个地址名下已经没有没出发的单时允许（后端校验）。 */
export function postMultiTakeAction(
  address: string,
  orderNumber?: string,
): Promise<MultiAssignResult> {
  return apiFetch<MultiAssignResult>("/booking-notes/multi/take-action", {
    method: "POST",
    body: { address, order_number: orderNumber ?? null },
  });
}
