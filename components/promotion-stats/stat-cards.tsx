import { cn } from "@/lib/utils";
import type { PromotionDetailStatus, PromotionStatsSummary } from "@/types";

import { STAT_CARDS, type StatCardConfig } from "./config";

interface StatCardsProps {
  summary: PromotionStatsSummary | null;
  loading: boolean;
  activeFilter: PromotionDetailStatus;
  onSelectFilter: (filter: PromotionDetailStatus) => void;
}

export function StatCards({
  summary,
  loading,
  activeFilter,
  onSelectFilter,
}: StatCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {STAT_CARDS.map((card) => (
        <StatCard
          key={card.key}
          card={card}
          value={loading ? "…" : (summary?.[card.key] ?? "—")}
          active={card.filter !== undefined && card.filter === activeFilter}
          onSelectFilter={onSelectFilter}
        />
      ))}
    </div>
  );
}

function StatCard({
  card,
  value,
  active,
  onSelectFilter,
}: {
  card: StatCardConfig;
  value: number | string;
  active: boolean;
  onSelectFilter: (filter: PromotionDetailStatus) => void;
}) {
  const content = (
    <>
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 rounded-t-lg"
        style={{ backgroundColor: card.color }}
      />
      <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
        {card.label}
      </span>
      <span
        className="mt-2 text-2xl font-semibold tabular-nums"
        style={{ color: card.color }}
      >
        {typeof value === "number" ? value.toLocaleString("en-US") : value}
      </span>
    </>
  );

  const baseClass =
    "relative flex flex-col items-start rounded-lg border bg-white px-4 pt-4 pb-3 text-left";

  const { filter } = card;
  if (filter === undefined) {
    return <div className={cn(baseClass, "border-stone-200")}>{content}</div>;
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelectFilter(filter)}
      className={cn(
        baseClass,
        "cursor-pointer transition focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:outline-none",
        active
          ? "border-black shadow-[0_4px_14px_rgba(0,0,0,0.18)]"
          : "border-stone-200 hover:border-stone-400 hover:shadow-sm",
      )}
    >
      {content}
    </button>
  );
}
