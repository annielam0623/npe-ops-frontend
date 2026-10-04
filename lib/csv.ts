/** UTF-8 BOM：Excel 靠它认出 UTF-8。 */
const BOM = String.fromCharCode(0xfeff);

/** 一格：含逗号、引号、换行的加引号，引号成对转义。 */
function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
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
