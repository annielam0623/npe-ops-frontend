/**
 * 全站 ⬆ Import 的标准接口形状（前端提给后端的，HR 之后的每页都照这个做）：
 * `POST <base>/preview`（multipart `file`，只读）→ `ImportPreviewResponse`；
 * `POST <base>/commit`（同一个文件，只写 new / update 行，一个事务）→ `ImportCommitResult`。
 */
export interface ImportPreviewRow {
  status: "new" | "update" | "unchanged" | "error";
  /** 对上的记录；新建的是 null。 */
  id: number | null;
  /** 显示用的文字（开关写 Yes / No）。 */
  values: Record<string, string>;
  /** 要改的栏改前的值。 */
  before: Record<string, string>;
  changed: string[];
  /** 文件里空着、不改的栏（空格不清空）。 */
  blanked: string[];
  /** field = null 是整行的错（例如对不上、文件里重复）。 */
  errors: { field: string | null; message: string }[];
  /** 按别名对上时是哪个别名（Pickup Locations 用）。 */
  matched_alias?: string | null;
}

export interface ImportPreviewResponse {
  /** 文件里认出的栏 key，按页面栏的顺序。 */
  columns: string[];
  rows: ImportPreviewRow[];
}

export interface ImportCommitResult {
  created: number;
  updated: number;
  unchanged: number;
  /** 有错没存的行数。 */
  skipped: number;
}
