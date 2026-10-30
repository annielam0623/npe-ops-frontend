"use client";

import {
  BulkImport,
  type BulkImportPreview,
} from "@/components/ui/bulk-import";
import { describeError } from "@/lib/api-errors";
import { csvBlob } from "@/lib/csv";
import {
  commitPickupImport,
  previewPickupImport,
} from "@/lib/pickup-locations-api";
import type {
  PickupImportPreview,
  PickupImportResult,
  PickupLocation,
} from "@/types";

import {
  buildPickupImportTemplate,
  CSV_FIELDS,
  pickupLocationsCsvFilename,
} from "./config";

/**
 * Pickup Locations 的 ⬆ Import（全站通用 `BulkImport`，Annie 2026-10-29 动手）：
 * 模板 = 全部酒店（含停用的），列同 Export；按 Hotel Name 对上，也认 Aliases，没对上的新建；
 * 空格不改；有错的行不存，其余一个事务写进去（后端接口还没上，先用 mock）。
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
    <BulkImport
      title="Import locations"
      help={
        <>
          <b>Hotel Name</b> finds the hotel (a name that is one of its Aliases
          counts too); names not on the list are added as new hotels. A blank
          cell never clears what is stored — to empty a box, use ✏ Edit.
        </>
      }
      template={async () => {
        const t = buildPickupImportTemplate(locations);
        return {
          blob: csvBlob(t.headers, t.rows),
          filename: pickupLocationsCsvFilename().replace(
            "pickup_locations_",
            "pickup_locations_template_",
          ),
        };
      }}
      preview={async (file, signal) =>
        toPreview(await previewPickupImport(file, signal))
      }
      commit={async (file) => resultText(await commitPickupImport(file))}
      atomic
      describe={describeError}
      onClose={onClose}
      onSaved={onSaved}
      onUnauthorized={onUnauthorized}
    />
  );
}

const LABEL: Record<string, string> = Object.fromEntries(
  CSV_FIELDS.map((f) => [f.key, f.label]),
);

function toPreview(p: PickupImportPreview): BulkImportPreview {
  return {
    columns: p.columns.map((k) => ({ key: k, label: LABEL[k] ?? k })),
    rows: p.rows.map((row) => ({
      status: row.status,
      values: row.values,
      before: row.before,
      changed: row.changed,
      blanked: row.blanked,
      errors: row.errors,
      note: row.matched_alias
        ? `Matched by alias “${row.matched_alias}”.`
        : undefined,
    })),
  };
}

function resultText(r: PickupImportResult): string {
  const parts: string[] = [];
  if (r.created) parts.push(`${r.created} new`);
  if (r.updated) parts.push(`${r.updated} updated`);
  return `${parts.join(", ") || "nothing to change"}.`;
}
