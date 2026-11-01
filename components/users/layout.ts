/**
 * Team 页的列顺序 / 列宽（Columns 键，10-28 Users / Team 合并 preview v3 Annie「动手」那批，当时等后端白名单）。
 * 存进账号偏好 team_list_layout（后端 92，格式同 HR 的 hr_list_layout：JSON 字符串 {order, widths}）。
 * Actions 列固定在最后，不参与拖动。Access / Notification duties / Home page 只给 Super Admin，没有时画表跳过。
 */
export const TEAM_COLUMNS = [
  "person",
  "role",
  "status",
  "teams",
  "access",
  "duties",
  "home",
] as const;
export type TeamColumn = (typeof TEAM_COLUMNS)[number];

/** 只给 Super Admin 的三列。 */
export const EXTRA_COLUMNS: ReadonlySet<TeamColumn> = new Set([
  "access",
  "duties",
  "home",
]);

export const TEAM_COLUMN_LABEL: Record<TeamColumn, string> = {
  person: "Person",
  role: "Role",
  status: "Status",
  teams: "Teams",
  access: "Access",
  duties: "Notification duties",
  home: "Home page",
};

export interface TeamLayout {
  order: TeamColumn[];
  widths: Partial<Record<TeamColumn, number>>;
}

export const MIN_COL_WIDTH = 40;
const MAX_COL_WIDTH = 2000;

export function defaultTeamLayout(): TeamLayout {
  return { order: [...TEAM_COLUMNS], widths: {} };
}

const isColumn = (k: unknown): k is TeamColumn =>
  typeof k === "string" && (TEAM_COLUMNS as readonly string[]).includes(k);

/** 只留认识、不重复的列；缺的列插回默认顺序里前一列的后面；宽度夹在 40–2000（同 HR 的 normalizeLayout）。 */
export function normalizeTeamLayout(raw: unknown): TeamLayout {
  const value = (raw && typeof raw === "object" ? raw : {}) as {
    order?: unknown;
    widths?: unknown;
  };
  const order: TeamColumn[] = [];
  if (Array.isArray(value.order))
    for (const k of value.order)
      if (isColumn(k) && !order.includes(k)) order.push(k);
  TEAM_COLUMNS.forEach((k, i) => {
    if (order.includes(k)) return;
    const prev = i > 0 ? order.indexOf(TEAM_COLUMNS[i - 1]) : -1;
    order.splice(prev + 1, 0, k);
  });
  const widths: TeamLayout["widths"] = {};
  if (value.widths && typeof value.widths === "object")
    for (const [k, w] of Object.entries(
      value.widths as Record<string, unknown>,
    ))
      if (isColumn(k) && typeof w === "number" && Number.isFinite(w))
        widths[k] = Math.round(
          Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, w)),
        );
  return { order, widths };
}

export function parseTeamLayout(text: string | null): TeamLayout | null {
  if (!text) return null;
  try {
    return normalizeTeamLayout(JSON.parse(text));
  } catch {
    return null;
  }
}
