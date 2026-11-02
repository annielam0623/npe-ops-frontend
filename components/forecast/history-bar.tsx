/**
 * 表格左上角（Annie 2026-11-01，preview v4 后「动手」）：‹ 往历史翻一天（今天左边多接一天过去的日子），› 少接一天；
 * 中间 Today 键 = 一下把今天放回第一列，下面写今天的日期。接满 7 天 / 没有更早的快照 ⇒ ‹ 变灰；已经从今天开始 ⇒ › 变灰。
 */
export function HistoryArrows({
  today,
  canBack,
  canForward,
  onBack,
  onForward,
  onToday,
  atToday,
}: {
  today: string;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onToday: () => void;
  atToday: boolean;
}) {
  const btn =
    "flex h-8 w-8 items-center justify-center rounded-md border pb-0.5 text-[26px] leading-none font-bold";
  const on = "cursor-pointer border-white/50 text-white hover:bg-white/15";
  const off = "cursor-not-allowed border-white/10 text-white/25";
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${today}T00:00:00Z`));
  return (
    <div
      data-history-arrows
      className="flex items-center justify-between gap-1"
    >
      <button
        type="button"
        data-history-older
        aria-label="Show an earlier day"
        title={canBack ? "Show an earlier day" : "No earlier day to show"}
        disabled={!canBack}
        onClick={onBack}
        className={`${btn} ${canBack ? on : off}`}
      >
        ‹
      </button>
      <button
        type="button"
        data-history-today
        onClick={onToday}
        disabled={atToday}
        title={atToday ? "Starting from today" : "Back to today"}
        className={`rounded-md border px-2 py-0.5 text-center leading-tight ${
          atToday
            ? "cursor-default border-transparent"
            : "cursor-pointer border-white/50 hover:bg-white/15"
        }`}
      >
        <div className="text-[12.5px] font-semibold text-white">Today</div>
        <div className="text-[9.5px] font-normal text-white/70">{label}</div>
      </button>
      <button
        type="button"
        data-history-newer
        aria-label="Show one day less"
        title={canForward ? "Show one day less" : "Starting from today"}
        disabled={!canForward}
        onClick={onForward}
        className={`${btn} ${canForward ? on : off}`}
      >
        ›
      </button>
    </div>
  );
}
