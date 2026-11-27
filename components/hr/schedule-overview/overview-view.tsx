"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AddLeaveDialog,
  FillGapDialog,
  type LeaveDialogData,
  LeaveRequestDialog,
  LeaveTypesDialog,
} from "@/components/hr/schedule-leave";
import { BTN_BLUE, BTN_PLAIN, LeaveDialogShell } from "@/components/hr/schedule-leave/ui";
import { ShiftChangeRequestDialog } from "@/components/hr/schedule-requests";
import { HR_BTN_CLASS, HR_CARD_CLASS } from "@/components/hr/legacy-ui";
import { AutoFillDialog } from "@/components/schedule/auto-fill-dialog";
import { EmployeesDialog } from "@/components/schedule/employees-dialog";
import { type PublishNotice, publishNotice } from "@/components/schedule/publish-notice";
import { RulesView } from "@/components/schedule/rules-view";
import { SendChangesDialog } from "@/components/schedule/send-changes-dialog";
import { ScheduleSettingsDialog } from "@/components/schedule/settings-dialog";
import { SharePeriodDialog } from "@/components/schedule/share-period-dialog";
import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { laToday, weekStartYmd } from "@/lib/la-date";
import { usePageVisibility } from "@/lib/page-visibility";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import {
  addScheduleEmployee,
  fetchScheduleEmployees,
  fetchScheduleSettings,
  fetchScheduleWeek,
  publishScheduleWeek,
  updateScheduleEmployee,
} from "@/lib/schedule-api";
import type { ConfirmRequest } from "@/lib/schedule-confirm-api";
import { clockRange, dayLabel } from "@/lib/schedule-leave";
import {
  FALLBACK_LEAVE_CATEGORIES,
  fetchLeaveCategories,
  type LeaveCategory,
  leaveErrorOf,
  leaveErrorText,
  type OverviewLeaveRequest,
} from "@/lib/schedule-leave-api";
import { fetchScheduleRange, saveScheduleRange } from "@/lib/schedule-overview-api";
import { fetchScheduleRules, saveScheduleRules } from "@/lib/schedule-rules-api";
import type { Rule } from "@/lib/schedule-engine";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import type {
  ScheduleEmployee,
  ScheduleGap,
  ScheduleSettings,
  ScheduleSlot,
  ScheduleTimeOff,
  ScheduleViolation,
  ScheduleWeek,
} from "@/types";
import { ApiError } from "@/types";
import type { ScheduleRange } from "@/types/schedule-overview";

import { AlertBars } from "./alert-bars";
import {
  addSlot,
  deleteOff,
  deleteSlot,
  type Draft,
  type DraftOff,
  draftFrom,
  diffDraft,
  editSlot,
  type Key,
  moveSlot,
  setOff,
  weeksOfSlotChange,
} from "./draft";
import { HOW_TO_USE, HOW_TO_USE_APPROVER } from "./how-to";
import { ShiftDialog } from "./shift-dialog";
import { useRangeLocks } from "./use-range-locks";
import { addDaysYmd, md, WeekBlock } from "./week-block";

/*
 * G382 Settings › Human Resource › Schedule 总览（preview v3 https://claude.ai/artifact/B2WxdSVvzdQATs53tkzp7B ，
 * Annie 2026-11-26「preview v3 我同意了，动手」）。后端合同 task/g382-hr-schedule @ 77404fa0 interface.md 2.1 / 2.2。
 * - 连续几周（默认 4 = 上一周 + 本周 + 后两周，Q5 A），一周一块竖着排（N2）。
 * - 先选后存：拖班、加删班、录假、Fill gap 都只改页面草稿，页底一个 Save 管所有周（range/changes 一个事务）；离开 / 换周拦下问。
 * - 新违规拦下不能存（Q4 A）：「Can’t save: rule problems」只有 Back to edit；不拦的提醒灰字列在下面。
 * - can_edit=false（只能批假的人，N3 A）：整个总览照看，没有任何编辑键，只能点 Leave requests。
 * - 工具条照旧挂 Staff Schedule 搬过来的老功能（Auto-fill / Rules / Leave types / Employees / ⚙ Settings / Share with staff），
 *   接口和行为不变（fe 11-26 定「全挂」）。
 */

