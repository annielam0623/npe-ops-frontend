import type { FormEvent } from "react";

import {
  FILTER_BAR_CLASS,
  FILTER_INPUT_CLASS,
  FILTER_PRIMARY_BUTTON_CLASS,
  FILTER_TEXT_BUTTON_CLASS,
} from "@/components/ui/filter-bar";

export interface DateRangeValue {
  from: string;
  to: string;
}

interface DateRangeFilterProps {
  value: DateRangeValue;
  error: string | null;
  onChange: (value: DateRangeValue) => void;
  /** hasIncompleteInput：日期框里有未填完整的日期，此时 value 对应项为空字符串。 */
  onApply: (hasIncompleteInput: boolean) => void;
  onClear: () => void;
}

const LABEL_CLASS = "flex items-center gap-1.5 text-xs text-stone-400";

export function DateRangeFilter({
  value,
  error,
  onChange,
  onApply,
  onClear,
}: DateRangeFilterProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hasIncompleteInput = Array.from(
      event.currentTarget.querySelectorAll<HTMLInputElement>(
        'input[type="date"]',
      ),
    ).some((input) => input.validity.badInput);
    onApply(hasIncompleteInput);
  }

  return (
    <form noValidate onSubmit={handleSubmit} className={FILTER_BAR_CLASS}>
      {/* 名字和日期框同一行（From [日期] To [日期]），不再单独占一行。 */}
      <label className={LABEL_CLASS}>
        From
        <input
          type="date"
          value={value.from}
          max={value.to || undefined}
          onChange={(event) => onChange({ ...value, from: event.target.value })}
          className={FILTER_INPUT_CLASS}
        />
      </label>
      <label className={LABEL_CLASS}>
        To
        <input
          type="date"
          value={value.to}
          min={value.from || undefined}
          onChange={(event) => onChange({ ...value, to: event.target.value })}
          className={FILTER_INPUT_CLASS}
        />
      </label>
      <button type="submit" className={FILTER_PRIMARY_BUTTON_CLASS}>
        Apply
      </button>
      <button
        type="button"
        onClick={onClear}
        className={FILTER_TEXT_BUTTON_CLASS}
      >
        Clear
      </button>
      {error ? <p className="w-full text-xs text-[#A32D2D]">{error}</p> : null}
    </form>
  );
}
