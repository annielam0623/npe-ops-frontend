"use client";

import { useEffect, useState } from "react";

import {
  BTN_EDIT_CLASS,
  TD_CLASS,
  TR_CLASS,
} from "@/components/pickup-locations/legacy-ui";
import { cn } from "@/lib/utils";
import type {
  FarmOutPrice,
  FarmOutProduct,
  FarmOutRate,
  FarmOutRatePut,
  FarmOutTicketType,
} from "@/types/farm-out";

import { parsePriceInput, priceText } from "./config";
import { BTN_BLUE_SMALL, CELL_INPUT } from "./ui";

/**
 * G263 v3（Annie 原话「把每个tour单独列出，然后再下面加产品和价格不就好了，就没有母项子项这么麻烦了」；
 * 答题「1A 2 B 3 这个产品必须跟着partner的名字 比如 West Rim Premium Pass - Ctour」「同意推荐，动手」）：
 * 合作公司 → 团（只是标题）→ 一个产品一行。平时三列 Adult / Child / Infant（没设写「—」）；
 * 编辑时每个产品一个名字框（旁边灰字是后端给的全名）、下拉价格行 + 灰绿「+ Add price」，灰绿「+ Add product」，↑ ↓ ×；
 * 一个团一个 Save（蓝），都先放在页面上，按 Save 才存。
 */

export const TICKET_TYPES: { key: FarmOutTicketType; label: string }[] = [
  { key: "adult", label: "Adult" },
  { key: "child", label: "Child" },
  { key: "infant", label: "Infant" },
];

/** 先加在页面上、按 Save 才存的 Add：灰绿 #6b8e74（Annie 2026-10-30）。 */
const ADD_BTN =
  "cursor-pointer rounded-[6px] border border-[#6b8e74] bg-[#6b8e74] px-2.5 py-[3px] text-[12px] font-semibold text-white hover:bg-[#5d7d66] disabled:cursor-not-allowed disabled:opacity-50";
const PRODUCT_ROW = "bg-[#fbfbfa] night:bg-white/[.02]";
const ERR =
  "mt-0.5 block text-left text-[11px] text-[#b3261e] night:text-red-300";
const BAD = "border-[#dc2626] bg-[#fef2f2] night:bg-red-500/10";
const DASH = <span className="text-[#9ca3af] night:text-white/45">—</span>;

interface PriceDraft {
  key: string;
  ticket_type: FarmOutTicketType;
  price: string;
}
interface ProductDraft {
  key: string;
  id: number | null;
  name: string;
  /** 打开编辑时的名字 / 全名：名字没改才在旁边写全名。 */
  origName: string;
  displayName: string;
  prices: PriceDraft[];
}

let seq = 0;
const nextKey = (p: string) => `${p}-${seq++}`;

function toDrafts(products: FarmOutProduct[] | undefined): ProductDraft[] {
  return (products ?? []).map((p) => ({
    key: nextKey("prod"),
    id: p.id,
    name: p.name,
    origName: p.name,
    displayName: p.display_name ?? "",
    prices: sortPrices(p.prices).map((x) => ({
      key: nextKey("price"),
      ticket_type: x.ticket_type,
      price: priceText(x.price),
    })),
  }));
}

const ORDER: Record<FarmOutTicketType, number> = {
  adult: 0,
  child: 1,
  infant: 2,
};
function sortPrices<T extends { ticket_type: FarmOutTicketType }>(list: T[]) {
  return [...list].sort((a, b) => ORDER[a.ticket_type] - ORDER[b.ticket_type]);
}

function move<T>(all: T[], i: number, dir: -1 | 1): T[] {
  if (i + dir < 0 || i + dir >= all.length) return all;
  const next = [...all];
  [next[i], next[i + dir]] = [next[i + dir], next[i]];
  return next;
}

