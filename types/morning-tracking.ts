/** GET /api/notifications/morning-pickup/tracking 的一行（一单）。空值是空字符串，不是 null。 */
export interface MorningTrackingRow {
  /** bookings.id，Take action 用。 */
  id: number;
  order_number: string;
  name: string;
  phone: string;
  email: string;
  quantities: number;
  pickup_time: string;
  pickup_location: string;
  driver: string;
  vehicle_no: string;
  /** 这台车的 Samsara 实时位置链接；车号对不上车辆表或没有 GPS 时为 ""（后端 2026-10-04 加）。 */
  samsara_url?: string;
  /**
   * staff 看这台车实时位置的入口（后端 `/tracking/vehicle-live?van=`，绝对地址、要登录旧后台）：
   * 开了 Samsara API 时现建当天有效的临时链接，没开时跳 samsara_url。有没有值的判据同 samsara_url（后端 2026-10-05，规则文档 5c）。
   */
  live_url?: string;
  /**
   * 司机**现在**实际开的车号（Samsara，不是排班的 vehicle_no）；对不上 HR / 没开 Samsara / 车没地图时为 ""
   * （后端 2026-10-08 morning-driver-track-viewed）。有值时 Driver 名做成链到 `/tracking/vehicle-live?van=` 的链接。
   */
  driver_live_van?: string;
  /** 客人打开当前这台车的追踪链接的时间（ISO）；没点过、或没开 Samsara 时为 null（同上）。 */
  guest_viewed_at?: string | null;
  /** 客人看的链接是旧车、司机已经换车：要重发链接（同上）。 */
  guest_link_stale?: boolean;
  /** 原始短信状态（例 "sent:SM…"、"delivered"、"undelivered"），前端按子串归类。 */
  sms_status: string;
  email_state: "" | "clicked" | "opened" | "delivered" | "sent" | "failed";
  checkin_status: "checked_in" | "pending";
  /** 带时区的 ISO；没签到为 null。 */
  checkin_time: string | null;
  /** 谁处理过（显示名）；没处理为空。 */
  action_taken_by: string;
  agent_name: string;

  /** Notes 列：除 WhatsApp 以外的对话（短信 / 邮件 / 网页 / 内部备注）。 */
  notes_count: number;
  latest_note_author: string;
  latest_note_body: string;
  latest_note_direction: string;
  latest_note_channel: string;
  /**
   * Notes 列还要不要显示 ⚠️ Take action（后端 2026-10-10 `7c03bd3`，判据同 dashboard 未处理窗口）：
   * 最新一条客人留言在最后一次 Take action 之后。不能单看 action_taken_by。
   */
  notes_unhandled: boolean;

  /** WhatsApp 列。 */
  wa_count: number;
  latest_wa_author: string;
  latest_wa_body: string;
  latest_wa_direction: string;
  /** 最新一条 WhatsApp（不分方向）的 ISO，排序用。 */
  latest_wa_ts: string;
  /** 最新一条 WhatsApp 是客人发的、且之后没人 Take action。 */
  wa_unhandled: boolean;
  /** WhatsApp 比 Notes 新：Take action 链接放在 WhatsApp 列。 */
  wa_is_newer: boolean;
  /** 客人最近一条**入站** WhatsApp 的 ISO，24 小时窗口从这里算。 */
  wa_in_ts: string;
  /** 窗口关了以后改用的渠道：sms / email / 空。 */
  wa_fallback: string;

  /**
   * 司机 / 导游在手机上标的（司机实时页，Annie 2026-11-02「动手」；后端 fc 定）：团车 / 导游的 boarding 优先，其次 relay_status。
   * 旧后端没有这几个键（Driver mark 列整列不出）。
   */
  live_status?: "picked_up" | "boarded" | "no_show" | null;
  /** 标的时间（ISO）。 */
  live_status_at?: string | null;
  /** relay 标的 = 那台 relay 车的司机 / 车；boarded、导游标的 no_show = 客人坐的大巴；对不上为 ""。 */
  live_driver?: string;
  live_van?: string;
  /** No show 而且标在最后一次 Take action 之后 ⇒ 没处理（置顶、红底，Take action 清）。 */
  ns_unhandled?: boolean;
}

export interface MorningTracking {
  date: string;
  /** 早班追踪窗口结束（洛杉矶，一天里的第几分钟 / 显示文字）。过了就停止自动刷新。 */
  tracking_window: { end_minute: number; end_label: string };
  rows: MorningTrackingRow[];
}

