/**
 * 全站 ⬆ Import 的标准接口形状（前端提给后端的，HR 之后的每页都照这个做）：
 * `POST <base>/preview`（multipart `file`，只读）→ `ImportPreviewResponse`；
 * `POST <base>/commit`（同一个文件，只写 new / update 行，一个事务）→ `ImportCommitResult`。
 */
export interface ImportPreviewRow {
  status: "new" | "update" | "unchanged" | "error";
  /** 对上的记录；新建的是 null。 */
  id: number | null;
  /** Excel 行号（后端 G220）。 */
  row: number;
  /** 显示用的文字（开关写 Yes / No）。原始文字：一律当纯文本显示（后端安全审查 SA-4）。 */
  values: Record<string, string>;
  /** 要改的栏改前的值（只含改了的栏）。 */
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
  counts: { new: number; update: number; unchanged: number; error: number };
}

export interface ImportCommitResult {
  created: number;
  updated: number;
  unchanged: number;
  /** 有错没存的行数。 */
  skipped: number;
}
