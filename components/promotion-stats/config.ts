import type { PromotionDetailStatus, PromotionStatsSummary } from "@/types";

export interface StatCardConfig {
  key: keyof PromotionStatsSummary;
  label: string;
  color: string;
  /** 可点击卡片对应的表格筛选；纯展示卡片为 undefined。 */
  filter?: PromotionDetailStatus;
}

export const STAT_CARDS: readonly StatCardConfig[] = [
  {
    key: "total_eligible",
    label: "Total Eligible",
    color: "#57534E",
    filter: "all",
  },
  {
    key: "selected_qty",
    label: "Selected Tickets",
    color: "#534AB7",
    filter: "selected",
  },
  {
    key: "yes_no_ticket",
    label: "YES but No Ticket",
    color: "#BA7517",
    filter: "yes_no_ticket",
  },
  {
    key: "pending_send",
    label: "Pending Send",
    color: "#185FA5",
    filter: "pending",
  },
  { key: "sent", label: "Sent", color: "#3B6D11" },
  { key: "cancelled", label: "Cancelled", color: "#A32D2D" },
];

export const TABLE_TITLES: Record<PromotionDetailStatus, string> = {
  all: "All Eligible Guests",
  selected: "Selected Tickets",
  yes_no_ticket: "YES but No Ticket Selected",
  pending: "Pending Send",
};
