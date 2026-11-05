/**
 * 定时自动发送的设置（后端 auto-send，G76，Annie 2026-10-14 定；接口说明 docs/interfaces/auto-send-2026-10-15.md）。
 * 时间都是洛杉矶时间 24 小时制 "HH:MM"。
 */
export interface AutoSendConfig {
  tour: {
    /** 巴士团确认总开关（后端 2026-10-16 拆分：原来的顶层 enabled 拆成这团各自一个）。 */
    enabled: boolean;
    times: string[];
    /** 团期前几天开始发（发到团期前 1 天，团期当天不发）。 */
    days_before: number;
    /** 跳过的单发邮件给这些人（每单只报一次）。 */
    alert_emails: string[];
    /**
     * 置顶 89（Annie 2026-11-05「Auto Send 都选 A。动手」，preview BYv5FXVG7FqYuQ7gFEpV1a v3）：当天最后一批之前每批最多发几单，
     * 最后一批发剩下的全部。⏳ 前端拟的键，等后端定；旧后端没有 ⇒ 页面不出这一格。
     */
    max_per_batch?: number;
  };
  tickets: {
    /** 门票提醒总开关（门票汇总邮件跟着这个开关走）。 */
    enabled: boolean;
    times: string[];
    /** service date 前几天开始发（只发有 Cfm # 的）。 */
    days_before: number;
    /** 前一天几点发汇总邮件。 */
    summary_time: string;
    summary_emails: string[];
    // ── 置顶 89（⏳ 前端拟的键，等后端定；旧后端没有 ⇒ 对应的格不出，页面跟以前一样）──
    /** 按门票团设提前几天：一行一组，一个团只能在一组；不在任何一组的团用 days_before。 */
    lead_groups?: AutoSendLeadGroup[];
    /** 当天最后一批之前每批最多发几单（所有门票团合计，接客时间早的先发）；最后一批发剩下的全部。 */
    max_per_batch?: number;
    /** 每日报告：当天最后一批跑完后一封（没发出去的单 + 原因 + Action），默认关。有它时不出 Day-before summary 两格。 */
    daily_report?: { enabled: boolean; emails: string[] };
  };
}

export interface AutoSendLeadGroup {
  days_before: number;
  /** tix_tour_types.key */
  ticket_types: string[];
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