const WEEK_CHOICES = [2, 4, 6, 8] as const;
const BTN_SM = "inline-flex h-[26px] items-center px-2! py-0! text-[12px]!";
const BTN_XS = "inline-flex h-[24px] items-center px-2! py-0! text-[11.5px]!";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mdy = (ymd: string) => `${MON[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;

type Load =
  | { kind: "loading" }
  | { kind: "forbidden"; detail: string }
  | { kind: "error"; detail: string }
  | { kind: "ready"; range: ScheduleRange };

type Dialog =
  | { kind: "shift"; key?: Key; employeeId: number | null; date: string }
  | { kind: "leave"; employeeId: number; date: string; existing?: DraftOff }
  | { kind: "fill"; gap: ScheduleGap }
  | { kind: "leave-request"; request: OverviewLeaveRequest }
  | { kind: "change-request"; request: ConfirmRequest }
  | { kind: "rule-box"; blocking: ScheduleViolation[]; other: ScheduleViolation[] }
  | { kind: "ask-save"; then: () => void }
  | { kind: "publish"; week: string; allowGaps: boolean }
  | { kind: "send"; week: string }
  | { kind: "auto-fill" }
  | { kind: "rules" }
  | { kind: "leave-types" }
  | { kind: "employees" }
  | { kind: "settings" }
  | { kind: "share" }
  | null;

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; text: string };

const toSlot = (s: Draft["slots"][number]): ScheduleSlot => ({
  id: typeof s.key === "number" ? s.key : -Number(String(s.key).slice(1)) || -1,
  date: s.date,
  shift_type: s.shift_type,
  start_time: s.start_time,
  end_time: s.end_time,
  employee_id: s.employee_id,
  note: s.note,
  updated_by: null,
  updated_at: null,
});
const toOff = (t: DraftOff): ScheduleTimeOff => ({
  id: typeof t.key === "number" ? t.key : -1,
  employee_id: t.employee_id,
  date: t.date,
  kind: t.kind,
  kind_label: t.kind_label ?? null,
  start_time: t.start_time,
  end_time: t.end_time,
  note: t.note,
});

function isBlocking(v: ScheduleViolation): boolean {
  return (v as ScheduleViolation & { blocking?: boolean }).blocking !== false;
}

export function ScheduleOverview() {
  const today = laToday();
  const thisWeek = weekStartYmd(today);
  const [from, setFrom] = useState(() => addDaysYmd(thisWeek, -7));
  const [count, setCount] = useState<number>(4);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [settings, setSettings] = useState<ScheduleSettings | null>(null);
  const [categories, setCategories] = useState<LeaveCategory[]>(FALLBACK_LEAVE_CATEGORIES);
  const [base, setBase] = useState<Draft>({ slots: [], timeOff: [] });
  const [draft, setDraft] = useState<Draft>({ slots: [], timeOff: [] });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [banner, setBanner] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [notice, setNotice] = useState<PublishNotice | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [fullEmployees, setFullEmployees] = useState<ScheduleEmployee[] | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const pageVisibility = usePageVisibility();

  const redirectToLogin = useCallback(() => {
    if (typeof window !== "undefined")
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
  }, []);
  const locks = useRangeLocks(redirectToLogin);

  // ---- 读数据 ----
  useEffect(() => {
    const ac = new AbortController();
    setLoad((l) => (l.kind === "ready" ? l : { kind: "loading" }));
    fetchScheduleRange(from, count, ac.signal)
      .then((range) => {
        if (ac.signal.aborted) return;
        const d = draftFrom(range.slots, range.time_off);
        setBase(d);
        setDraft(d);
        setLoad({ kind: "ready", range });
      })
      .catch((error) => {
        if (ac.signal.aborted) return;
        if (isStatus(error, 401)) return redirectToLogin();
        if (isStatus(error, 403))
          return setLoad({ kind: "forbidden", detail: leaveErrorOf(error, "You don't have access to the schedule overview.").detail });
        setLoad({ kind: "error", detail: describeError(error) });
      });
    return () => ac.abort();
  }, [from, count, reload, redirectToLogin]);

  useEffect(() => {
    const ac = new AbortController();
    fetchScheduleSettings(ac.signal).then(setSettings).catch(() => {});
    fetchLeaveCategories({ signal: ac.signal })
      .then((c) => c.length && setCategories(c))
      .catch(() => {});
    fetchCurrentUser(ac.signal)
      .then((me) => setIsAdmin(me.is_admin === true || me.is_superadmin === true))
      .catch(() => {});
    return () => ac.abort();
  }, []);

  const range = load.kind === "ready" ? load.range : null;
  const canEdit = !!range?.can_edit;
  const diff = useMemo(() => diffDraft(base, draft), [base, draft]);
  const dirty = diff.ops.length > 0;
  const changedKeys = useMemo(() => {
    const out = new Set<Key>();
    const b = new Map(base.slots.map((s) => [s.key, s]));
    for (const s of draft.slots) if (JSON.stringify(b.get(s.key)) !== JSON.stringify(s)) out.add(s.key);
    const bo = new Map(base.timeOff.map((t) => [t.key, t]));
    for (const t of draft.timeOff) if (JSON.stringify(bo.get(t.key)) !== JSON.stringify(t)) out.add(t.key);
    return out;
  }, [base, draft]);

  const reloadRange = useCallback(() => setReload((n) => n + 1), []);

  // ---- 没存的改动：离开页面拦下（同 Staff Schedule 的 LeaveDialog 做法） ----
  const leaveAsk = useCallback(
    () =>
      new Promise<boolean>((resolve) =>
        setDialog({
          kind: "ask-save",
          then: () => resolve(true),
        }),
      ),
    [],
  );
  useLeaveGuard(dirty, "You have changes that are not saved. Leave without saving?", leaveAsk);

  /** 先存再做（换周、点请假 / 改班、Auto-fill 等会重读数据的动作）。 */
  const afterSave = (then: () => void) => {
    if (!dirty) return then();
    setDialog({ kind: "ask-save", then });
  };

  // ---- 改草稿 ----
  /**
   * Q-1 B（后端 86，interface.md §2.1）：range 只读、不建周；还没建的周（version=null）第一次改班前
   * 先 GET weeks/{w}——后端照上一周复制班（不带人）建成草稿、给 version。再把复制来的班并进 base 和草稿，
   * 用户的改动叠在上面。没权限的 GET 给 403，什么都不建。返回报错文字或 null。
   */
  const buildWeeks = async (weeks: string[]): Promise<string | null> => {
    if (!range) return null;
    const need = [...new Set(weeks)]
      .filter((w) => {
        const i = range.weeks_info.find((x) => x.week_start === w);
        return i && i.version == null;
      })
      .sort();
    if (!need.length) return null;
    let fresh: ScheduleRange;
    try {
      for (const w of need) await fetchScheduleWeek(w);
      fresh = await fetchScheduleRange(range.from, range.weeks);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return "Please sign in again.";
      }
      return leaveErrorText(error, describeError(error));
    }
    const built = new Set(need);
    const inBuilt = (x: { date: string }) => built.has(weekStartYmd(x.date));
    const copied = draftFrom(fresh.slots.filter(inBuilt), []).slots;
    // 按 id 去重：两次改动几乎同时到（range 还没刷新）时第二次 GET 拿到的是同一批班，不能并两遍。
    const ids = new Set(copied.map((s) => s.key));
    setBase((b) => ({
      ...b,
      slots: [...b.slots.filter((s) => !inBuilt(s) && !ids.has(s.key)), ...copied],
    }));
    setDraft((d) => ({ ...d, slots: [...d.slots.filter((s) => !ids.has(s.key)), ...copied] }));
    setLoad((l) =>
      l.kind !== "ready"
        ? l
        : {
            kind: "ready",
            range: {
              ...l.range,
              weeks_info: l.range.weeks_info.map(
                (i) =>
                  (built.has(i.week_start) &&
                    fresh.weeks_info.find((f) => f.week_start === i.week_start)) ||
                  i,
              ),
              slots: [...l.range.slots.filter((s) => !inBuilt(s)), ...fresh.slots.filter(inBuilt)],
              gaps: [...l.range.gaps.filter((g) => !inBuilt(g)), ...fresh.gaps.filter(inBuilt)],
            },
          },
    );
    if (copied.length)
      setBanner({
        tone: "ok",
        text: `Set up ${need.map((w) => `the week of ${mdy(w)}`).join(", ")} from the week before (shifts copied, no people). Your change is added on top. Press Save to keep it.`,
      });
    return null;
  };

  const edit = async (
    weeks: string[],
    change: (d: Draft) => Draft,
    opts?: { leaveOnly?: boolean },
  ) => {
    setEditError(null);
    if (!opts?.leaveOnly) {
      const err = await buildWeeks(weeks);
      if (err) return setEditError(err);
    }
    const r = await locks.ensure(weeks);
    if (!r.ok) return setEditError(r.detail);
    setDraft((d) => change(d));
    if (save.kind !== "saving") setSave({ kind: "idle" });
  };

  const weekInfo = (w: string) => range?.weeks_info.find((x) => x.week_start === w);
  /** 没建的周 ⇒ "draft"；不在这几周里 ⇒ null（请假框自己查）。 */
  const weekStatusOf = (date: string): "draft" | "published" | null => {
    const i = weekInfo(weekStartYmd(date));
    return i ? (i.status === "published" ? "published" : "draft") : null;
  };

  const dialogData = (useDraft: boolean): LeaveDialogData => ({
    employees: (range?.employees ?? []).map((e) => ({ ...e, email: "" }) as ScheduleEmployee),
    slots: useDraft ? draft.slots.map(toSlot) : (range?.slots ?? []),
    timeOff: useDraft ? draft.timeOff.map(toOff) : (range?.time_off ?? []),
    shiftTypes: settings?.shift_types ?? [],
    categories,
    weekStatusOf,
  });

  // ---- Save ----
  const doSave = async (): Promise<boolean> => {
    if (!range || !dirty) return true;
    setSave({ kind: "saving" });
    const r = await locks.ensure([...diff.slotWeeks]);
    if (!r.ok) {
      setSave({ kind: "error", text: r.detail });
      return false;
    }
    try {
      const res = await saveScheduleRange({
        weeks: [...diff.weeks].sort().map((w) => ({
          week_start: w,
          lock_token: diff.slotWeeks.has(w) ? locks.token(w) : null,
          base_version: weekInfo(w)?.version ?? null,
        })),
        ops: diff.ops,
      });
      for (const [w, out] of Object.entries(res.weeks ?? {})) locks.adopt(w, out.lock_token);
      locks.releaseAll();
      setSave({ kind: "saved" });
      reloadRange();
      return true;
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return false;
      }
      const e = leaveErrorOf(error, describeError(error));
      if (e.code === "rule_violation") {
        setSave({ kind: "error", text: "Not saved: your changes break a schedule rule." });
        setDialog({
          kind: "rule-box",
          blocking: e.violations ?? [],
          other: (range.violations ?? []).filter((v) => !isBlocking(v)),
        });
      } else {
        setSave({
          kind: "error",
          text:
            e.code === "stale"
              ? `${e.detail} Press Discard to load the latest, then make your change again.`
              : leaveErrorText(error, describeError(error)),
        });
      }
      return false;
    }
  };

  const discard = () => {
    setDraft(base);
    locks.releaseAll();
    setSave({ kind: "idle" });
    setEditError(null);
    reloadRange();
  };

  // ---- 发布 ----
  const doPublish = async (week: string, allowGaps: boolean): Promise<ActionResult> => {
    try {
      const result = await publishScheduleWeek(week, { allowGaps });
      setNotice(publishNotice(result));
      setDialog(null);
      reloadRange();
      return { status: "ok" };
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      if (isStatus(error, 400) && error instanceof ApiError) {
        const inner = (error.body as { detail?: unknown } | null)?.detail;
        if (inner && typeof inner === "object") {
          const b = inner as { detail?: string; gaps?: ScheduleGap[] };
          const lines = (b.gaps ?? []).map((g) => `${dayLabel(g.date)} ${clockRange(g.start_time, g.end_time)}`);
          return {
            status: "error",
            message: [b.detail ?? describeError(error), ...lines.map((l) => `• ${l}`)].join("\n"),
          };
        }
      }
      return { status: "error", message: describeError(error) };
    }
  };

  // ---- 老功能要的完整员工名单 / 规则（打开时才读） ----
  const needEmployees = async () => {
    if (fullEmployees) return fullEmployees;
    const list = await fetchScheduleEmployees();
    setFullEmployees(list);
    return list;
  };
  const needRules = async () => {
    if (rules) return rules;
    const doc = await fetchScheduleRules();
    setRules(doc.rules);
    return doc.rules;
  };
  const openWith = async (kind: "auto-fill" | "rules" | "employees" | "settings") => {
    setMoreOpen(false);
    try {
      await needEmployees();
      if (kind !== "employees") await needRules().catch(() => setRules([]));
      setDialog({ kind });
    } catch (error) {
      if (isStatus(error, 401)) return redirectToLogin();
      setEditError(describeError(error));
    }
  };

  // ---- 画 ----
  if (load.kind === "loading")
    return <div className="p-4 text-[13px] text-white/70">Loading the schedule…</div>;
  if (load.kind === "forbidden")
    return (
      <section className={cn(HR_CARD_CLASS, "p-4 text-[13px]")} data-schedule-overview-forbidden>
        {load.detail}
      </section>
    );
  if (load.kind === "error")
    return (
      <section className={cn(HR_CARD_CLASS, "p-4 text-[13px] text-[#b91c1c]")} role="alert">
        Could not load the schedule: {load.detail}{" "}
        <button type="button" className="cursor-pointer underline" onClick={reloadRange}>
          Try again
        </button>
      </section>
    );

  const r = load.range;
  const weeks = Array.from({ length: r.weeks }, (_, i) => addDaysYmd(r.from, i * 7));
  const end = addDaysYmd(r.from, r.weeks * 7 - 1);
  const pending = r.leave_requests.filter((x) => x.status === "pending");
  const changeRequests = r.change_requests
    .flatMap((c) => c.requests ?? [])
    .filter((x) => x.status === "pending" || x.status === "awaiting_peer");
  const shiftTypes = settings?.shift_types ?? [];
  const canPublish = r.can_publish;
  const showShare = canPublish && pageVisibility.visible("schedule_period");
  const nameOf = (id: number | null) => (id == null ? null : (r.employees.find((e) => e.id === id)?.name ?? null));
  const unsavedN = diff.ops.length;
  const autoStart = r.from < thisWeek ? thisWeek : r.from;
  const autoWeeks = Math.max(1, Math.round((Date.parse(end) - Date.parse(autoStart)) / 864e5 / 7 + 1 / 7));

  const go = (nextFrom: string, nextCount = count) =>
    afterSave(() => {
      setFrom(nextFrom);
      setCount(nextCount);
    });

  const secondary = canEdit ? (
    <>
      <button type="button" className={cn(HR_BTN_CLASS, BTN_SM)} data-ov-edit onClick={() => void openWith("rules")}>
        Rules
      </button>
      {r.can_manage_leave_types ? (
        <button type="button" className={cn(HR_BTN_CLASS, BTN_SM)} data-ov-edit onClick={() => { setMoreOpen(false); setDialog({ kind: "leave-types" }); }}>
          Leave types
        </button>
      ) : null}
      <button type="button" className={cn(HR_BTN_CLASS, BTN_SM)} data-ov-edit onClick={() => void openWith("employees")}>
        Employees
      </button>
      <button type="button" className={cn(HR_BTN_CLASS, BTN_SM)} data-ov-edit onClick={() => void openWith("settings")}>
        ⚙ Settings
      </button>
      {showShare ? (
        <button type="button" className={cn(HR_BTN_CLASS, BTN_SM)} data-ov-edit onClick={() => afterSave(() => { setMoreOpen(false); setDialog({ kind: "share" }); })}>
          Share with staff
        </button>
      ) : null}
    </>
  ) : null;

  return (
    <div data-schedule-overview="" data-can-edit={canEdit ? "1" : "0"}>
      {banner ? (
        <div
          role="status"
          data-ov-banner
          className={cn(
            "mb-3 flex items-start justify-between gap-2 rounded-[10px] border px-3.5 py-2 text-[13px] whitespace-pre-line",
            banner.tone === "error"
              ? "border-red-400/40 bg-red-500/10 text-red-200"
              : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
          )}
        >
          <span>{banner.text}</span>
          <button type="button" aria-label="Dismiss" className="cursor-pointer" onClick={() => setBanner(null)}>
            ✕
          </button>
        </div>
      ) : null}

      {notice ? (
        <div role="status" data-ov-publish-notice className="mb-3 flex items-start justify-between gap-2 rounded-[10px] border border-white/15 bg-white/[.04] px-3.5 py-2 text-[13px]">
          <span className="grid gap-0.5">
            {notice.ok ? <span className="text-emerald-300">{notice.ok}</span> : null}
            {notice.unreached ? <span className="text-red-300">{notice.unreached}</span> : null}
            {notice.noContact ? <span className="text-white/60">{notice.noContact}</span> : null}
          </span>
          <button type="button" aria-label="Dismiss" className="cursor-pointer text-white/70" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      ) : null}

      <section className={HR_CARD_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-x-2.5 gap-y-2 border-b-[0.5px] border-black/[.08] px-3.5 py-2.5 max-sm:px-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-label="Earlier" className={cn(HR_BTN_CLASS, BTN_SM)} onClick={() => go(addDaysYmd(from, -7))}>
              ‹
            </button>
            <span className="text-[13px] font-bold" data-ov-range>
              {mdy(r.from)} – {mdy(end)}, {end.slice(0, 4)}
            </span>
            <button type="button" aria-label="Later" className={cn(HR_BTN_CLASS, BTN_SM)} onClick={() => go(addDaysYmd(from, 7))}>
              ›
            </button>
            <button type="button" className={cn(HR_BTN_CLASS, BTN_SM, "max-sm:hidden")} onClick={() => go(addDaysYmd(thisWeek, -7))}>
              Today
            </button>
            <span className="inline-flex overflow-hidden rounded-[7px] border border-black/20" role="group" aria-label="Weeks shown">
              {WEEK_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={count === n}
                  data-ov-weeks={n}
                  onClick={() => go(from, n)}
                  className={cn(
                    "cursor-pointer border-l border-black/10 px-2.5 py-1 text-[12px] font-semibold first:border-l-0",
                    count === n ? "bg-[#f1f1ef] shadow-[inset_0_-2px_0_#1a1a1a]" : "bg-white",
                  )}
                >
                  {n}
                </button>
              ))}
            </span>
            <span className="text-[12px] text-[#475569] max-sm:hidden">weeks</span>
          </div>
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-ov-edit
                data-ov-autofill
                className={cn(HR_BTN_CLASS, BTN_SM)}
                onClick={() => (dirty ? setEditError("Save or discard your changes first, then use Auto-fill.") : void openWith("auto-fill"))}
              >
                Auto-fill
              </button>
              <div className="contents max-sm:hidden">{secondary}</div>
              <div className="relative sm:hidden">
                <button
                  type="button"
                  aria-label="More actions"
                  aria-expanded={moreOpen}
                  data-phone-more
                  className={cn(HR_BTN_CLASS, BTN_SM, "font-bold tracking-[.1em]")}
                  onClick={() => setMoreOpen((v) => !v)}
                >
                  ⋯
                </button>
                {moreOpen ? (
                  <div className="absolute right-0 z-40 mt-1 flex min-w-[180px] flex-col items-stretch gap-1.5 rounded-[10px] border border-black/15 bg-white p-2 shadow-[0_12px_32px_rgba(0,0,0,.25)]">
                    {secondary}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <span className="text-[12px] text-[#475569]" data-ov-view-only>
              View only · you can approve leave for your team
            </span>
          )}
        </div>

        <AlertBars
          canEdit={canEdit}
          leaveRequests={pending}
          gaps={r.gaps}
          violations={r.violations}
          changeRequests={changeRequests}
          shiftTypes={shiftTypes}
          isDraftWeek={(d) => weekStatusOf(d) !== "published"}
          onLeave={(request) => afterSave(() => setDialog({ kind: "leave-request", request }))}
          onGap={(gap) => setDialog({ kind: "fill", gap })}
          onRule={(v) => {
            const id = v.slot_ids?.[0];
            const el = id != null ? document.querySelector(`[data-ov-shift="${id}"]`) : null;
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          onChangeRequest={(request) => afterSave(() => setDialog({ kind: "change-request", request }))}
        />

        {editError ? (
          <div role="alert" data-ov-edit-error className="mx-3.5 mb-2 rounded-[7px] border border-[#f87171] bg-[#fef2f2] px-2.5 py-[7px] text-[12.5px] text-[#991b1b]">
            {editError}
          </div>
        ) : null}

        <div className="grid gap-3 px-3.5 pb-3 max-sm:px-2">
          {weeks.map((w) => {
            const info = weekInfo(w);
            const published = info?.status === "published";
            return (
              <WeekBlock
                key={w}
                week={w}
                info={info}
                today={today}
                employees={r.employees}
                slots={draft.slots}
                timeOff={draft.timeOff}
                gaps={r.gaps}
                violations={r.violations.filter(isBlocking)}
                pending={pending}
                shiftTypes={shiftTypes}
                categories={categories}
                canEdit={canEdit}
                changedKeys={changedKeys}
                actions={
                  canEdit ? (
                    <>
                      {published ? (
                        <button type="button" data-ov-edit data-ov-send={w} className={cn(HR_BTN_CLASS, BTN_XS)} onClick={() => afterSave(() => setDialog({ kind: "send", week: w }))}>
                          Send to confirm
                        </button>
                      ) : null}
                      {canPublish ? (
                        <button
                          type="button"
                          data-ov-edit
                          data-ov-publish={w}
                          className={cn(published ? HR_BTN_CLASS : BTN_BLUE, BTN_XS)}
                          onClick={() => afterSave(() => setDialog({ kind: "publish", week: w, allowGaps: false }))}
                        >
                          {published ? "Publish again" : "Publish"}
                        </button>
                      ) : null}
                    </>
                  ) : null
                }
                onMove={(key, emp, date) => {
                  const s = draft.slots.find((x) => x.key === key);
                  if (!s || (s.employee_id === emp && s.date === date)) return;
                  void edit(weeksOfSlotChange(draft, key, date), (d) => moveSlot(d, key, emp, date));
                }}
                onShift={(key) => {
                  const s = draft.slots.find((x) => x.key === key);
                  if (s) setDialog({ kind: "shift", key, employeeId: s.employee_id, date: s.date });
                }}
                onCell={(employeeId, date) => setDialog({ kind: "shift", employeeId, date })}
                onLeave={(off) => setDialog({ kind: "leave", employeeId: off.employee_id, date: off.date, existing: off })}
                onPending={(request) => afterSave(() => setDialog({ kind: "leave-request", request }))}
                onFill={(gap) => setDialog({ kind: "fill", gap })}
              />
            );
          })}
        </div>

        <Legend />

        {canEdit ? (
          <div className="flex flex-wrap items-center justify-end gap-2.5 border-t-[0.5px] border-black/[.08] px-3.5 py-2.5">
            {save.kind === "saving" ? (
              <span className="text-[12px] text-[#475569]">Saving…</span>
            ) : save.kind === "saved" && !dirty ? (
              <span className="text-[12px] font-semibold text-[#15803d]" data-ov-saved>
                Saved
              </span>
            ) : save.kind === "error" ? (
              <span role="alert" className="text-[12px] font-semibold whitespace-pre-line text-[#b91c1c]" data-ov-save-error>
                {save.text}
              </span>
            ) : null}
            {dirty ? (
              <span className="text-[12px] font-semibold text-[#b91c1c]" data-ov-unsaved>
                Not saved yet · {unsavedN} {unsavedN === 1 ? "change" : "changes"}
              </span>
            ) : null}
            <button type="button" className={cn(HR_BTN_CLASS, BTN_SM)} disabled={!dirty || save.kind === "saving"} onClick={discard} data-ov-discard>
              Discard
            </button>
            <button
              type="button"
              className={cn(BTN_BLUE, BTN_SM)}
              disabled={!dirty || save.kind === "saving"}
              onClick={() => void doSave()}
              data-ov-save
            >
              Save
            </button>
          </div>
        ) : null}
      </section>

      <details className={HR_CARD_CLASS} data-how-to-use>
        <summary className="cursor-pointer px-3.5 py-2.5 text-[13px] font-semibold">How to use</summary>
        <ul className="list-disc px-8 pb-3 text-[12.5px]">
          {(canEdit ? HOW_TO_USE : HOW_TO_USE_APPROVER).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </details>

      {renderDialog()}
    </div>
  );

  function renderDialog() {
    if (!dialog || !range) return null;
    const close = () => setDialog(null);
    switch (dialog.kind) {
      case "shift": {
        const s = dialog.key != null ? draft.slots.find((x) => x.key === dialog.key) : null;
        const w = weekStartYmd(dialog.date);
        return (
          <ShiftDialog
            slot={s}
            date={dialog.date}
            personName={nameOf(dialog.employeeId)}
            shiftTypes={shiftTypes}
            onClose={close}
            onApply={(v) => {
              close();
              if (s) void edit([w], (d) => editSlot(d, s.key, v));
              else void edit([w], (d) => addSlot(d, { ...v, date: dialog.date, employee_id: dialog.employeeId }));
            }}
            onDelete={s ? () => { close(); void edit([w], (d) => deleteSlot(d, s.key)); } : undefined}
            onAddLeave={
              dialog.employeeId != null && !s
                ? () => setDialog({ kind: "leave", employeeId: dialog.employeeId!, date: dialog.date })
                : undefined
            }
          />
        );
      }
      case "leave": {
        const ex = dialog.existing;
        return (
          <AddLeaveDialog
            data={dialogData(true)}
            employeeId={dialog.employeeId}
            date={dialog.date}
            existing={ex ? toOff(ex) : null}
            mode="stage"
            onClose={close}
            onSubmit={(entry) => {
              close();
              void edit([weekStartYmd(entry.date)], (d) => setOff(d, { ...entry, kind_label: null }), {
                leaveOnly: true,
              });
              return null;
            }}
            onDelete={
              ex
                ? async () => {
                    close();
                    await edit([weekStartYmd(ex.date)], (d) => deleteOff(d, ex.key), {
                      leaveOnly: true,
                    });
                    return null;
                  }
                : undefined
            }
          />
        );
      }
      case "fill":
        return (
          <FillGapDialog
            data={dialogData(true)}
            gap={dialog.gap}
            onClose={close}
            onStage={(op) => {
              close();
              void edit([weekStartYmd(op.date)], (d) =>
                addSlot(d, {
                  date: op.date,
                  shift_type: op.shift_type,
                  start_time: op.start_time,
                  end_time: op.end_time,
                  employee_id: op.employee_id,
                  note: op.note,
                }),
              );
            }}
          />
        );
      case "leave-request":
        return (
          <LeaveRequestDialog
            data={dialogData(false)}
            request={dialog.request}
            onClose={close}
            onDone={(result) => {
              close();
              setBanner({ tone: "ok", text: result === "approved" ? "Leave approved." : "Leave rejected." });
              reloadRange();
            }}
          />
        );
      case "change-request":
        return (
          <ShiftChangeRequestDialog
            data={dialogData(false)}
            request={dialog.request}
            onClose={close}
            onDone={(result) => {
              close();
              setBanner({ tone: "ok", text: result === "approved" ? "Request approved." : "Request declined." });
              reloadRange();
            }}
          />
        );
      case "rule-box":
        return <RuleBox blocking={dialog.blocking} other={dialog.other} onClose={close} />;
      case "ask-save":
        return (
          <AskSave
            count={unsavedN}
            onCancel={close}
            onDiscard={() => {
              setDraft(base);
              locks.releaseAll();
              setSave({ kind: "idle" });
              const then = dialog.then;
              close();
              then();
            }}
            onSave={async () => {
              const then = dialog.then;
              const ok = await doSave();
              if (ok) {
                close();
                then();
              } else close();
            }}
          />
        );
      case "publish": {
        const published = weekInfo(dialog.week)?.status === "published";
        const weekGaps = range.gaps.filter((g) => weekStartYmd(g.date) === dialog.week);
        return (
          <ConfirmDialog
            title={`${published ? "Publish again" : "Publish"} the week of ${md(dialog.week)}?`}
            confirmLabel={`${published ? "Publish again" : "Publish"}${weekGaps.length && isAdmin ? " anyway" : ""}`}
            busyLabel="Publishing…"
            submit
            onClose={close}
            onConfirm={() => doPublish(dialog.week, weekGaps.length > 0 && isAdmin)}
          >
            {weekGaps.length ? (
              <div data-publish-gaps>
                <p>Nobody is scheduled on this part of the week:</p>
                <ul className="mt-1 list-disc pl-5 text-red-300">
                  {weekGaps.map((g, i) => (
                    <li key={i}>
                      <b>{dayLabel(g.date)}</b> · {clockRange(g.start_time, g.end_time)}
                    </li>
                  ))}
                </ul>
                {!isAdmin ? <p className="mt-1">Fill the gaps first. Only an admin can publish with a gap.</p> : null}
              </div>
            ) : null}
            <p>
              {published
                ? "People whose shifts or time off changed since the last publish will get a system notification and an email. People who can edit the schedule (except you) get a notice listing the changes. No one else is notified. This can't be undone."
                : "Everyone scheduled this week will get a system notification and an email. This can't be undone."}
            </p>
          </ConfirmDialog>
        );
      }
      case "send":
        return <SendPanel week={dialog.week} employees={range.employees} onClose={close} onUnauthorized={redirectToLogin} />;
      case "auto-fill":
        return settings && fullEmployees ? (
          <AutoFillDialog
            weekStart={autoStart}
            rules={(rules ?? []).filter((x) => x.enabled)}
            employees={fullEmployees}
            settings={settings}
            period={{
              start: autoStart,
              weeks: autoWeeks,
              ctx: { employees: fullEmployees, shiftTypes },
            }}
            onClose={close}
            onDone={(message) => {
              close();
              setBanner({ tone: "ok", text: message });
              reloadRange();
            }}
          />
        ) : null;
      case "rules":
        return fullEmployees && rules ? (
          <Modal titleId="ov-rules" night onDismiss={close} panelClassName="max-h-[92vh] w-full max-w-[980px] overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="ov-rules" className="text-[15px] font-bold text-white">
                Rules
              </h2>
              <button type="button" aria-label="Close" className="cursor-pointer text-white/70" onClick={close}>
                ✕
              </button>
            </div>
            <RulesView
              rules={rules}
              ctx={{ employees: fullEmployees, shiftTypes }}
              canEdit={canEdit}
              onSave={async (next) => {
                const saved = await saveScheduleRules(next);
                setRules(saved.rules);
                reloadRange();
                return saved.rules;
              }}
            />
          </Modal>
        ) : null;
      case "leave-types":
        return (
          <LeaveTypesDialog
            categories={categories}
            onClose={close}
            onSaved={(next) => setCategories(next)}
          />
        );
      case "employees":
        return fullEmployees ? (
          <EmployeesDialog
            employees={fullEmployees}
            onClose={() => {
              close();
              reloadRange();
            }}
            onAdd={async (input) => {
              try {
                const created = await addScheduleEmployee(input);
                setFullEmployees((prev) => [...(prev ?? []), created]);
                return { status: "ok" };
              } catch (error) {
                if (isStatus(error, 401)) {
                  redirectToLogin();
                  return { status: "redirecting" };
                }
                return { status: "error", message: describeError(error) };
              }
            }}
            onUpdate={async (id, input) => {
              try {
                const updated = await updateScheduleEmployee(id, input);
                setFullEmployees((prev) => (prev ?? []).map((e) => (e.id === id ? updated : e)));
                return { status: "ok" };
              } catch (error) {
                if (isStatus(error, 401)) {
                  redirectToLogin();
                  return { status: "redirecting" };
                }
                return { status: "error", message: describeError(error) };
              }
            }}
          />
        ) : null;
      case "settings":
        return settings ? (
          <ScheduleSettingsDialog
            settings={settings}
            canChange={r.can_manage_leave_types}
            rules={rules}
            ruleCtx={{ employees: fullEmployees ?? [], shiftTypes }}
            onSaved={(next) => {
              setSettings(next);
              reloadRange();
            }}
            onClose={close}
          />
        ) : null;
      case "share":
        return (
          <SharePeriodDialog
            start={autoStart}
            weeks={autoWeeks}
            onClose={close}
            onUnauthorized={redirectToLogin}
          />
        );
    }
  }
}

function Legend() {
  const sw = (cls: string) => <i className={cn("inline-block h-3 w-3.5 rounded-[3px] border", cls)} />;
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 border-t-[0.5px] border-black/[.06] px-3.5 py-2 text-[11.5px] text-[#475569] max-sm:hidden">
      <span className="inline-flex items-center gap-1">{sw("border-yellow-600/40 bg-yellow-100")}Off</span>
      <span className="inline-flex items-center gap-1">{sw("border-yellow-600/60 bg-amber-200")}Leave (all day / hours)</span>
      <span className="inline-flex items-center gap-1">{sw("border-dashed border-amber-600 bg-amber-50")}Leave waiting for approval</span>
      <span className="inline-flex items-center gap-1">{sw("border-orange-600 bg-white outline-2 outline-orange-600")}Rule problem</span>
      <span className="inline-flex items-center gap-1">{sw("border-red-400 bg-red-100")}Gap</span>
      <span className="inline-flex items-center gap-1">{sw("border-dashed border-slate-500 bg-white")}Changed, not saved yet</span>
    </div>
  );
}

/** Q4 A：这次改动造成新的违规 ⇒ 不能存，只有 Back to edit（preview v3 第 2 节「Can’t save: rule problems」）。 */
function RuleBox({
  blocking,
  other,
  onClose,
}: {
  blocking: ScheduleViolation[];
  other: ScheduleViolation[];
  onClose: () => void;
}) {
  return (
    <LeaveDialogShell
      titleId="ov-rule-box"
      title="Can’t save: rule problems"
      onClose={onClose}
      footer={
        <button type="button" className={BTN_PLAIN} onClick={onClose}>
          Back to edit
        </button>
      }
    >
      <div data-ov-rule-problems className="grid gap-2">
        <span className="sr-only">Can’t save: rule problems</span>
        <div>Your changes break these rules:</div>
        <ul className="list-disc pl-[18px] text-[12.5px]">
          {blocking.map((v, i) => (
            <li key={i}>{v.message}</li>
          ))}
        </ul>
        <div className="text-[12.5px] text-[#475569]">
          Change these shifts, then press Save again. Nothing was saved. Problems that were already saved don&apos;t stop
          you saving other changes.
        </div>
        {other.length ? (
          <div className="text-[12px] text-[#475569]">
            Not blocking (shown under Rule problems only):{" "}
            {other.map((v) => v.message).join(" ")}
          </div>
        ) : null}
      </div>
    </LeaveDialogShell>
  );
}

/** 有没存的改动时要换周 / 点请假 / 发布 / 离开页面：先问要不要存。 */
function AskSave({
  count,
  onSave,
  onDiscard,
  onCancel,
}: {
  count: number;
  onSave: () => Promise<void>;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <LeaveDialogShell
      titleId="ov-ask-save"
      title="Save your changes first?"
      onClose={onCancel}
      busy={busy}
      footer={
        <>
          <button type="button" className={BTN_PLAIN} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={BTN_PLAIN} disabled={busy} onClick={onDiscard} data-ov-ask-discard>
            Don&apos;t save
          </button>
          <button
            type="button"
            className={BTN_BLUE}
            disabled={busy}
            data-ov-ask-save-btn
            onClick={async () => {
              setBusy(true);
              await onSave();
              setBusy(false);
            }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div data-ov-ask-save className="text-[13px]">
        You have {count} unsaved {count === 1 ? "change" : "changes"} on the schedule. Save them before you go on?
      </div>
    </LeaveDialogShell>
  );
}

/** 已发布的周：把改过的班单独发给本人确认（Staff Schedule 搬过来的 Send to confirm，接口不变）。 */
function SendPanel({
  week,
  employees,
  onClose,
  onUnauthorized,
}: {
  week: string;
  employees: { id: number; name: string }[];
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [data, setData] = useState<ScheduleWeek | null>(null);
  const [full, setFull] = useState<ScheduleEmployee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<number | null>(null);
  const [n, setN] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    Promise.all([fetchScheduleWeek(week), fetchScheduleEmployees()])
      .then(([w, list]) => {
        if (!mounted.current) return;
        setData(w);
        setFull(list);
      })
      .catch((e) => {
        if (isStatus(e, 401)) return onUnauthorized();
        if (mounted.current) setError(describeError(e));
      });
    return () => {
      mounted.current = false;
    };
  }, [week, n, onUnauthorized]);
  const changes = data?.pending_changes ?? [];
  const sendingEmp = full.find((e) => e.id === sending);
  const sendingChange = changes.find((c) => c.employee_id === sending);
  if (sendingEmp && sendingChange)
    return (
      <SendChangesDialog
        weekStart={week}
        weekLabel={`${md(week)} – ${md(addDaysYmd(week, 6))}, ${week.slice(0, 4)}`}
        employee={sendingEmp}
        change={sendingChange}
        onClose={() => setSending(null)}
        onSent={() => setN((x) => x + 1)}
        onUnauthorized={onUnauthorized}
      />
    );
  return (
    <LeaveDialogShell
      titleId="ov-send"
      title={`Send to confirm · week of ${md(week)}`}
      onClose={onClose}
      footer={
        <button type="button" className={BTN_PLAIN} onClick={onClose}>
          Close
        </button>
      }
    >
      {error ? <div role="alert" className="text-[#b91c1c]">{error}</div> : null}
      {!data && !error ? <div className="text-[#475569]">Loading…</div> : null}
      {data && !changes.length ? (
        <div data-ov-send-none>No changes to send. Everyone has the latest schedule for this week.</div>
      ) : null}
      {changes.length ? (
        <ul className="grid gap-1.5" data-ov-send-list>
          {changes.map((c) => (
            <li key={c.employee_id} className="flex items-center justify-between gap-2">
              <span>{employees.find((e) => e.id === c.employee_id)?.name ?? `#${c.employee_id}`}</span>
              <button type="button" className={BTN_BLUE} onClick={() => setSending(c.employee_id)}>
                Send…
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </LeaveDialogShell>
  );
}
