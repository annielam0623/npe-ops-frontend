"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { CenteredPage } from "@/components/ui/centered-page";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { isYmd, laToday, shiftYmd, weekStartYmd } from "@/lib/la-date";
import {
  addScheduleEmployee,
  assignScheduleSlot,
  createScheduleSlot,
  deleteScheduleSlot,
  deleteScheduleTimeOff,
  fetchScheduleEmployees,
  fetchScheduleSettings,
  fetchScheduleWeek,
  publishScheduleWeek,
  setScheduleTimeOff,
  updateScheduleEmployee,
  updateScheduleSlotNote,
  updateScheduleSlotTime,
  updateShiftTypeDefaults,
  updateWorkWindow,
} from "@/lib/schedule-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { usePageVisibility } from "@/lib/page-visibility";
import { gapDayLabel, gapRange, gapsByDate } from "@/lib/schedule-gaps";
import { pushRecentShift } from "@/lib/schedule-recent";
import type { Rule } from "@/lib/schedule-engine";
import {
  fetchScheduleRules,
  saveScheduleRules,
} from "@/lib/schedule-rules-api";
import { cn } from "@/lib/utils";
import type {
  CurrentUser,
  ScheduleEmployee,
  ScheduleEmployeeInput,
  ScheduleEmployeeUpdate,
  ScheduleGap,
  SchedulePendingChange,
  SchedulePublishBlockedError,
  ScheduleSettings,
  ScheduleShiftType,
  ScheduleWeek,
} from "@/types";
import { ApiError } from "@/types";

import { AddEmployeeDialog } from "./add-employee-dialog";
import type { AddTimeOffInput } from "./add-shift-dialog";
import { AutoFillDialog } from "./auto-fill-dialog";
import { EmployeesDialog } from "./employees-dialog";
import { RulesView } from "./rules-view";
import { CARD, CARD_HEADER, ICON_BTN, MUTED } from "./config";
import { DayTimeline } from "./day-timeline";
import { ScheduleLockedPanel } from "./lock-panel";
import { SendChangesDialog } from "./send-changes-dialog";
import { ResponsesCard } from "./responses-card";
import { TimePicker } from "./time-picker";
import { useScheduleEditLock } from "./use-schedule-edit-lock";
import { WeekGrid } from "./week-grid";

type WeekState =
  | { kind: "loading" }
  | { kind: "not_published" }
  | { kind: "error"; message: string }
  | { kind: "ready"; week: ScheduleWeek };

function weekRangeLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(`${shiftYmd(weekStart, 6)}T00:00:00Z`);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const year = end.toLocaleDateString("en-US", {
    year: "numeric",
    timeZone: "UTC",
  });
  return `${fmt(start)} – ${fmt(end)}, ${year}`;
}

