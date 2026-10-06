"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** 这个标签页里（这次加载以来）走过几个站内页面。整页刷新 / 直接打开就从 1 重新算。 */
let pagesSeen = 0;

/**
 * 有没有可以退回去的站内页面：有 ⇒「‹ Back」走浏览器后退（回到原来那一页、原来的位置）；
 * 没有（直接打开、刷新过）⇒ 后退会离开 ops，改走固定链接。
 * 同旧后台 manifest 页「‹ Back」的做法（那边看 document.referrer，前端跳转时 referrer 不会变，这里改成自己数）。
 */
export function hasInAppHistory(): boolean {
  return pagesSeen > 1;
}

/** 挂在根布局：每换一个页面（路径变了）记一次。 */
export function InAppHistory() {
  const pathname = usePathname();
  useEffect(() => {
    pagesSeen += 1;
  }, [pathname]);
  return null;
}
