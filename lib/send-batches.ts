/**
 * 发送类页面一次请求发几位客人。十位约十几秒，远低于 /api 转发（next.config.ts）
 * 和线上 Cloudflare 的超时——超时了后端还在发，staff 看到报错再点一次就会重复发给客人。
 */
export const SEND_BATCH_SIZE = 10;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
