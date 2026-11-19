import { apiFetch } from "@/lib/api-client";
import { LA_TIME_ZONE } from "@/lib/la-date";
import type { DayOfTourLeg, OrderDetail, TrackingMark } from "@/types";
import type { SendLogPage, SendLogRow } from "@/types";

/**
 * 订单生命周期（Annie 2026-11-18「我想要排法A」「框 1，其余照推荐，动手」，样稿 AXpG4ERRdNoQexGtJcnBUa 第 5 版）：
 * Order lookup 和订单详情页上多出来的格子（Booked / Received / Changes / Sent / Last Minute / Reminder sent / Relay / Bus / Tour ended）。
 * 第一批（题 8 A）只用今天就有的数据：订单详情接口（order_detail、activity_log、day_of_tour）+ send-log 按单号。
 * 订单状态只从 Order List / Main manifest 来，不去 Rezdy 拉。
 */

/** 洛杉矶时间「11/18/2026 2:05 PM」（同订单详情接口 fmt_dt 的写法）。 */
const LA_DT = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "numeric",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const LA_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

export function formatLaDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? "—" : plainSpaces(LA_DT.format(t).replace(",", ""));
}

/** 新版 ICU 在 AM / PM 前用窄空格（U+202F），换成普通空格，跟接口的字串一样。 */
const plainSpaces = (s: string) => s.replace(/[  ]/g, " ");

export function formatLaTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? "—" : plainSpaces(LA_TIME.format(t));
}

// ── Booked / Received ────────────────────────────────────────────────────────

/**
 * Booked：Rezdy 下单时间 = order_detail.dateCreated（UTC ISO）；TripGuru 单看 tg_created_at。
 * 旧通道很多单没有 ⇒ null（显示「—」）。
 */
export function bookedAt(order: OrderDetail): string | null {
  const d = order.order_detail;
  if (!d || typeof d !== "object") return null;
  const rec = d as Record<string, unknown>;
  for (const key of ["dateCreated", "tg_created_at"]) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) return formatLaDateTime(v);
  }
  return null;
}

/**
 * Received：第一次收到 = activity_log 里最早一条 booking_created（Rezdy 推的，actor_type system）。
 * 不用 created_at / updated_at：每次推送整单重写，存的是最后一次同步。接口已经是「M/D/YYYY h:mm AM」。
 */
export function receivedAt(order: OrderDetail): string | null {
  const created = order.activity_log.filter(
    (a) => a.event_type === "booking_created",
  );
  // 接口按时间新 → 旧排，最早的在最后。
  return created.length ? created[created.length - 1].created_at : null;
}

// ── Changes ──────────────────────────────────────────────────────────────────

export type ChangeSource = "rezdy" | "guest" | "staff" | "system";

export interface ChangeEntry {
  id: number;
  at: string;
  source: ChangeSource;
  /** 来源那一格写的字：Rezdy / Guest / 员工名 / System。 */
  who: string;
  /** 一条记录可能改了几项（Refresh from Rezdy 一次改几项）。null = 没有这一项（加 / 删项目，显示「—」）。 */
  /** changedOnly：只知道改了、没有前后值（G351：partner 看到的 Internal notes (Rezdy)）。 */
  items: {
    field: string;
    before: string | null;
    after: string | null;
    changedOnly?: boolean;
  }[];
  /** 没有前后值时写的话。 */
  text: string;
  /** 排序用（毫秒；读不出 = 0）。 */
  sortKey: number;
  /** 来自 rezdy_changes（Annie：这几条默认收成一行，点开看旧 → 新）。 */
  fromRezdy?: boolean;
}

/** 「11/18/2026 7:05 AM」（订单详情接口 fmt_dt，洛杉矶）→ 毫秒，只用来排先后（不换算时区，两边都按洛杉矶墙上时间比）。 */
function wallClockKey(s: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}) ([AP]M)$/.exec(
    s.trim(),
  );
  if (!m) return 0;
  const h = (Number(m[4]) % 12) + (m[6] === "PM" ? 12 : 0);
  return Date.UTC(+m[3], +m[1] - 1, +m[2], h, +m[5]);
}

