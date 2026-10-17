/** Farm out Settings 两页共用的小工具：时间解析 / 显示、价格解析、读取失败的分类。 */
import { describeError, isStatus } from "@/lib/api-errors";

/**
 * 员工填的时间 → "HH:MM"（24 小时制）。认 6:50 / 6:50 AM / 06:50 / 6.50pm / 650 / 18:05。
 * 没写上午下午的：1–11 点当上午，12 点当中午，13–23 点本来就是 24 小时制。空串 = ""（清空），认不出来 = null。
 */
export function parseTimeInput(raw: string): string | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!text) return "";
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(a|am|p|pm)?$/.exec(text);
  const compact = /^(\d{1,2})(\d{2})(a|am|p|pm)?$/.exec(text);
  const hit = m ?? compact;
  if (!hit) return null;
  let hour = Number(hit[1]);
  const minute = hit[2] === undefined ? 0 : Number(hit[2]);
  const mer = hit[3]?.startsWith("p") ? "p" : hit[3]?.startsWith("a") ? "a" : "";
  if (minute > 59) return null;
  if (mer) {
    if (hour < 1 || hour > 12) return null;
    if (mer === "p" && hour < 12) hour += 12;
    if (mer === "a" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "HH:MM" → "6:50 AM"；空 / 认不出来的原样返回。 */
export function formatTime(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const hour = Number(m[1]);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m[2]} ${hour < 12 ? "AM" : "PM"}`;
}

/** 价格输入框 → 数字；空 = null（没设）；写错 = undefined。 */
export function parsePriceInput(raw: string): number | null | undefined {
  const text = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined;
  return Number(text);
}

export function priceText(value: number | null): string {
  return value == null ? "" : value.toFixed(2);
}

export type LoadGate =
  | { kind: "loading" }
  | { kind: "forbidden" }
  /** 后端还没上线（/api/farm-out/* 回 404）。 */
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

/** 读取失败 → 页面状态；401 返回 null（调用方去跳登录）。 */
export function gateFromError(error: unknown): LoadGate | null {
  if (isStatus(error, 401)) return null;
  if (isStatus(error, 403)) return { kind: "forbidden" };
  if (isStatus(error, 404)) return { kind: "unavailable" };
  return { kind: "error", message: describeError(error) };
}
