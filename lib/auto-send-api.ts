import { apiFetch } from "@/lib/api-client";
import type { AutoSendConfig, AutoSendSettings } from "@/types/auto-send";

const API = "/api/settings/auto-send";

/** 设置 + 最近 30 批的记录（admin）。 */
export function fetchAutoSend(signal?: AbortSignal): Promise<AutoSendSettings> {
  return apiFetch<AutoSendSettings>(API, { cache: "no-store", signal });
}

/**
 * 存整份设置（admin），返回存好的。不合法 ⇒ 400 + 一句英文（可以直接显示）。
 * ⚠️ 开关在 `config.tour.enabled` / `config.tickets.enabled`（2026-10-16 后端拆分，原来的顶层 `config.enabled` 没了）：
 * 打开后从下一个时间点开始发；关掉后还没开始的批次都不发，两边各自独立。
 */
export function saveAutoSend(config: AutoSendConfig): Promise<AutoSendConfig> {
  return apiFetch<AutoSendConfig>(API, { method: "PUT", body: config });
}
