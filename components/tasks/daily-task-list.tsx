"use client";

import { Fragment, useEffect, useId, useState } from "react";

import { HowToUse } from "@/components/ui/how-to-use";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  createTaskTemplate,
  fetchTaskTemplates,
  updateTaskTemplate,
  type TaskTemplateInput,
} from "@/lib/tasks-api";
import { cn } from "@/lib/utils";
import type { TaskFrequency, TaskPriority, TaskTemplate } from "@/types";

import { formatHHMM, PRIORITY_DOT_CLASS } from "./config";
import { SelectMenu } from "@/components/ui/select-menu";

/**
 * Daily task list（前端 139 = 后端 G269，Annie 2026-11-14「B, A, A, A 动手」，preview ②
 * https://claude.ai/artifact/3aVYWfWYk4RgntEaBjovTh）：Today's tasks 标题行右边的键，点开是这个窗口，
 * 列出每天固定生成的任务（/api/tasks/templates，只有 Supervisor / Admin = tasks.manage）。
 * 改动从明天的列表起生效（每天 23:59 Pacific 生成明天的）。后端没有删除，只能取消 Active 停用：灰色、标 OFF。
 * 规矩：表单里改了先暂存，按蓝色 Save 才存；有没存的改动时关窗口 / 换一条要先问。
 */

const PRIORITY_TEXT: Record<TaskPriority, string> = {
  high: "High",
  moderate: "Moderate",
  low: "Low",
};

const FREQUENCY_TEXT: Record<TaskFrequency, string> = {
  daily: "Every day",
  hourly: "Every hour",
  every_n_days: "Every few days",
  when_free: "When free",
};

/** 「Opens page」下拉的固定选项；已有模板里别的链接也会补进来（不丢现有的值）。 */
const DEFAULT_LINKS: { href: string; label: string }[] = [
  { href: "/dispatch", label: "Dispatch" },
  { href: "/tour-confirmation/tracking", label: "Tour Tracking" },
  { href: "/manifests", label: "Manifests" },
  { href: "/orders", label: "Orders" },
];

const DISCARD_MESSAGE = "You have unsaved changes. Discard them?";

function oftenText(t: TaskTemplate): string {
  if (t.frequency === "every_n_days") {
    const n = t.frequency_every_n_days ?? 0;
    return n === 1 ? "Every day" : `Every ${n} days`;
  }
  return FREQUENCY_TEXT[t.frequency];
}

/** "8:00 – 10:00 AM"；跨上下午写全 "11:00 AM – 1:00 PM"；没有时间段写 All shift。 */
export function windowText(start: string | null, end: string | null): string {
  if (!start && !end) return "All shift";
  if (!start || !end) return formatHHMM((start ?? end) as string);
  const a = formatHHMM(start);
  const b = formatHHMM(end);
  const sameHalf = a.slice(-2) === b.slice(-2);
  return `${sameHalf ? a.slice(0, -3) : a} – ${b}`;
}

interface Draft {
  title: string;
  priority: TaskPriority;
  frequency: TaskFrequency;
  everyN: string;
  from: string;
  to: string;
  timeLimit: string;
  link: string;
  note: string;
  active: boolean;
}

const EMPTY_DRAFT: Draft = {
  title: "",
  priority: "moderate",
  frequency: "daily",
  everyN: "",
  from: "",
  to: "",
  timeLimit: "",
  link: "",
  note: "",
  active: true,
};

