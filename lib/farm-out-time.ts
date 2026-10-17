/** Farm out 的时间：接口是 "HH:MM"（24 小时），页面写 "6:50 AM"。 */

export function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const ap = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m[2]} ${ap}`;
}

/**
 * 读 staff 打的时间：6:50 / 6:50 AM / 06:50 / 6.50pm / 650。读不懂返回 null；空串返回 ""。
 * 没写 AM / PM 的按 24 小时读（时刻表都是早上，6:50 = 06:50）。
 */
export function parseTime(raw: string): string | null | "" {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  const m = /^(\d{1,2})(?:[:.](\d{2})|(\d{2}))?\s*(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? m[3] ?? "0");
  const ap = m[4]?.[0];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === "p" ? 12 : 0);
  } else if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function formatMoney(n: number | null | undefined): string {
  if (n == null) return "";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 读金额：$200 / 200.5 / 1,200；空串 → "" ；读不懂 null。 */
export function parseMoney(raw: string): number | null | "" {
  const s = raw.replace(/[$,\s]/g, "");
  if (!s) return "";
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}
