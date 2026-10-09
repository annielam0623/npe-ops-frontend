import type { ForecastVehicleTier } from "@/types";

import { tierSwatch } from "./config";

/** 车型上色图例，完全照接口给的 vehicle_tiers 顺序和文字生成，不写死具体档位。 */
export function Legend({ tiers }: { tiers: ForecastVehicleTier[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-white/60">
      {tiers.map((tier, i) => {
        const swatch = tierSwatch(tier.color);
        const prevMax = i > 0 ? tiers[i - 1].max : null;
        const label =
          tier.max !== null
            ? `${tier.vehicle} (≤ ${tier.max})`
            : prevMax !== null
              ? `${tier.vehicle} (> ${prevMax})`
              : tier.vehicle;
        return (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-sm border"
              style={{
                backgroundColor: swatch.bg,
                borderColor: swatch.border,
              }}
            />
            {label}
          </span>
        );
      })}
    </div>
  );
}
