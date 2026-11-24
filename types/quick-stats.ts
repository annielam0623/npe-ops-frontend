/**
 * G373 Quick Stats（后端 app/routers/quick_stats.py、app/services/quick_stats.py，main 86ae0933）。
 * 每个接口只给 Super Admin（别人 403）；没设置好（API key / 只读账号）503。
 */

export type QuickStatsOutcome = "ok" | "refused" | "error";

/** 结果里的格子：JSON 标量；日期是 "YYYY-MM-DD"；可能 null。 */
export type QuickStatsCell = string | number | boolean | null;

export interface QuickStatsCard {
  id: number;
  title: string;
  question: string;
  sql: string;
  explanation: string;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** POST /ask、POST /cards/{id}/run（后者多一个 card）。 */
export interface QuickStatsRunResult {
  log_id: number | null;
  question: string;
  sql: string;
  explanation: string;
  tables: string[];
  outcome: QuickStatsOutcome;
  /** 被拒 / 出错的原因，原样显示。 */
  message: string;
  columns: string[];
  rows: QuickStatsCell[][];
  row_count: number;
  /** 超过 5,000 行上限。 */
  truncated: boolean;
  duration_ms: number | null;
  card?: QuickStatsCard;
}

export type QuickStatsLogSource = "ask" | "card" | "export";

export interface QuickStatsLogRow {
  id: number;
  asked_at: string | null;
  username: string | null;
  source: QuickStatsLogSource | string;
  card_id: number | null;
  question: string;
  sql: string | null;
  sql_text?: string | null;
  explanation: string | null;
  outcome: "started" | QuickStatsOutcome | string;
  row_count: number | null;
  truncated: boolean | null;
  duration_ms: number | null;
  error: string | null;
}
