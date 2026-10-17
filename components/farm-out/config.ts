import type { FarmOutPickupSpot } from "@/types/farm-out";

/**
 * Farm out 两个 Settings 页（Partners / Timetable）共用的小工具：金额格式、价格输入解析、
 * 时间 − 10 分钟算集合时间（只给页面看，不存，真正的集合时间由后端算，见 types/farm-out.ts
 * FarmOutOrderDetail.checkin_time 的注释）、下载 CSV。
 */

/** 110 → "$110.00"。 */
export function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** 输入框的文字 → 价格；空字符串（或纯空格）= null（没设）。非数字原样交给调用方判断。 */
export function parseRateField(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const TIME_RE = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i;

/**
 * "6:20" / "6:20 AM" → 早 10 分钟的那个时间，格式照原样（没有 AM/PM 的不加）。
 * 看不懂的格式（没按 H:MM 填）返回 null，页面上就不显示集合时间，不报错。
 */
export function computeCheckin(raw: string): string | null {
  const m = TIME_RE.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const suffix = m[3]?.toUpperCase();
  if (h < 1 || h > 12 || min < 0 || min > 59) return null;

  if (suffix) {
    const h24 = suffix === "PM" ? (h % 12) + 12 : h % 12;
    let total = h24 * 60 + min - 10;
    if (total < 0) total += 24 * 60;
    const newH24 = Math.floor(total / 60) % 24;
    const newMin = total % 60;
    const ampm = newH24 < 12 ? "AM" : "PM";
    let h12 = newH24 % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${String(newMin).padStart(2, "0")} ${ampm}`;
  }

  // 没写 AM/PM：按 12 小时表盘直接减，不猜上午下午（旧时刻表原表就是这么填的）。
  let total = h * 60 + min - 10;
  if (total < 0) total += 12 * 60;
  let h12 = Math.floor(total / 60);
  if (h12 === 0) h12 = 12;
  const newMin = total % 60;
  return `${h12}:${String(newMin).padStart(2, "0")}`;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * 当前表格 → CSV 文本（Hotel · Spot 一列 + 每个团一列）。类型里上车点只有一个 name 字段
 * （不分 Hotel / Spot 两列），所以表头用 "Hotel · Spot" 这一个合并列，和任务包原 CSV
 * 格式（Hotel, Spot 两列）不完全一样——这是跟着锁定的类型走的，后端真正做解析时要对一下。
 */
export function buildTimetableCsv(
  tours: { manifest_id: number; tour_name: string }[],
  spots: FarmOutPickupSpot[],
): string {
  const header = ["Hotel · Spot", ...tours.map((t) => t.tour_name)];
  const lines = [header.map(csvCell).join(",")];
  for (const spot of spots) {
    const row = [
      spot.name,
      ...tours.map((t) => spot.departures[t.manifest_id] ?? ""),
    ];
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** 触发浏览器下载一个文本文件（Download as CSV 用）。 */
export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 文件名里不适合做文件名的字符换成 "-"（公司名可能带空格 / 斜杠）。 */
export function safeFileSegment(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "partner";
}
