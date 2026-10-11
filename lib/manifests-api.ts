import { apiFetch } from "@/lib/api-client";
import type {
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
    },
  });
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

// ── 按名单发送（后端 main-manifest-sections ②③，2026-10-09）──────────────────────────────
// 收件人的姓名 / 电话 / 邮箱都由后端按 row_key 从当天的 Rezdy 行取，前端只传 row_key。
// 有一个 row_key 不在当天名单里（取消了 / 日期不对）、没有 Cfm # 等 ⇒ 400，整批不发。

/** ⚠️ 真实发送：勾选的客人发自定义消息（同一订单只发一条），记进 Broadcasting Log。 */
export function broadcastManifest(input: {
  date: string;
  row_keys: string[];
  message: string;
  send_sms: boolean;
  send_email: boolean;
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
 * Cfm # 批量上传配套：这一天两个标签、全部胶囊的订单（只要定位 + pax，`fields: ["pax"]` 保持请求小）。
 * 接口一次只返回一个胶囊，所以要先各拿一次标签默认胶囊、再按返回的 `pills` 补拉其余胶囊——
 * 全部并发，一天通常十来个胶囊，不会很慢。
 */
export async function fetchAllManifestRowsForDate(
  date: string,
  signal?: AbortSignal,
): Promise<ManifestMatchCandidate[]> {
  const seeds = await Promise.all(
    ALL_TABS.map((tab) =>
      fetchManifestPage({ date, tab, pill: "", fields: ["pax"] }, signal),
    ),
  );
  const rest = seeds.flatMap((page) =>
    page.pills
      .filter((p) => p.key !== page.pill)
      .map((p) => ({ tab: page.tab, pill: p.key })),
  );
  const pages = await Promise.all(
    rest.map((r) =>
      fetchManifestPage(
        { date, tab: r.tab, pill: r.pill, fields: ["pax"] },
        signal,
      ),
    ),
  );
  const out: ManifestMatchCandidate[] = [];
  for (const page of [...seeds, ...pages]) collectCandidates(page, out);
  return out;
}
