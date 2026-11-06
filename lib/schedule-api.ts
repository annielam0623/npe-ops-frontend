import { apiFetch } from "@/lib/api-client";
import { shareRequest } from "@/lib/shared-request";
import { rememberShiftTypeColors } from "@/lib/schedule-shift-colors";
import { ApiError } from "@/types";
import type {
  ScheduleEmployee,
  ScheduleEmployeeInput,
  ScheduleEmployeeUpdate,
  ScheduleEmployeesResponse,
  ScheduleOk,
  SchedulePublishResult,
  ScheduleSendChangesResult,
  ScheduleSettings,
  ScheduleShiftType,
  ScheduleSlot,
  ScheduleSlotAssignInput,
  ScheduleSlotCreateInput,
  ScheduleSlotTimeInput,
  ScheduleTimeOff,
  ScheduleTimeOffInput,
  ScheduleWeek,
  ScheduleWeekChangesError,
  ScheduleWeekChangesResult,
  ScheduleWeekOp,
  ScheduleWorkHours,
  ScheduleWorkWindowInput,
} from "@/types";

/** 工作时段 + 班次类型；所有登录用户都能读，写只有 superadmin（后端挡，前端按 403 隐藏改的入口）。 */
export async function fetchScheduleSettings(
  signal?: AbortSignal,
): Promise<ScheduleSettings> {
  const settings = await apiFetch<ScheduleSettings>("/api/settings/schedule", {
    cache: "no-store",
    signal,
  });
  // 格子按班次类型存的颜色画（置顶 85）：读到就记下，各处画卡片时按 key 查。
  rememberShiftTypeColors(settings.shift_types);
  return settings;
}

export function updateWorkWindow(
  input: ScheduleWorkWindowInput,
): Promise<ScheduleSettings> {
  return apiFetch<ScheduleSettings>("/api/settings/schedule/work-window", {
    method: "PUT",
    body: input,
  });
}

/**
 * Working hours 按星期几（后端 v144，权限 settings.schedule）：整份替换，7 天都要带，回存好的整份。
 * same_every_day=true 时 7 天必须一样，否则 400（原话例如「Same every day is on, so all 7 days must have the same hours.」）。
 */
export function updateWorkHours(
  input: ScheduleWorkHours,
): Promise<ScheduleWorkHours> {
  return apiFetch<ScheduleWorkHours>("/api/settings/schedule/work-hours", {
    method: "PUT",
    body: input,
  });
}

export async function fetchScheduleEmployees(
  signal?: AbortSignal,
  /** supervisor 及以上才能要已停用的人（后端对别人会忽略这个参数）。 */
  includeInactive = false,
): Promise<ScheduleEmployee[]> {
  const result = await apiFetch<ScheduleEmployeesResponse>(
    `/api/schedule/employees${includeInactive ? "?include_inactive=1" : ""}`,
    { cache: "no-store", signal },
  );
  return result.employees;
}

/** 改名字 / 邮箱 / 停用（supervisor 及以上）；邮箱改了后端会重新按邮箱对登录账号。 */
export function updateScheduleEmployee(
  id: number,
  input: ScheduleEmployeeUpdate,
): Promise<ScheduleEmployee> {
  return apiFetch<ScheduleEmployee>(`/api/schedule/employees/${id}`, {
    method: "PUT",
    body: input,
  });
}

/**
 * 存排班表的员工顺序（schedule.edit；后端 schedule-employee-flags）：在用的人整份按新顺序给，缺人 / 多人 / 重复 ⇒ 400 原话。
 * 不改周的 version、不发通知。回来的是在用的人（新顺序，带 sort_order）。
 */
export async function saveScheduleEmployeeOrder(
  employeeIds: number[],
): Promise<ScheduleEmployee[]> {
  const result = await apiFetch<ScheduleEmployeesResponse>(
    "/api/schedule/employees/order",
    { method: "PUT", body: { employee_ids: employeeIds } },
  );
  return result.employees;
}

/** admin / supervisor 加人；重名不挡（同名同姓现实里会有），后端只按 id 认人。 */
export function addScheduleEmployee(
  input: ScheduleEmployeeInput,
): Promise<ScheduleEmployee> {
  return apiFetch<ScheduleEmployee>("/api/schedule/employees", {
    method: "POST",
    body: input,
  });
}

/**
 * 查一周的排班。staff 查还没发布的周会 403（D5：员工只看已发布的整周）；
 * supervisor 及以上任何时候都能查（草稿也能看自己正在排的）。
 * 这一周第一次打开、之前没存过任何时段时，服务端直接照上一周复制一份当起点（`copied_from` 会非空），
 * 不需要前端另外调「复制上一周」。
 */
export function fetchScheduleWeek(
  weekStart: string,
  signal?: AbortSignal,
): Promise<ScheduleWeek> {
  return apiFetch<ScheduleWeek>(`/api/schedule/weeks/${weekStart}`, {
    cache: "no-store",
    signal,
  });
}

