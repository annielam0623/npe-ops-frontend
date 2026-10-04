export type OpsRange = "today" | "week" | "month" | "custom";

export interface ChannelStats {
  total: number;
  success: number;
  failed: number;
}

/** 每个模块固定三个渠道（email / sms / both），没有数据的是 0。 */
export type SendStats = Record<string, Record<string, ChannelStats>>;

export interface TourResponseStats {
  total: number;
  yes: number;
  modify: number;
  pending: number;
  avg_hours_yes: number | null;
  avg_hours_modify: number | null;
  pct_yes: number;
  pct_modify: number;
  pct_pending: number;
}

export interface TicketsResponseStats {
  total: number;
  yes: number;
  pending: number;
  pct_yes: number;
  pct_pending: number;
}

export interface MorningResponseStats {
  total: number;
  checked_in: number;
  not_yet: number;
  pct_checked_in: number;
  pct_not_yet: number;
}
