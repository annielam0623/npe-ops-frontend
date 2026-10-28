"use client";

import { createContext, useContext } from "react";

/**
 * 整块只看：Dispatch 对没勾 dispatch.edit 的 partner、Manifests 对没勾 manifests.edit 的 partner
 * （lib/staff-permissions.ts）。true 时里面的组件藏掉改 / 存 / 发的按钮和入口，也不发写的请求；显示照旧。
 */
export const ViewOnly = createContext(false);

export function useViewOnly(): boolean {
  return useContext(ViewOnly);
}
