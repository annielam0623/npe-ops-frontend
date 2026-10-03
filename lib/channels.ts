/**
 * 消息渠道和 WhatsApp 24 小时窗口——dashboard 和各 tracking 页共用一份，
 * 与旧后台 `app/static/channel-icons.js` 同口径。
 */

export type ChannelKey = "whatsapp" | "sms" | "email" | "web";

export const CHANNEL_TITLE: Record<ChannelKey, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
  web: "Replied on the confirmation page",
};

/** 客人发来的方向；其余（staff_note / sms_out / email_out）都是我们这边写的。 */
const INBOUND_DIRECTIONS = new Set(["sms_in", "email_in", "guest_reply"]);

export function isInbound(direction: string | null | undefined): boolean {
  return !!direction && INBOUND_DIRECTIONS.has(direction);
}

/**
 * 渠道图标。不能只看 channel：migrate_v48 之前的短信 channel 为空，要再看 direction。
 * 两个都认不出时返回 null，不画图标（不要兜一个默认的）。
 */
export function channelKey(
  channel: string | null | undefined,
  direction: string | null | undefined,
): ChannelKey | null {
  if (channel === "whatsapp" || channel === "sms" || channel === "email") {
    return channel;
  }
  if (direction === "sms_in" || direction === "sms_out") return "sms";
  if (direction === "email_in" || direction === "email_out") return "email";
  if (direction === "guest_reply") return "web";
  return null;
}

/** 客人来信后 24 小时内才能回自由文本；过了只能发模板，而我们发不了模板。 */
const WA_WINDOW_MS = 24 * 60 * 60 * 1000;
const WA_SOON_MS = 2 * 60 * 60 * 1000;
const FALLBACK_LABEL: Record<string, string> = { sms: "SMS", email: "email" };

export type WhatsAppWindow =
  | { state: "open" | "soon"; label: string }
  | { state: "shut"; fallback: string | null };

/**
 * 窗口从客人**来信**那一刻算（传入站那条的时刻，不是不分方向的最新一条），
 * fallback 是后端算好的改用渠道（sms / email / 空）。时刻缺失或无效时返回 null。
 */
export function whatsappWindow(
  inboundAt: string | null | undefined,
  fallback: string | null | undefined,
  now: number,
): WhatsAppWindow | null {
  const started = inboundAt ? new Date(inboundAt).getTime() : NaN;
  if (Number.isNaN(started)) {
    return null;
  }
  const left = started + WA_WINDOW_MS - now;
  if (left <= 0) {
    // 服务端算不出改用哪条时说 another channel，不编一个。
    return {
      state: "shut",
      fallback: (fallback && FALLBACK_LABEL[fallback]) ?? null,
    };
  }
  const mins = Math.floor(left / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const label = h ? `${h}h ${String(m).padStart(2, "0")}m left` : `${m}m left`;
  return { state: left < WA_SOON_MS ? "soon" : "open", label };
}
