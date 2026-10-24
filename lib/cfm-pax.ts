/**
 * Cfm # 上传文件里 Pax 格的读法。
 * - 纯数字直接用；
 * - 「总数 + 括号明细」（`7(6A,1inf)`、`7 (6A, 1 inf)`、`11[10A,1inf]`）只取开头的总数，括号里是明细、不能再加；
 * - 其他文字（`2 Adults, 1 Child`）把里面的数字加总；没有数字或为空返回 null。
 */
export function parsePax(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const total = text.match(/^(\d+)\s*[([]/);
  if (total) return Number(total[1]);
  const nums = text.match(/\d+/g);
  if (!nums) return null;
  return nums.reduce((sum, n) => sum + Number(n), 0);
}
