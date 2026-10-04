/** Settings → Human Resource（后端 app/routers/settings_hr.py）。全部 require_admin。 */

export type ExpiryState = "none" | "ok" | "soon" | "expired";

/**
 * 一个人的档案。文本 / 日期 / 单选字段没值时是 ""（不是 null）；日期是 "YYYY-MM-DD"。
 * 多选字段总是数组，按选项顺序排；库里不限制取值，可能有不认识的值。
 */
export interface HRProfile {
  id: number;
  user_id: number | null;
  legal_name: string;
  nickname: string;
  phone: string;
  personal_email: string;
  date_of_birth: string;
  license_number: string;
  license_state: string;
  license_class: string;
  license_expires: string;
  medical_card_expires: string;
  company: string;
  employment_status: string;
  job_class: string;
  position: string;
  badge_no: string;
  hired_on: string;
  separated_on: string;
  next_due: string;
  assignments: string[];
  limited: string[];
  languages: string[];
  emergency_name: string;
  emergency_phone: string;
  notes: string;
  /** 后端按洛杉矶的今天算好的（30 天内为 soon），前端不要自己算。 */
  license_expiry_state: ExpiryState;
  medical_expiry_state: ExpiryState;
}

export interface HRLinkableUser {
  id: number;
  label: string;
  role: "driver" | "guide";
}

export interface HRLogEntry {
  id: number;
  entity_id: string | null;
  label: string;
  action: "create" | "update" | "delete" | "export" | string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: string;
  actor_name: string;
  created_at: string | null;
}

export interface HRBulkResult {
  success: true;
  updated: number;
  /** 所有行都没字段时后端不返回这两个。 */
  missing?: number;
  unchanged?: number;
}

export type HRImportStatus =
  "new" | "exists" | "update" | "unchanged" | "duplicate_in_file";

export type HRImportRow = Record<string, string> & {
  status: HRImportStatus;
  /** 将要写入的字段 key。 */
  changed: string[];
  /** 文件里为空、因此不写的字段 key。 */
  blanked: string[];
};

export interface HRImportPreview {
  rows: HRImportRow[];
  /** 文件里认出的字段 key，按字段顺序。 */
  headers: string[];
  file_columns: string[];
  overwrite: boolean;
  counts: {
    new: number;
    exists: number;
    update: number;
    unchanged: number;
    duplicate: number;
  };
}

export interface HRImportResult {
  imported: number;
  updated: number;
  unchanged: number;
  skipped: number;
  skipped_names: string[];
  vanished: number;
}
