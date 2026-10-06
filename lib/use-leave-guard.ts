"use client";

import { useEffect } from "react";

/** 哨兵那一条历史记录上的记号。 */
const SENTINEL_KEY = "__npeLeaveGuard";
/** 哨兵底下那一条（这一页本来的记录）上的记号：后退一步落在它上面 = 还在这一页。 */
const BASE_KEY = "__npeLeaveGuardBase";
/** Next App Router 自己放在 history.state 里的字段。 */
const NEXT_KEYS = ["__NA", "__PRIVATE_NEXTJS_INTERNALS_TREE"] as const;

type HistoryState = Record<string, unknown>;

/** 这一页挂着的哨兵（同一时刻最多一个）：留着地址，replaceUrl 改地址时跟着改。 */
let armed: { token: string; state: HistoryState; href: string } | null = null;
/** 撤哨兵的 history.back() 还没落地：新的哨兵要等它落地再挂，不然会挂到错的那一条上。 */
let removing: Promise<void> | null = null;

function stateCopy(): HistoryState {
  return { ...((window.history.state as HistoryState | null) ?? {}) };
}

/**
 * 只改地址栏（例如 ?date=）：保留离开提醒的记号，Next 的字段交给它自己补
 * （直接传 null 会把哨兵的记号冲掉，撤哨兵时就认不出来，多留一条记录）。
 */
export function replaceUrl(url: string | URL): void {
  // 正在撤哨兵（back() 还没落地）：等它落地再改，不然撤完会把旧地址搬回来。
  if (removing) {
    const href = String(url);
    void removing.then(() => replaceUrl(href));
    return;
  }
  const own = stateCopy();
  for (const k of NEXT_KEYS) delete own[k];
  window.history.replaceState(own, "", url);
  if (armed && own[SENTINEL_KEY] === armed.token)
    armed.href = window.location.href;
}

/**
 * active 时离开页面先问：
 * - 关标签 / 刷新走浏览器的 beforeunload；
 * - 站内链接（侧栏等）是前端跳转，不触发 beforeunload ⇒ 在捕获阶段拦点击，confirm 不通过就不跳；
 * - 浏览器后退 / 前进是 popstate，地址已经变了才通知 ⇒ 先压一条同地址的哨兵记录，
 *   后退时落回本页那一条，问过再决定：留下就再前进回哨兵，离开就再后退一步。
 * 发送页用它：发送中跳走，剩下的批次没人看得到结果；排车页用它：没存的改动会丢。
 */
export function useLeaveGuard(active: boolean, message: string): void {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const guard = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const token = Math.random().toString(36).slice(2);
    let disposed = false;
    let pushed = false;
    // 已经答应离开：后面的 popstate 交给 Next 照常处理。
    let leaving = false;
    // 自己调的 forward() 引起的那一次 popstate，不再问、也不让 Next 处理。
    let ignoreNext = false;
    let fallback: ReturnType<typeof setTimeout> | null = null;

    const pushSentinel = () => {
      const base = stateCopy();
      // 带着 Next 的字段压进去：它的 pushState 补丁见到 __NA 就原样放行，不会当成一次跳转。
      window.history.replaceState(
        { ...base, [BASE_KEY]: token },
        "",
        window.location.href,
      );
      const sentinel: HistoryState = { ...base, [SENTINEL_KEY]: token };
      delete sentinel[BASE_KEY];
      window.history.pushState(sentinel, "", window.location.href);
      armed = { token, state: sentinel, href: window.location.href };
      pushed = true;
    };

    const onPop = (e: PopStateEvent) => {
      if (ignoreNext) {
        ignoreNext = false;
        e.stopImmediatePropagation();
        return;
      }
      if (leaving || !pushed) return;
      const st = e.state as HistoryState | null;
      const onBase = st?.[BASE_KEY] === token;
      if (window.confirm(message)) {
        leaving = true;
        // 长按后退选了更早的页：已经落在那一页了，交给 Next 照常处理。
        if (!onBase) return;
        // 落在本页那一条：再后退一步才是真离开。
        e.stopImmediatePropagation();
        window.history.back();
        // 前面没有记录（直接打开的这一页）：back() 什么也不做 ⇒ 还在这一页，重新挂上。
        fallback = setTimeout(() => {
          const now = window.history.state as HistoryState | null;
          if (!disposed && now?.[BASE_KEY] === token) {
            leaving = false;
            pushSentinel();
          }
        }, 500);
        return;
      }
      // 留下：不让 Next 换页面，回到哨兵上。
      e.stopImmediatePropagation();
      if (onBase) {
        ignoreNext = true;
        window.history.forward();
      } else if (armed?.token === token) {
        window.history.pushState(armed.state, "", armed.href);
      }
    };

    const arm = () => {
      if (disposed) return;
      pushSentinel();
    };

    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guard, true);
    // 捕获阶段注册：在目标上先于 Next 自己的 popstate 监听执行，才拦得住。
    window.addEventListener("popstate", onPop, true);
    if (removing) void removing.then(arm);
    else arm();

    return () => {
      disposed = true;
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guard, true);
      window.removeEventListener("popstate", onPop, true);
      if (fallback) clearTimeout(fallback);
      if (armed?.token === token) armed = null;
      const st = window.history.state as HistoryState | null;
      if (leaving || !pushed || st?.[SENTINEL_KEY] !== token) return;
      // 还停在哨兵上（发完了 / 存好了）：退回本页那一条，把地址和 Next 的状态原样搬过去，不多留一条。
      const keep = stateCopy();
      delete keep[SENTINEL_KEY];
      const href = window.location.href;
      removing = new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const done = (e?: Event) => {
          e?.stopImmediatePropagation();
          window.removeEventListener("popstate", done, true);
          if (timer) clearTimeout(timer);
          window.history.replaceState(keep, "", href);
          removing = null;
          resolve();
        };
        window.addEventListener("popstate", done, true);
        timer = setTimeout(done, 1000);
        window.history.back();
      });
    };
  }, [active, message]);
}
