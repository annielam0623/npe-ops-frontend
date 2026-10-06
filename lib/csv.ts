/** UTF-8 BOM：Excel 靠它认出 UTF-8。 */
const BOM = String.fromCharCode(0xfeff);

/** 这些字符开头的文字 Excel 会当公式执行（客人填的文字也会导出）。 */
const FORMULA_START = /^[=+\-@\t\r]/;
/** 普通数字（含负数）不是公式，不加前缀。 */
const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * 一格：文字以公式字符开头的前面加 '，防公式注入（数字类型原样输出）；
 * 含逗号、引号、换行的加引号，引号成对转义。
 */
function cell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (
    typeof value === "string" &&
    FORMULA_START.test(text) &&
    !NUMERIC.test(text)
  ) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * 在浏览器里生成 CSV 并下载。带 UTF-8 BOM，Excel 直接打开不会乱码。
 * 只用于页面上已经拿到的数据（不再请求后端）。
 */
export function downloadCsv(
  filename: string,
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): void {
  const text = [headers, ...rows]
    .map((r) => r.map(cell).join(","))
    .join("\r\n");
  const blob = new Blob([BOM, text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
