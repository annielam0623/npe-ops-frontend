"use client";

import { useState } from "react";

import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { FilterSearch } from "@/components/ui/filter-bar";
import { Modal } from "@/components/ui/modal";
import type { ManifestField, ManifestFieldGroup } from "@/types";

import { plural } from "./config";

/**
 * 字段勾选弹窗（Annie 2026-10-06 定：弹窗勾选，不用下拉）。按后端给的 groups 分组，内容是 catalog
 * （staff 拿到的本来就没有金额组，这里不判断角色）。勾的顺序就是列的顺序，新勾的排在最后。
 * 存着、但今天这页没有的键（别的日子才有的问卷题、没权限的金额列）原样留着，不从选择里删。
 */
export function FieldPicker({
  tabLabel,
  catalog,
  groups,
  selected,
  defaults,
  onApply,
  onClose,
}: {
  tabLabel: string;
  catalog: ManifestField[];
  groups: ManifestFieldGroup[];
  /** 现在用的列（没存过时是后端默认列）。 */
  selected: readonly string[];
  defaults: readonly string[];
  /** null = 恢复后端默认列。失败时 reject，弹窗留着并显示原因。 */
  onApply: (fields: string[] | null) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string[]>([...selected]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const inCatalog = new Set(catalog.map((f) => f.key));
  const picked = new Set(draft);
  const kept = draft.filter((k) => !inCatalog.has(k));
  const pickedHere = draft.length - kept.length;
  const needle = search.trim().toLowerCase();
  const matches = (f: ManifestField) =>
    !needle ||
    f.label.toLowerCase().includes(needle) ||
    f.key.toLowerCase().includes(needle);

  // 后端的组顺序在前；目录里出现了 groups 没列的组，排在最后、用组键当名字。
  const groupOrder = [
    ...groups,
    ...[...new Set(catalog.map((f) => f.group))]
      .filter((g) => !groups.some((x) => x.key === g))
      .map((g) => ({ key: g, label: g })),
  ];

  function toggle(key: string, on: boolean) {
    setDraft((d) => (on ? [...d, key] : d.filter((k) => k !== key)));
  }

  function setGroup(fields: ManifestField[], on: boolean) {
    setDraft((d) => {
      if (!on) {
        const drop = new Set(fields.map((f) => f.key));
        return d.filter((k) => !drop.has(k));
      }
      const have = new Set(d);
      return [...d, ...fields.map((f) => f.key).filter((k) => !have.has(k))];
    });
  }

  async function apply(fields: string[] | null) {
    setBusy(true);
    setError("");
    try {
      await onApply(fields);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const titleId = "manifest-field-picker-title";
  return (
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      panelClassName="flex max-h-[88vh] max-w-3xl flex-col overflow-hidden"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 px-5 py-3.5">
        <div>
          <h2 id={titleId} className="text-base font-semibold text-stone-900">
            Columns — {tabLabel}
          </h2>
          <p className="text-xs text-stone-500">
            Saved to your account. Columns show in the order you tick them.
          </p>
        </div>
        <FilterSearch
          value={search}
          onChange={setSearch}
          placeholder="Find a field…"
          label="Find a field"
          className="w-52"
        />
      </div>

      <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4 text-sm">
        {groupOrder.map((g) => {
          const all = catalog.filter((f) => f.group === g.key);
          const shown = all.filter(matches);
          if (!shown.length) return null;
          const on = all.filter((f) => picked.has(f.key)).length;
          return (
            <section key={g.key} aria-label={g.label}>
              <div className="mb-2 flex items-baseline gap-3">
                <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                  {g.label}
                </h3>
                <span className="text-xs text-stone-400 tabular-nums">
                  {on} / {all.length}
                </span>
                <button
                  type="button"
                  onClick={() => setGroup(shown, true)}
                  className="text-xs text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setGroup(shown, false)}
                  className="text-xs text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline"
                >
                  None
                </button>
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 md:grid-cols-3">
                {shown.map((f) => (
                  <label key={f.key} className="inline-flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={picked.has(f.key)}
                      onChange={(event) => toggle(f.key, event.target.checked)}
                    />
                    <span className="[overflow-wrap:anywhere]">{f.label}</span>
                  </label>
                ))}
              </div>
            </section>
          );
        })}
        {needle && !catalog.some(matches) ? (
          <p className="text-stone-500">No field matches “{search.trim()}”.</p>
        ) : null}
        {kept.length ? (
          <p className="rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-500">
            {plural(kept.length, "saved column")} not available on this page
            today (questions asked on other days, or admin-only fields) — kept
            in your choice and shown again when they apply.
          </p>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="border-t border-red-200 bg-red-50 px-5 py-2 text-sm text-red-800"
        >
          Could not save your columns: {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 px-5 py-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void apply(null)}
          title={`Back to the default ${defaults.length} columns`}
          className={SECONDARY_BUTTON_CLASS}
        >
          Reset to default
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-500">
            {plural(pickedHere, "column")} ticked
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || pickedHere === 0}
            onClick={() => void apply(draft)}
            className={PRIMARY_BUTTON_CLASS}
          >
            {busy ? "Saving…" : "Apply"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
