import { apiFetch } from "@/lib/api-client";
import type { ScheduleHistory } from "@/types/schedule-history";

/**
 * 这个人这一周的往来记录（要 schedule.edit；后端 ef task/schedule-person-history，还没上 main）。
 * 404 = 这一周没发布 / 没这个人 / 后端还没上；403 = 没权限。调用方照这两种不显示。
 */
export function fetchPersonHistory(
  weekStart: string,
  employeeId: number,
  signal?: AbortSignal,
): Promise<ScheduleHistory> {
  return apiFetch<ScheduleHistory>(
    `/api/schedule/weeks/${weekStart}/employees/${employeeId}/history`,
    { cache: "no-store", signal },
  );
}
