"use client";

import { useState } from "react";

import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";
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
    <Modal
      titleId="lunch-title"
      onDismiss={saving ? undefined : onClose}
      panelClassName="max-w-sm"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex flex-col gap-3 p-5 text-sm"
      >
        <div>
          <h2
            id="lunch-title"
            className="text-base font-semibold text-stone-900"
          >
            Edit Lunch Selection
          </h2>
          <p className="text-xs text-stone-500">
            {row.first_name || row.guest_name} (Party: {row.quantities ?? "—"})
            · {row.order_number}
          </p>
        </div>
        {fields.map(([label, value, set]) => (
          <label
            key={label}
            className="flex items-center justify-between gap-3"
          >
            {label}
            <input
              type="number"
              min={0}
              value={value}
              onChange={(e) => set(e.target.value)}
              className="w-24 rounded-md border border-stone-300 px-2 py-1 text-right tabular-nums"
            />
          </label>
        ))}
        {error ? (
          <p role="alert" className="text-xs text-[#A32D2D]">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className={PRIMARY_BUTTON_CLASS}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
