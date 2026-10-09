/**
 * GET /api/forecast/30-day —— 固定 30 条，从洛杉矶今天起每天一条（今天永远是第 0 条）。
 * 这一版只有总人数，不按产品 / 分类拆（后端 app/services/forecast.py）。
 */
export interface ForecastDay {
  /** YYYY-MM-DD */
  date: string;
  pax: number;
}
