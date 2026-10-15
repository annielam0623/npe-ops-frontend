import { LA_TIME_ZONE, laToday, shiftYmd } from "@/lib/la-date";
import type {
  WorkspaceHistoryEntry,
  WorkspaceItemSummary,
  WorkspaceStatus,
} from "@/types";

const TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});
const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
});
const FULL = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const YMD = new Intl.DateTimeFormat("en-CA", { timeZone: LA_TIME_ZONE });

/** My work 的 Updated（同预览）：今天写「Today 12:31 PM」，昨天写「Yesterday」，更早写「Oct 11」。洛杉矶时间。 */
export function formatUpdated(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const day = YMD.format(t);
  const today = laToday(now);
  if (day === today) return `Today ${TIME.format(t)}`;
  if (day === shiftYmd(today, -1)) return "Yesterday";
  return DAY.format(t);
}

export function formatFull(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "—" : FULL.format(t);
}

export function sourceLabel(item: WorkspaceItemSummary): string {
  return item.source === "file" ? "File" : "Pasted email";
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** 文件名的扩展名（小写，不带点）。 */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** 历史一条写成一句话（后端只记状态、负责人、标题，不记内容）。 */
export function describeHistory(
  h: WorkspaceHistoryEntry,
  statuses: WorkspaceStatus[],
  people: Map<number, string>,
): string {
  const statusName = (code: unknown) =>
    statuses.find((s) => s.code === code)?.name ?? String(code ?? "");
  const person = (id: unknown) =>
    (typeof id === "number" && people.get(id)) || `#${String(id)}`;
  const b = h.before_data ?? {};
  const a = h.after_data ?? {};
  if (h.action === "create") return "Created";
  if (h.action === "assign")
    return `Owner: ${person(b.owner_id)} → ${person(a.owner_id)}`;
  const parts: string[] = [];
  if ("status_code" in a && a.status_code !== b.status_code)
    parts.push(
      `Status: ${statusName(b.status_code)} → ${statusName(a.status_code)}`,
    );
  if ("title" in a && a.title !== b.title)
    parts.push(`Client / subject: ${String(a.title ?? "") || "—"}`);
  if ("next_step" in a && a.next_step !== b.next_step)
    parts.push(`Next step: ${String(a.next_step ?? "") || "—"}`);
  return parts.join(" · ") || "Updated";
}
