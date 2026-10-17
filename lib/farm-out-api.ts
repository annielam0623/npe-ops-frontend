import { apiFetch } from "@/lib/api-client";
import type {
  FarmOutDay,
  FarmOutOrderDetail,
  FarmOutPartner,
  FarmOutPartnerRate,
  FarmOutReport,
  FarmOutSendPreview,
  FarmOutSendResult,
  FarmOutTimetable,
  FarmOutTimetableUploadDiff,
} from "@/types/farm-out";

/**
 * Farm out（转单，G40，任务包 docs/farm-out/任务包_farm-out.md）。阶段一后端还没做，
 * 这一轮接 mock 出预览；接口形状是 ops 按任务包定的建议，后端接口好了要对一遍（见 PROGRESS.md「需要后端」）。
 * 全部 require_admin（Partners / Timetable 设置）或 require_staff（Dispatch 逐单改、发通知、报表）。
 */

// ── Settings → Farm out Partners ──

/**
 * 全部可转单的团清单（按团名排好序，manifest_id + tour_name）。Partners 设置页 Edit 一家公司时要
 * 展开全部团（不止已经设过价的），`FarmOutPartner.rates` 只带已设价的行，不够用，所以单独拉。
 * 原任务包没有这个接口，是本轮前端加的；接口形状待后端确认（见 PROGRESS.md「需要后端」）。
 */
export async function fetchFarmOutTours(
  signal?: AbortSignal,
): Promise<{ manifest_id: number; tour_name: string }[]> {
  const r = await apiFetch<{ tours: { manifest_id: number; tour_name: string }[] }>(
    "/api/settings/farm-out/tours",
    { cache: "no-store", signal },
  );
  return r.tours;
}

export async function fetchFarmOutPartners(
  signal?: AbortSignal,
): Promise<FarmOutPartner[]> {
  const r = await apiFetch<{ partners: FarmOutPartner[] }>(
    "/api/settings/farm-out/partners",
    { cache: "no-store", signal },
  );
  return r.partners;
}

export function createFarmOutPartner(name: string): Promise<FarmOutPartner> {
  return apiFetch("/api/settings/farm-out/partners", {
    method: "POST",
    body: { name },
  });
}

export async function renameFarmOutPartner(
  id: number,
  name: string,
): Promise<void> {
  await apiFetch(`/api/settings/farm-out/partners/${id}`, {
    method: "PATCH",
    body: { name },
  });
}

export async function setFarmOutPartnerActive(
  id: number,
  active: boolean,
): Promise<void> {
  await apiFetch(`/api/settings/farm-out/partners/${id}/active`, {
    method: "PATCH",
    body: { active },
  });
}

export async function deleteFarmOutPartner(id: number): Promise<void> {
  await apiFetch(`/api/settings/farm-out/partners/${id}`, {
    method: "DELETE",
  });
}

/** 一家公司一个团的成人 / 儿童价；两个都传 null = 删这一行（这个团这家公司不能转）。 */
export async function saveFarmOutPartnerRate(
  partnerId: number,
  manifestId: number,
  rate: { adult_rate: number | null; child_rate: number | null },
): Promise<FarmOutPartnerRate> {
  return apiFetch(
    `/api/settings/farm-out/partners/${partnerId}/rates/${manifestId}`,
    { method: "PUT", body: rate },
  );
}

// ── Settings → Farm out Timetable ──

/** 一家公司的上车点（只要地址/时刻表，不要整份设置页数据）：Dispatch 车下面选酒店用。 */
export async function fetchFarmOutPartnerSpots(
  partnerId: number,
  signal?: AbortSignal,
): Promise<{ id: number; name: string; departures: Record<number, string> }[]> {
  const r = await apiFetch<{
    spots: { id: number; name: string; departures: Record<number, string> }[];
  }>(`/api/settings/farm-out/timetable/partners/${partnerId}/spots`, {
    cache: "no-store",
    signal,
  });
  return r.spots;
}

export async function fetchFarmOutTimetable(
  signal?: AbortSignal,
): Promise<FarmOutTimetable> {
  return apiFetch("/api/settings/farm-out/timetable", {
    cache: "no-store",
    signal,
  });
}

export function createFarmOutSpot(
  partnerId: number,
  name: string,
): Promise<{ id: number }> {
  return apiFetch("/api/settings/farm-out/timetable/spots", {
    method: "POST",
    body: { partner_id: partnerId, name },
  });
}

export async function saveFarmOutSpot(
  spotId: number,
  input: { name: string; address: string; map_link: string },
): Promise<void> {
  await apiFetch(`/api/settings/farm-out/timetable/spots/${spotId}`, {
    method: "PUT",
    body: input,
  });
}

