/**
 * 复制文字到剪贴板，成功返回 true。
 * navigator.clipboard 只在 https / localhost 下可用，其余情况（或浏览器拒绝）返回 false，
 * 由调用方改为显示文字让用户手动复制。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
