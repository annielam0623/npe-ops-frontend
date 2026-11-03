import type { ManifestPage } from "@/types";

/**
 * 没勾 See prices, agent & commission（`orders.money_view`，Annie 2026-11-02 题 8「动手」）时要藏的东西，各页共用。
 * 能不能看用 `usePermissions().canSeeMoney`；这里只放「哪些算钱」。
 * 后端没勾时本来就不给这些字段（task/agent-view），前端再挡一道：旧存的列选择、旧后端、上传文件的表头都不出空栏。
 */

/**
 * Main manifest（GET /api/manifests）里算钱 / 代理商的列（后端 money 组 + 代理商几列，后端 36 定稿）。
 * 没勾的人：Columns 里加不上、存着的也不画、不算进「需要权限」那句提示。
 */
export const MANIFEST_MONEY_FIELDS: ReadonlySet<string> = new Set([
  "item_amount",
  "order_total",
  "total_paid",
  "total_due",
  "currency",
  "commission",
  "payment_option",
  "coupon",
  "surcharge",
  "vouchers",
  "date_paid",
  "reseller_comments",
  "agent_name",
  "reseller_reference",
  "created_by",
  "source",
  "source_channel",
]);

/**
 * 上传名单（Tour / Tickets tracking）里算钱 / 代理商的表头：同后端去掉的那几组词（后端 36 审查后定稿）。
 * 第一组按字串（Agent Name、Order Total Paid…）；第二组是短词，按整词比（「Due」不误伤别的表头里的 due 字母）。
 */
const MONEY_HEADER_PART =
  /agent|reseller|commission|price|amount|paid|balance|cost|currency|payment/i;
const MONEY_HEADER_WORD =
  /\b(order total|subtotal|due|discount|coupon|tax|surcharge|vouchers?|net|retail|fees?|payable|revenue|source|sales channel|supplier)\b/i;

export function isMoneyHeader(header: string): boolean {
  return MONEY_HEADER_PART.test(header) || MONEY_HEADER_WORD.test(header);
}

/** 没勾的人：去掉算钱的上传表头。 */
export function withoutMoneyHeaders(
  headers: string[],
  canSeeMoney: boolean,
): string[] {
  return canSeeMoney ? headers : headers.filter((h) => !isMoneyHeader(h));
}

/**
 * Main manifest 的一页去掉算钱的列（没勾的人用）：catalog / groups / 默认列 / 实际列 / denied 都拿掉，
 * 下游的 Columns、表头、导出就都没有这些列；存着的列选择不动（以后勾上了还在）。
 */
export function withoutManifestMoney(page: ManifestPage): ManifestPage {
  const money = new Set(MANIFEST_MONEY_FIELDS);
  for (const f of page.catalog)
    if (f.group === "money" || f.type === "money") money.add(f.key);
  const keep = (k: string) => !money.has(k);
  return {
    ...page,
    catalog: page.catalog.filter((f) => keep(f.key)),
    groups: page.groups.filter((g) => g.key !== "money"),
    default_fields: page.default_fields.filter(keep),
    fields: page.fields.filter(keep),
    denied: page.denied.filter(keep),
  };
}
