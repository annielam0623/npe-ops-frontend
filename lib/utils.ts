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

/**
 * 读一次地址栏的查询参数并从地址栏去掉（只在浏览器里调）。例：dashboard 订单查询带 `?q=单号` 打开 Tracking 页，
 * 搜索框预填这一单；去掉是为了之后清空搜索框再刷新时不又填回来。
 */
export function takeSearchParam(name: string): string | null {
  const url = new URL(window.location.href);
  const value = url.searchParams.get(name);
  const key = `${url.pathname}:${name}`;
  if (value !== null) {
    url.searchParams.delete(name);
    window.history.replaceState(null, "", url);
    taken.set(key, { value, at: Date.now() });
    return value;
  }
  // 开发模式（reactStrictMode）会把刚挂上的页面的 effect 跑两遍：第二遍地址栏里已经没有了，给第一遍拿到的。
  // 页面在 PermissionGate 读完权限后才挂上（不是 hydrate），所以会碰到。只认一秒内的，免得以后换页又填回来。
  const prev = taken.get(key);
  taken.delete(key);
  return prev && Date.now() - prev.at < 1000 ? prev.value : null;
}
const taken = new Map<string, { value: string; at: number }>();
