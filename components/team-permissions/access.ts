import type { PermModule } from "@/types";

/**
 * Team 页的「档位」（Annie 2026-10-25，preview 第 4 版「动手」）：
 * 每个模块只分 Read only / Read & edit（「所有职权只包括read only，read & edit」）；发送、导出、发布、删除等都算 edit；
 * 分不出看和改的（只有一项，或没有「看」项）只有 None / Full access。
 * 后端仍按单项存（perm_user_items）：选档 = 把这一行的项换成对应的一组；读回来由项算档，对不上的是 custom，原样保留。
 */

export type AccessKind = "read-edit" | "on-off";
export type AccessLevel = "none" | "read" | "edit" | "custom";

export interface AccessRow {
  key: string;
  /** 所属模块（「Not active yet」看它的 wired）。 */
  module: string;
  label: string;
  kind: AccessKind;
  /** Read only 包含的项（on-off 为空）。 */
  read: string[];
  /** Read & edit / Full access 包含的项。 */
  all: string[];
}

export interface AccessGroup {
  /** 一个模块一行；Settings 是一组多行。 */
  kind: "row" | "group";
  key: string;
  label: string;
  module: string;
  rows: AccessRow[];
}

/** 改报价价目表（含活动日历）不归 My Workspace 的 Full access（Annie「Full 不含改价目表」），放进 Settings 单独一行。 */
const RATES_ITEM = "quotation.rates_edit";

/** Tasks 的 Read only 只看自己的（Annie「看自己的」）。 */
const READ_OVERRIDES: Readonly<Record<string, string[]>> = {
  tasks: ["tasks.view_own"],
};

/** 每行下面的固定说明。 */
export const ACCESS_NOTES: Readonly<Record<string, string>> = {
  report:
    "Everyone can edit the report entries they logged themselves. Read & edit adds Edit report entries: edit everyone's report entries.",
};

const isView = (code: string) => /\.view(_own|_all)?$/.test(code);

function moduleRow(
  mod: PermModule,
  codes: string[],
  key = mod.code,
): AccessRow {
  const read = (READ_OVERRIDES[mod.code] ?? codes.filter(isView)).filter((c) =>
    codes.includes(c),
  );
  const split = read.length > 0 && read.length < codes.length;
  return {
    key,
    module: mod.code,
    label: mod.display_name,
    kind: split ? "read-edit" : "on-off",
    read: split ? read : [],
    all: codes,
  };
}

/** 去掉「Settings: 」前缀，组里每页只写页名。 */
function settingsLabel(name: string) {
  return name.replace(/^Settings:\s*/i, "");
}

/** 由后端 catalog 排出页面上的行；以后迁移加了项，自动落进它模块的那一行（Settings 新项各占一行）。 */
export function buildAccessGroups(modules: PermModule[]): AccessGroup[] {
  const groups: AccessGroup[] = [];
  let ratesLabel: string | null = null;
  for (const mod of modules) {
    const codes = mod.items.map((i) => i.code);
    if (mod.code === "settings") {
      const hr = codes.filter((c) => c.startsWith("settings.hr."));
      const rows: AccessRow[] = [];
      if (hr.length) {
        rows.push({
          key: "settings.hr",
          module: "settings",
          label: "Human Resource (HR profiles)",
          kind: hr.length > 1 ? "read-edit" : "on-off",
          read: hr.length > 1 ? hr.filter(isView) : [],
          all: hr,
        });
      }
      for (const item of mod.items) {
        if (!item.code.startsWith("settings.hr.")) {
          rows.push({
            key: item.code,
            module: "settings",
            label: settingsLabel(item.display_name),
            kind: "on-off",
            read: [],
            all: [item.code],
          });
        }
      }
      groups.push({
        kind: "group",
        key: "settings",
        label: mod.display_name,
        module: "settings",
        rows,
      });
      continue;
    }
    let own = codes;
    if (codes.includes(RATES_ITEM)) {
      own = codes.filter((c) => c !== RATES_ITEM);
      ratesLabel =
        mod.items.find((i) => i.code === RATES_ITEM)?.display_name ?? null;
    }
    if (own.length) {
      const row = moduleRow(mod, own);
      groups.push({
        kind: "row",
        key: row.key,
        label: row.label,
        module: mod.code,
        rows: [row],
      });
    }
  }
  if (ratesLabel !== null) {
    const settings = groups.find((g) => g.key === "settings");
    const row: AccessRow = {
      key: RATES_ITEM,
      module: "settings",
      label: "Quotation rates (rate card and event calendar)",
      kind: "on-off",
      read: [],
      all: [RATES_ITEM],
    };
    if (settings) {
      settings.rows.push(row);
    } else {
      groups.push({
        kind: "row",
        key: RATES_ITEM,
        label: row.label,
        module: "settings",
        rows: [row],
      });
    }
  }
  return groups;
}

export function levelOf(
  row: AccessRow,
  items: ReadonlySet<string>,
): AccessLevel {
  const have = row.all.filter((c) => items.has(c)).length;
  if (have === 0) {
    return "none";
  }
  if (have === row.all.length) {
    return "edit";
  }
  if (
    row.kind === "read-edit" &&
    have === row.read.length &&
    row.read.every((c) => items.has(c))
  ) {
    return "read";
  }
  return "custom";
}

/** 选一档：先清掉这一行的项，再放进这一档的项（其他行不动）。 */
export function withLevel(
  row: AccessRow,
  level: Exclude<AccessLevel, "custom">,
  items: ReadonlySet<string>,
): Set<string> {
  const next = new Set(items);
  for (const c of row.all) {
    next.delete(c);
  }
  for (const c of level === "edit"
    ? row.all
    : level === "read"
      ? row.read
      : []) {
    next.add(c);
  }
  return next;
}

export const LEVEL_OPTIONS: Readonly<
  Record<
    AccessKind,
    readonly { level: "none" | "read" | "edit"; label: string }[]
  >
> = {
  "read-edit": [
    { level: "none", label: "None" },
    { level: "read", label: "Read only" },
    { level: "edit", label: "Read & edit" },
  ],
  "on-off": [
    { level: "none", label: "None" },
    { level: "edit", label: "Full access" },
  ],
};

export interface AccessSummary {
  /** 有任何权限的模块数（Settings 算一个）。 */
  modules: number;
  /** 只读的模块数。 */
  readOnly: number;
  /** 和档位对不上的行数。 */
  custom: number;
}

export function summarize(
  groups: AccessGroup[],
  items: ReadonlySet<string>,
): AccessSummary {
  const out: AccessSummary = { modules: 0, readOnly: 0, custom: 0 };
  for (const group of groups) {
    const levels = group.rows.map((r) => levelOf(r, items));
    if (levels.some((l) => l !== "none")) {
      out.modules += 1;
    }
    out.custom += levels.filter((l) => l === "custom").length;
    if (group.kind === "row" && levels[0] === "read") {
      out.readOnly += 1;
    }
  }
  return out;
}
