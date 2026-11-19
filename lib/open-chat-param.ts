"use client";

import { useEffect, useRef, useState } from "react";

import { takeSearchParam } from "@/lib/utils";

/** 那天的表里没有这单时的黄字（Annie 2026-11-18 Chat history 样稿第 7 / 8 版，原文）。 */
export const CHAT_NOT_ON_LIST = "This order is not on this day's list.";

/**
 * Tracking 三页的 `?chat=单号`（订单生命周期 Chat history 的「Open chat →」，Annie「全部同意推荐。动手」）：
 * 打开页面时记下单号（从地址栏拿掉）；这一天的表读到以后，有这单就打开它的对话框（只开一次），没有就返回黄字。
 * `rows` 为 null = 还没读到。页面同时带 `q=单号`，搜索框照旧预填。
 */
export function useOpenChatFromUrl<R extends { order_number: string }>(
  rows: readonly R[] | null,
  open: (row: R) => void,
): string | null {
  const wantRef = useRef<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const v = takeSearchParam("chat");
    if (v && v.trim()) wantRef.current = v.trim().toUpperCase();
  }, []);

  useEffect(() => {
    const want = wantRef.current;
    if (!want || rows === null) return;
    wantRef.current = null;
    const row = rows.find(
      (r) => (r.order_number || "").trim().toUpperCase() === want,
    );
    if (row) {
      setNotFound(null);
      openRef.current(row);
    } else {
      setNotFound(CHAT_NOT_ON_LIST);
    }
  }, [rows]);

  return notFound;
}
