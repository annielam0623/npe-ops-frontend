import { apiFetch } from "@/lib/api-client";
import type {
  ScheduleHistory,
  ScheduleHistoryEvent,
} from "@/types/schedule-history";

/**
 * 这个人这一周的往来记录（要 schedule.edit；后端 16 task/schedule-history，还没上 main）。
 * 404 = 这一周没发布 / 没这个人 / 后端还没上；403 = 没权限。调用方照这两种不显示。
 * 后端 _event_out 对空值（None / [] / ""）是不给这个键，不是给 null / []（44 2026-10-30）：
 * 这里统一补齐，lines / channels 缺 = []，by / peer / from_slot 缺 = null。
 */
export async function fetchPersonHistory(
  weekStart: string,
  employeeId: number,
  signal?: AbortSignal,
): Promise<ScheduleHistory> {
  const h = await apiFetch<ScheduleHistory>(
    `/api/schedule/weeks/${weekStart}/employees/${employeeId}/history`,
    { cache: "no-store", signal },
  );
  return { ...h, events: (h.events ?? []).map(normalizeEvent) };
}

function normalizeEvent(e: Partial<ScheduleHistoryEvent>): ScheduleHistoryEvent {
  return {
    ...e,
    by: e.by ?? null,
    by_kind: e.by_kind ?? "system",
    lines: e.lines ?? [],
    channels: e.channels ?? [],
    peer: e.peer ?? null,
    from_slot: e.from_slot ?? null,
  } as ScheduleHistoryEvent;
}
