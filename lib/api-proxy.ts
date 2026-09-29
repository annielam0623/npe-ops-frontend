const API_PROXY_TARGET_DEFAULT = "http://127.0.0.1:8000";

/**
 * 浏览器只请求同源的 `/api/*`，由 next.config.ts 的 rewrites 在服务器端转发到这里返回的后端地址，
 * 因此不需要后端配 CORS，session cookie 也按同源请求带上。
 *
 * - 只在服务器端读取（next.config.ts、服务端组件），不带 NEXT_PUBLIC_ 前缀，不会进浏览器代码；
 * - rewrites 在 `next build` 时固化，生产环境改这个值需要重新 build；
 * - 本文件被 next.config.ts 直接引用，不能使用 `@/` 路径别名。
 */
export function resolveApiProxyTarget(): string {
  const value =
    process.env.API_PROXY_TARGET?.trim() || API_PROXY_TARGET_DEFAULT;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`环境变量 API_PROXY_TARGET 不是合法的 URL：${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`环境变量 API_PROXY_TARGET 必须是 http(s) 地址：${value}`);
  }

  return value.replace(/\/+$/, "");
}
