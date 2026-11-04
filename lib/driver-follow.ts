/**
 * G234（Annie 2026-11-03「换了司机以后，staff只需要去dispatch把司机改了，然后保存，就可以了，不需要再发送任何信息出去」，
 * preview https://claude.ai/artifact/CXT8ZueNa3akn1ZrGn4Ycj）：Dispatch 改了司机并 Save 后，这台车上已经发过短信的客人，
 * 追踪链接改跟新司机，不给客人发任何东西。这里是两页共用的字和形状。
 */

/** 客人这一行：发送后换过司机（没换过 = null）。改了几次时 from = 发送时的司机、to = 最新。 */
export interface DriverFollowed {
  /** 发送时的司机（常是 Excel 的写法，如 FREDDY）。 */
  from: string;
  /** 现在 Dispatch 的司机。 */
  to: string;
  /** ISO（洛杉矶时间）。 */
  at: string;
  /** 谁改的（staff 名）。 */
  by: string;
}

/** Dispatch 存（day / section / copy）回的：这次改了哪些客人的链接、哪几台车没改成。 */
export interface DriverFollowResult {
  /** 这次改跟新司机的、已发过短信的客人数。 */
  updated_orders: number;
  /** 每台改了的车一条（没有 = []）；car 是车的标签（如 Bus 2457）。 */
  updated: { car: string; from: string; to: string; orders: string[] }[];
  /** reason 是给 staff 看的英文句子，末尾没有句号。 */
  skipped: { car: string; reason: string }[];
}

/** 题 4 B：Driver changed after send (was FREDDY) — link now follows LUIS */
export function driverFollowedText(d: DriverFollowed): string {
  const was = d.from.trim() ? ` (was ${d.from.trim()})` : "";
  return `Driver changed after send${was} — link now follows ${d.to.trim()}`;
}

/** 题 7 A：Save 以后的灰字（括号里每台车「Bus 2457 → LUIS」，几台用逗号连）。 */
export function followUpdatedText(r: DriverFollowResult): string {
  const n = r.updated_orders;
  const cars = (r.updated ?? [])
    .map((u) => `${u.car.trim()} → ${u.to.trim()}`)
    .join(", ");
  return `Tracking links now follow the new driver for ${n} guest${n === 1 ? "" : "s"} who ${n === 1 ? "was" : "were"} already texted${cars ? ` (${cars})` : ""}. Nothing was sent to guests.`;
}

/** 题 7 A：没改成的车，红字。reason 原样，末尾加句号。 */
export function followSkippedText(s: { car: string; reason: string }): string {
  const reason = s.reason.trim().replace(/[.\s]+$/, "");
  return `${s.car}: links not changed — ${reason}.`;
}

/** 有没有要说的（全空 = 不出那一块）。 */
export function hasFollowNews(r: DriverFollowResult | null | undefined) {
  return !!r && (r.updated_orders > 0 || r.skipped.length > 0);
}
