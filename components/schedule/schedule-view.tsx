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
import { PhoneMore } from "@/components/ui/phone";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  isYmd,
  laMinuteOfDay,
  laToday,
  shiftYmd,
  weekStartYmd,
} from "@/lib/la-date";
import {
  addScheduleEmployee,
  changesErrorOf,
  deleteScheduleTimeOff,
  fetchScheduleEmployees,
  saveScheduleEmployeeOrder,
  fetchScheduleSettings,
  fetchScheduleWeek,
  publishScheduleWeek,
  saveScheduleWeekChanges,
  setScheduleTimeOff,
  updateScheduleEmployee,
} from "@/lib/schedule-api";
import { replaceUrl, useLeaveGuard } from "@/lib/use-leave-guard";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { usePageVisibility } from "@/lib/page-visibility";
import { byTick } from "@/lib/by-tick";
import { usePermissions } from "@/lib/staff-permissions";
import { gapDayLabel, gapRange, gapsByDate } from "@/lib/schedule-gaps";
import { coversGaps, sortByName } from "@/lib/schedule-timeline";
import { pushRecentShift } from "@/lib/schedule-recent";
import type { Rule } from "@/lib/schedule-engine";
import {
  type HoursOf,
  WEEKDAY_NAMES,
  hoursOfSettings,
  sameEveryDay,
  weekdayOf,
  workHoursSummary,
} from "@/lib/schedule-work-hours";
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
  ScheduleSlot,
  ScheduleWeek,
  ScheduleWorkWindow,
} from "@/types";
import { ApiError } from "@/types";

import { AddEmployeeDialog } from "./add-employee-dialog";
import type { AddTimeOffInput } from "./add-shift-dialog";
import { AutoFillDialog } from "./auto-fill-dialog";
import { PeriodView } from "./period-view";
import { SharePeriodDialog } from "./share-period-dialog";
import { EmployeesDialog } from "./employees-dialog";
import { RulesView } from "./rules-view";
import { CARD, CARD_HEADER, ICON_BTN, MUTED } from "./config";
import { type PublishNotice, publishNotice } from "./publish-notice";
import { DayTimeline } from "./day-timeline";
import { ScheduleLockedPanel } from "./lock-panel";
import { SendChangesDialog } from "./send-changes-dialog";
import { ResponsesCard } from "./responses-card";
import { ScheduleSettingsDialog } from "./settings-dialog";
import { useScheduleEditLock } from "./use-schedule-edit-lock";
import {
  addCreates,
  applyDraft,
  countChanges,
  editSlot,
  EMPTY_DRAFT,
  isDirty,
  localGaps,
  futureGaps,
  gapCauseIds,
  newGapsByCard,
  type LaNow,
  opsOf,
  removeSlot,
  summaryOf,
  undoRemove,
  type DraftCreate,
  type SlotMark,
  type WeekDraft,
} from "./week-draft";
import { WeekGrid } from "./week-grid";
import { LeaveDialog } from "@/components/dispatch-manifest/page-save";

type WeekState =
  | { kind: "loading" }
  | { kind: "not_published" }
  | { kind: "error"; message: string }
  | { kind: "ready"; week: ScheduleWeek };

/** 整周 Save 的结果行（preview ②：存好绿、存失败红字后端原话）。 */
type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | {
      kind: "error";
      message: string;
      /** 409 stale：库里最新的 version（给「Keep editing」用）。 */
      stale?: { version: string | null };
      gaps?: ScheduleGap[];
    };

/**
 * 洛杉矶的此刻（日期 + 第几分钟）。检查脚本可以设 window.__scheduleNow = "YYYY-MM-DDTHH:MM" 固定成某个时刻
 *（模拟数据的周都在过去，不固定的话空档全被当成过去的放行掉）。
 */
function readLaNow(): LaNow {
  const o =
    typeof window !== "undefined"
      ? (window as { __scheduleNow?: unknown }).__scheduleNow
      : undefined;
  const m =
    typeof o === "string"
      ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(o)
      : null;
  if (m) return { date: m[1], minute: Number(m[2]) * 60 + Number(m[3]) };
  return { date: laToday(), minute: laMinuteOfDay() };
}

