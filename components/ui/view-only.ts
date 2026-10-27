"use client";

import { createContext, useContext } from "react";

/**
 * 整块只看：Dispatch / Manifests 对 partner（后端 8a 2026-10-26 今晚不放编辑 / 发送，见 lib/staff-permissions.ts 的
 * PARTNER_HELD）。true 时里面的组件藏掉改 / 存 / 发的按钮和入口，也不发写的请求；显示照旧。
 */
export const ViewOnly = createContext(false);

export function useViewOnly(): boolean {
  return useContext(ViewOnly);
}