/** 前端先挡（同后端）：名字必填、≤80、同团不重名（不分大小写）；至少一行价格；价钱 ≥0、两位小数。 */
function draftErrors(
  products: ProductDraft[],
): Record<
  string,
  { name?: string; prices?: string; price?: Record<string, string> }
> {
  const out: Record<
    string,
    { name?: string; prices?: string; price?: Record<string, string> }
  > = {};
  const seen = new Set<string>();
  for (const p of products) {
    const e: {
      name?: string;
      prices?: string;
      price?: Record<string, string>;
    } = {};
    const name = p.name.trim();
    if (!name) e.name = "Enter a product name.";
    else if (name.length > 80)
      e.name = "Keep the name to 80 characters or fewer.";
    else if (seen.has(name.toLowerCase()))
      e.name = `${name} is already on this tour.`;
    else seen.add(name.toLowerCase());
    if (!p.prices.length) e.prices = "Add at least one price.";
    for (const x of p.prices) {
      const v = parsePriceInput(x.price);
      if (v === null || v === undefined || v < 0)
        (e.price ??= {})[x.key] = "Enter a price, e.g. 98 or 98.50.";
    }
    if (e.name || e.prices || e.price) out[p.key] = e;
  }
  return out;
}

/** 这个团要 PUT 的那一段（products 整组替换，顺序 = 数组顺序）。 */
export function toPut(
  manifestId: number,
  products: ProductDraft[],
): FarmOutRatePut {
  return {
    manifest_id: manifestId,
    products: products.map((p) => ({
      ...(p.id != null ? { id: p.id } : {}),
      name: p.name.trim(),
      prices: sortPrices(p.prices).map((x): FarmOutPrice => ({
        ticket_type: x.ticket_type,
        price: parsePriceInput(x.price) as number,
      })),
    })),
  };
}

const priceOf = (p: FarmOutProduct, t: FarmOutTicketType) =>
  p.prices.find((x) => x.ticket_type === t)?.price ?? null;

