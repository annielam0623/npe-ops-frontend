import type { FormEvent } from "react";

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

/**
 * 旧页面 .ps-controls：直接放在深色底上。名字旧版是 #555（深色底上几乎看不见），这里用旧后台的灰字 #94a3b8。
 */
const LABEL_CLASS = "flex items-center gap-2.5 text-[13px] text-[#94a3b8]";
/** .ps-controls input */
const INPUT_CLASS =
  "h-8 rounded-[7px] border-[0.5px] border-black/15 bg-white px-2.5 text-[13px] text-[#1a1a1a] focus:outline-none";
/** 旧后台 base.html 的 .btn（Apply / Clear 都是它，高 32px）。 */
const BTN_CLASS =
  "inline-flex h-8 cursor-pointer items-center justify-center rounded-[10px] border border-white/10 bg-white/[.04] px-3.5 text-[13px] font-[650] text-white transition hover:bg-white/[.08]";

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
    <form
      noValidate
      onSubmit={handleSubmit}
      className="mb-6 flex flex-wrap items-center gap-2.5"
    >
      {/* 名字和日期框同一行（From [日期] To [日期]），不再单独占一行。 */}
      <label className={LABEL_CLASS}>
        From
        <input
          type="date"
          value={value.from}
          max={value.to || undefined}
          onChange={(event) => onChange({ ...value, from: event.target.value })}
          className={INPUT_CLASS}
        />
      </label>
      <label className={LABEL_CLASS}>
        To
        <input
          type="date"
          value={value.to}
          min={value.from || undefined}
          onChange={(event) => onChange({ ...value, to: event.target.value })}
          className={INPUT_CLASS}
        />
      </label>
      <button type="submit" className={BTN_CLASS}>
        Apply
      </button>
      <button type="button" onClick={onClear} className={BTN_CLASS}>
        Clear
      </button>
      {error ? (
        <p role="alert" className="w-full text-[12px] text-[#fca5a5]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
