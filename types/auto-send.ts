/**
 * 定时自动发送的设置（后端 auto-send，G76，Annie 2026-10-14 定；接口说明 docs/interfaces/auto-send-2026-10-15.md）。
 * 时间都是洛杉矶时间 24 小时制 "HH:MM"。
 */
export interface AutoSendConfig {
  enabled: boolean;
  tour: {
    times: string[];
    /** 团期前几天开始发（发到团期前 1 天，团期当天不发）。 */
    days_before: number;
    /** 跳过的单发邮件给这些人（每单只报一次）。 */
    alert_emails: string[];
  };
  tickets: {
    times: string[];
    /** service date 前几天开始发（只发有 Cfm # 的）。 */
    days_before: number;
    /** 前一天几点发汇总邮件。 */
    summary_time: string;
    summary_emails: string[];
  };
}

export type AutoSendRunKind = "tour" | "tickets" | "tickets_summary";
export type AutoSendRunStatus = "done" | "failed" | "off" | "running";

export interface AutoSendRun {
  run_key: string;
  kind: AutoSendRunKind;
  status: AutoSendRunStatus;
  /** running 超过 2 小时（多半是中途重新部署、进程断了）：这一批不重跑，没发到的下一批发。 */
  stale?: boolean;
  started_at: string | null;
  finished_at: string | null;
  /**
   * tour: {sent, already_sent, skipped, ...}；tickets: {sent, already_sent, waiting, ...}；
   * tickets_summary: {date, status, total?, unsent?}；failed: {error}。off 时 null。
   */
  summary: Record<string, unknown> | null;
}

export interface AutoSendSettings {
  config: AutoSendConfig;
  /** false = 库里的设置读不出来，现在按关处理；保存一次就好。 */
  readable: boolean;
  /** 最近 30 批，新的在前。 */
  runs: AutoSendRun[];
}
