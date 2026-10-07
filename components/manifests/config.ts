import { LA_TIME_ZONE } from "@/lib/la-date";
import type {
  ManifestField,
  ManifestPage,
  ManifestRow,
  ManifestTabKey,
  ManifestValue,
} from "@/types";

export const TAB_KEYS: readonly ManifestTabKey[] = ["bus", "tickets"];

export function isTabKey(value: string | null): value is ManifestTabKey {
  return value === "bus" || value === "tickets";
}

/** 两个标签各存各的列选择（后端契约 D）。 */
export const PREF_KEY = {
  bus: "manifest_cols_bus",
  tickets: "manifest_cols_tickets",
} as const;

/** staff 填的确认号那一列：表格里做成输入框。 */
export const STAFF_CFM_KEY = "staff_cfm";

/**
 * 账号里存的列选择：JSON 字段键数组。坏值 / 没存过 / 空数组都当「用后端默认列」（null）。
 * 今天没出现的键（unknown）、没权限的键（denied）照样留在里面，不删。
 */
export function parseSavedFields(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const keys = parsed.filter(
      (k): k is string => typeof k === "string" && k !== "",
    );
    return keys.length ? [...new Set(keys)] : null;
  } catch {
    return null;
  }
}

const LA_DATETIME = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** ISO（带时区）→ 洛杉矶时间「Oct 7, 2026, 3:54 PM」；解析不了原样返回。 */
export function formatLaDateTime(iso: string): string {
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? iso : LA_DATETIME.format(time);
}

function formatMoney(value: number, currency: ManifestValue): string {
  const code = typeof currency === "string" ? currency.trim() : "";
  if (/^[A-Za-z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code.toUpperCase(),
      }).format(value);
    } catch {
      // 不认识的币种代码：落到下面的纯数字。
    }
  }
  return value.toFixed(2);
}

/**
 * 一格的显示文字，按目录里的 type（契约 A）：datetime 换成洛杉矶时间；date、text 原样
 * （start_time / end_time 是 Rezdy 的当地时间原文，type 是 text，不换时区）；空值返回空串。
 */
export function formatValue(
  field: ManifestField | undefined,
  value: ManifestValue | undefined,
  row: ManifestRow,
): string {
  if (value === null || value === undefined || value === "") return "";
  switch (field?.type) {
    case "bool":
      return value === true || value === "true" ? "Yes" : "No";
    case "datetime":
      return typeof value === "string"
        ? formatLaDateTime(value)
        : String(value);
    case "money":
      return typeof value === "number"
        ? formatMoney(value, row.values.currency)
        : String(value);
    default:
      return typeof value === "boolean"
        ? value
          ? "Yes"
          : "No"
        : String(value);
  }
}

export function isLegacy(row: ManifestRow): boolean {
  return row.lane_source === "legacy";
}

/** 当前这一页（标签 + 胶囊）的 CSV：列 = 屏幕上的列，最后加一列标出老数据。 */
export function buildCsv(data: ManifestPage): {
  headers: string[];
  rows: (string | number)[][];
} {
  const byKey = new Map(data.catalog.map((f) => [f.key, f]));
  const headers = [
    ...data.fields.map((k) => byKey.get(k)?.label ?? k),
    "Legacy data",
  ];
  const rows = data.rows.map((r) => [
    ...data.fields.map((k) => {
      const field = byKey.get(k);
      const value = r.values[k];
      // 数字 / 金额导出原值，Excel 能直接算。
      if (
        typeof value === "number" &&
        (field?.type === "number" || field?.type === "money")
      ) {
        return value;
      }
      return formatValue(field, value, r);
    }),
    isLegacy(r) ? "legacy" : "",
  ]);
  return { headers, rows };
}

/** 文件名里的胶囊名：只留字母数字，其余换成 -。 */
export function csvFilename(data: ManifestPage): string {
  const pill = data.pills.find((p) => p.key === data.pill);
  const slug = (pill?.label ?? "all")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `manifest_${data.date}_${data.tab}_${slug || "all"}.csv`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
