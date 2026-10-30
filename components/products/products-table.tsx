"use client";

import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  SaveControl,
  type SaveState,
  useBlockSave,
} from "@/components/products/unsaved";
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

/** 一格的样子：改了没存（琥珀）/ 已保存（绿）/ 存不上（红）。 */
export type CellState = "saving" | "saved" | "failed";

/** 一行改了没存的值（Internal name、Group、Category、门票的 Tour type）：按这一行的 Save 才存（Annie 2026-10-29）。 */
export interface RowDraft {
  internal_name: string;
  manifest_id: number | null;
  booking_type: string;
  ticket_tour_type: string | null;
}

export function rowDraftOf(p: Product): RowDraft {
  return {
    internal_name: p.internal_name,
    manifest_id: p.manifest_id,
    booking_type: p.booking_type ?? "",
    ticket_tour_type: p.ticket_tour_type ?? null,
  };
}

export function ProductsTable({
  sections,
  groups,
  bookingTypes,
  tourTypes,
  busTourTypes,
  picked,
  busyId,
  placeholder,
  allVisiblePicked,
  onPick,
  onPickAll,
  onSaveRow,
  rowSaved,
  onToggleActive,
  renderBulkBar,
  busTourLabel,
  highlightId,
}: {
  sections: ProductSection[];
  groups: ProductGroup[];
  bookingTypes: string[];
  /** 门票 tour type 的选项；null = 后端还不支持（不显示这一列）。 */
  tourTypes: TicketTourType[] | null;
  /** 巴士团 tour type 的选项；null = 后端还没上（不是门票的产品那一格空着）。 */
  busTourTypes: TicketTourType[] | null;
  picked: Set<number>;
  busyId: number | null;
  placeholder: string | null;
  allVisiblePicked: boolean;
  onPick: (id: number, on: boolean) => void;
  onPickAll: (on: boolean) => void;
  /** 存一行：null = 存好；字符串 = 原因（"" = 跳登录了）。 */
  onSaveRow: (p: Product, draft: RowDraft) => Promise<string | null>;
  /** 刚存好的行（换组后挪到新组下面会重建）：接着显示 Saved。 */
  rowSaved: Record<number, SaveState>;
  onToggleActive: (p: Product) => void;
  /** 勾了 2 个以上，批量条作为表格里的一行贴在最后一个已勾行下面（Annie 2026-10-19）；spanned = 所勾的产品跨了几个组。 */
  renderBulkBar?: (info: { spanned: number }) => ReactNode;
  /** 不是门票的产品这一格只读显示的字（所在节的默认 tour type，G130）：undefined = 还没读到；"" = 没设 / 班车。 */
  busTourLabel: (p: Product) => string | undefined;
  /** 顶部提醒区点了某个产品跳过来（Annie 2026-10-23）：这一行亮起来并在挂载时滚过去。 */
  highlightId?: number | null;
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
                      showTour={showTour}
                      picked={picked.has(p.id)}
                      busy={busyId === p.id}
                      onPick={(on) => onPick(p.id, on)}
                      onSaveRow={(draft) => onSaveRow(p, draft)}
                      savedState={rowSaved[p.id]}
                      busTourLabel={busTourLabel(p)}
                      onToggleActive={() => onToggleActive(p)}
                      highlighted={p.id === highlightId}
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
  showTour,
  picked,
  busy,
  onPick,
  onSaveRow,
  savedState,
  onToggleActive,
  busTourLabel,
  highlighted,
}: {
  product: Product;
  groups: ProductGroup[];
  bookingTypes: string[];
  tourTypes: TicketTourType[] | null;
  showTour: boolean;
  picked: boolean;
  busy: boolean;
  onPick: (on: boolean) => void;
  onSaveRow: (draft: RowDraft) => Promise<string | null>;
  savedState?: SaveState;
  onToggleActive: () => void;
  busTourLabel: string | undefined;
  highlighted?: boolean;
}) {
  const need = needsCategory(p);
  const rowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: "center" });
  }, [highlighted]);
  // 改了先放在这一行（Annie 2026-10-29「所有的下拉…都是先缓存，然后等保存」）：只记改过的格，
  // 没改的格照外面的值显示（别的行存好后整表重拉，不会冲掉这一行没存的改动）。
  const [edits, setEdits] = useState<Partial<RowDraft>>({});
  const saved = rowDraftOf(p);
  const draft: RowDraft = { ...saved, ...edits };
  const changed = (k: keyof RowDraft) =>
    k === "internal_name"
      ? draft.internal_name.trim() !== saved.internal_name
      : draft[k] !== saved[k];
  const isTicket = draft.booking_type === "ticket";
  // 门票产品才在这里改 tour type；巴士团等按节设，这里只读。
  const tourChanged = isTicket && changed("ticket_tour_type");
  const dirty =
    changed("internal_name") ||
    changed("manifest_id") ||
    changed("booking_type") ||
    tourChanged;
  const block = useBlockSave({
    id: `product:${p.id}`,
    label: `product ${p.product_code}`,
    dirty,
    draftKey: JSON.stringify(draft),
    initial: savedState,
    doSave: async () => {
      const err = await onSaveRow({
        ...draft,
        internal_name: draft.internal_name.trim(),
      });
      if (err === null) setEdits({});
      return err;
    },
  });
  const failed = block.state.kind === "error";
  /** 改过的格琥珀色；存不上时红框。 */
  const cell = (on: boolean): CellState | undefined =>
    on ? (failed ? "failed" : "saving") : undefined;
  const edit = (patch: Partial<RowDraft>) =>
    setEdits((e) => ({ ...e, ...patch }));
  const tourType = draft.ticket_tour_type ?? "";
  const saving = block.state.kind === "saving";

  return (
    <tr
      ref={rowRef}
      id={`product-row-${p.id}`}
      className={cn(
        TR_CLASS,
        highlighted
          ? "bg-[#fff3cd] hover:bg-[#ffecb3] night:bg-amber-400/15 night:hover:bg-amber-400/20"
          : picked
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
          value={draft.internal_name}
          maxLength={100}
          placeholder="—"
          disabled={saving}
          onChange={(event) => edit({ internal_name: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && dirty) block.save();
          }}
          className={cellInClass(cell(changed("internal_name")))}
        />
      </td>
      <td className={PROD_TD_CLASS}>
        <select
          aria-label={`Group for ${p.product_code}`}
          value={draft.manifest_id === null ? "" : String(draft.manifest_id)}
          disabled={saving}
          onChange={(event) =>
            edit({
              manifest_id: event.target.value
                ? Number(event.target.value)
                : null,
            })
          }
          className={cellInClass(cell(changed("manifest_id")))}
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
          value={draft.booking_type}
          disabled={saving}
          onChange={(event) => edit({ booking_type: event.target.value })}
          className={cellInClass(cell(changed("booking_type")), need)}
        >
          <option value="">— blank (falls back) —</option>
          {bookingTypes.map((t) => (
            <option key={t} value={t}>
              {typeLabel(t)}
            </option>
          ))}
          {/* 库里有、但后端清单里没有的旧值照实显示，不让下拉落到别的选项上。 */}
          {p.booking_type && !bookingTypes.includes(p.booking_type) ? (
            <option value={p.booking_type}>{typeLabel(p.booking_type)}</option>
          ) : null}
        </select>
      </td>
      {showTour ? (
        <td className={PROD_TD_CLASS}>
          {isTicket ? (
            tourTypes ? (
              <select
                aria-label={`Tour type for ${p.product_code}`}
                data-tour-field="ticket_tour_type"
                value={tourType}
                disabled={saving}
                onChange={(event) =>
                  edit({ ticket_tour_type: event.target.value || null })
                }
                className={cellInClass(cell(tourChanged), false)}
              >
                <option value="">— no tour type —</option>
                {tourTypes.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
                {/* 后端清单里已经没有的旧键照实显示，不让下拉落到别的选项上。 */}
                {tourType && !tourTypes.some((t) => t.key === tourType) ? (
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
        {/* 这一行改过才出蓝色 Save（主窗口 eb 2026-10-30：几百行不全摆灰键），在 Deactivate 左边。 */}
        <SaveControl
          block={block}
          hideWhenClean
          className="mr-1.5 align-middle whitespace-normal"
        />
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
