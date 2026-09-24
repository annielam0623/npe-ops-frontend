import type { FormEvent } from "react";

export interface DateRangeValue {
  from: string;
  to: string;
}

interface DateRangeFilterProps {
  value: DateRangeValue;
  error: string | null;
  onChange: (value: DateRangeValue) => void;
  onApply: () => void;
  onClear: () => void;
}

const INPUT_CLASS =
  "rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-800 focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none";

export function DateRangeFilter({
  value,
  error,
  onChange,
  onApply,
  onClear,
}: DateRangeFilterProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
          From
          <input
            type="date"
            value={value.from}
            max={value.to || undefined}
            onChange={(event) =>
              onChange({ ...value, from: event.target.value })
            }
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-500">
          To
          <input
            type="date"
            value={value.to}
            min={value.from || undefined}
            onChange={(event) => onChange({ ...value, to: event.target.value })}
            className={INPUT_CLASS}
          />
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-md bg-stone-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-stone-300 bg-white px-4 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Clear
          </button>
        </div>
      </div>
      {error ? <p className="text-sm text-[#A32D2D]">{error}</p> : null}
    </form>
  );
}
