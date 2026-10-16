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
  copyScheduleWeek,
  fetchScheduleEmployees,
  fetchScheduleSettings,
  fetchScheduleWeek,
  publishScheduleWeek,
  saveScheduleCell,
  updateWorkWindow,
} from "@/lib/schedule-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type {
  CurrentUser,
  ScheduleCellInput,
  ScheduleEmployee,
  ScheduleEmployeeInput,
  SchedulePublishBlockedError,
  ScheduleSettings,
  ScheduleWeek,
} from "@/types";
import { ApiError } from "@/types";

import { AddEmployeeDialog } from "./add-employee-dialog";
import { CellEditorDialog } from "./cell-editor-dialog";
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
  const [editingCell, setEditingCell] = useState<{
    employee: ScheduleEmployee;
    date: string;
  } | null>(null);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [confirmingCopy, setConfirmingCopy] = useState(false);
  const [publishBanner, setPublishBanner] = useState<string | null>(null);
  const [publishBlockedGaps, setPublishBlockedGaps] = useState<
    SchedulePublishBlockedError["gaps"] | null
  >(null);

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
          fetchScheduleEmployees(signal),
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
    async (signal?: AbortSignal) => {
      setWeek({ kind: "loading" });
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

  async function handleSaveCell(
    input: ScheduleCellInput,
  ): Promise<ActionResult> {
    try {
      const updated = await saveScheduleCell(weekStart, input);
      setWeek({ kind: "ready", week: updated });
      setEditingCell(null);
      return { status: "ok" };
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      return { status: "error", message: describeError(error) };
    }
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

  async function handleCopyPrevious(): Promise<ActionResult> {
    try {
      const updated = await copyScheduleWeek(
        weekStart,
        shiftYmd(weekStart, -7),
      );
      setWeek({ kind: "ready", week: updated });
      setConfirmingCopy(false);
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
        const body = error.body as SchedulePublishBlockedError | null;
        if (body?.gaps) setPublishBlockedGaps(body.gaps);
        return { status: "error", message: describeError(error) };
      }
      return { status: "error", message: describeError(error) };
    }
  }

  const readyWeek = week.kind === "ready" ? week.week : null;
  const gaps = readyWeek?.gaps ?? [];
  const canPublish =
    canEdit && readyWeek?.status === "draft" && gaps.length === 0;

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
          onCopyPrevious={() => setConfirmingCopy(true)}
          onAddEmployee={
            canAddEmployee ? () => setAddingEmployee(true) : undefined
          }
        />

        {publishBanner ? (
          <div className="rounded-[10px] border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-[13px] text-emerald-200">
            ✅ {publishBanner}
          </div>
        ) : null}

        <WeekBody
          state={week}
          weekStart={weekStart}
          employees={activeEmployees}
          settings={settings}
          canEdit={canEdit}
          onCellClick={(employee, date) => setEditingCell({ employee, date })}
          onRetry={() => void loadWeek()}
        />

        {readyWeek && week.kind === "ready" ? (
          <section className={CARD}>
            <div className={CARD_HEADER}>
              <h2 className="text-[14px] font-semibold text-white">
                Day timeline
              </h2>
              {canEdit && readyWeek.status === "draft" ? (
                <PublishControl
                  gapCount={gaps.length}
                  canPublish={canPublish}
                  onClick={() => setConfirmingPublish(true)}
                />
              ) : readyWeek.status === "published" ? (
                <span className={cn(MUTED, "text-[12px]")}>
                  Published
                  {readyWeek.published_by
                    ? ` by ${readyWeek.published_by}`
                    : ""}
                  {readyWeek.published_at
                    ? ` · ${new Date(readyWeek.published_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}`
                    : ""}
                </span>
              ) : null}
            </div>
            <div className="p-4">
              <DayTimeline
                weekStart={weekStart}
                cells={readyWeek.cells}
                employees={activeEmployees}
                workWindow={settings.work_window}
              />
            </div>
          </section>
        ) : null}
      </div>

      {addingEmployee ? (
        <AddEmployeeDialog
          onSubmit={handleAddEmployee}
          onClose={() => setAddingEmployee(false)}
        />
      ) : null}

      {editingCell ? (
        <CellEditorDialog
          employee={editingCell.employee}
          date={editingCell.date}
          dateLabel={new Date(
            `${editingCell.date}T00:00:00Z`,
          ).toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          })}
          cell={
            readyWeek?.cells.find(
              (c) =>
                c.employee_id === editingCell.employee.id &&
                c.date === editingCell.date,
            ) ?? null
          }
          shiftTypes={settings.shift_types}
          onSave={handleSaveCell}
          onClose={() => setEditingCell(null)}
        />
      ) : null}

      {confirmingCopy ? (
        <ConfirmDialog
          title="Copy last week's schedule?"
          confirmLabel="Copy"
          busyLabel="Copying…"
          onClose={() => setConfirmingCopy(false)}
          onConfirm={handleCopyPrevious}
        >
          <p>
            This replaces every cell in this week with last week&apos;s (
            {weekRangeLabel(shiftYmd(weekStart, -7))}) shifts. This can&apos;t
            be undone.
          </p>
        </ConfirmDialog>
      ) : null}

      {confirmingPublish ? (
        <ConfirmDialog
          title="Publish this week's schedule?"
          confirmLabel="Publish"
          busyLabel="Publishing…"
          onClose={() => setConfirmingPublish(false)}
          onConfirm={handlePublish}
        >
          <p>
            Everyone scheduled this week will get a system notification and an
            email. This can&apos;t be undone.
          </p>
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
  onCopyPrevious,
  onAddEmployee,
}: {
  weekStart: string;
  onChange: (weekStart: string) => void;
  canEdit: boolean;
  onCopyPrevious: () => void;
  onAddEmployee?: () => void;
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
      </div>
      {canEdit ? (
        <div className="flex gap-2">
          {onAddEmployee ? (
            <button
              type="button"
              onClick={onAddEmployee}
              className={DARK_SECONDARY_BUTTON_CLASS}
            >
              + Add employee
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCopyPrevious}
            className={DARK_SECONDARY_BUTTON_CLASS}
          >
            Copy last week
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PublishControl({
  gapCount,
  canPublish,
  onClick,
}: {
  gapCount: number;
  canPublish: boolean;
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
            : undefined
        }
        className={DARK_PRIMARY_BUTTON_CLASS}
      >
        Publish
      </button>
    </div>
  );
}

function WeekBody({
  state,
  weekStart,
  employees,
  settings,
  canEdit,
  onCellClick,
  onRetry,
}: {
  state: WeekState;
  weekStart: string;
  employees: ScheduleEmployee[];
  settings: ScheduleSettings;
  canEdit: boolean;
  onCellClick: (employee: ScheduleEmployee, date: string) => void;
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
        weekStart={weekStart}
        employees={employees}
        cells={state.week.cells}
        shiftTypes={settings.shift_types}
        gaps={state.week.gaps}
        canEdit={canEdit}
        onCellClick={onCellClick}
      />
    </section>
  );
}
