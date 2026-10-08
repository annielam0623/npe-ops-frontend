/**
 * 浏览器端读 .csv / .xlsx 的通用小工具（给 Manifests 的 Cfm # 批量上传用：这个功能没有后端接口，
 * 匹配和写入都在前端做，所以文件要在浏览器里解析，不走 HR / Tickets 那种「上传到后端解析」的路）。
 *
 * ⚠️ `xlsx` 在 npm 上发布的版本长期停在有已知高危漏洞（原型污染、ReDoS）的老版本不再更新；
 * SheetJS 官方把修复后的版本改成只从自己的 CDN 发（见 package.json 里的安装地址），不要改回 `npm install xlsx`。
 * 它体积不小（压缩前几百 KB），动态 import，不用这个功能的人打开 Manifests 页不用多下这一块。
 */

export interface SpreadsheetTable {
  /** 第一行原文（未改名、未去重）。 */
  headers: string[];
  /** 每行一个对象，键是 headers 原文；空单元格给 ""。 */
  rows: Record<string, string>[];
}

/** 文件为空 / 没有表头行 / 完全读不出内容。 */
export class EmptySpreadsheetError extends Error {}

/**
 * 读第一个 sheet，第一行当表头。单元格统一转成字符串（数字 / 日期也是，调用方自己按需要解析），
 * 方便和表头比较、拼进预览表；完全空白的行跳过。
 */
export async function readSpreadsheet(file: File): Promise<SpreadsheetTable> {
  const [{ read, utils }, buffer] = await Promise.all([
    import("xlsx"),
    file.arrayBuffer(),
  ]);
  const workbook = read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new EmptySpreadsheetError("The file has no sheets.");
  const sheet = workbook.Sheets[sheetName];
  const grid: unknown[][] = utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  if (grid.length === 0) {
    throw new EmptySpreadsheetError("The file looks empty.");
  }
  const headers = grid[0].map((h) => String(h ?? "").trim());
  if (headers.every((h) => h === "")) {
    throw new EmptySpreadsheetError("The first row has no column names.");
  }
  const rows = grid.slice(1).map((line) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (!h) return;
      const cell = line[i];
      row[h] = cell === undefined || cell === null ? "" : String(cell).trim();
    });
    return row;
  });
  return { headers, rows };
}
