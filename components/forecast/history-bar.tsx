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

/** 表格左上角的翻页箭头：‹ 往历史翻一张快照，› 往后翻，翻到最新就回到今天（实时）。没有更早 / 已是今天 ⇒ 箭头变灰。 */
export function HistoryArrows({
  dates,
  value,
  onChange,
}: {
  dates: string[];
  value: string | null;
  onChange: (date: string | null) => void;
}) {
  // dates 新的在前；value = null 是今天。
  const at = value === null ? -1 : dates.indexOf(value);
  const older = at + 1 < dates.length ? dates[at + 1] : undefined;
  const newer = at < 0 ? undefined : at === 0 ? null : dates[at - 1];
  const btn =
    "flex h-8 w-8 items-center justify-center rounded-md border pb-0.5 text-[26px] leading-none font-bold";
  const on = "cursor-pointer border-white/50 text-white hover:bg-white/15";
  const off = "cursor-not-allowed border-white/10 text-white/25";
  const label = value
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value + "T00:00:00Z"))
    : "Today";
  return (
    <div data-history-arrows className="flex items-center justify-between gap-1">
      <button
        type="button"
        data-history-older
        aria-label="Previous saved day"
        title={older ? "Previous saved day" : "No earlier saved forecast"}
        disabled={!older}
        onClick={() => older && onChange(older)}
        className={`${btn} ${older ? on : off}`}
      >
        ‹
      </button>
      <div className="text-center leading-tight">
        <div className={`text-[12.5px] font-semibold ${value ? "text-[#fcd34d]" : "text-white"}`}>{label}</div>
        <div className={`text-[9px] font-normal ${value ? "text-[#fcd34d]" : "text-white/60"}`}>
          {value ? "Saved · read only" : "Live"}
        </div>
      </div>
      <button
        type="button"
        data-history-newer
        aria-label={newer === null ? "Back to today" : "Next saved day"}
        title={newer === undefined ? "This is today" : newer === null ? "Back to today" : "Next saved day"}
        disabled={newer === undefined}
        onClick={() => newer !== undefined && onChange(newer)}
        className={`${btn} ${newer !== undefined ? on : off}`}
      >
        ›
      </button>
    </div>
  );
}
