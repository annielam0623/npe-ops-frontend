"use client";

import { useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import {
  BTN_OFF_CLASS,
  BTN_ON_CLASS,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  resultClass,
} from "@/components/pickup-locations/legacy-ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { describeError, isStatus } from "@/lib/api-errors";
import { createProductGroup, updateProductGroup } from "@/lib/products-api";
import { cn } from "@/lib/utils";
import type { Product, ProductGroup } from "@/types";

import { typeLabel } from "./config";
import {
  cellInClass,
  CODE_CELL_CLASS,
  PILL_OFF_CLASS,
  PROD_BTN_ADD_CLASS,
  PROD_TD_CLASS,
  PROD_TH_CLASS,
} from "./legacy-ui";
import type { CellState } from "./products-table";

/**
 * Settings → Products 的「Groups」一块（后端 2026-10-11 `85a5d95`，照旧 settings_products.html 的 #groups-card）：
 * 新建 / 改显示名 / 改顺序 / 停用；没有删除。默认收起（不常用，展开会把产品表挤下去）。
 * 规则全在后端（manifest_groups.py）：Short name 和 Category 建了以后不能改、显示名不能重复……不合规矩时照服务端原话显示。
 * 每次改成功都让父组件重拉组和产品（组名 / 顺序变了，产品表的组标题、所有 Group 下拉都要跟着变）。
 */
export function GroupsCard({
  groups,
  products,
  bookingTypes,
  onChanged,
  onUnauthorized,
}: {
  groups: ProductGroup[];
  products: Product[];
  bookingTypes: string[];
  /** 改成功后：重拉组、产品、「Not in this list yet」。 */
  onChanged: () => Promise<void>;
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const counts = new Map<number, number>();
  for (const p of products)
    if (p.manifest_id !== null)
      counts.set(p.manifest_id, (counts.get(p.manifest_id) ?? 0) + 1);

  return (
    <details
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
          {open ? "▾" : "▸"} Groups
        </span>
        <span className="text-[11px] font-normal text-[#999] night:text-white/35">
          Add a group, rename it, change the order, deactivate it
        </span>
      </summary>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <td
                className={cn(PROD_TH_CLASS, "w-[9%]")}
                title="One order for the whole site: Products, Manifests, Dispatch and the Forecast all use it."
              >
                Order
              </td>
              <td
                className={cn(PROD_TH_CLASS, "w-[16%]")}
                title="Internal key. Set once when the group is added."
              >
                Short name
              </td>
              <td className={cn(PROD_TH_CLASS, "w-[34%]")}>Display name</td>
              <td
                className={cn(PROD_TH_CLASS, "w-[13%]")}
                title="Set once when the group is added."
              >
                Category
              </td>
              <td className={cn(PROD_TH_CLASS, "w-[10%]")}>Products</td>
              <td className={cn(PROD_TH_CLASS, "w-[18%]")}>Status</td>
            </tr>
          </thead>
          <tbody>
            {groups.length ? (
              groups.map((g) => (
                <GroupRow
                  // 重拉后值变了就重建这一行，框里显示服务端的新值（改名 / 改顺序 / 停用都会重排）。
                  key={`${g.id}:${g.sort_order}:${g.display_name}:${g.is_active}`}
                  group={g}
                  productCount={counts.get(g.id) ?? 0}
                  onChanged={onChanged}
                  onUnauthorized={onUnauthorized}
                />
              ))
            ) : (
              <tr>
                <td
                  colSpan={6}
                  className="p-5 text-center text-[#ccc] night:text-white/35"
                >
                  No groups yet.
                </td>
              </tr>
            )}
          </tbody>
          <AddGroupRow
            bookingTypes={bookingTypes}
            onChanged={onChanged}
            onUnauthorized={onUnauthorized}
          />
        </table>
      </div>
    </details>
  );
}

function GroupRow({
  group: g,
  productCount,
  onChanged,
  onUnauthorized,
}: {
  group: ProductGroup;
  productCount: number;
  onChanged: () => Promise<void>;
  onUnauthorized: () => void;
}) {
  const [order, setOrder] = useState(
    g.sort_order === null ? "" : String(g.sort_order),
  );
  const [display, setDisplay] = useState(g.display_name || "");
  const [state, setState] = useState<
    Partial<Record<"sort_order" | "display_name", CellState>>
  >({});
  const [error, setError] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);

  /** 一次改一项；失败写原因、框里改回已存的值（同旧页面）。 */
  async function save(
    patch: Parameters<typeof updateProductGroup>[1],
  ): Promise<ActionResult> {
    setError("");
    try {
      await updateProductGroup(g.id, patch);
      await onChanged();
      return { status: "ok" };
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return { status: "redirecting" };
      }
      const message = describeError(e);
      setError(`Could not save: ${message}`);
      return { status: "error", message };
    }
  }

  async function saveField(field: "sort_order" | "display_name") {
    const saved =
      field === "sort_order"
        ? g.sort_order === null
          ? ""
          : String(g.sort_order)
        : g.display_name || "";
    const value = field === "sort_order" ? order.trim() : display;
    if (value === saved) return;
    setState((s) => ({ ...s, [field]: "saving" }));
    // 顺序框里填了非整数：原样送上去（NaN → null），让服务端给那句人话（同旧页面）。
    const result = await save(
      field === "sort_order"
        ? { sort_order: value === "" ? null : Number(value) }
        : { display_name: value },
    );
    if (result.status === "ok") {
      setState((s) => ({ ...s, [field]: "saved" }));
    } else {
      setState((s) => ({ ...s, [field]: "failed" }));
      if (field === "sort_order") setOrder(saved);
      else setDisplay(saved);
    }
  }

  return (
    <tr
      data-gid={g.id}
      className={cn(
        "border-t-[0.5px] border-black/[.06] night:border-white/[.06]",
        !g.is_active && "opacity-55",
      )}
    >
      <td className={PROD_TD_CLASS}>
        <input
          type="number"
          min={0}
          max={9999}
          aria-label={`Order for ${g.name}`}
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          onBlur={() => void saveField("sort_order")}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={cellInClass(state.sort_order)}
        />
      </td>
      <td className={cn(PROD_TD_CLASS, CODE_CELL_CLASS)}>{g.name}</td>
      <td className={PROD_TD_CLASS}>
        <input
          type="text"
          maxLength={200}
          aria-label={`Display name for ${g.name}`}
          value={display}
          onChange={(e) => setDisplay(e.target.value)}
          onBlur={() => void saveField("display_name")}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={cellInClass(state.display_name)}
        />
      </td>
      <td className={PROD_TD_CLASS}>{typeLabel(g.booking_type)}</td>
      <td className={PROD_TD_CLASS}>{productCount}</td>
      <td className={PROD_TD_CLASS}>
        {g.is_active ? (
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
              onClick={() => void save({ is_active: true })}
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
            title={`Deactivate "${g.display_name}"?`}
            confirmLabel="Deactivate"
            busyLabel="Deactivating…"
            onConfirm={async () => {
              const result = await save({ is_active: false });
              if (result.status === "ok") setConfirmOff(false);
              return result;
            }}
            onClose={() => setConfirmOff(false)}
          >
            <p>
              It stops showing in the Group list when you set a product&rsquo;s
              group. Products already in it, and their guests, keep showing
              everywhere. Reactivate brings it back.
            </p>
          </ConfirmDialog>
        ) : null}
      </td>
    </tr>
  );
}

