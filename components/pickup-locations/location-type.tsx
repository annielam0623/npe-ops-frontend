"use client";

import { cn } from "@/lib/utils";

/**
 * 类别两个勾（preview v3 Q5 A：可以都勾，同一条记录在两块都出现）。只看这两个勾分块，不按名字猜。
 */
export function TypeChecks({
  tourBus,
  shuttle,
  disabled,
  onChange,
  idPrefix,
  compact = false,
}: {
  tourBus: boolean;
  shuttle: boolean;
  disabled?: boolean;
  onChange: (next: { is_tour_bus: boolean; is_shuttle: boolean }) => void;
  idPrefix: string;
  /** 表格行里：小字、一行。 */
  compact?: boolean;
}) {
  const label = cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap text-[#1a1a1a] night:text-white/80",
    compact ? "text-[11px]" : "text-[13px]",
  );
  return (
    <span
      data-type-checks
      className={cn(
        "flex flex-wrap items-center",
        compact ? "gap-x-3 gap-y-0.5" : "gap-x-[18px] gap-y-1",
      )}
    >
      <label className={label} htmlFor={`${idPrefix}-tour-bus`}>
        <input
          id={`${idPrefix}-tour-bus`}
          type="checkbox"
          checked={tourBus}
          disabled={disabled}
          onChange={(e) =>
            onChange({ is_tour_bus: e.target.checked, is_shuttle: shuttle })
          }
        />
        Tour bus pick-up
      </label>
      <label className={label} htmlFor={`${idPrefix}-shuttle`}>
        <input
          id={`${idPrefix}-shuttle`}
          type="checkbox"
          checked={shuttle}
          disabled={disabled}
          onChange={(e) =>
            onChange({ is_tour_bus: tourBus, is_shuttle: e.target.checked })
          }
        />
        Shuttle stop
      </label>
    </span>
  );
}

/** 「also Shuttle」/「also Tour bus」小标签：两种都是的点，两块都出现。 */
export function AlsoTag({ children }: { children: string }) {
  return (
    <span className="ml-1.5 inline-block rounded-[6px] bg-[#e0e7ff] px-1.5 align-[1px] text-[10.5px] font-semibold text-[#3730a3] night:bg-indigo-400/15 night:text-indigo-200">
      {children}
    </span>
  );
}
