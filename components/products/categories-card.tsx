"use client";

import { useState } from "react";

import {
  BTN_OFF_CLASS,
  BTN_ON_CLASS,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  resultClass,
} from "@/components/pickup-locations/legacy-ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { describeError, isStatus } from "@/lib/api-errors";
import { createCategory, setCategoryActive } from "@/lib/categories-api";
import { cn } from "@/lib/utils";
import type { Product, ProductCategory, ProductGroup } from "@/types";

import {
  cellInClass,
  CODE_CELL_CLASS,
  PILL_OFF_CLASS,
  PROD_BTN_ADD_CLASS,
  PROD_TD_CLASS,
  PROD_TH_CLASS,
} from "./legacy-ui";

/**
 * Settings → Products 的「Categories」一块（Annie 2026-10-19：「你需要给一个地方专门用来增加新的 category」，
 * 看过 preview 说「category 同意。动手」）。样子和规矩同旁边的 Groups：默认收起；新建一行在最后；
 * Short name 和 Name 建了不能改、没有删除、停用只是不再出现在各个 Category 下拉里（已经用着它的产品和组不变）；
 * 四个内置的显示 built in、不能停用。后端接口没上线时父组件不渲染这张卡（见 lib/categories-api.ts）。
 * 规则全在后端，不合规矩时照服务端原话显示。
 */
export function CategoriesCard({
  categories,
  products,
  groups,
  onChanged,
  onUnauthorized,
}: {
  categories: ProductCategory[];
  products: Product[];
  groups: ProductGroup[];
  /** 改成功后重拉分类清单（各处下拉跟着变）。 */
  onChanged: () => Promise<void>;
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const productCount = (key: string) =>
    products.filter((p) => p.booking_type === key).length;
  const groupCount = (key: string) =>
    groups.filter((g) => g.booking_type === key).length;

  return (
    <details
      data-categories-card
      className={CARD_CLASS}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        className={cn(
          CARD_HEADER_CLASS,
          "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        )}
      >
        <span className="text-[13px] font-semibold text-[#1a1a1a] night:text-white/90">
          {open ? "▾" : "▸"} Categories
        </span>
        <span className="text-[11px] font-normal text-[#1a1a1a] night:text-white/35">
          Add a category for reports. It cannot be renamed or deleted once
          added; deactivate it to hide it from the dropdowns
        </span>
      </summary>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <td className={cn(PROD_TH_CLASS, "w-[30%]")}>Name</td>
              <td
                className={cn(PROD_TH_CLASS, "w-[18%]")}
                title="Internal key. Set once when the category is added."
              >
                Short name
              </td>
              <td className={cn(PROD_TH_CLASS, "w-[12%]")}>Products</td>
              <td className={cn(PROD_TH_CLASS, "w-[12%]")}>Groups</td>
              <td className={cn(PROD_TH_CLASS, "w-[28%]")}>Status</td>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <CategoryRow
                key={`${c.code}:${c.is_active}`}
                category={c}
                products={productCount(c.code)}
                groups={groupCount(c.code)}
                onChanged={onChanged}
                onUnauthorized={onUnauthorized}
              />
            ))}
          </tbody>
          <AddCategoryRow
            onChanged={onChanged}
            onUnauthorized={onUnauthorized}
          />
        </table>
      </div>
    </details>
  );
}

function CategoryRow({
  category: c,
  products,
  groups,
  onChanged,
  onUnauthorized,
}: {
  category: ProductCategory;
  products: number;
  groups: number;
  onChanged: () => Promise<void>;
  onUnauthorized: () => void;
}) {
  const [error, setError] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);

  async function save(active: boolean) {
    setError("");
    try {
      await setCategoryActive(c.code, active);
      await onChanged();
      return { status: "ok" } as const;
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return { status: "redirecting" } as const;
      }
      setError(describeError(e));
      return { status: "error", message: describeError(e) } as const;
    }
  }

  return (
    <tr
      data-category={c.code}
      className={cn(
        "border-t-[0.5px] border-black/[.06] night:border-white/[.06]",
        !c.is_active && "opacity-55",
      )}
    >
      <td className={PROD_TD_CLASS}>{c.display_name}</td>
      <td className={cn(PROD_TD_CLASS, CODE_CELL_CLASS)}>{c.code}</td>
      <td className={PROD_TD_CLASS}>{products}</td>
      <td className={PROD_TD_CLASS}>{groups}</td>
      <td className={PROD_TD_CLASS}>
        {c.is_builtin ? (
          <span className={PILL_OFF_CLASS}>built in</span>
        ) : c.is_active ? (
          <button
            type="button"
            className={BTN_OFF_CLASS}
            onClick={() => setConfirmOff(true)}
          >
            Deactivate
          </button>
        ) : (
          <>
            <button
              type="button"
              className={BTN_ON_CLASS}
              onClick={() => void save(true)}
            >
              Reactivate
            </button>
            <span className={PILL_OFF_CLASS}>Inactive</span>
          </>
        )}
        {error ? (
          <div role="alert" className={resultClass("error")}>
            {error}
          </div>
        ) : null}
        {confirmOff ? (
          <ConfirmDialog
            title={`Deactivate "${c.display_name}"?`}
            confirmLabel="Deactivate"
            busyLabel="Deactivating…"
            onConfirm={async () => {
              const result = await save(false);
              if (result.status === "ok") setConfirmOff(false);
              return result;
            }}
            onClose={() => setConfirmOff(false)}
          >
            <p>
              It stops showing in the Category lists when you set a product or
              a group. Products and groups already using it keep it. Reactivate
              brings it back.
            </p>
          </ConfirmDialog>
        ) : null}
      </td>
    </tr>
  );
}

function AddCategoryRow({
  onChanged,
  onUnauthorized,
}: {
  onChanged: () => Promise<void>;
  onUnauthorized: () => void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(
    null,
  );

  async function add() {
    setBusy(true);
    setMsg(null);
    try {
      const created = await createCategory({
        code: key.trim(),
        display_name: name.trim(),
      });
      setName("");
      setKey("");
      setMsg({
        tone: "ok",
        text: `Added "${created.display_name}". It is now in the Category lists of Groups, All Products and Not in this list yet.`,
      });
      await onChanged();
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setMsg({ tone: "error", text: `Could not add: ${describeError(e)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <tbody>
      <tr className="border-t-[0.5px] border-black/[.06] night:border-white/[.06]">
        <td className={PROD_TD_CLASS}>
          <input
            type="text"
            maxLength={100}
            aria-label="Name for the new category"
            placeholder="e.g. CHD Fee"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cellInClass()}
          />
        </td>
        <td className={PROD_TD_CLASS}>
          <input
            type="text"
            maxLength={20}
            aria-label="Short name for the new category"
            placeholder="e.g. chd_fee"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className={cellInClass()}
          />
        </td>
        <td className={PROD_TD_CLASS} />
        <td className={PROD_TD_CLASS} />
        <td className={PROD_TD_CLASS}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void add()}
            className={PROD_BTN_ADD_CLASS}
          >
            Add category
          </button>
        </td>
      </tr>
      <tr>
        <td colSpan={5} className="px-3 pb-2.5">
          {msg ? (
            <span
              role={msg.tone === "error" ? "alert" : "status"}
              className={resultClass(msg.tone)}
            >
              {msg.text}
            </span>
          ) : null}
        </td>
      </tr>
    </tbody>
  );
}