/** 有意义的改动（题 2 A）：Rezdy 改了、员工改了、客人要求改；其余是系统记录，收在 Show all 里。 */
const MEANINGFUL = new Set([
  "booking_updated",
  "booking_cancelled",
  "field_updated",
  "refreshed_from_rezdy",
  "status_changed",
  "guest_modify_requested",
  "confirmation_no_changed",
]);

/**
 * "phone: 'a' → 'b'" 一段 ⇒ 前后值；对不上返回 null。
 * G351（后端 4aea93a5）：Refresh 的 activity_log 对 partner 不能看的字段只写「Internal notes (Rezdy): changed」，
 * 没有前后值 ⇒ 认成一项、changedOnly（显示「字段: changed」一行）。
 */
function parseDiff(s: string): ChangeEntry["items"][number] | null {
  const m = /^\s*(.+?):\s*'([\s\S]*?)'\s*→\s*'([\s\S]*?)'\s*$/.exec(s);
  if (m) return { field: m[1], before: m[2], after: m[3] };
  const c = /^\s*(.+?):\s*changed\s*$/.exec(s);
  return c ? { field: c[1], before: null, after: null, changedOnly: true } : null;
}

type Activity = OrderDetail["activity_log"][number];

function sourceOf(a: Activity): { source: ChangeSource; who: string } {
  const actor = (a.actor || "").trim();
  if (a.actor_type === "system" && /^rezdy$/i.test(actor))
    return { source: "rezdy", who: "Rezdy" };
  if (a.actor_type === "guest" || /^guest$/i.test(actor))
    return { source: "guest", who: "Guest" };
  if (a.actor_type === "staff")
    return { source: "staff", who: actor || "Staff" };
  return { source: "system", who: actor || "System" };
}

/** 事件名的标签，照后端 Order Log（app/routers/order_log.py EVENT_LABELS）的写法。 */
const EVENT_LABELS: Record<string, string> = {
  booking_created: "Booking Created",
  booking_updated: "Booking Updated",
  booking_handled: "Marked as Handled",
  status_changed: "Status Changed",
  guest_confirmed: "Guest Confirmed",
  guest_modify_requested: "Modify Requested",
  lunch_selected: "Lunch Updated",
  mtlv_qty_selected: "MTLV Qty Selected",
  mtlv_ticket_sent: "MTLV Ticket Sent",
  mtlv_cleared: "MTLV Cleared",
  action_taken: "Action Taken",
};

/**
 * 员工改字段（activity_log field_updated「lunch_turkey: '0' → '1'」）里的内部字段名 → 人看得懂的英文（Annie 2026-11-18「要不要改成人看得懂的写法。改」）。
 * 后端会写的只有订单详情 PATCH 的 8 个（orders.py _ALLOWED_FIELDS）；其余是常见字段，以防旧记录。不认识的照原样。
 */
export const FIELD_LABELS: Record<string, string> = {
  confirmation_no: "Confirmation #",
  lunch_turkey: "Lunch · Turkey",
  lunch_veggie: "Lunch · Veggie",
  lunch_beef: "Lunch · Beef",
  total_amount: "Total amount",
  currency: "Currency",
  total_paid: "Paid",
  total_due: "Due",
  first_name: "First name",
  last_name: "Last name",
  customer_phone: "Phone",
  phone: "Phone",
  customer_email: "Email",
  email: "Email",
  status: "Status",
  tour_date: "Tour date",
  pickup_time: "Pickup time",
  pickup_location: "Pickup location",
  quantities: "Pax",
  pax: "Pax",
  special_requirements: "Special requirements",
  notes: "Note",
  agent_name: "Agent",
  tt_number: "TT #",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field.trim()] ?? field;
}

