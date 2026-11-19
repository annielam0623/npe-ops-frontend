/**
 * 换班的「晚接早」规则（G298 / 前端 142，Annie 2026-11-18 动手时加的原话：「还是要遵守晚班上完不能接open和moring，
 * 当发生的时候要告诉staff这个规则所以让她改一天」）：
 * 前一天上了 Close，第二天不能上 Open / Morning。换了以后任何一方会出现这种情况 ⇒ 挡下来，红字写明规则、让她换一天。
 *
 * 用词照排班 Rules 里现有的 after_shift 规则（「After a Close, no Open the next day」）。员工读不到排班规则，
 * 所以这里按班次的 key / 名字认：名字或 key 里有「clos」= Close；有「open」/「morning」= Open / Morning。
 * 只看这一周里的班（员工页只拿到这一周）；跨周（周六 Close、下周日 Open）由后端挡。
 */

export interface RestSlot {
  id: number;
  date: string;
  shift_type: string;
  employee_id: number | null;
}

export interface RestLabels {
  /** 班次 key → 显示名（Open / Close…）。 */
  typeLabel: (key: string) => string;
  /** YYYY-MM-DD → 「Fri 11/27」。 */
  dayText: (ymd: string) => string;
  /** 员工 id → 名字；是看页面的本人时返回 null（写成 You）。 */
  nameOf: (id: number) => string | null;
}

export const REST_RULE_TEXT =
  "A Close shift can't be followed by an Open or Morning shift the next day.";

function isClose(key: string, label: string): boolean {
  return /clos/i.test(key) || /clos/i.test(label);
}

function isEarly(key: string, label: string): boolean {
  return /open|morning/i.test(key) || /open|morning/i.test(label);
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * 这两个班对调以后，有没有人「前一天 Close、第二天 Open / Morning」。
 * 有 ⇒ 返回给 staff 看的英文红字；没有 ⇒ null。两个班有一个已经没人（被改过）⇒ null（交给后端）。
 */
export function swapRestProblem(
  slots: readonly RestSlot[],
  aSlotId: number,
  bSlotId: number,
  labels: RestLabels,
): string | null {
  const a = slots.find((s) => s.id === aSlotId);
  const b = slots.find((s) => s.id === bSlotId);
  if (!a || !b || a.employee_id == null || b.employee_id == null) return null;
  const after = slots.map((s) =>
    s.id === a.id
      ? { ...s, employee_id: b.employee_id }
      : s.id === b.id
        ? { ...s, employee_id: a.employee_id }
        : s,
  );
  // 只报换过去的那个班引起的：被换来的班是第二天的早班，或是前一天的 Close。
  for (const [moved, person] of [
    [a, b.employee_id],
    [b, a.employee_id],
  ] as const) {
    const mine = after.filter((s) => s.employee_id === person);
    for (const prev of mine) {
      const next = mine.find((s) => s.date === nextDay(prev.date));
      if (!next) continue;
      if (prev.id !== moved.id && next.id !== moved.id) continue;
      const pl = labels.typeLabel(prev.shift_type);
      const nl = labels.typeLabel(next.shift_type);
      if (!isClose(prev.shift_type, pl) || !isEarly(next.shift_type, nl))
        continue;
      const who = labels.nameOf(person);
      return `${who ?? "You"} can't work ${nl} on ${labels.dayText(next.date)} after a ${pl} on ${labels.dayText(prev.date)}. ${REST_RULE_TEXT} Pick another day.`;
    }
  }
  return null;
}
