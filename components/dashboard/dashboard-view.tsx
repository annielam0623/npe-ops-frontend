"use client";

import { IBM_Plex_Sans } from "next/font/google";
import { useCallback, useEffect, useRef, useState } from "react";

import { DorSection } from "@/components/daily-report/dor-section";
import { TasksSection, useTasksToday } from "@/components/tasks/tasks-section";
import { CenteredPage } from "@/components/ui/centered-page";
import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { usePermissions } from "@/lib/staff-permissions";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/types";

import { MessagesSection, useUnhandledMessages } from "./messages-section";
import { StatsRow } from "./stats-row";
import { ScheduleSection } from "./schedule-section";
import { ShortcutsSection } from "./shortcuts-section";
import { TodayTeamSection } from "./today-team-section";
import {
  WIDGET_NOTICE,
  WIDGET_REPLY,
  WIDGET_STATS,
  WIDGET_TASKS,
  WIDGET_TODAY_TEAM,
  WIDGET_WEEK_SCHEDULE,
  WidgetStaffSwitch,
  type GateKey,
  useWidgetGates,
} from "./widget-gates";
import { useNoticeBlock } from "./notice-block";

// 字体、配色照旧后台 dashboard.html（Annie 2026-10-07：要和旧前端一模一样，深色底）。
// 旧页面只加载 300–700，650 / 750 / 800 落回 700；这里同样只要这几档。
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; me: CurrentUser };

export function DashboardView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  // 递增即重新校验身份（首次加载、Retry）。
  const [reloadKey, setReloadKey] = useState(0);

  const redirectingRef = useRef(false);

  // 与其他页面一致：401 跳旧后台登录页，next 带上当前页面完整 URL。
  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setView({ kind: "loading" });

    (async () => {
      try {
        const me = await fetchCurrentUser(signal);
        if (!signal.aborted) {
          setView({ kind: "ready", me });
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        if (isStatus(error, 401)) {
          redirectToLogin();
        } else if (isStatus(error, 403)) {
          // driver / guide：旧 dashboard 同样是 require_staff。
          setView({ kind: "forbidden" });
        } else {
          setView({ kind: "error", message: describeError(error) });
        }
      }
    })();

    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  return (
    // 底色、内边距由整站外框（照 base.html）提供；这里只照旧 .db：max-width 1400、居中、IBM Plex Sans。
    <main className={cn(plex.className, "relative text-[#f8fafc]")}>
      <CenteredPage className="relative z-[1] flex flex-col">
        {/* 问候语和日期挪到了顶栏（Annie 2026-10-14：问候语不需要那么多位置），见 components/nav/app-frame.tsx。 */}
        <h1 className="sr-only">Dashboard</h1>

        <DashboardBody
          view={view}
          onRetry={() => setReloadKey((k) => k + 1)}
          onUnauthorized={redirectToLogin}
        />
      </CenteredPage>
    </main>
  );
}

function DashboardBody({
  view,
  onRetry,
  onUnauthorized,
}: {
  view: ViewState;
  onRetry: () => void;
  onUnauthorized: () => void;
}) {
  switch (view.kind) {
    case "loading":
      return <DarkPanel>Loading...</DarkPanel>;
    case "forbidden":
      return (
        <DarkPanel>
          <p className="font-semibold">Staff access required</p>
          <p className="mt-1 text-white/60">
            This page is for back-office staff only.
          </p>
        </DarkPanel>
      );
    case "error":
      return (
        <ErrorBanner actionLabel="Retry" onAction={onRetry}>
          Failed to load your account: {view.message}
        </ErrorBanner>
      );
    case "ready":
      return <ReadyBody me={view.me} onUnauthorized={onUnauthorized} />;
  }
}

/** 同旧页面 .panel：深色底上的半透明白卡片。 */
function DarkPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[.032] p-[22px] text-sm">
      {children}
    </div>
  );
}

/**
 * 区块顺序（员工、主管一样）：问候行（在顶栏里）→ My shortcuts → Notice（整行）→ 统计行 → Messages
 * → 任务框（员工 My tasks / 主管 Today's tasks）→ Today's team（今天谁上什么班）→ Daily Operation Report
 * → Schedule（本周整周排班，页面最底部）。
 * 任务数据和 Notice 里待接受的交接是同一份，所以在这里取一次，Notice 和 My tasks 共用。
 * 进了别的页面，同一份 shortcuts 变成顶栏下面的导航条（nav/shortcut-bar.tsx）。
 */
