import type { QueryParams } from "@/types";

export type ClassValue = string | number | false | null | undefined;

/**
 * 无依赖的 className 拼接工具，过滤掉假值后用空格连接。
 * 需要更复杂的条件合并时再考虑引入 clsx / tailwind-merge。
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}

/**
 * 把查询参数对象序列化成 query string（不含前导 ?），
 * 跳过 null / undefined，数组会展开成重复的 key。
 */
export function buildQueryString(query?: QueryParams): string {
  if (!query) {
    return "";
  }

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== null && item !== undefined) {
          params.append(key, String(item));
        }
      }
      continue;
    }

    params.append(key, String(value));
  }

  return params.toString();
}
