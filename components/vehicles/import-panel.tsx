"use client";

import { StandardImport } from "@/components/ui/bulk-import";
import { csvBlob } from "@/lib/csv";
import type { Vehicle, VehicleColumn } from "@/types";

/** 栏 key → 页面上的栏名（自加列的 key 是 `custom:<列 id>`）。 */
const FIXED: Record<string, string> = {
  van_no: "Vehicle",
  samsara_url: "Live GPS",
  seats: "Seats",
  notes: "Note",
  is_active: "Status",
};

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());
}

/** 模板：全部车（含停用的），列同页面（没隐藏的自加列夹在 Seats 和 Note 中间）。 */
export function buildVehicleImportTemplate(
  vehicles: readonly Vehicle[],
  columns: readonly VehicleColumn[],
): { headers: string[]; rows: string[][] } {
  const shown = columns.filter((c) => !c.is_hidden);
  return {
    headers: [
      FIXED.van_no,
      FIXED.samsara_url,
      FIXED.seats,
      ...shown.map((c) => c.label),
      FIXED.notes,
      FIXED.is_active,
    ],
    rows: vehicles.map((v) => [
      v.van_no,
      v.samsara_url,
      v.seats === null ? "" : String(v.seats),
      ...shown.map((c) => v.custom[String(c.id)] ?? ""),
      v.notes,
      v.is_active ? "Active" : "Inactive",
    ]),
  };
}

/**
 * Vehicles 的 ⬆ Import（全站通用导入，Annie 2026-10-29「批量导入同意全部推荐。动手」）：
 * 按 Vehicle（车号）对上，没对上的新建；改车号不走导入（车号就是用来对上的）。
 * 空格不改；有错的行不存，其余一个事务写进去。接口 `/api/settings/vehicles/import/preview|commit`（后端还没上，先用 mock）。
 */
export function VehicleImportPanel({
  vehicles,
  columns,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  vehicles: readonly Vehicle[];
  columns: readonly VehicleColumn[];
  onClose: () => void;
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  const label = (key: string): string => {
    if (FIXED[key]) return FIXED[key];
    const id = key.startsWith("custom:") ? Number(key.slice(7)) : NaN;
    return columns.find((c) => c.id === id)?.label ?? key;
  };
  return (
    <StandardImport
      title="Import vehicles"
      help={
        <>
          <b>Vehicle</b> (the van number) finds the vehicle; numbers not on the
          list are added as new vehicles. To rename a vehicle, use ✏ Edit. A
          blank cell never clears what is stored. Status is Active or Inactive.
        </>
      }
      endpoint="/api/settings/vehicles/import"
      labelOf={label}
      template={() => {
        const t = buildVehicleImportTemplate(vehicles, columns);
        return {
          blob: csvBlob(t.headers, t.rows),
          filename: `vehicles_template_${today()}.csv`,
        };
      }}
      onClose={onClose}
      onSaved={onSaved}
      onUnauthorized={onUnauthorized}
    />
  );
}
