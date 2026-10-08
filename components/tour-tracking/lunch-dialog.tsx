"use client";

import { useState } from "react";

import { ModalShell } from "@/components/tracking-ui/modal-shell";
import { describeError, isStatus } from "@/lib/api-errors";
import { updateTourLunch } from "@/lib/tour-tracking-api";
import type { TourTrackingRow } from "@/types";

const toCount = (v: string) => Math.max(0, parseInt(v, 10) || 0);

/** Edit Lunch Selection（只有 YES 的单；没有牛肉的团不显示牛肉，同旧页面）。只写库，不发消息。 */
export function LunchDialog({
  row,
  hasBeef,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  row: TourTrackingRow;
  hasBeef: boolean;
  onClose: () => void;
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  const [turkey, setTurkey] = useState(String(row.lunch_turkey || 0));
  const [veggie, setVeggie] = useState(String(row.lunch_veggie || 0));
  const [beef, setBeef] = useState(String(row.lunch_beef || 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateTourLunch(row.id, {
        turkey: toCount(turkey),
        veggie: toCount(veggie),
        // 没有牛肉的团照旧页面送 0。
        beef: hasBeef ? toCount(beef) : 0,
      });
      onSaved();
      onClose();
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setError(`Not saved: ${describeError(e)}`);
      setSaving(false);
    }
  }

  const fields: [string, string, (v: string) => void][] = [
    ["🦃 Turkey", turkey, setTurkey],
    ["🥗 Veggie", veggie, setVeggie],
    ...(hasBeef
      ? [["🥩 Beef", beef, setBeef] as [string, string, (v: string) => void]]
      : []),
  ];

  return (
    <ModalShell
      titleId="lunch-title"
      onDismiss={saving ? undefined : onClose}
      panelClassName="w-[90%] max-w-[380px] min-w-[300px] rounded-[14px] bg-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.2)]"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex flex-col text-[14px] text-[#1f2d25]"
      >
        <div>
          <h2
            id="lunch-title"
            className="mb-1 text-[15px] font-bold text-[#1a3a2a]"
          >
            Edit Lunch Selection
          </h2>
          <p className="mb-4 text-[12px] text-[#6b7d72]">
            {row.first_name || row.guest_name} (Party: {row.quantities ?? "—"})
            · {row.order_number}
          </p>
        </div>
        {fields.map(([label, value, set]) => (
          <label
            key={label}
            className="mb-3 flex items-center justify-between text-[13px] text-[#555]"
          >
            {label}
            <input
              type="number"
              min={0}
              value={value}
              onChange={(e) => set(e.target.value)}
              className="w-[70px] rounded-md border border-[#d0e0d4] px-2 py-1.5 text-center text-[14px] font-semibold"
            />
          </label>
        ))}
        {error ? (
          <p role="alert" className="text-xs text-[#A32D2D]">
            {error}
          </p>
        ) : null}
        {/* 同旧页面 .modal-actions：Save 在左、Cancel 在右，各占一半。 */}
        <div className="mt-4 flex gap-2.5">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 cursor-pointer rounded-lg border-none bg-[linear-gradient(135deg,#2f5e46,#1a3a2a)] p-2.5 text-[14px] font-semibold text-white hover:bg-[linear-gradient(135deg,#286645,#162e20)] disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 cursor-pointer rounded-lg border border-[#d0e0d4] bg-[#f4f0e6] p-2.5 text-[14px] text-[#555] disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
