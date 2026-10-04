"use client";

import { type FormEvent, useState } from "react";

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

const INPUT_CLASS =
  "rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-800 focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none";

/**
 * Today / Yesterday / This Week / This Month / Custom。Custom 两端都要填、开始不能晚于结束，
 * 点 Apply 才生效（后端只填一端或颠倒会报错或悄悄换口径，所以前端先拦）。
 */
export function DateRangePresets({
  value,
  onChange,
  max,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** 最晚能选到哪天（默认不限）。 */
  max?: string;
}) {
  const [custom, setCustom] = useState<{
    open: boolean;
    from: string;
    to: string;
  }>({ open: value.preset === "custom", from: value.from, to: value.to });
  const [error, setError] = useState<string | null>(null);

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
    onChange({ preset: "custom", from: custom.from, to: custom.to });
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="Date range"
        className="flex flex-wrap gap-1.5"
      >
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={value.preset === p.key}
            onClick={() => {
              setCustom((c) => ({ ...c, open: false }));
              setError(null);
              onChange(presetRange(p.key));
            }}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm font-medium",
              value.preset === p.key
                ? "border-stone-800 bg-stone-800 text-white"
                : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={value.preset === "custom"}
          aria-expanded={custom.open}
          onClick={() =>
            setCustom((c) => ({
              open: !c.open,
              from: c.from || value.from,
              to: c.to || value.to,
            }))
          }
          className={cn(
            "rounded-md border px-3 py-1.5 text-sm font-medium",
            value.preset === "custom"
              ? "border-stone-800 bg-stone-800 text-white"
              : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50",
          )}
        >
          {value.preset === "custom" ? rangeLabel(value) : "Custom"}
        </button>
      </div>
      {custom.open ? (
        <form
          noValidate
          onSubmit={applyCustom}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
            From
            <input
              type="date"
              value={custom.from}
              max={custom.to || max}
              onChange={(e) => setCustom({ ...custom, from: e.target.value })}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
            To
            <input
              type="date"
              value={custom.to}
              min={custom.from || undefined}
              max={max}
              onChange={(e) => setCustom({ ...custom, to: e.target.value })}
              className={INPUT_CLASS}
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-stone-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
          >
            Apply
          </button>
          {error ? (
            <span role="alert" className="self-center text-sm text-[#A32D2D]">
              {error}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
