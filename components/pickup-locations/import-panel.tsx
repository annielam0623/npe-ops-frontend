"use client";

import { StandardImport } from "@/components/ui/bulk-import";
import { csvBlob } from "@/lib/csv";
import type { PickupLocation } from "@/types";

import {
  buildPickupImportTemplate,
  CSV_FIELDS,
  pickupLocationsCsvFilename,
} from "./config";

const LABEL: Record<string, string> = Object.fromEntries(
  CSV_FIELDS.map((f) => [f.key, f.label]),
);

/**
 * Pickup Locations 的 ⬆ Import（全站通用导入，Annie 2026-10-29 动手）：
 * 模板 = 全部酒店（含停用的），列同 Export；按 Hotel Name 对上，也认 Aliases，没对上的新建；
 * 空格不改；有错的行不存，其余一个事务写进去。接口 `/api/pickup-locations/import/preview|commit`（后端还没上，先用 mock）。
 */
export function PickupImportPanel({
  locations,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  /** 现在的全部酒店：做模板用。 */
  locations: readonly PickupLocation[];
  onClose: () => void;
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  return (
    <StandardImport
      title="Import locations"
      help={
        <>
          <b>Hotel Name</b> finds the hotel (a name that is one of its Aliases
          counts too); names not on the list are added as new hotels. A blank
          cell never clears what is stored — to empty a box, use ✏ Edit.
        </>
      }
      endpoint="/api/pickup-locations/import"
      labelOf={(k) => LABEL[k] ?? k}
      template={() => {
        const t = buildPickupImportTemplate(locations);
        return {
          blob: csvBlob(t.headers, t.rows),
          filename: pickupLocationsCsvFilename().replace(
            "pickup_locations_",
            "pickup_locations_template_",
          ),
        };
      }}
      onClose={onClose}
      onSaved={onSaved}
      onUnauthorized={onUnauthorized}
    />
  );
}
