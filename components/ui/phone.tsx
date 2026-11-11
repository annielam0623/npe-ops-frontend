"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { setPhoneShortcutsOpen, usePhoneShortcutsOpen } from "@/lib/phone";
import { cn } from "@/lib/utils";

/*
 * 手机版共用小件（Annie 2026-11-01「动手」，preview https://claude.ai/artifact/QN1ZShgWKXFoeUSmjQgutY v2）。
 * 只在屏宽 < 640px 时起作用，电脑版原样显示。新页面照着用：
 *   - 页头介绍 / 区块说明：usePhoneInfo()，标题后放 info.button，说明文字加 info.hide；
 *   - 次要按钮（Columns、Export、Upload…）：包进 <PhoneMore>；
 *   - 黄框 / 红框提示：文字包进 <PhoneOneLine>（报错不包，照旧全文）；
 *   - 纯操作提示（Drag columns…）：直接 max-sm:hidden；
 *   - 新增表单：usePhoneCollapse()，默认收起。
 */

/** 顶栏的 ★：手机上点开 / 收起 My shortcuts 条（方案 B）。电脑上不显示。 */
export function PhoneShortcutStar({ className }: { className?: string }) {
  const open = usePhoneShortcutsOpen();
  return (
    <button
      type="button"
      aria-label={open ? "Hide shortcuts" : "Show shortcuts"}
      aria-expanded={open}
      data-phone-star
      onClick={() => setPhoneShortcutsOpen(!open)}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border text-[15px] sm:hidden max-sm:h-[26px] max-sm:w-[26px] max-sm:rounded-[7px] max-sm:text-[13px]",
        open
          ? "border-[#facc15]/60 bg-[#facc15]/15 text-[#facc15]"
          : "border-white/15 bg-white/[.04] text-[#facc15]",
        className,
      )}
    >
      ★
    </button>
  );
}

/** My shortcuts 条外面包一层：手机上没点 ★ 时藏起来；换页时自动收起。 */
export function PhoneShortcutsSlot({
  pathname,
  children,
  className,
}: {
  pathname: string;
  children: ReactNode;
  /** 外层原来的 class（例如 sticky）：直接加在这一层上，sticky 才不会被多包的一层卡住。 */
  className?: string;
}) {
  const open = usePhoneShortcutsOpen();
  useEffect(() => {
    setPhoneShortcutsOpen(false);
  }, [pathname]);
  return (
    <div
      data-phone-shortcuts={open ? "open" : "closed"}
      className={cn(className, !open && "max-sm:hidden")}
    >
      {children}
    </div>
  );
}

/** 页头介绍、区块说明：手机上收进标题后的「i」，点开再看。 */
export function usePhoneInfo(label = "About this section") {
  const [open, setOpen] = useState(false);
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      data-phone-info
      data-phone-keep
      onClick={() => setOpen((v) => !v)}
      className={cn(
        "ml-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] align-middle font-serif text-[12px] leading-none font-bold italic sm:hidden",
        open
          ? "border-[#7ab3e0] bg-[#7ab3e0] text-[#0b1626]"
          : "border-[#7ab3e0] text-[#7ab3e0]",
      )}
    >
      i
    </button>
  );
  return { open, button, hide: open ? "" : "max-sm:hidden" };
}

/** 次要按钮：电脑上原样排开；手机上收进一个「⋯」，点开是一列。 */
export function PhoneMore({
  children,
  label = "More actions",
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <>
      <div className="contents max-sm:hidden">{children}</div>
      <div ref={ref} className={cn("relative sm:hidden", className)}>
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          data-phone-more
          onClick={() => setOpen((v) => !v)}
          className="rounded-[8px] border border-white/15 bg-white/[.04] font-bold tracking-[.1em] text-[#e2e8f0]"
        >
          ⋯
        </button>
        {open ? (
          <div
            data-phone-more-menu
            className="absolute right-0 z-40 mt-1 flex min-w-[200px] flex-col items-stretch gap-1.5 rounded-[10px] border border-white/15 bg-[#0f1c2d] p-2 shadow-[0_12px_32px_rgba(0,0,0,.5)]"
          >
            {children}
          </div>
        ) : null}
      </div>
    </>
  );
}

/** 黄框 / 红框提示的文字：手机上只显示一行，后面「More」点开看全文。报错不要用这个。 */
export function PhoneOneLine({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span
      data-phone-oneline={open ? "open" : "closed"}
      className={cn(
        "max-sm:flex max-sm:items-baseline max-sm:gap-2",
        className,
      )}
    >
      <span
        className={cn(!open && "max-sm:min-w-0 max-sm:flex-1 max-sm:truncate")}
      >
        {children}
      </span>
      <button
        type="button"
        data-phone-keep
        onClick={() => setOpen((v) => !v)}
        className="shrink-0 font-semibold underline sm:hidden"
      >
        {open ? "Less" : "More"}
      </button>
    </span>
  );
}

/** 新增表单这类设置区：手机上默认收起，点标题行展开。电脑上一直展开。 */
export function usePhoneCollapse() {
  const [open, setOpen] = useState(false);
  return {
    open,
    setOpen,
    toggle: () => setOpen((v) => !v),
    /** 加在要收起的内容上 */
    hide: open ? "" : "max-sm:hidden",
    /** 标题行后面的小箭头（只在手机上显示） */
    caret: (
      <span aria-hidden className="ml-auto text-[12px] opacity-70 sm:hidden">
        {open ? "▾" : "▸"}
      </span>
    ),
  };
}
