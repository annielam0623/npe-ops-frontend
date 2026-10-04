import { apiFetch } from "@/lib/api-client";
import type {
  DispatchCopyResult,
  DispatchDay,
  DispatchPrefill,
  DispatchPullResult,
  DispatchRow,
  DispatchSaveResult,
} from "@/types";

/**
 * Dispatch → Assignments。全部 require_staff。
 * ⚠️ 保存是**整天覆盖**、后存的赢（没有版本检查）；保存后司机手机页和 manifest 立刻读到新排车。
 * 保存不发短信；手填了 HR 里没有的人时，服务端给 Annie 发一封邮件（每个名字一次）。
 */
const API = "/api/dispatch";

/** date 不传 = 服务端默认（洛杉矶明天）。 */
export function fetchDispatchDay(
  date: string | null,
  signal?: AbortSignal,
): Promise<DispatchDay> {
  return apiFetch<DispatchDay>(`${API}/day`, {
    cache: "no-store",
    signal,
    query: date ? { date } : undefined,
  });
}

/** 送去保存的行：去掉只用来显示的名字和 CCL 原文，只送 CCL 是哪一行。 */
function postRows(rows: DispatchRow[]) {
  return rows.map((r) => ({
    id: r.id,
    shift: r.shift,
    driver_hr_id: r.driver_hr_id,
    driver_typed_name: r.driver_typed_name,
    vehicle_id: r.vehicle_id,
    manifest_id: r.manifest_id,
    custom_tour_name: r.custom_tour_name,
    guide_hr_id: r.guide_hr_id,
    guide_typed_name: r.guide_typed_name,
    bus_label: r.bus_label,
    note: r.note,
    location_ids: r.location_ids,
    ccl_line_id: r.ccl ? r.ccl.line_id : null,
  }));
}

export function saveDispatchDay(
  date: string,
  rows: DispatchRow[],
  cclImportId: number | null,
): Promise<DispatchSaveResult> {
  return apiFetch<DispatchSaveResult>(`${API}/day`, {
    method: "POST",
    body: { date, rows: postRows(rows), ccl_import_id: cclImportId },
  });
}

/** 照抄另一天：**直接写库**（不经过 Save）。 */
export function copyDispatchDay(
  date: string,
  from: string,
): Promise<DispatchCopyResult> {
  return apiFetch<DispatchCopyResult>(`${API}/copy`, {
    method: "POST",
    body: { date, from },
  });
}

/** CCL 当前这一版（预填 / 改版 / 关闭的线）。拿不到就当没有。 */
export async function fetchDispatchPrefill(
  date: string,
): Promise<DispatchPrefill | null> {
  const result = await apiFetch<{ prefill: DispatchPrefill | null }>(
    `${API}/imports/day`,
    { cache: "no-store", query: { date } },
  );
  return result.prefill;
}

/** 从 Discord 拉 CCL 的消息（读 Discord、写导入表，不动排车）。服务端自带锁和 5 秒冷却；永远 200。 */
export function pullFromDiscord(
  trigger: "page" | "manual",
): Promise<DispatchPullResult> {
  return apiFetch<DispatchPullResult>(`${API}/imports/pull`, {
    method: "POST",
    body: { trigger },
  });
}
