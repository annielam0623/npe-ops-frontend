"use client";

import { StandardImport } from "@/components/ui/bulk-import";
import { csvBlob } from "@/lib/csv";
import type { LunchRestaurant } from "@/types/supplier";

/** 栏 key → 页面上的栏名（同 Edit 框）。footer（午餐表页脚两行）不导入，免得 Excel 把换行弄丢。 */
const LABEL: Record<string, string> = {
  name: "Name",
  address: "Address",
  phone: "Phone",
  text_number: "Text",
  email: "Email",
  staff_note: "Notes for staff",
};
const KEYS = Object.keys(LABEL);

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());
}

/** 美国 / 加拿大号码写「(928) 555-0110」：E.164 的「+」开头在 csv 里会被加 ' 防公式。 */
function phoneCell(value: string | undefined): string {
  const v = value ?? "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(v);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : v;
}

/** 模板：全部店，按店名排；列 Name / Address / Phone / Text / Email / Notes for staff。 */
export function buildRestaurantImportTemplate(
  restaurants: readonly LunchRestaurant[],
): { headers: string[]; rows: string[][] } {
  return {
    headers: KEYS.map((k) => LABEL[k]),
    rows: [...restaurants]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => [
        r.name,
        r.address ?? "",
        phoneCell(r.phone),
        phoneCell(r.text_number),
        r.email ?? "",
        r.staff_note,
      ]),
  };
}

/**
 * Supplier › Restaurant 的 ⬆ Import（全站「上传表格自动填」preview https://claude.ai/artifact/MKtDUiYyUPZ1FcBJR3j4Lw ③-4，
 * Annie 2026-10-29「批量导游同意推荐。动手」）：按店名对上，没对上的新建一家（不分团，分团还在卡片上选）；
 * 空格不改；有错的行不存，其余一个事务写进去。接口 `/api/supplier/restaurants/import/preview|commit`（后端 B6）；
 * 后端回来的原文一律当纯文本显示（安全审查 SA-4）。
 */
export function RestaurantImportPanel({
  restaurants,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  restaurants: readonly LunchRestaurant[];
  onClose: () => void;
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  return (
    <StandardImport
      title="Import restaurants"
      help={
        <>
          <b>Name</b> finds the restaurant; names not on the list are added as
          new restaurants (pick their tours on the card afterwards). A blank
          cell never clears what is stored — to empty a box, use the card. The
          lunch sheet footer is not imported.
        </>
      }
      endpoint="/api/supplier/restaurants/import"
      labelOf={(k) => LABEL[k] ?? k}
      template={() => {
        const t = buildRestaurantImportTemplate(restaurants);
        return {
          blob: csvBlob(t.headers, t.rows),
          filename: `restaurants_template_${today()}.csv`,
        };
      }}
      onClose={onClose}
      onSaved={onSaved}
      onUnauthorized={onUnauthorized}
    />
  );
}
