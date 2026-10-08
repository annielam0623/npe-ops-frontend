import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * 三个发送页（Tickets / Morning / Tour）共用的旧后台样子，数值照旧模板
 * send_tickets.html / send_morning.html / send_tour.html 的 extra_styles（Annie 2026-10-07：和旧版一模一样）。
 * 每页一个主色：Morning 蓝、Tickets 橙、Tour 绿、Last Minute 棕。只管样子，不含任何发送逻辑。
 */
export type SendTheme = "blue" | "orange" | "green" | "brown";

export const THEME: Record<
  SendTheme,
  {
    /** .btn-send 底色 + hover。 */
    button: string;
    /** .preview-header / .mp-panel-head 底色。 */
    headBg: string;
    /** 头上的字、tab 选中、状态 ok。 */
    text: string;
    /** tab 选中下划线。 */
    border: string;
    /** 输入框 focus。 */
    focus: string;
    /** 进度条（ops 才有）。 */
    bar: string;
  }
> = {
  blue: {
    button: "bg-[#185FA5] hover:bg-[#124d8a]",
    headBg: "bg-[#E6F1FB]",
    text: "text-[#185FA5]",
    border: "border-[#185FA5]",
    focus: "focus:border-[#185FA5]",
    bar: "bg-[#185FA5]",
  },
  orange: {
    button: "bg-[#BA7517] hover:bg-[#9a6010]",
    headBg: "bg-[#FAEEDA]",
    text: "text-[#BA7517]",
    border: "border-[#BA7517]",
    focus: "focus:border-[#BA7517]",
    bar: "bg-[#BA7517]",
  },
  green: {
    button: "bg-[#3B6D11] hover:bg-[#2d5409]",
    headBg: "bg-[#EAF3DE]",
    text: "text-[#3B6D11]",
    border: "border-[#3B6D11]",
    focus: "focus:border-[#3B6D11]",
    bar: "bg-[#3B6D11]",
  },
  brown: {
    button: "bg-[#7C4A00] hover:bg-[#5c3700]",
    headBg: "bg-[#FFF3E0]",
    text: "text-[#7C4A00]",
    border: "border-[#7C4A00]",
    focus: "focus:border-[#3B6D11]",
    bar: "bg-[#7C4A00]",
  },
};

/** 页面标题：深色底上的白字（.page-header-title）。 */
export function SendPageHeader({ title }: { title: string }) {
  return (
    <div className="mb-5 flex items-center">
      <h1 className="text-[20px] font-extrabold tracking-[-.02em] text-white">
        {title}
      </h1>
    </div>
  );
}

/** 右上角浮着的 View Tracking（.btn-tracking-page）；底色每页不同。 */
export function TrackingButton({
  href,
  color,
}: {
  href: string;
  /** 例 "bg-[#185FA5]"。 */
  color: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "fixed top-[72px] right-6 z-[100] inline-flex h-[38px] items-center gap-[7px] rounded-[9px] px-4 text-[13px] font-[650] text-white no-underline shadow-[0_2px_16px_rgba(0,0,0,.30)] transition-all duration-[180ms] hover:opacity-[.88] hover:shadow-[0_4px_20px_rgba(0,0,0,.40)]",
        color,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="h-3.5 w-3.5 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
      >
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
      View Tracking
    </Link>
  );
}

/** .send-card */
export const SEND_CARD =
  "mb-5 max-w-[680px] rounded-xl border-[0.5px] border-black/10 bg-white p-6";
/** .send-card h2 */
export const SEND_CARD_TITLE = "mb-4 text-[15px] font-semibold text-[#1a1a1a]";
/** .form-row */
export const FORM_ROW = "mb-3.5 flex flex-wrap gap-3.5";
/** .form-group + label 字样（label 包着输入框，输入框自己的字号颜色另给）。 */
export const FORM_GROUP =
  "flex min-w-[180px] flex-1 flex-col gap-[5px] text-[12px] font-medium text-[#888]";

/** .form-group select / input */
export function inputClass(theme: SendTheme): string {
  return cn(
    "rounded-[7px] border-[0.5px] border-black/20 bg-white px-2.5 py-[7px] text-[13px] font-normal text-[#1a1a1a] focus:outline-none",
    THEME[theme].focus,
  );
}

/** 上传框下面的灰字说明。 */
export const FORM_HINT = "mb-3.5 text-[11px] text-[#aaa]";
/** 上传 / 发送出错时按钮旁边的红字。 */
export const INLINE_ERROR = "ml-3 text-[12px] text-[#A32D2D]";

