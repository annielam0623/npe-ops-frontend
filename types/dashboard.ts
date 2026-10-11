/** Dashboard Messages 区的四个窗口：Today's Pickup / Tour / Tickets / Multi Orders（后者只在有卡片时出现）。 */
export type MessageLane = "morning" | "tour" | "tickets" | "multi";

/** Multi Orders 卡片上「名下没出发的单」：Assign / Take action 选单用，也用于只读列表显示。 */
export interface MultiOrderOption {
  order_number: string;
  /** 产品名（巴士团名或门票产品名，已拼好）。 */
  trip: string;
  /** 这张单名下没出发的团期，YYYY-MM-DD。 */
  dates: string[];
  /** 这张单挂在哪些车道（bus / tickets），纯展示不需要时可忽略。 */
  lanes: string[];
}

/** Multi Orders 不挂单卡片的完整对话（staff 回过之后要看全了才好 Assign）。 */
export interface MultiThreadMessage {
  author: string;
  body: string;
  direction: string;
  channel: string;
  created_at: string;
  /** 没发出去（服务端算好的 failed），避免下一个人以为已经问过客人了。 */
  failed: boolean;
}

/**
 * GET /api/notifications/unhandled 里的一张卡片：一单还欠着一个回应（客人来信或要求改期），
 * 或者 Multi Orders 窗口里的一张卡（一单多团期 / 号码邮箱名下多张单没挂单的对话）。
 * 时刻都是带时区的 ISO 字符串，取不到时是空字符串（不是 null）。
 */
export interface UnhandledMessage {
  order_number: string;
  name: string;
  /** 团名；借不到时为空，改显示 trip_fallback（接客点）。 */
  trip: string;
  trip_fallback: string;
  /** whatsapp / sms / email；老数据可能为空，再看 direction。 */
  channel: string;
  /** WhatsApp 24 小时窗口关了以后建议改用的渠道：sms / email；算不出来为空。 */
  fallback_channel: string;
  /** sms_in / email_in / guest_reply 等；只有改期、没有消息的卡片为空。 */
  direction: string;
  body: string;
  /** 客人最后一条消息的时刻；只有改期、没有消息时为空。 */
  created_at: string;
  /** 「欠着多久了」的基准：消息时间和提改期时间里较晚的那个。 */
  pending_since: string;
  is_modify: boolean;
  /** YYYY-MM-DD */
  tour_date: string;
  /** 旧后台 tracking 页的站内路径（带 ?date=），处理消息要去那里。空串 = 没有可跳转的页面（不挂单的卡）。 */
  track_url: string;
  /**
   * "multi_trip"：一单多团期，仍是普通可点卡片，多一个 `dates` 列表；
   * "unassigned"：号码 / 邮箱名下没挂单的对话，另一种交互卡片（见 MultiOrderCard），用下面几项。
   * 不是 Multi Orders 窗口的卡片时留空。
   */
  kind?: "multi_trip" | "unassigned";
  /** kind === "multi_trip" 时：这张单全部没出发的团期（卡片上逐行列出）。 */
  dates?: string[];
  /** kind === "unassigned" 时：对话地址（号码或邮箱），Reply / Assign / Take action 都按它找对话。 */
  address?: string;
  /** kind === "unassigned" 时：staff 已经回过、在等客人（不计入红胶囊，排在未处理的卡下面）。 */
  waiting?: boolean;
  /** kind === "unassigned" 时：Reply 实际会走的渠道（WhatsApp 窗口关了会退到 SMS / 邮件）。 */
  reply_channel?: string;
  /** kind === "unassigned" 时：这个地址名下没出发的单，Assign / Take action 的选项。 */
  orders?: MultiOrderOption[];
  /** kind === "unassigned" 时：完整对话；只有一条时卡片改显示 `body`（最后一句客人原话）。 */
  thread?: MultiThreadMessage[];
}

export interface UnhandledMessages {
  /** 洛杉矶的今天，YYYY-MM-DD。 */
  today: string;
  /** 早班追踪窗口的结束时刻，例如 "10:30 AM"。 */
  window_end: string;
  /** 后端已排好序：WhatsApp / 改期在前（最新在前），其余按出发日。 */
  lanes: Record<MessageLane, UnhandledMessage[]>;
  /** 三个窗口之和，不含 Multi Orders 里在等客人的卡（红胶囊数字）。 */
  count: number;
}

/** POST /booking-notes/multi/reply 的回包。 */
export interface MultiReplyResult {
  ok: boolean;
  channel: string;
  /** "sent" | "failed"；不是 "sent" 时卡片留着、文字也留着，staff 可以重试或改打电话。 */
  status: string | null;
}

/** POST /booking-notes/multi/assign 和 /multi/take-action 的回包：ok 之外的字段目前前端不用。 */
export interface MultiAssignResult {
  ok: boolean;
}
