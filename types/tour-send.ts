import type { TicketsSendType } from "./tickets-send";

/** 两块发送：团确认（Regular）/ Last Minute（跳过再确认，直接选午餐和接客信息）。 */
export type TourLane = "tour_confirmation" | "last_minute";

/** GET /api/notifications/tour-confirmation/tour-types 的一个团（按显示顺序）。 */
export interface TourTypeOption {
  /** 发送 / 补录接口认的团型代码（后端 tc.TOUR_TYPES）。 */
  key: string;
  /** 下拉文字（不是发给客人的团名）。 */
  label: string;
  abbr: string;
  has_lunch: boolean;
  has_beef: boolean;
  /** 无午餐为 ""。 */
  lunch_group: string;
  /** Rezdy 文件名里应有的团名片段，例 "west"（查文件名用）。 */
  file_slug: string;
}

/** POST /api/notifications/tour-confirmation/preview 解析出的一行。 */
export interface TourManifestRow {
  order_number: string;
  first_name: string;
  last_name: string;
  name: string;
  email: string;
  phone: string;
  /** .xlsx：数字或原值；CSV：Quantities 原文（服务端算人数）。 */
  quantities: string | number;
  pickup_time: string;
  pickup_location: string;
  /** "ELIGIBLE" / 张数 / 空。 */
  mtlv_promo?: string | number | null;
  /** 同单 + 同团期已经发过（团确认 / Last Minute 任一）。 */
  duplicate: boolean;
  /** "Sent by annie on 10/4 2:13 PM" */
  sent_label: string;
  listed_twice?: boolean;
  listed_twice_conflict?: boolean;
  /** 只有 Rezdy CSV 的行有。算不出人数 ⇒ 整批不能发。 */
  pax?: number;
  pax_ok?: boolean;
  qty_label?: string;
  upload_row?: unknown;
  upload_status?: "added" | "changed" | "unchanged";
  changes?: { col: string; old: string; new: string }[];
}

export interface TourRemovedOrder {
  order_number: string;
  name: string;
  pax: number | string | null;
  pickup_time: string;
  pickup_location: string;
}

export interface TourPreview {
  total: number;
  duplicates: number;
  rows: TourManifestRow[];
  compare?: {
    reupload: boolean;
    removed: TourRemovedOrder[];
    counts: Record<string, number>;
  };
  warning?: string;
  listed_twice_conflicts?: string[];
  /** 预览时的服务器时间：发送时原样带回（Send anyway 只对这之前发过的单生效）。 */
  preview_at?: string;
}

/** 发给 bulk / apply 接口的一位客人。 */
export interface TourGuest {
  order_number: string;
  first_name: string;
  last_name: string;
  customer_email: string;
  phone: string;
  quantities: string | number;
  pickup_time: string;
  pickup_location: string;
  mtlv_promo: string;
  mtlv_qty: number | null;
  upload_row: unknown;
}

/** 页面自己留下没发的一行（建批次时交给后端记进这一批）。 */
export interface TourHeld {
  order: string;
  order_number: string;
  name: string;
  message: string;
}

export interface TourSendResult {
  order: string;
  name: string;
  /** "sent" / "failed: …" / "skipped - no email" / ""（没选这条渠道）。 */
  email_status: string;
  /** "sent:SM…" / "failed: …" / "skipped - no phone" / ""。 */
  sms_status: string;
}

export interface TourSkipped {
  order?: string;
  order_number?: string;
  name: string;
  /** 服务端跳过的才有：already_sent / listed_twice。 */
  reason?: string;
  message: string;
}

export interface TourSendBulkResponse {
  total: number;
  sent: number;
  results: TourSendResult[];
  skipped?: TourSkipped[];
}

export type TourSendType = TicketsSendType;

export type TourMessagePreview = {
  sms: string;
  email: string;
  guest_page: string;
};
