import { apiFetch } from "@/lib/api-client";
import type {
  ManifestCfmResult,
  ManifestMatchCandidate,
  ManifestPage,
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
