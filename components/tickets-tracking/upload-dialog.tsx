"use client";

import { tourTypeLabel } from "@/components/tickets-send/config";
import { useTourTypeGroups } from "@/components/tickets-send/use-tour-type-groups";
import { ImportDialog, type ImportColumn } from "@/components/ui/import-dialog";
import {
  commitTicketsImport,
  previewTicketsImport,
} from "@/lib/tickets-tracking-api";
import type { TicketsImportRow } from "@/types";

/** 预览表的列，同旧 `tracking_tickets.html` 的 imp-table。 */
const COLUMNS: ImportColumn<TicketsImportRow>[] = [
  { head: "Order#", cell: (r) => r.order_number },
  { head: "Confirmation#", cell: (r) => r.confirmation_no },
  {
    head: "Name",
    cell: (r) => `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
  },
  { head: "Phone", cell: (r) => r.phone },
  { head: "Email", cell: (r) => r.email || r.customer_email },
  {
    head: "Pax",
    cell: (r) =>
      r.pax === undefined ? (
        String(r.no_of_pax ?? r.quantities ?? "")
      ) : r.pax_ok ? (
        String(r.pax)
      ) : (
        <span className="font-bold text-[#A32D2D]">?</span>
      ),
  },
  { head: "Quantities", cell: (r) => r.qty_label, qtyText: true },
  { head: "Check-in", cell: (r) => r.checkin_time },
  { head: "Tour Time", cell: (r) => r.tour_time },
];


/**
 * ⬆ Upload：把不是从本系统发出去的单补录进这天的列表（先选产品，再选文件，预览后插入）。
 * 只写总表（状态 pending），**不发任何消息**。样子和流程见 `components/ui/import-dialog.tsx`。
 */
export function UploadDialog({
  serviceDate,
  onClose,
  onInserted,
  onUnauthorized,
}: {
  serviceDate: string;
  onClose: () => void;
  /** 插入成功（哪怕只插了一部分）：表格要重拉。 */
  onInserted: () => void;
  onUnauthorized: () => void;
}) {
  const tourTypeGroups = useTourTypeGroups();
  /** 旧页预览标题后面写所选 option 的文字（不带分组名）。 */
  function optionLabel(value: string): string {
    for (const group of tourTypeGroups) {
      const option = group.options.find((o) => o.value === value);
      if (option) return option.label;
    }
    return tourTypeLabel(value);
  }
  return (
    <ImportDialog<TicketsImportRow>
      pickTitle="Select Tour / Operator"
      options={tourTypeGroups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
      labelOf={optionLabel}
      columns={COLUMNS}
      preview={(file, tourType) =>
        previewTicketsImport({ file, serviceDate, tourType })
      }
      commit={(rows, tourType) =>
        commitTicketsImport({ rows, serviceDate, tourType })
      }
      onClose={onClose}
      onInserted={onInserted}
      onUnauthorized={onUnauthorized}
    />
  );
}
