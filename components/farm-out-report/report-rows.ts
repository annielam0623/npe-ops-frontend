import type { FarmOutReportRow } from "@/types/farm-out";

/**
 * 报表接口返回 → 表格行。⚠️ 后端只列了列名、没定 JSON 形状（草稿 2026-10-16），
 * 字段名对不上时只改这一个函数：这里同时认 `{rows: [...]}` 和直接一个数组，缺的数字当 null。
 */
export function reportRows(data: unknown): FarmOutReportRow[] {
  const list = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { rows?: unknown }).rows)
      ? (data as { rows: unknown[] }).rows
      : [];
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string =>
    typeof v === "string" ? v : v == null ? "" : String(v);
  return list.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const paid = num(r.guest_paid);
    const payable = num(r.payable);
    return {
      date: str(r.date),
      tour: str(r.tour),
      order_number: str(r.order_number),
      ota_conf_number: str(r.ota_conf_number),
      guest: str(r.guest),
      adults: num(r.adults) ?? 0,
      children: num(r.children) ?? 0,
      partner: str(r.partner),
      handled_by: str(r.handled_by),
      guest_paid: paid,
      payable,
      // 后端没给差额就按任务包第 24 条算：客人实付 − 应付对方。
      difference:
        num(r.difference) ??
        (paid != null && payable != null ? paid - payable : null),
      payable_changed_by: r.payable_changed_by
        ? str(r.payable_changed_by)
        : null,
      payable_changed_at: r.payable_changed_at
        ? str(r.payable_changed_at)
        : null,
    };
  });
}
