import { apiFetch } from "@/lib/api-client";
import type {
  FarmOutLocation,
  FarmOutNoticePreview,
  FarmOutNoticeSendResponse,
  FarmOutOrderPatched,
  FarmOutPartner,
  FarmOutRate,
  FarmOutReport,
  FarmOutTimetable,
  FarmOutTimetableParse,
  FarmOutTourMeta,
} from "@/types/farm-out";

/**
 * Farm out（转单，G40）。后端已上线，形状以代码为准（`app/routers/farm_out.py`、`farm_out_settings.py`，
 * 文档第八节；2026-10-17 对着代码核对过）。
 * 权限：GET partners / GET tour-meta / 订单面（PATCH 订单、通知、报表）= staff；
 * 合作公司的增改、结算价、上车点、时刻表、tour-meta 的保存 = admin（GET 结算价 / 上车点 / 时刻表也是 admin）。
 * 所有保存（POST / PUT / PATCH）返回 `{ok, <键>: ...}`，这里拆出来，调用方拿到的还是里面那份数据。
 */
const API = "/api/farm-out";

// ── 合作公司 + 结算价 ───────────────────────────────────────────────────────────

export function fetchPartners(): Promise<FarmOutPartner[]> {
  return apiFetch<FarmOutPartner[]>(`${API}/partners`, { cache: "no-store" });
}

/** 建号时后端自动从 Default 复制三条模板。 */
export async function createPartner(name: string): Promise<FarmOutPartner> {
  const r = await apiFetch<{ partner: FarmOutPartner }>(`${API}/partners`, {
    method: "POST",
    body: { name },
  });
  return r.partner;
}

/** slug 建后不可改。 */
export async function updatePartner(
  id: number,
  patch: { name?: string; is_active?: boolean },
): Promise<FarmOutPartner> {
  const r = await apiFetch<{ partner: FarmOutPartner }>(
    `${API}/partners/${id}`,
    { method: "PATCH", body: patch },
  );
  return r.partner;
}

export function fetchPartnerRates(id: number): Promise<FarmOutRate[]> {
  return apiFetch<FarmOutRate[]>(`${API}/partners/${id}/rates`, {
    cache: "no-store",
  });
}

/** 整张表覆盖式保存。 */
export async function savePartnerRates(
  id: number,
  rates: FarmOutRate[],
): Promise<FarmOutRate[]> {
  const r = await apiFetch<{ rates: FarmOutRate[] }>(
    `${API}/partners/${id}/rates`,
    { method: "PUT", body: rates },
  );
  return r.rates;
}

// ── 合作公司的上车点 + 时刻表 ────────────────────────────────────────────────────

export function fetchPartnerLocations(id: number): Promise<FarmOutLocation[]> {
  return apiFetch<FarmOutLocation[]>(`${API}/partners/${id}/locations`, {
    cache: "no-store",
  });
}

/** 整表覆盖式保存（新增 / 改名 / 删除都在这一次里）。 */
export async function savePartnerLocations(
  id: number,
  locations: FarmOutLocation[],
): Promise<FarmOutLocation[]> {
  const r = await apiFetch<{ locations: FarmOutLocation[] }>(
    `${API}/partners/${id}/locations`,
    { method: "PUT", body: locations },
  );
  return r.locations;
}

export function fetchPartnerTimetable(id: number): Promise<FarmOutTimetable> {
  return apiFetch<FarmOutTimetable>(`${API}/partners/${id}/timetable`, {
    cache: "no-store",
  });
}

export async function savePartnerTimetable(
  id: number,
  table: FarmOutTimetable,
): Promise<FarmOutTimetable> {
  const r = await apiFetch<{ timetable: FarmOutTimetable }>(
    `${API}/partners/${id}/timetable`,
    { method: "PUT", body: table },
  );
  return r.timetable;
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
export async function applyPartnerTimetable(
  id: number,
  parsed: FarmOutTimetable,
): Promise<FarmOutTimetable> {
  const r = await apiFetch<{ timetable: FarmOutTimetable }>(
    `${API}/partners/${id}/timetable/apply`,
    { method: "POST", body: { parsed } },
  );
  return r.timetable;
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
export async function saveTourMeta(
  rows: FarmOutTourMeta[],
): Promise<FarmOutTourMeta[]> {
  const r = await apiFetch<{ items: FarmOutTourMeta[] }>(`${API}/tour-meta`, {
    method: "PUT",
    body: rows,
  });
  return r.items;
}

// ── Dispatch：逐单改酒店 / 时间 / 应付，发通知 ───────────────────────────────────

/**
 * 改一张订单（任意子集）。改时间会标「staff 改过」，以后时刻表变了不再跟着变。
 * 传 null = 交回自动（时间按时刻表重算，应付按结算价重算）。
 * 后端返回 `{ok, farm_out: {..., missing}}`，这里拆出 farm_out（带 missing）。
 */
export async function patchFarmOutOrder(
  orderNumber: string,
  date: string,
  manifestId: number,
  patch: {
    partner_location_id?: number | null;
    checkin_time?: string | null;
    depart_time?: string | null;
    payable_amount?: number | null;
  },
): Promise<FarmOutOrderPatched> {
  const r = await apiFetch<{ farm_out: FarmOutOrderPatched }>(
    `${API}/orders/${encodeURIComponent(orderNumber)}`,
    {
      method: "PATCH",
      query: { date, manifest_id: manifestId },
      body: patch,
    },
  );
  return r.farm_out;
}

/** 这家公司的上车点（Dispatch 每单选酒店用）。 */
export const fetchLocationsForPartner = fetchPartnerLocations;

/** 一张转单订单的唯一键是 (订单号, 日期, 团)：body 带 date + orders[{manifest_id, order_number}]（上限 300 单）。 */
export interface FarmOutOrderRef {
  manifest_id: number;
  order_number: string;
}

export function previewFarmOutNotice(
  date: string,
  orders: FarmOutOrderRef[],
): Promise<FarmOutNoticePreview[]> {
  return apiFetch<FarmOutNoticePreview[]>(`${API}/notices/preview`, {
    method: "POST",
    body: { date, orders },
    cache: "no-store",
  });
}

/**
 * ⚠️ 真实发送：给转单客人发短信 / 邮件。已发过的单要再发放进 `send_anyway`。
 * 按小批发（同 Tickets / Morning 的做法），由调用方分批。
 */
export function sendFarmOutNotice(
  date: string,
  orders: FarmOutOrderRef[],
  channel: "sms" | "email" | "both",
  sendAnyway: string[],
): Promise<FarmOutNoticeSendResponse> {
  return apiFetch<FarmOutNoticeSendResponse>(`${API}/notices/send`, {
    method: "POST",
    body: {
      date,
      orders,
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
