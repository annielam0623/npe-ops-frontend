/**
 * 任务框（Dashboard 改版任务包阶段三）。后端 G131 已上线（2026-10-22），形状以后端
 * docs/interfaces/tasks-box-phase3-2026-10-21.md 和 app/routers/tasks.py 为准。
 * 新模型（Annie 2026-10-21）：任务按时间段匹配在班的人，不再按具名岗位，所以响应里的 `role` 恒为 null
 * （字段还在、没人读）。
 */

export type TaskPriority = "high" | "moderate" | "low";

/** 频率（阶段三范围）：每天 / 每小时 / 每 N 天 / 有空时。 */
export type TaskFrequency = "daily" | "hourly" | "every_n_days" | "when_free";

/** 任务模板：主管 / admin 管理，改动从下一次生成每日任务起生效。 */
export interface TaskTemplate {
  id: number;
  title: string;
  priority: TaskPriority;
  /** 时间段 "HH:MM"（洛杉矶）：班次和这一段有重叠的人能看到；两个都是 null = 全班（All shift）。hourly 必填。 */
  window_start_time: string | null;
  window_end_time: string | null;
  /** 从到岗 / 开始算的时限（分钟），用不到就是 null。 */
  time_limit_minutes: number | null;
  frequency: TaskFrequency;
  /** frequency = "every_n_days" 时的 N。 */
  frequency_every_n_days: number | null;
  /** 点了跳转的页面，比如 "/dispatch"；没有就是 null。 */
  link_href: string | null;
  link_label: string | null;
  /** 2026-10-14 Work Checklist「Duty」列的原文，只是说明，不影响谁能看到。 */
  duty_note: string | null;
  is_active: boolean;
  sort_order: number;
}

/**
 * 交接记录：没做完的任务交给下一班，下一班只能 Accept。接受前任务仍在交出的人名下
 * （`DailyTask.assigned_to_username` 不变），`to_username` 只是「正发给谁」；
 * 接受后 `assigned_to_username` 才换成 `to_username`（任务包第 21 条）。
 */
export interface TaskPassOver {
  from_username: string;
  from_display_name: string;
  /** 恒为 null（不再按岗位）。 */
  from_role: null;
  to_username: string;
  to_display_name: string;
  note: string;
  at: string;
  accepted_at: string | null;
  accepted_by_username: string | null;
  accepted_by_display_name: string | null;
}

/** 当天生成的一条任务（模板生成的，或主管临时加的一次性 / 指定任务）。 */
export interface DailyTask {
  id: number;
  template_id: number | null;
  title: string;
  /** 恒为 null（不再按岗位）。 */
  role: null;
  /** null = 全班共用（时间段和谁的班次重叠谁就能看到、都能勾）；有值 = 指定给具体某人。 */
  assigned_to_username: string | null;
  assigned_to_display_name: string | null;
  priority: TaskPriority;
  /** ISO 时间（洛杉矶），没有截止时间为 null。有值时前端自己算「还有 N 分钟 / 已超时」，不用后端拼好的字符串。 */
  due_at: string | null;
  frequency: TaskFrequency;
  /** due_at 为 null 时给人看的说明，比如 "All shift"、"When free"；due_at 有值时为 ""（前端自己拼）。 */
  due_note: string;
  done: boolean;
  done_by_username: string | null;
  done_by_display_name: string | null;
  done_at: string | null;
  link_href: string | null;
  link_label: string | null;
  /** 交接中或交接记录（接受后仍保留在当天清单里，见任务包第 21 条）。 */
  pass_over: TaskPassOver | null;
}

/** 今天在岗的一个人（排班推出来的岗位，没有固定岗位的人 role 为 null，见第 16 条「没有固定清单的人」）。 */
export interface StaffShiftToday {
  /** admin_users.id（后端 G160 起带；前端指定人时传 username，这个字段暂时用不到）。 */
  admin_user_id?: number;
  username: string;
  display_name: string;
  role: null;
  shift_start: string;
  shift_end: string;
  /** 这个人下一班是谁（交接对象），Closer 的下一班是第二天的 Opening。 */
  next_username: string | null;
  next_display_name: string | null;
}

export interface TasksToday {
  date: string;
  /** 服务器现在几点（ISO，洛杉矶），倒计时 / 超时判断都按它算，不用浏览器本机时间。 */
  now: string;
  is_supervisor_view: boolean;
  me: {
    username: string;
    display_name: string;
    role: null;
    shift_start: string | null;
    shift_end: string | null;
  };
  /** 今天的排班（供「谁是下一班」「按岗位分组」用）。 */
  shifts: StaffShiftToday[];
  /** 员工视角：只有自己的任务；主管视角：全部。 */
  tasks: DailyTask[];
  /** 待我接受的交接（只在员工视角出现在自己名下）。 */
  pending_pass_overs: DailyTask[];
  /** 主管视角：交接通知（发出 / 接受都算一条）。 */
  pass_over_notices?: TaskPassOverNotice[];
}

export interface TaskPassOverNotice {
  id: number;
  task_title: string;
  from_display_name: string;
  to_display_name: string;
  at: string;
  accepted: boolean;
}
