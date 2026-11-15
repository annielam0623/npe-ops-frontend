import { apiFetch } from "@/lib/api-client";
import type { VoiceCallEndpoint, VoiceCallLog } from "@/types/voice-calls";

/** 145 Q4 A：一次拿接口允许的最多条数（一天的电话不会更多）。count 等于它时可能还有更早的。 */
export const VOICE_CALL_LIMIT = 1000;

/** 按号码搜至少要几位数字（后端不足 3 位回 422）。 */
export const VOICE_PHONE_MIN_DIGITS = 3;

export function phoneDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** 按日期看（洛杉矶日期 YYYY-MM-DD），可选按接口筛。只 superadmin，别人 403。 */
export function fetchVoiceCalls(
  filter: { date: string; endpoint: VoiceCallEndpoint | "" },
  signal?: AbortSignal,
): Promise<VoiceCallLog> {
  return apiFetch<VoiceCallLog>("/api/voice/call-log", {
    cache: "no-store",
    signal,
    query: {
      date: filter.date,
      endpoint: filter.endpoint || undefined,
      limit: VOICE_CALL_LIMIT,
    },
  });
}

/**
 * 按号码搜（不带 date = 全部 30 天，145 Q11 A）。
 * ⚠️ 号码只放在 POST body 里：不进网址（网址会进 Railway 日志，后端安全审查 BLOCKING），页面也不把它存进浏览器。
 */
export function searchVoiceCalls(
  filter: { phone: string; endpoint: VoiceCallEndpoint | "" },
  signal?: AbortSignal,
): Promise<VoiceCallLog> {
  return apiFetch<VoiceCallLog>("/api/voice/call-log/search", {
    method: "POST",
    cache: "no-store",
    signal,
    body: {
      phone: phoneDigits(filter.phone),
      ...(filter.endpoint ? { endpoint: filter.endpoint } : {}),
      limit: VOICE_CALL_LIMIT,
    },
  });
}
