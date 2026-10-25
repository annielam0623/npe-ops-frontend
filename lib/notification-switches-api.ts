import { apiFetch } from "@/lib/api-client";
import type {
  NotificationSwitch,
  NotificationSwitchList,
  ScheduleConfirmSettings,
} from "@/types/notification-switches";

const API = "/api/settings/notification-switches";
const SCHEDULE_CONFIRM_API = "/api/settings/schedule-confirm";

export interface NotificationSwitches {
  readable: boolean;
  switches: NotificationSwitch[];
}

/** 缺的字段补成安全的默认值：缺 enabled = 关，缺 can_edit = 不能改。 */
function normalize(res: NotificationSwitchList): NotificationSwitches {
  return {
    readable: res.readable !== false,
    switches: (res.switches ?? [])
      .filter((s) => s && typeof s.key === "string" && s.key)
      .map((s) => ({
        ...s,
        label: s.label || s.key,
        description: s.description ?? "",
        enabled: s.enabled === true,
        can_edit: s.can_edit === true,
      })),
  };
}

/** 所有自动通知的开关（后端 require_staff；页面自己只给 admin 看）。auto_send_* 两项只在 Super Admin 的响应里出现。 */
export async function fetchNotificationSwitches(
  signal?: AbortSignal,
): Promise<NotificationSwitches> {
  return normalize(
    await apiFetch<NotificationSwitchList>(API, { cache: "no-store", signal }),
  );
}

/**
 * 合并语义：只带要改的键，值必须是布尔（否则 400）；返回和 GET 一样的整份，直接拿来刷新页面，不用再 GET。
 * body 里带 schedule_confirm 而当前人不是 Super Admin ⇒ 整个请求 403（什么都不写）。
 */
export async function setNotificationSwitches(
  switches: Record<string, boolean>,
): Promise<NotificationSwitches> {
  return normalize(
    await apiFetch<NotificationSwitchList>(API, {
      method: "PUT",
      body: { switches },
    }),
  );
}

/** 周三排班确认的发送时刻（所有员工可读）。 */
export function fetchScheduleConfirmSettings(
  signal?: AbortSignal,
): Promise<ScheduleConfirmSettings> {
  return apiFetch<ScheduleConfirmSettings>(SCHEDULE_CONFIRM_API, {
    cache: "no-store",
    signal,
  });
}

/** 存整份（后端校验 enabled 必须是布尔、time 是 24 小时 HH:MM）；仅 Super Admin，其他人 403。改时刻用它，开关走上面的 PUT。 */
export function saveScheduleConfirmSettings(
  settings: ScheduleConfirmSettings,
): Promise<ScheduleConfirmSettings> {
  return apiFetch<ScheduleConfirmSettings>(SCHEDULE_CONFIRM_API, {
    method: "PUT",
    body: settings,
  });
}
