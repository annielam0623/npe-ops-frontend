"use client";

import { useCallback } from "react";

import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";

import { ConfirmView } from "./confirm-view";
import { MY_LEAVE_HOW_TO, MyLeavePanel } from "./leave-view";

/**
 * My schedule（Annie 2026-11-19「全部同意推荐，动手」，preview LEM11L3J5ee97e4KGsk5J4）：员工处理自己的事的一页。
 * 上面 = 原 Confirm your schedule（确认 / 改天上 / 加班 / 发布后换班，一点不改）；下面 = My leave（原 Leave 标签员工那两块）。
 * 数据：班表、申请照旧走 /api/schedule/confirmation*；请假走 /api/schedule/leave-requests/mine、POST、withdraw（都只要 schedule.view）。
 */
export function MyScheduleView() {
  const toLogin = useCallback(() => {
    window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
  }, []);
  return (
    <ConfirmView
      extra={<MyLeavePanel onUnauthorized={toLogin} />}
      extraHowTo={MY_LEAVE_HOW_TO}
    />
  );
}
