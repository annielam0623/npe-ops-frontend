import type { ActionLogPage, ActionLogRow } from "@/types";

/**
 * G203：后端还没换成共用读接口（`{entries:[{at, by, action, label, what, from, to}], next_cursor}`）的页面，
 * 旧接口给的是整行 before / after（`{entries, limit}`，没有翻页），在这里比出变了的字段、拆成逐字段的行。
 * 后端换好以后，各页直接把新接口的结果交给面板，这个文件就只剩还没换的页面在用。
 */

/** 旧接口的一条（Pickup Locations / Products / Vehicles / HR 都是这个形状）。 */
export interface LegacyLogEntry {
  label: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: string;
  actor_name: string;
  created_at: string | null;
}

export interface LogField {
  key: string;
  /** 页面上看到的字段名。 */
  label: string;
}

export interface LegacyRowOptions {
  /** 要比的字段（按这个顺序出行）；可以按这一条算（例如车辆的自加列）。 */
  fields: readonly LogField[] | ((entry: LegacyLogEntry) => readonly LogField[]);
  /** 值怎么显示；默认原样转字符串，null / undefined 当空。 */
  show?: (key: string, value: unknown) => string;
  /** 修改时这个字段不写旧值、只写新值（例如车辆自加列原来是空的）。 */
  omitFrom?: (key: string, before: Record<string, unknown>) => boolean;
}

function plain(_key: string, value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

/**
 * 一条旧记录 → 几行：
 * 停用 / 恢复 = 一行 Status Active ↔ Inactive；新建 = 有值的字段各一行，只有 To；
 * 删除 = 全部字段各一行，只有 From（万一删错可以照着重建）；其余 = 变了的字段各一行。
 * 一个字段都没比出来时留一行只有名字的，至少看得到谁、什么时候、做了什么。
 */
export function legacyRows(
  entry: LegacyLogEntry,
  options: LegacyRowOptions,
): ActionLogRow[] {
  const show = options.show ?? plain;
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const base = {
    at: entry.created_at ?? "",
    by: entry.actor_name || entry.actor || "Unknown",
    action: entry.action,
    label: entry.label,
  };
  if (entry.action === "deactivate" || entry.action === "reactivate") {
    const active = entry.action === "reactivate";
    return [
      {
        ...base,
        what: "Status",
        from: active ? "Inactive" : "Active",
        to: active ? "Active" : "Inactive",
      },
    ];
  }
  const fields =
    typeof options.fields === "function" ? options.fields(entry) : options.fields;
  let rows: ActionLogRow[];
  if (entry.action === "create") {
    rows = fields
      .filter((f) => hasValue(after[f.key]))
      .map((f) => ({ ...base, what: f.label, from: null, to: show(f.key, after[f.key]) }));
  } else if (entry.action === "delete") {
    rows = fields.map((f) => ({
      ...base,
      what: f.label,
      from: show(f.key, before[f.key]),
      to: null,
    }));
  } else {
    rows = fields
      .filter(
        (f) =>
          f.key in after && show(f.key, before[f.key]) !== show(f.key, after[f.key]),
      )
      .map((f) => ({
        ...base,
        what: f.label,
        from:
          f.key in before && !options.omitFrom?.(f.key, before)
            ? show(f.key, before[f.key])
            : null,
        to: show(f.key, after[f.key]),
      }));
  }
  return rows.length ? rows : [{ ...base, what: null, from: null, to: null }];
}

/** 旧接口一页（没有翻页）→ 面板的一页；拿满 limit 条就标 capped。 */
export function legacyPage<T>(
  entries: readonly T[],
  limit: number,
  toRows: (entry: T) => ActionLogRow[],
): ActionLogPage {
  return {
    entries: entries.flatMap(toRows),
    next_cursor: null,
    capped: entries.length >= limit ? limit : null,
  };
}
