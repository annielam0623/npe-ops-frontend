import type { ReactNode } from "react";

/**
 * 排车页按操作顺序分的一步（后端 G29 第一批，Annie 2026-10-05 定）：序号 + 标题 + 一句话，
 * 下面放这一步自己的 How to use 和内容。每个标签各自编号（Annie 2026-10-07 拆 Assign / Send）：
 * Assign：Step 1 Guest lists / 2 Buses & drivers；Send：Step 1 Send to drivers / 2 Morning Relay — text guests。
 *
 * 样子照旧页面 dispatch_assignments.html 的 `.dstep*`：深底上的半透明框（不是白卡片）。
 */
export function StepBox({
  n,
  title,
  desc,
  id,
  headExtra,
  children,
}: {
  n: number;
  title: string;
  desc: ReactNode;
  id?: string;
  /** 标题行右边的东西（Guest lists 的 How to use 链接，同旧页面 `.tm-howto`）。 */
  headExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className="max-w-full min-w-0 scroll-mt-20 rounded-[14px] border border-white/10 bg-white/[.025] p-4"
    >
      <div className="mb-1 flex flex-wrap items-baseline gap-2.5">
        <span className="font-mono text-[12px] tracking-[.08em] text-[#fbbf24] uppercase">
          Step {n}
        </span>
        <h2 className="m-0 text-[18px] font-[650] text-white">{title}</h2>
        {headExtra}
      </div>
      {/* 说明告诉 staff 这一步做什么 / 发什么（Annie 2026-10-07：原来 12px 浅灰看不清，放大到 14px）。
          旧页面 `.dstep-d` 是 12.5px var(--muted)；字号按 Annie 的要求留 14px，颜色用深底上看得清的 #cbd5e1。 */}
      <div className="mb-3 max-w-[90ch] space-y-1 text-[14px] leading-relaxed text-[#cbd5e1] [&_b]:text-white">
        {desc}
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}
