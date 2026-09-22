import { env } from "@/lib/env";
import { buildQueryString } from "@/lib/utils";
import { ApiError, type ApiFetchOptions } from "@/types";

function buildUrl(path: string, query?: ApiFetchOptions["query"]): string {
  const base = env.apiBaseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const queryString = buildQueryString(query);

  return `${base}${normalizedPath}${queryString ? `?${queryString}` : ""}`;
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
 * - 基于 NEXT_PUBLIC_API_BASE_URL 拼接完整 URL；
 * - 默认发送 / 解析 JSON；
 * - 固定携带 cookie（credentials: "include"），用于后端 session 认证；
 * - 非 2xx 响应统一抛出 ApiError。
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { method = "GET", body, headers, signal, cache, next, query } = options;

  const hasJsonBody = body !== undefined && body !== null;

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
    body: hasJsonBody ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw await ApiError.fromResponse(response);
  }

  return parseBody<T>(response);
}