export function TourProducts({
  partnerName,
  active,
  rate,
  editing,
  saved,
  disabled,
  onStartEdit,
  onCancel,
  onSave,
  onDirty,
}: {
  partnerName: string;
  active: boolean;
  rate: FarmOutRate;
  editing: boolean;
  /** 刚存好：团名旁绿字 ✓ Saved。 */
  saved: boolean;
  /** 别的团正在编辑：Edit 点不了。 */
  disabled: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  /** 存这个团；返回 null = 存好，字符串 = 后端原话（红字）。 */
  onSave: (put: FarmOutRatePut) => Promise<string | null>;
  onDirty: (dirty: boolean) => void;
}) {
  const products = rate.products ?? [];
  const [drafts, setDrafts] = useState<ProductDraft[]>([]);
  const [initial, setInitial] = useState("");
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    const d = toDrafts(rate.products);
    setDrafts(d);
    setInitial(JSON.stringify(toPut(rate.manifest_id, d)));
    setTried(false);
    setError(null);
    // 只在打开编辑时读一次；存好后父组件换掉 rate 再关编辑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const dirty =
    editing && JSON.stringify(toPut(rate.manifest_id, drafts)) !== initial;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const errs = tried ? draftErrors(drafts) : {};
  const patch = (key: string, fn: (p: ProductDraft) => ProductDraft) => {
    setError(null);
    setDrafts((all) => all.map((p) => (p.key === key ? fn(p) : p)));
  };

  async function save() {
    setTried(true);
    if (Object.keys(draftErrors(drafts)).length) return;
    setSaving(true);
    setError(null);
    const r = await onSave(toPut(rate.manifest_id, drafts));
    setSaving(false);
    if (r) setError(r);
  }

  const tourRow = (
    <tr
      className={cn(TR_CLASS, !active && "opacity-60")}
      data-rate-row={`${partnerName}|${rate.tour_name}`}
    >
      <td colSpan={4} className={cn(TD_CLASS, "pl-6 font-semibold")}>
        {rate.tour_name}
        {saved ? (
          <span
            role="status"
            className="ml-2 text-[12px] font-semibold text-[#1e6b43] night:text-emerald-300"
          >
            ✓ Saved
          </span>
        ) : null}
        {error ? (
          <span
            role="alert"
            data-products-error
            className="ml-2 text-[12px] font-normal text-[#A32D2D] night:text-red-300"
          >
            {error}
          </span>
        ) : null}
      </td>
      <td className={TD_CLASS} />
      <td className={cn(TD_CLASS, "whitespace-nowrap")}>
        {!active ? null : editing ? (
          <span className="inline-flex gap-1.5">
            <button
              type="button"
              disabled={saving || !dirty}
              className={BTN_BLUE_SMALL}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className={BTN_EDIT_CLASS} onClick={onCancel}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label={`Edit ${rate.tour_name} products`}
            disabled={disabled}
            className={BTN_EDIT_CLASS}
            onClick={onStartEdit}
          >
            Edit
          </button>
        )}
      </td>
    </tr>
  );

  if (!editing) {
    return (
      <>
        {tourRow}
        {products.length === 0 ? (
          <tr className={cn(TR_CLASS, PRODUCT_ROW)}>
            <td
              colSpan={6}
              className={cn(
                TD_CLASS,
                "pl-12 text-[#A32D2D] italic night:text-red-300",
              )}
            >
              No products yet.
            </td>
          </tr>
        ) : (
          products.map((p) => (
            <tr
              key={p.id ?? p.name}
              className={cn(TR_CLASS, PRODUCT_ROW, !active && "opacity-60")}
              data-product-row={`${partnerName}|${rate.tour_name}|${p.name}`}
            >
              <td className={cn(TD_CLASS, "pl-12")} title={p.display_name}>
                {p.name}
              </td>
              {TICKET_TYPES.map((t) => {
                const v = priceOf(p, t.key);
                return (
                  <td
                    key={t.key}
                    data-price={t.key}
                    className={cn(TD_CLASS, "text-right tabular-nums")}
                  >
                    {v == null ? DASH : `$${v.toFixed(2)}`}
                  </td>
                );
              })}
              <td className={TD_CLASS} />
              <td className={TD_CLASS} />
            </tr>
          ))
        )}
      </>
    );
  }

  return (
    <>
      {tourRow}
      {drafts.map((p, i) => {
        const e = errs[p.key];
        const used = new Set(p.prices.map((x) => x.ticket_type));
        return (
          <tr
            key={p.key}
            className={cn(TR_CLASS, PRODUCT_ROW)}
            data-product-edit={i + 1}
          >
            <td className={cn(TD_CLASS, "pl-12 align-top")}>
              <span className="flex flex-wrap items-center gap-1.5">
                <input
                  type="text"
                  aria-label={`${rate.tour_name} product ${i + 1} name`}
                  placeholder="Product name"
                  maxLength={80}
                  autoFocus={!p.name && i === drafts.length - 1}
                  value={p.name}
                  onChange={(ev) =>
                    patch(p.key, (x) => ({ ...x, name: ev.target.value }))
                  }
                  className={cn(CELL_INPUT, "w-[200px]", e?.name && BAD)}
                />
                <button
                  type="button"
                  aria-label={`Move ${p.name || `product ${i + 1}`} up`}
                  disabled={i === 0}
                  className={BTN_EDIT_CLASS}
                  onClick={() => setDrafts((all) => move(all, i, -1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${p.name || `product ${i + 1}`} down`}
                  disabled={i === drafts.length - 1}
                  className={BTN_EDIT_CLASS}
                  onClick={() => setDrafts((all) => move(all, i, 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${p.name || `product ${i + 1}`}`}
                  className="cursor-pointer border-none bg-transparent px-1 text-[14px] font-bold text-[#A32D2D] night:text-red-300"
                  onClick={() =>
                    setDrafts((all) => all.filter((x) => x.key !== p.key))
                  }
                >
                  ×
                </button>
              </span>
              {p.displayName && p.name.trim() === p.origName ? (
                <span
                  data-display-name
                  className="mt-0.5 block text-[11.5px] text-[#6b7280] night:text-white/50"
                >
                  {p.displayName}
                </span>
              ) : null}
              {e?.name ? (
                <span data-product-error className={ERR}>
                  {e.name}
                </span>
              ) : null}
            </td>
            <td colSpan={3} className={cn(TD_CLASS, "align-top")}>
              <div className="flex flex-col items-end gap-1.5">
                {p.prices.map((x) => (
                  <span
                    key={x.key}
                    className="inline-flex items-center gap-1.5"
                  >
                    <select
                      aria-label={`${p.name || `Product ${i + 1}`} ticket type`}
                      value={x.ticket_type}
                      onChange={(ev) =>
                        patch(p.key, (pp) => ({
                          ...pp,
                          prices: pp.prices.map((y) =>
                            y.key === x.key
                              ? {
                                  ...y,
                                  ticket_type: ev.target
                                    .value as FarmOutTicketType,
                                }
                              : y,
                          ),
                        }))
                      }
                      className={cn(CELL_INPUT, "w-[90px]")}
                    >
                      {TICKET_TYPES.map((t) => (
                        <option
                          key={t.key}
                          value={t.key}
                          disabled={t.key !== x.ticket_type && used.has(t.key)}
                        >
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`${p.name || `Product ${i + 1}`} ${x.ticket_type} price`}
                      placeholder="0.00"
                      value={x.price}
                      onChange={(ev) =>
                        patch(p.key, (pp) => ({
                          ...pp,
                          prices: pp.prices.map((y) =>
                            y.key === x.key
                              ? { ...y, price: ev.target.value }
                              : y,
                          ),
                        }))
                      }
                      className={cn(
                        CELL_INPUT,
                        "w-[88px] text-right",
                        e?.price?.[x.key] && BAD,
                      )}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${x.ticket_type} price`}
                      className="cursor-pointer border-none bg-transparent px-1 text-[14px] font-bold text-[#A32D2D] night:text-red-300"
                      onClick={() =>
                        patch(p.key, (pp) => ({
                          ...pp,
                          prices: pp.prices.filter((y) => y.key !== x.key),
                        }))
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
                {e?.price ? (
                  <span data-product-error className={ERR}>
                    {Object.values(e.price)[0]}
                  </span>
                ) : null}
                {e?.prices ? (
                  <span data-product-error className={ERR}>
                    {e.prices}
                  </span>
                ) : null}
                <button
                  type="button"
                  data-add-price
                  disabled={used.size >= TICKET_TYPES.length}
                  className={ADD_BTN}
                  onClick={() => {
                    const free = TICKET_TYPES.find((t) => !used.has(t.key));
                    if (!free) return;
                    patch(p.key, (pp) => ({
                      ...pp,
                      prices: [
                        ...pp.prices,
                        {
                          key: nextKey("price"),
                          ticket_type: free.key,
                          price: "",
                        },
                      ],
                    }));
                  }}
                >
                  + Add price
                </button>
              </div>
            </td>
            <td className={TD_CLASS} />
            <td className={TD_CLASS} />
          </tr>
        );
      })}
      <tr className={cn(TR_CLASS, PRODUCT_ROW)}>
        <td colSpan={6} className={cn(TD_CLASS, "pl-12")}>
          <button
            type="button"
            data-add-product
            className={ADD_BTN}
            onClick={() => {
              setTried(false);
              setDrafts((all) => [
                ...all,
                {
                  key: nextKey("prod"),
                  id: null,
                  name: "",
                  origName: "",
                  displayName: "",
                  prices: [
                    { key: nextKey("price"), ticket_type: "adult", price: "" },
                  ],
                },
              ]);
            }}
          >
            + Add product
          </button>
        </td>
      </tr>
    </>
  );
}
