"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { BlockGate } from "@/components/dashboard/widget-gates";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchTasksToday } from "@/lib/tasks-api";
import type { DailyTask, TasksToday } from "@/types";

import { CLOCK_TICK_MS, POLL_INTERVAL_MS } from "../dashboard/config";
import { EmployeeTasks } from "./employee-view";
import { ReminderPopup } from "./reminder-popup";
import { SupervisorTasks } from "./supervisor-view";

/**
 * 倒计时 / 提醒不想死等 60 秒一轮的轮询：服务器最后一次给的 now 加上客户端走过的时间，
 * 每 30 秒重算一次（同 messages-section 的 useNow 做法）。
 */
function useLiveNow(serverNow: string | null): string | null {
  const [tick, setTick] = useState(0);
  // 初值用当前时刻而不是 0：挂载后第一次渲染是同步的，effect 还没跑，
  // 用 0 当「拉到数据的时刻」会把 elapsed 算成 Date.now() 这么大，now 直接跳到天边去。
  const fetchedAtRef = useRef(Date.now());
  useEffect(() => {
    if (serverNow) fetchedAtRef.current = Date.now();
  }, [serverNow]);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  if (!serverNow) return null;
  void tick;
  const elapsed = Date.now() - fetchedAtRef.current;
  return new Date(new Date(serverNow).getTime() + elapsed).toISOString();
}

export type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: TasksToday };

export interface TasksModel {
  state: LoadState;
  /** 后端没上线（404）：整块安静收起。 */
  notReady: boolean;
  handleChanged: (updated: DailyTask) => void;
}

/**
 * 今天的任务数据（轮询）。任务框和它旁边的 Notice 面板（待接受的交接）共用同一份，
 * 所以放在 Dashboard 顶部一行（components/dashboard/top-row.tsx）里取一次，不各取各的。
 */
export function useTasksToday(onUnauthorized: () => void): TasksModel {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [notReady, setNotReady] = useState(false);
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(
    async (silent: boolean) => {
      try {
        const data = await fetchTasksToday();
        setState({ kind: "ready", data });
        setNotReady(false);
      } catch (error) {
        if (isStatus(error, 401)) {
          onUnauthorized();
        } else if (isStatus(error, 403)) {
          setState({ kind: "forbidden" });
        } else if (isStatus(error, 404)) {
          // 后端还没上线：安静收起，不当错误处理。
          setNotReady(true);
        } else if (!silent) {
          setState({ kind: "error", message: describeError(error) });
        }
      }
    },
    [onUnauthorized],
  );

  useEffect(() => {
    loadRef.current = () => void load(true);
    void load(false);
    const timer = setInterval(() => loadRef.current(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const handleChanged = useCallback(
    (updated: DailyTask) => {
      setState((prev) => {
        if (prev.kind !== "ready") return prev;
        const tasks = prev.data.tasks.some((t) => t.id === updated.id)
          ? prev.data.tasks.map((t) => (t.id === updated.id ? updated : t))
          : [...prev.data.tasks, updated];
        const pending_pass_overs = prev.data.pending_pass_overs.filter(
          (t) => t.id !== updated.id,
        );
        return {
          kind: "ready",
          data: { ...prev.data, tasks, pending_pass_overs },
        };
      });
      // 操作完立刻重拉一次，拿后端算好的交接通知 / 待接受名单等衍生字段。
      void load(true);
    },
    [load],
  );

  return { state, notReady, handleChanged };
}

/**
 * 任务框（阶段三）：员工只看自己的任务，主管看全队按岗位分组。后端接口还没有（2026-10-16），
 * 404 时整块按「下一阶段再做」收起，不挡 Dashboard 其余部分（同 Daily Operation Report 占位的退让方式）。
 */
export function TasksSection({
  model,
  onUnauthorized,
  gate,
}: {
  model: TasksModel;
  onUnauthorized: () => void;
  /** Super Admin 的「员工可见」开关（Annie 2026-10-25「把task和notice都加上开关」）。 */
  gate?: BlockGate;
}) {
  const { state, notReady, handleChanged } = model;
  if (notReady) {
    return null;
  }

  switch (state.kind) {
    case "loading":
      // aria-label 故意和下面「准备好了」的两个标题区分开（不叫 "My tasks" / "Today's tasks"）：
      // 不然测试脚本等它们出现时，会被这个占位骨架抢先命中，内容其实还没加载出来。
      return (
        <section
          aria-label="Today's tasks (loading)"
          className="db-section mb-[18px] rounded-[16px] border border-white/[.14] px-[18px] py-4"
        >
          <h2 className="db-title text-[15px]">Today’s tasks</h2>
          <p className="mt-1 text-[12.5px] text-white/60">Loading…</p>
        </section>
      );
    case "forbidden":
      return null;
    case "error":
      return (
        <section
          aria-label="Today's tasks (error)"
          className="mb-[18px] rounded-[16px] border border-[#f87171]/35 bg-[#f87171]/[.06] px-[18px] py-4"
        >
          <h2 className="text-[15px] font-semibold">Today’s tasks</h2>
          <p className="mt-1 text-[12.5px] text-[#fca5a5]">
            Could not load today’s tasks: {state.message}
          </p>
        </section>
      );
    case "ready":
      return (
        <TasksReady
          data={state.data}
          onChanged={handleChanged}
          onUnauthorized={onUnauthorized}
          gate={gate}
        />
      );
  }
}

function TasksReady({
  data,
  onChanged,
  onUnauthorized,
  gate,
}: {
  data: TasksToday;
  onChanged: (task: DailyTask) => void;
  onUnauthorized: () => void;
  gate?: BlockGate;
}) {
  const liveNow = useLiveNow(data.now) ?? data.now;
  const live = { ...data, now: liveNow };

  const tasks = live.is_supervisor_view ? (
    <SupervisorTasks
      data={live}
      onChanged={onChanged}
      onUnauthorized={onUnauthorized}
      gate={gate}
    />
  ) : (
    <EmployeeTasks
      data={live}
      onChanged={onChanged}
      onUnauthorized={onUnauthorized}
      gate={gate}
    />
  );

  return (
    <>
      {tasks}
      {!live.is_supervisor_view ? (
        <ReminderPopup tasks={live.tasks} now={live.now} />
      ) : null}
    </>
  );
}
