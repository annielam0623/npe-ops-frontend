import { apiFetch } from "@/lib/api-client";
import type {
  FieldCalendarAll,
  FieldCalendarOne,
  FieldSnapshot,
} from "@/types/hr-working-record";

/**
 * Human Resource › Working Record（置顶 86）。后端 18 定的形状，没上线时这两个接口 404。
 * 日历权限 settings.hr.view（≤ 93 天）；快照权限同 Live drivers（morning.view + 开关 morning_live_drivers）。
 */

/** 所有人（不带 hr_id）：周表、按月叠的周表、Export 用。 */
export function fetchFieldCalendarAll(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<FieldCalendarAll> {
  return apiFetch<FieldCalendarAll>("/api/field-calendar", {
    cache: "no-store",
    signal,
    query: { from, to },
  });
}

/** 一个人（点名字看月历）。 */
export function fetchFieldCalendarOne(
  hrId: number,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<FieldCalendarOne> {
  return apiFetch<FieldCalendarOne>("/api/field-calendar", {
    cache: "no-store",
    signal,
    query: { hr_id: hrId, from, to },
  });
}

/** 那天的快照；version 不带 = 最新一版。没有 ⇒ 404「No snapshot for that day.」。 */
export function fetchFieldSnapshot(
  hrId: number,
  date: string,
  kind: "driver" | "guide",
  version?: number,
  signal?: AbortSignal,
): Promise<FieldSnapshot> {
  return apiFetch<FieldSnapshot>(`/api/field-snapshots/${hrId}`, {
    cache: "no-store",
    signal,
    query: { date, kind, ...(version ? { version } : {}) },
  });
}
