"use client";

import { Fragment, type ReactNode, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { Product, ProductGroup, TicketTourType } from "@/types";

import {
  BTN_OFF_CLASS,
  BTN_ON_CLASS,
  TBODY_CLASS,
  TR_CLASS,
  TR_HOVER,
} from "@/components/pickup-locations/legacy-ui";

import { BULK_MIN, BulkBarRow, lastPickedIndex } from "./bulk-bar";
import {
  groupLabel,
  selectableGroups,
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
  busTourTypes,
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
  renderBulkBar,
  busTourLabel,
}: {
  sections: ProductSection[];
  groups: ProductGroup[];
  bookingTypes: string[];
  /** 门票 tour type 的选项；null = 后端还不支持（不显示这一列）。 */
  tourTypes: TicketTourType[] | null;
  /** 巴士团 tour type 的选项；null = 后端还没上（不是门票的产品那一格空着）。 */
  busTourTypes: TicketTourType[] | null;
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
  /** 勾了 2 个以上，批量条作为表格里的一行贴在最后一个已勾行下面（Annie 2026-10-19）；spanned = 所勾的产品跨了几个组。 */
  renderBulkBar?: (info: { spanned: number }) => ReactNode;
  /** 不是门票的产品这一格只读显示的字（所在节的默认 tour type，G130）：undefined = 还没读到；"" = 没设 / 班车。 */
  busTourLabel: (p: Product) => string | undefined;
}) {
  const showTour = !!(tourTypes || busTourTypes);
  const colSpan = showTour ? 8 : 7;
  const flat = sections.flatMap((s) => s.rows);
  const lastIdx = lastPickedIndex(flat, (p) => picked.has(p.id));
  const barAfterId =
    renderBulkBar && picked.size >= BULK_MIN && lastIdx >= 0
      ? flat[lastIdx].id
      : null;
  const spanned = sections.filter((s) =>
    s.rows.some((p) => picked.has(p.id)),
  ).length;
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
            {showTour ? (
              <th
                className={cn(PROD_TH_CLASS, "w-[14%]")}
                title="Bus products: the tour type for tour confirmations (manual and auto-send). Ticket products: which Tickets pill on Manifests."
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
              <td
                colSpan={colSpan}
                className="p-5 text-center text-[#1a1a1a] night:text-white/35"
              >
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
                  <Fragment key={p.id}>
                    <ProductRow
                      product={p}
                      groups={groups}
                      bookingTypes={bookingTypes}
                      tourTypes={tourTypes}
                      busTourTypes={busTourTypes}
                      showTour={showTour}
                      picked={picked.has(p.id)}
                      cellStates={cellStates}
                      busy={busyId === p.id}
                      onPick={(on) => onPick(p.id, on)}
                      onSave={(field, value) => onSave(p, field, value)}
                      onSaveTourType={(value) => onSaveTourType(p, value)}
                      busTourLabel={busTourLabel(p)}
                      onToggleActive={() => onToggleActive(p)}
                    />
                    {barAfterId === p.id && renderBulkBar ? (
                      <BulkBarRow colSpan={colSpan}>
                        {renderBulkBar({ spanned })}
                      </BulkBarRow>
                    ) : null}
                  </Fragment>
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
  busTourTypes,
  showTour,
  picked,
  cellStates,
  busy,
  onPick,
  onSave,
  onSaveTourType,
  onToggleActive,
  busTourLabel,
}: {
  product: Product;
  groups: ProductGroup[];
  bookingTypes: string[];
  tourTypes: TicketTourType[] | null;
  busTourTypes: TicketTourType[] | null;
  showTour: boolean;
  picked: boolean;
  cellStates: Record<string, CellState>;
  busy: boolean;
  onPick: (on: boolean) => void;
  onSave: (field: ProductField, value: string) => void;
  onSaveTourType: (value: string) => void;
  onToggleActive: () => void;
  busTourLabel: string | undefined;
}) {
  const need = needsCategory(p);
  const isTicket = p.booking_type === "ticket";
  // 门票产品选门票的 tour type；其他产品选巴士团默认的（自动发送按它发）。
  const tourField = isTicket ? "ticket_tour_type" : "bus_tour_type";
  const tourType = (isTicket ? p.ticket_tour_type : p.bus_tour_type) ?? "";
  const tourOptions = isTicket ? tourTypes : busTourTypes;
  // 内部名离开输入框才保存；外面的值变了（保存失败改回、重拉）跟着变。
  const [internal, setInternal] = useState(p.internal_name);
  useEffect(() => setInternal(p.internal_name), [p.internal_name]);
  const state = (field: ProductField | "ticket_tour_type" | "bus_tour_type") =>
    cellStates[`${p.id}:${field}`];

  return (
    <tr
      className={cn(
        TR_CLASS,
        picked
          ? "bg-[#f0f6ff] hover:bg-[#e8f1ff] night:bg-sky-400/[.08] night:hover:bg-sky-400/[.08]"
          : TR_HOVER,
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
        {p.product_name || (
          <i className="text-[#1a1a1a] night:text-white/35">(no name yet)</i>
        )}
        <span className="ml-1.5 inline-block rounded-[4px] bg-[#f0f0ee] px-[5px] align-[1px] text-[9px] font-semibold whitespace-nowrap text-[#1a1a1a] night:bg-white/[.03] night:text-white/35">
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
          {selectableGroups(groups, p.manifest_id).map((g) => (
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
            <option value={p.booking_type}>
              {typeLabel(p.booking_type)}
            </option>
          ) : null}
        </select>
      </td>
      {showTour ? (
        <td className={PROD_TD_CLASS}>
          {isTicket ? (
            tourOptions ? (
              <select
                aria-label={`Tour type for ${p.product_code}`}
                data-tour-field={tourField}
                value={tourType}
                disabled={state(tourField) === "saving"}
                onChange={(event) => onSaveTourType(event.target.value)}
                className={cellInClass(state(tourField), false)}
              >
                <option value="">— no tour type —</option>
                {tourOptions.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
                {/* 后端清单里已经没有的旧键照实显示，不让下拉落到别的选项上。 */}
                {tourType && !tourOptions.some((t) => t.key === tourType) ? (
                  <option value={tourType}>{tourType}</option>
                ) : null}
              </select>
            ) : null
          ) : (
            // 巴士团等：tour type 改成按节设（后端 G130，Annie「按节」），这里只读显示所在节的默认值；去 Bus Manifest setup 改。
            <span
              data-bus-tour-readonly
              title="Set per section in Bus Manifest setup (below)."
            >
              {busTourLabel === undefined ? "…" : busTourLabel || "—"}
            </span>
          )}
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
