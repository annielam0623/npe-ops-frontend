import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { DailyTask } from "@/types";

import {
  sortByDue,
  summarizeDone,
  type TaskPeriod,
  taskPeriod,
} from "./config";

const TITLE: Record<TaskPeriod, { title: string; range: string }> = {
  any: { title: "Anytime", range: "no finish-by time, or repeats every hour" },
  am: { title: "AM", range: "before 12:00" },
  pm: { title: "PM", range: "12:00 and after" },
};

/**
 * Today’s tasks / My tasks 的 AM / PM 两张卡（Annie 2026-10-24「1 可以，2 上面 3.A 动手」，preview
 * https://claude.ai/artifact/HrofY7AzjRHK6KdfJaC67k 第 2 版）：左边一张上午卡、右边一张下午卡，
 * 按任务的 due_at 在洛杉矶 12:00 前 / 后分；没有截止时间或每小时重复的放两张卡上面一条虚线的 Anytime 卡。
 * 一边没有任务就不画那张卡（另一张占满一行）；Anytime 没有就不显示。进度是普通灰字，不是胶囊。
 * 两张卡并排只在这块自己够宽时（容器宽度 ≥ 640px）；窄时（Dashboard 里 My tasks 只占半宽、手机）AM 在上 PM 在下。
 */
export function PeriodCards({
  tasks,
  renderBody,
}: {
  tasks: DailyTask[];
  /** 一张卡里的内容（该卡的任务已按截止时间排好）。 */
  renderBody: (list: DailyTask[], period: TaskPeriod) => ReactNode;
}) {
  const by = (p: TaskPeriod) =>
    sortByDue(tasks.filter((t) => taskPeriod(t) === p));
  const any = by("any");
  const am = by("am");
  const pm = by("pm");
  const both = am.length > 0 && pm.length > 0;

  return (
    <div data-period-cards className="@container flex flex-col gap-3.5">
      {any.length > 0 ? (
        <Card period="any" list={any} renderBody={renderBody} />
      ) : null}
      {am.length > 0 || pm.length > 0 ? (
        <div
          className={cn(
            "grid grid-cols-1 items-start gap-3.5",
            both && "@[640px]:grid-cols-2",
          )}
        >
          {am.length > 0 ? (
            <Card period="am" list={am} renderBody={renderBody} />
          ) : null}
          {pm.length > 0 ? (
            <Card period="pm" list={pm} renderBody={renderBody} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Card({
  period,
  list,
  renderBody,
}: {
  period: TaskPeriod;
  list: DailyTask[];
  renderBody: (list: DailyTask[], period: TaskPeriod) => ReactNode;
}) {
  const { done, total } = summarizeDone(list);
  const { title, range } = TITLE[period];
  return (
    <div
      data-period={period}
      className={cn(
        "min-w-0 rounded-xl border bg-white/[.02] px-3.5 py-3",
        period === "any"
          ? "border-dashed border-white/20"
          : "border-white/[.14]",
      )}
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-b border-white/[.12] pb-2">
        <h3 className="text-[13.5px] font-bold tracking-[.03em]">{title}</h3>
        <span className="text-[11.5px] text-white/45">{range}</span>
        <span
          data-period-progress
          className="ml-auto text-[12px] font-semibold text-white/55 tabular-nums"
        >
          {done} of {total} done
        </span>
      </div>
      {renderBody(list, period)}
    </div>
  );
}
