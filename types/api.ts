export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryValue = string | number | boolean | null | undefined;

export type QueryParams = Record<string, QueryValue | QueryValue[]>;

export interface ApiFetchOptions {
  method?: HttpMethod;
  query?: QueryParams;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  cache?: RequestCache;
  next?: NextFetchRequestConfig;
}

export interface ApiErrorPayload {
  status: number;
  statusText: string;
  url: string;
  body: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly body: unknown;

  constructor(payload: ApiErrorPayload) {
    super(`API 请求失败：${payload.status} ${payload.statusText}`);
    this.name = "ApiError";
    this.status = payload.status;
    this.statusText = payload.statusText;
    this.url = payload.url;
    this.body = payload.body;
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    let body: unknown = null;
    const contentType = response.headers.get("content-type") ?? "";
    try {
      body = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
    } catch {
      body = null;
    }

    return new ApiError({
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      body,
    });
  }
}
