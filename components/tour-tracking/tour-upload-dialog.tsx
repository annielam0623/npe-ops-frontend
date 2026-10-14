"use client";

import { ImportDialog, type ImportColumn } from "@/components/ui/import-dialog";
import { commitTourImport, previewTourImport } from "@/lib/tour-tracking-api";
import type { TourImportRow, TourTypeOption } from "@/types";

/** 预览表的列，同旧 `tracking_tour.html` 的 imp-table。 */
const COLUMNS: ImportColumn<TourImportRow>[] = [
  { head: "Order#", cell: (r) => r.order_number },
  {
    head: "Name",
    cell: (r) => `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
  },
  { head: "Email", cell: (r) => r.email },
  { head: "Phone", cell: (r) => r.phone },
  {
    head: "Qty",
    cell: (r) =>
      r.pax === undefined ? (
        String(r.quantities ?? "")
      ) : r.pax_ok ? (
        String(r.pax)
      ) : (
        <span className="font-bold text-[#A32D2D]">?</span>
      ),
  },
  { head: "Quantities", cell: (r) => r.qty_label, qtyText: true },
  { head: "MTLV", cell: (r) => String(r.mtlv_promo ?? "") },
  { head: "Pickup Time", cell: (r) => r.pickup_time },
  { head: "Pickup Location", cell: (r) => r.pickup_location },
];

/**
 * ⬆ Upload：把不是从本系统发出去的单补录进这天的列表（先选团，再选文件，预览后插入）。
 * 只写库（状态 pending），**不发任何消息**。样子和流程见 `components/ui/import-dialog.tsx`。
 */
export function TourUploadDialog({
  tourDate,
  tourTypes,
  onClose,
  onInserted,
  onUnauthorized,
}: {
  tourDate: string;
  tourTypes: TourTypeOption[];
  onClose: () => void;
  onInserted: () => void;
  onUnauthorized: () => void;
}) {
  return (
    <ImportDialog<TourImportRow>
      pickTitle="Select Tour Type"
      options={tourTypes.map((t) => (
        <option key={t.key} value={t.key}>
          {t.label}
        </option>
      ))}
      labelOf={(key) => tourTypes.find((t) => t.key === key)?.label ?? key}
      columns={COLUMNS}
      preview={(file, tourType) =>
        previewTourImport({ file, tourDate, tourType })
      }
      commit={(rows, tourType) =>
        commitTourImport({ rows, tourDate, tourType })
      }
      onClose={onClose}
      onInserted={onInserted}
      onUnauthorized={onUnauthorized}
    />
  );
}
