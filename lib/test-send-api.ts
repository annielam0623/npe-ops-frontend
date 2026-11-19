import { apiFetch } from "@/lib/api-client";
import type {
  TestSendChannel,
  TestSendOptions,
  TestSendPreview,
  TestSendResult,
  TestSendTarget,
} from "@/types/test-send";

/**
 * Settings › Test send（后端 8e a88e43f6，只有 admin / Super Admin，别人 403「Admin access required」）。
 * 422 {detail} 是给 staff 看的英文句，页面原样红字显示；渠道失败是 200 里的 {ok:false, error}，也原样显示。
 * 不建订单、不改发送状态；每次 send 后端写一条 action_log。
 */

export function fetchTestSendOptions(
  signal?: AbortSignal,
): Promise<TestSendOptions> {
  return apiFetch("/api/test-send/options", { cache: "no-store", signal });
}

export function previewTestSend(
  target: TestSendTarget,
): Promise<TestSendPreview> {
  return apiFetch("/api/test-send/preview", { method: "POST", body: target });
}

export function sendTestSend(
  body: TestSendTarget & {
    phone: string;
    email: string;
    channels: TestSendChannel[];
  },
): Promise<TestSendResult> {
  return apiFetch("/api/test-send/send", { method: "POST", body });
}
