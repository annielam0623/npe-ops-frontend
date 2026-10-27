import { apiFetch } from "@/lib/api-client";
import type {
  ManifestBroadcastCheck,
  ManifestBroadcastResult,
  ManifestCfmResult,
  ManifestMatchCandidate,
  ManifestPage,
  ManifestSendTicketsResult,
  ManifestSendTourResult,
  ManifestTabKey,
} from "@/types";

/**
 * Manifests（require_staff：所有 staff 都能进，司机 / 导游 403）。
 * 金额组由后端按角色挡：staff 的 catalog 里没有、请求了会落进 denied，前端不判断角色。
 */
export function fetchManifestPage(
  params: {
    date: string;
    tab: ManifestTabKey;
    /** 空串 = 让后端用本标签 A→Z 第一颗。 */
    pill: string;
    /** null = 用后端的默认列。 */
    fields: readonly string[] | null;
    /** true = 响应多一个 `hidden` 块（平时藏起来、只能看的行，后端 G167）；不传 / false 响应和以前一字不变。 */
    includeHidden?: boolean;
  },
  signal?: AbortSignal,
): Promise<ManifestPage> {
  return apiFetch<ManifestPage>("/api/manifests", {
    cache: "no-store",
    signal,
    query: {
      date: params.date,
      tab: params.tab,
      pill: params.pill || undefined,
      fields: params.fields?.length ? params.fields.join(",") : undefined,
      include_hidden: params.includeHidden ? "true" : undefined,
    },
  });
}

/**
 * 上传 Cfm # 之前的对比（只读、不写库）。每条回 new / same / conflict / not_found，顺序和请求一致；
 * conflict 带 current / incoming，already_sent = 这单这天发过门票提醒。上限 2000 条。
 */
export interface ManifestCfmPreviewItem {
  order_number: string;
  product_code: string;
  status: "new" | "same" | "conflict" | "not_found";
  current: string;
  incoming: string;
  already_sent: boolean;
}
export function previewManifestCfm(input: {
  tour_date: string;
  items: {
    order_number: string;
    product_code: string;
    confirmation_no: string;
  }[];
}): Promise<{ tour_date: string; items: ManifestCfmPreviewItem[] }> {
  return apiFetch<{ tour_date: string; items: ManifestCfmPreviewItem[] }>(
    "/api/manifests/cfm/preview",
    { method: "POST", body: input, cache: "no-store" },
  );
}

/** staff 填确认号；空串 = 清空。这一单这一天这个产品在 Rezdy 不存在时 404。 */
export function saveManifestCfm(input: {
  order_number: string;
  product_code: string;
  tour_date: string;
  confirmation_no: string;
}): Promise<ManifestCfmResult> {
  return apiFetch<ManifestCfmResult>("/api/manifests/cfm", {
    method: "PUT",
    body: input,
  });
}

/**
 * Bus tour 一节的 Cfm #（G198，后端 8a）：按「日期 + 团 + 节」存一个号，Bus Manifest 每辆车那一节的标题都带它。
 * `cfm_no` 送 "" = 清空。所有 staff 都能存；没开格的节 400 + 英文原因。只记录，不发送。
 */
export function saveManifestSectionCfm(input: {
  tour_date: string;
  manifest_id: number;
  section: string;
  cfm_no: string;
}): Promise<{
  ok: boolean;
  tour_date: string;
  manifest_id: number;
  section: string;
  cfm_no: string;
}> {
  return apiFetch("/api/manifests/section-cfm", { method: "PUT", body: input });
}

// ── 按名单发送（后端 main-manifest-sections ②③，2026-10-09）──────────────────────────────
// 收件人的姓名 / 电话 / 邮箱都由后端按 row_key 从当天的 Rezdy 行取，前端只传 row_key。
// 有一个 row_key 不在当天名单里（取消了 / 日期不对）、没有 Cfm # 等 ⇒ 400，整批不发。

/** 发之前看勾的客人里谁这个团期已经收过一模一样的消息（只读，G62）。 */
export function checkManifestBroadcast(input: {
  date: string;
  row_keys: string[];
  message: string;
}): Promise<ManifestBroadcastCheck> {
  return apiFetch<ManifestBroadcastCheck>("/api/manifests/broadcast/check", {
    method: "POST",
    body: input,
    cache: "no-store",
  });
}

/**
 * ⚠️ 真实发送：勾选的客人发自定义消息（同一订单只发一条），记进 Broadcasting Log。
 * 收过一模一样消息的默认跳过；要再发带 `send_anyway`（订单号）+ `preview_at`（check 的 checked_at）。
 * 同一团期同时只能一个群发（409，什么都没发）。
 */
export function broadcastManifest(input: {
  date: string;
  row_keys: string[];
  message: string;
  send_sms: boolean;
  send_email: boolean;
  send_anyway?: string[];
  preview_at?: string;
}): Promise<ManifestBroadcastResult> {
  return apiFetch<ManifestBroadcastResult>("/api/manifests/broadcast", {
    method: "POST",
    body: input,
  });
}

