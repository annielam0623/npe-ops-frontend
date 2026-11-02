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

/** 看历史时页面顶上的横条：看的是哪一天、几点存的、只读、回到今天。 */
export function HistoryBanner({
  date,
  takenAt,
  onBack,
  slim = false,
}: {
  date: string;
  takenAt: string;
  onBack: () => void;
  slim?: boolean;
}) {
  return (
    <div
      data-history-banner
      role="status"
      className={
        slim
          ? "flex flex-wrap items-center gap-3 border-l-4 border-[#f59e0b] bg-[#f59e0b]/10 px-4 py-2 text-[13px] text-white"
          : "flex flex-wrap items-center gap-3 rounded-[14px] border border-[#f59e0b]/60 bg-[#f59e0b]/15 px-5 py-3 text-sm text-white"
      }
    >
      <span aria-hidden>🕘</span>
      <span>
        <b className="text-[#fcd34d]">
          Viewing saved forecast from {formatLongDate(date)}
        </b>{" "}
        · saved {formatTakenAt(takenAt)} · read only
      </span>
      <button
        type="button"
        data-history-back
        onClick={onBack}
        className="ml-auto cursor-pointer rounded-md border border-white/40 px-3 py-1 text-[12.5px] font-semibold text-white hover:bg-white/10"
      >
        ← Back to today
      </button>
    </div>
  );
}
