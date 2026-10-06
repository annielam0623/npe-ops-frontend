import type { ExpiryState, HRProfile } from "@/types";

/**
 * 照抄后端 app/services/hr_profiles.py 的 FIELDS（后端没有字段元数据接口）。
 * ⚠️ 后端改字段、选项、长度时这里要跟着改。
 */
export type FieldKind =
  "text" | "date" | "phone" | "email" | "choice" | "multi";
export type FieldGroup =
  "identity" | "license" | "employment" | "dispatch" | "emergency" | "notes";

export interface HRField {
  key: string;
  label: string;
  kind: FieldKind;
  /** 与库里 VARCHAR 一致；超长后端直接拒绝。 */
  maxlen?: number;
  group: FieldGroup;
  choices?: ReadonlyArray<readonly [string, string]>;
  hint?: string;
}

export const POSITION_CHOICES = [
  ["", "—"],
  ["driver", "Driver"],
  ["guide", "Guide"],
  ["both", "Driver + Guide"],
] as const;

const EMPLOYMENT_STATUS_CHOICES = [
  ["", "—"],
  ["full_time", "Full-Time"],
  ["part_time", "Part-Time"],
] as const;

const JOB_CLASS_CHOICES = [
  ["", "—"],
  ["driver", "Driver"],
  ["non_cdl_driver", "NON CDL Driver"],
] as const;

const ASSIGNMENT_CHOICES = [
  ["morning_relay", "Morning Relay"],
  ["bus_tour", "Bus Tour"],
  ["private_tour", "Private Tour"],
] as const;

const LIMITED_CHOICES = [["in_town_only", "In Town Only"]] as const;

const LANGUAGE_CHOICES = [
  ["english", "English"],
  ["spanish", "Spanish"],
  ["japanese", "Japanese"],
  ["french", "French"],
  ["mandarin", "Mandarin"],
  ["cantonese", "Cantonese"],
  ["korean", "Korean"],
] as const;

export const FIELDS: readonly HRField[] = [
  {
    key: "legal_name",
    label: "Legal Name",
    kind: "text",
    maxlen: 120,
    group: "identity",
  },
  {
    key: "nickname",
    label: "Nickname",
    kind: "text",
    maxlen: 60,
    group: "identity",
  },
  {
    key: "phone",
    label: "Mobile",
    kind: "phone",
    maxlen: 30,
    group: "identity",
    hint: "Used for dispatch change notices. Include the country code for non-US numbers, e.g. +44…",
  },
  {
    key: "personal_email",
    label: "Personal Email",
    kind: "email",
    maxlen: 160,
    group: "identity",
  },
  {
    key: "date_of_birth",
    label: "Date of Birth",
    kind: "date",
    group: "identity",
  },
  {
    key: "license_number",
    label: "License #",
    kind: "text",
    maxlen: 40,
    group: "license",
  },
  {
    key: "license_state",
    label: "State",
    kind: "text",
    maxlen: 2,
    group: "license",
  },
  {
    key: "license_class",
    label: "Class",
    kind: "text",
    maxlen: 20,
    group: "license",
  },
  {
    key: "license_expires",
    label: "License Expires",
    kind: "date",
    group: "license",
  },
  {
    key: "medical_card_expires",
    label: "Medical Card Expires",
    kind: "date",
    group: "license",
  },
  {
    key: "company",
    label: "Company",
    kind: "text",
    maxlen: 80,
    group: "employment",
  },
  {
    key: "employment_status",
    label: "Status",
    kind: "choice",
    group: "employment",
    choices: EMPLOYMENT_STATUS_CHOICES,
  },
  {
    key: "job_class",
    label: "Job Class",
    kind: "choice",
    group: "employment",
    choices: JOB_CLASS_CHOICES,
  },
  {
    key: "position",
    label: "Position",
    kind: "choice",
    group: "employment",
    choices: POSITION_CHOICES,
  },
  {
    key: "badge_no",
    label: "Code",
    kind: "text",
    maxlen: 30,
    group: "employment",
  },
  { key: "hired_on", label: "Hired On", kind: "date", group: "employment" },
  {
    key: "separated_on",
    label: "Separated On",
    kind: "date",
    group: "employment",
  },
  { key: "next_due", label: "Next Due", kind: "date", group: "employment" },
  {
    key: "assignments",
    label: "Assignment",
    kind: "multi",
    group: "dispatch",
    choices: ASSIGNMENT_CHOICES,
    hint: "On the dispatch page, each section only lists drivers ticked for it.",
  },
  {
    key: "limited",
    label: "Limited",
    kind: "multi",
    group: "dispatch",
    choices: LIMITED_CHOICES,
  },
  {
    key: "languages",
    label: "Language",
    kind: "multi",
    group: "dispatch",
    choices: LANGUAGE_CHOICES,
  },
  // 后端 v74（2026-10-06，待办 G27 发送后换车）：客人追踪按它去 Samsara 查司机现在在哪台车。
  // 只查长度不查格式；非空不能和别人重复（后端回 400）。
  {
    key: "samsara_driver_id",
    label: "Samsara Driver ID",
    kind: "text",
    maxlen: 40,
    group: "dispatch",
  },
  {
    key: "emergency_name",
    label: "Emergency Contact",
    kind: "text",
    maxlen: 120,
    group: "emergency",
  },
  {
    key: "emergency_phone",
    label: "Emergency Phone",
    kind: "phone",
    maxlen: 30,
    group: "emergency",
  },
  { key: "notes", label: "Notes", kind: "text", group: "notes" },
];

export const FIELD_BY_KEY: Record<string, HRField> = Object.fromEntries(
  FIELDS.map((f) => [f.key, f]),
);

