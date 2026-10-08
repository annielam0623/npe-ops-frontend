import type { ReactNode } from "react";

/**
 * 排车页按操作顺序分的一步（后端 G29 第一批，Annie 2026-10-05 定）：序号 + 标题 + 一句话，
 * 下面放这一步自己的 How to use 和内容。每个标签各自编号（Annie 2026-10-07 拆 Assign / Send）：
 * Assign：Step 1 Guest lists / 2 Buses & drivers；Send：Step 1 Send to drivers / 2 Morning Relay — text guests。
 */
export function StepBox({
  n,
  title,
  desc,
  id,
  children,
}: {
  n: number;
  title: string;
  desc: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className="flex max-w-full min-w-0 scroll-mt-3 flex-col gap-3 rounded-xl border border-stone-300 bg-stone-50/70 p-4"
    >
      <div>
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="font-mono text-xs tracking-widest text-amber-600 uppercase">
            Step {n}
          </span>
          <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
        </div>
        {/* 说明告诉 staff 这一步做什么 / 发什么（Annie 2026-10-07：原来 12px 浅灰看不清），用正文字号和深色。 */}
        <div className="mt-1 max-w-[90ch] space-y-1 text-sm leading-relaxed text-stone-800">
          {desc}
        </div>
      </div>
      {children}
    </section>
  );
}