/** .btn-send */
export function sendButtonClass(theme: SendTheme): string {
  return cn(
    "inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] border-none px-6 py-[9px] text-[13px] font-semibold text-white no-underline disabled:cursor-not-allowed disabled:bg-[#aaa]",
    THEME[theme].button,
  );
}

/** base.html 的 .btn：深色底上的半透明按钮（↩ Start Over / ✕ Cancel）。 */
export const DARK_BUTTON =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-white/10 bg-white/[.04] px-3.5 text-[13px] font-[650] text-white transition duration-[160ms] hover:bg-white/[.08] disabled:cursor-not-allowed disabled:opacity-50";

/** .result-card .btn：白卡里的浅灰按钮（↩ Send Another）。 */
export const LIGHT_BUTTON =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-[10px] border-[0.5px] border-black/20 bg-[#f5f5f3] px-3.5 text-[13px] font-[650] text-[#444] transition duration-[160ms] hover:bg-[#ebebe8] hover:text-[#222]";

/** .preview-card */
export const PREVIEW_CARD =
  "mb-5 w-full overflow-hidden rounded-xl border-[0.5px] border-black/10 bg-white";

/** .preview-header（标题字色另给）。 */
export function previewHeaderClass(theme: SendTheme): string {
  return cn(
    "flex flex-wrap items-center justify-between gap-3 border-b-[0.5px] border-black/[.08] px-4 py-3",
    THEME[theme].headBg,
  );
}

/** .tbl-wrap / table.preview-tbl / thead td / tbody tr / tbody td */
export const TABLE_WRAP = "w-full overflow-x-auto";
export const TABLE =
  "w-auto min-w-full border-collapse text-[12px] whitespace-nowrap text-[#444]";
export const TH =
  "border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-2.5 py-2 text-left text-[11px] font-semibold text-[#999]";
export const TR = "border-b-[0.5px] border-black/[.06] last:border-b-0";
/** 字色 #444 从 TABLE 继承，单元格自己的颜色（状态、说明）才不会和它打架。 */
export const TD = "px-2.5 py-2";

/** .dup-badge */
export const DUP_BADGE =
  "mr-1 rounded-md bg-[#FAEEDA] px-1.5 py-0.5 text-[10px] whitespace-nowrap text-[#BA7517]";

/** 「Send anyway」勾选（.select-all-wrap / 行里的 label）。 */
export const SEND_ANYWAY_LABEL =
  "flex cursor-pointer items-center gap-1 text-[11px] text-[#BA7517]";
export const SEND_ANYWAY_ALL =
  "flex cursor-pointer items-center gap-[5px] text-[11px] font-semibold text-[#BA7517]";

/** 预览下面的红框（人数算不出等）。 */
export const RED_BOX =
  "mb-2 max-w-[680px] rounded-[10px] border border-[#e9b3b3] bg-[#fdecec] px-4 py-3 text-[12px] leading-[1.8] text-[#A32D2D]";
/** 黄框（CSV 编码、缺邮箱 / 电话、Send Report）。 */
export const YELLOW_BOX =
  "mb-2 rounded-[10px] border border-[#f0d080] bg-[#fff8e1] px-4 py-3 text-[12px] leading-[1.8] text-[#7C4A00]";
/** 蓝框（Check-in Time 是算出来的）。 */
export const BLUE_BOX =
  "mb-2 rounded-[10px] border border-[#b9d2f3] bg-[#eaf2fd] px-4 py-3 text-[12px] leading-[1.8] text-[#1f4f8a]";
/** 断开 / 出错停下的框（.maybe-sent）。 */
export const STOP_BOX =
  "max-w-[680px] rounded-[10px] border border-[#f0b4b4] bg-[#fdecec] px-4 py-3 text-[12.5px] leading-[1.8] text-[#7a1f1f]";

/** .result-card */
export const RESULT_CARD =
  "mb-5 w-full rounded-xl border-[0.5px] border-black/10 bg-white p-5";
export const RESULT_TITLE = "mb-4 text-[15px] font-semibold text-[#1a1a1a]";

/** .result-summary 里的一格（.result-stat）。 */
export function ResultStat({
  label,
  value,
  className = "text-[#1a1a1a]",
}: {
  label: string;
  value: number;
  /** 数字颜色（.ok / .fail / .skip）。 */
  className?: string;
}) {
  return (
    <div className="rounded-lg bg-[#f5f5f3] px-[18px] py-2.5 text-center">
      <div
        data-stat
        className={cn("text-[22px] font-bold tabular-nums", className)}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-[#888]">{label}</div>
    </div>
  );
}
export const RESULT_SUMMARY = "mb-4 flex flex-wrap gap-4";

/** 发送中的进度（ops 才有：分小批发送）。 */
export function SendProgress({
  done,
  total,
  theme,
  children,
}: {
  done: number;
  total: number;
  theme: SendTheme;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-2 overflow-hidden rounded-full bg-[#f5f5f3]"
      >
        <div
          className={cn("h-full transition-[width]", THEME[theme].bar)}
          style={{ width: `${total ? (done / total) * 100 : 0}%` }}
        />
      </div>
      <p className="text-[12px] text-[#888] tabular-nums">{children}</p>
    </div>
  );
}

const STYPE_ICON = { combined: "✉️📱", sms: "📱", email: "📧" } as const;
/** 发送按钮前面的图标（同旧页面 setSendType）。 */
export const SEND_ICON = { combined: "✉️", sms: "📱", email: "📧" } as const;

const STYPE_COLOR = {
  combined: {
    idle: "text-[#6B4FBB]",
    active: "border-[#6B4FBB] bg-[#F0ECFF] font-semibold",
  },
  sms: {
    idle: "text-[#185FA5]",
    active: "border-[#185FA5] bg-[#E6F1FB] font-semibold",
  },
  email: {
    idle: "text-[#BA7517]",
    active: "border-[#BA7517] bg-[#FAEEDA] font-semibold",
  },
} as const;

type SendTypeValue = keyof typeof STYPE_ICON;

/** 三个发送方式按钮（.stype-btn）：没选中也保留各自的颜色。 */
export function SendTypePicker<T extends SendTypeValue>({
  types,
  value,
  onChange,
}: {
  types: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Send type"
      className="mb-3 flex flex-wrap gap-2"
    >
      {types.map((t) => {
        const active = value === t.value;
        const color = STYPE_COLOR[t.value];
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(t.value)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] border-[1.5px] bg-white px-4 py-[7px] text-[13px] whitespace-nowrap transition-all duration-150 select-none hover:opacity-[.85]",
              color.idle,
              active ? color.active : "border-black/15",
            )}
          >
            <span className="text-[14px]">{STYPE_ICON[t.value]}</span> {t.label}
          </button>
        );
      })}
    </div>
  );
}