/** GET /booking-notes/by-order/{order}?line=… 的一条。 */
export interface BookingNote {
  id: number;
  booking_id: number;
  /** 显示名，没有时是用户名；客人发来的为空。 */
  author_username: string;
  direction: string;
  body: string;
  sms_status: string | null;
  email_status: string | null;
  /** "YYYY-MM-DD HH:MM"，洛杉矶时间，只用来显示和排序。 */
  created_at: string;
}

export interface BookingNotes {
  notes: BookingNote[];
  guest_note: string;
  action_taken_by: string;
}

/** 对话所属的线；决定读写哪些 module 的备注。 */
export type NoteLine = "morning" | "tour" | "tickets";

export interface NoteCreate {
  body: string;
  direction: "staff_note" | "sms_out";
  send_sms: boolean;
  send_email: boolean;
  /** 不传 = 老行为（module 留空）；早班页传 morning。 */
  line?: NoteLine;
}

export interface TakeActionResult {
  ok: boolean;
  action_taken_by: string;
  action_taken_at: string | null;
}

// ── 司机实时页（Morning Pickup Tracking › Live drivers）──────────────────────
// GET /api/notifications/morning-pickup/live-drivers?date= （权限 morning.view + 开关 morning_live_drivers）。
// 每人一项，就是他手机上司机页 / 导游页的同一份数据（后端复用 /driver、/guide 的取数）。只列前端用到的键。

/** relay 车上的一位客人（driver_home.html 的 relay_blocks[].guests[]）。 */
export interface LiveRelayGuest {
  id: number;
  first_name: string | null;
  last_name: string | null;
  pax: number;
  order_number: string;
  phone?: string | null;
  relay_status: "picked_up" | "no_show" | null;
  relay_status_at?: string | null;
  checked_in_at?: string;
}

export interface LiveStationBlock<G> {
  time: string;
  hotel: string | null;
  spot?: string | null;
  /** 团车块：tour / outbound / inbound 和显示的标签。 */
  kind?: string;
  label?: string;
  product?: string | null;
  pax: number;
  bookings: number;
  guests: G[];
}

/** 团车名单上的一位客人（manifest.blocks[].guests[]，导游页同）。 */
export interface LiveTourGuest {
  id: number;
  name?: string;
  guide_name?: string;
  pax: number;
  order_number: string;
  phone?: string | null;
  lunch_text?: string;
  guide_lunch?: { text: string; bad?: boolean } | null;
  boarding: "boarded" | "no_show" | null;
  boarding_at?: string | null;
  relay_status?: "picked_up" | "no_show" | null;
}

export interface LiveSummary {
  pax: number;
  pickups: number;
  first?: string;
  last?: string;
  picked_up: number;
  no_show: number;
}

export interface LiveManifest {
  summary?: LiveSummary | null;
  blocks: LiveStationBlock<LiveTourGuest>[];
  lunch_bar?: Record<string, number> | null;
  guide_lunch_bar?: { n: number; label: string }[] | null;
  not_split?: boolean;
  unplaced?: number;
  not_picked_up?: number;
}

/** 有单独导游的团车：司机页只有数字（driver_tour_view）。 */
export interface LiveTourCompact {
  total: number;
  first?: string;
  guide?: string;
  my_relay?: number;
  ti: number;
  other_relay: number;
  no_show: number;
  not_split?: boolean;
  unplaced?: number;
}

export interface LiveSegment {
  id: number;
  shift: string;
  kind: string;
  when: string;
  title: string;
  tour_unset?: boolean;
  van: string;
  manifest?: LiveManifest | null;
  tour_compact?: LiveTourCompact | null;
  relay_guests?: LiveRelayGuest[] | null;
  relay_blocks?: LiveStationBlock<LiveRelayGuest>[];
  relay_summary?: LiveSummary | null;
  relay_farm_out_guests?: LiveRelayGuest[] | null;
}

export interface LiveGuideRun {
  id: number;
  tour: string;
  bus_label?: string | null;
  van?: string | null;
  manifest: LiveManifest | null;
  relay_no_show?: {
    guide_name: string;
    pax: number;
    pickup_location?: string | null;
  }[];
}

export interface LiveInboxThread {
  order_number: string;
  guest_name: string;
  pax: number;
  pickup_location?: string;
  pickup_time?: string;
  van?: string;
  last: { text: string; at: string; time: string; from: string } | null;
  last_guest_text?: string;
  unread: boolean;
}

export interface LivePerson {
  kind: "driver" | "guide";
  hr_id: number;
  name: string;
  first_shift?: string | null;
  segments?: LiveSegment[];
  runs?: LiveGuideRun[];
  inbox?: { unread_total: number; threads: LiveInboxThread[] } | null;
  /** 这一位读失败（后端 true，只空这一位，整页照出）。 */
  error?: boolean;
}

export interface LiveDrivers {
  date: string;
  people: LivePerson[];
}
