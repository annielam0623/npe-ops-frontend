import { apiFetch } from "@/lib/api-client";
import type {
  MorningMessagePreview,
  MorningPreview,
  MorningSendResponse,
  MorningSendType,
} from "@/types";

/** 早班只有一个模板，用示例客人渲染短信和客人追踪页。纯读。 */
export function fetchMorningMessagePreview(
  signal?: AbortSignal,
): Promise<MorningMessagePreview> {
  return apiFetch<MorningMessagePreview>(
    "/api/notifications/morning-pickup/message-preview",
    { cache: "no-store", signal },
  );
}

/** 上传 manifest（.csv 或 .xlsx）：解析文件，并标出今天（洛杉矶）已经发过的订单。不发送任何东西。 */
export function previewMorningManifest(file: File): Promise<MorningPreview> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<MorningPreview>("/api/notifications/morning-pickup/preview", {
    method: "POST",
    body: form,
    cache: "no-store",
  });
}

/**
 * ⚠️ 真实发送：后端重新解析同一个文件，只给 orders 里的订单发，其余行返回 skipped。
 * 团期一律是今天（洛杉矶），由后端决定。
 *
 * 🔴 orders 不能为空，而且必须是合法 JSON 数组：后端 `selected_orders` 缺失或解析失败时
 *    会**发给文件里的所有人**（send.py 的向后兼容分支）。
 *
 * 服务端查重（后端 2026-10-06，E141）：今天早班线发过的单一律跳过（reason "already_sent"），
 * 除非它在 sendAnyway 里、而且最近一次发出去早于 previewAt（预览接口给的时间）——所以 Send anyway 只多发一次。
 * 文件里同一单两行只发第一行（reason "listed_twice"）。
 */
export function sendMorningBatch(
  file: File,
  sendType: MorningSendType,
  orders: string[],
  guard: { sendAnyway: string[]; previewAt: string },
): Promise<MorningSendResponse> {
  if (orders.length === 0) {
    throw new Error("No orders selected.");
  }
  const form = new FormData();
  form.append("file", file);
  form.append("send_type", sendType);
  form.append("selected_orders", JSON.stringify(orders));
  form.append("send_anyway", JSON.stringify(guard.sendAnyway));
  form.append("preview_at", guard.previewAt);
  return apiFetch<MorningSendResponse>("/send/morning-pickup", {
    method: "POST",
    body: form,
    cache: "no-store",
  });
}
