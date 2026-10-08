"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TBODY_CLASS, TR_CLASS } from "@/components/pickup-locations/legacy-ui";
import { cn } from "@/lib/utils";
import type { MissingProduct, ProductGroup } from "@/types";

import { groupLabel, missingDates, typeLabel } from "./config";
import {
  BULK_APPLY_CLASS,
  BULK_BAR_CLASS,
  BULK_CLEAR_CLASS,
  BULK_HINT_CLASS,
  BULK_SELECT_CLASS,
  cellInClass,
  CODE_CELL_CLASS,
  GROUP_COUNT_CLASS,
  GROUP_ROW_TD_CLASS,
  PICK_TD_CLASS,
  PROD_BTN_ADD_CLASS,
  PROD_TD_CLASS,
  PROD_TH_CLASS,
  REZDY_NAME_CLASS,
} from "./legacy-ui";

/** 一行的选择和结果。 */
interface RowState {
  groupId: string;
  type: string;
  internal: string;
  status: "idle" | "adding" | "added";
  error: string | null;
}

const KEEP = "__keep__";

const CELL_SELECT = cellInClass();

/**
 * 订单上出现过、但还不在列表里的产品。加进去以后行变绿，**这张卡片在本次打开期间不重画**
 * （Annie 2026-10-01 定），下次打开页面才消失。
 */
