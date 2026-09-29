interface ReadEnvOptions {
  defaultValue?: string;
}

/**
 * Next.js 只会把字面量写法 `process.env.NEXT_PUBLIC_XXX` 内联进浏览器代码，
 * `process.env[name]` 这种动态读取在客户端永远是 undefined。
 * 因此调用处必须直接传入 `process.env.NEXT_PUBLIC_XXX`，这里只负责校验与兜底。
 */
function readEnv(
  name: string,
  raw: string | undefined,
  options: ReadEnvOptions = {},
): string {
  const value = raw?.trim() ? raw.trim() : options.defaultValue;

  if (!value) {
    throw new Error(
      `环境变量 ${name} 缺失且没有默认值，请在 .env.local 中配置。`,
    );
  }

  return value;
}

// 用 localhost 而不是 127.0.0.1：本地先在 localhost:8000 登录后端，cookie 只认主机名，
// 旧后台链接必须和前端（localhost:3100）同一个主机名才能带上登录态。
const LEGACY_ADMIN_BASE_URL_DEFAULT = "http://localhost:8000";

function normalizeBaseUrl(name: string, value: string): string {
  try {
    new URL(value);
  } catch {
    throw new Error(`环境变量 ${name} 不是合法的 URL：${value}`);
  }

  return value.replace(/\/+$/, "");
}

// 接口请求走同源 /api/* 代理，后端地址是服务器端变量，见 lib/api-proxy.ts。
export const env = {
  /** 旧版 Jinja2 后台地址，过渡期内跳转旧后台页面使用。 */
  legacyAdminBaseUrl: normalizeBaseUrl(
    "NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL",
    readEnv(
      "NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL",
      process.env.NEXT_PUBLIC_LEGACY_ADMIN_BASE_URL,
      { defaultValue: LEGACY_ADMIN_BASE_URL_DEFAULT },
    ),
  ),
} as const;

export type Env = typeof env;
