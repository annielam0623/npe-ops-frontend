import {
  type ChannelKey,
  channelKey,
  type WhatsAppWindow,
  whatsappWindow,
} from "@/lib/channels";
import { env } from "@/lib/env";
import type { MessageLane, UnhandledMessage } from "@/types";

const LA_TIME_ZONE = "America/Los_Angeles";

/** 首页各模块暂时还在旧后台，链接拼旧后台地址；页面迁过来以后改成站内路径。 */
export function legacyUrl(path: string): string {
  return `${env.legacyAdminBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

/** 已迁到 ops 的 tracking 页：旧后台路径 → 站内路径。 */
const MIGRATED_TRACKING: Record<string, string> = {
  "/admin/notifications/morning-pickup/tracking": "/morning-pickup/tracking",
  "/admin/notifications/tickets-reminder/tracking":
    "/tickets-reminder/tracking",
};

/**
 * 消息卡片的 track_url（旧后台站内路径，带 ?date=）：页面已迁过来就换成站内路径、
 * 保留查询参数，否则拼旧后台地址。
 */
export function trackingHref(trackUrl: string): string {
  const [path, query] = trackUrl.split("?", 2);
  const migrated = MIGRATED_TRACKING[path];
  if (migrated) {
    return query ? `${migrated}?${query}` : migrated;
  }
  return legacyUrl(trackUrl);
}

/** 与旧 dashboard 一致：有显示名用显示名，否则用户名首字母大写（Jinja 的 capitalize）。 */
export function greetingName(
  displayName: string | null,
  username: string,
): string {
  const name = displayName?.trim();
  if (name) {
    return name;
  }
  return username.charAt(0).toUpperCase() + username.slice(1).toLowerCase();
}

const HEADER_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: LA_TIME_ZONE,
});

/** 页头日期按洛杉矶时区，和下面 Messages 的「今天」同一个口径。 */
export function formatHeaderDate(now: Date): string {
  return HEADER_DATE_FORMAT.format(now);
}

// ── Messages ────────────────────────────────────────────────────────────────

/** 后端 lane key 仍叫 morning，显示 "Today's Pickup"（Annie 2026-09-13 定的三个窗口名）。 */
export const LANE_LABEL: Record<MessageLane, string> = {
  morning: "Today's Pickup",
  tour: "Tour",
  tickets: "Tickets",
};

/** 三个窗口的强调色与上面快捷卡同源：同一条线在 dashboard 上必须是同一个颜色。 */
export const LANE_ACCENT: Record<MessageLane, string> = {
  morning: "#3b82f6",
  tour: "#22c55e",
  tickets: "#a855f7",
};

export const LANE_EMPTY_TEXT: Record<MessageLane, string> = {
  morning: "All of today's pickup messages handled",
  tour: "All tour messages handled",
  tickets: "All ticket messages handled",
};

export const LANES: readonly MessageLane[] = ["morning", "tour", "tickets"];

/** 与旧页面同频（三个 tracking 页都是 60 秒）。 */
export const POLL_INTERVAL_MS = 60_000;
/** WhatsApp 倒计时自己走，不等 60 秒一轮的拉取。 */
export const CLOCK_TICK_MS = 30_000;
/** 连续失败几轮以后显示「Not updating」。 */
export const STALE_AFTER_FAILURES = 2;

const LA_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/** "2026-09-30" → "Wednesday, September 30"。按 UTC 解析再按 UTC 格式化，日期不会因时区偏一天。 */
export function formatLaDay(ymd: string): string {
  const date = parseYmd(ymd);
  return date ? LA_DATE_FORMAT.format(date) : ymd;
}

function parseYmd(ymd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) {
    return null;
  }
  return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
}

const SHORT_DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** Tour / Tickets 跨今天和未来，今天 / 明天出发的要一眼看出来。 */
export function describeDeparture(
  tourDate: string,
  today: string,
): { text: string; soon: boolean } | null {
  const a = parseYmd(tourDate);
  const b = parseYmd(today);
  if (!a || !b) {
    return null;
  }
  const days = Math.round((a.getTime() - b.getTime()) / 86_400_000);
  if (days === 0) {
    return { text: "Departs today", soon: true };
  }
  if (days === 1) {
    return { text: "Departs tomorrow", soon: true };
  }
  return { text: `Departs ${SHORT_DAY_FORMAT.format(a)}`, soon: false };
}

const CLOCK_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: LA_TIME_ZONE,
});

/** 消息几点到的（洛杉矶时间）。 */
export function formatClockLa(iso: string): string {
  const time = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(time) ? "" : CLOCK_FORMAT.format(time);
}

/** 当前时刻的钟点，用于「Not updating — last updated …」（浏览器本地时间，与旧页面一致）。 */
export function formatLocalClock(time: number): string {
  return new Date(time).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatWaited(since: number, now: number): string {
  const mins = Math.floor((now - since) / 60_000);
  if (mins < 60) {
    return `waiting ${Math.max(mins, 0)}m`;
  }
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) {
    return `waiting ${h}h${m ? ` ${m}m` : ""}`;
  }
  const d = Math.floor(h / 24);
  return `waiting ${d}d${h % 24 ? ` ${h % 24}h` : ""}`;
}

/**
 * 「等了多久」那句话。时长按 pending_since 算，主语也必须跟着它走：
 * pending_since 就是消息本身时说 message；是改期请求（包括只有改期、没有留言）时说 date change。
 */
export function describeWaiting(item: UnhandledMessage, now: number): string {
  const since = item.pending_since || item.created_at;
  if (!since) {
    return "";
  }
  const sinceTime = new Date(since).getTime();
  if (Number.isNaN(sinceTime)) {
    return "";
  }
  const isMessage =
    !!item.created_at &&
    (!item.pending_since || item.pending_since === item.created_at);
  const subject = isMessage ? "This message" : "This date change";
  if (now - sinceTime < 60_000) {
    return `${subject} ${isMessage ? "just arrived" : "just came in"}`;
  }
  return `${subject} ${formatWaited(sinceTime, now)}`;
}

/** 渠道图标：同 tracking 页的口径（lib/channels.ts）。 */
export function channelOf(item: UnhandledMessage): ChannelKey | null {
  return channelKey(item.channel, item.direction);
}

/** 只对 WhatsApp 卡片有意义；时刻缺失时返回 null。卡片上的消息就是客人来信那条。 */
export function whatsappWindowOf(
  item: UnhandledMessage,
  now: number,
): WhatsAppWindow | null {
  return whatsappWindow(item.created_at, item.fallback_channel, now);
}
