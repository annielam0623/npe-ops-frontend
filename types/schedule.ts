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
  /**
   * 测试用的人（Annie 2026-10-30「我加了ZZTest和Leon在staff Schedule里用来做测试，不要把这两个人显示在dashbroad里」，选 A）：
   * 不出现在 Dashboard 的 Today's team 和整周排班里；不算进空档；排班页照常显示、名字旁一个灰色「Test」。通知照发。
   * 后端 schedule_employees.is_test（57 在做，要迁移）；没带 = 不是。
   */
  is_test?: boolean;
}

/** PUT /api/schedule/employees/{id} 的请求体（supervisor 及以上）：没传的字段不动；email 传空字符串 = 清掉。 */
export interface ScheduleEmployeeUpdate {
  name?: string;
  email?: string;
  is_active?: boolean;
  is_test?: boolean;
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
  /** 已发布、而且现在还有空档（后端 d2bc2cf）。gaps 照旧给所有能打开的人，staff 不显示由前端按角色藏。 */
  published_with_gaps?: boolean;
  /**
   * 已发布的周改过、还没按 Publish again（Annie 10-29「改完再发」：改动不逐项通知，Publish again 时一次发给班有变化的人和主管）。
   * 后端 G217（ef，10-30 定稿）：只给有 schedule.edit 的人，staff 永远 false；草稿周 false；v128 之前发布的周只看时段。
   * 没带（后端没上线）时前端只记这一次打开页面以后的改动。
   */
  has_unsent_changes?: boolean;
  /**
   * 这一周的版本（= schedule_weeks.updated_at，后端 G218）。整周 Save 时作 base_version 送回去：
   * 打开以后别人改过 ⇒ 409 stale。
   */
  version?: string | null;
  /**
   * 已发布的周，每个人和上次发布比改了什么（Annie 10-29「员工确认，同意推荐，动手」：发布前可以单独发给本人确认）。
   * 只列有改动的人；Publish again 后清空。没带 = 后端没上线（不出 Send to confirm）。
   * 后端 G217（ef，10-30 定稿）：只给有 schedule.edit 的人，staff 永远 []；草稿周 []；v128 之前发布的周永远 []。
   */
  pending_changes?: SchedulePendingChange[];
}

/** 一个人这周和上次发布不一样的地方。 */
export interface SchedulePendingChange {
  employee_id: number;
  name: string;
  /**
   * 后端拼好的字，原样显示：例「Open 2:00 AM – 12:00 PM」「Open 2:00 AM – 12:00 PM (Pre close)」，一天两段用逗号连；
   * 休假「Time off (PTO)」「Time off (Sick)」「Time off (Personal)」。原来没班 before = null，现在没班 after = null。
   */
  items: { date: string; before: string | null; after: string | null }[];
  /** 最近一次单独发给本人确认的时间 / 谁发的（名字）；没发过 = null。 */
  sent_at: string | null;
  sent_by: string | null;
  /**
   * 这个人有没有登录账号（后端 G217 ef，10-30）：true 才会收到站内通知，发送框写「📧 邮箱 + 🔔 in-app notice」；
   * false 只写「📧 邮箱」。没带 = 后端没上线，当 true。邮箱有没有照旧看员工名单。
   */
  has_login?: boolean;
}

/** POST …/employees/{id}/send-changes 成功的返回体。 */
export interface ScheduleSendChangesResult {
  sent_at: string;
  sent_by: string;
  /** 后端 G217：["email"] 或 ["email", "in_app"]。 */
  channels: ("email" | "in_app")[];
}

/**
 * 整周一个 Save（Annie 2026-10-29「4项全部动手」第 3 项，B9 Q1–Q7 照推荐；后端 G218）：
 * POST /api/schedule/weeks/{week_start}/changes 的一条改动。`slot` 是已有的 id，或同一批里 create 的 ref（"n1"…）。
 */
export type ScheduleWeekOp =
  | {
      op: "create";
      ref: string;
      date: string;
      shift_type: string;
      start_time: string;
      end_time: string;
      employee_id: number | null;
      note: string | null;
    }
  | { op: "assign"; slot: number | string; employee_id: number | null }
  | { op: "time"; slot: number | string; start_time: string; end_time: string }
  | { op: "note"; slot: number | string; note: string | null }
  | { op: "delete"; slot: number | string };

/** POST …/changes 成功的返回体。 */
export interface ScheduleWeekChangesResult {
  /** 存完以后的整周（含新的 version），直接换掉页面数据。 */
  week: ScheduleWeek;
  /** ref → 新建的 slot id。 */
  created: Record<string, number>;
  applied: number;
  /** G217 以后改动不马上通知：永远 []。 */
  notified: ScheduleNotified[];
  /** 锁过期后被后端重新占住时是新 token（之后心跳 / release 用它）；没变就是原来的。 */
  lock_token?: string | null;
}

/**
 * POST …/changes 的出错回包（后端 G218）：409 code locked / stale / coverage_gap，400 带 op_index / slot。
 * 409 stale 和 400 也带 lock_token（同成功回包）。
 */
export interface ScheduleWeekChangesError {
  detail: string;
  code?: string;
  /** stale：库里最新的 version。 */
  version?: string | null;
  gaps?: ScheduleGap[];
  op_index?: number;
  slot?: number | string | null;
  lock_token?: string | null;
}

/** POST /api/schedule/weeks/{week_start}/publish 发布成功的返回体。 */
export interface SchedulePublishResult {
  week_start?: string;
  status: "published";
  published_at: string;
  published_by: number;
  /** 这一周之前已经发布过（Publish again）。后端 d2bc2cf：重新发布不发通知，notified 永远是 []。 */
  republished?: boolean;
  /** 发布那一刻的空档（Publish anyway 时非空）。 */
  gaps?: ScheduleGap[];
  /** Publish again 时只有班有变化的员工（后端 G217）；首次发布是这周排了班的人。 */
  notified: ScheduleNotified[];
  /**
   * 收到通知的主管层（后端 G217 ef，10-30；审查 SA-1 收窄）：在用的 supervisor / admin 里勾了 schedule.edit 的，superadmin 不看勾；去掉按的人自己；有人变了才有。
   * 首次发布或没人变化时 []；本人的班也变了的只算在 notified 里。没带 = 后端没上线。
   */
  notified_supervisors?: {
    user_id: number;
    name: string;
    channels: string[];
  }[];
  /**
   * 没收到的人（后端 ef task/republish-recipients-by-perm 8a77c4e，还没上 main；Annie 置顶 15）：
   * notified 只列真发出去的，这里是该通知却没通知到的。没带 = 后端没上线。
   */
  not_reached?: {
    employee_id: number;
    name: string;
    reason: string;
  }[];
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