const HOW_TO_TONE = {
  green: {
    box: "border-[#d4e6c3] bg-[#f7f9f5] text-[#4a5a3a]",
    summary: "text-[#3B6D11]",
    rule: "border-[#d4e6c3]",
  },
  blue: {
    box: "border-[#b5d4f4] bg-[#e8f3fc] text-[#0c3a6b]",
    summary: "text-[#185FA5]",
    rule: "border-[#b5d4f4]",
  },
  brown: {
    box: "border-[#e8d5b0] bg-[#fdf6ee] text-[#5a4020]",
    summary: "text-[#7C4A00]",
    rule: "border-[#e8d5b0]",
  },
} as const;

/**
 * 「📖 How to use」，默认收起；样子照各发送页旧模板里那段 <details> 的行内样式
 * （max-width 680、底下 32px；Morning 蓝、Tickets / Tour 绿、Last Minute 棕）。
 */
export function SendHowTo({
  tone,
  title,
  children,
  footer,
  footerClassName,
  footerRule,
  listClassName = "m-0",
}: {
  tone: keyof typeof HOW_TO_TONE;
  title: string;
  /** <li> 列表。 */
  children: ReactNode;
  footer?: ReactNode;
  /** 底部那段的字色（旧模板各页不同）。 */
  footerClassName?: string;
  /** 底部那段上面的分隔线颜色，默认同框线（Tour 那段旧模板是蓝线）。 */
  footerRule?: string;
  listClassName?: string;
}) {
  const t = HOW_TO_TONE[tone];
  return (
    <details
      className={cn(
        "mb-8 max-w-[680px] rounded-[10px] border px-5 py-4 text-[12px] leading-[1.9]",
        t.box,
      )}
    >
      <summary className={cn("cursor-pointer font-semibold", t.summary)}>
        📖 {title}
      </summary>
      <ol className={cn("list-decimal pl-[18px]", listClassName)}>
        {children}
      </ol>
      {footer ? (
        <div
          className={cn(
            "mt-2.5 border-t pt-2.5",
            footerRule ?? t.rule,
            footerClassName,
          )}
        >
          {footer}
        </div>
      ) : null}
    </details>
  );
}
