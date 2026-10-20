"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TasksSection, useTasksToday } from "@/components/tasks/tasks-section";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchScheduleNotices,
  markAllNoticesRead,
  markNoticeRead,
  type ScheduleNotice,
} from "@/lib/notices-api";
import { acceptPassOver } from "@/lib/tasks-api";
import type { DailyTask } from "@/types";

import { POLL_INTERVAL_MS } from "./config";
import { NoticePanel } from "./notice-panel";

/**
 * Dashboard 最上面一行（Annie 2026-10-19）：My tasks 和 Notice 并排、左右各一半。
 * 主管视角的任务框是整队的大表，放不进半边：任务框整行，Notice 有内容时放在它上面。
 * 任务数据和 Notice 里待接受的交接是同一份（取一次），Accept 后任务立刻进 My tasks 清单。
 */
export function TopRow({ onUnauthorized }: { onUnauthorized: () => void }) {
  const tasks = useTasksToday(onUnauthorized);
  const { schedule, markRead, markAllRead } = useScheduleNotices(onUnauthorized);

  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [acceptError, setAcceptError] = useState("");

  const ready = tasks.state.kind === "ready" ? tasks.state.data : null;
  const isSupervisor = !!ready?.is_supervisor_view;
  const handovers: DailyTask[] =
    ready && !isSupervisor ? ready.pending_pass_overs : [];

  async function accept(task: DailyTask) {
    if (acceptingId !== null) return;
    setAcceptingId(task.id);
    setAcceptError("");
    try {
      const updated = await acceptPassOver(task.id);
      tasks.handleChanged(updated);
    } catch (err) {
      if (isStatus(err, 401)) onUnauthorized();
      else setAcceptError(describeError(err));
    } finally {
      setAcceptingId(null);
    }
  }

  const notice = (
    <NoticePanel
      handovers={handovers}
      schedule={schedule}
      acceptingId={acceptingId}
      error={acceptError}
      onAccept={(t) => void accept(t)}
      onGotIt={markRead}
      onMarkAllRead={markAllRead}
    />
  );
  const hasNotice = handovers.length > 0 || schedule.length > 0;
  const tasksGone =
    tasks.notReady ||
    tasks.state.kind === "forbidden" ||
    tasks.state.kind === "error";

  // 任务框收起（后端没上线 / 没权限 / 出错）或主管视角：Notice 有内容才放，整行宽。
  if (tasksGone || isSupervisor) {
    return (
      <>
        {hasNotice ? <div className="mb-[18px]">{notice}</div> : null}
        <TasksSection model={tasks} onUnauthorized={onUnauthorized} />
      </>
    );
  }

  return (
    <div
      data-top-row
      className="mb-[18px] grid grid-cols-1 items-stretch gap-[18px] md:grid-cols-2 [&>*]:min-w-0 [&>section]:mb-0 [&>section]:h-full"
    >
      <TasksSection model={tasks} onUnauthorized={onUnauthorized} />
      <div>{notice}</div>
    </div>
  );
}

/** 排班类提醒：轮询；接口没上线（404）就安静地当没有。已读存服务端，点 Got it 先从面板拿掉。 */
function useScheduleNotices(onUnauthorized: () => void) {
  const [schedule, setSchedule] = useState<ScheduleNotice[]>([]);
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    try {
      const list = await fetchScheduleNotices();
      setSchedule(list.filter((n) => !n.read));
    } catch (error) {
      if (isStatus(error, 401)) onUnauthorized();
      else if (isStatus(error, 404)) setSchedule([]);
      // 其他错误：保留上一次的，下一轮再试，不吵 staff。
    }
  }, [onUnauthorized]);

  useEffect(() => {
    loadRef.current = () => void load();
    void load();
    const timer = setInterval(() => loadRef.current(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const markRead = useCallback(
    (notice: ScheduleNotice) => {
      setSchedule((prev) => prev.filter((n) => n.id !== notice.id));
      markNoticeRead(notice.id).catch((error) => {
        if (isStatus(error, 401)) onUnauthorized();
        else void load(); // 没存上：重拉，让它回来。
      });
    },
    [load, onUnauthorized],
  );

  const markAllRead = useCallback(() => {
    setSchedule([]);
    markAllNoticesRead().catch((error) => {
      if (isStatus(error, 401)) onUnauthorized();
      else void load();
    });
  }, [load, onUnauthorized]);

  return { schedule, markRead, markAllRead };
}
