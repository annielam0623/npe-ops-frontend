// 浏览器解析 URL 时会丢弃制表符/换行等控制字符，"/\t/evil.com" 会变成 "//evil.com"。
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * 只接受站内路径作为登录后的回跳地址，防止开放重定向：
 * 必须以 "/" 开头，且不能以 "//"（协议相对 URL）或 "/\"（浏览器视同 "//"）开头。
 */
export function sanitizeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || CONTROL_CHARS.test(value)) {
    return null;
  }

  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return null;
  }

  return value;
}

export function buildLoginHref(nextPath: string): string {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}
