import { apiFetch } from "@/lib/api-client";
import type { ActionLogPage } from "@/types";

export const ACTION_LOG_PAGE_SIZE = 50;

/**
 * G203 共用读接口（后端 B1）：`GET <path>?before=<next_cursor>&limit=50` → `{entries, next_cursor}`，新的在上，
 * 按保存翻页（同一次保存的几行一定在同一页）。没权限 403，面板显示「You don't have access…」。
 */
export function fetchActionLog(
  path: string,
  before: string | null,
  signal?: AbortSignal,
  /** 接口自己要的参数（例如 Dispatch 的 `date`）。 */
  extra?: Record<string, string>,
): Promise<ActionLogPage> {
  return apiFetch<ActionLogPage>(path, {
    cache: "no-store",
    signal,
    query: {
      ...extra,
      limit: ACTION_LOG_PAGE_SIZE,
      ...(before ? { before } : {}),
    },
  });
}
