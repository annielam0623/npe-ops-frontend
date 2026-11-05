/**
 * 几个地方同时（或前后脚）要同一份数据时，只发一个请求（页面提速，Annie 2026-11-05「改变速度的三步，动手」）。
 *
 * - `shareRequest(key, load, ttlMs)`：同一个 key 在 ttlMs 内共用一份结果（还在路上的也共用）；失败不留，下一个调用者重发。
 *   ttlMs = Infinity：整页只读一次（站内换页也不重读，整页刷新才重读）。
 * - signal 只管这个调用者：它取消了不影响别人在等的那一份（共用的请求本身不带 signal）。
 *
 * 只给「读」用；写完要马上看到新数据的页面（例如 Staff Schedule 本身）不要走这里。
 */
type Entry = { promise: Promise<unknown>; expires: number };
const entries = new Map<string, Entry>();

export function shareRequest<T>(
  key: string,
  load: () => Promise<T>,
  ttlMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const now = Date.now();
  let entry = entries.get(key);
  if (!entry || entry.expires <= now) {
    const promise = load();
    const fresh: Entry = { promise, expires: Infinity };
    entry = fresh;
    entries.set(key, fresh);
    promise.then(
      () => {
        if (entries.get(key) === fresh) fresh.expires = Date.now() + ttlMs;
      },
      () => {
        if (entries.get(key) === fresh) entries.delete(key);
      },
    );
  }
  return withSignal(entry.promise as Promise<T>, signal);
}

export function withSignal<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}
