import { apiFetch } from "@/lib/api-client";
import type {
  TcqAirline,
  TcqDictionaryTerm,
  TcqEvent,
  TcqEventInput,
  TcqPlace,
  TcqQuotePreview,
  TcqQuoteSummary,
  TcqRequest,
  TcqSavedQuote,
  TcqSettings,
  TcqVehicle,
  TcqVehicleInput,
} from "@/types/tcq";

/**
 * Transfer & Charter Quotation（后端 G66 阶段二，confirm `01bca8a`）。报价接口 require_staff；
 * Settings → Transfer & Charter 的接口 require_admin。输入不对回 400 {detail}，原样显示。
 * ⚠️ ops 连生产：Generate quote 会真的取单号、改工作项状态。测试只用 ZZ Test 的工作项。
 */

export async function fetchRateCard(
  signal?: AbortSignal,
): Promise<TcqVehicle[]> {
  const r = await apiFetch<{ vehicles: TcqVehicle[] }>("/api/tcq/rate-card", {
    cache: "no-store",
    signal,
  });
  return r.vehicles;
}

/** 按今天的价目表算一遍，不存、不取单号。 */
export function previewQuote(
  itemId: number,
  body: TcqRequest,
  signal?: AbortSignal,
): Promise<TcqQuotePreview> {
  return apiFetch(`/api/workspace/items/${itemId}/tcq-quote/preview`, {
    method: "POST",
    body,
    signal,
  });
}

/** Generate quote：取单号、锁价存下，工作项状态 → Quote sent。再点一次 = 新单号。 */
export function generateQuote(
  itemId: number,
  body: TcqRequest,
): Promise<TcqSavedQuote> {
  return apiFetch(`/api/workspace/items/${itemId}/tcq-quote`, {
    method: "POST",
    body,
  });
}

export async function fetchQuotes(
  itemId: number,
  signal?: AbortSignal,
): Promise<TcqQuoteSummary[]> {
  const r = await apiFetch<{ quotes: TcqQuoteSummary[] }>(
    `/api/workspace/items/${itemId}/tcq-quotes`,
    { cache: "no-store", signal },
  );
  return r.quotes;
}

/** PDF（附件下载）。浏览器直接打开这个同源地址，cookie 随请求带上。 */
export function quotePdfUrl(quoteId: number): string {
  return `/api/tcq/quotes/${quoteId}/pdf`;
}

// ── Settings → Transfer & Charter（admin）──

export function fetchTcqSettings(signal?: AbortSignal): Promise<TcqSettings> {
  return apiFetch("/api/settings/tcq", { cache: "no-store", signal });
}

export function saveVehicle(
  id: number | null,
  body: TcqVehicleInput,
): Promise<TcqVehicle> {
  return apiFetch(
    id == null
      ? "/api/settings/tcq/vehicles"
      : `/api/settings/tcq/vehicles/${id}`,
    { method: id == null ? "POST" : "PUT", body },
  );
}

export function saveEvent(
  id: number | null,
  body: TcqEventInput,
): Promise<TcqEvent> {
  return apiFetch(
    id == null ? "/api/settings/tcq/events" : `/api/settings/tcq/events/${id}`,
    { method: id == null ? "POST" : "PUT", body },
  );
}

export function deleteEvent(id: number): Promise<{ ok: true }> {
  return apiFetch(`/api/settings/tcq/events/${id}`, { method: "DELETE" });
}

/** 只改给了的几项；回存下的 {key: value}。 */
export function saveTerms(
  body: Record<string, string>,
): Promise<Record<string, string>> {
  return apiFetch("/api/settings/tcq/terms", { method: "PUT", body });
}

export function addDictionaryTerm(body: {
  kind: string;
  term: string;
}): Promise<TcqDictionaryTerm> {
  return apiFetch("/api/settings/tcq/dictionary", { method: "POST", body });
}

export function deleteDictionaryTerm(id: number): Promise<{ ok: true }> {
  return apiFetch(`/api/settings/tcq/dictionary/${id}`, { method: "DELETE" });
}

/** 新加或修改（同一个代码就是改）。 */
export function saveAirline(
  code: string,
  isInternational: boolean,
): Promise<TcqAirline> {
  return apiFetch(`/api/settings/tcq/airlines/${encodeURIComponent(code)}`, {
    method: "PUT",
    body: { is_international: isInternational },
  });
}

export function deleteAirline(code: string): Promise<{ ok: true }> {
  return apiFetch(`/api/settings/tcq/airlines/${encodeURIComponent(code)}`, {
    method: "DELETE",
  });
}

/** 后端回的 aliases 是逗号连起来的字符串；这里换回数组，和 GET 的形状一样。 */
export async function savePlace(
  id: number | null,
  body: { name: string; kind: string; aliases: string[] },
): Promise<TcqPlace> {
  const r = await apiFetch<{
    id: number;
    name: string;
    kind: string;
    aliases: string;
  }>(
    id == null ? "/api/settings/tcq/places" : `/api/settings/tcq/places/${id}`,
    {
      method: id == null ? "POST" : "PUT",
      body,
    },
  );
  return { ...r, aliases: splitAliases(r.aliases) };
}

export function deletePlace(id: number): Promise<{ ok: true }> {
  return apiFetch(`/api/settings/tcq/places/${id}`, { method: "DELETE" });
}

export function splitAliases(raw: string): string[] {
  return raw
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}