/** 新加一个时段（supervisor 及以上），一开始没有人。 */
export function createScheduleSlot(
  weekStart: string,
  input: ScheduleSlotCreateInput,
): Promise<ScheduleSlot> {
  return apiFetch<ScheduleSlot>(`/api/schedule/weeks/${weekStart}/slots`, {
    method: "POST",
    body: input,
  });
}

/** 删掉一个时段（带着的人一起消失，supervisor 及以上）。 */
export function deleteScheduleSlot(
  weekStart: string,
  slotId: number,
): Promise<ScheduleOk> {
  return apiFetch<ScheduleOk>(
    `/api/schedule/weeks/${weekStart}/slots/${slotId}`,
    { method: "DELETE" },
  );
}

/** 改一个时段的上下班时间，不改派的人（supervisor 及以上）。 */
export function updateScheduleSlotTime(
  weekStart: string,
  slotId: number,
  input: ScheduleSlotTimeInput,
): Promise<ScheduleSlot> {
  return apiFetch<ScheduleSlot>(
    `/api/schedule/weeks/${weekStart}/slots/${slotId}/time`,
    { method: "PUT", body: input },
  );
}

/** 改 / 清除一个时段的备注（supervisor 及以上）；`null` 或空串 = 清除。后端：≤120 字、不能含换行。 */
export function updateScheduleSlotNote(
  weekStart: string,
  slotId: number,
  note: string | null,
): Promise<ScheduleSlot> {
  return apiFetch<ScheduleSlot>(
    `/api/schedule/weeks/${weekStart}/slots/${slotId}/note`,
    { method: "PUT", body: { note } },
  );
}

/** 录休假（supervisor 及以上）；一人一天一条，再录同一天 = 更新；和已有班冲突时后端 400 带原话。 */
export function setScheduleTimeOff(
  input: ScheduleTimeOffInput,
): Promise<{ time_off: ScheduleTimeOff[] }> {
  return apiFetch<{ time_off: ScheduleTimeOff[] }>("/api/schedule/time-off", {
    method: "PUT",
    body: input,
  });
}

export function deleteScheduleTimeOff(id: number): Promise<ScheduleOk> {
  return apiFetch<ScheduleOk>(`/api/schedule/time-off/${id}`, {
    method: "DELETE",
  });
}

/** 新增 / 改班次类型要送的字段（置顶 85）；默认时间两个都给 = 设置，两个都 null = 不设。 */
export interface ShiftTypeInput {
  label: string;
  sort_order: number;
  default_start_time: string | null;
  default_end_time: string | null;
  /** 旧后端不认这个字段会忽略（payload.get），新后端不认得的颜色名 400。 */
  color?: string;
}

/**
 * 新增班次类型（settings.schedule = Super Admin，后端 POST …/shift-types）。key 前端从名字生成
 * （`shiftTypeKeyFor`）；后端照旧查重，重了 400「Shift type "x" already exists.」。
 */
export function createShiftType(
  input: ShiftTypeInput & { key: string },
): Promise<ScheduleShiftType> {
  return apiFetch<ScheduleShiftType>("/api/settings/schedule/shift-types", {
    method: "POST",
    body: input,
  });
}

/** 改名 / 排序 / 停用 / 默认时间 / 颜色，整行一起送（同 updateShiftTypeDefaults：缺的字段不让后端猜）。key 不变。 */
export function updateShiftType(
  key: string,
  input: ShiftTypeInput & { is_active: boolean },
): Promise<ScheduleShiftType> {
  return apiFetch<ScheduleShiftType>(
    `/api/settings/schedule/shift-types/${encodeURIComponent(key)}`,
    { method: "PUT", body: input },
  );
}

/**
 * 从名字生成 key（preview Q3：小写、空格换 _、最多 20 字，重了加 _2、_3…）。
 * 只留 a–z / 0–9 / _；名字里一个字母数字都没有时用 shift。`taken` = 已有的 key（含停用的、这次新加的）。
 */
export function shiftTypeKeyFor(
  label: string,
  taken: Iterable<string>,
): string {
  const used = new Set(taken);
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 20)
      .replace(/_$/, "") || "shift";
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const tail = `_${n}`;
    const key = `${base.slice(0, 20 - tail.length)}${tail}`;
    if (!used.has(key)) return key;
  }
}

/**
 * 把人拖进 / 挪出一个时段（supervisor 及以上）；`employee_id: null` 清空。
 * 挪动（从别的时段拖过来）由调用方先后发两次：目标时段 assign 新人，原时段 assign null。
 */
export function assignScheduleSlot(
  weekStart: string,
  slotId: number,
  input: ScheduleSlotAssignInput,
): Promise<ScheduleSlot> {
  return apiFetch<ScheduleSlot>(
    `/api/schedule/weeks/${weekStart}/slots/${slotId}/assign`,
    { method: "PUT", body: input },
  );
}

