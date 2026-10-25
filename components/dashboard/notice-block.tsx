"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { TasksModel } from "@/components/tasks/tasks-section";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchNotices,
  markAllNoticesRead,
  markNoticeRead,
  type ApiNotice,
} from "@/lib/notices-api";
import { acceptPassOver } from "@/lib/tasks-api";
import type { DailyTask } from "@/types";

import { POLL_INTERVAL_MS } from "./config";
import { NoticePanel } from "./notice-panel";

/**
 * Dashboard 的 Notice（Annie 2026-10-24 定死：问候行 → My shortcuts → Notice，之后才是其他块，不再问）。
 * 任务数据和 Notice 里待接受的交接是同一份（调用方取一次传进来），Accept 后任务立刻进 My tasks 清单。
 * 返回要画的 Notice 面板（不该显示就是 null）和是不是「员工视角、My tasks 并排在右边」（Annie 2026-10-24：Notice 只占一半宽，一半就够了）。
 */
export function useNoticeBlock(
  tasks: TasksModel,
  onUnauthorized: () => void,
): { panel: ReactNode; withTasks: boolean; handoverCount: number | null } {
  const { schedule, markRead, markAllRead } = useApiNotices(onUnauthorized);

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

  const hasNotice = handovers.length > 0 || schedule.length > 0;
  const tasksGone =
    tasks.notReady ||
    tasks.state.kind === "forbidden" ||
    tasks.state.kind === "error";

  // 员工视角（任务框正常）：My tasks 放在 Notice 右边，没有要看的也写 "No new notices"（位置不跳）。
  // 任务框收起（后端没上线 / 没权限 / 出错）或主管视角（任务框是整行大表）：Notice 有内容才放，只占一半宽。
  const withTasks = !tasksGone && !isSupervisor;
  // 统计块「Handover to accept」：主管视角 / 任务框收起时没有这个概念（null = 不显示）。
  const handoverCount = withTasks ? handovers.length : null;
  if (!withTasks && !hasNotice)
    return { panel: null, withTasks, handoverCount };

  return {
    withTasks,
    handoverCount,
    panel: (
      <NoticePanel
        handovers={handovers}
        schedule={schedule}
        acceptingId={acceptingId}
        error={acceptError}
        onAccept={(t) => void accept(t)}
        onGotIt={markRead}
        onMarkAllRead={markAllRead}
      />
    ),
  };
}

/** 排班类提醒：轮询；接口没上线（404）就安静地当没有。已读存服务端，点 Got it 先从面板拿掉。 */
function useApiNotices(onUnauthorized: () => void) {
  const [schedule, setSchedule] = useState<ApiNotice[]>([]);
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    try {
      const list = await fetchNotices();
      // 有按钮要点的（B 期交接 handover_*）这次不接：交接仍走 /api/tasks/today，不在这里重复显示。
      setSchedule(list.filter((n) => !n.is_read && n.actions.length === 0));
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
    (notice: ApiNotice) => {
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
