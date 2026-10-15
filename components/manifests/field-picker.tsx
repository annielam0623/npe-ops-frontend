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

  /** 「Column order」那一排正在拖的格、指着的格。 */
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const byKey = new Map(catalog.map((f) => [f.key, f]));
  const ordered = draft.filter((k) => inCatalog.has(k));

  /** 往右拖落在目标后面、往左拖落在目标前面（同表头拖动、Tracking 页）。 */
  function move(from: string, to: string) {
    if (from === to) return;
    setDraft((d) => {
      const forward = d.indexOf(from) < d.indexOf(to);
      const rest = d.filter((k) => k !== from);
      const at = rest.indexOf(to) + (forward ? 1 : 0);
      return [...rest.slice(0, at), from, ...rest.slice(at)];
    });
  }

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
      night
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 px-5 py-3.5 night:border-white/10">
        <div>
          <h2
            id={titleId}
            className="text-base font-semibold text-stone-900 night:text-white"
          >
            Columns — {tabLabel}
          </h2>
          <p className="text-xs text-[#1a1a1a] night:text-white/50">
            Saved to your account. Drag the boxes under Column order to put the
            columns in the order you want, then click Apply.
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

      {/* Annie 2026-10-14：勾了的列排成一排，拖格子换位置（Apply 才存）。 */}
      <div
        role="group"
        aria-label="Column order"
        className="border-b border-stone-200 bg-white px-5 py-3 night:border-white/10 night:bg-white/[.03]"
      >
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-[#1a1a1a] uppercase night:text-white/50">
          Column order{" "}
          <span className="font-normal tracking-normal normal-case">
            — drag a box left or right; ✕ unticks it
          </span>
        </h3>
        {ordered.length ? (
          <ol className="flex flex-wrap gap-1.5">
            {ordered.map((k, i) => {
              const target = dragKey !== null && overKey === k && dragKey !== k;
              const toRight =
                target && draft.indexOf(dragKey) < draft.indexOf(k);
              return (
                <li
                  key={k}
                  data-order-col={k}
                  draggable
                  title="Drag to move this column"
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", k);
                    setDragKey(k);
                  }}
                  onDragOver={(e) => {
                    if (dragKey === null) return;
                    e.preventDefault();
                    if (overKey !== k) setOverKey(k);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragKey !== null) move(dragKey, k);
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  onDragEnd={() => {
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  className={[
                    "inline-flex cursor-grab items-center gap-1.5 rounded-md border border-stone-300 bg-white py-1 pr-1 pl-2 text-xs text-stone-800 select-none night:border-white/15 night:bg-white/[.06] night:text-white/85",
                    dragKey === k ? "opacity-40" : "",
                    target
                      ? toRight
                        ? "shadow-[3px_0_0_#57534e]"
                        : "shadow-[-3px_0_0_#57534e]"
                      : "",
                  ].join(" ")}
                >
                  <span className="text-[#1a1a1a] tabular-nums night:text-white/40">
                    {i + 1}
                  </span>
                  <span>{byKey.get(k)?.label ?? k}</span>
                  <button
                    type="button"
                    aria-label={`Untick ${byKey.get(k)?.label ?? k}`}
                    onClick={() => toggle(k, false)}
                    className="rounded px-1 text-[#1a1a1a] hover:bg-stone-100 hover:text-stone-700 night:text-white/40 night:hover:bg-white/10 night:hover:text-white"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-xs text-[#1a1a1a] night:text-white/50">
            No columns ticked yet.
          </p>
        )}
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
                <h3 className="text-xs font-semibold tracking-wide text-[#1a1a1a] uppercase night:text-white/50">
                  {g.label}
                </h3>
                <span className="text-xs text-[#1a1a1a] tabular-nums night:text-white/40">
                  {on} / {all.length}
                </span>
                <button
                  type="button"
                  onClick={() => setGroup(shown, true)}
                  className="text-xs text-[#1a1a1a] underline-offset-2 hover:text-stone-800 hover:underline night:text-white/50 night:hover:text-white"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setGroup(shown, false)}
                  className="text-xs text-[#1a1a1a] underline-offset-2 hover:text-stone-800 hover:underline night:text-white/50 night:hover:text-white"
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
          <p className="text-[#1a1a1a] night:text-white/50">
            No field matches “{search.trim()}”.
          </p>
        ) : null}
        {kept.length ? (
          <p className="rounded-md bg-white px-3 py-2 text-xs text-[#1a1a1a] night:bg-white/[.04] night:text-white/50">
            {plural(kept.length, "saved column")} not available on this page
            today (questions asked on other days, or admin-only fields) — kept
            in your choice and shown again when they apply.
          </p>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="border-t border-red-200 bg-red-50 px-5 py-2 text-sm text-red-800 night:border-red-500/30 night:bg-red-500/10 night:text-red-200"
        >
          Could not save your columns: {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 px-5 py-3 night:border-white/10">
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
          <span className="text-xs text-[#1a1a1a] night:text-white/50">
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
