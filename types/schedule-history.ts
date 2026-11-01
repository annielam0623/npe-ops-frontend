/**
 * 排班：每个人这一周的往来记录（Annie 2026-10-30「其他都同意推荐，动手」，preview https://claude.ai/artifact/T98GQ9KfQuQfrEcMv6XgzM ）。
 * 形状照后端 ef 的约定（task/schedule-person-history docs/interfaces/schedule-person-history-2026-10-30.md，还没上 main）。
 */
export type ScheduleHistoryKind =
  | "confirm_sent"
  | "published"
  | "republished"
  | "changes_sent"
  | "answered"
  | "requested"
  | "approved"
  | "declined"
  | "answer_reset"
  // G138（4e 2026-10-30 晚「最终接口」，v136 改 CHECK）：
  /** 改天上（request_kind = move）或加班（add）。 */
  | "change_requested"
  /** 提了换班，等对方回。 */
  | "swap_requested"
  /** 对方同意换班（交给排班的人）。 */
  | "swap_agreed"
  /** 对方不同意换班（结束）。 */
  | "swap_declined_by_peer"
  /** 第一次 Publish 时还没处理完，关掉了。 */
  | "request_closed_on_publish";

export interface ScheduleHistoryEvent {
  id: number;
  at: string;
  kind: ScheduleHistoryKind;
  /** null = 系统发的（周三自动确认）。 */
  by: string | null;
  /** system 灰、employee 本人（绿底）、staff = 用排班页的人（蓝字标签）。 */
  by_kind: "system" | "employee" | "staff";
  /** 当时发出去的那几行（英文原文，照原样显示）；没有是 []。 */
  lines: string[];
  /** 实际发出去的渠道；回复 / 处理是 []。 */
  channels: string[];
  /** 只有发送类有：对方收到的标题。 */
  title?: string;
  /** 只有发送类有：试过但没发出去的渠道。 */
  failed?: string[];
  /** 只有 answered。 */
  answer?: "accepted" | "wants_changes";
  /** answered / requested：从哪进来的。 */
  via?: "login" | "link";
  /** requested / approved / declined：哪天哪个班。G138：move 的目标日、add 的那天、swap 对方的那个班。 */
  request?: { date: string; shift_type: string };
  /** G138：move / add / swap。 */
  request_kind?: "move" | "add" | "swap";
  /** G138：move 原来那天的班、swap 提请求的人给出的班。 */
  from_slot?: { date: string; shift_type: string } | null;
  /** G138：换班的另一个人（提请求的人看到对方，对方看到提请求的人）。 */
  peer?: string | null;
}

export interface ScheduleHistory {
  week_start: string;
  employee_id: number;
  name: string;
  /** 从旧到新。 */
  events: ScheduleHistoryEvent[];
}
