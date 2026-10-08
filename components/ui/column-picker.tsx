"use client";

import { useEffect, useRef, useState } from "react";

/** 列设置里 ☰ Columns 管的两样：隐藏的页面列、要显示的上传名单列。 */
export interface ColumnVisibility<K extends string> {
  hide: K[];
  file: string[];
}

/**
 * ☰ Columns：勾掉页面列隐藏它；勾上传名单里的列显示在最右。改了立刻生效。
 * 门票、Tour 两个 tracking 页共用；页面列和「Reset to default」由页面给。
 * 样子照旧页面的 .colpick-menu（Annie 2026-10-07：和旧版一模一样）：按钮下面弹出的白色小菜单，
 * 点菜单外面或按 Esc 收起。按钮的样子由页面给（两页的按钮不一样）。
 */
export function ColumnPicker<K extends string, P extends ColumnVisibility<K>>({
  columns,
  prefs,
  headers,
  note = "Saved in this browser only.",
  onChange,
  onReset,
  buttonClassName,
  menuTop = 34,
}: {
  columns: readonly { key: K; label: string }[];
  prefs: P;
  /** 这天上传名单里有的表头。 */
  headers: string[];
  note?: string;
  onChange: (prefs: P) => void;
  onReset: () => void;
  buttonClassName: string;
  /** 菜单离按钮顶边多远（旧页面 tour 34px、门票 36px）。 */
  menuTop?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointer(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
  const footButton =
    "cursor-pointer border-none bg-none p-0 text-[12px] text-[#185FA5]";
  return (
    <span ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={buttonClassName}
      >
        ☰ Columns
      </button>
      {open ? (
        <div
          role="dialog"
          aria-labelledby={titleId}
          style={{ top: menuTop }}
          className="absolute left-0 z-[60] max-h-[60vh] w-[280px] overflow-y-auto rounded-[10px] bg-white px-3.5 py-2.5 text-left text-[12px] font-normal text-[#333] shadow-[0_8px_28px_rgba(0,0,0,.25)]"
        >
          <div
            id={titleId}
            className="mt-2 mb-1 text-[11px] tracking-[.05em] text-[#999] uppercase"
          >
            Page columns
          </div>
          {columns.map((c) => (
            <label
              key={c.key}
              className="flex cursor-pointer items-center gap-1.5 py-0.5"
            >
              <input
                type="checkbox"
                checked={!prefs.hide.includes(c.key)}
                onChange={(event) => toggleSystem(c.key, event.target.checked)}
              />
              {c.label}
            </label>
          ))}
          <div className="mt-2 mb-1 text-[11px] tracking-[.05em] text-[#999] uppercase">
            From the uploaded file
          </div>
          {headers.length ? (
            headers.map((h) => (
              <label
                key={h}
                className="flex cursor-pointer items-center gap-1.5 py-0.5"
              >
                <input
                  type="checkbox"
                  checked={prefs.file.includes(h)}
                  onChange={(event) => toggleFile(h, event.target.checked)}
                />
                <span className="[overflow-wrap:anywhere]">{h}</span>
              </label>
            ))
          ) : (
            <div className="py-0.5 text-[11.5px] text-[#aaa]">
              No uploaded file columns for this date.
            </div>
          )}
          <div className="mt-2 flex justify-between border-t border-black/[.08] pt-2">
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...prefs,
                  hide: [],
                  file: [...new Set([...prefs.file, ...headers])],
                })
              }
              className={footButton}
            >
              Show all
            </button>
            <button type="button" onClick={onReset} className={footButton}>
              Reset to default
            </button>
            {/* ops 才有：收起菜单（旧页面只能点外面收起）。 */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={footButton}
            >
              Done
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-[#aaa]">{note}</p>
        </div>
      ) : null}
    </span>
  );
}
