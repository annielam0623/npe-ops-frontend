/** GET /api/settings/schedule 的一项班次类型；key 存进 cell.shift_type，label 显示用。两者都不写死在代码里。 */
export interface ScheduleShiftType {
  key: string;
  label: string;
  sort_order: number;
  is_active: boolean;
}

/** 工作时段：这段时间内每天必须有人在岗，判空档用；只有 superadmin 能改。 */
export interface ScheduleWorkWindow {
  /** "HH:MM"，24 小时。 */
  start_time: string;
  end_time: string;
}

/** GET /api/settings/schedule 的返回体。 */
export interface ScheduleSettings {
  work_window: ScheduleWorkWindow;
  shift_types: ScheduleShiftType[];
}

/** PUT /api/settings/schedule/work-window 的请求体（superadmin）。 */
export type ScheduleWorkWindowInput = ScheduleWorkWindow;

/** 排班里的员工（这份名单是排班自己的，不等同于后台登录账号）。 */
export interface ScheduleEmployee {
  id: number;
  name: string;
  email: string;
  is_active: boolean;
}

/** POST /api/schedule/employees 的请求体（admin / supervisor）。 */
export interface ScheduleEmployeeInput {
  name: string;
  email: string;
}

/** 一周里一个人一天的格子；没有排到的那天没有对应的 cell（等同于 Off）。 */
export interface ScheduleCell {
  employee_id: number;
  /** "YYYY-MM-DD"，落在这一周里。 */
  date: string;
  /** 对应 ScheduleShiftType.key；null = 这一格还没填。 */
  shift_type: string | null;
  /** "HH:MM"；Off 或没填时间时为 null。 */
  start_time: string | null;
  end_time: string | null;
  note: string;
  updated_by: string | null;
  /** 带 +00:00 的 ISO 字符串。 */
  updated_at: string | null;
}

/** PUT /api/schedule/weeks/{week_start}/cells 的请求体（supervisor 及以上）。 */
export interface ScheduleCellInput {
  employee_id: number;
  date: string;
  shift_type: string | null;
  start_time: string | null;
  end_time: string | null;
  note: string;
}

/** 工作时段内没人在岗的一段；GET 周数据和 publish 400 都会带。 */
export interface ScheduleGap {
  date: string;
  start_time: string;
  end_time: string;
}

export type ScheduleWeekStatus = "draft" | "published";

/** GET /api/schedule/weeks/{week_start} 的返回体。 */
export interface ScheduleWeek {
  /** 这一周周日的日期，"YYYY-MM-DD"。 */
  week_start: string;
  status: ScheduleWeekStatus;
  published_at: string | null;
  published_by: string | null;
  cells: ScheduleCell[];
  /** 服务端按 work_window 算好的空档，草稿周也给，方便页面随时显示（不用等 publish 才知道）。 */
  gaps: ScheduleGap[];
}

/** POST /api/schedule/weeks/{week_start}/publish 发布成功的返回体。 */
export interface SchedulePublishResult {
  status: "published";
  published_at: string;
  published_by: string;
  notified: ScheduleNotified[];
}

export interface ScheduleNotified {
  employee_id: number;
  name: string;
  channels: ("in_app" | "email")[];
}

/** 发布遇到空档时，400 的 detail 体（有空档就拒绝，不只是警告——任务包第 12 条）。 */
export interface SchedulePublishBlockedError {
  detail: string;
  gaps: ScheduleGap[];
}
