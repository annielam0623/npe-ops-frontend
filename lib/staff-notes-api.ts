import { apiFetch } from "@/lib/api-client";

/**
 * ★ Note 打通 + @（Annie 2026-11-21「其他问题全部同意推荐，动手」，preview https://claude.ai/artifact/9BLMZq2ShCAZeVpbQ1j21A v3）。
 * 一套存储：booking_notes direction = staff_note。三处写（Tracking 对话框 Save note / Main manifest Notes 格 / Order details ★ Notes 卡），
 * 三处读；按产品分开（Q2 B），整单的（product_code null，含旧的 19 条）每个产品行都出、标「Order note」；
 * 能打开页面的 staff 都能写（Q3），partner 三处都不回。
 * 形状照后端合同 v1（ab，2026-11-21，经 5e 转；后端还没上 main，migrate v181）。
 */

/** 正文最长几个字（后端同样挡，trim 后 1–2000）。 */
export const STAFF_NOTE_MAX = 2000;

export type StaffNoteSource =
  "tracking" | "manifest" | "order_details" | "migrated";

export interface StaffNoteMention {
  user_id: number;
  name: string;
  notified?: boolean;
}

export interface StaffNoteTeamMention {
  team_id: number;
  name: string;
  /** 这次通知了几个人（展开 team、去掉写的人、去重、去掉 partner 之后）。 */
  notified?: number | null;
}

/** 一条 ★ Note（合同 Note）。 */
export interface StaffNote {
  id: number;
  order_number?: string;
  /** null = 整单的（旧数据 / 没分产品），每个产品行都出、标「Order note」。 */
  product_code: string | null;
  product_name?: string | null;
  body: string;
  source?: StaffNoteSource | null;
  author: { username: string; display_name: string | null } | null;
  /** ISO。 */
  created_at: string;
  mentions?: StaffNoteMention[];
  mention_teams?: StaffNoteTeamMention[];
}

export function noteAuthor(n: StaffNote): string {
  return (n.author?.display_name ?? "").trim() || n.author?.username || "—";
}

export interface StaffNoteProduct {
  code: string;
  name: string;
}

export interface StaffNoteCreate {
  order_number: string;
  /** 单只有一个产品时后端自动带（前端也照样传）；多个没给 ⇒ 400。 */
  product_code: string | null;
  body: string;
  source: Exclude<StaffNoteSource, "migrated">;
  mentions: number[];
  mention_team_ids: number[];
}

/**
 * 写一条 ★ Note（只加不改不删）。201 {note}。404 = 这单不在 Order List；400 = 多产品没选 / 产品不在这单 / @ 的人不对（detail 英文原话）。
 */
export async function createStaffNote(
  input: StaffNoteCreate,
): Promise<StaffNote> {
  const r = await apiFetch<{ note: StaffNote }>("/api/staff-notes", {
    method: "POST",
    body: input,
  });
  return r.note;
}

export interface OrderStaffNotes {
  order_number: string;
  products: StaffNoteProduct[];
  /** 最新在前。 */
  notes: StaffNote[];
}

/** 一单的 ★ Note + 产品（给 product_code ⇒ 这个产品的 + 整单的）。404 = 不在 Order List。 */
export function fetchOrderStaffNotes(
  orderNumber: string,
  signal?: AbortSignal,
  productCode?: string,
): Promise<OrderStaffNotes> {
  return apiFetch<OrderStaffNotes>("/api/staff-notes", {
    cache: "no-store",
    signal,
    query: { order_number: orderNumber, product_code: productCode },
  });
}

/** @ 下拉里的一个人（员工，不含合作方、司机、导游、停用的、自己；在线的在前，Q1 A）。 */
export interface MentionPerson {
  id: number;
  display_name: string;
  /** 所在 team 的名字（下拉里写在名字后面）。 */
  teams?: string[];
  online?: boolean;
}

/** @ 下拉里的一个 team（Settings › Teams；人数只算员工，Q9 A）。 */
export interface MentionTeam {
  id: number;
  name: string;
  member_count: number;
}

export interface MentionDirectory {
  teams: MentionTeam[];
  people: MentionPerson[];
}

/** @ 名单：GET /api/staff-notes/directory。 */
export function fetchMentionDirectory(
  signal?: AbortSignal,
): Promise<MentionDirectory> {
  return apiFetch<MentionDirectory>("/api/staff-notes/directory", {
    cache: "no-store",
    signal,
  });
}

const CSV_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** 同后端 staff_notes_csv 的时间写法「Nov 21 2:05 PM」（洛杉矶）。 */
export function formatCsvNoteTime(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? iso : CSV_TIME.format(t).replace(",", "");
}

/** 最新的在前（同 Activity 卡）。ISO 时间按字符串比不可靠（时区写法不同）⇒ 转成毫秒比。 */
export function newestFirst<T extends { created_at: string; id: number }>(
  notes: readonly T[],
): T[] {
  const ms = (s: string) => {
    const t = new Date(s).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  return [...notes].sort(
    (a, b) => ms(b.created_at) - ms(a.created_at) || b.id - a.id,
  );
}
