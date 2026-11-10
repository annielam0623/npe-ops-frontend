"use client";

import { useEffect, useId, useState } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { describeError } from "@/lib/api-errors";
import type {
  MaxPerShiftDayParams,
  MaxPerShiftException,
  Rule,
} from "@/lib/schedule-engine";
import type { ScheduleShiftType } from "@/types";

import { shortDate } from "./rules";

/** 一条规则的例外里「只管这一天」的那几条（Schedule 标签这里只加 / 去单日的；日期段在 Rules 标签改）。 */
const isSingleDay = (x: MaxPerShiftException, date: string) =>
  x.from === date && (!x.to || x.to === date);

/** 这一天能用的 Max people 规则：第一条开着的（没有就不出这个入口）。 */
export function dayRuleTarget(rules: Rule[] | undefined): Rule | null {
  return (
    rules?.find((r) => r.enabled && r.type === "max_per_shift_day") ?? null
  );
}

/**
 * Schedule 标签点日期：这一天某个班允许 2 个人（置顶 110 续，Annie「4C」：和 Rules 标签同一份 exceptions，
 * 不是另一套）。选好按 Save 才存（全站规矩），存的是整份规则（PUT /api/schedule/rules）。
 * 日期段的例外这里只显示，去 Rules 标签改。
 */
export function DayRuleDialog({
  date,
  rules,
  shiftTypes,
  onSave,
  onClose,
}: {
  date: string;
  rules: Rule[];
  shiftTypes: ScheduleShiftType[];
  onSave: (next: Rule[]) => Promise<unknown>;
  onClose: () => void;
}) {
  const titleId = useId();
  const target = dayRuleTarget(rules)!;
  const p = target.params as unknown as MaxPerShiftDayParams;
  const label = (key: string) =>
    shiftTypes.find((t) => t.key === key)?.label ?? key;
  const singles = (p.exceptions ?? []).filter((x) => isSingleDay(x, date));
  const ranges = (p.exceptions ?? []).filter(
    (x) => !isSingleDay(x, date) && date >= x.from && date <= (x.to || x.from),
  );
  // 选项：规则只管某一种班 ⇒ 只能放宽那一种；管每种班 ⇒ 每种班各一项 + 每种班一起。
  const options: { key: string; text: string; shift?: string }[] = p.shift_type
    ? [
        {
          key: p.shift_type,
          text: `Allow 2 people on ${label(p.shift_type)} this day`,
          shift: p.shift_type,
        },
      ]
    : [
        ...shiftTypes
          .filter((t) => t.is_active)
          .map((t) => ({
            key: t.key,
            text: `Allow 2 people on ${t.label} this day`,
            shift: t.key,
          })),
        { key: "*", text: "Allow 2 people on every shift this day" },
      ];
  const current = singles.length
    ? singles.length === 1 && singles[0].max === 2
      ? (singles[0].shift_type ?? "*")
      : "custom"
    : "rule";
  const [pick, setPick] = useState<string>(
    current === "custom" ? "rule" : current,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function save() {
    setBusy(true);
    setError(null);
    const others = (p.exceptions ?? []).filter((x) => !isSingleDay(x, date));
    const add: MaxPerShiftException[] =
      pick === "rule"
        ? []
        : [
            pick === "*"
              ? { from: date, max: 2 }
              : { from: date, max: 2, shift_type: pick },
          ];
    const exceptions = [...others, ...add];
    const params: Record<string, unknown> = { ...target.params };
    if (exceptions.length) params.exceptions = exceptions;
    else delete params.exceptions;
    const next = rules.map((r) => (r === target ? { ...r, params } : r));
    try {
      await onSave(next);
      onClose();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  const day = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-day-rule-dialog={date}
        className="w-full max-w-[420px] rounded-xl border border-white/10 bg-[#0d1b2e] p-5 text-white/90 shadow-[0_8px_40px_rgba(0,0,0,.45)]"
      >
        <h2 id={titleId} className="mb-1 text-[16px] font-semibold text-white">
          Max people on {day}, {shortDate(date)}
        </h2>
        <p className="mb-3 text-[12.5px] text-white/60">
          The rule allows {p.max} {p.max === 1 ? "person" : "people"}
          {p.shift_type ? ` on ${label(p.shift_type)}` : " on every shift"}.
          This is the same list as Exceptions in the Rules tab.
        </p>
        <div className="flex flex-col gap-1.5" role="radiogroup">
          {[
            ...options,
            {
              key: "rule",
              text: `Back to the rule (at most ${p.max})`,
              shift: undefined,
            },
          ].map((o) => (
            <label
              key={o.key}
              className="flex cursor-pointer items-center gap-2 text-[13px]"
            >
              <input
                type="radio"
                name={`day-rule-${date}`}
                data-day-rule-option={o.key}
                checked={pick === o.key}
                onChange={() => setPick(o.key)}
              />
              {o.text}
            </label>
          ))}
        </div>
        {current === "custom" ? (
          <p className="mt-2 text-[12px] text-[#fcd34d]">
            This day has its own numbers in the Rules tab. Saving here replaces
            them.
          </p>
        ) : null}
        {ranges.length ? (
          <p data-day-rule-range className="mt-2 text-[12px] text-white/60">
            Also covered by{" "}
            {ranges
              .map(
                (x) =>
                  `${shortDate(x.from)} – ${shortDate(x.to || x.from)} (at most ${x.max})`,
              )
              .join(", ")}
            . Change it in the Rules tab.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-[12.5px] text-red-300">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={DARK_SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || pick === current}
            className={DARK_PRIMARY_BUTTON_CLASS}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