function AddGroupRow({
  bookingTypes,
  onChanged,
  onUnauthorized,
}: {
  bookingTypes: string[];
  onChanged: () => Promise<void>;
  onUnauthorized: () => void;
}) {
  const [order, setOrder] = useState("");
  const [name, setName] = useState("");
  const [display, setDisplay] = useState("");
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(
    null,
  );

  async function add() {
    setBusy(true);
    setMsg(null);
    try {
      const created = await createProductGroup({
        name,
        display_name: display,
        booking_type: type,
        is_active: true,
        ...(order.trim() === "" ? {} : { sort_order: Number(order) }),
      });
      setOrder("");
      setName("");
      setDisplay("");
      setType("");
      // 同旧页面原话：Manifest setup 的组清单要重新打开页面才有。
      setMsg({
        tone: "ok",
        text: `Added "${created.display_name}". Reload the page to see it in Manifest setup.`,
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
            type="number"
            min={0}
            max={9999}
            aria-label="Order for the new group"
            placeholder="last"
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            className={cellInClass()}
          />
        </td>
        <td className={PROD_TD_CLASS}>
          <input
            type="text"
            maxLength={40}
            aria-label="Short name for the new group"
            placeholder="e.g. BoulderCity"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cellInClass()}
          />
        </td>
        <td className={PROD_TD_CLASS}>
          <input
            type="text"
            maxLength={200}
            aria-label="Display name for the new group"
            placeholder="e.g. Boulder City Shuttle"
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
            className={cellInClass()}
          />
        </td>
        <td className={PROD_TD_CLASS}>
          <select
            aria-label="Category for the new group"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={cellInClass()}
          >
            <option value="">— pick —</option>
            {bookingTypes.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
        </td>
        <td className={PROD_TD_CLASS} />
        <td className={PROD_TD_CLASS}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void add()}
            className={PROD_BTN_ADD_CLASS}
          >
            Add group
          </button>
        </td>
      </tr>
      <tr>
        <td colSpan={6} className="px-3 pb-2.5">
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
