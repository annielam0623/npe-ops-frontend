"use client";

import { safeUrl } from "@/components/bug-reports/config";
import {
  AVATAR_CLASS,
  AVATAR_PLACEHOLDER_CLASS,
  BADGE_CLASS,
  CARD_CLASS,
  CARD_LINK_CLASS,
  CARD_META_CLASS,
  CARD_TITLE_CLASS,
  DESC_SECTION_CLASS,
  DESC_TEXT_CLASS,
  EXPAND_PANEL_CLASS,
  PANEL_LABEL_CLASS,
} from "@/components/bug-reports/legacy-styles";
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
    // 样式照旧页面 task_board.html 的 .task-card（已完成的整张淡到 .62）。
    <article className={cn(CARD_CLASS, isDone(task) && "opacity-[.62]")}>
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
        className="cursor-pointer"
      >
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {p ? (
            <span className={cn(BADGE_CLASS, priorityTone(p))}>{p}</span>
          ) : null}
          <span className={cn(BADGE_CLASS, statusTone(task))}>
            {task.status?.status || "—"}
          </span>
          {showList && task.list?.name ? (
            <span
              className={cn(
                BADGE_CLASS,
                "border-[#c4b5fd] bg-[#f5f3ff] text-[#5b21b6]",
              )}
            >
              {task.list.name}
            </span>
          ) : null}
        </div>
        <div data-card-title className={CARD_TITLE_CLASS}>
          {task.name}
        </div>
        <div className={CARD_META_CLASS}>
          <div className="flex items-center gap-[3px]">
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
                      className={AVATAR_CLASS}
                    />
                  ) : (
                    <span
                      key={a.id}
                      title={a.username}
                      className={AVATAR_PLACEHOLDER_CLASS}
                    >
                      {a.initials || a.username.charAt(0)}
                    </span>
                  );
                })}
                <span className="text-[12px]">
                  {assignees.map((a) => a.username).join("、")}
                </span>
              </>
            ) : (
              <span className="text-[12px] text-[#94a3b8]">无负责人</span>
            )}
          </div>
          <span>创建: {formatDay(task.date_created)}</span>
          {due ? <span>截止: {due}</span> : null}
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={CARD_LINK_CLASS}
            >
              在 ClickUp 查看 ↗
            </a>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className={EXPAND_PANEL_CLASS}>
          <div className={DESC_SECTION_CLASS}>
            <div className={PANEL_LABEL_CLASS}>任务说明 / Description</div>
            <div className={DESC_TEXT_CLASS}>
              {task.text_content?.trim() || "（这条任务没有填写说明）"}
            </div>
          </div>
          <TaskComments
            taskId={task.id}
            text={COMMENT_TEXT}
            who={who}
            prefix={`${TB_MARK} `}
            marker={TB_MARK}
            markTone="purple"
            onUnauthorized={onUnauthorized}
            onOpenImage={onOpenImage}
          />
        </div>
      ) : null}
    </article>
  );
}