export function MissingCard({
  missing,
  groups,
  bookingTypes,
  onAdd,
}: {
  missing: MissingProduct[];
  groups: ProductGroup[];
  bookingTypes: string[];
  /** 加一个；失败抛出的 Error.message 就是给人看的原因。 */
  onAdd: (
    m: MissingProduct,
    choice: { groupId: string; type: string; internal: string },
  ) => Promise<void>;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      missing.map((m) => [
        m.product_code,
        { groupId: "", type: "", internal: "", status: "idle", error: null },
      ]),
    ),
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showPast, setShowPast] = useState(false);
  const [bulkGroup, setBulkGroup] = useState(KEEP);
  const [bulkType, setBulkType] = useState(KEEP);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const update = (code: string, patch: Partial<RowState>) =>
    setRows((all) => ({ ...all, [code]: { ...all[code], ...patch } }));

  const upcoming = missing.filter((m) => m.upcoming_rows > 0);
  const past = missing.filter((m) => m.upcoming_rows === 0);
  const left = missing.filter((m) => rows[m.product_code].status !== "added");
  const leftUpcoming = left.filter((m) => m.upcoming_rows > 0).length;

  const title = !left.length
    ? "All added. They leave this card the next time the page loads."
    : leftUpcoming
      ? `${leftUpcoming} ${leftUpcoming === 1 ? "product on upcoming orders is" : "products on upcoming orders are"} not in this list yet`
      : `${left.length} past product(s) never made it into this list`;

  async function addOne(
    m: MissingProduct,
    choice?: { groupId: string; type: string },
  ) {
    const row = rows[m.product_code];
    const groupId = choice?.groupId ?? row.groupId;
    const type = choice?.type ?? row.type;
    update(m.product_code, { status: "adding", error: null, groupId, type });
    try {
      await onAdd(m, { groupId, type, internal: row.internal.trim() });
      update(m.product_code, { status: "added" });
      setPicked((set) => {
        const next = new Set(set);
        next.delete(m.product_code);
        return next;
      });
      return true;
    } catch (error) {
      update(m.product_code, {
        status: "idle",
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async function addPicked() {
    const targets = missing.filter((m) => picked.has(m.product_code));
    let ok = 0;
    let failed = 0;
    // 一个一个加（后端没有批量新增）；失败的留着勾选，原因写在那一行。
    for (const m of targets) {
      const row = rows[m.product_code];
      const done = await addOne(m, {
        groupId: bulkGroup === KEEP ? row.groupId : bulkGroup,
        type: bulkType === KEEP ? row.type : bulkType,
      });
      if (done) ok++;
      else failed++;
    }
    setNotice(
      failed
        ? `${ok} added, ${failed} not added. The reason is shown on each row that is still ticked.`
        : `${ok} added.`,
    );
    return { status: "ok" } as const;
  }

  const visible = showPast ? [...upcoming, ...past] : upcoming;
  const pickable = visible.filter(
    (m) => rows[m.product_code].status === "idle",
  );
  const allPicked =
    pickable.length > 0 && pickable.every((m) => picked.has(m.product_code));
  const groupName = (id: string) =>
    groups.find((g) => String(g.id) === id)?.display_name ?? "";

  return (
    // .card.needs-attention：琥珀框（不是红：没有东西坏掉，只是还没归类）。
    <section
      data-missing-card
      className="mb-5 overflow-hidden rounded-[12px] border-[0.5px] border-[#fed7aa] bg-white"
    >
      <div className="flex items-center justify-between border-b-[0.5px] border-black/[.08] bg-[#fff4e5] px-4 py-3">
        <h2 className="text-[13px] font-semibold text-[#9a3412]">{title}</h2>
      </div>
      {/* .miss-intro */}
      <div className="border-b-[0.5px] border-black/[.06] bg-[#fffaf3] px-4 py-3 text-[12px] leading-[1.6] text-[#7c4a1e]">
        <p>
          These product codes have appeared on orders but are not in the list
          below, so this table gives no category for them. Their orders fall
          back to whatever category was stored on the booking itself — which may
          or may not be right, and nothing warns anyone either way.
          <br />
          Pick a group and a category, then <strong>Add</strong>. The name comes
          from Rezdy and keeps updating on its own.
          <br />
          <span className="text-[12px] text-[#aaa]">
            Ones with upcoming departures come first. The rest ran in the past —
            worth adding anyway, because a seasonal product that comes back next
            year will already be classified.
          </span>
        </p>
      </div>

      {picked.size ? (
        <div className={BULK_BAR_CLASS}>
          <b className="font-semibold">{picked.size} product(s) selected</b>
          <select
            aria-label="Group for selected"
            value={bulkGroup}
            onChange={(event) => setBulkGroup(event.target.value)}
            className={BULK_SELECT_CLASS}
          >
            <option value={KEEP}>— group: leave as is —</option>
            <option value="">— no group —</option>
            {groups.map((g) => (
              <option key={g.id} value={String(g.id)}>
                {groupLabel(g)}
              </option>
            ))}
          </select>
          <select
            aria-label="Category for selected"
            value={bulkType}
            onChange={(event) => setBulkType(event.target.value)}
            className={BULK_SELECT_CLASS}
          >
            <option value={KEEP}>— category: leave as is —</option>
            <option value="">— blank (falls back) —</option>
            {bookingTypes.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={BULK_APPLY_CLASS}
          >
            Add selected
          </button>
          <button
            type="button"
            onClick={() => setPicked(new Set())}
            className={BULK_CLEAR_CLASS}
          >
            Clear
          </button>
          <span className={BULK_HINT_CLASS}>
            Internal name is taken from each row.
          </span>
        </div>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="border-b-[0.5px] border-black/[.06] px-4 py-2 text-[12px] text-[#444]"
        >
          {notice}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th className={cn(PROD_TH_CLASS, "w-[28px] pr-0")}>
                <input
                  type="checkbox"
                  aria-label="Select every row shown"
                  title="Select every row shown"
                  checked={allPicked}
                  disabled={!pickable.length}
                  onChange={(event) =>
                    setPicked(
                      event.target.checked
                        ? new Set(pickable.map((m) => m.product_code))
                        : new Set(),
                    )
                  }
                />
              </th>
              <th className={cn(PROD_TH_CLASS, "w-[9%]")}>Code</th>
              <th className={cn(PROD_TH_CLASS, "w-[30%]")}>
                Name (from Rezdy)
              </th>
              <th className={cn(PROD_TH_CLASS, "w-[11%]")}>Upcoming</th>
              <th className={cn(PROD_TH_CLASS, "w-[16%]")}>Group</th>
              <th className={cn(PROD_TH_CLASS, "w-[13%]")}>Category</th>
              <th className={cn(PROD_TH_CLASS, "w-[14%]")}>Internal name</th>
              <th className={cn(PROD_TH_CLASS, "w-[7%]")} />
            </tr>
          </thead>
          <tbody className={TBODY_CLASS}>
            {upcoming.map((m) => (
              <MissingRow
                key={m.product_code}
                m={m}
                row={rows[m.product_code]}
                picked={picked.has(m.product_code)}
                groups={groups}
                bookingTypes={bookingTypes}
                groupName={groupName}
                onPick={(on) =>
                  setPicked((set) => {
                    const next = new Set(set);
                    if (on) next.add(m.product_code);
                    else next.delete(m.product_code);
                    return next;
                  })
                }
                onChange={(patch) => update(m.product_code, patch)}
                onAdd={() => void addOne(m)}
              />
            ))}
            {past.length ? (
              <tr className={TR_CLASS}>
                <td colSpan={8} className={cn(GROUP_ROW_TD_CLASS, "p-0")}>
                  <button
                    type="button"
                    aria-expanded={showPast}
                    onClick={() => setShowPast((v) => !v)}
                    className="w-full cursor-pointer px-3 py-[7px] text-left font-semibold"
                  >
                    {showPast ? "▾" : "▸"} {past.length} more with no upcoming
                    orders{" "}
                    <span className={GROUP_COUNT_CLASS}>
                      seasonal products come back — classifying them now means
                      they are ready next time
                    </span>
                  </button>
                </td>
              </tr>
            ) : null}
            {showPast
              ? past.map((m) => (
                  <MissingRow
                    key={m.product_code}
                    m={m}
                    row={rows[m.product_code]}
                    picked={picked.has(m.product_code)}
                    groups={groups}
                    bookingTypes={bookingTypes}
                    groupName={groupName}
                    onPick={(on) =>
                      setPicked((set) => {
                        const next = new Set(set);
                        if (on) next.add(m.product_code);
                        else next.delete(m.product_code);
                        return next;
                      })
                    }
                    onChange={(patch) => update(m.product_code, patch)}
                    onAdd={() => void addOne(m)}
                  />
                ))
              : null}
          </tbody>
        </table>
      </div>

      {confirming ? (
        <ConfirmDialog
          title={`Add ${picked.size} product(s)?`}
          confirmLabel="Add"
          busyLabel="Adding…"
          onConfirm={async () => {
            const result = await addPicked();
            setConfirming(false);
            return result;
          }}
          onClose={() => setConfirming(false)}
        >
          <p>
            {bulkGroup === KEEP && bulkType === KEEP
              ? "With the group and category picked on each row."
              : `With group ${
                  bulkGroup === KEEP
                    ? "as picked on each row"
                    : bulkGroup
                      ? groupName(bulkGroup)
                      : "none"
                } and category ${
                  bulkType === KEEP
                    ? "as picked on each row"
                    : bulkType
                      ? typeLabel(bulkType)
                      : "blank (falls back)"
                }.`}
          </p>
          <p>Category decides which reports they count in.</p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

function MissingRow({
  m,
  row,
  picked,
  groups,
  bookingTypes,
  groupName,
  onPick,
  onChange,
  onAdd,
}: {
  m: MissingProduct;
  row: RowState;
  picked: boolean;
  groups: ProductGroup[];
  bookingTypes: string[];
  groupName: (id: string) => string;
  onPick: (on: boolean) => void;
  onChange: (patch: Partial<RowState>) => void;
  onAdd: () => void;
}) {
  const added = row.status === "added";
  const adding = row.status === "adding";
  return (
    <tr
      className={cn(
        TR_CLASS,
        // 加好的行原地变绿（tr.added td），不消失，免得下面的行往上挪。
        added && "bg-[#f4fdf6] text-[#166534]",
      )}
    >
      <td className={PICK_TD_CLASS}>
        <input
          type="checkbox"
          aria-label={`Select ${m.product_code}`}
          checked={picked}
          disabled={added || adding}
          onChange={(event) => onPick(event.target.checked)}
          className="m-0 cursor-pointer align-middle"
        />
      </td>
      <td className={cn(PROD_TD_CLASS, CODE_CELL_CLASS)}>{m.product_code}</td>
      <td
        className={cn(
          PROD_TD_CLASS,
          REZDY_NAME_CLASS,
          "[overflow-wrap:anywhere]",
        )}
      >
        {m.product_name || <i className="text-[#ccc]">(no name)</i>}
        {row.error ? (
          <p role="alert" className="mt-[3px] text-[11px] text-[#A32D2D]">
            Not added: {row.error}
          </p>
        ) : null}
      </td>
      <td className={cn(PROD_TD_CLASS, "whitespace-nowrap")}>
        {m.upcoming_rows ? (
          <b>{m.upcoming_rows}</b>
        ) : (
          <span className="text-[12px] text-[#aaa]">{m.total_rows} past</span>
        )}
        <div className="text-[11px] text-[#aaa]">{missingDates(m)}</div>
      </td>
      <td className={PROD_TD_CLASS}>
        {added ? (
          groupName(row.groupId) || "No group"
        ) : (
          <select
            aria-label={`Group for ${m.product_code}`}
            value={row.groupId}
            disabled={adding}
            onChange={(event) => onChange({ groupId: event.target.value })}
            className={CELL_SELECT}
          >
            <option value="">— no group —</option>
            {groups.map((g) => (
              <option key={g.id} value={String(g.id)}>
                {groupLabel(g)}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className={PROD_TD_CLASS}>
        {added ? (
          typeLabel(row.type) || "Blank"
        ) : (
          <select
            aria-label={`Category for ${m.product_code}`}
            value={row.type}
            disabled={adding}
            onChange={(event) => onChange({ type: event.target.value })}
            className={CELL_SELECT}
          >
            <option value="">— blank (falls back) —</option>
            {bookingTypes.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className={PROD_TD_CLASS}>
        {added ? (
          row.internal || "—"
        ) : (
          <input
            type="text"
            aria-label={`Internal name for ${m.product_code}`}
            value={row.internal}
            maxLength={100}
            placeholder="optional"
            disabled={adding}
            onChange={(event) => onChange({ internal: event.target.value })}
            className={CELL_SELECT}
          />
        )}
      </td>
      <td className={cn(PROD_TD_CLASS, "whitespace-nowrap")}>
        {added ? (
          <span className="font-semibold whitespace-nowrap">Added ✓</span>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            disabled={adding}
            className={PROD_BTN_ADD_CLASS}
          >
            {adding ? "Adding…" : "Add"}
          </button>
        )}
      </td>
    </tr>
  );
}
