"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

import { usePhoneCollapse, usePhoneInfo } from "@/components/ui/phone";
import { cn } from "@/lib/utils";

/** 手机上这一步的「i」开没开（这一步里的 How to use 框跟着它显示 / 收起）。电脑上不管。 */
const StepInfoContext = createContext(true);
/** 这一步里的说明类东西（How to use 框）加这个 class：手机上没点 i 时收起。 */
export function useStepInfoHide(): string {
  return useContext(StepInfoContext) ? "" : "max-sm:hidden";
}

/**
 * 排车页按操作顺序分的一步（后端 G29 第一批，Annie 2026-10-05 定）：序号 + 标题 + 一句话，
 * 下面放这一步自己的 How to use 和内容。每个标签各自编号（Annie 2026-10-07 拆 Assign / Send）：
 * Assign：Step 1 Guest lists / 2 Buses & drivers；Send：Step 1 Send to drivers / 2 Morning Relay — text guests。
 *
 * 样子照旧页面 dispatch_assignments.html 的 `.dstep*`：深底上的半透明框（不是白卡片）。
 * 手机上（Annie 2026-11-01 手机版规则）：那句说明和 How to use 收进标题后的「i」。
 */
export function StepBox({
  n,
  title,
  desc,
  id,
  headExtra,
  phoneFold = false,
  phoneAlert = false,
  children,
}: {
  n: number;
  title: string;
  desc: ReactNode;
  id?: string;
  /** 标题行右边的东西（Guest lists 的 How to use 链接，同旧页面 `.tm-howto`）。 */
  headExtra?: ReactNode;
  /** 置顶 115 题 8 A：手机上这一步默认收成一行（标题 + Show），点开才展开；电脑上一直展开。 */
  phoneFold?: boolean;
  /** 置顶 115 P4 B（Annie「115全部同意推荐，动手」）：这一步里有要处理的提醒时，手机上自动展开（之后仍可手动收起）。 */
  phoneAlert?: boolean;
  children: ReactNode;
}) {
  const info = usePhoneInfo(`About ${title}`);
  const fold = usePhoneCollapse();
  const setFoldOpen = fold.setOpen;
  // 提醒从无到有时展开一次；staff 自己收起后，提醒不变就不再弹开。
  useEffect(() => {
    if (phoneFold && phoneAlert) setFoldOpen(true);
  }, [phoneFold, phoneAlert, setFoldOpen]);
  const folded = phoneFold ? fold.hide : "";
  return (
    <section
      id={id}
      aria-label={title}
      className={cn(
        "max-w-full min-w-0 scroll-mt-20 rounded-[14px] border border-white/10 bg-white/[.025] p-4 max-sm:p-3",
        phoneFold && !fold.open && "max-sm:py-2",
      )}
    >
      <div
        className={cn(
          "mb-1 flex flex-wrap items-baseline gap-2.5",
          phoneFold && !fold.open && "max-sm:mb-0",
        )}
      >
        <span className="font-mono text-[12px] tracking-[.08em] text-[#fbbf24] uppercase">
          Step {n}
        </span>
        <h2 className="m-0 text-[18px] font-[650] text-white max-sm:text-[16px]">
          {title}
          {info.button}
        </h2>
        {headExtra ? (
          <span className={cn("contents", info.hide, folded)}>{headExtra}</span>
        ) : null}
        {phoneFold ? (
          <button
            type="button"
            data-step-fold={n}
            aria-expanded={fold.open}
            onClick={fold.toggle}
            className="ml-auto cursor-pointer text-[12.5px] font-semibold text-[#93c5fd] sm:hidden"
          >
            {fold.open ? "Hide ▾" : "Show ▸"}
          </button>
        ) : null}
      </div>
      {/* 说明告诉 staff 这一步做什么 / 发什么（Annie 2026-10-07：原来 12px 浅灰看不清，放大到 14px）。
          旧页面 `.dstep-d` 是 12.5px var(--muted)；字号按 Annie 的要求留 14px，颜色用深底上看得清的 #cbd5e1。
          不限宽、占满整行（Annie 2026-10-12：别在中间就折行）。 */}
      <div
        className={cn(
          "mb-3 space-y-1 text-[14px] leading-relaxed text-[#cbd5e1] [&_b]:text-white",
          info.hide,
          folded,
        )}
      >
        {desc}
      </div>
      <StepInfoContext.Provider value={info.open}>
        <div className={cn("flex min-w-0 flex-col gap-3", folded)}>
          {children}
        </div>
      </StepInfoContext.Provider>
    </section>
  );
}