export const GROUPS: ReadonlyArray<readonly [FieldGroup, string]> = [
  ["identity", "Identity"],
  ["license", "Driver License"],
  ["employment", "Employment"],
  ["dispatch", "Dispatch"],
  ["emergency", "Emergency Contact"],
  ["notes", "Notes"],
];

/**
 * 列表的列（也是 Edit list 能改的列，后端 bulk 的白名单）。
 * 默认顺序按 Annie 2026-09-30 定的（后端分支 task/hr-list-columns）：排班最常看的在前。
 * 旧页面（main）还是 Legal Name、Nickname、Position、Mobile、License #、两个到期日、Assignment…
 */
export const LIST_FIELD_KEYS = [
  "legal_name",
  "nickname",
  "position",
  "phone",
  "assignments",
  "limited",
  "languages",
  "license_number",
  "license_expires",
  "medical_card_expires",
  // v74：司机逐个填，列表上能直接改（后端 LIST_COLUMNS 同样加在最后）。
  "samsara_driver_id",
] as const;

export const LOGIN_COLUMN = "__login";
export const DEFAULT_COLUMNS: readonly string[] = [
  ...LIST_FIELD_KEYS,
  LOGIN_COLUMN,
];

export function columnLabel(key: string): string {
  return key === LOGIN_COLUMN
    ? "Login Account"
    : (FIELD_BY_KEY[key]?.label ?? key);
}

export function fieldLabel(key: string): string {
  return FIELD_BY_KEY[key]?.label ?? key;
}

/** 单选显示标签；不认识的值原样显示；空值 —。 */
export function choiceText(field: HRField, value: string): string {
  if (!value) return "—";
  return field.choices?.find(([v]) => v === value)?.[1] ?? value;
}

export function multiText(field: HRField, values: string[]): string {
  if (values.length === 0) return "—";
  return values
    .map((v) => field.choices?.find(([c]) => c === v)?.[1] ?? v)
    .join(", ");
}

export function displayValue(profile: HRProfile, key: string): string {
  const field = FIELD_BY_KEY[key];
  const raw = (profile as unknown as Record<string, unknown>)[key];
  if (!field) return String(raw ?? "");
  if (field.kind === "multi") return multiText(field, (raw as string[]) ?? []);
  if (field.kind === "choice") return choiceText(field, (raw as string) ?? "");
  return (raw as string) || "—";
}

export const EXPIRY_KEY: Record<
  string,
  "license_expiry_state" | "medical_expiry_state"
> = {
  license_expires: "license_expiry_state",
  medical_card_expires: "medical_expiry_state",
};

export const EXPIRY_STYLE: Record<ExpiryState, string> = {
  ok: "bg-[#e6f4ec] text-[#1e6b43]",
  soon: "bg-[#fdf1dd] text-[#8a5a00]",
  expired: "bg-[#fdeceb] text-[#b3261e]",
  none: "bg-[#f0f0ee] text-[#888]",
};

export const EXPIRY_SUFFIX: Record<ExpiryState, string> = {
  ok: "",
  none: "",
  soon: " · due soon",
  expired: " · expired",
};

// ── 列顺序 / 列宽（存进账号的 hr_list_layout，格式与旧页面分支一致，两边互通） ──

export interface ListLayout {
  order: string[];
  widths: Record<string, number>;
}

export const MIN_COL_WIDTH = 40;
const MAX_COL_WIDTH = 2000;

export function defaultLayout(): ListLayout {
  return { order: [...DEFAULT_COLUMNS], widths: {} };
}

/** 只留认识、不重复的列；缺的列插回默认顺序里前一列的后面；宽度夹在 40–2000。 */
export function normalizeLayout(raw: unknown): ListLayout {
  const value = (raw && typeof raw === "object" ? raw : {}) as {
    order?: unknown;
    widths?: unknown;
  };
  const order: string[] = [];
  if (Array.isArray(value.order)) {
    for (const k of value.order) {
      if (
        typeof k === "string" &&
        DEFAULT_COLUMNS.includes(k) &&
        !order.includes(k)
      ) {
        order.push(k);
      }
    }
  }
  DEFAULT_COLUMNS.forEach((k, i) => {
    if (order.includes(k)) return;
    const prev = i > 0 ? order.indexOf(DEFAULT_COLUMNS[i - 1]) : -1;
    order.splice(prev + 1, 0, k);
  });
  const widths: Record<string, number> = {};
  if (value.widths && typeof value.widths === "object") {
    for (const [k, w] of Object.entries(
      value.widths as Record<string, unknown>,
    )) {
      if (
        DEFAULT_COLUMNS.includes(k) &&
        typeof w === "number" &&
        Number.isFinite(w)
      ) {
        widths[k] = Math.round(
          Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, w)),
        );
      }
    }
  }
  return { order, widths };
}

export function parseLayout(text: string | null): ListLayout | null {
  if (!text) return null;
  try {
    return normalizeLayout(JSON.parse(text));
  } catch {
    return null;
  }
}

// ── Edit list：每格的值统一成字符串比较（多选是按选项顺序的逗号串，同后端 bulk 接受的格式） ──

export function cellValue(profile: HRProfile, key: string): string {
  const raw = (profile as unknown as Record<string, unknown>)[key];
  if (Array.isArray(raw)) return raw.join(",");
  return (raw as string) ?? "";
}

export function toggleMulti(
  field: HRField,
  current: string,
  value: string,
  on: boolean,
): string {
  const set = new Set(current ? current.split(",") : []);
  if (on) set.add(value);
  else set.delete(value);
  const known = (field.choices ?? []).map(([v]) => v).filter((v) => set.has(v));
  const unknown = [...set].filter((v) => !known.includes(v));
  return [...known, ...unknown].join(",");
}
