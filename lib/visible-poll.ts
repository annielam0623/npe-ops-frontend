/**
 * 数据轮询：标签页藏到后台就停，回到前台马上刷新一次、再按原来的间隔继续
 * （页面提速，Annie 2026-11-05「改变速度的三步，动手」）。
 *
 * 用法同 setInterval，返回的函数用来停（放在 useEffect 的 cleanup 里，替代 clearInterval）：
 *   const stop = setVisibleInterval(load, 60_000);
 *   return () => stop();
 *
 * 只给拉数据的轮询用。编辑锁心跳（Dispatch / Schedule）不要换：停了会丢锁。
 * 纯前端的时钟（30 秒重算一次「几分钟前」）不发请求，也不用换。
 */
export function setVisibleInterval(fn: () => void, ms: number): () => void {
  if (typeof document === "undefined") return () => {};
  let timer: ReturnType<typeof setInterval> | null = null;
  const start = () => {
    if (timer === null) timer = setInterval(fn, ms);
  };
  const pause = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      pause();
    } else if (timer === null) {
      // 藏着的时候没拉，回来先补一次，再从头计间隔。
      fn();
      start();
    }
  };
  if (document.visibilityState !== "hidden") start();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    pause();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
