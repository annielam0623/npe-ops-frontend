"use client";

import { safeUrl } from "@/components/bug-reports/config";
import { TaskComments } from "@/components/bug-reports/task-comments";
import { cn } from "@/lib/utils";
import type { ClickUpTask } from "@/types";

import {
  COMMENT_TEXT,
  formatDay,
  isDone,
  priorityOf,
  priorityTone,
  statusTone,
  TB_MARK,
} from "./config";

export function TaskCard({
  task,
  showList,
  open,
  who,
  onToggle,
  onUnauthorized,
  onOpenImage,
}: {
  task: ClickUpTask;
  /** 「指派给我」跨列表，标出属于哪个列表。 */
  showList: boolean;
  open: boolean;
  who: string;
  onToggle: () => void;
  onUnauthorized: () => void;
  onOpenImage: (url: string) => void;
}) {
  const p = priorityOf(task);
  const link = safeUrl(task.url);
  const assignees = task.assignees ?? [];
  const due = formatDay(task.due_date);

  return (
    <article
      className={cn(
        "overflow-hidden rounded-lg border border-stone-200 bg-white",
        isDone(task) && "opacity-60",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (
            e.target === e.currentTarget &&
            (e.key === "Enter" || e.key === " ")
          ) {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer flex-col gap-1.5 px-4 py-3 hover:bg-stone-50"
      >
        <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
          {p ? (
            <span className={cn("rounded px-1.5 py-0.5", priorityTone(p))}>
              {p}
            </span>
          ) : null}
          <span className={cn("rounded px-1.5 py-0.5", statusTone(task))}>
            {task.status?.status || "—"}
          </span>
          {showList && task.list?.name ? (
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-800">
              {task.list.name}
            </span>
          ) : null}
        </div>
        <div className="font-semibold [overflow-wrap:anywhere] text-stone-900">
          {task.name}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
          <span className="flex items-center gap-1">
            {assignees.length ? (
              <>
                {assignees.map((a) => {
                  const pic = safeUrl(a.profilePicture);
                  return pic ? (
                    // eslint-disable-next-line @next/next/no-img-element -- ClickUp 头像，外部地址
                    <img
                      key={a.id}
                      src={pic}
                      alt=""
                      title={a.username}
                      className="size-5 rounded-full"
                    />
                  ) : (
                    <span
                      key={a.id}
                      title={a.username}
                      className="flex size-5 items-center justify-center rounded-full bg-stone-300 text-[10px] font-semibold text-stone-700"
                    >
                      {a.initials || a.username.charAt(0)}
                    </span>
                  );
                })}
                <span className="text-stone-700">
                  {assignees.map((a) => a.username).join("、")}
                </span>
              </>
            ) : (
              <span className="text-stone-400">无负责人</span>
            )}
          </span>
          <span>创建: {formatDay(task.date_created)}</span>
          {due ? <span>截止: {due}</span> : null}
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-sky-700 hover:text-sky-900"
            >
              在 ClickUp 查看 ↗
            </a>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="flex flex-col gap-4 border-t border-stone-200 bg-stone-50 px-4 py-3">
          <div>
            <div className="mb-1 text-xs font-semibold text-stone-500">
              任务说明 / Description
            </div>
            <div className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap text-stone-800">
              {task.text_content?.trim() || "（这条任务没有填写说明）"}
            </div>
          </div>
          <TaskComments
            taskId={task.id}
            text={COMMENT_TEXT}
            who={who}
            prefix={`${TB_MARK} `}
            marker={TB_MARK}
            onUnauthorized={onUnauthorized}
            onOpenImage={onOpenImage}
          />
        </div>
      ) : null}
    </article>
  );
}
