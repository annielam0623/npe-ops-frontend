/**
 * My Workspace（后端 G66 阶段一，confirm `9392bf5`，migrate_v91）。接口见 lib/workspace-api.ts。
 * ⚠️ 原文、标题、文件名、读取失败原因、人名、历史里都可能有客人邮件内容：一律当普通文字渲染（React 默认转义），不能用 dangerouslySetInnerHTML。
 */

export interface WorkspaceDestination {
  id: number;
  /** 去向代码（tcq = Transfer & Charter Quotation）。 */
  code: string;
  name: string;
  description: string;
  accepts_text: boolean;
  accepts_file: boolean;
}

export interface WorkspaceDestinations {
  destinations: WorkspaceDestination[];
  /** false：没有任何去向收文件 ⇒ 不显示 Upload 标签。 */
  show_upload: boolean;
  upload_max_bytes: number;
  /** 例：["xlsx","csv","pdf","docx"]。 */
  upload_types: string[];
}

export interface WorkspaceStatus {
  code: string;
  name: string;
  /** "#rrggbb"。 */
  color: string;
  sort_order: number;
  is_active: boolean;
  /** 已关闭（Done / Cancelled 这类）：My work 默认不显示。 */
  is_closed: boolean;
}

export interface WorkspaceItemSummary {
  id: number;
  item_no: string;
  title: string;
  source: "paste" | "file";
  status_code: string;
  status_name: string | null;
  status_color: string | null;
  is_closed: boolean;
  next_step: string;
  /** 读取失败过（read_error 不为空）。 */
  read_failed: boolean;
  owner_id: number;
  owner_name: string;
  destination_code: string;
  destination_name: string;
  /** ISO。 */
  created_at: string;
  updated_at: string;
}

export interface WorkspaceItemList {
  items: WorkspaceItemSummary[];
  /** 超过 500 条只给前 500。 */
  truncated: boolean;
  /** 这个范围（Mine / Whole team）里每个状态的数量。 */
  counts: Record<string, number>;
}

export interface WorkspaceFile {
  id: number;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export interface WorkspaceHistoryEntry {
  /** create / update / assign。 */
  action: string;
  /** 只有元信息（状态、负责人、标题），不含内容。 */
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  actor: string;
  actor_name: string | null;
  created_at: string;
}

export interface WorkspaceItem extends WorkspaceItemSummary {
  raw_text: string;
  /** 系统读出来的结果（各去向自己的格式）；读不出来为 null。 */
  parsed: unknown;
  /** staff 改过的内容；没改过为 null。 */
  edited: unknown;
  /** 读不出来的原因；读出来了为 ""。 */
  read_error: string;
  files: WorkspaceFile[];
  /** 新的在前。 */
  history: WorkspaceHistoryEntry[];
}

export interface WorkspaceItemPatch {
  edited?: unknown;
  title?: string;
  status?: string;
  next_step?: string;
}

export interface WorkspaceColleague {
  id: number;
  name: string;
}

// ── Settings → My Workspace（admin）──

export interface WorkspaceDestinationSetting extends WorkspaceDestination {
  is_enabled: boolean;
  sort_order: number;
}

export interface WorkspaceGeneral {
  /** 1–10 位字母 / 数字 / - / _。 */
  item_prefix: string;
  /** 1–25。 */
  upload_max_mb: number;
  upload_types: string[];
}

export interface WorkspaceSettings {
  destinations: WorkspaceDestinationSetting[];
  statuses: WorkspaceStatus[];
  general: WorkspaceGeneral;
  /** 读文件的程序认得的类型；upload_types 只能从这里选。 */
  readable_types: string[];
}