export function toChange(a: Activity): ChangeEntry {
  const { source, who } = sourceOf(a);
  const detail = a.detail || "";
  let items: ChangeEntry["items"] = [];
  // 其余事件（Show all 里）：「标签 — 原文」，没标签的写原文 / 事件名。
  const label = EVENT_LABELS[a.event_type];
  let text = label
    ? detail && detail !== label
      ? `${label} — ${detail}`
      : label
    : detail || a.event_type;
  if (a.event_type === "field_updated") {
    const d = parseDiff(detail);
    if (d) items = [{ ...d, field: fieldLabel(d.field) }];
  } else if (a.event_type === "refreshed_from_rezdy") {
    const body = detail.replace(/^Refreshed from Rezdy\s*[—-]\s*/, "");
    items = body
      // 「; 字段: '」或「; 字段: changed」（G351）都是下一项的开头。
      .split(/;\s*(?=[^;]+:\s*(?:'|changed\s*(?:;|$)))/)
      .map(parseDiff)
      .filter((d): d is NonNullable<typeof d> => d !== null);
    text = "Refreshed from Rezdy";
  } else if (a.event_type === "booking_updated" && source === "rezdy") {
    // 第一批：Rezdy 推送没存前后值（题 3 A 后端做了再接）。
    text = "Updated by Rezdy";
  } else if (a.event_type === "booking_cancelled" && source === "rezdy") {
    text = "Cancelled in Rezdy";
  }
  return {
    id: a.id,
    at: a.created_at,
    source,
    who,
    items,
    text,
    sortKey: wallClockKey(a.created_at),
  };
}

/**
 * 生命周期第 2 项（bf 合同：rezdy_changes，从上线起记）：Rezdy 推送 / Refresh from Rezdy 改了什么。
 * source rezdy_push ⇒ 来源 Rezdy；refresh_from_rezdy ⇒ 来源是按键的员工名。
 */
/** Rezdy 改动里字段的固定顺序（bf 2026-11-18 建议）；不认识的排最后，同名按原来先后。 */
const FIELD_ORDER = [
  "First name",
  "Last name",
  "Phone",
  "Email",
  "Status",
  "Product",
  "Tour date",
  "Pickup time",
  "Pickup location",
  "Pax",
  "Special requirements",
  "Item",
];

function fieldRank(field: string): number {
  // 「Tour date (PRTSET)」「Pax (PRTSET) #2」「Item PRTSET」⇒ 取开头的标签。
  const base = field
    .replace(/\s*#\d+\s*$/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  const i = FIELD_ORDER.findIndex(
    (f) => base === f || base.startsWith(`${f} `),
  );
  return i < 0 ? FIELD_ORDER.length : i;
}

function byFieldOrder(a: { field: string }, b: { field: string }): number {
  return fieldRank(a.field) - fieldRank(b.field);
}

function rezdyEntries(order: OrderDetail): ChangeEntry[] {
  return (order.rezdy_changes ?? []).map((r, i) => {
    const at = formatLaDateTime(r.at);
    const push = r.source === "rezdy_push";
    return {
      id: -(i + 1),
      at,
      source: push ? "rezdy" : "staff",
      who: push ? "Rezdy" : r.by || "Staff",
      // 后端按标签字母序存 ⇒ 前端排成固定顺序（bf 建议的顺序）。
      items: [...(r.changes ?? [])].sort(byFieldOrder).map((c) => ({
        field: c.field,
        before: c.before,
        after: c.after,
      })),
      text: push ? "Updated by Rezdy" : "Refreshed from Rezdy",
      sortKey: wallClockKey(at),
      fromRezdy: true,
    };
  });
}

/**
 * activity_log 里跟 rezdy_changes 重复的那条（以 rezdy_changes 为准）：
 * 同一分钟的 refreshed_from_rezdy（对 refresh_from_rezdy）/ Rezdy 的 booking_updated（对 rezdy_push）。
 */
/** 两边配对的最大时间差（bf：两处分开写，通常差不到 1 秒，但可能跨分钟）。 */
const PAIR_WINDOW_MS = 120_000;

/** activity_log 这条跟 rezdy_changes 的哪一类是同一件事；不是这两类 = null。 */
function pairKind(a: Activity): ChangeSource | null {
  if (a.event_type === "refreshed_from_rezdy") return "staff";
  if (a.event_type === "booking_updated" && sourceOf(a).source === "rezdy")
    return "rezdy";
  return null;
}

/**
 * 跟 rezdy_changes 重复的 activity_log（以 rezdy_changes 为准）：同一类（Rezdy 推送 ↔ actor rezdy 的 booking_updated；
 * Refresh ↔ refreshed_from_rezdy）、时间差 ≤ 120 秒，每条 rezdy_changes 只配最近的一条（bf 2026-11-18）。
 * 时间都按「M/D/YYYY h:mm AM」到分钟比。
 */
function pairedLogIds(order: OrderDetail, rezdy: readonly ChangeEntry[]) {
  const used = new Set<number>();
  for (const r of rezdy) {
    let best: { id: number; diff: number } | null = null;
    for (const a of order.activity_log) {
      if (used.has(a.id) || pairKind(a) !== r.source) continue;
      const diff = Math.abs(wallClockKey(a.created_at) - r.sortKey);
      if (diff <= PAIR_WINDOW_MS && (!best || diff < best.diff))
        best = { id: a.id, diff };
    }
    if (best) used.add(best.id);
  }
  return used;
}

function merged(order: OrderDetail, only: (a: Activity) => boolean) {
  const rezdy = rezdyEntries(order);
  const paired = pairedLogIds(order, rezdy);
  const fromLog = order.activity_log
    .filter((a) => only(a) && !paired.has(a.id))
    .map(toChange);
  // 新 → 旧；同一分钟的照接口原来的先后（stable sort）。
  return [...rezdy, ...fromLog].sort((x, y) => y.sortKey - x.sortKey);
}

/** 新 → 旧，只留有意义的改动（含 rezdy_changes）。 */
export function meaningfulChanges(order: OrderDetail): ChangeEntry[] {
  return merged(order, (a) => MEANINGFUL.has(a.event_type));
}

/** Show all：全部记录（含系统记录、rezdy_changes），新 → 旧。 */
export function allChanges(order: OrderDetail): ChangeEntry[] {
  return merged(order, () => true);
}

/** Changes 块默认列几条（题 2 A：超过 3 条右上 Show all N）。 */
export const CHANGES_SHOWN = 3;

// ── Sent（send-log 按单号）───────────────────────────────────────────────────

export type SendModule =
  "tour_confirmation" | "last_minute" | "tickets_reminder" | "morning_pickup";

/** Annie 2026-11-18「从发送记录最多10条就够了」：只取最近 10 条（后端按 sent_at 新 → 旧）。 */
export const ORDER_SENDS_LIMIT = 10;

/**
 * 这单最近的发送记录：send-log 按单号是「包含」匹配，这里再按单号精确过滤（大小写不分）。不带日期 = 全部日期。
 * ⚠️ 后端精确匹配之前，一个单号是另一个单号的一段时（例 ZZTEST1 / ZZTEST10），10 条里可能混进别的单。
 */
export async function fetchOrderSends(
  orderNumber: string,
  signal?: AbortSignal,
): Promise<SendLogRow[]> {
  const page = await apiFetch<SendLogPage>("/api/notifications/send-log", {
    cache: "no-store",
    signal,
    // order_exact：bf 合同草稿（后端精确匹配）；旧后端不认这个参数，下面照样精确过滤当保险。
    query: {
      order_number: orderNumber,
      order_exact: true,
      page: 1,
      page_size: ORDER_SENDS_LIMIT,
    },
  });
  const want = orderNumber.trim().toUpperCase();
  return page.rows.filter(
    (r) => (r.order_number || "").trim().toUpperCase() === want,
  );
}

export interface SentSummary {
  at: string;
  by: string;
  sms: string;
  email: string;
  /** 「Delivered · Opened」（后端给了送达 / 打开时间才有；WhatsApp 发的带 WhatsApp）。 */
  delivery: string;
}

/**
 * 一个词，照后端阶梯（notifications.py email_state）：Clicked > Opened > Delivered > (Sent，不写) > Failed；
 * 短信算 delivered_at / sms_status delivered，失败 failed / undelivered；邮件 bounce / spam 算 Failed。WhatsApp 发的前面加 WhatsApp。
 */
function deliveryOf(r: SendLogRow): string {
  const sms = (r.sms_status || "").toLowerCase();
  const email = (r.email_status || "").toLowerCase();
  const word = r.clicked_at
    ? "Clicked"
    : r.opened_at
      ? "Opened"
      : r.delivered_at ||
          r.email_delivered_at ||
          email === "delivered" ||
          sms.startsWith("delivered")
        ? "Delivered"
        : sms.startsWith("sent") || email.startsWith("sent")
          ? ""
          : /fail|undeliver|bounce|spam/.test(`${sms} ${email}`)
            ? "Failed"
            : "";
  return [r.sms_channel === "whatsapp" ? "WhatsApp" : "", word]
    .filter(Boolean)
    .join(" · ");
}

/** 「by veronica · Delivered · Opened」。 */
export function sentSub(s: SentSummary): string {
  return [sentByLabel(s.by), s.delivery].filter(Boolean).join(" · ");
}

// ── 按单的答复 / 餐 / 到站（bf 合同草稿；旧后端没有 ⇒ null）──────────────────

const REPLY_LABEL: Record<string, string> = {
  yes: "YES",
  pending: "Pending (no reply yet)",
  modify_req: "Modify requested",
  reschedule_req: "Reschedule requested",
  modified: "Modified",
  cancel: "Cancel",
};

/** module：tour_confirmation（Tour 确认）/ tickets_reminder（门票，bf 第 2 项起 confirmations 也带门票行）。 */
export function replyFor(
  order: OrderDetail,
  date: string | null,
  module: "tour_confirmation" | "tickets_reminder" = "tour_confirmation",
): { label: string; status: string; submitted: string | null } | null {
  const c = (order.confirmations ?? []).find(
    (x) => x.module === module && (!date || x.tour_date === date),
  );
  if (!c) return null;
  return {
    status: c.status,
    label: REPLY_LABEL[c.status] ?? c.status,
    submitted: c.submitted_at ? formatLaDateTime(c.submitted_at) : null,
  };
}

export function lunchFor(order: OrderDetail, date: string | null) {
  return (
    (order.lunch_by_day ?? []).find((x) => !date || x.tour_date === date) ??
    null
  );
}

/** 三明治写法跟后端 tour_manifest.lunch_text 一样：「1 Turkey, 2 Veggie, 1 Roast Beef」，0 份不写。 */
const SANDWICHES = [
  ["turkey", "Turkey"],
  ["veggie", "Veggie"],
  ["beef", "Roast Beef"],
] as const;

type LunchCounts = { turkey?: number; veggie?: number; beef?: number };

export function lunchText(c: LunchCounts): string {
  return SANDWICHES.filter(([k]) => Number(c[k] || 0) > 0)
    .map(([k, label]) => `${Number(c[k])} ${label}`)
    .join(", ");
}

const sameLunch = (a: LunchCounts, b: LunchCounts) =>
  SANDWICHES.every(([k]) => Number(a[k] || 0) === Number(b[k] || 0));

/** 两份不一样时客人那格下面的橙字（Annie 2026-11-19「全部动手」，题 B2 B）。 */
export const LUNCH_NOT_IN_BUS =
  "Not in the bus manifest yet. Copy the guest's pick to the Rezdy order (special requirements).";

/**
 * 第 4 件：客人选的餐（tracking 行 confirmations[].lunch）vs Bus Manifest 的餐（lunch_by_day），按同一个团期对。
 * - guest：tour_confirmation 那行的餐（没有再看同一天别的 Tour 车道行，门票行不算）；灰字只写时间——后端 lunch.source 没做之前不写来源。
 * - mismatch：两份份数不一样才算；这个团没有三明治午餐（has_lunch=false）、导游改过（changed=true）、客人那份是 null、
 *   旧后端没给 Bus 的三个数，都不算。tracking 那份本来就是「客人 / Rezdy 谁新留谁」，不一样 = 客人新选的还没抄进 Rezdy（Bus 读 Rezdy special）。
 */
export function lunchPick(order: OrderDetail, date: string | null) {
  const rows = (order.confirmations ?? []).filter(
    (x) => x.module !== "tickets_reminder" && (!date || x.tour_date === date),
  );
  const row =
    rows.find((x) => x.module === "tour_confirmation" && x.lunch) ??
    rows.find((x) => x.lunch) ??
    null;
  const g = row?.lunch ?? null;
  // lunch_by_day 按 (run_date, manifest_id) 分组：同一天两个 manifest 会有 2 条以上 ⇒ 合起来（后端 25 / ae 2026-11-19）。
  const days = (order.lunch_by_day ?? []).filter(
    (x) => !date || x.tour_date === date,
  );
  const hasLunch = days.some((x) => x.has_lunch);
  const lunchDays = days.filter((x) => x.has_lunch);
  // 三个数：每条都带才算（旧后端没有 ⇒ null，不比较）；没午餐的那条不计。
  const busCounts =
    lunchDays.length && lunchDays.every((x) => typeof x.turkey === "number")
      ? SANDWICHES.reduce(
          (acc, [k]) => ({
            ...acc,
            [k]: lunchDays.reduce((s, x) => s + Number(x[k] || 0), 0),
          }),
          {} as Required<LunchCounts>,
        )
      : null;
  const uniq = (xs: (string | null | undefined)[]) => [
    ...new Set(xs.filter((x): x is string => Boolean(x && x.trim()))),
  ];
  const restaurants = uniq(days.map((x) => x.restaurant));
  return {
    guest: g
      ? {
          text: lunchText(g) || "—",
          at: g.updated_at ? formatLaDateTime(g.updated_at) : null,
        }
      : null,
    bus: days.length
      ? {
          // 合计写法同 lunch_text；没给三个数时把各条 text 连起来。
          text: !hasLunch
            ? "No lunch"
            : (busCounts ? lunchText(busCounts) : "") ||
              uniq(lunchDays.map((x) => x.text)).join(" + ") ||
              "—",
          has_lunch: hasLunch,
          restaurant: restaurants.length ? restaurants.join(" · ") : null,
        }
      : null,
    mismatch: Boolean(
      g &&
      hasLunch &&
      !days.some((x) => x.changed) &&
      busCounts &&
      !sameLunch(g, busCounts),
    ),
  };
}

export function liveFor(order: OrderDetail, date: string | null) {
  return (
    (order.live_by_day ?? []).find((x) => !date || x.tour_date === date) ?? null
  );
}

/** 这个模块最近一次发送；date 给了就只看那天的团（改期以前的发送不算这一天的）。 */
export function latestSend(
  rows: readonly SendLogRow[],
  module: SendModule,
  date: string | null,
): SentSummary | null {
  const mine = rows
    .filter(
      (r) =>
        r.module === module &&
        r.sent_at &&
        (!date || !r.tour_date || r.tour_date === date),
    )
    .sort((a, b) => (b.sent_at || "").localeCompare(a.sent_at || ""));
  const r = mine[0];
  if (!r) return null;
  return {
    at: formatLaDateTime(r.sent_at),
    by: r.sent_by?.trim() || "—",
    sms: r.sms_status || "",
    email: r.email_status || "",
    delivery: deliveryOf(r),
  };
}

/**
 * SENT / REMINDER SENT（bf 第 2 项，Annie 同意照固定状态）：发没发看 confirmations[].send_state，时间 = sent_at、谁 = sent_by。
 * 送达一律看 send-log（行上的 email_status / sms_status 只在发送当时写一次，bf 2026-11-18 更正，不用）。
 * 这一行没有 send_state（旧后端）或是 last_minute ⇒ 照旧整格用 send-log。返回 null = 没发。
 */
export function sentFor(
  order: OrderDetail,
  sends: readonly SendLogRow[],
  module: SendModule,
  date: string | null,
): SentSummary | null {
  const fromLog = latestSend(sends, module, date);
  if (module === "last_minute") return fromLog;
  const row = (order.confirmations ?? []).find(
    (x) => x.module === module && (!date || x.tour_date === date),
  );
  // 后端 COALESCE(send_state, '')：空 = 这行没有固定状态（旧行），跟旧后端一样照 send-log。
  if (!row || !row.send_state) return fromLog;
  if (row.send_state !== "sent") return null;
  return {
    at: formatLaDateTime(row.sent_at ?? null),
    by: row.sent_by?.trim() || "—",
    sms: fromLog?.sms ?? "",
    email: fromLog?.email ?? "",
    delivery: fromLog?.delivery ?? "",
  };
}

/** 「by veronica」：scheduler 写成 Auto send。 */
export function sentByLabel(by: string): string {
  if (!by || by === "—") return "";
  return /^scheduler$/i.test(by) ? "by Auto send" : `by ${by}`;
}

// ── Relay / Bus（day_of_tour）────────────────────────────────────────────────

/** 去程（leg ""）、这一天的那一条；没有 = null。 */
export function dayOfTourFor(
  order: OrderDetail,
  date: string | null,
): DayOfTourLeg | null {
  const list = Array.isArray(order.day_of_tour) ? order.day_of_tour : [];
  return (
    list.find((e) => (!date || e.tour_date === date) && (e.leg || "") === "") ??
    null
  );
}

export type MarkTone = "good" | "bad" | "plain";

export function markTone(mark: TrackingMark | null | undefined): MarkTone {
  if (!mark) return "plain";
  if (mark.value === "no_show") return "bad";
  if (mark.value === "picked_up" || mark.value === "boarded") return "good";
  return "plain";
}

/** 「Picked up 6:15 AM」；副行「Jane D.」/「Bus 3001」。 */
export function markText(mark: TrackingMark): { main: string; sub: string } {
  const time = formatLaTime(mark.at);
  return {
    main: [mark.label || mark.value, time !== "—" ? time : ""]
      .filter(Boolean)
      .join(" "),
    sub: [mark.by, mark.vehicle && `Bus ${mark.vehicle}`]
      .filter(Boolean)
      .join(" · "),
  };
}

/** Van at hotel：Morning Tracking 行的 arrived_at / left_at（ISO）。 */
export function vanAtHotel(
  arrived: string | null | undefined,
  left: string | null | undefined,
): string | null {
  if (!arrived) return null;
  const a = formatLaTime(arrived);
  return left ? `${a} – ${formatLaTime(left)}` : a;
}

/**
 * ⑦ Tour ended（G360，Annie「可以，团结束时间就这样做」）：回程第一个 Las Vegas 下客站，例「6:36 PM Treasure Island · last stop 6:57 PM Excalibur」。
 * 最后一站跟第一站一样（只有一站）或没有 ⇒ 只写第一站；tour_ended_at 是 null / 旧后端没键 ⇒ null（格子写「—」）。
 */
export function tourEnded(
  live:
    | {
        tour_ended_at?: string | null;
        tour_ended_where?: string;
        last_stop_at?: string | null;
        last_stop_where?: string;
      }
    | null
    | undefined,
): string | null {
  if (!live?.tour_ended_at) return null;
  const stop = (at: string, where: string | undefined) =>
    [formatLaTime(at), (where ?? "").trim()].filter(Boolean).join(" ");
  const first = stop(live.tour_ended_at, live.tour_ended_where);
  if (!live.last_stop_at) return first;
  const last = stop(live.last_stop_at, live.last_stop_where);
  return last === first ? first : `${first} · last stop ${last}`;
}

/**
 * 这单的 Tour ended：不按团期取行（多日团第 1 天大巴不回 LV、那天是 null，回程那天才有；后端 G360 每个运行日一行），
 * 取 live_by_day 里 tour_ended_at 不是 null 的最晚一行（按 tour_date，同一天几行取有值那行）；都没有 ⇒ null（「—」）。
 */
export function tourEndedFor(order: OrderDetail): string | null {
  const done = (order.live_by_day ?? []).filter((x) => x.tour_ended_at);
  if (!done.length) return null;
  const latest = done.reduce((a, b) =>
    b.tour_date > a.tour_date ||
    (b.tour_date === a.tour_date &&
      (b.tour_ended_at ?? "") > (a.tour_ended_at ?? ""))
      ? b
      : a,
  );
  return tourEnded(latest);
}

// ── How to use（题 6 A：第 3 版那 6 条原文）──────────────────────────────────

export const LIFECYCLE_HOW_TO: readonly string[] = [
  "The result shows the whole life of the order: when it was booked and received, any changes, the messages sent to the guest and the reply, lunch, morning pickup and when the tour ended.",
  "Booked is when the order was made in Rezdy. Received is when it first came into our Order List.",
  "Changes lists updates from Rezdy, edits by staff and requests from the guest, with the old value crossed out. Click Show all to see every entry.",
  "Sent shows when each message went out and who sent it. Relay and Bus show Picked up, Boarded or No show as marked in Dispatch.",
  "Tour ended is the time the bus reached its first hotel stop back in Las Vegas. A — means there is no record yet.",
  "Order status comes from the Order List. To fix something, open the order in Main manifest or the Order List.",
];

/** How to use 加一条（Chat history 第 7 版原文；看得到 Chat history 的人才出）。 */
export const CHAT_HOW_TO =
  "Chat history lists the messages between the guest and staff for this order, newest first. Voice messages show what the phone assistant wrote down. Click Open chat → on a block to open that conversation on its Tracking page and reply there.";

/** 框 1：各块外框实线蓝（底色 / 格子 / 字不变），跟开关走。 */
export const LIFECYCLE_FRAME = "border-[rgba(96,165,250,.55)]";
