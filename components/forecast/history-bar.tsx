import { formatLongDate } from "./config";

/** 快照存的时间，洛杉矶时间，例 "Oct 30, 11:55 PM PT"。 */
function formatTakenAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d)} PT`;
}

/** 回看日期选择：第一项是今天（实时），其余是存过快照的日子（新的在前）。 */
export function HistoryPicker({
  dates,
  value,
  onChange,
  compact = false,
}: {
  dates: string[];
  value: string | null;
  onChange: (date: string | null) => void;
  compact?: boolean;
}) {
  return (
    <label
      data-history-picker
      className="inline-flex items-center gap-2 text-sm text-white"
    >
      <span className={compact ? "" : "font-semibold"}>
        {compact ? "History" : "View saved forecast"}
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded-md border border-white/25 bg-[#0b1a2c] px-2 py-1 text-[13px] text-white"
      >
        <option value="">Today (live)</option>
        {dates.map((d) => (
          <option key={d} value={d}>
            {formatLongDate(d)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * 表格左上角（PREVIEW v3，Annie 2026-11-01）：‹ 往历史翻一天（左边多接一天过去的日子），› 往回收一天；
 * 中间 Today 键 = 一下回到「从今天开始」，下面写今天的日期。没有更早的快照 / 已经从今天开始 ⇒ 箭头变灰。
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
  const label = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" }).format(new Date(today + "T00:00:00Z"));
  return (
    <div data-history-arrows className="flex items-center justify-between gap-1">
      <button type="button" data-history-older aria-label="Show an earlier day" title={canBack ? "Show an earlier day" : "No earlier saved forecast"} disabled={!canBack} onClick={onBack} className={`${btn} ${canBack ? on : off}`}>‹</button>
      <button
        type="button"
        data-history-today
        onClick={onToday}
        disabled={atToday}
        title={atToday ? "Starting from today" : "Back to today"}
        className={`rounded-md border px-2 py-0.5 text-center leading-tight ${atToday ? "cursor-default border-transparent" : "cursor-pointer border-white/50 hover:bg-white/15"}`}
      >
        <div className="text-[12.5px] font-semibold text-white">Today</div>
        <div className="text-[9.5px] font-normal text-white/70">{label}</div>
      </button>
      <button type="button" data-history-newer aria-label="Show one day less" title={canForward ? "Show one day less" : "Starting from today"} disabled={!canForward} onClick={onForward} className={`${btn} ${canForward ? on : off}`}>›</button>
    </div>
  );
}
