import { isPasswordChangeRequired } from "@/lib/api-errors";
import { buildChangePasswordRedirectUrl } from "@/lib/safe-redirect";
import { buildQueryString } from "@/lib/utils";
import { ApiError, type ApiFetchOptions } from "@/types";

/**
 * 403「Password change required」统一在这里拦截跳转（后端待办 G32 第 4 条），不要求每个调用点
 * 各自判断——100 多处 `isStatus(error, 401)` 分散在各页面和子组件里，只在这一个必经之处拦，
 * 不会有漏网的。`redirectingToChangePassword` 防多个并发请求同时触发时各跳一次。
 */
let redirectingToChangePassword = false;
function maybeRedirectToChangePassword(error: ApiError): void {
  if (
    typeof window === "undefined" ||
    redirectingToChangePassword ||
    !isPasswordChangeRequired(error)
  ) {
    return;
  }
  redirectingToChangePassword = true;
  window.location.href = buildChangePasswordRedirectUrl(window.location.href);
}

function buildUrl(path: string, query?: ApiFetchOptions["query"]): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const queryString = buildQueryString(query);

  return `${normalizedPath}${queryString ? `?${queryString}` : ""}`;
}

async function parseBody<T>(response: Response): Promise<T> {
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }

  return (await response.text()) as T;
}

/**
 * 调用 FastAPI 后端的统一 fetch 封装：
 * - 请求同源相对路径（如 /api/me），由 next.config.ts 的 rewrites 转发到后端，
 *   因此只能在浏览器里调用（服务端组件里没有同源可言，session cookie 也不在服务器上）；
 * - 默认发送 / 解析 JSON；body 是 FormData 时按 multipart 原样发送；
 * - 固定携带 cookie（credentials: "include"），用于后端 session 认证；
 * - 非 2xx 响应统一抛出 ApiError。
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { method = "GET", body, headers, signal, cache, next, query } = options;

  // FormData（上传文件）原样交给 fetch，由浏览器自己写 multipart 的 Content-Type 和 boundary。
  const isFormData =
    typeof FormData !== "undefined" && body instanceof FormData;
  const hasJsonBody = !isFormData && body !== undefined && body !== null;

  const response = await fetch(buildUrl(path, query), {
    method,
    credentials: "include",
    signal,
    cache,
    next,
    headers: {
      Accept: "application/json",
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: isFormData ? body : hasJsonBody ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await ApiError.fromResponse(response);
    maybeRedirectToChangePassword(error);
    throw error;
  }

  return parseBody<T>(response);
}
