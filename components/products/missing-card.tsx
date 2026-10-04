"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import type { MissingProduct, ProductGroup } from "@/types";

import { groupLabel, missingDates, typeLabel } from "./config";

/** 一行的选择和结果。 */
interface RowState {
  groupId: string;
  type: string;
  internal: string;
  status: "idle" | "adding" | "added";
  error: string | null;
}

const KEEP = "__keep__";

const CELL_SELECT =
  "w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm disabled:opacity-60";

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
    <section className="overflow-hidden rounded-lg border border-orange-300 bg-orange-50/50">
      <div className="border-b border-orange-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-orange-900">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-stone-700">
          These product codes have appeared on orders but are not in the list
          below, so this table gives no category for them. Their orders fall
          back to whatever category was stored on the booking itself — which may
          or may not be right, and nothing warns anyone either way.
          <br />
          Pick a group and a category, then <b>Add</b>. The name comes from
          Rezdy and keeps updating on its own.
          <br />
          <span className="text-stone-500">
            Ones with upcoming departures come first. The rest ran in the past —
            worth adding anyway, because a seasonal product that comes back next
            year will already be classified.
          </span>
        </p>
      </div>

      {picked.size ? (
        <div className="flex flex-wrap items-center gap-2 bg-stone-900 px-4 py-2 text-sm text-white">
          <span>{picked.size} product(s) selected</span>
          <select
            aria-label="Group for selected"
            value={bulkGroup}
            onChange={(event) => setBulkGroup(event.target.value)}
            className="rounded-md bg-white px-2 py-1 text-stone-800"
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
            className="rounded-md bg-white px-2 py-1 text-stone-800"
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
            className="rounded-md bg-white px-3 py-1 font-semibold text-stone-900 hover:bg-stone-100"
          >
            Add selected
          </button>
          <button
            type="button"
            onClick={() => setPicked(new Set())}
            className="rounded-md border border-white/40 px-3 py-1 hover:bg-white/10"
          >
            Clear
          </button>
          <span className="text-xs text-white/60">
            Internal name is taken from each row.
          </span>
        </div>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="border-b border-orange-200 bg-white px-4 py-2 text-sm text-stone-800"
        >
          {notice}
        </p>
      ) : null}

      <div className="overflow-x-auto bg-white">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50 text-left text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
              <th className="w-8 px-3 py-2">
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
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Name (from Rezdy)</th>
              <th className="px-3 py-2">Upcoming</th>
              <th className="px-3 py-2">Group</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Internal name</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
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
              <tr className="border-b border-stone-100 bg-stone-50">
                <td colSpan={8} className="px-3 py-2">
                  <button
                    type="button"
                    aria-expanded={showPast}
                    onClick={() => setShowPast((v) => !v)}
                    className="text-sm text-stone-700 hover:text-stone-900"
                  >
                    {showPast ? "▾" : "▸"} {past.length} more with no upcoming
                    orders{" "}
                    <span className="text-xs text-stone-500">
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
        "border-b border-stone-100 align-top",
        added && "bg-emerald-50",
      )}
    >
      <td className="px-3 py-2">
        <input
          type="checkbox"
          aria-label={`Select ${m.product_code}`}
          checked={picked}
          disabled={added || adding}
          onChange={(event) => onPick(event.target.checked)}
        />
      </td>
      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
        {m.product_code}
      </td>
      <td className="px-3 py-2 [overflow-wrap:anywhere]">
        {m.product_name || <i className="text-stone-400">(no name)</i>}
        {row.error ? (
          <p role="alert" className="mt-1 text-xs text-red-700">
            Not added: {row.error}
          </p>
        ) : null}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {m.upcoming_rows ? (
          <b>{m.upcoming_rows}</b>
        ) : (
          <span className="text-stone-500">{m.total_rows} past</span>
        )}
        <div className="text-xs text-stone-500">{missingDates(m)}</div>
      </td>
      <td className="px-3 py-2">
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
      <td className="px-3 py-2">
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
      <td className="px-3 py-2">
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
      <td className="px-3 py-2 whitespace-nowrap">
        <button
          type="button"
          onClick={onAdd}
          disabled={added || adding}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-semibold",
            added
              ? "bg-emerald-600 text-white"
              : "bg-stone-800 text-white hover:bg-stone-700 disabled:opacity-60",
          )}
        >
          {added ? "Added ✓" : adding ? "Adding…" : "Add"}
        </button>
      </td>
    </tr>
  );
}
