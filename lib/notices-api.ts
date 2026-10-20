import { apiFetch } from "@/lib/api-client";

/**
 * Dashboard 的 Notice 面板里「排班类提醒」（排班发布 / 排班改动）的数据接口。
 * 后端还没有（2026-10-19，后端在评估，已读 / Got it 要存服务端）：这里是 ops 按预览自己设计的草案，
 * 接口没上线时 404，页面安静地不显示排班类提醒，只显示前端已有的（待接受的交接）。
 * 后端字段定了以后只改这个文件（页面代码照样走这几个函数）。
 */
const NOTICES = "/api/notices";

export type NoticeKind = "schedule_published" | "schedule_changed";

export interface ScheduleNotice {
  id: number;
  kind: NoticeKind;
  /** 一句话：Schedule for Oct 18 – Oct 24 is out / Your shift on Wed Oct 21 changed。 */
  title: string;
  /** ISO 时间。 */
  created_at: string;
  /** 点「See my schedule →」去哪，缺省 /schedule。 */
  href?: string | null;
  /** 已读（Got it / Mark all as read）存在服务端；面板只显示没读的。 */
  read: boolean;
}

/** 我的没读 / 近期的排班提醒。 */
export async function fetchScheduleNotices(
  signal?: AbortSignal,
): Promise<ScheduleNotice[]> {
  const res = await apiFetch<{ notices: ScheduleNotice[] }>(NOTICES, {
    cache: "no-store",
    signal,
  });
  return res.notices ?? [];
}

/** Got it：这一条标已读。 */
export function markNoticeRead(id: number): Promise<void> {
  return apiFetch<void>(`${NOTICES}/${id}/read`, { method: "POST" });
}

/** Mark all as read：所有排班提醒标已读（待接受的交接不在内，它只能 Accept）。 */
export function markAllNoticesRead(): Promise<void> {
  return apiFetch<void>(`${NOTICES}/read-all`, { method: "POST" });
}
