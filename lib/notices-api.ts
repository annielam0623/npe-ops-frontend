import { apiFetch } from "@/lib/api-client";

/**
 * Dashboard 的 Notice 面板里「通知类」数据（排班发布 / 排班改动 / 事故登记等）。
 * 形状以后端 main 为准（app/services/notices.py，docs/interfaces/dashboard-notice-2026-10-19.md）：
 * `GET /api/notices?include_read=&limit=` → `{unread_count, notices:[{id, kind, title, body, created_at, href, read}]}`。
 * 2026-10-25 修：之前按旧草案读 items / type / is_read / link，后端从来不发这些，面板里的通知一直是空的。
 * 下面的 normalize 两种都认（旧字段留着兼容），页面里统一用 ApiNotice 的字段名。
 * 已读存服务端、按人，换设备一样。交接（handover_*）是后端 B 期，目前没有，面板里的交接仍走 /api/tasks/today。
 */
const NOTICES = "/api/notices";

/** 已知类型；后端以后加的新类型按 title + body 通用显示。 */
export type NoticeType =
  | "schedule_published"
  | "schedule_changed"
  /** 周三确认请求（后端 G138：category `schedule_confirm_request`）。 */
  | "schedule_confirm_request"
  /** 排班人 Decline 了员工想加的班，通知本人（后端 `schedule_confirm_declined`）；没有专用写法，按 title + body 通用显示。 */
  | "schedule_confirm_declined"
  /** Daily Operation Report 登记后通知负责人（后端设计稿 §6.4，link = /daily-report?id=<id>）。 */
  | "operation_report"
  /** 旧字符串，后端从没发过这个，留着兼容。 */
  | "schedule_confirm"
  | (string & {});

export interface ApiNotice {
  id: number;
  type: NoticeType;
  title: string;
  /** 纯文本，行与行之间 \n，当文本显示，不当 HTML。 */
  body: string;
  /** UTC ISO。 */
  created_at: string;
  is_read: boolean;
  read_at: string | null;
  /** 相关对象；排班类是 { kind: "week", week_start }；没有就是 null。 */
  ref: { kind: string; [key: string]: unknown } | null;
  /** 点进去的站内路径，如 /schedule?week=2026-10-25。 */
  link: string | null;
  /** 这条支持的按钮；A 期恒为 []，B 期交接是 ["accept","decline"]（有按钮时不能 Got it）。 */
  actions: string[];
}

/** 后端一条通知的原样（真实字段 + 旧草案字段，都可能缺）。 */
interface WireNotice {
  id: number;
  kind?: string;
  type?: string;
  title?: string;
  body?: string;
  created_at?: string;
  href?: string | null;
  link?: string | null;
  read?: boolean;
  is_read?: boolean;
  read_at?: string | null;
  ref?: ApiNotice["ref"];
  actions?: string[];
}

interface NoticeList {
  unread_count?: number;
  notices?: WireNotice[];
  /** 旧草案的名字，后端没用过；留着兼容。 */
  items?: WireNotice[];
}

/** 我的没读通知，新的在前。 */
export async function fetchNotices(signal?: AbortSignal): Promise<ApiNotice[]> {
  const res = await apiFetch<NoticeList>(
    `${NOTICES}?include_read=false&limit=50`,
    {
      cache: "no-store",
      signal,
    },
  );
  // 后端 A 期压根不下发 actions 字段（2026-10-22 后端核实：所有 category 都没有，不只是 B 期交接类），
  // 不在这里兜底的话 top-row.tsx / notice-panel.tsx 读 .length 会直接抛错，导致整块通知悄悄消失。
  // 同理：后端以后加的新类型可能缺 type / title / body / created_at，这里补成空串，
  // 面板按 title + 链接降级显示，不因为一条不认识的通知让整块崩。
  return (res.notices ?? res.items ?? []).map((item): ApiNotice => ({
    id: item.id,
    type: item.kind ?? item.type ?? "",
    title: item.title ?? "",
    body: item.body ?? "",
    created_at: item.created_at ?? "",
    is_read: item.read ?? item.is_read ?? false,
    read_at: item.read_at ?? null,
    ref: item.ref ?? null,
    link: item.href ?? item.link ?? null,
    actions: item.actions ?? [],
  }));
}

/** Got it：这一条标已读（幂等）。 */
export function markNoticeRead(id: number): Promise<unknown> {
  return apiFetch<unknown>(`${NOTICES}/${id}/read`, { method: "POST" });
}

/** Mark all as read：我所有没读的标已读。 */
export function markAllNoticesRead(): Promise<unknown> {
  return apiFetch<unknown>(`${NOTICES}/read-all`, { method: "POST" });
}