/**
 * ⚠️ 真实发送：巴士团确认（同团确认发送页，查重 / 锁 / 建行 / 告警都是同一份）。每组一个 tour type。
 * 已发过的服务端跳过；要再发就带 `send_anyway`（订单号）+ `preview_at`（上一次返回的 checked_at）。
 */
export function sendManifestTour(input: {
  date: string;
  groups: { tour_type: string; row_keys: string[] }[];
  /** 缺省 = 团确认；"last_minute" = Last Minute（其它值后端整批 400、什么都不发）。 */
  lane?: "last_minute";
  /** 渠道（后端 G154）：两个都缺省 = SMS + Email；传了就都必须是 bool 且不能都 false（否则 400）。 */
  send_sms?: boolean;
  send_email?: boolean;
  send_anyway?: string[];
  preview_at?: string;
}): Promise<ManifestSendTourResult> {
  return apiFetch<ManifestSendTourResult>("/api/manifests/send-tour", {
    method: "POST",
    body: input,
  });
}

/** ⚠️ 真实发送：门票提醒（同门票发送页），确认号用 staff 填的 Cfm #，没填的整批 400。 */
export function sendManifestTickets(input: {
  date: string;
  row_keys: string[];
  send_sms?: boolean;
  send_email?: boolean;
  send_anyway?: string[];
  preview_at?: string;
}): Promise<ManifestSendTicketsResult> {
  return apiFetch<ManifestSendTicketsResult>("/api/manifests/send-tickets", {
    method: "POST",
    body: input,
  });
}

const ALL_TABS: readonly ManifestTabKey[] = ["bus", "tickets"];

function collectCandidates(
  page: ManifestPage,
  out: ManifestMatchCandidate[],
): void {
  for (const row of page.rows) {
    const pax = row.values.pax;
    out.push({
      order_number: row.order_number,
      product_code: row.product_code,
      tour_date: row.tour_date,
      pax: typeof pax === "number" ? pax : null,
    });
  }
}

/**
 * 这一天两个标签、全部胶囊的页（只要 `fields` 这几列，保持请求小）。
 * 接口一次只返回一个胶囊，所以要先各拿一次标签默认胶囊、再按返回的 `pills` 补拉其余胶囊——
 * 全部并发，一天通常十来个胶囊，不会很慢。
 */
async function fetchAllPagesForDate(
  date: string,
  fields: readonly string[],
  signal?: AbortSignal,
): Promise<ManifestPage[]> {
  const seeds = await Promise.all(
    ALL_TABS.map((tab) =>
      fetchManifestPage({ date, tab, pill: "", fields }, signal),
    ),
  );
  const rest = seeds.flatMap((page) =>
    page.pills
      .filter((p) => p.key !== page.pill)
      .map((p) => ({ tab: page.tab, pill: p.key })),
  );
  const pages = await Promise.all(
    rest.map((r) =>
      fetchManifestPage({ date, tab: r.tab, pill: r.pill, fields }, signal),
    ),
  );
  return [...seeds, ...pages];
}

/** Cfm # 批量上传配套：这一天全部订单的定位 + pax。 */
export async function fetchAllManifestRowsForDate(
  date: string,
  signal?: AbortSignal,
): Promise<ManifestMatchCandidate[]> {
  const out: ManifestMatchCandidate[] = [];
  for (const page of await fetchAllPagesForDate(date, ["pax"], signal))
    collectCandidates(page, out);
  return out;
}

/** 搜索用的一行：在哪个标签 / 胶囊，加上能搜的几项。 */
export interface ManifestSearchEntry {
  tab: ManifestTabKey;
  tabLabel: string;
  pill: string;
  pillLabel: string;
  row_key: string;
  order_number: string;
  guest_name: string;
  phone: string;
  email: string;
  pax: number | null;
}

const SEARCH_FIELDS = ["guest_name", "phone", "email", "pax"] as const;

/** 页面上的搜索：这一天全部标签、全部胶囊的订单（单号、姓名、电话、邮箱）。 */
export async function fetchManifestSearchIndex(
  date: string,
  signal?: AbortSignal,
): Promise<ManifestSearchEntry[]> {
  const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const out: ManifestSearchEntry[] = [];
  for (const page of await fetchAllPagesForDate(date, SEARCH_FIELDS, signal)) {
    const tabLabel = page.tabs.find((t) => t.key === page.tab)?.label ?? "";
    const pillLabel = page.pills.find((p) => p.key === page.pill)?.label ?? "";
    for (const row of page.rows) {
      const pax = row.values.pax;
      out.push({
        tab: page.tab,
        tabLabel,
        pill: page.pill ?? "",
        pillLabel,
        row_key: row.row_key,
        order_number: row.order_number,
        guest_name: text(row.values.guest_name),
        phone: text(row.values.phone),
        email: text(row.values.email),
        pax: typeof pax === "number" ? pax : null,
      });
    }
  }
  return out;
}
