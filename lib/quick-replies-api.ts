import { apiFetch } from "@/lib/api-client";
import type { QuickReply } from "@/types";

/**
 * Settings › Driver Quick Replies（G98，后端 d0 task/driver-messages）：全部 require_admin，其他人 403。
 * 400 的 detail 是给人看的英文，直接显示；没有这一条 404。
 */
const API = "/api/driver-quick-replies";

export const QUICK_REPLY_MAX = 80;

export async function fetchQuickReplies(
  signal?: AbortSignal,
): Promise<QuickReply[]> {
  const result = await apiFetch<{ replies: QuickReply[] }>(API, {
    cache: "no-store",
    signal,
  });
  return result.replies;
}

/** 新加的排在最后，默认开。 */
export async function createQuickReply(body: string): Promise<QuickReply> {
  const result = await apiFetch<{ reply: QuickReply }>(API, {
    method: "POST",
    body: { body },
  });
  return result.reply;
}

export async function updateQuickReply(
  id: number,
  patch: { body?: string; active?: boolean },
): Promise<QuickReply> {
  const result = await apiFetch<{ reply: QuickReply }>(`${API}/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return result.reply;
}

/** 全部 id 按新顺序；多、少、重复后端都回 400（列表过时了，要刷新）。 */
export async function reorderQuickReplies(
  ids: number[],
): Promise<QuickReply[]> {
  const result = await apiFetch<{ replies: QuickReply[] }>(`${API}/order`, {
    method: "PUT",
    body: { ids },
  });
  return result.replies;
}

export async function deleteQuickReply(id: number): Promise<void> {
  await apiFetch(`${API}/${id}`, { method: "DELETE" });
}

// 短信 GSM 03.38 基本字符集 + 扩展表（扩展表里的 { } 另外单独挡）。不在里面的（emoji、弯引号等）短信发不出去。
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^\\[~]|€";
const GSM = new Set([...GSM_BASIC, ...GSM_EXTENDED]);

/**
 * 前端先挡一道（后端照样再查）：去掉首尾空格后非空、不超过 80 字、没有 { }、都是短信发得出的字符、
 * 不和别的句子重复（不分大小写）。通过返回 null。
 */
export function quickReplyProblem(
  text: string,
  others: readonly QuickReply[],
): string | null {
  const body = text.trim();
  if (!body) return "Type the reply first.";
  if ([...body].length > QUICK_REPLY_MAX)
    return `Keep it to ${QUICK_REPLY_MAX} characters or fewer.`;
  if (/[{}]/.test(body)) return "Curly brackets { } are not allowed.";
  const bad = [...body].find((ch) => !GSM.has(ch));
  if (bad)
    return `"${bad}" can't be sent by text message. Use plain letters, numbers and punctuation.`;
  const lower = body.toLowerCase();
  if (others.some((r) => r.body.trim().toLowerCase() === lower))
    return "This reply is already in the list.";
  return null;
}
