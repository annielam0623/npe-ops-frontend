import type { PreviewTab } from "@/components/ui/message-preview-panel";
import type {
  TicketsGuest,
  TicketsManifestRow,
  TicketsSendResult,
  TicketsSendType,
} from "@/types";

/**
 * 团型下拉，分组和文案照抄旧页面 send_tickets.html。
 * ⛔ key 必须和后端 tickets_reminder.TOUR_TYPES 的 key 一致：错一个字，查重和消息预览都会失败。
 * 不用 GET /api/tickets-reminder/tour-types：它的 label 里两个 Brenda 同名，分不出哪个免 permit fee。
 */
export const TOUR_TYPE_GROUPS: readonly {
  label: string;
  options: readonly { value: string; label: string }[];
}[] = [
  {
    label: "Upper Antelope Canyon",
    options: [
      { value: "upper_antelope_tsosie", label: "Chief Tsosie Tours" },
      {
        value: "upper_antelope_brenda",
        label: "Brenda (Tse Bighanilini Tours)",
      },
      {
        value: "upper_antelope_brenda_no_fee",
        label: "Brenda — No Permit Fee",
      },
      { value: "upper_antelope_aact", label: "The Adventurous Group (AACT)" },
      {
        value: "upper_antelope_hogan_transport",
        label: "Hogan with Transport",
      },
      { value: "upper_antelope_hogan_hiking", label: "Hogan Hiking Tour" },
    ],
  },
  {
    label: "Lower Antelope Canyon",
    options: [
      { value: "lower_antelope_kens", label: "Ken's Tours" },
      { value: "lower_antelope_dixie", label: "Dixie's Tours" },
    ],
  },
  {
    label: "Other",
    options: [
      { value: "canyon_x", label: "Antelope Canyon X – Taadidiin Tours" },
      { value: "rattlesnake_aact", label: "Rattlesnake Canyon – AACT" },
      { value: "secret_antelope_hbt", label: "Secret Antelope Canyon – HBT" },
      {
        value: "secret_antelope_combo_hbt",
        label:
          "Combo - Secret Antelope Canyon & Horseshoe Bend Overlook – C-HBT",
      },
    ],
  },
];

export const MESSAGE_PREVIEW_TABS: readonly PreviewTab[] = [
  { key: "sms", label: "SMS", kind: "text" },
  { key: "email", label: "Email", kind: "html" },
  { key: "guest_page", label: "Guest Page", kind: "html" },
];

export function tourTypeLabel(value: string): string {
  for (const group of TOUR_TYPE_GROUPS) {
    const option = group.options.find((o) => o.value === value);
    if (option) {
      return `${group.label} – ${option.label}`;
    }
  }
  return value;
}

export const SEND_TYPES: readonly {
  value: TicketsSendType;
  label: string;
  /** 发送按钮上的说明。 */
  short: string;
}[] = [
  { value: "combined", label: "Both (SMS + Email)", short: "SMS + Email" },
  { value: "sms", label: "SMS Only", short: "SMS Only" },
  { value: "email", label: "Email Only", short: "Email Only" },
];

export function sendTypeShort(value: TicketsSendType): string {
  return SEND_TYPES.find((t) => t.value === value)?.short ?? value;
}

/**
 * Rezdy 导出的 manifest 文件名带 YYYY-MM-DD。只比日期、不比产品（Annie 2026-09-10 定：
 * Rezdy 的名字和我们的团型对不上，硬比会天天误报）。
 */
export function filenameMatchesDate(filename: string, ymd: string): boolean {
  return filename.includes(ymd);
}

/** 判断整批能不能发要用到的字段（门票、巴士团的预览行都有）。 */
export interface BlockCheckRow {
  order_number: string;
  name: string;
  pax?: number;
  pax_ok?: boolean;
}

/** Rezdy CSV 的行带 pax / pax_ok / qty_label；.xlsx 的行没有。 */
export function isCsvRow(row: { pax?: number }): boolean {
  return row.pax !== undefined;
}

/**
 * 整批不能发的原因（发之前就拦住：分批发时后面一批被服务端拒掉，前面几批已经发出去了）。
 * 门票页和巴士团发送页共用（判据同两边旧页面的 sendBlockLines）。
 */
export function blockReasons(
  rows: BlockCheckRow[],
  conflicts: string[],
): string[] {
  const reasons: string[] = [];
  const badPax = rows
    .filter((r) => isCsvRow(r) && !r.pax_ok)
    .map((r) => r.order_number || r.name);
  if (badPax.length) {
    reasons.push(
      `Guest count not found in Quantities: ${badPax.join(", ")}. Fix the quantity in Rezdy, download the CSV again and upload it.`,
    );
  }
  if (conflicts.length) {
    reasons.push(
      `Listed twice in this file with different details: ${conflicts.join(", ")}. Check these orders in Rezdy, download the file again and upload it.`,
    );
  }
  const noOrder = rows
    .filter((r) => !String(r.order_number || "").trim())
    .map((r) => r.name || "(no name)");
  if (noOrder.length) {
    reasons.push(
      `No order number: ${noOrder.join(", ")}. Add the order number in the file, or remove the row, and upload it again.`,
    );
  }
  return reasons;
}

/**
 * 与旧页面一致：姓名按第一个空格拆成 first / last（影响客人收到的称呼，不改口径）；
 * 团期和团型一律用页面上选的，不用 Excel 里那一行的。
 */
export function toGuest(
  row: TicketsManifestRow,
  tourType: string,
  serviceDate: string,
): TicketsGuest {
  const parts = (row.name || "").split(" ");
  return {
    chd_number: row.order_number,
    confirmation_no: row.confirmation_no || "",
    first_name: parts[0] || "",
    last_name: parts.slice(1).join(" "),
    customer_email: row.email || "",
    phone: row.phone || "",
    service_date: serviceDate,
    tour_type: tourType,
    checkin_time: row.checkin_time || "",
    tour_time: row.tour_time || "",
    // CSV 送原文（含空值），服务端算人数、算不出整批拦——不能当 1（Annie 2026-10-02）。
    no_of_pax: isCsvRow(row) ? row.quantities : row.quantities || 1,
    upload_row: row.upload_row ?? null,
  };
}

export type ChannelOutcome = "sent" | "failed" | "no-address" | "not-selected";

/** 某条渠道对这位客人的结果。没勾这条渠道、或者这位客人没有号码 / 邮箱，不算失败。 */
export function channelOutcome(
  channel: "sms" | "email",
  sendType: TicketsSendType,
  guest: TicketsGuest | undefined,
  result: TicketsSendResult,
): ChannelOutcome {
  if (sendType !== "combined" && sendType !== channel) {
    return "not-selected";
  }
  const address = guest
    ? channel === "sms"
      ? guest.phone
      : guest.customer_email
    : null;
  if (address !== null && !address.trim()) {
    return "no-address";
  }
  const ok = channel === "sms" ? result.sms_ok : result.email_ok;
  return ok ? "sent" : "failed";
}

/** 至少一条渠道发成功就算这位客人发出去了（与旧页面、send_log 的 error_msg 口径一致）。 */
export function isGuestSent(result: TicketsSendResult): boolean {
  return !!result.sms_ok || !!result.email_ok;
}
