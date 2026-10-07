"use client";

import { Fragment, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { Product, ProductGroup, TicketTourType } from "@/types";

import {
  groupLabel,
  needsCategory,
  type ProductSection,
  typeLabel,
} from "./config";

/** 一格的保存状态：保存中（琥珀）→ 已保存（绿，1.4 秒后消失）/ 失败（红）。 */
export type CellState = "saving" | "saved" | "failed";

export type ProductField = "internal_name" | "manifest_id" | "booking_type";

const SELECT_CLASS =
  "w-full rounded-md border bg-white px-2 py-1 text-sm focus:ring-1 focus:ring-stone-500 focus:outline-none disabled:opacity-60";

function stateClass(state: CellState | undefined, base: string): string {
  return cn(
    base,
    state === "saving" && "border-amber-400 bg-amber-50",
    state === "saved" && "border-emerald-500 bg-emerald-50",
    state === "failed" && "border-red-400 bg-red-50",
    !state && "border-stone-300",
  );
}

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
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-50 text-left text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
            <th className="w-8 px-3 py-2.5">
              <input
                type="checkbox"
                aria-label="Select everything currently shown"
                title="Select everything currently shown"
                checked={allVisiblePicked}
                disabled={!!placeholder}
                onChange={(event) => onPickAll(event.target.checked)}
              />
            </th>
            <th className="px-3 py-2.5">Code</th>
            <th className="px-3 py-2.5">Name (from Rezdy)</th>
            <th
              className="px-3 py-2.5"
              title="Our own short name for the team. Rezdy never touches it."
            >
              Internal name
            </th>
            <th className="px-3 py-2.5">Group</th>
            <th
              className="px-3 py-2.5"
              title="Drives which reports and which send module this product counts in."
            >
              Category
            </th>
            {tourTypes ? (
              <th
                className="px-3 py-2.5"
                title="Ticket products only: which Tickets - SelfDrive pill the product shows under on Manifests."
              >
                Tour type
              </th>
            ) : null}
            <th className="px-3 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {placeholder ? (
            <tr>
              <td
                colSpan={colSpan}
                className="px-4 py-12 text-center text-stone-500"
              >
                {placeholder}
              </td>
            </tr>
          ) : (
            sections.map((section) => (
              <Fragment key={section.key}>
                <tr className="border-b border-stone-200 bg-stone-100/80">
                  <td
                    colSpan={colSpan}
                    className="px-3 py-1.5 text-xs font-semibold text-stone-700"
                  >
                    {section.title}{" "}
                    <span className="font-normal text-stone-500">
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
        "border-b border-stone-100 last:border-b-0",
        !p.is_active && "opacity-55",
      )}
    >
      <td
        className="px-3 py-2"
        style={need ? { boxShadow: "inset 3px 0 0 #fb923c" } : undefined}
      >
        <input
          type="checkbox"
          aria-label={`Select ${p.product_code}`}
          checked={picked}
          onChange={(event) => onPick(event.target.checked)}
        />
      </td>
      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
        {p.product_code}
      </td>
      <td className="px-3 py-2 [overflow-wrap:anywhere]">
        {p.product_name || <i className="text-stone-400">(no name yet)</i>}{" "}
        <span className="rounded bg-stone-100 px-1 text-[10px] font-semibold text-stone-500">
          REZDY
        </span>
      </td>
      <td className="px-3 py-2">
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
          className={stateClass(
            state("internal_name"),
            "w-full min-w-40 rounded-md border bg-white px-2 py-1 text-sm focus:ring-1 focus:ring-stone-500 focus:outline-none",
          )}
        />
      </td>
      <td className="px-3 py-2">
        <select
          aria-label={`Group for ${p.product_code}`}
          value={p.manifest_id === null ? "" : String(p.manifest_id)}
          disabled={state("manifest_id") === "saving"}
          onChange={(event) => onSave("manifest_id", event.target.value)}
          className={stateClass(state("manifest_id"), SELECT_CLASS)}
        >
          <option value="">— no group —</option>
          {groups.map((g) => (
            <option key={g.id} value={String(g.id)}>
              {groupLabel(g)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <select
          aria-label={`Category for ${p.product_code}`}
          value={p.booking_type ?? ""}
          disabled={state("booking_type") === "saving"}
          onChange={(event) => onSave("booking_type", event.target.value)}
          className={cn(
            stateClass(state("booking_type"), SELECT_CLASS),
            need && !state("booking_type") && "border-orange-400 bg-orange-50",
          )}
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
        <td className="px-3 py-2">
          {/* 只有分类是 ticket 的产品能选；不是门票却还留着旧值的（例如分类改过），只能清空（后端清空不限分类）。 */}
          {p.booking_type === "ticket" || tourType ? (
            <select
              aria-label={`Tour type for ${p.product_code}`}
              value={tourType}
              disabled={state("ticket_tour_type") === "saving"}
              onChange={(event) => onSaveTourType(event.target.value)}
              className={stateClass(state("ticket_tour_type"), SELECT_CLASS)}
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
          ) : (
            <span className="text-stone-300">—</span>
          )}
        </td>
      ) : null}
      <td className="px-3 py-2 whitespace-nowrap">
        <button
          type="button"
          onClick={onToggleActive}
          disabled={busy}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50",
            p.is_active
              ? "border-amber-400 text-amber-800 hover:bg-amber-50"
              : "border-emerald-500 text-emerald-700 hover:bg-emerald-50",
          )}
        >
          {p.is_active ? "Deactivate" : "Reactivate"}
        </button>
        {!p.is_active ? (
          <span className="ml-1.5 rounded-full bg-stone-200 px-2 py-0.5 text-[11px] font-semibold text-stone-600">
            Inactive
          </span>
        ) : null}
      </td>
    </tr>
  );
}
