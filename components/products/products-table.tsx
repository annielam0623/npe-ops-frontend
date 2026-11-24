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
import { SelectMenu } from "@/components/ui/select-menu";

/** 名字旁的来源小标签（样子同以前写死的 REZDY）：rezdy / tripguru 各一个，both 两个都出；没有 source 不出。 */
function SourceTags({ source }: { source: Product["source"] }) {
  const tags =
    source === "rezdy"
      ? ["REZDY"]
      : source === "tripguru"
        ? ["TRIPGURU"]
        : source === "both"
          ? ["REZDY", "TRIPGURU"]
          : [];
  return tags.map((t) => (
    <span
      key={t}
      data-product-source={t.toLowerCase()}
      className={cn(
        "ml-1.5 inline-block rounded-[4px] px-[5px] align-[1px] text-[9px] font-semibold whitespace-nowrap",
        // TRIPGURU 蓝（Annie 2026-11-21「把product里tripguru的标记改成蓝色」）：同 Order List Source 列的 TripGuru
        // （components/orders/orders-list-view.tsx SOURCE_TAG.tripguru），全站一个 TripGuru 蓝。REZDY 照旧灰。
        t === "TRIPGURU"
          ? "bg-[#E6F1FB] text-[#185FA5] night:bg-sky-400/[.08] night:text-sky-300"
          : "bg-[#f0f0ee] text-[#1a1a1a] night:bg-white/[.03] night:text-white/35",
      )}
    >
      {t}
    </span>
  ));
}

/** G381 对照小字的样子：TripGuru 蓝（同 TRIPGURU 标签），名字格里的第二行。 */
const TWIN_LINE_CLASS =
  "mt-[3px] block text-[11px] leading-[1.45] text-[#4a5560] night:text-white/45";
const TWIN_LABEL_CLASS = "font-semibold text-[#185FA5] night:text-sky-300";
const TWIN_CODE_CLASS =
  "cursor-pointer font-mono text-[11px] font-semibold text-[#185FA5] underline underline-offset-2 hover:text-[#0f4a85] night:text-sky-300 night:hover:text-sky-200";

/** 「historical orders only」灰色小标（historical_order_only = TripGuru 只为老订单保留这个编码）。 */
function HistoricalTag() {
  return (
    <span
      data-twin-historical
      className="ml-1 inline-block rounded-[4px] bg-[#ececea] px-[5px] align-[1px] text-[9px] font-semibold whitespace-nowrap text-[#6b6b6b] night:bg-white/[.05] night:text-white/40"
    >
      historical orders only
    </span>
  );
}

/** 能点的编码：跳到 Products 里那一行并黄色高亮（Annie 2026-11-24 F2 选 A）。 */
function TwinCode({
  code,
  onJump,
}: {
  code: string;
  onJump: (code: string) => void;
}) {
  return (
    <button
      type="button"
      data-twin-jump={code}
      title={`Go to ${code}`}
      onClick={() => onJump(code)}
      className={TWIN_CODE_CLASS}
    >
      {code}
    </button>
  );
}

/**
 * G381 TripGuru twin（Annie 2026-11-24：F1 选 C、F2 A、F3 A，「动手」；样稿 https://claude.ai/artifact/7vNEeMuiQYz52qePcxRd6m）。
 * 只读：Rezdy 行名字下一行小字「TripGuru twin: 编码 产品名 › 选项名」；TG 行收起成「▸ N TripGuru options · M Rezdy codes」，
 * 点开每个选项一行「选项名 → Rezdy 编码 · …」。Products 里没有的 Rezdy 编码灰字「(not in Products)」不能点。
 * 两个字段都空 / 不存在（后端没上）⇒ 什么都不出，跟以前一样。
 */