/**
 * 发布这一周（supervisor 及以上）。有空档时后端照样拒（400，body 里带 gaps），
 * 不是只靠前端挡——绕过页面直接调也一样被挡（任务包验收第 5 条）。
 * 已发布的周也能再点一次：等同于重新发布 + 重发通知（后端 -84 2026-10-16 定，编辑已发布的周不自动重发）。
 */
export function publishScheduleWeek(
  weekStart: string,
  opts: { allowGaps?: boolean } = {},
): Promise<SchedulePublishResult> {
  // Publish anyway（Annie 2026-10-29 Q1：admin 及以上）：带 allow_gaps，有空档也发布；权限后端再判一次。
  // 形状照 preview https://claude.ai/artifact/CJaXdFkBS5S4g97gjtxuD8 「需要后端」B1，后端定稿后核对。
  return apiFetch<SchedulePublishResult>(
    `/api/schedule/weeks/${weekStart}/publish`,
    opts.allowGaps
      ? { method: "POST", body: { allow_gaps: true } }
      : { method: "POST" },
  );
}

/**
 * 整周一个 Save（Annie 2026-10-29「你不会用缓存么」「4项全部动手」第 3 项；B9 preview
 * https://claude.ai/artifact/AY3vC6WaeLmTQgTx3BZi79 ，后端 G218）：页面上暂存的拖班 / 加删 / 改时间 / 备注，一次存完。
 * 整批一个事务：一条不过就一样都不存。出错回包见 `ScheduleWeekChangesError`（`changesErrorOf` 读）：
 * 409 locked / stale / coverage_gap、400 带 op_index。
 */
export function saveScheduleWeekChanges(
  weekStart: string,
  body: {
    lock_token: string | null;
    base_version: string | null;
    ops: ScheduleWeekOp[];
  },
): Promise<ScheduleWeekChangesResult> {
  return apiFetch<ScheduleWeekChangesResult>(
    `/api/schedule/weeks/${weekStart}/changes`,
    { method: "POST", body },
  );
}

/**
 * 读 …/changes 的出错回包。FastAPI 的 HTTPException(409, {...}) 回的是 {detail: {...}}，
 * 也兼容直接平铺 {detail: "…", code, …}。读不出来 = null（照普通错误处理）。
 */
export function changesErrorOf(
  error: unknown,
): ScheduleWeekChangesError | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return null;
  const inner = body.detail;
  if (inner && typeof inner === "object") {
    const e = inner as Partial<ScheduleWeekChangesError>;
    return typeof e.detail === "string"
      ? (e as ScheduleWeekChangesError)
      : null;
  }
  return typeof inner === "string"
    ? ({ ...body, detail: inner } as ScheduleWeekChangesError)
    : null;
}

/**
 * 发布前把这个人改动的班单独发给本人确认（Annie 2026-10-29「员工确认，同意推荐，动手」）。只发本人，不发主管；
 * 正式 Publish again 时照样再发。没有邮箱回 400 原话。形状照 preview https://claude.ai/artifact/NfWdfaxPUSS6SR8PGmxNrv 暂定。
 */
export function sendScheduleChanges(
  weekStart: string,
  employeeId: number,
): Promise<ScheduleSendChangesResult> {
  return apiFetch<ScheduleSendChangesResult>(
    `/api/schedule/weeks/${weekStart}/employees/${employeeId}/send-changes`,
    { method: "POST" },
  );
}

/**
 * Dashboard 用的共用读法（页面提速，Annie 2026-11-05「改变速度的三步，动手」）：Today's team 和 Schedule 两块
 * 都要设置、名单、这一周，原来各发一遍；现在 15 秒内共用一份（失败不留）。
 * Staff Schedule 页本身要改完马上看到新数据，照旧用上面不共用的那几个。
 */
const DASHBOARD_SHARE_MS = 15_000;

export function dashboardScheduleSettings(
  signal?: AbortSignal,
): Promise<ScheduleSettings> {
  return shareRequest(
    "dashboard:schedule-settings",
    () => fetchScheduleSettings(),
    DASHBOARD_SHARE_MS,
    signal,
  );
}

export function dashboardScheduleEmployees(
  signal?: AbortSignal,
): Promise<ScheduleEmployee[]> {
  return shareRequest(
    "dashboard:schedule-employees",
    () => fetchScheduleEmployees(),
    DASHBOARD_SHARE_MS,
    signal,
  );
}

export function dashboardScheduleWeek(
  weekStart: string,
  signal?: AbortSignal,
): Promise<ScheduleWeek> {
  return shareRequest(
    `dashboard:schedule-week:${weekStart}`,
    () => fetchScheduleWeek(weekStart),
    DASHBOARD_SHARE_MS,
    signal,
  );
}
