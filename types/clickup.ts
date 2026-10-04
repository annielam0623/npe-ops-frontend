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
  status?: { status?: string } | null;
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
