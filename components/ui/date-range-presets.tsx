"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  isYmd,
  laToday,
  monthStartYmd,
  shiftYmd,
  weekStartYmd,
} from "@/lib/la-date";
import { cn } from "@/lib/utils";

export type RangePreset = "today" | "yesterday" | "week" | "month" | "custom";

/** 选中的范围：两端都是洛杉矶日期 YYYY-MM-DD，都含当天。 */
export interface DateRange {
  preset: RangePreset;
  from: string;
  to: string;
}

const PRESETS: { key: Exclude<RangePreset, "custom">; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
];

/** 按洛杉矶的今天算出预设范围（This Week 从周日起，同旧后台）。 */
export function presetRange(
  preset: Exclude<RangePreset, "custom">,
  today: string = laToday(),
): DateRange {
  switch (preset) {
    case "today":
      return { preset, from: today, to: today };
    case "yesterday": {
      const y = shiftYmd(today, -1);
      return { preset, from: y, to: y };
    }
    case "week":
      return { preset, from: weekStartYmd(today), to: today };
    case "month":
      return { preset, from: monthStartYmd(today), to: today };
  }
}

export function rangeLabel(range: DateRange): string {
  if (range.preset !== "custom") {
    return PRESETS.find((p) => p.key === range.preset)?.label ?? "";
  }
  return range.from === range.to ? range.from : `${range.from} – ${range.to}`;
}

/** 旧后台 .dr-option / .dr-option.selected。 */
const OPTION_CLASS =
  "block w-full cursor-pointer rounded-md px-3 py-2 text-left text-[13px]";

/**
 * 日期范围选择，样子照旧后台 Send Log / Order Log 的 .dr-wrap（Annie 2026-10-07：和旧版一模一样）：
 * 「📅 Today ▾」点开是 Today / Yesterday / This Week / This Month / Custom 的下拉层，
 * Custom 在层里填两端再点 Apply。两端都要填、开始不能晚于结束（后端只填一端或颠倒会报错或悄悄换口径，所以前端先拦）。
 */
export function DateRangePresets({
  value,
  onChange,
  max,
  disabled,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** 最晚能选到哪天（默认不限）。 */
  max?: string;
  /** 整组变灰（例如订单搜索时不按日期查）。仍可点：选了日期由外面决定怎么处理。 */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<{
    open: boolean;
    from: string;
    to: string;
  }>({ open: value.preset === "custom", from: value.from, to: value.to });
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 外面把范围换成了预设（例如页面上的 Reset）：收起 Custom 那一块。
  useEffect(() => {
    if (value.preset !== "custom") {
      setCustom((c) => (c.open ? { ...c, open: false } : c));
      setError(null);
    }
  }, [value.preset]);

  // 点下拉层外面就收起（同旧页面）。
  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  function applyCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const incomplete = Array.from(
      event.currentTarget.querySelectorAll<HTMLInputElement>(
        'input[type="date"]',
      ),
    ).some((input) => input.validity.badInput);
    if (incomplete || !isYmd(custom.from) || !isYmd(custom.to)) {
      setError("Fill in both dates.");
      return;
    }
    if (custom.from > custom.to) {
      setError("The start date is after the end date.");
      return;
    }
    setError(null);
    setOpen(false);
    onChange({ preset: "custom", from: custom.from, to: custom.to });
  }

  const customSelected = custom.open || value.preset === "custom";

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-[7px] border-[0.5px] px-3 text-[13px] whitespace-nowrap text-[#1a1a1a] select-none hover:border-black/35",
          open
            ? "border-[#1a1a1a] bg-[#fafaf8]"
            : "border-black/[.18] bg-white",
          disabled && "opacity-45",
        )}
      >
        <span aria-hidden>📅</span>
        <span data-range-label>{rangeLabel(value)}</span>
        <span aria-hidden className="text-[10px] text-[#aaa]">
          ▾
        </span>
      </button>
      <div
        className={cn(
          "absolute top-[calc(100%+4px)] left-0 z-[999] min-w-[220px] rounded-[10px] border-[0.5px] border-black/15 bg-white p-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.12)]",
          !open && "hidden",
        )}
      >
        <div role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={!customSelected && value.preset === p.key}
              onClick={() => {
                setCustom((c) => ({ ...c, open: false }));
                setError(null);
                setOpen(false);
                onChange(presetRange(p.key));
              }}
              className={cn(
                OPTION_CLASS,
                !customSelected && value.preset === p.key
                  ? "bg-[#1a1a1a] text-white"
                  : "text-[#333] hover:bg-[#f5f5f3]",
              )}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={customSelected}
            onClick={() => {
              setOpen(true);
              setCustom((c) => ({
                open: true,
                from: c.from || value.from,
                to: c.to || value.to,
              }));
            }}
            className={cn(
              OPTION_CLASS,
              customSelected
                ? "bg-[#1a1a1a] text-white"
                : "text-[#333] hover:bg-[#f5f5f3]",
            )}
          >
            Custom
          </button>
        </div>
        {custom.open ? (
          <form
            noValidate
            onSubmit={applyCustom}
            className="mt-1 border-t-[0.5px] border-black/[.08] px-1.5 pt-2 pb-1"
          >
            <span className="mb-1.5 block text-[11px] text-[#888]">
              Date range
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="From"
                value={custom.from}
                max={custom.to || max}
                onChange={(e) => setCustom({ ...custom, from: e.target.value })}
                className="h-7 w-full min-w-0 flex-1 cursor-pointer rounded-md border-[0.5px] border-black/15 bg-white px-2 text-[12px] text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-none"
              />
              <span aria-hidden className="text-[12px] text-[#aaa]">
                –
              </span>
              <input
                type="date"
                aria-label="To"
                value={custom.to}
                min={custom.from || undefined}
                max={max}
                onChange={(e) => setCustom({ ...custom, to: e.target.value })}
                className="h-7 w-full min-w-0 flex-1 cursor-pointer rounded-md border-[0.5px] border-black/15 bg-white px-2 text-[12px] text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="mt-2 h-7 w-full cursor-pointer rounded-md bg-[#1a1a1a] px-3 text-[12px] text-white hover:bg-[#333]"
            >
              Apply
            </button>
            {error ? (
              <span
                role="alert"
                className="mt-1.5 block text-[11px] text-[#A32D2D]"
              >
                {error}
              </span>
            ) : null}
          </form>
        ) : null}
      </div>
    </div>
  );
}
