import { apiFetch } from "@/lib/api-client";
import type {
  RangeChangesBody,
  RangeChangesResult,
  ScheduleRange,
} from "@/types/schedule-overview";

/*
 * G382 排班总览的两条新接口（后端 interface.md 2.1 / 2.2，task/g382-hr-schedule @ 77404fa0）。
 * 出错原话照 lib/schedule-leave-api.ts 的 leaveErrorOf / leaveErrorText 读（409 rule_violation / coverage_gap /
 * locked / stale 都是 {detail: {detail, code, …}}）。
 */

/** 连续几周（from 必须是周日，weeks 1–8）。403 = 不能打开总览。 */
export function fetchScheduleRange(
  from: string,
  weeks: number,
  signal?: AbortSignal,
): Promise<ScheduleRange> {
  return apiFetch<ScheduleRange>("/api/schedule/range", {
    query: { from, weeks },
    cache: "no-store",
    signal,
  });
}

/** 跨周一次保存（schedule.edit）：一个事务，全成或全不成；有新违规 409 rule_violation，没有绕过的参数（Q4 A）。 */
export function saveScheduleRange(
  body: RangeChangesBody,
): Promise<RangeChangesResult> {
  return apiFetch<RangeChangesResult>("/api/schedule/range/changes", {
    method: "POST",
    body,
  });
}
