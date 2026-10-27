"use client";

import { type ReactNode, useCallback, useLayoutEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import type { DailyTask } from "@/types";

import { splitTimeline, summarizeDone } from "./config";

/** 时间线一次露几条（Annie 对 v2 第 1 条「3 条工作显示」）。 */
const VISIBLE_ROWS = 3;

/**
 * My tasks / Today’s tasks 的任务时间线（G202，preview https://claude.ai/artifact/3ktywUdNA5AHHP5zY47a2w 第 3 版，
 * Annie 2026-10-27「186-对，动手」）：不分 AM / PM，按截止时间从早到晚排成一列，框里一次露 3 条，
 * 打开时自动停在下一条还没做的；到了截止时间没做的移进上面的红框 Overdue，列表跟着往下走。
 * 上面依次是 Anytime（没有截止时间 / 每小时重复）、Overdue、收起的 Earlier today（过了时间、做完的），
 * 这几块不算在 3 条里。不显示现在几点，也没有 NOW 标记。
 */
export function TaskTimeline({
  tasks,
  now,
  renderRow,
}: {
  tasks: DailyTask[];
  now: string;
  /** 一条任务的 <li>。 */
  renderRow: (task: DailyTask) => ReactNode;
}) {
  const { any, overdue, earlier, rest } = splitTimeline(tasks, now);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nextId = rest.find((t) => !t.done)?.id ?? null;
  // 只在列表本身变了（有条移进 Overdue、勾了 / 取消勾、新加的）时重新定位，轮询拿到同样的数据不打断员工自己滚。
  const listKey = rest.map((t) => `${t.id}:${t.done ? 1 : 0}`).join();

  /** 框高 = 从下一条起 3 条的高度；后面不够 3 条时用最后 3 条。返回下一条的 <li>。 */
  const fit = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return null;
    const items = [...box.querySelectorAll<HTMLElement>("li[data-task-id]")];
    if (items.length === 0) {
      box.style.maxHeight = "";
      return null;
    }
    const nextIndex = Math.max(
      0,
      items.findIndex((li) => li.dataset.taskId === String(nextId)),
    );
    const start = Math.max(0, Math.min(nextIndex, items.length - VISIBLE_ROWS));
    const first = items[start];
    const last = items[Math.min(start + VISIBLE_ROWS, items.length) - 1];
    box.style.maxHeight = `${last.offsetTop + last.offsetHeight - first.offsetTop + 2}px`;
    return { target: items[nextIndex], top: items[0] };
  }, [nextId]);

  useLayoutEffect(() => {
    const box = scrollRef.current;
    const placed = fit();
    if (box && placed) {
      box.scrollTop = placed.target.offsetTop - placed.top.offsetTop;
    }
  }, [fit, listKey]);

  // 宽度变了任务行会换行、变高：只重算框高，不动滚动位置。
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => void fit());
    observer.observe(box);
    return () => observer.disconnect();
  }, [fit]);

  return (
    <div data-timeline className="flex flex-col gap-3">
      {any.length > 0 ? (
        <Card
          part="any"
          title="Anytime"
          range="no finish-by time, or repeats every hour"
          count={`${summarizeDone(any).done} of ${any.length} done`}
          className="border-dashed border-white/20"
        >
          <List tasks={any} renderRow={renderRow} />
        </Card>
      ) : null}

      {overdue.length > 0 ? (
        <Card
          part="overdue"
          title="Overdue"
          range="past its time, not done yet"
          count={`${overdue.length} to do`}
          className="border-[#f87171]/45 bg-[#f87171]/[.05]"
          titleClassName="text-[#f87171]"
        >
          <List tasks={overdue} renderRow={renderRow} />
        </Card>
      ) : null}

      {earlier.length > 0 ? (
        <details
          data-timeline-part="earlier"
          className="rounded-[10px] border border-white/[.08] px-3.5 py-2 text-[12.5px] text-white/55"
        >
          <summary className="cursor-pointer list-none text-[12px] font-semibold text-[#38bdf8] hover:text-[#7dd3fc] [&::-webkit-details-marker]:hidden">
            ▸ Earlier today · {earlier.length} done
          </summary>
          <div className="mt-2">
            <List tasks={earlier} renderRow={renderRow} />
          </div>
        </details>
      ) : null}

      <div
        data-timeline-part="list"
        className="min-w-0 rounded-xl border border-white/[.14] bg-white/[.02] px-3.5 py-2.5"
      >
        <div
          ref={scrollRef}
          data-timeline-scroll
          className="relative -mr-2 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,.3)_transparent] overflow-y-auto pr-2"
        >
          {rest.length > 0 ? (
            <List tasks={rest} renderRow={renderRow} />
          ) : (
            <p className="py-1.5 text-[12px] text-white/30">
              {overdue.length > 0 ? "Nothing else due today." : "All done."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({
  part,
  title,
  range,
  count,
  className,
  titleClassName,
  children,
}: {
  part: "any" | "overdue";
  title: string;
  range: string;
  count: string;
  className: string;
  titleClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-timeline-part={part}
      className={cn(
        "min-w-0 rounded-xl border bg-white/[.02] px-3.5 py-3",
        className,
      )}
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-b border-white/[.12] pb-2">
        <h3
          className={cn(
            "text-[13.5px] font-bold tracking-[.03em]",
            titleClassName,
          )}
        >
          {title}
        </h3>
        <span className="text-[11.5px] text-white/45">{range}</span>
        <span
          data-timeline-count
          className="ml-auto text-[12px] font-semibold text-white/55 tabular-nums"
        >
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

function List({
  tasks,
  renderRow,
}: {
  tasks: DailyTask[];
  renderRow: (task: DailyTask) => ReactNode;
}) {
  return <ul className="flex flex-col gap-2">{tasks.map(renderRow)}</ul>;
}
