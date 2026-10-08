"use client";

import { Fragment, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { Product, ProductGroup, TicketTourType } from "@/types";

import {
  BTN_OFF_CLASS,
  BTN_ON_CLASS,
  TBODY_CLASS,
  TR_CLASS,
  TR_HOVER,
} from "@/components/pickup-locations/legacy-ui";

import {
  groupLabel,
  needsCategory,
  type ProductSection,
  typeLabel,
} from "./config";
import {
  cellInClass,
  CODE_CELL_CLASS,
  GROUP_COUNT_CLASS,
  GROUP_ROW_TD_CLASS,
  PICK_TD_CLASS,
  PILL_OFF_CLASS,
  PROD_TD_CLASS,
  PROD_TH_CLASS,
  REZDY_NAME_CLASS,
} from "./legacy-ui";

/** 一格的保存状态：保存中（琥珀）→ 已保存（绿，1.4 秒后消失）/ 失败（红）。 */
export type CellState = "saving" | "saved" | "failed";

export type ProductField = "internal_name" | "manifest_id" | "booking_type";

export function ProductsTable({
  sections,
  groups,
  bookingTypes,
  tourTypes,
  picked,
  cellStates,
  busyId,
  placeholder,
  allVisiblePicked,
  onPick,
  onPickAll,
  onSave,
  onSaveTourType,
  onToggleActive,
}: {
  sections: ProductSection[];
  groups: ProductGroup[];
  bookingTypes: string[];
  /** 门票 tour type 的选项；null = 后端还不支持（不显示这一列）。 */
  tourTypes: TicketTourType[] | null;
  picked: Set<number>;
  /** 键为 `${id}:${field}`。 */
  cellStates: Record<string, CellState>;
  busyId: number | null;
  placeholder: string | null;
  allVisiblePicked: boolean;
  onPick: (id: number, on: boolean) => void;
  onPickAll: (on: boolean) => void;
  onSave: (p: Product, field: ProductField, value: string) => void;
  onSaveTourType: (p: Product, value: string) => void;
  onToggleActive: (p: Product) => void;
}) {
  const colSpan = tourTypes ? 8 : 7;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className={cn(PROD_TH_CLASS, "w-[28px] pr-0")}>
              <input
                type="checkbox"
                aria-label="Select everything currently shown"
                title="Select everything currently shown"
                checked={allVisiblePicked}
                disabled={!!placeholder}
                onChange={(event) => onPickAll(event.target.checked)}
              />
            </th>
            <th className={cn(PROD_TH_CLASS, "w-[9%]")}>Code</th>
            <th className={cn(PROD_TH_CLASS, "w-[30%]")}>Name (from Rezdy)</th>
            <th
              className={cn(PROD_TH_CLASS, "w-[16%]")}
              title="Our own short name for the team. Rezdy never touches it."
            >
              Internal name
            </th>
            <th className={cn(PROD_TH_CLASS, "w-[16%]")}>Group</th>
            <th
              className={cn(PROD_TH_CLASS, "w-[14%]")}
              title="Drives which reports and which send module this product counts in."
            >
              Category
            </th>
            {tourTypes ? (
              <th
                className={cn(PROD_TH_CLASS, "w-[14%]")}
                title="Ticket products only: which Tickets - SelfDrive pill the product shows under on Manifests."
              >
                Tour type
              </th>
            ) : null}
            <th className={cn(PROD_TH_CLASS, "w-[12%]")}>Status</th>
          </tr>
        </thead>
        <tbody className={TBODY_CLASS}>
          {placeholder ? (
            <tr>
              <td colSpan={colSpan} className="p-5 text-center text-[#ccc]">
                {placeholder}
              </td>
            </tr>
          ) : (
            sections.map((section) => (
              <Fragment key={section.key}>
                <tr className={TR_CLASS}>
                  <td colSpan={colSpan} className={GROUP_ROW_TD_CLASS}>
                    {section.title}{" "}
                    <span className={GROUP_COUNT_CLASS}>
                      {section.rows.length === section.total
                        ? section.total
                        : `${section.rows.length} of ${section.total}`}
                    </span>
                  </td>
                </tr>
                {section.rows.map((p) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    groups={groups}
                    bookingTypes={bookingTypes}
                    tourTypes={tourTypes}
                    picked={picked.has(p.id)}
                    cellStates={cellStates}
                    busy={busyId === p.id}
                    onPick={(on) => onPick(p.id, on)}
                    onSave={(field, value) => onSave(p, field, value)}
                    onSaveTourType={(value) => onSaveTourType(p, value)}
                    onToggleActive={() => onToggleActive(p)}
                  />
                ))}
              </Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ProductRow({
  product: p,
  groups,
  bookingTypes,
  tourTypes,
  picked,
  cellStates,
  busy,
  onPick,
  onSave,
  onSaveTourType,
  onToggleActive,
}: {
  product: Product;
  groups: ProductGroup[];
  bookingTypes: string[];
  tourTypes: TicketTourType[] | null;
  picked: boolean;
  cellStates: Record<string, CellState>;
  busy: boolean;
  onPick: (on: boolean) => void;
  onSave: (field: ProductField, value: string) => void;
  onSaveTourType: (value: string) => void;
  onToggleActive: () => void;
}) {
  const need = needsCategory(p);
  const tourType = p.ticket_tour_type ?? "";
  // 内部名离开输入框才保存；外面的值变了（保存失败改回、重拉）跟着变。
  const [internal, setInternal] = useState(p.internal_name);
  useEffect(() => setInternal(p.internal_name), [p.internal_name]);
  const state = (field: ProductField | "ticket_tour_type") =>
    cellStates[`${p.id}:${field}`];

  return (
    <tr
      className={cn(
        TR_CLASS,
        picked ? "bg-[#f0f6ff] hover:bg-[#e8f1ff]" : TR_HOVER,
        !p.is_active && "opacity-55",
      )}
    >
      <td
        className={PICK_TD_CLASS}
        style={need ? { boxShadow: "inset 3px 0 0 #fb923c" } : undefined}
      >
        <input
          type="checkbox"
          aria-label={`Select ${p.product_code}`}
          checked={picked}
          onChange={(event) => onPick(event.target.checked)}
          className="m-0 cursor-pointer align-middle"
        />
      </td>
      <td className={cn(PROD_TD_CLASS, CODE_CELL_CLASS)}>{p.product_code}</td>
      <td
        className={cn(
          PROD_TD_CLASS,
          REZDY_NAME_CLASS,
          "[overflow-wrap:anywhere]",
        )}
      >
        {p.product_name || <i className="text-[#ccc]">(no name yet)</i>}
        <span className="ml-1.5 inline-block rounded-[4px] bg-[#f0f0ee] px-[5px] align-[1px] text-[9px] font-semibold whitespace-nowrap text-[#999]">
          REZDY
        </span>
      </td>
      <td className={PROD_TD_CLASS}>
        <input
          type="text"
          aria-label={`Internal name for ${p.product_code}`}
          value={internal}
          maxLength={100}
          placeholder="—"
          onChange={(event) => setInternal(event.target.value)}
          onBlur={() => {
            if (internal.trim() !== p.internal_name) {
              onSave("internal_name", internal.trim());
            }
          }}
          className={cellInClass(state("internal_name"))}
        />
      </td>
      <td className={PROD_TD_CLASS}>
        <select
          aria-label={`Group for ${p.product_code}`}
          value={p.manifest_id === null ? "" : String(p.manifest_id)}
          disabled={state("manifest_id") === "saving"}
          onChange={(event) => onSave("manifest_id", event.target.value)}
          className={cellInClass(state("manifest_id"))}
        >
          <option value="">— no group —</option>
          {groups.map((g) => (
            <option key={g.id} value={String(g.id)}>
              {groupLabel(g)}
            </option>
          ))}
        </select>
      </td>
      <td className={PROD_TD_CLASS}>
        <select
          aria-label={`Category for ${p.product_code}`}
          value={p.booking_type ?? ""}
          disabled={state("booking_type") === "saving"}
          onChange={(event) => onSave("booking_type", event.target.value)}
          className={cellInClass(state("booking_type"), need)}
        >
          <option value="">— blank (falls back) —</option>
          {bookingTypes.map((t) => (
            <option key={t} value={t}>
              {typeLabel(t)}
            </option>
          ))}
          {/* 库里有、但后端清单里没有的旧值照实显示，不让下拉落到别的选项上。 */}
          {p.booking_type && !bookingTypes.includes(p.booking_type) ? (
            <option value={p.booking_type}>{p.booking_type}</option>
          ) : null}
        </select>
      </td>
      {tourTypes ? (
        <td className={PROD_TD_CLASS}>
          {/* 只有分类是 ticket 的产品能选；不是门票却还留着旧值的（例如分类改过），只能清空（后端清空不限分类）。 */}
          {p.booking_type === "ticket" || tourType ? (
            <select
              aria-label={`Tour type for ${p.product_code}`}
              value={tourType}
              disabled={state("ticket_tour_type") === "saving"}
              onChange={(event) => onSaveTourType(event.target.value)}
              className={cellInClass(state("ticket_tour_type"))}
            >
              <option value="">— no tour type —</option>
              {(p.booking_type === "ticket"
                ? tourTypes
                : tourTypes.filter((t) => t.key === tourType)
              ).map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
              {/* 后端清单里已经没有的旧键照实显示，不让下拉落到别的选项上。 */}
              {tourType && !tourTypes.some((t) => t.key === tourType) ? (
                <option value={tourType}>{tourType}</option>
              ) : null}
            </select>
          ) : null}
        </td>
      ) : null}
      <td className={cn(PROD_TD_CLASS, "whitespace-nowrap")}>
        <button
          type="button"
          onClick={onToggleActive}
          disabled={busy}
          className={cn(
            p.is_active ? BTN_OFF_CLASS : BTN_ON_CLASS,
            "whitespace-nowrap",
          )}
        >
          {p.is_active ? "Deactivate" : "Reactivate"}
        </button>
        {!p.is_active ? <span className={PILL_OFF_CLASS}>Inactive</span> : null}
      </td>
    </tr>
  );
}
