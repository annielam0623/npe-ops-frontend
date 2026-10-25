"use client";

import { useEffect, useState } from "react";

import { useDorVisible } from "@/components/daily-report/use-dor-visible";
import { DOR_CHANGED_EVENT } from "@/components/daily-report/config";
import { isStatus } from "@/lib/api-errors";
import { fetchOperationReports } from "@/lib/daily-report-api";
import { cn } from "@/lib/utils";

/** 点一下，页内滚到对应的那一块（顶栏是 sticky，.db-section 带了 scroll-margin-top）。 */
function scrollTo(selector: () => Element | null | undefined) {
  const el = selector();
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

interface Stat {
  key: string;
  value: number | null;
  label: string;
  target: () => Element | null | undefined;
}

/**
 * 今日统计四块（Annie 2026-10-24「统计块还是要有跳转功能，然后数字和面积都小一点，太占地方了」）：
 * Messages need reply / Tasks remaining / Handover to accept / Open reports。
 * 是可点的普通文字：没有底色、边框，不用蓝色（计数不做成按钮 / 胶囊）；hover 才出现下划线和箭头。
 * 数字都是前端从已有数据数出来的，没有新接口：
 * - 待回复 = Messages 标题旁那个数（同一份轮询数据）；剩余任务 = 任务框里没勾的；
 * - 待接受的交接 = Notice 里等着 Accept 的（主管视角 / 任务框收起时没有这个概念，不显示）；
 * - 未结报告 = Daily Operation Report 的未结数（板块对我不可见时不显示，也不请求 DOR 接口）。
 */
export function StatsRow({
  messages,
  tasks,
  handovers,
  onUnauthorized,
}: {
  messages: number | null;
  tasks: number | null;
  handovers: number | null;
  onUnauthorized: () => void;
}) {
  const reports = useOpenReports(onUnauthorized);

  const stats: Stat[] = [
    {
      key: "messages",
      value: messages,
      label: "Messages need reply",
      target: () =>
        document.getElementById("messages-title")?.closest("section"),
    },
    {
      key: "tasks",
      value: tasks,
      label: "Tasks remaining",
      target: () =>
        document.querySelector(
          'section[aria-label="My tasks"], section[aria-label="Today\'s tasks"]',
        ),
    },
    ...(handovers !== null
      ? [
          {
            key: "handovers",
            value: handovers,
            label: "Handover to accept",
            target: () => document.querySelector('aside[aria-label="Notice"]'),
          } satisfies Stat,
        ]
      : []),
    ...(reports !== undefined
      ? [
          {
            key: "reports",
            value: reports,
            label: "Open reports",
            target: () =>
              document.querySelector(
                'section[aria-label="Daily Operation Report"]',
              ),
          } satisfies Stat,
        ]
      : []),
  ];

  return (
    <div
      data-stats-row
      role="group"
      aria-label="Today at a glance"
      className="mb-[18px] flex flex-wrap items-baseline gap-x-8 gap-y-1.5 px-1"
    >
      {stats.map((s) => (
        <button
          key={s.key}
          type="button"
          data-stat={s.key}
          onClick={() => scrollTo(s.target)}
          className="group inline-flex cursor-pointer items-baseline gap-1.5 bg-transparent p-0 text-left text-white"
        >
          <span className="text-[17px] leading-none font-semibold tabular-nums">
            {s.value ?? "–"}
          </span>
          <span
            className={cn(
              "text-[12.5px] text-white/65 group-hover:text-white group-hover:underline group-hover:underline-offset-[3px]",
            )}
          >
            {s.label}
            <span
              aria-hidden
              className="ml-1 opacity-0 transition-opacity group-hover:opacity-100"
            >
              →
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * 未结报告数。undefined = 不显示这一项（板块对我不可见 / 读不到）；null = 还在读。
 * 板块不可见时不请求 DOR 接口（非 Super Admin 开关关着会 403）。每分钟刷新一次，DOR 块里新建 / 改状态后立刻刷新。
 */
function useOpenReports(onUnauthorized: () => void): number | null | undefined {
  const { state } = useDorVisible(onUnauthorized);
  const [count, setCount] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (state !== "visible") {
      setCount(undefined);
      return;
    }
    let stopped = false;
    const controller = new AbortController();
    async function load() {
      try {
        const data = await fetchOperationReports(
          { limit: 1 },
          controller.signal,
        );
        if (!stopped) setCount(data.total);
      } catch (error) {
        if (stopped) return;
        if (isStatus(error, 401)) onUnauthorized();
        // 其他错误：保留上一次的数，下一轮再试。
      }
    }
    setCount((c) => (c === undefined ? null : c));
    void load();
    const timer = setInterval(load, 60_000);
    const onChanged = () => void load();
    window.addEventListener(DOR_CHANGED_EVENT, onChanged);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener(DOR_CHANGED_EVENT, onChanged);
    };
  }, [state, onUnauthorized]);

  return state === "loading" ? undefined : count;
}
