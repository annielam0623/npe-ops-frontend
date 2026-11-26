"use client";

import type { ReactNode } from "react";

import { Modal } from "@/components/ui/modal";
import { halfHourOptions, clock } from "@/lib/schedule-leave";
import { cn } from "@/lib/utils";
import type {
  ScheduleEmployee,
  ScheduleShiftType,
  ScheduleSlot,
  ScheduleTimeOff,
} from "@/types";

import type { LeaveCategory } from "@/lib/schedule-leave-api";

/*
 * G382 请假框共用的样子：照 preview v2 第 2 节（https://claude.ai/artifact/B2WxdSVvzdQATs53tkzp7B ，53 出、Annie 看过的 v1 改的）。
 * 白底弹框（HR 页是白卡片，components/hr/legacy-ui.ts）；提交键蓝 #3b82f6，先选后存的 Add 灰绿 #6b8e74（CLAUDE.md）。
 */

/** 总览页交给每个框的数据（53 的总览从 GET /api/schedule/range 拿，原样传进来）。 */
export interface LeaveDialogData {
  employees: ScheduleEmployee[];
  /** 涉及那几天的班（跨周也行）。 */
  slots: ScheduleSlot[];
  timeOff: ScheduleTimeOff[];
  shiftTypes: ScheduleShiftType[];
  categories: LeaveCategory[];
  /** 这一天所在的周发布了没有（Q2 A / Q1 A 只管已发布的周）。 */
  weekStatusOf: (date: string) => "draft" | "published";
}

export function shiftLabelOf(types: ScheduleShiftType[], key: string): string {
  return types.find((t) => t.key === key)?.label ?? key;
}

const BTN =
  "inline-flex h-[30px] cursor-pointer items-center rounded-[7px] border px-3 text-[12.5px] font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-35";
export const BTN_PLAIN = cn(
  BTN,
  "border-black/20 bg-white text-[#1a1a1a] hover:bg-[#f4f4f2]",
);
export const BTN_BLUE = cn(
  BTN,
  "border-[#3b82f6] bg-[#3b82f6] text-white hover:bg-[#2f76e8]",
);
export const BTN_GREEN = cn(
  BTN,
  "border-[#6b8e74] bg-[#6b8e74] text-white hover:bg-[#5d7d66]",
);
export const BTN_RED = cn(
  BTN,
  "border-[rgba(185,28,28,.4)] bg-white text-[#b91c1c] hover:bg-[#fdeceb]",
);

export const INP =
  "min-w-0 rounded-[7px] border border-black/20 bg-white px-2 py-[5px] text-[13px] text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-none disabled:opacity-60";
export const LABEL = "text-[11.5px] font-bold text-[#475569]";
export const HINT = "text-[12px] text-[#475569]";
/** 黄框：提示。 */
export const YELLOW =
  "rounded-[7px] border border-[#eab308] bg-[#fef9c3] px-2.5 py-[7px] text-[12.5px] text-[#713f12]";
/** 红框：会留空档 / 后端报错。 */
export const RED =
  "rounded-[7px] border border-[#f87171] bg-[#fef2f2] px-2.5 py-[7px] text-[12.5px] text-[#991b1b]";
export const MINI_TABLE = "w-full border-collapse text-[12.5px]";
export const MINI_TH =
  "border-b-[0.5px] border-black/[.08] px-1 py-[5px] text-left text-[11px] font-semibold text-[#64748b]";
export const MINI_TD =
  "border-b-[0.5px] border-black/[.08] px-1 py-[5px] text-left align-middle";

export function LeaveDialogShell({
  titleId,
  title,
  onClose,
  busy,
  footer,
  children,
}: {
  titleId: string;
  title: ReactNode;
  onClose: () => void;
  busy?: boolean;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      panelClassName="flex max-h-[92vh] max-w-[480px] flex-col overflow-hidden text-[13px] leading-[1.4] text-[#1a1a1a]"
    >
      <div className="flex items-center justify-between gap-2 border-b-[0.5px] border-black/10 px-4 py-3">
        <h2 id={titleId} className="text-[14px] font-bold">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
          className="cursor-pointer rounded-[6px] px-2 py-0.5 text-[14px] text-[#475569] hover:bg-black/5"
        >
          ✕
        </button>
      </div>
      <div className="grid min-h-0 gap-2.5 overflow-y-auto px-4 py-3">
        {children}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t-[0.5px] border-black/10 px-4 py-2.5">
        {footer}
      </div>
    </Modal>
  );
}

const TIMES = halfHourOptions();

/** 半小时一档的时间下拉（Q10 A 灰字「Half-hour steps.」）。 */
export function HalfHourSelect({
  value,
  onChange,
  ariaLabel,
  min,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  /** 结束时间只列比开始晚的。 */
  min?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(INP, "w-[104px]")}
    >
      {TIMES.filter((t) => !min || t > min).map((t) => (
        <option key={t} value={t}>
          {clock(t)}
        </option>
      ))}
    </select>
  );
}

export function ErrorBox({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div
      role="alert"
      data-dialog-error
      className={`${RED} whitespace-pre-line`}
    >
      {text}
    </div>
  );
}
