"use client";

import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./buttons";
import { Modal } from "./modal";

/** 列设置里 ☰ Columns 管的两样：隐藏的页面列、要显示的上传名单列。 */
export interface ColumnVisibility<K extends string> {
  hide: K[];
  file: string[];
}

/**
 * ☰ Columns：勾掉页面列隐藏它；勾上传名单里的列显示在最右。改了立刻生效。
 * 门票、Tour 两个 tracking 页共用；页面列和「Reset to default」由页面给。
 */
export function ColumnPicker<K extends string, P extends ColumnVisibility<K>>({
  columns,
  prefs,
  headers,
  note = "Saved in this browser only.",
  onChange,
  onReset,
  onClose,
}: {
  columns: readonly { key: K; label: string }[];
  prefs: P;
  /** 这天上传名单里有的表头。 */
  headers: string[];
  note?: string;
  onChange: (prefs: P) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  function toggleSystem(key: K, show: boolean) {
    onChange({
      ...prefs,
      hide: show ? prefs.hide.filter((k) => k !== key) : [...prefs.hide, key],
    });
  }

  function toggleFile(header: string, show: boolean) {
    onChange({
      ...prefs,
      file: show
        ? [...prefs.file, header]
        : prefs.file.filter((h) => h !== header),
    });
  }

  const titleId = "column-picker-title";
  return (
    <Modal
      titleId={titleId}
      onDismiss={onClose}
      panelClassName="flex max-h-[85vh] max-w-lg flex-col overflow-hidden"
    >
      <div className="border-b border-stone-200 px-5 py-3.5">
        <h2 id={titleId} className="text-base font-semibold text-stone-900">
          Columns
        </h2>
        <p className="text-xs text-stone-500">{note}</p>
      </div>
      <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4 text-sm">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
            Page columns
          </h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {columns.map((c) => (
              <label key={c.key} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!prefs.hide.includes(c.key)}
                  onChange={(event) =>
                    toggleSystem(c.key, event.target.checked)
                  }
                />
                {c.label}
              </label>
            ))}
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
            From the uploaded file
          </h3>
          {headers.length ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {headers.map((h) => (
                <label key={h} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={prefs.file.includes(h)}
                    onChange={(event) => toggleFile(h, event.target.checked)}
                  />
                  <span className="[overflow-wrap:anywhere]">{h}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-stone-500">
              No uploaded file columns for this date.
            </p>
          )}
        </section>
      </div>
      <div className="flex justify-between gap-2 border-t border-stone-200 px-5 py-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              onChange({
                ...prefs,
                hide: [],
                file: [...new Set([...prefs.file, ...headers])],
              })
            }
            className={SECONDARY_BUTTON_CLASS}
          >
            Show all
          </button>
          <button
            type="button"
            onClick={onReset}
            className={SECONDARY_BUTTON_CLASS}
          >
            Reset to default
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={PRIMARY_BUTTON_CLASS}
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
