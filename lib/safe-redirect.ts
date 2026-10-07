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

/**
 * 当前网址裁成「路径 + 查询串」，不带域名：后端 `safe_next()` 只收站内路径（拒绝带域名的值），
 * 带了完整网址会被原样丢掉、登录后悄悄落到默认首页（code-reviewer CR-2）。调用方都传
 * `window.location.href`（完整网址），这里统一裁剪，调用方不用改。
 */
function currentPath(currentUrl: string): string {
  try {
    const url = new URL(currentUrl);
    return `${url.pathname}${url.search}`;
  } catch {
    // currentUrl 不是合法 URL：理论上不会发生，退回首页而不是把坏值传给后端。
    return "/dashboard";
  }
}

/**
 * 401 时跳登录页，next 带上当前 ops 页面回来的路径。
 *
 * 登录页是 ops 自己站内的 `/auth/login`（`next.config.ts` 的 rewrites 转发到后端，不是跳 confirm 域名）——
 * 后端登录页的 `Set-Cookie` 因此落在 ops 自己的网址上，登录后能带着登录态回到原页面
 * （后端待办 G32，Annie 2026-10-06 晚定「选项 1：ops 转发，后端不改」；不走「cookie 放宽到整个域名」那条路，
 * 否则员工的登录 cookie 会发给同一父域下的其他网站）。
 */
export function buildLegacyLoginRedirectUrl(currentUrl: string): string {
  return `/auth/login?next=${encodeURIComponent(currentPath(currentUrl))}`;
}

/**
 * 403「Password change required」时跳改密码页（后端 G32 第 4 条）：还在用初始密码、必须先改密码的账号，
 * `_signed_in()` 不认 401 走，而是直接 403，上面那条登录跳转碰不到它。这里同样只带路径，
 * 不带域名；由 `lib/api-client.ts` 的 `apiFetch` 统一拦截触发，调用方不用各自判断。
 */
export function buildChangePasswordRedirectUrl(currentUrl: string): string {
  return `/auth/change-password?next=${encodeURIComponent(currentPath(currentUrl))}`;
}
