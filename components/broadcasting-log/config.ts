import { laToday, shiftYmd } from "@/lib/la-date";

export type RangePreset = "all" | "today" | "week" | "month" | "custom";

export const RANGE_OPTIONS: readonly { value: RangePreset; label: string }[] = [
  { value: "all", label: "All" },
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

/** 预设 → 发送日期范围（洛杉矶）。一周从周日算（同旧页面）。 */
export function presetRange(
  preset: Exclude<RangePreset, "custom">,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = laToday(now);
  if (preset === "all") return { from: "", to: "" };
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") {
    const [y, m, d] = today.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return { from: shiftYmd(today, -weekday), to: today };
  }
  return { from: `${today.slice(0, 8)}01`, to: today };
}

export const MODULE_OPTIONS = [
  { value: "", label: "All modules" },
  { value: "tour", label: "Tour Confirmation" },
  { value: "morning", label: "Morning Pickup" },
  { value: "tickets", label: "Tickets Reminder" },
] as const;

export const GROUP_OPTIONS = [
  { value: "", label: "All groups" },
  { value: "general", label: "General" },
  { value: "mtlv", label: "MTLV" },
] as const;

/** 与旧页面 .tag-tour / .tag-morning / .tag-tickets 一致。 */
export const MODULE_TAG: Record<string, { label: string; className: string }> =
  {
    tour: {
      label: "Tour",
      className:
        "bg-[#EEF3EE] night:bg-emerald-400/10 text-[#7A9E7E] night:text-emerald-300",
    },
    morning: {
      label: "Morning",
      className:
        "bg-[#E9EFF3] night:bg-sky-400/10 text-[#6D8EA0] night:text-sky-300",
    },
    tickets: {
      label: "Tickets",
      className:
        "bg-[#F5EDE4] night:bg-amber-400/10 text-[#C4956A] night:text-amber-200",
    },
  };

/**
 * 人群。Tour 线存 general / mtlv；门票线存的是 all / pending / sent（旧页面一律显示成 General）。
 */
export const GROUP_TAG: Record<string, { label: string; className: string }> = {
  mtlv: {
    label: "MTLV",
    className:
      "bg-[#EEEDFE] night:bg-violet-400/15 text-[#534AB7] night:text-violet-300",
  },
  // Tour tracking 群发「By pickup location」（后端 2026-10-09 `a5b3bfd`，旧 `.tag-pickup`）。
  pickup: {
    label: "Pickup",
    className:
      "bg-[#E3F2E1] night:bg-emerald-400/10 text-[#2F7851] night:text-emerald-300",
  },
  general: {
    label: "General",
    className:
      "bg-[#EAF3DE] night:bg-emerald-400/10 text-[#3B6D11] night:text-emerald-300",
  },
  all: {
    label: "All",
    className:
      "bg-[#EAF3DE] night:bg-emerald-400/10 text-[#3B6D11] night:text-emerald-300",
  },
  pending: {
    label: "Pending",
    className:
      "bg-[#FEF3C7] night:bg-amber-400/10 text-[#b45309] night:text-amber-200",
  },
  sent: {
    label: "Confirmed",
    className:
      "bg-[#EAF3DE] night:bg-emerald-400/10 text-[#3B6D11] night:text-emerald-300",
  },
};

/** 收件人状态：发出 / 送达算好（绿），其余（失败、跳过、退信）算没到（米色）。 */
export function statusTone(value: string | null): "good" | "bad" | "none" {
  if (!value) return "none";
  return value === "sent" || value === "delivered" ? "good" : "bad";
}
