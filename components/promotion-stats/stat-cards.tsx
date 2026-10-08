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
    <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
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
      <span className="mb-1.5 text-[12px] text-[#999]">{card.label}</span>
      <span
        className="text-[26px] font-medium tabular-nums"
        style={{ color: card.color }}
      >
        {typeof value === "number" ? value.toLocaleString("en-US") : value}
      </span>
    </>
  );

  /** 旧页面 .stat-box */
  const baseClass =
    "flex flex-col items-start rounded-[10px] border-[0.5px] bg-white px-4 py-3.5 text-left transition-colors duration-150";

  const { filter } = card;
  if (filter === undefined) {
    return (
      <div className={cn(baseClass, "cursor-pointer border-black/10")}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelectFilter(filter)}
      className={cn(
        baseClass,
        "cursor-pointer focus-visible:outline-none",
        active
          ? "border-[#1a1a1a] shadow-[0_0_0_1px_#1a1a1a]"
          : "border-black/10 hover:border-black/25",
      )}
    >
      {content}
    </button>
  );
}
