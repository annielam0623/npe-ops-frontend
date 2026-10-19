/** GET /api/settings/schedule 的一项班次类型；key 存进 slot.shift_type，label 显示用。两者都不写死在代码里（后端没有每种班次的默认上下班时间，新加时段先用工作时段起止，再手动改）。 */
export interface ScheduleShiftType {
  key: string;
  label: string;
  sort_order: number;
  is_active: boolean;
  /** 班次默认上下班时间（"HH:MM"）：新建时段时预填；没设 / 后端还没上线 = 没有。superadmin 才能改。 */
  default_start_time?: string | null;
  default_end_time?: string | null;
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

/** PUT /api/schedule/employees/{id} 的请求体（supervisor 及以上）：没传的字段不动；email 传空字符串 = 清掉。 */
export interface ScheduleEmployeeUpdate {
  name?: string;
  email?: string;
  is_active?: boolean;
}

/** GET /api/schedule/employees 的返回体（包了一层）。 */
export interface ScheduleEmployeesResponse {
  employees: ScheduleEmployee[];
}

/** POST /api/schedule/employees 的请求体（admin / supervisor）。 */
export interface ScheduleEmployeeInput {
  name: string;
  email: string;
}

/**
 * 一个「时段」：这一天需要有人覆盖的一段时间，不是某个人的格子——先有时段，再把人拖进去。
 * 同一天可以有不止一个同类型的时段（例如两人一起 closing）。
 */
export interface ScheduleSlot {
  id: number;
  /** "YYYY-MM-DD"，落在这一周里。 */
  date: string;
  /** 对应 ScheduleShiftType.key。 */
  shift_type: string;
  /** "HH:MM"。 */
  start_time: string;
  end_time: string;
  /** null = 这个时段还没排到人。 */
  employee_id: number | null;
  /** 备注（≤120 字，纯文本，没有换行）；没有 / 后端还没上线 = null。 */
  note?: string | null;
  /** 后台用户 id（后端存的是 id，不是名字）。 */
  updated_by: number | null;
  /** ISO 字符串。 */
  updated_at: string | null;
}

/** POST /api/schedule/weeks/{week_start}/slots 的请求体（supervisor 及以上）：新加一个时段。 */
export interface ScheduleSlotCreateInput {
  date: string;
  shift_type: string;
  start_time: string;
  end_time: string;
  note?: string | null;
}

/** 休假的三种类型（后端值）；页面显示名见 `TIME_OFF_LABEL`。 */
export type ScheduleTimeOffKind = "pto" | "sick" | "personal";

/** 周视图里的一条休假；类型和备注对所有员工可见（Annie 2026-10-18 定）。一人一天最多一条。 */
export interface ScheduleTimeOff {
  id: number;
  employee_id: number;
  /** "YYYY-MM-DD"。 */
  date: string;
  kind: ScheduleTimeOffKind;
  note: string | null;
}

/** PUT /api/schedule/time-off 的请求体（supervisor 及以上）：一次最多 31 天，整批要么都成要么都拒。 */
export interface ScheduleTimeOffInput {
  employee_id: number;
  dates: string[];
  kind: ScheduleTimeOffKind;
  note: string | null;
}

/** PUT /api/schedule/weeks/{week_start}/slots/{id} 的请求体：改这个时段的时间（不改派的人）。 */
export interface ScheduleSlotTimeInput {
  start_time: string;
  end_time: string;
}

/** PUT /api/schedule/weeks/{week_start}/slots/{id}/assign 的请求体：把人拖进 / 挪出这个时段。 */
export interface ScheduleSlotAssignInput {
  /** null = 清空这个时段（变回「需要人」）。 */
  employee_id: number | null;
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
  published_by: number | null;
  /**
   * 这一周第一次打开（之前没存过任何时段）时，服务端直接照上一周的时段 + 人原样复制过来当起点，
   * 不需要另外点「复制上一周」；copied_from 非空就是这种情况，只在刚打开、一次都没改过时有意义。
   */
  copied_from: string | null;
  slots: ScheduleSlot[];
  /** 这一周 7 天内所有人的休假（只显示，不影响空档 / 发布）；后端还没上线时没有。 */
  time_off?: ScheduleTimeOff[];
  /** 服务端按 work_window 算好的空档，草稿周也给，方便页面随时显示（不用等 publish 才知道）。 */
  gaps: ScheduleGap[];
}

/** POST /api/schedule/weeks/{week_start}/publish 发布成功的返回体。 */
export interface SchedulePublishResult {
  status: "published";
  published_at: string;
  published_by: number;
  notified: ScheduleNotified[];
}

export interface ScheduleNotified {
  employee_id: number;
  name: string;
  channels: ("in_app" | "email")[];
}

/**
 * 发布遇到空档时，400 的 detail 体（有空档就拒绝，不只是警告——任务包第 12 条）。
 * 后端是 `HTTPException(400, {detail, gaps})`，所以整个响应是 `{detail: {detail, gaps}}`。
 */
export interface SchedulePublishBlockedError {
  detail: string;
  gaps: ScheduleGap[];
}

/** 删除时段的返回体。 */
export interface ScheduleOk {
  ok: true;
}