function ReadyBody({
  me,
  onUnauthorized,
}: {
  me: CurrentUser;
  onUnauthorized: () => void;
}) {
  const tasks = useTasksToday(onUnauthorized);
  // 员工权限（lib/staff-permissions.ts）：每块还要按来源模块的勾，和开关两道都要过。
  // Messages 面板看三个 tracking 的 view 任一项，再加 messages.view（后端 d7 53a1a39d；员工那边见 STAFF_MESSAGES_BY_TICK）；
  // 看不到就不拉，免得每 60 秒一次 403。
  const perms = usePermissions();
  const showMessages =
    perms.canAny(["tour.view", "tickets.view", "morning.view"]) &&
    perms.canMessages("messages.view");
  const poll = useUnhandledMessages(onUnauthorized, showMessages);
  // 本批新板块 / 功能默认只 Super Admin 可见；Notice / 任务块默认员工可见（Annie 2026-10-25），
  // 都由 Super Admin 在版面上切「员工可见」。
  const isSuperAdmin = !!me.is_superadmin;
  const gates = useWidgetGates(isSuperAdmin, onUnauthorized);
  const staffSwitch = (key: GateKey, what?: string) =>
    isSuperAdmin ? (
      <WidgetStaffSwitch
        widgetKey={key}
        onUnauthorized={onUnauthorized}
        what={what}
      />
    ) : null;
  const blockGate = (key: GateKey) => ({
    staffSwitch: staffSwitch(key),
    hiddenFromStaff: isSuperAdmin && !gates[key].staffSees,
  });
  // Notice 跟 dashboard.view（Q3 A，进得来就有）。
  const showNotice = gates[WIDGET_NOTICE].visible;
  const showTasks =
    gates[WIDGET_TASKS].visible &&
    perms.canAny(["tasks.view_own", "tasks.view_all"]);
  const showSchedule = perms.can("schedule.view");
  const { panel, handoverCount } = useNoticeBlock(
    tasks,
    onUnauthorized,
    blockGate(WIDGET_NOTICE),
  );
  // 统计块：待回复 = Messages 标题旁那个数；剩余任务 = 任务框里的「N of M done」反过来。
  const taskData = tasks.state.kind === "ready" ? tasks.state.data : null;
  const tasksRemaining = taskData
    ? taskData.tasks.filter((t) => !t.done).length
    : null;
  return (
    <>
      <ShortcutsSection />
      {/* Notice 整行宽，横排（每条一张卡，底部横向滚动条），紧跟 My shortcuts。 */}
      {showNotice && panel ? (
        <div data-notice-block className="mb-[18px]">
          {panel}
        </div>
      ) : null}
      {gates[WIDGET_STATS].visible ? (
        <StatsRow
          messages={showMessages && poll.data ? poll.data.count : null}
          // 依赖的块对我关着时，这一项也不显示（undefined / null = 不显示）。
          tasks={showTasks ? tasksRemaining : undefined}
          handovers={showNotice ? handoverCount : null}
          onUnauthorized={onUnauthorized}
          staffSwitch={staffSwitch(WIDGET_STATS)}
          hiddenFromStaff={isSuperAdmin && !gates[WIDGET_STATS].staffSees}
        />
      ) : null}
      {showMessages ? (
        <MessagesSection
          onUnauthorized={onUnauthorized}
          poll={poll}
          // 关着时点卡片照旧跳 tracking 页（Reply 弹框是本批新功能）。
          inlineReply={
            gates[WIDGET_REPLY].visible && perms.canMessages("messages.reply")
          }
          replySwitch={staffSwitch(WIDGET_REPLY, "Reply pop-up")}
        />
      ) : null}
      {showTasks ? (
        <TasksSection
          model={tasks}
          onUnauthorized={onUnauthorized}
          gate={blockGate(WIDGET_TASKS)}
        />
      ) : null}
      {gates[WIDGET_TODAY_TEAM].visible && showSchedule ? (
        <TodayTeamSection
          onUnauthorized={onUnauthorized}
          staffSwitch={staffSwitch(WIDGET_TODAY_TEAM)}
          hiddenFromStaff={isSuperAdmin && !gates[WIDGET_TODAY_TEAM].staffSees}
        />
      ) : null}
      {/* 新板块默认只 Super Admin 可见（Annie 2026-10-24）：对我不可见时整块不画。 */}
      {perms.can("report.view") ? (
        <DorSection
          onUnauthorized={onUnauthorized}
          canEdit={!!(me.is_supervisor || me.is_admin)}
          isSuperAdmin={!!me.is_superadmin}
        />
      ) : null}
      {gates[WIDGET_WEEK_SCHEDULE].visible && showSchedule ? (
        <ScheduleSection
          onUnauthorized={onUnauthorized}
          gate={blockGate(WIDGET_WEEK_SCHEDULE)}
        />
      ) : null}
    </>
  );
}