export function ScheduleView() {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [meError, setMeError] = useState<
    "loading" | "forbidden" | "error" | null
  >("loading");
  const [meErrorMessage, setMeErrorMessage] = useState("");

  const [settings, setSettings] = useState<ScheduleSettings | null>(null);
  const [employees, setEmployees] = useState<ScheduleEmployee[]>([]);
  const [weekStart, setWeekStart] = useState(() => weekStartYmd(laToday()));
  const [week, setWeek] = useState<WeekState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  const [addingEmployee, setAddingEmployee] = useState(false);
  const [managingEmployees, setManagingEmployees] = useState(false);
  // 规则（后端没上线 / 读不到 ⇒ null ⇒ 不显示 Rules 标签和 Auto-fill 键）。
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [tab, setTab] = useState<"schedule" | "rules">("schedule");
  const [autoFilling, setAutoFilling] = useState(false);
  const [autoFillBanner, setAutoFillBanner] = useState<string | null>(null);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  /** Day timeline 看哪一天（点「Gap: Sat 11/07」/ 周表列头红点会跳过去）；null = 默认（周一）。按周记，换周回到默认。 */
  const [timelineDay, setTimelineDay] = useState<{
    week: string;
    date: string;
  } | null>(null);
  const timelineRef = useRef<HTMLElement>(null);
  /** 正在单独发给哪个人确认（Annie 10-29「员工确认」）。 */
  const [sendingTo, setSendingTo] = useState<number | null>(null);
  /** 发送成功后 +1：Responses 卡重拉（后端会把原来 Looks good 的人重置成 No answer，G217）。 */
  const [responsesKey, setResponsesKey] = useState(0);
  /** Responses 卡读到的每人回应（员工 id → answer）；发送框据此提醒「发送会重置 Looks good」（Annie 10-30 第 7b 条）。 */
  const [responseAnswers, setResponseAnswers] = useState<
    ReadonlyMap<number, string>
  >(() => new Map());
  // 换周先清空，免得拿上一周的回应（新的一周读到了 Responses 卡会再报上来）。
  useEffect(() => {
    setResponseAnswers(new Map());
  }, [weekStart]);
  /** 这一次打开页面以后改过、还没 Publish again 的已发布周（后端没带 has_unsent_changes 时用）。 */
  const [unsentWeek, setUnsentWeek] = useState<string | null>(null);
  const [publishBanner, setPublishBanner] = useState<string | null>(null);
  const [publishBlockedGaps, setPublishBlockedGaps] = useState<
    SchedulePublishBlockedError["gaps"] | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const redirectingRef = useRef(false);
  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);
  // Responses 卡跟 /schedule/confirm 同一个开关（schedule_confirm_page，Annie 2026-10-25）。
  const pageVisibility = usePageVisibility(redirectToLogin);

  // 一周同时只能一个人动手改（Annie 2026-10-19「动手改才提示」）：打开能看，第一次动手改前才去占；
  // 别人占着就弹「谁在编辑」，刚才那一下不生效。后端还没有这组接口（404）时不占用、不弹。
  const editLock = useScheduleEditLock({
    week: weekStart,
    onUnauthorized: redirectToLogin,
  });
  const [lockedBy, setLockedBy] = useState<{ by: string | null } | null>(null);

  // 地址栏的 ?week= 是打开页面时的起点（任意一天都行，落到那一天所在的周）；没有 / 不合法时用本周。
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("week");
    if (isYmd(fromUrl)) setWeekStart(weekStartYmd(fromUrl));
  }, []);

  // 身份 + 设置 + 名单：和具体哪一周无关，只在打开页面 / 手动重试时加载一次。
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setMeError("loading");
    (async () => {
      try {
        const user = await fetchCurrentUser(signal);
        if (signal.aborted) return;
        const [scheduleSettings, scheduleEmployees] = await Promise.all([
          fetchScheduleSettings(signal),
          fetchScheduleEmployees(signal, user.is_supervisor === true),
        ]);
        if (signal.aborted) return;
        try {
          const doc = await fetchScheduleRules(signal);
          if (!signal.aborted) setRules(doc.rules);
        } catch {
          if (!signal.aborted) setRules(null);
        }
        if (signal.aborted) return;
        setMe(user);
        setSettings(scheduleSettings);
        setEmployees(scheduleEmployees);
        setMeError(null);
      } catch (error) {
        if (signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setMeError("forbidden");
        else {
          setMeErrorMessage(describeError(error));
          setMeError("error");
        }
      }
    })();
    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  const loadWeek = useCallback(
    async (signal?: AbortSignal, quiet = false) => {
      if (!quiet) setWeek({ kind: "loading" });
      try {
        const data = await fetchScheduleWeek(weekStart, signal);
        if (!signal?.aborted) setWeek({ kind: "ready", week: data });
      } catch (error) {
        if (signal?.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setWeek({ kind: "not_published" });
        else setWeek({ kind: "error", message: describeError(error) });
      }
    },
    [weekStart, redirectToLogin],
  );

  useEffect(() => {
    if (meError !== null) return;
    const controller = new AbortController();
    setPublishBanner(null);
    setPublishBlockedGaps(null);
    const url = new URL(window.location.href);
    url.searchParams.set("week", weekStart);
    window.history.replaceState(null, "", url);
    void loadWeek(controller.signal);
    return () => controller.abort();
  }, [meError, weekStart, loadWeek]);

  if (meError === "loading") return <LoadingPanel />;
  if (meError === "forbidden") return <ForbiddenPanel />;
  if (meError === "error")
    return (
      <ErrorBanner
        actionLabel="Retry"
        onAction={() => setReloadKey((k) => k + 1)}
      >
        Failed to load Staff Schedule: {meErrorMessage}
      </ErrorBanner>
    );
  if (!me || !settings) return <LoadingPanel />;

  const canEdit = me.is_supervisor === true;
  const canAddEmployee = me.is_admin || canEdit;
  const activeEmployees = employees.filter((e) => e.is_active);
  // 当前登录的人在名单里对应谁：按名字对（后端 /api/me 没有邮箱），对上的那一行固定在最上面。
  const meName = me.display_name?.trim().toLowerCase();
  const meEmployee = meName
    ? activeEmployees.find((e) => e.name.trim().toLowerCase() === meName)
    : undefined;
  const orderedEmployees = meEmployee
    ? [meEmployee, ...activeEmployees.filter((e) => e.id !== meEmployee.id)]
    : activeEmployees;

  /** 改好一处：编辑锁记一笔；已发布的周还要记「改了还没发」（Annie「改完再发」）。 */
  function markEdited() {
    editLock.markEdited();
    if (week.kind === "ready" && week.week.status === "published")
      setUnsentWeek(weekStart);
  }

  /** 动手改之前先占住这一周；别人占着 ⇒ 弹提示、返回 false（这一下不做）。 */
  async function guardEdit(): Promise<boolean> {
    const r = await editLock.ensure();
    if (r.kind === "busy") {
      setLockedBy({ by: r.by });
      return false;
    }
    return true;
  }

  /**
   * 改排班的统一出口：后端的改动接口只返回那一个时段（gaps 要整周重算），所以每次做完都静默重新拉一次
   * 这一周，页面和空档提示始终跟服务端一致；出错一样重拉，不维护本地乐观状态。
   */
  async function runSlotAction(action: () => Promise<unknown>) {
    setActionError(null);
    if (!(await guardEdit())) return;
    try {
      await action();
      markEdited();
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setActionError(describeError(error));
    }
    await loadWeek(undefined, true);
  }

  function handleAssign(slotId: number, employeeId: number | null) {
    void runSlotAction(() =>
      assignScheduleSlot(weekStart, slotId, { employee_id: employeeId }),
    );
  }

  /**
   * 加班：一次可以加好几天（每天一个同样的班，先建再派给这个人）。
   * 后端没有每种班次的默认时间，时间由加班窗口里填（默认是工作时段起止）。
   */
  function handleCreateSlots(input: {
    dates: string[];
    shiftType: ScheduleShiftType;
    employeeId: number | null;
    start: string;
    end: string;
    note: string | null;
  }) {
    if (input.employeeId != null) {
      pushRecentShift(input.employeeId, {
        type: input.shiftType.key,
        start: input.start,
        end: input.end,
      });
    }
    void runSlotAction(async () => {
      for (const date of input.dates) {
        const created = await createScheduleSlot(weekStart, {
          date,
          shift_type: input.shiftType.key,
          start_time: input.start,
          end_time: input.end,
          ...(input.note ? { note: input.note } : {}),
        });
        if (input.employeeId != null) {
          try {
            await assignScheduleSlot(weekStart, created.id, {
              employee_id: input.employeeId,
            });
          } catch (error) {
            // 休假等原因派不上人（后端 400 带原话）：别留一个没人的空时段，删掉再把原话报出去。
            try {
              await deleteScheduleSlot(weekStart, created.id);
            } catch {
              /* 删不掉就留着，原话照样报 */
            }
            throw error;
          }
        }
      }
    });
  }

  function handleSaveNote(slotId: number, note: string | null) {
    void runSlotAction(() => updateScheduleSlotNote(weekStart, slotId, note));
  }

  /** 录休假：成功返回 null（并重拉本周）；失败返回后端原话，让窗口里显示。 */
  async function handleSetTimeOff(
    employeeId: number,
    input: AddTimeOffInput,
  ): Promise<string | null> {
    setActionError(null);
    const lock = await editLock.ensure();
    if (lock.kind === "busy")
      return `${lock.by ?? "Someone"} is editing this schedule. Please try again later.`;
    try {
      await setScheduleTimeOff({
        employee_id: employeeId,
        dates: input.dates,
        kind: input.kind,
        note: input.note,
      });
      markEdited();
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return null;
      }
      return describeError(error);
    }
    await loadWeek(undefined, true);
    return null;
  }

  function handleDeleteTimeOff(id: number) {
    void runSlotAction(() => deleteScheduleTimeOff(id));
  }

  function handleDeleteSlot(slotId: number) {
    void runSlotAction(() => deleteScheduleSlot(weekStart, slotId));
  }

  function handleUpdateTime(slotId: number, start: string, end: string) {
    const slot =
      week.kind === "ready"
        ? week.week.slots.find((s) => s.id === slotId)
        : undefined;
    if (slot?.employee_id != null) {
      pushRecentShift(slot.employee_id, {
        type: slot.shift_type,
        start,
        end,
      });
    }
    void runSlotAction(() =>
      updateScheduleSlotTime(weekStart, slotId, {
        start_time: start,
        end_time: end,
      }),
    );
  }

  async function handleAddEmployee(
    input: ScheduleEmployeeInput,
  ): Promise<ActionResult> {
    try {
      const created = await addScheduleEmployee(input);
      setEmployees((prev) => [...prev, created]);
      setAddingEmployee(false);
      return { status: "ok" };
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      return { status: "error", message: describeError(error) };
    }
  }

  async function handleUpdateEmployee(
    id: number,
    input: ScheduleEmployeeUpdate,
  ): Promise<ActionResult> {
    try {
      const updated = await updateScheduleEmployee(id, input);
      setEmployees((prev) => prev.map((e) => (e.id === id ? updated : e)));
      return { status: "ok" };
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      return { status: "error", message: describeError(error) };
    }
  }

  async function handlePublish(allowGaps: boolean): Promise<ActionResult> {
    try {
      const result = await publishScheduleWeek(weekStart, { allowGaps });
      setConfirmingPublish(false);
      setPublishBlockedGaps(null);
      // 重新发布只通知班有变化的人 + 主管层（后端 G217 ef：勾了 schedule.edit 的 supervisor / admin，superadmin 不看勾，去掉按的人自己）；
      // 一个都没变就写明没人收到，不写「Notified 0 people」。主管 0 人时不写后半句。
      const n = result.notified.length;
      const m = result.notified_supervisors?.length ?? 0;
      setPublishBanner(
        result.republished && n === 0
          ? "Published again. No one's shifts or time off changed, so no one was notified."
          : `${result.republished ? "Published again" : "Published"}. Notified ${n} ${n === 1 ? "person" : "people"}${m ? ` and ${m} ${m === 1 ? "supervisor" : "supervisors"}` : ""}.`,
      );
      setUnsentWeek(null);
      void loadWeek();
      return { status: "ok" };
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      if (isStatus(error, 400) && error instanceof ApiError) {
        // 有空档：后端 `HTTPException(400, {detail, gaps})`，响应体是 {detail: {detail, gaps}}。
        const inner = (error.body as { detail?: unknown } | null)?.detail;
        if (inner && typeof inner === "object") {
          const blocked = inner as SchedulePublishBlockedError;
          if (blocked.gaps) setPublishBlockedGaps(blocked.gaps);
          // 页面上没看到、后端却查出空档（例如别人刚改过这一周）：重新读这一周，空档提示马上出来，admin 可以接着 Publish anyway。
          void loadWeek();
          return {
            status: "error",
            message: blocked.detail || describeError(error),
          };
        }
        return { status: "error", message: describeError(error) };
      }
      return { status: "error", message: describeError(error) };
    }
  }

  const readyWeek = week.kind === "ready" ? week.week : null;
  // 这周被排进时段、但名单里没有邮箱的人：发布时收不到邮件（只是提醒，不拦着发布）。
  const scheduledIds = new Set(
    (readyWeek?.slots ?? []).map((s) => s.employee_id),
  );
  const noEmailNames = employees
    .filter((e) => scheduledIds.has(e.id) && !e.email)
    .map((e) => e.name);
  const gaps = readyWeek?.gaps ?? [];
  const gapDays = gapsByDate(gaps);
  // 有空档也能发布（Publish anyway）：只给 admin 及以上（Annie 2026-10-29 Q1）。supervisor 有空档时照旧先补人。
  const canPublishAnyway = me.is_admin === true || me.is_superadmin === true;
  // 已发布的周也能点 Publish again（Annie 2026-10-29 Q6「要留publish again，要允许改正错误」）；有空档时同样走 Publish anyway。
  const canPublish = canEdit && (gaps.length === 0 || canPublishAnyway);
  const timelineDate =
    timelineDay?.week === weekStart ? timelineDay.date : shiftYmd(weekStart, 1);
  /** 跳到 Day timeline 的某一天（点空档提示 / 列头红点）。 */
  function jumpToDay(date: string) {
    setTimelineDay({ week: weekStart, date });
    timelineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="text-white/90">
      <CenteredPage className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <h1 className="sr-only">Staff Schedule</h1>
          <WorkWindowControl
            settings={settings}
            isSuperadmin={me.is_superadmin}
            onUpdated={setSettings}
          />
        </div>

        <DefaultShiftTimes
          settings={settings}
          isSuperadmin={me.is_superadmin}
          onUpdated={setSettings}
        />

        {rules !== null ? (
          <div role="tablist" className="-mb-2 flex gap-2">
            {(["schedule", "rules"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={
                  tab === t
                    ? DARK_PRIMARY_BUTTON_CLASS
                    : DARK_SECONDARY_BUTTON_CLASS
                }
              >
                {t === "schedule" ? "Schedule" : "Rules"}
              </button>
            ))}
          </div>
        ) : null}

        {tab === "rules" && rules !== null ? (
          <RulesView
            rules={rules}
            ctx={{ employees, shiftTypes: settings.shift_types }}
            canEdit={canEdit}
            onSave={async (next) => {
              const saved = await saveScheduleRules(next);
              setRules(saved.rules);
              return saved.rules;
            }}
          />
        ) : (
          <>
            <WeekNav
              weekStart={weekStart}
              onChange={setWeekStart}
              canEdit={canEdit}
              onAddEmployee={
                canAddEmployee ? () => setAddingEmployee(true) : undefined
              }
              onManageEmployees={
                canAddEmployee ? () => setManagingEmployees(true) : undefined
              }
              onAutoFill={
                canEdit && rules !== null
                  ? () => setAutoFilling(true)
                  : undefined
              }
              autoFillDisabled={!rules?.some((r) => r.enabled)}
            />

            {readyWeek?.copied_from ? (
              <div className="-mt-2 text-[12px] text-sky-300">
                Started from last week&apos;s schedule — drag people to change
                it.
              </div>
            ) : null}

            {autoFillBanner ? (
              <div
                data-autofill-banner
                className="flex items-center justify-between gap-2 rounded-[10px] border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-[13px] text-emerald-200"
              >
                <span>✅ {autoFillBanner}</span>
                <button
                  type="button"
                  onClick={() => setAutoFillBanner(null)}
                  className="cursor-pointer text-emerald-300 hover:text-emerald-100"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            ) : null}

            {publishBanner ? (
              <div className="rounded-[10px] border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-[13px] text-emerald-200">
                ✅ {publishBanner}
              </div>
            ) : null}

            {actionError ? (
              <div className="flex items-center justify-between gap-2 rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-[13px] text-red-200">
                <span>{actionError}</span>
                <button
                  type="button"
                  onClick={() => setActionError(null)}
                  className="cursor-pointer text-red-300 hover:text-red-100"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            ) : null}

            <WeekBody
              state={week}
              weekStart={weekStart}
              employees={orderedEmployees}
              meId={meEmployee?.id ?? null}
              settings={settings}
              canEdit={canEdit}
              onAssign={handleAssign}
              onCreateSlots={handleCreateSlots}
              onDeleteSlot={handleDeleteSlot}
              onUpdateTime={handleUpdateTime}
              onSaveNote={handleSaveNote}
              onSetTimeOff={handleSetTimeOff}
              onDeleteTimeOff={handleDeleteTimeOff}
              onRetry={() => void loadWeek()}
              // 空档提示只给能改排班的人（Annie Q3：staff 看不到）。
              gapsByDay={canEdit ? gapDays : undefined}
              onGapDay={jumpToDay}
              // 发布前单独发给本人确认：supervisor 及以上（能改排班的人），只在已发布的周。
              pendingChanges={
                canEdit && readyWeek?.status === "published"
                  ? readyWeek.pending_changes
                  : undefined
              }
              onSendChanges={setSendingTo}
            />

            {/* 周三确认下周排班的回应（Annie 2026-10-19）：接口没上线 / 这一周没发过确认就整块不显示。 */}
            {canEdit &&
            readyWeek &&
            pageVisibility.visible("schedule_confirm_page") ? (
              <ResponsesCard
                weekStart={weekStart}
                canEdit={canEdit}
                employees={activeEmployees}
                slots={readyWeek.slots}
                shiftTypes={settings.shift_types}
                reloadKey={responsesKey}
                onAnswers={setResponseAnswers}
                onChanged={() => void loadWeek(undefined, true)}
                onUnauthorized={redirectToLogin}
                beforeEdit={guardEdit}
                onEdited={markEdited}
              />
            ) : null}

            {readyWeek && week.kind === "ready" ? (
              <section ref={timelineRef} className={cn(CARD, "scroll-mt-4")}>
                <div className={CARD_HEADER}>
                  <h2 className="text-[14px] font-semibold text-white">
                    Day timeline
                  </h2>
                  {canEdit ? (
                    <div className="flex items-center gap-3">
                      {readyWeek.status === "published" ? (
                        <span className={cn(MUTED, "text-[12px]")}>
                          Published
                          {readyWeek.published_at
                            ? ` · ${new Date(readyWeek.published_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}`
                            : ""}
                        </span>
                      ) : null}
                      {readyWeek.status === "published" &&
                      (readyWeek.has_unsent_changes ??
                        unsentWeek === weekStart) ? (
                        // 改完再发（Annie 10-29）：已发布的周改了不逐项通知，提醒按 Publish again 才发出去。
                        <span
                          data-unsent-changes
                          className="text-[12px] font-semibold text-[#fcd34d]"
                        >
                          Changes are not sent until you publish again.
                        </span>
                      ) : null}
                      <PublishControl
                        gapDays={gapDays}
                        canPublish={canPublish}
                        canPublishAnyway={canPublishAnyway}
                        republish={readyWeek.status === "published"}
                        publishedWithGaps={
                          readyWeek.published_with_gaps ??
                          (readyWeek.status === "published" && gaps.length > 0)
                        }
                        onJump={jumpToDay}
                        onClick={() => setConfirmingPublish(true)}
                      />
                    </div>
                  ) : readyWeek.status === "published" ? (
                    <span className={cn(MUTED, "text-[12px]")}>
                      Published
                      {readyWeek.published_at
                        ? ` · ${new Date(readyWeek.published_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}`
                        : ""}
                    </span>
                  ) : null}
                </div>
                <div className="p-4">
                  <DayTimeline
                    weekStart={weekStart}
                    slots={readyWeek.slots}
                    employees={activeEmployees}
                    workWindow={settings.work_window}
                    selectedDate={timelineDate}
                    onSelectDate={(d) =>
                      setTimelineDay({ week: weekStart, date: d })
                    }
                    weekGaps={gaps}
                    showGaps={canEdit}
                    shiftTypes={settings.shift_types}
                  />
                </div>
              </section>
            ) : null}
          </>
        )}
      </CenteredPage>

      {autoFilling && rules !== null ? (
        <AutoFillDialog
          weekStart={weekStart}
          rules={rules.filter((r) => r.enabled)}
          employees={employees}
          settings={settings}
          onClose={() => setAutoFilling(false)}
          onDone={(message) => {
            setAutoFilling(false);
            setAutoFillBanner(message);
            void loadWeek(undefined, true);
          }}
        />
      ) : null}

      {managingEmployees ? (
        <EmployeesDialog
          employees={employees}
          onAdd={handleAddEmployee}
          onUpdate={handleUpdateEmployee}
          onClose={() => setManagingEmployees(false)}
        />
      ) : null}

      {addingEmployee ? (
        <AddEmployeeDialog
          onSubmit={handleAddEmployee}
          onClose={() => setAddingEmployee(false)}
        />
      ) : null}

      {sendingTo != null && readyWeek
        ? (() => {
            const emp = employees.find((e) => e.id === sendingTo);
            const change = readyWeek.pending_changes?.find(
              (p) => p.employee_id === sendingTo,
            );
            return emp && change ? (
              <SendChangesDialog
                weekStart={weekStart}
                weekLabel={weekRangeLabel(weekStart)}
                employee={emp}
                change={change}
                answeredLooksGood={
                  responseAnswers.get(sendingTo) === "accepted"
                }
                onClose={() => setSendingTo(null)}
                onSent={() => {
                  void loadWeek(undefined, true);
                  setResponsesKey((k) => k + 1);
                }}
                onUnauthorized={redirectToLogin}
              />
            ) : null;
          })()
        : null}
      {confirmingPublish ? (
        <ConfirmDialog
          title={
            gaps.length
              ? readyWeek?.status === "published"
                ? "Publish again with a coverage gap?"
                : "Publish with a coverage gap?"
              : readyWeek?.status === "published"
                ? "Publish this week's schedule again?"
                : "Publish this week's schedule?"
          }
          confirmLabel={
            gaps.length
              ? readyWeek?.status === "published"
                ? "Publish again anyway"
                : "Publish anyway"
              : readyWeek?.status === "published"
                ? "Publish again"
                : "Publish"
          }
          // 蓝色只给提交键（Annie 2026-10-11）；preview 第 ④ 张。
          confirmClassName={DARK_PRIMARY_BUTTON_CLASS}
          busyLabel="Publishing…"
          onClose={() => setConfirmingPublish(false)}
          onConfirm={() => handlePublish(gaps.length > 0)}
        >
          {gaps.length ? (
            <div data-publish-gaps>
              <p>Nobody is scheduled on this part of the week:</p>
              <ul className="mt-1 list-disc pl-5 text-[#A32D2D] night:text-red-300">
                {gaps.map((g, i) => (
                  <li key={i}>
                    <b>{gapDayLabel(g.date)}</b> · nobody {gapRange(g)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p>
            {readyWeek?.status === "published"
              ? // 重新发布（Annie 10-29）：只通知班或休息日有变化的人 + 主管层；休息日也不单独马上发（「改动schedule当然应该是发布的时候通知」）。
                // 主管 = 在用的 supervisor / admin 里勾了 schedule.edit 的，superadmin 不看勾；去掉按的人自己（后端 G217 ef 10-30，审查 SA-1 收窄）。
                "People whose shifts or time off changed since the last publish will get a system notification and an email. Supervisors and admins who can edit the schedule (except you) get a notice listing the changes. No one else is notified. This can't be undone."
              : "Everyone scheduled this week will get a system notification and an email. This can't be undone."}
            {gaps.length
              ? " Publishing with a gap is written in the Action Log."
              : ""}
          </p>
          {noEmailNames.length > 0 && readyWeek?.status !== "published" ? (
            <p
              data-publish-no-email
              className="mt-3 rounded-[8px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.14)] px-3 py-2 text-[13px] text-[#fde68a]"
            >
              {noEmailNames.length}{" "}
              {noEmailNames.length === 1 ? "person" : "people"} scheduled this
              week {noEmailNames.length === 1 ? "has" : "have"} no email and
              won&apos;t be emailed: {noEmailNames.join(", ")}. Add their email
              under Employees first.
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}

      {lockedBy ? (
        <ScheduleLockedPanel
          by={lockedBy.by}
          onBack={() => setLockedBy(null)}
        />
      ) : null}

      {publishBlockedGaps && publishBlockedGaps.length > 0 ? (
        <div className="fixed inset-x-0 bottom-4 z-40 mx-auto max-w-[600px] rounded-[10px] border border-red-500/30 bg-[#1a0f0f] px-4 py-3 text-[13px] text-red-200 shadow-lg">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="font-semibold">
              Can&apos;t publish — there are coverage gaps.
            </p>
            <button
              type="button"
              onClick={() => setPublishBlockedGaps(null)}
              className="cursor-pointer text-red-300 hover:text-red-100"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          <ul className="list-disc pl-5">
            {publishBlockedGaps.map((g, i) => (
              <li key={i}>
                {g.date}: nobody on {g.start_time}–{g.end_time}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </main>
  );
}

function LoadingPanel() {
  return (
    <main className="text-white/90">
      <Panel dark>Loading…</Panel>
    </main>
  );
}

function ForbiddenPanel() {
  return (
    <main className="text-white/90">
      <Panel dark>
        <p className="font-semibold">Staff access required</p>
        <p className="mt-1 text-white/60">
          This page is for back-office staff only.
        </p>
      </Panel>
    </main>
  );
}

function WorkWindowControl({
  settings,
  isSuperadmin,
  onUpdated,
}: {
  settings: ScheduleSettings;
  isSuperadmin: boolean;
  onUpdated: (settings: ScheduleSettings) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(settings.work_window.start_time);
  const [end, setEnd] = useState(settings.work_window.end_time);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <span className={cn(MUTED, "flex items-center gap-2 text-[13px]")}>
        Working hours:{" "}
        <span className="text-white/80">
          {formatBadgeTime(settings.work_window.start_time)} –{" "}
          {formatBadgeTime(settings.work_window.end_time)}
        </span>
        {isSuperadmin ? (
          <button
            type="button"
            onClick={() => {
              setStart(settings.work_window.start_time);
              setEnd(settings.work_window.end_time);
              setError(null);
              setEditing(true);
            }}
            className="cursor-pointer text-[12px] text-sky-300 hover:underline"
          >
            Edit
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2 text-[13px]"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
          const updated = await updateWorkWindow({
            start_time: start,
            end_time: end,
          });
          onUpdated(updated);
          setEditing(false);
        } catch (error) {
          setError(describeError(error));
        } finally {
          setSaving(false);
        }
      }}
    >
      <span className={MUTED}>Working hours:</span>
      <TimePicker
        ariaLabel="Working hours start"
        value={start}
        onChange={setStart}
      />
      <span className={MUTED}>–</span>
      <TimePicker ariaLabel="Working hours end" value={end} onChange={setEnd} />
      <button
        type="submit"
        disabled={saving}
        className={DARK_PRIMARY_BUTTON_CLASS}
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        disabled={saving}
        className={DARK_SECONDARY_BUTTON_CLASS}
      >
        Cancel
      </button>
      {error ? <span className="text-[12px] text-red-300">{error}</span> : null}
    </form>
  );
}

/**
 * 班次默认上下班时间（后端 ③，Annie 2026-10-18）：加班窗口里选班次时自动填。所有人只读文字，superadmin 能改。
 * 只有设了默认时间的班次才列出；后端还没带这两个字段（旧版）时整行不出现。
 */
function DefaultShiftTimes({
  settings,
  isSuperadmin,
  onUpdated,
}: {
  settings: ScheduleSettings;
  isSuperadmin: boolean;
  onUpdated: (settings: ScheduleSettings) => void;
}) {
  const types = settings.shift_types.filter((t) => t.is_active);
  const supported = types.some((t) => t.default_start_time !== undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, [string, string]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!supported) return null;

  function begin() {
    const next: Record<string, [string, string]> = {};
    for (const t of types) {
      next[t.key] = [t.default_start_time ?? "", t.default_end_time ?? ""];
    }
    setDraft(next);
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      for (const t of types) {
        const [s, e] = draft[t.key] ?? ["", ""];
        const curS = t.default_start_time ?? "";
        const curE = t.default_end_time ?? "";
        if (s === curS && e === curE) continue;
        // 后端：两个都带时间 = 设置，两个都 null = 清除；只填一个会 400（原话显示出来）。
        await updateShiftTypeDefaults(t, {
          default_start_time: s || null,
          default_end_time: e || null,
        });
      }
      onUpdated(await fetchScheduleSettings());
      setEditing(false);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div
        data-default-times
        className={cn(
          MUTED,
          "flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]",
        )}
      >
        <span>Default shift times:</span>
        {types.map((t) => (
          <span key={t.key} className="text-white/80">
            {t.label}{" "}
            {t.default_start_time && t.default_end_time
              ? `${formatBadgeTime(t.default_start_time)} – ${formatBadgeTime(t.default_end_time)}`
              : "not set"}
          </span>
        ))}
        {isSuperadmin ? (
          <button
            type="button"
            onClick={begin}
            className="cursor-pointer text-[12px] text-sky-300 hover:underline"
          >
            Edit
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      data-default-times-form
      className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <span className={MUTED}>Default shift times:</span>
      {types.map((t) => (
        <span key={t.key} className="flex items-center gap-1.5 text-white/80">
          {t.label}
          <TimePicker
            ariaLabel={`${t.label} start`}
            allowEmpty
            value={draft[t.key]?.[0] ?? ""}
            onChange={(v) =>
              setDraft((d) => ({
                ...d,
                [t.key]: [v, d[t.key]?.[1] ?? ""],
              }))
            }
          />
          <span className={MUTED}>–</span>
          <TimePicker
            ariaLabel={`${t.label} end`}
            allowEmpty
            value={draft[t.key]?.[1] ?? ""}
            onChange={(v) =>
              setDraft((d) => ({
                ...d,
                [t.key]: [d[t.key]?.[0] ?? "", v],
              }))
            }
          />
        </span>
      ))}
      <button
        type="submit"
        disabled={saving}
        className={DARK_PRIMARY_BUTTON_CLASS}
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        disabled={saving}
        className={DARK_SECONDARY_BUTTON_CLASS}
      >
        Cancel
      </button>
      {error ? <span className="text-[12px] text-red-300">{error}</span> : null}
    </form>
  );
}

function formatBadgeTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function WeekNav({
  weekStart,
  onChange,
  canEdit,
  onAddEmployee,
  onManageEmployees,
  onAutoFill,
  autoFillDisabled,
}: {
  weekStart: string;
  onChange: (weekStart: string) => void;
  canEdit: boolean;
  onAddEmployee?: () => void;
  onManageEmployees?: () => void;
  onAutoFill?: () => void;
  autoFillDisabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous week"
          onClick={() => onChange(shiftYmd(weekStart, -7))}
          className={ICON_BTN}
        >
          ‹
        </button>
        <span className="min-w-[180px] text-center text-[15px] font-semibold text-white">
          {weekRangeLabel(weekStart)}
        </span>
        <button
          type="button"
          aria-label="Next week"
          onClick={() => onChange(shiftYmd(weekStart, 7))}
          className={ICON_BTN}
        >
          ›
        </button>
        <button
          type="button"
          onClick={() => onChange(weekStartYmd(laToday()))}
          className={cn(DARK_SECONDARY_BUTTON_CLASS, "ml-1")}
        >
          This week
        </button>
        <button
          type="button"
          onClick={() => onChange(shiftYmd(weekStartYmd(laToday()), 7))}
          className={DARK_SECONDARY_BUTTON_CLASS}
        >
          Next week
        </button>
      </div>
      {canEdit && onAddEmployee ? (
        <div className="flex items-center gap-2">
          {onAutoFill ? (
            <button
              type="button"
              onClick={onAutoFill}
              disabled={autoFillDisabled}
              title={
                autoFillDisabled
                  ? "Turn on some rules in the Rules tab first."
                  : "Fill this week (or the next 4 weeks) by the rules"
              }
              className={DARK_SECONDARY_BUTTON_CLASS}
            >
              Auto-fill
            </button>
          ) : null}
          {onManageEmployees ? (
            <button
              type="button"
              onClick={onManageEmployees}
              className={DARK_SECONDARY_BUTTON_CLASS}
            >
              Employees
            </button>
          ) : null}
          <button
            type="button"
            onClick={onAddEmployee}
            className={DARK_SECONDARY_BUTTON_CLASS}
          >
            + Add employee
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Publish 键左边直接写哪天哪段没人（Annie 2026-10-29「你要提醒是哪一天有问题，而不是让人去找问题在哪里」）：
 * 「Gap: Sat 11/07 · nobody 2:00–8:00 AM」，点了跳到下面 Day timeline 的那一天。几段就逐段写，超过 3 段写「+N more」。
 * 发布过、还有空档（Publish anyway 过）的周写「Published with a gap」，补上人以后后端 gaps 变空，这一句就没了（Q4）。
 */
function PublishControl({
  gapDays,
  canPublish,
  canPublishAnyway,
  republish,
  publishedWithGaps,
  onJump,
  onClick,
}: {
  gapDays: Map<string, ScheduleGap[]>;
  canPublish: boolean;
  /** admin 及以上：有空档也能按，弹 Publish anyway 确认框（Q1）。 */
  canPublishAnyway: boolean;
  /** 这一周已经发布过：按一次等于「重新发布 + 重发通知」（Annie Q6：保留，用来改正错误）。 */
  republish: boolean;
  /** 后端 published_with_gaps（已发布、现在还有空档）；没有这个字段时按「已发布 + 有空档」算。 */
  publishedWithGaps: boolean;
  onJump: (date: string) => void;
  onClick: () => void;
}) {
  const list = [...gapDays.values()].flat();
  const shown = list.slice(0, 3);
  const more = list.length - shown.length;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {list.length ? (
        <span
          data-gap-summary
          className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-red-300"
        >
          <span
            aria-hidden
            className="inline-block size-2 rounded-full bg-red-500"
          />
          <span>
            {publishedWithGaps
              ? "Published with a gap"
              : list.length > 1
                ? "Gaps"
                : "Gap"}
            :
          </span>
          {shown.map((g, i) => (
            <span key={i}>
              <button
                type="button"
                data-gap-link={g.date}
                onClick={() => onJump(g.date)}
                className="cursor-pointer font-semibold text-red-200 underline decoration-red-400/60 underline-offset-2"
              >
                {gapDayLabel(g.date)} · nobody {gapRange(g)}
              </button>
              {i < shown.length - 1 ? "," : ""}
            </span>
          ))}
          {more > 0 ? <span>+{more} more</span> : null}
        </span>
      ) : null}
      <button
        type="button"
        disabled={!canPublish}
        onClick={onClick}
        title={
          list.length && !canPublishAnyway
            ? "Only admins can publish with a gap. Fill the gap first."
            : list.length
              ? "There is a gap in coverage. You can still publish: you will be asked to confirm."
              : republish
                ? "Publish again: people whose shifts or time off changed, and supervisors and admins who can edit the schedule, are notified."
                : undefined
        }
        className={DARK_PRIMARY_BUTTON_CLASS}
      >
        {republish ? "Publish again" : "Publish"}
      </button>
    </div>
  );
}

function WeekBody({
  state,
  weekStart,
  employees,
  meId,
  settings,
  canEdit,
  onAssign,
  onCreateSlots,
  onDeleteSlot,
  onUpdateTime,
  onSaveNote,
  onSetTimeOff,
  onDeleteTimeOff,
  onRetry,
  gapsByDay,
  onGapDay,
  pendingChanges,
  onSendChanges,
}: {
  state: WeekState;
  weekStart: string;
  employees: ScheduleEmployee[];
  meId: number | null;
  settings: ScheduleSettings;
  canEdit: boolean;
  onAssign: (slotId: number, employeeId: number | null) => void;
  onCreateSlots: (input: {
    dates: string[];
    shiftType: ScheduleShiftType;
    employeeId: number | null;
    start: string;
    end: string;
    note: string | null;
  }) => void;
  onDeleteSlot: (slotId: number) => void;
  onUpdateTime: (slotId: number, startTime: string, endTime: string) => void;
  onSaveNote: (slotId: number, note: string | null) => void;
  onSetTimeOff: (
    employeeId: number,
    input: AddTimeOffInput,
  ) => Promise<string | null>;
  onDeleteTimeOff: (id: number) => void;
  onRetry: () => void;
  gapsByDay?: Map<string, ScheduleGap[]>;
  onGapDay?: (date: string) => void;
  pendingChanges?: SchedulePendingChange[];
  onSendChanges?: (employeeId: number) => void;
}) {
  if (state.kind === "loading") {
    return (
      <section className={CARD}>
        <div className="p-6 text-center text-white/55">Loading…</div>
      </section>
    );
  }
  if (state.kind === "not_published") {
    return (
      <section className={CARD}>
        <div className="p-6 text-center text-white/55">
          This week&apos;s schedule hasn&apos;t been published yet.
        </div>
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <ErrorBanner dark actionLabel="Retry" onAction={onRetry}>
        Failed to load this week: {state.message}
      </ErrorBanner>
    );
  }
  return (
    <section className={CARD}>
      <WeekGrid
        // 换周时整个重新挂载：清掉 WeekGrid 内部「选中哪张卡」「哪个时段在改时间」的状态，
        // 不然切到别的周还带着上一周的选择。
        key={weekStart}
        weekStart={weekStart}
        employees={employees}
        meId={meId}
        slots={state.week.slots}
        timeOff={state.week.time_off}
        shiftTypes={settings.shift_types}
        canEdit={canEdit}
        onAssign={onAssign}
        onCreateSlots={onCreateSlots}
        workWindow={settings.work_window}
        onDeleteSlot={onDeleteSlot}
        onUpdateTime={onUpdateTime}
        onSaveNote={onSaveNote}
        onSetTimeOff={onSetTimeOff}
        onDeleteTimeOff={onDeleteTimeOff}
        gapsByDay={gapsByDay}
        onGapDay={onGapDay}
        pendingChanges={pendingChanges}
        onSendChanges={onSendChanges}
      />
    </section>
  );
}
