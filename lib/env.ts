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

const API_BASE_URL_DEFAULT = "http://127.0.0.1:8000";

function normalizeBaseUrl(name: string, value: string): string {
  try {
    new URL(value);
  } catch {
    throw new Error(`环境变量 ${name} 不是合法的 URL：${value}`);
  }

  return value.replace(/\/+$/, "");
}

export const env = {
  apiBaseUrl: normalizeBaseUrl(
    "NEXT_PUBLIC_API_BASE_URL",
    readEnv("NEXT_PUBLIC_API_BASE_URL", process.env.NEXT_PUBLIC_API_BASE_URL, {
      defaultValue: API_BASE_URL_DEFAULT,
    }),
  ),
} as const;

export type Env = typeof env;
