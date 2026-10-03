import { apiFetch } from "@/lib/api-client";
import type {
  BookingNote,
  BookingNotes,
  NoteCreate,
  NoteLine,
  TakeActionResult,
} from "@/types";

/**
 * 三个 tracking 页共用的对话接口。
 * ⚠️ /booking-notes/* 不在 /api 下，next.config.ts 只给 /booking-notes/by-order/:order 和
 * /booking-notes/:id 两条加了转发。
 */
function notesPath(orderNumber: string): string {
  return `/booking-notes/by-order/${encodeURIComponent(orderNumber)}`;
}

/** 一单的对话（按时间正序）。line 不传 = 不分线（tour / 门票页旧行为）。 */
export function fetchBookingNotes(
  orderNumber: string,
  line: NoteLine | undefined,
  signal?: AbortSignal,
): Promise<BookingNotes> {
  return apiFetch<BookingNotes>(notesPath(orderNumber), {
    cache: "no-store",
    signal,
    query: { line },
  });
}

/**
 * 写一条备注或发给客人。⚠️ send_sms / send_email 为 true 时会**真实发送**；
 * 结果看返回的 note.sms_status / email_status（不是 "sent" 就是没发出去）。
 */
export async function createBookingNote(
  orderNumber: string,
  payload: NoteCreate,
): Promise<BookingNote> {
  const result = await apiFetch<{ note: BookingNote }>(notesPath(orderNumber), {
    method: "POST",
    body: payload,
  });
  return result.note;
}

/**
 * 门票单的对话：按 tickets_reminders.id 取（后端再换成 CHD 号），不分线，
 * 只返回 notes（没有 guest_note / action_taken_by，这两项用表格行里的）。
 */
export async function fetchTicketNotes(
  ticketId: number,
  signal?: AbortSignal,
): Promise<BookingNote[]> {
  const result = await apiFetch<{ notes: BookingNote[] }>(
    `/booking-notes/${ticketId}`,
    { cache: "no-store", signal, query: { source: "tickets" } },
  );
  return result.notes;
}

/** 门票单写备注 / 发给客人。回信邮件的 Reply-To 是门票组的邮箱（后端按 source 定）。 */
export async function createTicketNote(
  ticketId: number,
  payload: Omit<NoteCreate, "line">,
): Promise<BookingNote> {
  const result = await apiFetch<{ note: BookingNote }>(
    `/booking-notes/${ticketId}`,
    { method: "POST", body: payload, query: { source: "tickets" } },
  );
  return result.note;
}

/**
 * Take action 是开关：没处理 → 记成本人处理；已处理 → 清掉。只写库，不发消息。
 * 门票单传 source="tickets"（id 是 tickets_reminders.id，不是 bookings.id）。
 */
export function toggleTakeAction(
  id: number,
  source?: "tickets",
): Promise<TakeActionResult> {
  return apiFetch<TakeActionResult>(`/api/bookings/${id}/take-action`, {
    method: "PUT",
    query: { source },
  });
}
