import { apiFetch } from "@/lib/api-client";

/**
 * G318 / 147 第二部分：Open 班进 Dispatch 总是 today 的时间段（洛杉矶时间，[start, end)，"HH:MM" 24 小时）。
 * 后端 app/routers/dispatch_open_today.py：GET / PUT 都只给 Super Admin（别人 403）；坏值 400 + 一句英文 detail；
 * start 必须早于 end（不跨午夜）；值真的变了才记 action_log。没设过 ⇒ 默认 00:00–10:00。
 */
export interface OpenTodayWindow {
  start: string;
  end: string;
}

const API = "/api/settings/dispatch-open-today";

export function fetchOpenTodayWindow(
  signal?: AbortSignal,
): Promise<OpenTodayWindow> {
  return apiFetch<OpenTodayWindow>(API, { cache: "no-store", signal });
}

export function saveOpenTodayWindow(
  w: OpenTodayWindow,
): Promise<OpenTodayWindow> {
  return apiFetch<OpenTodayWindow>(API, { method: "PUT", body: w });
}

/** "09:30" → "9:30 AM"；"00:00" → "12:00 AM"。 */
export function fmtHhmm(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
