import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/types";
import type {
  QuickStatsCard,
  QuickStatsLogRow,
  QuickStatsRunResult,
} from "@/types/quick-stats";

/** G373 Quick Stats：每个接口只给 Super Admin（别人 403）；没设置好 503（detail 原样显示）。 */
const API = "/api/quick-stats";

/** 后端一次最多返回的行数（超过 ⇒ truncated）。 */
export const QUICK_STATS_ROW_CAP = 5000;
/** 问题最长多少字（后端 400）。 */
export const QUICK_STATS_MAX_QUESTION = 1000;
/** History 每次多拿 50 条，接口最多 200。 */
export const QUICK_STATS_HISTORY_STEP = 50;
export const QUICK_STATS_HISTORY_MAX = 200;

/** 提问：后端交给 Claude 写一条只读 SELECT，用只读账号跑。可能要几秒到一两分钟。 */
export function askQuickStats(question: string): Promise<QuickStatsRunResult> {
  return apiFetch<QuickStatsRunResult>(`${API}/ask`, {
    method: "POST",
    cache: "no-store",
    body: { question },
  });
}

export function fetchQuickStatsHistory(
  limit: number,
  signal?: AbortSignal,
): Promise<{ items: QuickStatsLogRow[] }> {
  return apiFetch<{ items: QuickStatsLogRow[] }>(`${API}/history`, {
    cache: "no-store",
    signal,
    query: { limit },
  });
}

export function fetchQuickStatsCards(
  signal?: AbortSignal,
): Promise<{ cards: QuickStatsCard[] }> {
  return apiFetch<{ cards: QuickStatsCard[] }>(`${API}/cards`, {
    cache: "no-store",
    signal,
  });
}

/** 存成卡片（只有 outcome ok 的记录能存）：点了直接存进系统。 */
export function createQuickStatsCard(
  logId: number,
  title?: string,
): Promise<QuickStatsCard> {
  return apiFetch<QuickStatsCard>(`${API}/cards`, {
    method: "POST",
    body: title ? { log_id: logId, title } : { log_id: logId },
  });
}

export function renameQuickStatsCard(
  id: number,
  title: string,
): Promise<QuickStatsCard> {
  return apiFetch<QuickStatsCard>(`${API}/cards/${id}`, {
    method: "PATCH",
    body: { title },
  });
}

export function deleteQuickStatsCard(id: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`${API}/cards/${id}`, { method: "DELETE" });
}

/** 重跑卡片存好的 SQL，不经 AI。 */
export function runQuickStatsCard(id: number): Promise<QuickStatsRunResult> {
  return apiFetch<QuickStatsRunResult>(`${API}/cards/${id}/run`, {
    method: "POST",
    cache: "no-store",
  });
}

export function cardExportUrl(id: number): string {
  return `${API}/cards/${id}/export`;
}

export function logExportUrl(logId: number): string {
  return `${API}/log/${logId}/export`;
}

/**
 * 下载 Excel：后端用同一条 SQL 再跑一次生成 .xlsx（也记一行 History）。
 * 用 fetch 下载，失败能显示后端的原因；文件名取 Content-Disposition，没有就 quick_stats_<时间>.xlsx。
 */
export async function downloadQuickStatsExcel(
  url: string,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!res.ok) {
    throw await ApiError.fromResponse(res);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const filename =
    /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName();
  return { blob: await res.blob(), filename };
}

function fallbackName(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `quick_stats_${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}.xlsx`;
}