function TripGuruTwinLines({
  product: p,
  onJump,
}: {
  product: Product;
  onJump: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const twin = p.tripguru_twin;
  const options = p.tripguru_options ?? [];
  if (!twin && options.length === 0) return null;
  const codeCount = options.reduce((n, o) => n + o.rezdy.length, 0);
  return (
    <>
      {twin ? (
        <span data-tripguru-twin className={TWIN_LINE_CLASS}>
          <span className={TWIN_LABEL_CLASS}>TripGuru twin:</span>{" "}
          <TwinCode code={twin.product_code} onJump={onJump} />{" "}
          {twin.product_name}
          {twin.option_name ? <> › {twin.option_name}</> : null}
          {twin.historical_order_only ? <HistoricalTag /> : null}
        </span>
      ) : null}
      {options.length > 0 ? (
        <>
          <button
            type="button"
            data-tripguru-options-toggle
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className={cn(
              TWIN_LINE_CLASS,
              TWIN_LABEL_CLASS,
              "cursor-pointer text-left",
            )}
          >
            {open ? "▾" : "▸"} {options.length} TripGuru{" "}
            {options.length === 1 ? "option" : "options"} · {codeCount} Rezdy{" "}
            {codeCount === 1 ? "code" : "codes"}
          </button>
          {open ? (
            <span data-tripguru-options className={TWIN_LINE_CLASS}>
              {options.map((o) => (
                <span
                  key={o.option_id || o.option_code}
                  className="mt-0.5 block pl-2.5"
                >
                  {o.option_name || o.option_code} →{" "}
                  {o.rezdy.map((r, i) => (
                    <Fragment key={r.product_code}>
                      {i > 0 ? " · " : null}
                      {r.in_products ? (
                        <TwinCode code={r.product_code} onJump={onJump} />
                      ) : (
                        <span
                          data-twin-not-in-products
                          title="This Rezdy code has no row in Products yet"
                          className="font-mono text-[11px] text-[#8a8f94] night:text-white/30"
                        >
                          {r.product_code} (not in Products)
                        </span>
                      )}
                      {r.historical_order_only ? <HistoricalTag /> : null}
                    </Fragment>
                  ))}
                </span>
              ))}
            </span>
          ) : null}
        </>
      ) : null}
    </>
  );
}

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
  folded,
  onFold,
  allVisiblePicked,
  onPick,
  onPickAll,
  onSaveRow,
  rowSaved,
  onToggleActive,
  renderBulkBar,
  busTourLabel,
  highlightId,
  onJumpToCode,
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
  /** 收起的组（section.key）。收起只是藏起来，行还在（没存的改动不丢）。 */
  folded: ReadonlySet<string>;
  onFold: (key: string) => void;
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
  /** G381：点 TripGuru 对照里的编码，跳到 Products 里那一行（Annie 2026-11-24 F2 选 A）。 */
  onJumpToCode: (code: string) => void;
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
        {placeholder ? (
        <tbody className={TBODY_CLASS}>
            <tr>
              <td
                colSpan={colSpan}
                className="p-5 text-center text-[#1a1a1a] night:text-white/35"
              >
                {placeholder}
              </td>
            </tr>
        </tbody>
          ) : (
            sections.map((section) => {
              const isFolded = folded.has(section.key);
              return (
              <Fragment key={section.key}>
              <tbody className={TBODY_CLASS}>
                <tr className={TR_CLASS}>
                  <td colSpan={colSpan} className={cn(GROUP_ROW_TD_CLASS, "p-0")}>
                    <button
                      type="button"
                      data-section-toggle={section.key}
                      aria-expanded={!isFolded}
                      onClick={() => onFold(section.key)}
                      className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-[7px] text-left font-semibold hover:bg-black/[.03] night:hover:bg-white/[.04]"
                    >
                      <span aria-hidden className="inline-block w-3 text-[11px]">
                        {isFolded ? "▸" : "▾"}
                      </span>
                      {section.title}{" "}
                      <span className={GROUP_COUNT_CLASS}>
                        {section.rows.length === section.total
                          ? section.total
                          : `${section.rows.length} of ${section.total}`}
                      </span>
                    </button>
                  </td>
                </tr>
              </tbody>
              <tbody className={TBODY_CLASS} hidden={isFolded}>
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
                      onJumpToCode={onJumpToCode}
                    />
                    {barAfterId === p.id && renderBulkBar ? (
                      <BulkBarRow colSpan={colSpan}>
                        {renderBulkBar({ spanned })}
                      </BulkBarRow>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
              </Fragment>
              );
            })
          )}
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
  onJumpToCode,
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
  onJumpToCode: (code: string) => void;
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
        <SourceTags source={p.source} />
        <TripGuruTwinLines product={p} onJump={onJumpToCode} />
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
        <SelectMenu
          aria-label={`Group for ${p.product_code}`}
          value={String(
            draft.manifest_id === null ? "" : String(draft.manifest_id),
          )}
          options={[
            { value: "", label: "— no group —" },
            ...selectableGroups(groups, p.manifest_id).map((g) => ({
              value: String(String(g.id)),
              label: String(groupLabel(g)),
            })),
          ]}
          disabled={saving}
          onChange={(next) =>
            edit({
              manifest_id: next ? Number(next) : null,
            })
          }
          className={cellInClass(cell(changed("manifest_id")))}
        />
      </td>
      <td className={PROD_TD_CLASS}>
        <SelectMenu
          aria-label={`Category for ${p.product_code}`}
          value={String(draft.booking_type)}
          options={[
            { value: "", label: "— blank (falls back) —" },
            ...bookingTypes.map((t) => ({
              value: String(t),
              label: String(typeLabel(t)),
            })),
            // 库里有、但后端清单里没有的旧值照实显示，不让下拉落到别的选项上。
            ...(p.booking_type && !bookingTypes.includes(p.booking_type)
              ? [
                  {
                    value: String(p.booking_type),
                    label: String(typeLabel(p.booking_type)),
                  },
                ]
              : []),
          ]}
          disabled={saving}
          onChange={(next) => edit({ booking_type: next })}
          className={cellInClass(cell(changed("booking_type")), need)}
        />
      </td>
      {showTour ? (
        <td className={PROD_TD_CLASS}>
          {isTicket ? (
            tourTypes ? (
              <SelectMenu
                aria-label={`Tour type for ${p.product_code}`}
                data-tour-field="ticket_tour_type"
                value={String(tourType)}
                options={[
                  { value: "", label: "— no tour type —" },
                  ...tourTypes.map((t) => ({
                    value: String(t.key),
                    label: String(t.label),
                  })),
                  // 后端清单里已经没有的旧键照实显示，不让下拉落到别的选项上。
                  ...(tourType && !tourTypes.some((t) => t.key === tourType)
                    ? [{ value: String(tourType), label: String(tourType) }]
                    : []),
                ]}
                disabled={saving}
                onChange={(next) => edit({ ticket_tour_type: next || null })}
                className={cellInClass(cell(tourChanged), false)}
              />
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
