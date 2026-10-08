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
} from "./legacy-styles";
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
    // 样式照旧页面 bug_reports.html 的 .bug-card。
    <article className={CARD_CLASS}>
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
        className="cursor-pointer"
      >
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {sev ? (
            <span className={cn(BADGE_CLASS, severityTone(sev))}>{sev}</span>
          ) : null}
          <span className={cn(BADGE_CLASS, statusTone(status))}>
            {status || "—"}
          </span>
          {workstream ? (
            // 旧页面的 .b-ws 没有定义样式（白卡上是白字，看不见）；这里用卡片正文的深色字、不加底色。
            <span className={cn(BADGE_CLASS, "text-[#0f172a]")}>
              {workstream}
            </span>
          ) : null}
          {reason ? (
            <span
              className={cn(
                BADGE_CLASS,
                "border-[#c4b5fd] bg-[#f5f3ff] text-[#5b21b6]",
              )}
            >
              {reason}
            </span>
          ) : null}
        </div>
        <div data-card-title className={CARD_TITLE_CLASS}>
          {task.name}
        </div>
        <div className={CARD_META_CLASS}>
          <div className="flex items-center gap-[3px]">
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
              })
            ) : (
              <span className="text-[12px] text-[#94a3b8]">{text.noOwner}</span>
            )}
            {assignees.length ? (
              <span className="text-[12px]">
                {assignees.map((a) => a.username).join("、")}
              </span>
            ) : null}
          </div>
          <span>{text.created(formatDay(task.date_created))}</span>
          <span
            className={cn(
              "rounded-[20px] border px-[7px] py-0.5 text-[11px]",
              urgent
                ? "days-urgent border-[#fca5a5] bg-[#fee2e2] text-[#991b1b]"
                : "border-[#fde047] bg-[#fef9c3] text-[#854d0e]",
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
              className={CARD_LINK_CLASS}
            >
              {text.viewClickup}
            </a>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className={EXPAND_PANEL_CLASS}>
          <div className={DESC_SECTION_CLASS}>
            <div className={PANEL_LABEL_CLASS}>{text.description}</div>
            <div className={DESC_TEXT_CLASS}>
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
