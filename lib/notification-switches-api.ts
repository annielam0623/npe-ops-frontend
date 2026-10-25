import { apiFetch } from "@/lib/api-client";
import type {
  NotificationSwitch,
  NotificationSwitchList,
  ScheduleConfirmSettings,
} from "@/types/notification-switches";

const API = "/api/settings/notification-switches";
const SCHEDULE_CONFIRM_API = "/api/settings/schedule-confirm";

/** 所有自动通知的开关（admin）。缺的字段补成安全的默认值：缺 enabled = 关，缺 can_edit = 不能改。 */
export async function fetchNotificationSwitches(
  signal?: AbortSignal,
): Promise<NotificationSwitch[]> {
  const res = await apiFetch<NotificationSwitchList>(API, {
    cache: "no-store",
    signal,
  });
  return (res.switches ?? [])
    .filter((s) => s && typeof s.key === "string" && s.key)
    .map((s) => ({
      ...s,
      label: s.label || s.key,
      description: s.description ?? "",
      enabled: s.enabled === true,
      can_edit: s.can_edit === true,
    }));
}

/** 合并语义：只改这一项；未登记的 key ⇒ 400（detail 是可以直接显示的英文）。 */
export function setNotificationSwitch(
  key: string,
  enabled: boolean,
): Promise<unknown> {
  return apiFetch<unknown>(API, { method: "PUT", body: { key, enabled } });
}

export function fetchScheduleConfirmSettings(
  signal?: AbortSignal,
): Promise<ScheduleConfirmSettings> {
  return apiFetch<ScheduleConfirmSettings>(SCHEDULE_CONFIRM_API, {
    cache: "no-store",
    signal,
  });
}

/** 存整份（后端校验 enabled 必须是布尔、time 是 24 小时 HH:MM）；仅 Super Admin，其他人 403。 */
export function saveScheduleConfirmSettings(
  settings: ScheduleConfirmSettings,
): Promise<ScheduleConfirmSettings> {
  return apiFetch<ScheduleConfirmSettings>(SCHEDULE_CONFIRM_API, {
    method: "PUT",
    body: settings,
  });
}