/** 10 分钟没动作只出提醒、不自动存（B9 Q4；只有 Dispatch 和 Bus Manifest setup 才自动存）。检查脚本可以设 window.__scheduleIdleRemindS 改短。 */
const IDLE_REMIND_S = 10 * 60;

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
  // 只看勾（Annie 2026-11-01「动手」）：除 Super Admin 外只照 /api/me/permissions；Publish anyway 后端仍按角色（admin / SA）。
  const tickPerms = usePermissions();
  const tickPermsRef = useRef(tickPerms);
  tickPermsRef.current = tickPerms;
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [meError, setMeError] = useState<
    "loading" | "forbidden" | "error" | null
  >("loading");
  const [meErrorMessage, setMeErrorMessage] = useState("");

  const [settings, setSettings] = useState<ScheduleSettings | null>(null);
  // 名单一律按名字排（Day timeline、Employees 窗口、Auto-fill 等照旧按名字，题 ⑦B）；排班表那一张另按 sort_order 排。
  const [employees, setEmployeesRaw] = useState<ScheduleEmployee[]>([]);
  const setEmployees = useCallback(
    (
      next:
        ScheduleEmployee[] | ((prev: ScheduleEmployee[]) => ScheduleEmployee[]),
    ) =>
      setEmployeesRaw((prev) =>
        sortByName(typeof next === "function" ? next(prev) : next),
      ),
    [],
  );
  /** 拖员工行排的新顺序（在用的人 id，整份），还没存；null = 没动。和这一周的班不一样，换周也留着。 */
  const [orderDraft, setOrderDraft] = useState<number[] | null>(null);
  const [weekStart, setWeekStart] = useState(() => weekStartYmd(laToday()));
  const [week, setWeek] = useState<WeekState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  const [addingEmployee, setAddingEmployee] = useState(false);
  const [managingEmployees, setManagingEmployees] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 规则（后端没上线 / 读不到 ⇒ null ⇒ 不显示 Rules 标签和 Auto-fill 键）。
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [tab, setTab] = useState<"schedule" | "period" | "rules">("schedule");
  // Period（Annie 2026-11-08）：开始那一周（周日）+ 周数，默认这周起 4 周。
  const [period, setPeriod] = useState(() => ({
    start: weekStartYmd(laToday()),
    weeks: 4,
  }));
  const [periodReload, setPeriodReload] = useState(0);
  const [periodAutoFilling, setPeriodAutoFilling] = useState(false);
  const [sharingPeriod, setSharingPeriod] = useState(false);
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
  /** Responses 卡读到的还没处理完的请求（pending + awaiting_peer），一条一行；第一次 Publish 的确认框列出来（G138，4e 确认前端自己数）。 */
  const [openRequests, setOpenRequests] = useState<readonly string[]>([]);
  useEffect(() => {
    setResponseAnswers(new Map());
    setOpenRequests([]);
  }, [weekStart]);
  /** 这一次打开页面以后改过、还没 Publish again 的已发布周（后端没带 has_unsent_changes 时用）。 */
  const [unsentWeek, setUnsentWeek] = useState<string | null>(null);
  const [publishBanner, setPublishBanner] = useState<PublishNotice | null>(
    null,
  );
  const [publishBlockedGaps, setPublishBlockedGaps] = useState<
    SchedulePublishBlockedError["gaps"] | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // 整周一个 Save（Annie 2026-10-29「你不会用缓存么」「4项全部动手」；B9 Q1–Q7 照推荐）：
  // 拖班、加删、改时间、备注先记在页面上，按 Save 一次存（POST …/changes）。休假照旧马上存（窗口里按键提交的）。
  const [draft, setDraft] = useState<WeekDraft>(EMPTY_DRAFT);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  /** 后端 400 指出的那一个班（标红）。 */
  const [errorSlotId, setErrorSlotId] = useState<number | null>(null);
  /**
   * 上一次 Save 被 409 coverage_gap 拒时后端列的空档。再改页面（红字收起）也留着，下一次 Save 成功 / Discard / 换周才清掉：
   * 不然一改别的地方，后端说的「哪天哪段」就看不到了，人只会去改自己以为的那一天（Annie 11-02「7号的gap已经填了，但始终报错不让保存」）。
   */
  const [rejectedGapsOf, setRejectedGapsOf] = useState<{
    week: string;
    gaps: ScheduleGap[];
  } | null>(null);
  /** 409 stale 后点了 Keep editing：下次 Save 用库里最新的 version。 */
  const [versionOverride, setVersionOverride] = useState<string | null>(null);
  /** 离开页面 / 换周时问 Save / Don't save / Cancel。 */
  const [leaveAsk, setLeaveAsk] = useState<{
    resolve: (leave: boolean) => void;
  } | null>(null);
  const [idleNudge, setIdleNudge] = useState(false);
  const lastChangeRef = useRef(0);
  /** 上一次 Save 送出去的 ops 对应哪个班（400 op_index → 标红哪一格）。 */
  const slotOfRef = useRef<number[]>([]);
  const dirty = isDirty(draft);
  // 页面上有没存的东西：这一周的班 + 员工顺序（顺序不占这一周的编辑锁、不算排班改动）。
  const anyDirty = dirty || orderDraft !== null;
  // 空档只算洛杉矶「现在以后」（Annie 2026-10-30「对过去的应该彻底放行」）：每分钟、回到这个标签页时刷新一次。
  const [laNow, setLaNow] = useState<LaNow>(readLaNow);
  useEffect(() => {
    const tick = () => setLaNow(readLaNow());
    const id = setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, []);
  /** 现在看的是哪一周（异步回来时判断有没有换周）。 */
  const weekRef = useRef(weekStart);
  weekRef.current = weekStart;

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
    dirty,
  });
  const [lockedBy, setLockedBy] = useState<{ by: string | null } | null>(null);

  /** 有没存的改动时离开：弹 Save / Don't save / Cancel；true = 可以走。 */
  const askLeave = useCallback(
    () => new Promise<boolean>((resolve) => setLeaveAsk({ resolve })),
    [],
  );
  useLeaveGuard(
    anyDirty,
    "You have unsaved changes to this week's schedule.",
    askLeave,
  );

  // 换周：暂存跟着清掉（换周前已经问过 Save / Don't save）。
  useEffect(() => {
    setDraft(EMPTY_DRAFT);
    setSaveState({ kind: "idle" });
    setErrorSlotId(null);
    setRejectedGapsOf(null);
    setVersionOverride(null);
    setIdleNudge(false);
  }, [weekStart]);

  // 10 分钟没动作：只提醒，不自动存、不放开锁（B9 Q4）。
  useEffect(() => {
    if (!dirty) {
      setIdleNudge(false);
      return;
    }
    const id = setInterval(() => {
      const v = (window as { __scheduleIdleRemindS?: unknown })
        .__scheduleIdleRemindS;
      const limit =
        (typeof v === "number" && v >= 0 ? v : IDLE_REMIND_S) * 1000;
      if (Date.now() - lastChangeRef.current >= limit) setIdleNudge(true);
    }, 1000);
    return () => clearInterval(id);
  }, [dirty]);

  // 地址栏的 ?week= 是打开页面时的起点（任意一天都行，落到那一天所在的周）；没有 / 不合法时用本周。
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("week");
    if (isYmd(fromUrl)) setWeekStart(weekStartYmd(fromUrl));
  }, []);

  // 身份 + 设置 + 名单：和具体哪一周无关，只在打开页面 / 手动重试时加载一次。
  useEffect(() => {
    // 权限读完再拉名单（停用的人要不要一起拉看 schedule.edit 的勾）。
    if (!tickPerms.ready) return;
    const controller = new AbortController();
    const { signal } = controller;
    setMeError("loading");
    (async () => {
      try {
        const user = await fetchCurrentUser(signal);
        if (signal.aborted) return;
        const [scheduleSettings, scheduleEmployees] = await Promise.all([
          fetchScheduleSettings(signal),
          // 停用的人：后端按 schedule.edit 给（64 2026-11-01）。
          fetchScheduleEmployees(
            signal,
            byTick(tickPermsRef.current, "schedule.edit", {
              superAdmin: !!user.is_superadmin,
            }),
          ),
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
  }, [reloadKey, redirectToLogin, tickPerms.ready, setEmployees]);

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
    // 用 replaceUrl：离开提醒撤哨兵（history.back）时不会把旧的 ?week= 搬回来。
    replaceUrl(url);
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
  if (!me || !settings || !tickPerms.ready) return <LoadingPanel />;

  const superAdmin = !!me.is_superadmin;
  // 改班、休假、编辑锁：schedule.edit（后端 schedule.py 的 _edit）。
  const canEdit = byTick(tickPerms, "schedule.edit", {
    superAdmin,
  });
  // Add employee：后端要 team.staff_add 和 schedule.edit 两个都有（schedule.py:122）。
  const canAddEmployee =
    superAdmin ||
    (tickPerms.can("team.staff_add") && tickPerms.can("schedule.edit"));
  // 排班设置（Working hours、Default shift times）：Team 页的勾 settings.schedule（Annie 2026-11-02「需要加一个可以edit的权限让我来Admin里勾选」；
  // 后端 PUT work-window / shift-types 本来就按这一项查）。有 schedule.edit 没这个勾的排班人能打开、只读；只能看的员工没有这个键。
  const canChangeSettings = byTick(tickPerms, "settings.schedule", {
    superAdmin,
  });
  // Publish / Publish again：schedule.publish（schedule.py:331）。
  const canPublishTick = byTick(tickPerms, "schedule.publish", {
    superAdmin,
  });
  const activeEmployees = employees.filter((e) => e.is_active);
  // 当前登录的人在名单里对应谁：按名字对（后端 /api/me 没有邮箱），对上的那一行固定在最上面。
  const meName = me.display_name?.trim().toLowerCase();
  const meEmployee = meName
    ? activeEmployees.find((e) => e.name.trim().toLowerCase() === meName)
    : undefined;
  // 排班表的行：存好的顺序（sort_order，没带按名字）+ 页面上拖过还没存的；自己那一行照旧固定在最上面（题 ⑥A）。
  const rowOrder = applyOrder(byRowOrder(activeEmployees), orderDraft);
  const orderedEmployees = meEmployee
    ? [meEmployee, ...rowOrder.filter((e) => e.id !== meEmployee.id)]
    : rowOrder;
  const savedRowIds = byRowOrder(activeEmployees).map((e) => e.id);
  const movedRows = new Set(
    orderDraft
      ? rowOrder.filter((e, i) => savedRowIds[i] !== e.id).map((e) => e.id)
      : [],
  );

  /** 拖员工行：dragId 放到 targetId 前面（after = 后面）。拖回原样就当没改。 */
  function handleReorder(dragId: number, targetId: number, after: boolean) {
    const ids = rowOrder.map((e) => e.id).filter((id) => id !== dragId);
    const at = ids.indexOf(targetId);
    if (at < 0) return;
    ids.splice(after ? at + 1 : at, 0, dragId);
    setOrderDraft(ids.every((id, i) => id === savedRowIds[i]) ? null : ids);
    setSaveState({ kind: "idle" });
  }

  /** 存员工顺序。成功返回 null；失败返回后端原话。 */
  async function saveOrder(): Promise<string | null> {
    if (!orderDraft) return null;
    setSaveState({ kind: "saving" });
    try {
      const saved = await saveScheduleEmployeeOrder(rowOrder.map((e) => e.id));
      const sortOf = new Map(saved.map((e) => [e.id, e.sort_order]));
      setEmployees((prev) =>
        prev.map((e) =>
          sortOf.has(e.id) ? { ...e, sort_order: sortOf.get(e.id) } : e,
        ),
      );
      setOrderDraft(null);
      setSaveState({ kind: "saved", at: new Date().toISOString() });
      return null;
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return "Please sign in again.";
      }
      const message = describeError(error);
      setSaveState({ kind: "error", message });
      return message;
    }
  }

  /** 页面上的 Save：先存这一周的班（原来的整周 Save），再存员工顺序。 */
  async function saveAll(): Promise<string | null> {
    if (dirty) {
      const err = await saveDraft();
      if (err) return err;
    }
    return saveOrder();
  }

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

  /**
   * 整周一个 Save：拖班 / 加删 / 改时间 / 备注都只改页面上的暂存（不发请求、不重读整周）。
   * 第一次动手照旧先占住这一周（别人占着就弹「谁在编辑」，这一下不做）。存的时候不能再改。
   */
  async function change(
    fn: (d: WeekDraft, serverSlots: readonly ScheduleSlot[]) => WeekDraft,
  ) {
    if (week.kind !== "ready" || saveState.kind === "saving") return;
    const serverSlots = week.week.slots;
    setActionError(null);
    const startedOn = weekStart;
    if (!(await guardEdit())) return;
    // 等占锁的时候换了周：这一下作废（不然会落到新的那一周上）。
    if (weekRef.current !== startedOn) return;
    setDraft((d) => fn(d, serverSlots));
    editLock.markEdited();
    lastChangeRef.current = Date.now();
    setIdleNudge(false);
    setErrorSlotId(null);
    setSaveState({ kind: "idle" });
  }

  /** 存页面上的改动。成功返回 null；失败返回后端原话（页面上红字，改动全部留着）。 */
  async function saveDraft(): Promise<string | null> {
    if (week.kind !== "ready" || !isDirty(draft)) return null;
    const { ops, slotOf } = opsOf(draft);
    slotOfRef.current = slotOf;
    setSaveState({ kind: "saving" });
    setErrorSlotId(null);
    try {
      const r = await saveScheduleWeekChanges(weekStart, {
        lock_token: editLock.token(),
        base_version: versionOverride ?? week.week.version ?? null,
        ops,
      });
      editLock.adoptToken(r.lock_token);
      setWeek({ kind: "ready", week: r.week });
      setDraft(EMPTY_DRAFT);
      setVersionOverride(null);
      setIdleNudge(false);
      setRejectedGapsOf(null);
      setSaveState({ kind: "saved", at: new Date().toISOString() });
      if (r.week.status === "published") setUnsentWeek(weekStart);
      // 存好就放开（preview ③），别人可以改；再动手时会重新占。
      void editLock.release();
      return null;
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return "Please sign in again.";
      }
      const e = changesErrorOf(error);
      const message = e?.detail ?? describeError(error);
      if (e && e.code !== "locked") editLock.adoptToken(e.lock_token);
      if (e?.op_index != null)
        setErrorSlotId(slotOfRef.current[e.op_index] ?? null);
      if (e?.code === "coverage_gap" && e.gaps?.length)
        setRejectedGapsOf({ week: weekStart, gaps: e.gaps });
      setSaveState({
        kind: "error",
        message,
        ...(e?.code === "stale"
          ? { stale: { version: e.version ?? null } }
          : {}),
        ...(e?.code === "coverage_gap" && e.gaps ? { gaps: e.gaps } : {}),
      });
      return message;
    }
  }

  /** 放弃全部没存的改动，回到已存的样子，放开锁。 */
  function discardDraft() {
    setDraft(EMPTY_DRAFT);
    setOrderDraft(null);
    setSaveState({ kind: "idle" });
    setErrorSlotId(null);
    setRejectedGapsOf(null);
    setVersionOverride(null);
    setIdleNudge(false);
    void editLock.release();
  }

  /** 换周：有没存的改动先问。 */
  async function changeWeek(next: string) {
    if (next === weekStart) return;
    if (isDirty(draft) && !(await askLeave())) return;
    setWeekStart(next);
  }

  function handleAssign(slotId: number, employeeId: number | null) {
    void change((d, s) => editSlot(d, s, slotId, { employee_id: employeeId }));
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
    // 先放到页面上（标 new），按 Save 一起存；休假挡班之类由后端在存的时候判，红字原话。
    void change((d) =>
      addCreates(
        d,
        input.dates.map((date): Omit<DraftCreate, "tempId"> => ({
          date,
          shift_type: input.shiftType.key,
          start_time: input.start,
          end_time: input.end,
          employee_id: input.employeeId,
          note: input.note || null,
        })),
      ),
    );
  }

  function handleSaveNote(slotId: number, note: string | null) {
    void change((d, s) => editSlot(d, s, slotId, { note }));
  }

  function handleUndoDelete(slotId: number) {
    void change((d) => undoRemove(d, slotId));
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
    void change((d) => removeSlot(d, slotId));
  }

  function handleUpdateTime(slotId: number, start: string, end: string) {
    const slot =
      week.kind === "ready"
        ? applyDraft(week.week.slots, draft).view.find((s) => s.id === slotId)
        : undefined;
    if (slot?.employee_id != null) {
      pushRecentShift(slot.employee_id, {
        type: slot.shift_type,
        start,
        end,
      });
    }
    void change((d, s) =>
      editSlot(d, s, slotId, { start_time: start, end_time: end }),
    );
  }

  /**
   * Auto-fill 当前这一周（B9 Q6）：填出来的班放进暂存等 Save；Replace = 这一周库里的班全部标删掉、页面上新加的拿掉。
   * 后面几周照旧由窗口直接建草稿。
   */
  function handleAutoFillThisWeek(
    made: {
      date: string;
      type: string;
      start: string;
      end: string;
      employeeId: number | null;
    }[],
    replace: boolean,
  ) {
    void change((d, s) => {
      let next: WeekDraft = replace ? { ...d, creates: [] } : d;
      if (replace) for (const slot of s) next = removeSlot(next, slot.id);
      return addCreates(
        next,
        made.map((m) => ({
          date: m.date,
          shift_type: m.type,
          start_time: m.start,
          end_time: m.end,
          employee_id: m.employeeId,
          note: null,
        })),
      );
    });
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
    // 有没存的改动：先存再发布（B9 Q2「Save and publish」一步完成）。存不上就不发布，红字原话。
    if (isDirty(draft)) {
      const saveError = await saveDraft();
      if (saveError)
        return {
          status: "error",
          message: `Not published. Your changes could not be saved: ${saveError}`,
        };
    }
    try {
      const result = await publishScheduleWeek(weekStart, { allowGaps });
      setConfirmingPublish(false);
      setPublishBlockedGaps(null);
      // 重新发布只通知班有变化的人 + 能改排班的人（Annie 2026-10-30 10a「你别管是谁，我选谁就是谁，最关键是有没有这个功能，
      // 而不是这个职位」：按 schedule.edit 权限，不提职位；后端 notified_supervisors 就是这些人，去掉按的人自己）。
      // 一个都没变就写明没人收到，不写「Notified 0 people」。能改排班的人 0 个时不写后半句。
      // 没收到的人也列出来（Annie 置顶 15）：句子在 publish-notice.ts。
      setPublishBanner(publishNotice(result));
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
  // 页面上画的 = 库里的 + 暂存（整周一个 Save）。live 去掉了删掉还没存的班，空档 / Day timeline 照它算（B9 Q3）。
  const derived = readyWeek ? applyDraft(readyWeek.slots, draft) : null;
  const liveSlots = derived?.live ?? [];
  const movedFrom = new Map<number, number | null>();
  for (const [id, e] of Object.entries(draft.edits)) {
    if (e.employee_id === undefined) continue;
    const orig = readyWeek?.slots.find((s) => s.id === Number(id));
    if (orig) movedFrom.set(orig.id, orig.employee_id);
  }
  const counts = countChanges(draft);
  // 「Not saved yet: …」：这一周的班 + 员工顺序。
  const unsavedSummary = [
    dirty ? summaryOf(counts) : "",
    orderDraft ? "staff order changed" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  // Working hours 按星期几（Annie 2026-11-02，后端 v144 work_hours；旧后端每天都是 work_window）。
  const hoursOf = hoursOfSettings(settings);
  // 测试用的人（Annie 2026-10-30 选 A）和设成不算人头的人（Annie 11-02「Anita不算的」）：不算进空档。
  const testIds = new Set(
    employees.filter((e) => !coversGaps(e)).map((e) => e.id),
  );
  // 卡片上直接标空档（置顶 17）：这次改动新造成的空档记到造成它的那张卡上，补上就没了。
  const gapNotes =
    readyWeek && derived
      ? newGapsByCard(
          weekStart,
          readyWeek.slots,
          derived.live,
          draft,
          hoursOf,
          laNow,
          testIds,
        )
      : new Map();
  // 这周被排进时段、但名单里没有邮箱的人：发布时收不到邮件（只是提醒，不拦着发布）。
  const scheduledIds = new Set(liveSlots.map((s) => s.employee_id));
  const noEmailNames = employees
    .filter((e) => scheduledIds.has(e.id) && !e.email)
    .map((e) => e.name);
  // 空档：有没存的改动时照页面上的算，存的时候以后端为准（B9 Q3）。
  // Save 被 409 coverage_gap 拒了：后端列的那几段也并进来（周表列头红点、Day timeline 跟着标），两边算得不一样也不会漏。
  // 有测试用的人（is_test）时也自己算：他们的班不算覆盖（后端改好以前后端的 gaps 还算着他们）。
  const baseGaps =
    readyWeek && (dirty || testIds.size > 0)
      ? localGaps(weekStart, liveSlots, hoursOf, testIds)
      : (readyWeek?.gaps ?? []);
  const rejectedGaps =
    dirty && saveState.kind === "error" ? (saveState.gaps ?? []) : [];
  const gaps = futureGaps(
    [
      ...baseGaps,
      ...rejectedGaps.filter(
        (g) =>
          !baseGaps.some(
            (b) =>
              b.date === g.date &&
              b.start_time === g.start_time &&
              b.end_time === g.end_time,
          ),
      ),
    ],
    laNow,
  );
  const gapDays = gapsByDate(gaps);
  // Save 被 409 coverage_gap 拒：后端列的每一段写清哪天几点、是页面上哪个改动造成的（Annie 11-02「7号的gap已经填了，但始终报错不让保存」：
  // 同一次 Save 送的是打开页面以来所有没存的改动，口子常常开在别的日子）。
  const rejectedLines =
    dirty && readyWeek && rejectedGapsOf?.week === weekStart
      ? rejectedGapsOf.gaps.map((g) => {
          const causes = gapCauseIds(g, readyWeek.slots, draft).map((id) => {
            const s = readyWeek.slots.find((x) => x.id === id)!;
            const who =
              employees.find((e) => e.id === s.employee_id)?.name ?? "Someone";
            const type =
              settings.shift_types.find((t) => t.key === s.shift_type)?.label ??
              s.shift_type;
            return `${who}'s ${type} shift`;
          });
          return `${gapDayLabel(g.date)}, ${gapRange(g)} is not covered${
            causes.length
              ? ` — caused by your change to ${causes.join(" and ")}`
              : ""
          }.`;
        })
      : [];
  // 有空档也能发布（Publish anyway）：只给 admin 及以上（Annie 2026-10-29 Q1）。supervisor 有空档时照旧先补人。
  const canPublishAnyway = me.is_admin === true || me.is_superadmin === true;
  // 已发布的周也能点 Publish again（Annie 2026-10-29 Q6「要留publish again，要允许改正错误」）；有空档时同样走 Publish anyway。
  const canPublish = canPublishTick && (gaps.length === 0 || canPublishAnyway);
  const timelineDate =
    timelineDay?.week === weekStart ? timelineDay.date : shiftYmd(weekStart, 1);
  /** 跳到 Day timeline 的某一天（点空档提示 / 列头红点）。 */
  function jumpToDay(date: string) {
    setTimelineDay({ week: weekStart, date });
    timelineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // Period 标签：开关 schedule_period（默认只 Super Admin）。
  const periodVisible = pageVisibility.visible("schedule_period");
  const tabs = [
    "schedule" as const,
    ...(periodVisible ? (["period"] as const) : []),
    ...(rules !== null ? (["rules"] as const) : []),
  ];

  return (
    <main data-phone-compact className="text-white/90">
      <CenteredPage className="flex flex-col gap-5 max-sm:gap-3">
        <h1 className="sr-only">Staff Schedule</h1>

        {tabs.length > 1 ? (
          <div role="tablist" className="-mb-2 flex gap-2">
            {tabs.map((t) => (
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
                {t === "schedule"
                  ? "Schedule"
                  : t === "period"
                    ? "Period"
                    : "Rules"}
              </button>
            ))}
          </div>
        ) : null}

        {tab === "period" && periodVisible ? (
          <>
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
            <PeriodView
              employees={orderedEmployees}
              canEdit={canEdit}
              start={period.start}
              weeks={period.weeks}
              onChangeRange={(start, weeks) => setPeriod({ start, weeks })}
              reloadKey={periodReload}
              onOpenWeek={(ws) => {
                setTab("schedule");
                void changeWeek(ws);
              }}
              onAutoFill={
                canEdit && rules !== null
                  ? () => setPeriodAutoFilling(true)
                  : undefined
              }
              // Share with staff：后端照 schedule.publish 的勾放行（33，2026-11-08）。
              onShare={
                canPublishTick ? () => setSharingPeriod(true) : undefined
              }
              autoFillBlocked={
                anyDirty
                  ? "Save or discard the changes on the Schedule tab first."
                  : !rules?.some((r) => r.enabled)
                    ? "Turn on some rules in the Rules tab first."
                    : null
              }
              onUnauthorized={redirectToLogin}
            />
          </>
        ) : tab === "rules" && rules !== null ? (
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
              onChange={(next) => void changeWeek(next)}
              canEdit={canEdit}
              saveControls={
                canEdit && readyWeek ? (
                  <>
                    <button
                      type="button"
                      data-week-discard
                      disabled={!anyDirty || saveState.kind === "saving"}
                      onClick={discardDraft}
                      className={DARK_SECONDARY_BUTTON_CLASS}
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      data-week-save
                      disabled={!anyDirty || saveState.kind === "saving"}
                      onClick={() => void saveAll()}
                      className={DARK_PRIMARY_BUTTON_CLASS}
                    >
                      {saveState.kind === "saving" ? "Saving…" : "Save"}
                    </button>
                  </>
                ) : undefined
              }
              onAddEmployee={
                canAddEmployee ? () => setAddingEmployee(true) : undefined
              }
              onManageEmployees={
                canAddEmployee ? () => setManagingEmployees(true) : undefined
              }
              onSettings={
                canEdit || canChangeSettings
                  ? () => setSettingsOpen(true)
                  : undefined
              }
              onAutoFill={
                canEdit && rules !== null
                  ? () => setAutoFilling(true)
                  : undefined
              }
              autoFillDisabled={!rules?.some((r) => r.enabled)}
            />

            {canEdit && readyWeek ? (
              <SaveStatus
                dirty={anyDirty}
                summary={unsavedSummary}
                state={saveState}
                rejectedLines={rejectedLines}
                idleNudge={idleNudge}
                onReload={() => {
                  discardDraft();
                  void loadWeek(undefined, true);
                }}
                onKeepEditing={() => {
                  if (saveState.kind === "error" && saveState.stale)
                    setVersionOverride(saveState.stale.version);
                  setSaveState({ kind: "idle" });
                }}
              />
            ) : null}

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

            {publishBanner?.allFailed ? (
              <div
                role="alert"
                data-publish-banner="none-notified"
                className="rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-[13px] text-red-200"
              >
                ⚠️ {publishBanner.unreached}
              </div>
            ) : publishBanner ? (
              <div
                data-publish-banner={
                  publishBanner.unreached ? "some-missed" : "ok"
                }
                className="rounded-[10px] border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-[13px] text-emerald-200"
              >
                ✅ <span data-publish-ok>{publishBanner.ok}</span>
                {publishBanner.unreached ? (
                  <>
                    {" "}
                    <span data-publish-unreached className="text-red-300">
                      {publishBanner.unreached}
                    </span>
                  </>
                ) : null}
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
              onReorder={canEdit ? handleReorder : undefined}
              movedRows={movedRows}
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
              rules={canEdit && rules ? rules : undefined}
              onGapDay={jumpToDay}
              draftView={
                derived
                  ? {
                      slots: derived.view,
                      marks: derived.marks,
                      movedFrom,
                      errorSlotId,
                      gapNotes,
                    }
                  : undefined
              }
              onUndoDelete={handleUndoDelete}
              // 发布前单独发给本人确认：supervisor 及以上（能改排班的人），只在已发布的周。
              pendingChanges={
                canEdit && readyWeek?.status === "published"
                  ? readyWeek.pending_changes
                  : undefined
              }
              onSendChanges={setSendingTo}
              // 有没存的改动：Send to confirm 灰着、写 Save first（置顶 12 方案 A）。
              sendBlocked={dirty}
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
                onOpenRequests={setOpenRequests}
                onChanged={() => void loadWeek(undefined, true)}
                onUnauthorized={redirectToLogin}
                beforeEdit={guardEdit}
                onEdited={markEdited}
              />
            ) : null}

            {readyWeek && week.kind === "ready" ? (
              <section ref={timelineRef} className={cn(CARD, "scroll-mt-4")}>
                <div className={CARD_HEADER}>
                  <div className="min-w-0">
                    <h2 className="text-[14px] font-semibold text-white">
                      Day timeline
                    </h2>
                    {canEdit ? (
                      // 空档按什么算一眼看得到（Annie 2026-11-02「所以两个edit，到底哪个管用」，preview ②A）；改去 ⚙ Settings。
                      <p
                        data-working-hours
                        className={cn(MUTED, "text-[12px] max-sm:hidden")}
                      >
                        Working hours {workHoursSummary(settings)} — gaps are
                        checked inside these hours.
                      </p>
                    ) : null}
                  </div>
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
                        hoursOf={hoursOf}
                        byDay={!sameEveryDay(settings)}
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
                    slots={liveSlots}
                    employees={activeEmployees}
                    hoursOf={hoursOf}
                    selectedDate={timelineDate}
                    onSelectDate={(d) =>
                      setTimelineDay({ week: weekStart, date: d })
                    }
                    weekGaps={gaps}
                    showGaps={canEdit}
                    shiftTypes={settings.shift_types}
                    now={laNow}
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
          onDraftThisWeek={canEdit ? handleAutoFillThisWeek : undefined}
          onDone={(message) => {
            setAutoFilling(false);
            setAutoFillBanner(message);
            void loadWeek(undefined, true);
          }}
        />
      ) : null}

      {sharingPeriod ? (
        <SharePeriodDialog
          start={period.start}
          weeks={period.weeks}
          onClose={() => {
            setSharingPeriod(false);
            setPeriodReload((n) => n + 1);
          }}
          onUnauthorized={redirectToLogin}
        />
      ) : null}

      {periodAutoFilling && rules !== null ? (
        <AutoFillDialog
          weekStart={period.start}
          rules={rules.filter((r) => r.enabled)}
          employees={employees}
          settings={settings}
          period={{
            start: period.start,
            weeks: period.weeks,
            ctx: { employees, shiftTypes: settings.shift_types },
          }}
          onClose={() => setPeriodAutoFilling(false)}
          onDone={(message) => {
            setPeriodAutoFilling(false);
            setAutoFillBanner(message);
            setPeriodReload((n) => n + 1);
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
            // 有没存的改动：先存再发布（B9 Q2，preview 第 5 张「Save and publish」）。
            `${dirty ? "Save and publish" : "Publish"}${
              readyWeek?.status === "published" ? " again" : ""
            }${gaps.length ? " anyway" : ""}`
          }
          // 蓝色只给提交键（Annie 2026-10-11）；preview 第 ④ 张。
          confirmClassName={DARK_PRIMARY_BUTTON_CLASS}
          busyLabel="Publishing…"
          onClose={() => setConfirmingPublish(false)}
          onConfirm={() => handlePublish(gaps.length > 0)}
        >
          {dirty ? (
            <p data-publish-unsaved className="mb-2 font-semibold">
              You have {counts.total} unsaved{" "}
              {counts.total === 1 ? "change" : "changes"}. They are saved first,
              then the week is published.
            </p>
          ) : null}
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
                // 按权限不按职位（Annie 10-30 10a）：勾了 schedule.edit 的人都通知，去掉按的人自己。
                "People whose shifts or time off changed since the last publish will get a system notification and an email. People who can edit the schedule (except you) get a notice listing the changes. No one else is notified. This can't be undone."
              : "Everyone scheduled this week will get a system notification and an email. This can't be undone."}
            {gaps.length
              ? " Publishing with a gap is written in the Action Log."
              : ""}
          </p>
          {openRequests.length > 0 && readyWeek?.status !== "published" ? (
            <div
              data-publish-open-requests
              className="mt-3 rounded-[8px] border border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.14)] px-3 py-2 text-[13px] text-[#fde68a]"
            >
              <p>
                {openRequests.length}{" "}
                {openRequests.length === 1
                  ? "request is still open"
                  : "requests are still open"}
                . Publishing closes {openRequests.length === 1 ? "it" : "them"}{" "}
                and tells each person:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {openRequests.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {readyWeek?.status === "published" &&
          !dirty &&
          (readyWeek.has_unsent_changes ?? unsentWeek === weekStart) ===
            false ? (
            // Annie 2026-10-30「那你要提醒发送人这个班一点都没有变啊，不能静默处理」：整周没变，Publish again 照旧能按，先说清楚不会通知谁。
            <p
              data-publish-nothing-changed
              className="mt-3 font-semibold text-[#BA7517] night:text-amber-200"
            >
              Nothing has changed since the last publish, so no one will be
              notified.
            </p>
          ) : null}
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

      {settingsOpen ? (
        <ScheduleSettingsDialog
          settings={settings}
          canChange={canChangeSettings}
          rules={rules}
          ruleCtx={{ employees, shiftTypes: settings.shift_types }}
          onSaved={(next) => {
            setSettings(next);
            // 空档按新的 Working hours 马上重算（后端 GET week 带 gaps）。
            void loadWeek(undefined, true);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {leaveAsk ? (
        <LeaveDialog
          items={[
            `Staff Schedule ${weekRangeLabel(weekStart)}: ${unsavedSummary}`,
          ]}
          onSave={async () => {
            const err = await saveAll();
            if (err) return err;
            leaveAsk.resolve(true);
            setLeaveAsk(null);
            return null;
          }}
          onDiscard={() => {
            discardDraft();
            leaveAsk.resolve(true);
            setLeaveAsk(null);
          }}
          onCancel={() => {
            leaveAsk.resolve(false);
            setLeaveAsk(null);
          }}
        />
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

/**
 * 周表上方那一行（B9 preview ①②）：琥珀色「Not saved yet: …」/ 绿色「✓ Saved · 时间」/ 红字后端原话（一样都不存，改动留着）。
 * 409 stale 多两个键：Reload（放弃我的改动，读最新）、Keep editing（Q7）。10 分钟没动作出琥珀色提醒（不自动存）。
 */
function SaveStatus({
  dirty,
  summary,
  state,
  rejectedLines,
  idleNudge,
  onReload,
  onKeepEditing,
}: {
  dirty: boolean;
  summary: string;
  state: SaveState;
  /** 上一次 Save 被 409 coverage_gap 拒时后端列的空档（写好的句子）；再改页面也留着，直到下次 Save / Discard。 */
  rejectedLines: string[];
  idleNudge: boolean;
  onReload: () => void;
  onKeepEditing: () => void;
}) {
  // 存失败：红字滚到屏幕中间。Save 键和红字在页面最上面，人常常在下面的周表 / Day timeline 那里，
  // 看不到红字只看到「Not saved yet」还挂着（Annie 2026-10-30「save了以后，没有saved的提示还在那里」，原因是 409 coverage_gap）。
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.kind === "error")
      errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state]);
  return (
    <div data-save-status className="-mt-2 flex flex-col gap-1.5 text-[13px]">
      {state.kind === "error" ? (
        <div
          ref={errorRef}
          role="alert"
          data-save-error
          className="rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-red-200"
        >
          <p className="font-semibold">
            Not saved: {state.message} Nothing was saved; your changes are still
            on the page.
          </p>
          {rejectedLines.length ? (
            <RejectedGapList lines={rejectedLines} />
          ) : null}
          {state.stale ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                data-stale-reload
                onClick={onReload}
                className={DARK_SECONDARY_BUTTON_CLASS}
              >
                Reload (drop my changes)
              </button>
              <button
                type="button"
                data-stale-keep
                onClick={onKeepEditing}
                className={DARK_SECONDARY_BUTTON_CLASS}
              >
                Keep editing
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {state.kind !== "error" && rejectedLines.length ? (
        <div
          data-save-rejected
          className="rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-red-200"
        >
          <p className="font-semibold">
            Your last Save was refused because of these gaps. Fix them, then
            click Save again.
          </p>
          <RejectedGapList lines={rejectedLines} />
        </div>
      ) : null}
      {dirty ? (
        <p data-unsaved-summary className="font-semibold text-[#fcd34d]">
          Not saved yet: {summary}
        </p>
      ) : state.kind === "saved" ? (
        <p data-saved className="font-semibold text-emerald-300">
          ✓ Saved ·{" "}
          {new Date(state.at).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/Los_Angeles",
          })}
        </p>
      ) : null}
      {dirty && idleNudge ? (
        <p data-idle-nudge className="text-[#fcd34d]">
          You haven&apos;t saved for 10 minutes. Click Save to keep your
          changes; they are not saved automatically.
        </p>
      ) : null}
    </div>
  );
}

function RejectedGapList({ lines }: { lines: string[] }) {
  return (
    <ul data-rejected-gaps className="mt-1 list-disc pl-5">
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
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
  onSettings,
  onAutoFill,
  autoFillDisabled,
  saveControls,
}: {
  weekStart: string;
  onChange: (weekStart: string) => void;
  canEdit: boolean;
  onAddEmployee?: () => void;
  onManageEmployees?: () => void;
  /** ⚙ Settings（Working hours、Default shift times 集中一处，Annie 2026-11-02 preview 97MgNcpw28p7W4DxXmpgrM）。 */
  onSettings?: () => void;
  onAutoFill?: () => void;
  autoFillDisabled?: boolean;
  /** 整周一个 Save（B9 preview ①）：Save + Discard，放在 Auto-fill 左边。 */
  saveControls?: React.ReactNode;
}) {
  // 手机版（Annie 2026-11-01 手机版规则）：一行只放 ‹ 日期 ›；This week / Next week、Auto-fill、Employees、+ Add employee
  // 收进右边那排的「⋯」，Discard / Save 照旧露在外面。没有右边那排（只能看的人）时 This week / Next week 照旧放在日期后面。
  const editRow = Boolean(
    (canEdit && (onAddEmployee || saveControls)) || onSettings,
  );
  const jumpButtons = (inMenu: boolean) => (
    <>
      <button
        type="button"
        onClick={() => onChange(weekStartYmd(laToday()))}
        className={cn(
          DARK_SECONDARY_BUTTON_CLASS,
          "whitespace-nowrap",
          inMenu ? "sm:hidden" : cn("ml-1", editRow && "max-sm:hidden"),
        )}
      >
        This week
      </button>
      <button
        type="button"
        onClick={() => onChange(shiftYmd(weekStartYmd(laToday()), 7))}
        className={cn(
          DARK_SECONDARY_BUTTON_CLASS,
          "whitespace-nowrap",
          inMenu ? "sm:hidden" : editRow && "max-sm:hidden",
        )}
      >
        Next week
      </button>
    </>
  );
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 max-sm:gap-2">
      <div className="flex min-w-0 items-center gap-2 max-sm:flex-wrap">
        <button
          type="button"
          aria-label="Previous week"
          onClick={() => onChange(shiftYmd(weekStart, -7))}
          className={ICON_BTN}
        >
          ‹
        </button>
        <span className="min-w-[180px] text-center text-[15px] font-semibold text-white max-sm:min-w-0 max-sm:text-[14px] max-sm:whitespace-nowrap">
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
        {jumpButtons(false)}
      </div>
      {editRow ? (
        <div className="flex flex-wrap items-center gap-2">
          {saveControls}
          <PhoneMore label="More schedule actions">
            {jumpButtons(true)}
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
            {onAddEmployee ? (
              <button
                type="button"
                onClick={onAddEmployee}
                className={DARK_SECONDARY_BUTTON_CLASS}
              >
                + Add employee
              </button>
            ) : null}
            {onSettings ? (
              <button
                type="button"
                data-open-settings
                onClick={onSettings}
                className={DARK_SECONDARY_BUTTON_CLASS}
              >
                ⚙ Settings
              </button>
            ) : null}
          </PhoneMore>
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
  hoursOf,
  byDay,
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
  /** 空档贴着那一天 Working hours 开头 / 结尾时补一句（Annie 2026-11-02 preview ⑥A：一看就知道是 Working hours 卡住的）。 */
  hoursOf: HoursOf;
  /** Working hours 按天不同：那句话带星期几，例如「(Friday working hours end 9:30 PM)」。 */
  byDay: boolean;
}) {
  const list = [...gapDays.values()].flat();
  const edgeNote = (g: ScheduleGap) => {
    const h = hoursOf(g.date);
    const atStart = g.start_time === h.start_time;
    const atEnd = g.end_time === h.end_time;
    if (atStart && atEnd) return null;
    const day = byDay ? `${WEEKDAY_NAMES[weekdayOf(g.date)]} ` : "";
    if (atEnd)
      return `(${day}working hours end ${formatBadgeTime(h.end_time)})`;
    if (atStart)
      return `(${day}working hours start ${formatBadgeTime(h.start_time)})`;
    return null;
  };
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
              {edgeNote(g) ? (
                <span data-gap-edge className="ml-1 text-red-300/80">
                  {edgeNote(g)}
                </span>
              ) : null}
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
                ? "Publish again: people whose shifts or time off changed, and people who can edit the schedule, are notified."
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
  rules,
  draftView,
  onUndoDelete,
  pendingChanges,
  onSendChanges,
  sendBlocked,
  onReorder,
  movedRows,
}: {
  /** 整周一个 Save：页面上要画的班（库里的 + 暂存）和标记；没有 = 照库里的画。 */
  draftView?: {
    slots: ScheduleSlot[];
    marks: Map<number, SlotMark>;
    movedFrom: Map<number, number | null>;
    errorSlotId: number | null;
    gapNotes: Map<number, ScheduleGap[]>;
  };
  onUndoDelete?: (slotId: number) => void;
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
  /** 置顶 110：手动排班照规则标出超人数 / 超小时（不拦）；只给能改排班的人。 */
  rules?: Rule[];
  onGapDay?: (date: string) => void;
  pendingChanges?: SchedulePendingChange[];
  onSendChanges?: (employeeId: number) => void;
  sendBlocked?: boolean;
  onReorder?: (dragId: number, targetId: number, after: boolean) => void;
  movedRows?: ReadonlySet<number>;
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
        slots={draftView?.slots ?? state.week.slots}
        marks={draftView?.marks}
        movedFrom={draftView?.movedFrom}
        errorSlotId={draftView?.errorSlotId ?? null}
        gapNotes={draftView?.gapNotes}
        onUndoDelete={onUndoDelete}
        timeOff={state.week.time_off}
        shiftTypes={settings.shift_types}
        canEdit={canEdit}
        onAssign={onAssign}
        onCreateSlots={onCreateSlots}
        hoursOf={hoursOfSettings(settings)}
        onDeleteSlot={onDeleteSlot}
        onUpdateTime={onUpdateTime}
        onSaveNote={onSaveNote}
        onSetTimeOff={onSetTimeOff}
        onDeleteTimeOff={onDeleteTimeOff}
        gapsByDay={gapsByDay}
        onGapDay={onGapDay}
        rules={rules}
        pendingChanges={pendingChanges}
        onSendChanges={onSendChanges}
        sendBlocked={sendBlocked}
        onReorder={onReorder}
        movedRows={movedRows}
      />
    </section>
  );
}

/** 排班表的行顺序：sort_order 小的在前；没有 sort_order（后端还没上线）的按名字排在后面。 */
function byRowOrder(list: ScheduleEmployee[]): ScheduleEmployee[] {
  return [...list].sort((a, b) => {
    const sa = a.sort_order ?? Number.POSITIVE_INFINITY;
    const sb = b.sort_order ?? Number.POSITIVE_INFINITY;
    return sa - sb || 0;
  });
}

/** 套上页面上拖过的顺序：草稿里有的按草稿排，草稿以后新加的人（不在草稿里）排在最后。 */
function applyOrder(
  list: ScheduleEmployee[],
  ids: number[] | null,
): ScheduleEmployee[] {
  if (!ids) return list;
  const at = new Map(ids.map((id, i) => [id, i]));
  return [...list].sort(
    (a, b) =>
      (at.get(a.id) ?? Number.POSITIVE_INFINITY) -
        (at.get(b.id) ?? Number.POSITIVE_INFINITY) || 0,
  );
}
