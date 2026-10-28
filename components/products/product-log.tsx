"use client";

import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import { legacyPage, legacyRows } from "@/lib/action-log";
import { fetchProductLog, PRODUCT_LOG_LIMIT } from "@/lib/products-api";
import type { ProductGroup, TicketTourType } from "@/types";

import { typeLabel } from "./config";

const FIELDS: readonly { key: string; label: string }[] = [
  { key: "internal_name", label: "Internal name" },
  { key: "manifest_id", label: "Group" },
  { key: "booking_type", label: "Category" },
  { key: "ticket_tour_type", label: "Tour type" },
  { key: "bus_tour_type", label: "Bus tour type" },
];

/** 改动记录（G203 共用面板），默认收起，第一次展开才拉；version 变了（有改动）就重拉。 */
export function ProductLog({
  version,
  groups,
  tourTypes,
  busTourTypes,
  onUnauthorized,
}: {
  version: number;
  groups: ProductGroup[];
  tourTypes: TicketTourType[];
  busTourTypes: TicketTourType[];
  onUnauthorized: () => void;
}) {
  /** 组 id 换成现在的组名，找不到写 group #id；空写 (blank)。 */
  function show(key: string, value: unknown): string {
    if (value === null || value === undefined || value === "") return "(blank)";
    if (key === "manifest_id") {
      const g = groups.find((x) => String(x.id) === String(value));
      return g ? g.display_name || g.name : `group #${String(value)}`;
    }
    if (key === "booking_type") return typeLabel(String(value));
    if (key === "ticket_tour_type" || key === "bus_tour_type") {
      const list = key === "ticket_tour_type" ? tourTypes : busTourTypes;
      return list.find((t) => t.key === String(value))?.label ?? String(value);
    }
    return String(value);
  }

  return (
    <ActionLogPanel
      refreshKey={version}
      onUnauthorized={onUnauthorized}
      load={async (_before, signal) =>
        legacyPage(await fetchProductLog(signal), PRODUCT_LOG_LIMIT, (e) =>
          legacyRows(e, { fields: FIELDS, show }),
        )
      }
    />
  );
}
