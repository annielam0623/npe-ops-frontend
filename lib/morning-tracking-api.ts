import { apiFetch } from "@/lib/api-client";
import { buildQueryString } from "@/lib/utils";
import type {
  LiveDrivers,
  MorningTracking,
  TrackingMarkCol,
  TrackingMarkValue,
} from "@/types";

/**
 * No show 改方向（Annie 2026-11-17「动手」，N2 A / N7 A）：staff 在 Tracking 表改 Relay / Bus 标记。
 * 按订单 + leg + 列写一条 staff 值，value = null ⇒ 删掉 staff 值、回到司机 / 导游原来标的（Reset）。
 * 后端每次写记 action_log，并在同一次写入里把这单记成已处理（action_taken），前端不另调 take-action。
 * ⚠️ 地址和字段名先按后端主窗口 6f 给的形状写（合同未出），合同到了按合同改。
 */
export function saveTrackingMark(input: {
  date: string;
  bookingId: number;
  orderNumber: string;
  col: TrackingMarkCol;
  value: TrackingMarkValue | null;
}): Promise<unknown> {
  return apiFetch<unknown>("/api/notifications/morning-pickup/tracking/mark", {
    method: "PUT",
    body: {
      date: input.date,
      booking_id: input.bookingId,
      order_number: input.orderNumber,
      // 早班追踪只有去程。
      leg: "",
      col: input.col,
      value: input.value,
    },
  });
}

/** staff 及以上可调；纯读。date 为洛杉矶日期 YYYY-MM-DD。 */
export function fetchMorningTracking(
  date: string,
  signal?: AbortSignal,
): Promise<MorningTracking> {
  return apiFetch<MorningTracking>(
    "/api/notifications/morning-pickup/tracking",
    {
      cache: "no-store",
      signal,
      query: { date },
    },
  );
}

/**
 * 导出 xlsx（旧页面同一个地址）。⚠️ 数据来自 send_log（这天发过的早班提醒），
 * 不是表格里的签到行。浏览器直接打开这个同源地址下载，cookie 随请求带上。
 */
export function buildMorningExportUrl(date: string): string {
  return `/api/notifications/morning-pickup/export?${buildQueryString({ date })}`;
}

/**
 * 司机实时页（Live drivers 页签）：当天每位司机 / 导游手机上那一页的同一份数据，只读。
 * 权限 morning.view，开关 morning_live_drivers（默认只 Super Admin，关着 403）。
 */
export function fetchLiveDrivers(
  date: string,
  signal?: AbortSignal,
): Promise<LiveDrivers> {
  return apiFetch<LiveDrivers>(
    "/api/notifications/morning-pickup/live-drivers",
    { cache: "no-store", signal, query: { date } },
  );
}
