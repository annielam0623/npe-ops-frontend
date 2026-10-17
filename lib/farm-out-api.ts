import { apiFetch } from "@/lib/api-client";
import type {
  FarmOutLocation,
  FarmOutNoticePreview,
  FarmOutNoticeSendResponse,
  FarmOutOrder,
  FarmOutPartner,
  FarmOutRate,
  FarmOutReport,
  FarmOutTimetable,
  FarmOutTimetableParse,
  FarmOutTourMeta,
} from "@/types/farm-out";

/**
 * Farm out（转单，G40）。后端草稿 `docs/interfaces/farm-out-2026-10-16.md`，路径 / 字段名后端定稿后要核对。
 * 结算价、时刻表、合作公司只有 admin 能改（Annie 2026-10-15）；staff 只在 Dispatch 里逐单改时间和应付。
 */
const API = "/api/farm-out";

// ── 合作公司 + 结算价 ───────────────────────────────────────────────────────────

export function fetchPartners(): Promise<FarmOutPartner[]> {
  return apiFetch<FarmOutPartner[]>(`${API}/partners`, { cache: "no-store" });
}

/** 建号时后端自动从 Default 复制三条模板。 */
export function createPartner(name: string): Promise<FarmOutPartner> {
  return apiFetch<FarmOutPartner>(`${API}/partners`, {
    method: "POST",
    body: { name },
  });
}

/** slug 建后不可改。 */
export function updatePartner(
  id: number,
  patch: { name?: string; is_active?: boolean },
): Promise<FarmOutPartner> {
  return apiFetch<FarmOutPartner>(`${API}/partners/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

export function fetchPartnerRates(id: number): Promise<FarmOutRate[]> {
  return apiFetch<FarmOutRate[]>(`${API}/partners/${id}/rates`, {
    cache: "no-store",
  });
}

/** 整张表覆盖式保存。 */
export function savePartnerRates(
  id: number,
  rates: FarmOutRate[],
): Promise<FarmOutRate[]> {
  return apiFetch<FarmOutRate[]>(`${API}/partners/${id}/rates`, {
    method: "PUT",
    body: rates,
  });
}

// ── 合作公司的上车点 + 时刻表 ────────────────────────────────────────────────────

export function fetchPartnerLocations(id: number): Promise<FarmOutLocation[]> {
  return apiFetch<FarmOutLocation[]>(`${API}/partners/${id}/locations`, {
    cache: "no-store",
  });
}

/** 整表覆盖式保存（新增 / 改名 / 删除都在这一次里）。 */
export function savePartnerLocations(
  id: number,
  locations: FarmOutLocation[],
): Promise<FarmOutLocation[]> {
  return apiFetch<FarmOutLocation[]>(`${API}/partners/${id}/locations`, {
    method: "PUT",
    body: locations,
  });
}

export function fetchPartnerTimetable(id: number): Promise<FarmOutTimetable> {
  return apiFetch<FarmOutTimetable>(`${API}/partners/${id}/timetable`, {
    cache: "no-store",
  });
}

export function savePartnerTimetable(
  id: number,
  table: FarmOutTimetable,
): Promise<FarmOutTimetable> {
  return apiFetch<FarmOutTimetable>(`${API}/partners/${id}/timetable`, {
    method: "PUT",
    body: table,
  });
}

/** 只解析不存库：返回跟现在比的变化 + 解析出来的整张表。 */
export function parsePartnerTimetable(
  id: number,
  file: File,
): Promise<FarmOutTimetableParse> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<FarmOutTimetableParse>(
    `${API}/partners/${id}/timetable/parse`,
    {
      method: "POST",
      body: form,
    },
  );
}

/** Apply：用 parse 返回的 `parsed` 整表替换。 */
export function applyPartnerTimetable(
  id: number,
  parsed: FarmOutTimetable,
): Promise<FarmOutTimetable> {
  return apiFetch<FarmOutTimetable>(`${API}/partners/${id}/timetable/apply`, {
    method: "POST",
    body: { parsed },
  });
}

export function partnerTimetableCsvUrl(id: number): string {
  return `${API}/partners/${id}/timetable/export.csv`;
}

// ── 按团共用的预计返回时间 / PLEASE NOTE ─────────────────────────────────────────

export function fetchTourMeta(): Promise<FarmOutTourMeta[]> {
  return apiFetch<FarmOutTourMeta[]>(`${API}/tour-meta`, {
    cache: "no-store",
  });
}

/** 整表覆盖式保存；空串 = 不显示。 */
export function saveTourMeta(
  rows: FarmOutTourMeta[],
): Promise<FarmOutTourMeta[]> {
  return apiFetch<FarmOutTourMeta[]>(`${API}/tour-meta`, {
    method: "PUT",
    body: rows,
  });
}

// ── Dispatch：逐单改酒店 / 时间 / 应付，发通知 ───────────────────────────────────

/** 改一张订单（任意子集）。改时间会标「staff 改过」，以后时刻表变了不再跟着变。返回这单完整的 farm_out 对象。 */
export function patchFarmOutOrder(
  orderNumber: string,
  date: string,
  patch: {
    partner_location_id?: number | null;
    checkin_time?: string | null;
    depart_time?: string | null;
    payable_amount?: number | null;
  },
): Promise<FarmOutOrder> {
  return apiFetch<FarmOutOrder>(
    `${API}/orders/${encodeURIComponent(orderNumber)}`,
    { method: "PATCH", query: { date }, body: patch },
  );
}

/** 这家公司的上车点（Dispatch 每单选酒店用）。 */
export const fetchLocationsForPartner = fetchPartnerLocations;

export function previewFarmOutNotice(
  orderNumbers: string[],
): Promise<FarmOutNoticePreview[]> {
  return apiFetch<FarmOutNoticePreview[]>(`${API}/notices/preview`, {
    method: "POST",
    body: { order_numbers: orderNumbers },
    cache: "no-store",
  });
}

/**
 * ⚠️ 真实发送：给转单客人发短信 / 邮件。已发过的单要再发放进 `send_anyway`。
 * 按小批发（同 Tickets / Morning 的做法），由调用方分批。
 */
export function sendFarmOutNotice(
  orderNumbers: string[],
  channel: "sms" | "email" | "both",
  sendAnyway: string[],
): Promise<FarmOutNoticeSendResponse> {
  return apiFetch<FarmOutNoticeSendResponse>(`${API}/notices/send`, {
    method: "POST",
    body: {
      order_numbers: orderNumbers,
      channel,
      send_anyway: sendAnyway,
    },
    cache: "no-store",
  });
}

// ── 报表 ────────────────────────────────────────────────────────────────────────

export function fetchFarmOutReport(
  from: string,
  to: string,
  partnerId: number | null,
): Promise<FarmOutReport> {
  return apiFetch<FarmOutReport>(`${API}/report`, {
    cache: "no-store",
    query: { from, to, partner_id: partnerId ?? undefined, format: "json" },
  });
}

export function farmOutReportCsvUrl(
  from: string,
  to: string,
  partnerId: number | null,
): string {
  const qs = new URLSearchParams({ from, to, format: "csv" });
  if (partnerId != null) qs.set("partner_id", String(partnerId));
  return `${API}/report?${qs}`;
}
