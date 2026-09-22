interface ReadEnvOptions {
  defaultValue?: string;
}

function readEnv(name: string, options: ReadEnvOptions = {}): string {
  const raw = process.env[name];
  const value = raw?.trim() ? raw.trim() : options.defaultValue;

  if (!value) {
    throw new Error(
      `环境变量 ${name} 缺失且没有默认值，请在 .env.local 中配置。`,
    );
  }

  return value;
}

const API_BASE_URL_DEFAULT = "http://127.0.0.1:8000";

function normalizeBaseUrl(value: string): string {
  try {
    new URL(value);
  } catch {
    throw new Error(
      `环境变量 NEXT_PUBLIC_API_BASE_URL 不是合法的 URL：${value}`,
    );
  }

  return value.replace(/\/+$/, "");
}

export const env = {
  apiBaseUrl: normalizeBaseUrl(
    readEnv("NEXT_PUBLIC_API_BASE_URL", {
      defaultValue: API_BASE_URL_DEFAULT,
    }),
  ),
} as const;

export type Env = typeof env;
