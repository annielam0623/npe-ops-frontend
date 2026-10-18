"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
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
  fetchScheduleEmployees,
  fetchScheduleSettings,
  fetchScheduleWeek,
  publishScheduleWeek,
  updateScheduleEmployee,
  updateScheduleSlotTime,
  updateWorkWindow,
} from "@/lib/schedule-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { pushRecentShift } from "@/lib/schedule-recent";
import { cn } from "@/lib/utils";
import type {
  CurrentUser,
  ScheduleEmployee,
  ScheduleEmployeeInput,
  ScheduleEmployeeUpdate,
  SchedulePublishBlockedError,
  ScheduleSettings,
  ScheduleShiftType,
  ScheduleWeek,
} from "@/types";
import { ApiError } from "@/types";

import { AddEmployeeDialog } from "./add-employee-dialog";
import { EmployeesDialog } from "./employees-dialog";
import { CARD, CARD_HEADER, ICON_BTN, INPUT, MUTED } from "./config";
import { DayTimeline } from "./day-timeline";
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
  const [confirmingPublish, setConfirmingPublish] = useState(false);
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

  /**
   * 改排班的统一出口：后端的改动接口只返回那一个时段（gaps 要整周重算），所以每次做完都静默重新拉一次
   * 这一周，页面和空档提示始终跟服务端一致；出错一样重拉，不维护本地乐观状态。
   */
  async function runSlotAction(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
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
        });
        if (input.employeeId != null) {
          await assignScheduleSlot(weekStart, created.id, {
            employee_id: input.employeeId,
          });
        }
      }
    });
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

  async function handlePublish(): Promise<ActionResult> {
    try {
      const result = await publishScheduleWeek(weekStart);
      setConfirmingPublish(false);
      setPublishBlockedGaps(null);
      setPublishBanner(
        `Published. Notified ${result.notified.length} ${result.notified.length === 1 ? "person" : "people"}.`,
      );
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
  // 已发布的周也能点 Publish：等同于「重新发布 + 重发通知」（后端 -84 2026-10-16 定，编辑已发布的周
  // 不自动重发，要通知就再点一次 Publish；Publish 接口仍按原规则重算空档、有空档拒绝）。
  const canPublish = canEdit && gaps.length === 0;

  return (
    <main className="text-white/90">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[29px] font-bold tracking-[-.02em] text-white">
            Staff Schedule
          </h1>
          <WorkWindowControl
            settings={settings}
            isSuperadmin={me.is_superadmin}
            onUpdated={setSettings}
          />
        </div>

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
        />

        {readyWeek?.copied_from ? (
          <div className="-mt-2 text-[12px] text-sky-300">
            Started from last week&apos;s schedule — drag people to change it.
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
          onRetry={() => void loadWeek()}
        />

        {readyWeek && week.kind === "ready" ? (
          <section className={CARD}>
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
                  <PublishControl
                    gapCount={gaps.length}
                    canPublish={canPublish}
                    republish={readyWeek.status === "published"}
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
              />
            </div>
          </section>
        ) : null}
      </div>

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

      {confirmingPublish ? (
        <ConfirmDialog
          title={
            readyWeek?.status === "published"
              ? "Publish this week's schedule again?"
              : "Publish this week's schedule?"
          }
          confirmLabel={
            readyWeek?.status === "published" ? "Publish again" : "Publish"
          }
          busyLabel="Publishing…"
          onClose={() => setConfirmingPublish(false)}
          onConfirm={handlePublish}
        >
          <p>
            Everyone scheduled this week will get a system notification and an
            email
            {readyWeek?.status === "published" ? " again" : ""}. This can&apos;t
            be undone.
          </p>
          {noEmailNames.length > 0 ? (
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
      <input
        type="time"
        value={start}
        onChange={(event) => setStart(event.target.value)}
        className={cn(INPUT, "w-[110px]")}
      />
      <span className={MUTED}>–</span>
      <input
        type="time"
        value={end}
        onChange={(event) => setEnd(event.target.value)}
        className={cn(INPUT, "w-[110px]")}
      />
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
}: {
  weekStart: string;
  onChange: (weekStart: string) => void;
  canEdit: boolean;
  onAddEmployee?: () => void;
  onManageEmployees?: () => void;
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

function PublishControl({
  gapCount,
  canPublish,
  republish,
  onClick,
}: {
  gapCount: number;
  canPublish: boolean;
  /** 这一周已经发布过：按一次等于「重新发布 + 重发通知」（后端 -84 2026-10-16 定）。 */
  republish: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {gapCount > 0 ? (
        <span className="text-[12px] text-red-300">
          {gapCount} day{gapCount === 1 ? "" : "s"} with gaps
        </span>
      ) : null}
      <button
        type="button"
        disabled={!canPublish}
        onClick={onClick}
        title={
          gapCount > 0
            ? "Fix the coverage gaps below before you can publish."
            : republish
              ? "Publish again and notify everyone scheduled this week."
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
  onRetry,
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
  }) => void;
  onDeleteSlot: (slotId: number) => void;
  onUpdateTime: (slotId: number, startTime: string, endTime: string) => void;
  onRetry: () => void;
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
        shiftTypes={settings.shift_types}
        canEdit={canEdit}
        onAssign={onAssign}
        onCreateSlots={onCreateSlots}
        workWindow={settings.work_window}
        onDeleteSlot={onDeleteSlot}
        onUpdateTime={onUpdateTime}
      />
    </section>
  );
}
