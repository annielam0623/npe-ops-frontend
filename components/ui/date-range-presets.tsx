"use client";

import { type FormEvent, useEffect, useState } from "react";

import {
  isYmd,
  laToday,
  monthStartYmd,
  shiftYmd,
  weekStartYmd,
} from "@/lib/la-date";
import {
  FILTER_INPUT_CLASS,
  FILTER_PRIMARY_BUTTON_CLASS,
  Segmented,
} from "@/components/ui/filter-bar";

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

/**
 * Today / Yesterday / This Week / This Month / Custom（连成一组的紧凑按钮）。Custom 两端都要填、开始不能晚于结束，
 * 点 Apply 才生效（后端只填一端或颠倒会报错或悄悄换口径，所以前端先拦）。
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
  const [custom, setCustom] = useState<{
    open: boolean;
    from: string;
    to: string;
  }>({ open: value.preset === "custom", from: value.from, to: value.to });
  const [error, setError] = useState<string | null>(null);

  // 外面把范围换成了预设（例如页面上的 Reset）：收起 Custom 那一行。
  useEffect(() => {
    if (value.preset !== "custom") {
      setCustom((c) => (c.open ? { ...c, open: false } : c));
      setError(null);
    }
  }, [value.preset]);

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
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label="Date range"
        disabled={disabled}
        value={value.preset}
        options={[
          ...PRESETS.map((p) => ({ value: p.key, label: p.label })),
          {
            value: "custom" as const,
            label: value.preset === "custom" ? rangeLabel(value) : "Custom",
          },
        ]}
        onChange={(key) => {
          if (key === "custom") {
            setCustom((c) => ({
              open: !c.open,
              from: c.from || value.from,
              to: c.to || value.to,
            }));
            return;
          }
          setCustom((c) => ({ ...c, open: false }));
          setError(null);
          onChange(presetRange(key));
        }}
      />
      {custom.open ? (
        <form
          noValidate
          onSubmit={applyCustom}
          className="flex flex-wrap items-center gap-1.5"
        >
          <input
            type="date"
            aria-label="From"
            value={custom.from}
            max={custom.to || max}
            onChange={(e) => setCustom({ ...custom, from: e.target.value })}
            className={FILTER_INPUT_CLASS}
          />
          <span aria-hidden className="text-xs text-stone-400">
            –
          </span>
          <input
            type="date"
            aria-label="To"
            value={custom.to}
            min={custom.from || undefined}
            max={max}
            onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            className={FILTER_INPUT_CLASS}
          />
          <button type="submit" className={FILTER_PRIMARY_BUTTON_CLASS}>
            Apply
          </button>
          {error ? (
            <span role="alert" className="text-xs text-[#A32D2D]">
              {error}
            </span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
