/** 提示字全是大写字母时（LOWER, UPPER, X / SUNSET）加到输入框上：提示字再小一号，10px（globals.css；Annie 2026-11-01「全大写的10px」）。 */
export function capsPlaceholder(text: string | null | undefined) {
  return text && /[A-Z]/.test(text) && text === text.toUpperCase()
    ? { "data-caps-placeholder": "" }
    : {};
}