function draftOf(t: TaskTemplate): Draft {
  return {
    title: t.title,
    priority: t.priority,
    frequency: t.frequency,
    everyN:
      t.frequency_every_n_days != null ? String(t.frequency_every_n_days) : "",
    from: t.window_start_time ?? "",
    to: t.window_end_time ?? "",
    timeLimit: t.time_limit_minutes != null ? String(t.time_limit_minutes) : "",
    link: t.link_href ?? "",
    note: t.duty_note ?? "",
    active: t.is_active,
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (Object.keys(a) as (keyof Draft)[]).every((k) => a[k] === b[k]);
}

/** 前端先挡的几条（后端也会挡，原话照显示）；通过时返回 null。 */
function checkDraft(d: Draft): string | null {
  if (!d.title.trim()) return "Write the task first.";
  if (d.frequency === "every_n_days") {
    const n = Number(d.everyN);
    if (!Number.isInteger(n) || n < 1)
      return "Every … days needs a whole number.";
  }
  if (d.frequency === "hourly" && (!d.from || !d.to))
    return "Every hour needs a From and To.";
  if (!!d.from !== !!d.to)
    return "Fill in both From and To, or leave both empty for the whole shift.";
  if (d.from && d.to && d.to < d.from) return "To can’t be before From.";
  if (d.timeLimit) {
    const n = Number(d.timeLimit);
    if (!Number.isInteger(n) || n < 1)
      return "Time limit must be a whole number of minutes.";
  }
  return null;
}

function inputOf(
  d: Draft,
  links: { href: string; label: string }[],
): Omit<TaskTemplateInput, "is_active" | "sort_order"> {
  const link = links.find((l) => l.href === d.link);
  return {
    title: d.title.trim(),
    priority: d.priority,
    frequency: d.frequency,
    frequency_every_n_days:
      d.frequency === "every_n_days" ? Number(d.everyN) : null,
    window_start_time: d.from || null,
    window_end_time: d.to || null,
    time_limit_minutes: d.timeLimit ? Number(d.timeLimit) : null,
    link_href: link ? link.href : null,
    link_label: link ? link.label : null,
    duty_note: d.note.trim() || null,
  };
}

/** 标题行右边的键（preview ① 虚线框那个）。 */
export function DailyTaskListButton({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-daily-task-list-open
        onClick={() => setOpen(true)}
        className="rounded-lg border border-white/20 bg-transparent px-[11px] py-1 text-[12.5px] font-semibold text-white hover:border-white/40"
      >
        Daily task list
      </button>
      {open ? (
        <DailyTaskListDialog
          onClose={() => setOpen(false)}
          onUnauthorized={onUnauthorized}
        />
      ) : null}
    </>
  );
}

type Editing = { kind: "new" } | { kind: "edit"; id: number } | null;

function DailyTaskListDialog({
  onClose,
  onUnauthorized,
}: {
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const titleId = useId();
  const [templates, setTemplates] = useState<TaskTemplate[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [base, setBase] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchTaskTemplates(ctrl.signal)
      .then(setTemplates)
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        if (isStatus(err, 401)) onUnauthorized();
        else setLoadError(describeError(err));
      });
    return () => ctrl.abort();
  }, [onUnauthorized]);

  const dirty = editing !== null && !sameDraft(draft, base);

  // 没存的改动：关标签 / 刷新时浏览器问一句（窗口里的 Close / 换一条在下面 confirm）。
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function canLeave(): boolean {
    return !dirty || window.confirm(DISCARD_MESSAGE);
  }

  function dismiss() {
    if (busy || !canLeave()) return;
    onClose();
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  function startEdit(next: Editing, d: Draft) {
    if (busy || !canLeave()) return;
    setEditing(next);
    setDraft(d);
    setBase(d);
    setError("");
    setSaved(false);
  }

  function cancel() {
    if (busy) return;
    setEditing(null);
    setError("");
    setSaved(false);
  }

  const links = (() => {
    const all = [...DEFAULT_LINKS];
    for (const t of templates ?? []) {
      if (t.link_href && !all.some((l) => l.href === t.link_href))
        all.push({ href: t.link_href, label: t.link_label || t.link_href });
    }
    return all;
  })();

  async function save() {
    if (!editing || busy) return;
    const problem = checkDraft(draft);
    if (problem) {
      setError(problem);
      setSaved(false);
      return;
    }
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const input = inputOf(draft, links);
      let result: TaskTemplate;
      if (editing.kind === "new") {
        const last = Math.max(0, ...(templates ?? []).map((t) => t.sort_order));
        // 后端 POST 不认 is_active（新加的一律启用），带上只为凑类型。
        result = await createTaskTemplate({
          ...input,
          is_active: true,
          sort_order: last + 1,
        });
        // 新加的默认启用；表单里取消了 Active 的话再停用一次。
        if (!draft.active)
          result = await updateTaskTemplate(result.id, { is_active: false });
        setTemplates((prev) => [...(prev ?? []), result]);
      } else {
        const current = templates?.find((t) => t.id === editing.id);
        const full: Partial<TaskTemplateInput> = {
          ...input,
          is_active: draft.active,
        };
        // 只发改了的字段（后端按字段记 action log）。
        const changes: Partial<TaskTemplateInput> = {};
        for (const [k, v] of Object.entries(full) as [
          keyof TaskTemplateInput,
          unknown,
        ][]) {
          if (!current || current[k] !== v)
            (changes as Record<string, unknown>)[k] = v;
        }
        result = await updateTaskTemplate(editing.id, changes);
        setTemplates((prev) =>
          (prev ?? []).map((t) => (t.id === result.id ? result : t)),
        );
      }
      const d = draftOf(result);
      setEditing({ kind: "edit", id: result.id });
      setDraft(d);
      setBase(d);
      setSaved(true);
    } catch (err) {
      if (isStatus(err, 401)) onUnauthorized();
      // 后端 400 原话红字，表单内容留着。
      else setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <TemplateForm
      heading={
        editing?.kind === "new"
          ? "New task"
          : `Edit · ${base.title || draft.title}`
      }
      draft={draft}
      onChange={(d) => {
        setDraft(d);
        setSaved(false);
      }}
      links={links}
      busy={busy}
      error={error}
      saved={saved}
      onSave={() => void save()}
      onCancel={cancel}
    />
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-daily-task-list
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-[980px] flex-col overflow-hidden rounded-[14px] border border-white/10 bg-[#0e1b2e] text-white shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-[18px] py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-bold">
              Daily task list
            </h2>
            <p className="mt-1 text-[12.5px] text-white/55">
              Tasks that show up on Today’s tasks every day. Changes start from
              tomorrow’s list.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button
              type="button"
              data-template-add
              disabled={busy || templates === null}
              onClick={() => startEdit({ kind: "new" }, EMPTY_DRAFT)}
              className="rounded-lg border border-white/20 bg-transparent px-[11px] py-1 text-[12.5px] font-semibold text-white hover:border-white/40 disabled:opacity-50"
            >
              + Add task
            </button>
            <button
              type="button"
              onClick={dismiss}
              disabled={busy}
              className="rounded-lg border border-white/20 bg-transparent px-[11px] py-1 text-[12.5px] font-semibold text-white hover:border-white/40 disabled:opacity-50"
            >
              Close
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto px-[18px] pt-3.5 pb-[18px]">
          <div className="max-sm:order-last [&>details]:my-0 [&>details]:max-w-none">
            <HowToUse
              dark
              title="How to use — Daily task list"
              items={[
                "Each task here shows on Today’s tasks for whoever is on shift during its time.",
                "To change a task, click Edit, change it, then click Save. The change starts from tomorrow’s list. Tasks already on today’s list keep the old wording.",
                "To change only today’s task, use Edit on Today’s tasks instead.",
                "To stop a task, click Edit, untick Active, then click Save. It stays in this list in grey, marked OFF.",
                "To add a task, click + Add task, fill it in, then click Save.",
              ]}
            />
          </div>

          {editing?.kind === "new" ? form : null}

          {loadError ? (
            <p role="alert" className="text-[12.5px] text-[#f87171]">
              Could not load the daily task list: {loadError}
            </p>
          ) : templates === null ? (
            <p className="text-[12.5px] text-white/55">Loading…</p>
          ) : templates.length === 0 ? (
            <p className="text-[12.5px] text-white/55">
              No daily tasks yet. Click + Add task to add one.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-white/10 text-left text-[11px] font-bold tracking-[.06em] text-white/40 uppercase">
                    <th className="px-2 py-1.5">Task</th>
                    <th className="px-2 py-1.5">Priority</th>
                    <th className="px-2 py-1.5">Time</th>
                    <th className="px-2 py-1.5">How often</th>
                    <th className="px-2 py-1.5">Opens</th>
                    <th className="px-2 py-1.5">
                      <span className="sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => {
                    const isEditing =
                      editing?.kind === "edit" && editing.id === t.id;
                    return (
                      <Fragment key={t.id}>
                        <tr
                          data-template-id={t.id}
                          data-template-off={!t.is_active || undefined}
                          className={cn(
                            "border-b border-white/[.06] align-top",
                            !t.is_active && "text-white/40",
                          )}
                        >
                          <td className="px-2 py-2">
                            {t.title}
                            {!t.is_active ? (
                              <span className="ml-1.5 inline-block rounded border border-white/25 px-[5px] text-[10px] font-bold tracking-[.06em] text-white/55">
                                OFF
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-2">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                aria-hidden
                                className={cn(
                                  "inline-block size-[7px] rounded-full",
                                  PRIORITY_DOT_CLASS[t.priority],
                                )}
                              />
                              {PRIORITY_TEXT[t.priority]}
                            </span>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap tabular-nums">
                            {windowText(t.window_start_time, t.window_end_time)}
                          </td>
                          <td className="px-2 py-2">{oftenText(t)}</td>
                          <td
                            className={cn(
                              "px-2 py-2",
                              t.is_active && t.link_label && "text-[#7ab3e0]",
                            )}
                          >
                            {t.link_label ?? "—"}
                          </td>
                          <td className="px-2 py-2 text-right">
                            <button
                              type="button"
                              aria-label={`Edit ${t.title}`}
                              disabled={busy || isEditing}
                              onClick={() =>
                                startEdit(
                                  { kind: "edit", id: t.id },
                                  draftOf(t),
                                )
                              }
                              className="rounded-lg border border-white/20 bg-transparent px-2 py-px text-[11.5px] font-semibold text-white hover:border-white/40 disabled:opacity-40"
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                        {isEditing ? (
                          <tr>
                            <td colSpan={6} className="p-0 pt-1 pb-2.5">
                              {form}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const FIELD_LABEL =
  "flex min-w-0 flex-col gap-1 text-[12px] font-semibold text-white/70";
const FIELD_INPUT =
  "w-full min-w-0 rounded-[7px] border border-white/15 bg-white/[.04] px-[9px] py-1.5 text-[13px] font-normal text-white [color-scheme:dark] [&>option]:bg-[#0f1b2d] [&>option]:text-white outline-none placeholder:text-white/30 focus:border-[#185FA5] disabled:opacity-60";

function TemplateForm({
  heading,
  draft,
  onChange,
  links,
  busy,
  error,
  saved,
  onSave,
  onCancel,
}: {
  heading: string;
  draft: Draft;
  onChange: (d: Draft) => void;
  links: { href: string; label: string }[];
  busy: boolean;
  error: string;
  saved: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    onChange({ ...draft, [k]: v });
  return (
    <div
      data-template-form
      className="flex flex-col gap-3 rounded-[10px] border border-[#3b82f6]/55 bg-[#3b82f6]/[.06] p-3.5"
    >
      <strong className="text-[13px]">{heading}</strong>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5">
        <label className={cn(FIELD_LABEL, "col-span-full")}>
          Task
          <input
            data-field="title"
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="What needs to be done"
            disabled={busy}
            className={FIELD_INPUT}
          />
        </label>
        <label className={FIELD_LABEL}>
          Priority
          <SelectMenu
            data-field="priority"
            value={String(draft.priority)}
            options={[
              ...(["high", "moderate", "low"] as const).map((p) => ({
                value: String(p),
                label: String(PRIORITY_TEXT[p]),
              })),
            ]}
            onChange={(next) => set("priority", next as TaskPriority)}
            disabled={busy}
            className={FIELD_INPUT}
          />
        </label>
        <label className={FIELD_LABEL}>
          How often
          <SelectMenu
            data-field="frequency"
            value={String(draft.frequency)}
            options={[
              ...(
                ["daily", "hourly", "every_n_days", "when_free"] as const
              ).map((f) => ({
                value: String(f),
                label: String(FREQUENCY_TEXT[f]),
              })),
            ]}
            onChange={(next) => set("frequency", next as TaskFrequency)}
            disabled={busy}
            className={FIELD_INPUT}
          />
        </label>
        {draft.frequency === "every_n_days" ? (
          <label className={FIELD_LABEL}>
            Every … days
            <input
              data-field="every-n"
              type="number"
              min={1}
              value={draft.everyN}
              onChange={(e) => set("everyN", e.target.value)}
              disabled={busy}
              className={FIELD_INPUT}
            />
          </label>
        ) : null}
        <label className={FIELD_LABEL}>
          From
          <input
            data-field="from"
            type="time"
            value={draft.from}
            onChange={(e) => set("from", e.target.value)}
            disabled={busy}
            className={FIELD_INPUT}
          />
        </label>
        <label className={FIELD_LABEL}>
          To
          <input
            data-field="to"
            type="time"
            value={draft.to}
            onChange={(e) => set("to", e.target.value)}
            disabled={busy}
            className={FIELD_INPUT}
          />
        </label>
        <label className={FIELD_LABEL}>
          Time limit (minutes, optional)
          <input
            data-field="time-limit"
            type="number"
            min={1}
            value={draft.timeLimit}
            onChange={(e) => set("timeLimit", e.target.value)}
            placeholder="e.g. 30"
            disabled={busy}
            className={FIELD_INPUT}
          />
        </label>
        <label className={FIELD_LABEL}>
          Opens page (optional)
          <SelectMenu
            data-field="link"
            value={String(draft.link)}
            options={[
              { value: "", label: "None" },
              ...links.map((l) => ({
                value: String(l.href),
                label: String(l.label),
              })),
            ]}
            onChange={(next) => set("link", next)}
            disabled={busy}
            className={FIELD_INPUT}
          />
        </label>
        <label className={cn(FIELD_LABEL, "col-span-full")}>
          Note (optional)
          <input
            data-field="note"
            value={draft.note}
            onChange={(e) => set("note", e.target.value)}
            disabled={busy}
            className={FIELD_INPUT}
          />
        </label>
        <label className="flex items-center gap-2 text-[12px] font-semibold text-white/70">
          <input
            data-field="active"
            type="checkbox"
            checked={draft.active}
            onChange={(e) => set("active", e.target.checked)}
            disabled={busy}
            className="size-[14px] accent-[#38bdf8]"
          />
          Active
        </label>
      </div>
      <p className="text-[11.5px] text-white/55">
        Leave From and To empty for the whole shift. Every hour needs a From and
        To.
      </p>
      {error ? (
        <p role="alert" className="text-[12.5px] text-[#f87171]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="rounded-lg border border-[#3b82f6] bg-[#3b82f6] px-3.5 py-[5px] text-[12.5px] font-bold text-white hover:bg-[#2f76e8] disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-white/[.18] bg-transparent px-3 py-[5px] text-[12.5px] text-white/75 hover:text-white disabled:opacity-60"
        >
          Cancel
        </button>
        {saved ? (
          <span role="status" className="text-[12px] font-bold text-[#4ade80]">
            Saved — starts from tomorrow’s list
          </span>
        ) : null}
      </div>
    </div>
  );
}
