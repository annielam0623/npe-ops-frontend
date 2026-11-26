"use client";

import { useState } from "react";

import type { ConfirmRequest } from "@/lib/schedule-confirm-api";
import { cn } from "@/lib/utils";

import { shiftLabelOf } from "../schedule-leave/ui";
import type { ScheduleShiftType } from "@/types";

import { requestLine } from "./shift-change-request-dialog";

/**
 * 总览页顶第 4 条：灰色「Shift change requests · N」（N1 A；灰色 = 不是警告，跟 Leave / Gaps / Rule problems 分开）。
 * 样子照 preview v2 .bar.resp。只列还要处理的（pending + 等对方的 awaiting_peer，最新的在前）；
 * 一条都没有就不渲染。can_edit = false 时后端给 []（7d 2f8735ef），也就不出。
 * 手机上（< 640px）只露第一条 + 「+N」，点「+N」展开（同其他三条栏，components/ui/phone.tsx 规则）。
 */
export function ShiftChangeRequestsBar({
  requests,
  shiftTypes,
  onOpen,
}: {
  requests: ConfirmRequest[];
  shiftTypes: ScheduleShiftType[];
  onOpen: (request: ConfirmRequest) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const open = requests
    .filter((r) => r.status === "pending" || r.status === "awaiting_peer")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!open.length) return null;
  const label = (k: string) => shiftLabelOf(shiftTypes, k);
  return (
    <div
      data-change-requests-bar
      className="flex items-start gap-2.5 rounded-[8px] border border-[#d3d9e1] bg-[#f5f7fa] px-2.5 py-[7px] text-[12.5px] text-[#334155] max-sm:px-2 max-sm:py-1.5"
    >
      {/* 手机 390 上标题被内容压住、跟第一条叠在一起（ab 2026-11-26 报）：标题不缩，内容占剩下的宽度、自己截断。 */}
      <span className="min-w-[150px] shrink-0 font-extrabold whitespace-nowrap max-sm:min-w-0">
        Shift change requests · {open.length}
      </span>
      <span
        className={cn(
          "flex min-w-0 flex-1 flex-wrap gap-x-3.5 gap-y-1",
          // 手机收起时一行：第一条自己截断，「+N」不缩、永远看得见点得到（fe 2026-11-26：原来整行截断把 +N 截掉了）。
          !expanded && "max-sm:flex-nowrap max-sm:gap-x-1.5",
        )}
      >
        {open.map((r, i) => (
          <button
            key={r.id}
            type="button"
            data-change-request={r.id}
            onClick={() => onOpen(r)}
            className={cn(
              "cursor-pointer text-left underline underline-offset-2",
              i > 0 && !expanded && "max-sm:hidden",
              i === 0 &&
                !expanded &&
                "max-sm:min-w-0 max-sm:truncate max-sm:whitespace-nowrap",
            )}
          >
            {requestLine(r, label)}
            {r.status === "awaiting_peer"
              ? ` · waiting for ${r.peer?.name ?? "the other person"}`
              : ""}
          </button>
        ))}
        {open.length > 1 && !expanded ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            data-change-requests-more
            className="hidden shrink-0 cursor-pointer font-bold max-sm:inline"
          >
            +{open.length - 1}
          </button>
        ) : null}
      </span>
    </div>
  );
}