export async function deleteFarmOutSpot(spotId: number): Promise<void> {
  await apiFetch(`/api/settings/farm-out/timetable/spots/${spotId}`, {
    method: "DELETE",
  });
}

/** 一个格子（酒店 × 团）的发车时间；空字符串 = 清空这个格子。 */
export async function saveFarmOutDeparture(
  spotId: number,
  manifestId: number,
  departTime: string,
): Promise<void> {
  await apiFetch(
    `/api/settings/farm-out/timetable/spots/${spotId}/departures/${manifestId}`,
    { method: "PUT", body: { depart_time: departTime } },
  );
}

/** 按团，所有公司共用：预计返回时间 / PLEASE NOTE。 */
export async function saveFarmOutTourMeta(
  manifestId: number,
  meta: { return_time: string | null; please_note: string },
): Promise<void> {
  await apiFetch(`/api/settings/farm-out/timetable/tour-meta/${manifestId}`, {
    method: "PUT",
    body: meta,
  });
}

/** 上传 CSV / xlsx：先解析出 diff，不存。 */
export function uploadFarmOutTimetable(
  partnerId: number,
  file: File,
): Promise<FarmOutTimetableUploadDiff> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch(
    `/api/settings/farm-out/timetable/partners/${partnerId}/upload`,
    { method: "POST", body: form },
  );
}

/** Apply：用 upload 解析出的 parsed 整张表替换这家公司的表。 */
export async function applyFarmOutTimetable(
  partnerId: number,
  parsed: FarmOutTimetableUploadDiff["parsed"],
): Promise<void> {
  await apiFetch(
    `/api/settings/farm-out/timetable/partners/${partnerId}/apply`,
    { method: "POST", body: { parsed } },
  );
}

export function farmOutTimetableCsvUrl(partnerId: number): string {
  return `/api/settings/farm-out/timetable/partners/${partnerId}/export.csv`;
}

// ── Dispatch：当天 Farm out 状态（和 Step 2 的车/订单拼在一起用） ──

export async function fetchFarmOutDay(
  date: string,
  signal?: AbortSignal,
): Promise<FarmOutDay> {
  return apiFetch(`/api/dispatch/farm-out/day`, {
    cache: "no-store",
    signal,
    query: { date },
  });
}

/** 逐单改：上车点 / 时间（time_edited 由后端按是否等于自动算的值判断）/ 应付金额。 */
export async function saveFarmOutOrderDetail(
  date: string,
  orderNumber: string,
  patch: Partial<
    Pick<
      FarmOutOrderDetail,
      "pickup_spot_id" | "checkin_time" | "depart_time" | "payable"
    >
  >,
): Promise<FarmOutOrderDetail> {
  return apiFetch(
    `/api/dispatch/farm-out/day/orders/${encodeURIComponent(orderNumber)}`,
    { method: "PATCH", body: { date, ...patch } },
  );
}

// ── 发转单通知（统一发送格式，components/tickets-send/legacy-ui） ──

export async function fetchFarmOutSendPreview(
  date: string,
  manifestId: number,
  signal?: AbortSignal,
): Promise<FarmOutSendPreview> {
  return apiFetch(`/api/dispatch/farm-out/send-preview`, {
    cache: "no-store",
    signal,
    query: { date, manifest_id: manifestId },
  });
}

export function sendFarmOutNotice(
  date: string,
  manifestId: number,
  orderNumbers: string[],
  sendAnyway: string[],
): Promise<FarmOutSendResult> {
  return apiFetch("/api/dispatch/farm-out/send", {
    method: "POST",
    body: {
      date,
      manifest_id: manifestId,
      order_numbers: orderNumbers,
      send_anyway: sendAnyway,
    },
  });
}

// ── 报表 ──

export async function fetchFarmOutReport(
  params: { date_from: string; date_to: string; partner_id?: number },
  signal?: AbortSignal,
): Promise<FarmOutReport> {
  return apiFetch("/api/farm-out/report", {
    cache: "no-store",
    signal,
    query: {
      date_from: params.date_from,
      date_to: params.date_to,
      partner_id: params.partner_id,
    },
  });
}

export function farmOutReportCsvUrl(params: {
  date_from: string;
  date_to: string;
  partner_id?: number;
}): string {
  const q = new URLSearchParams({
    date_from: params.date_from,
    date_to: params.date_to,
  });
  if (params.partner_id) q.set("partner_id", String(params.partner_id));
  return `/api/farm-out/report/export.csv?${q.toString()}`;
}
