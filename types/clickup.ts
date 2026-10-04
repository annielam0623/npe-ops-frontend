/**
 * ClickUp 的数据（后端原样转发，只列页面用到的字段）。
 * 时间都是毫秒时间戳字符串。
 */
export interface ClickUpUser {
  id: number;
  username: string;
  initials?: string;
  profilePicture?: string | null;
}

export interface ClickUpFieldOption {
  id: string;
  name: string;
  orderindex: number;
}

export interface ClickUpCustomField {
  id: string;
  name: string;
  value?: unknown;
  type_config?: { options?: ClickUpFieldOption[] };
}

export interface ClickUpTask {
  id: string;
  name: string;
  url: string;
  text_content?: string | null;
  status?: { status?: string; type?: string } | null;
  /** ClickUp 自带的优先级（Task Board 用）：urgent / high / normal / low。 */
  priority?: { priority?: string } | null;
  /** 截止日（毫秒字符串）。 */
  due_date?: string | null;
  /** 所属列表（「指派给我」跨列表时显示）。 */
  list?: { id?: string; name?: string } | null;
  assignees?: ClickUpUser[];
  date_created: string;
  date_updated: string;
  custom_fields?: ClickUpCustomField[];
}

export interface ClickUpAttachment {
  id: string;
  url: string;
  date: string;
  user?: { id?: number } | null;
}

export interface ClickUpTaskDetail extends ClickUpTask {
  attachments?: ClickUpAttachment[];
}

export interface ClickUpComment {
  id: string;
  comment_text?: string | null;
  date: string;
  user?: ClickUpUser | null;
}

export interface BugTaskList {
  tasks: ClickUpTask[];
  /** 后端翻页翻到上限还没到底：列表不完整，要告诉用户。 */
  truncated: boolean;
}

/** 新建 bug 的请求体（后端原样转给 ClickUp）。 */
export interface BugTaskCreate {
  name: string;
  description: string;
  assignees: number[];
  /** 截止日的毫秒时间戳（本地零点）；不设为 null。 */
  due_date: number | null;
  /** ClickUp 自带的优先级 1–4；不设为 null。 */
  priority: number | null;
  custom_fields: { id: string; value: string }[];
}

// ── Task Board ──────────────────────────────────────────────────────────────

export interface TaskBoardList {
  id: string;
  name: string;
  task_count: number;
  archived: boolean;
}

export interface TaskBoardLists {
  /** Supplier 文件夹里除池子以外的列表（Supplier 01、02…）。 */
  sprints: TaskBoardList[];
  pools: TaskBoardList[];
  pool_ids: { requirement: string; backlog: string; bug_pool: string };
}

export interface TaskBoardAssigned extends BugTaskList {
  /** 「指派给我」按固定邮箱查（后端环境变量），找不到这个人时为 null。 */
  resolved_user_id: number | null;
  email: string;
}

export interface ClickUpDocPage {
  id: string;
  name: string;
  /** Markdown。 */
  content?: string | null;
  pages?: ClickUpDocPage[];
}

export interface ClickUpDoc {
  id: string;
  name: string;
  date_updated?: string;
  pages: ClickUpDocPage[];
  /** 这份文档的页面取不到时为 "ClickUp <status>"。 */
  error: string | null;
}

export interface TaskBoardCreate {
  list_id: string;
  title: string;
  description: string;
  priority: number | null;
  assignee_id: number | null;
  due_date: number | null;
}
