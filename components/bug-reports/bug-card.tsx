"use client";

import { cn } from "@/lib/utils";
import type { ClickUpTask } from "@/types";

import {
  daysSince,
  formatDay,
  getReason,
  getSeverity,
  getWorkstream,
  isClosed,
  safeUrl,
  severityTone,
  statusTone,
} from "./config";
import type { Text } from "./i18n";
import { TaskComments } from "./task-comments";

export function BugCard({
  task,
  text,
  open,
  now,
  who,
  onToggle,
  onUnauthorized,
  onOpenImage,
}: {
  task: ClickUpTask;
  text: Text;
  open: boolean;
  now: number;
  who: string;
  onToggle: () => void;
  onUnauthorized: () => void;
  onOpenImage: (url: string) => void;
}) {
  const sev = getSeverity(task);
  const reason = getReason(task);
  const workstream = getWorkstream(task);
  const days = daysSince(task.date_created, now);
  const urgent = days > 7 && !isClosed(task);
  const assignees = task.assignees ?? [];
  const link = safeUrl(task.url);
  const status = task.status?.status ?? "";

  return (
    <article className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer flex-col gap-1.5 px-4 py-3 hover:bg-stone-50"
      >
        <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
          {sev ? (
            <span className={cn("rounded px-1.5 py-0.5", severityTone(sev))}>
              {sev}
            </span>
          ) : null}
          <span className={cn("rounded px-1.5 py-0.5", statusTone(status))}>
            {status || "—"}
          </span>
          {workstream ? (
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700">
              {workstream}
            </span>
          ) : null}
          {reason ? (
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-600">
              {reason}
            </span>
          ) : null}
        </div>
        <div className="font-semibold [overflow-wrap:anywhere] text-stone-900">
          {task.name}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
          <span className="flex items-center gap-1">
            {assignees.length ? (
              assignees.map((a) => {
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
              })
            ) : (
              <span className="text-stone-400">{text.noOwner}</span>
            )}
            {assignees.length ? (
              <span className="text-stone-700">
                {assignees.map((a) => a.username).join("、")}
              </span>
            ) : null}
          </span>
          <span>{text.created(formatDay(task.date_created))}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5",
              urgent ? "bg-red-50 font-semibold text-red-600" : "bg-stone-100",
            )}
          >
            {text.days(days)}
          </span>
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="text-sky-700 hover:text-sky-900"
            >
              {text.viewClickup}
            </a>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="flex flex-col gap-4 border-t border-stone-200 bg-stone-50 px-4 py-3">
          <div>
            <div className="mb-1 text-xs font-semibold text-stone-500">
              {text.description}
            </div>
            <div className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap text-stone-800">
              {task.text_content?.trim() || text.noDescription}
            </div>
          </div>
          <TaskComments
            taskId={task.id}
            text={text}
            who={who}
            onUnauthorized={onUnauthorized}
            onOpenImage={onOpenImage}
          />
        </div>
      ) : null}
    </article>
  );
}
