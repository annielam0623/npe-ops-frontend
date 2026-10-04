"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";
import { Panel } from "@/components/ui/panel";
import { isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { describeClickUpError, fetchBugTasks } from "@/lib/bug-reports-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { ClickUpTask, ClickUpUser } from "@/types";

import { BugCard } from "./bug-card";
import {
  compareTasks,
  getReason,
  getReportedBy,
  getSeverity,
  getWorkstream,
  isClosed,
  matchesStat,
  severityFieldOf,
  type SortKey,
  type StatKey,
  statusOf,
} from "./config";
import { type Lang, REASONS, STATUS_PILLS, TEXT, WORKSTREAMS } from "./i18n";
import { NewBugDialog } from "./new-bug-dialog";

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; tasks: ClickUpTask[]; truncated: boolean };

interface Filters {
  search: string;
  severity: string;
  status: string;
  reason: string;
  workstream: string;
  assignee: string;
  reporter: string;
  sort: SortKey;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  severity: "",
  status: "",
  reason: "",
  workstream: "",
  assignee: "",
  reporter: "",
  sort: "priority",
};

const SELECT =
  "rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-800 focus:border-stone-500 focus:outline-none";

export function BugReportsView() {
  const [lang, setLang] = useState<Lang>("zh");
  const text = TEXT[lang];
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [who, setWho] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [stat, setStat] = useState<StatKey | null>(null);
  const [pill, setPill] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [newBugOpen, setNewBugOpen] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentUser(controller.signal)
      .then((me) => setWho(me.display_name || me.username))
      .catch(() => {
        // 拿不到名字时评论写「未知用户」，不影响看 bug。
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchBugTasks(controller.signal)
      .then((data) => {
        setState({
          kind: "ready",
          tasks: data.tasks,
          truncated: data.truncated,
        });
        setNow(Date.now());
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setState({ kind: "forbidden" });
        else setState({ kind: "error", message: describeClickUpError(error) });
      });
    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  const tasks = useMemo(
    () => (state.kind === "ready" ? state.tasks : []),
    [state],
  );

  // 下拉选项每次按当前数据重算（旧页面每次刷新都往下拉里追加，会重复）。
  const assigneeNames = useMemo(
    () =>
      [
        ...new Set(
          tasks.flatMap((t) => t.assignees?.map((a) => a.username) ?? []),
        ),
      ].sort(),
    [tasks],
  );
  const reporters = useMemo(
    () =>
      [
        ...new Set(tasks.map(getReportedBy).filter((r): r is string => !!r)),
      ].sort(),
    [tasks],
  );
  const assigneeUsers = useMemo(() => {
    const seen = new Map<number, ClickUpUser>();
    for (const t of tasks) for (const a of t.assignees ?? []) seen.set(a.id, a);
    return [...seen.values()];
  }, [tasks]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return tasks
      .filter((t) => {
        if (!matchesStat(t, stat)) return false;
        const names = (t.assignees ?? []).map((a) => a.username);
        if (
          q &&
          !t.name.toLowerCase().includes(q) &&
          !names.join(" ").toLowerCase().includes(q)
        )
          return false;
        const status = statusOf(t);
        if (
          pill
            ? !status.includes(pill.toLowerCase())
            : filters.status && !status.includes(filters.status)
        )
          return false;
        if (filters.severity && getSeverity(t) !== filters.severity)
          return false;
        if (filters.reason && getReason(t) !== filters.reason) return false;
        if (filters.workstream && getWorkstream(t) !== filters.workstream)
          return false;
        if (filters.assignee && !names.includes(filters.assignee)) return false;
        if (filters.reporter && getReportedBy(t) !== filters.reporter)
          return false;
        return true;
      })
      .sort((a, b) => compareTasks(a, b, filters.sort));
  }, [tasks, filters, stat, pill]);

  const open_ = tasks.filter((t) => !isClosed(t));
  const stats: {
    key: StatKey | null;
    label: string;
    value: number;
    color: string;
  }[] = [
    { key: null, label: text.allBug, value: tasks.length, color: "#0f172a" },
    { key: "active", label: text.open, value: open_.length, color: "#0369a1" },
    {
      key: "P0",
      label: "P0",
      value: tasks.filter((t) => getSeverity(t) === "P0").length,
      color: "#dc2626",
    },
    {
      key: "P1",
      label: "P1",
      value: tasks.filter((t) => getSeverity(t) === "P1").length,
      color: "#ea580c",
    },
    {
      key: "P2",
      label: "P2",
      value: tasks.filter((t) => getSeverity(t) === "P2").length,
      color: "#2563eb",
    },
    {
      key: "no-owner",
      label: lang === "zh" ? "无负责人" : "No Assignee",
      value: open_.filter((t) => !t.assignees?.length).length,
      color: "#9333ea",
    },
  ];
  const otherFilters =
    !!filters.search.trim() ||
    !!filters.severity ||
    !!filters.status ||
    !!filters.reason ||
    !!filters.workstream ||
    !!filters.assignee ||
    !!filters.reporter ||
    !!pill;
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1300px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
              System
            </span>
            <h1 className="text-2xl font-semibold text-stone-900">
              Bug Reports
            </h1>
            <p className="text-sm text-stone-500">{text.pageSub}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setLang((l) => (l === "zh" ? "en" : "zh"))}
              className={SECONDARY_BUTTON_CLASS}
            >
              {text.langButton}
            </button>
            <button
              type="button"
              disabled={state.kind !== "ready"}
              onClick={() => setNewBugOpen(true)}
              className="rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-60"
            >
              {text.newBug}
            </button>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className={SECONDARY_BUTTON_CLASS}
            >
              {text.refresh}
            </button>
          </div>
        </header>

        {state.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Staff access required</p>
          </Panel>
        ) : (
          <>
            <section
              aria-label="Summary"
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
            >
              {stats.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  aria-pressed={s.key ? stat === s.key : !stat}
                  onClick={() => {
                    setStat((cur) => (s.key && cur !== s.key ? s.key : null));
                    setPill(null);
                  }}
                  className={cn(
                    "rounded-lg border bg-white px-4 py-3 text-left transition",
                    (s.key ? stat === s.key : false)
                      ? "border-stone-800 ring-1 ring-stone-800"
                      : "border-stone-200 hover:border-stone-400",
                  )}
                >
                  <div className="text-xs text-stone-500">{s.label}</div>
                  <div
                    className="mt-1 text-2xl font-semibold tabular-nums"
                    style={{ color: s.color }}
                  >
                    {state.kind === "ready" ? s.value : "…"}
                  </div>
                </button>
              ))}
            </section>

            <div
              role="group"
              aria-label="Status"
              className="flex flex-wrap gap-2"
            >
              <PillButton
                active={!pill}
                onClick={() => setPill(null)}
                label={text.allPill}
                count={tasks.length}
              />
              {STATUS_PILLS.map((p) => (
                <PillButton
                  key={p.value}
                  active={pill === p.value}
                  onClick={() => {
                    setPill(p.value);
                    set("status", "");
                  }}
                  label={lang === "zh" ? p.zh : p.en}
                  sub={lang === "zh" ? p.en : undefined}
                  count={
                    tasks.filter((t) =>
                      statusOf(t).includes(p.value.toLowerCase()),
                    ).length
                  }
                />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                aria-label="Search"
                value={filters.search}
                placeholder={text.search}
                onChange={(e) => set("search", e.target.value)}
                className={cn(SELECT, "w-64")}
              />
              <select
                aria-label="Severity"
                className={SELECT}
                value={filters.severity}
                onChange={(e) => set("severity", e.target.value)}
              >
                <option value="">{text.allSeverity}</option>
                <option value="P0">P0</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
              </select>
              <select
                aria-label="Status filter"
                className={SELECT}
                value={filters.status}
                onChange={(e) => {
                  set("status", e.target.value);
                  setPill(null);
                }}
              >
                <option value="">{text.allStatus}</option>
                {(["new", "in progress", "complete"] as const).map((v) => (
                  <option key={v} value={v}>
                    {text.statusOptions[v]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Reason"
                className={SELECT}
                value={filters.reason}
                onChange={(e) => set("reason", e.target.value)}
              >
                <option value="">{text.allReasons}</option>
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {lang === "zh" ? r.value : r.en}
                  </option>
                ))}
              </select>
              <select
                aria-label="Workstream"
                className={SELECT}
                value={filters.workstream}
                onChange={(e) => set("workstream", e.target.value)}
              >
                <option value="">{text.allWorkstreams}</option>
                {WORKSTREAMS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              <select
                aria-label="Assignee"
                className={SELECT}
                value={filters.assignee}
                onChange={(e) => set("assignee", e.target.value)}
              >
                <option value="">{text.allAssignees}</option>
                {assigneeNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <select
                aria-label="Reporter"
                className={SELECT}
                value={filters.reporter}
                onChange={(e) => set("reporter", e.target.value)}
              >
                <option value="">{text.allReporters}</option>
                {reporters.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <select
                aria-label="Sort"
                className={SELECT}
                value={filters.sort}
                onChange={(e) => set("sort", e.target.value as SortKey)}
              >
                <option value="priority">{text.sortPriority}</option>
                <option value="days-desc">{text.sortOldest}</option>
                <option value="updated-desc">{text.sortUpdated}</option>
              </select>
            </div>

            {state.kind === "ready" && state.truncated ? (
              <p
                role="alert"
                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
              >
                {text.truncated}
              </p>
            ) : null}

            {state.kind === "loading" ? (
              <Panel>{text.loading}</Panel>
            ) : state.kind === "error" ? (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-800"
              >
                <p>{text.connError}</p>
                <p className="mt-1 font-semibold">{text.connErrorNote}</p>
                <p className="mt-1 text-xs">{state.message}</p>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className={cn(SECONDARY_BUTTON_CLASS, "mt-3")}
                >
                  {text.refresh}
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <Panel>
                {stat && !otherFilters ? (
                  <span className="text-green-600">{text.cleared}</span>
                ) : pill &&
                  !tasks.some((t) =>
                    statusOf(t).includes(pill.toLowerCase()),
                  ) ? (
                  text.empty
                ) : (
                  text.noResult
                )}
              </Panel>
            ) : (
              <>
                <p className="text-xs text-stone-500">
                  {text.showing(filtered.length, tasks.length)}
                </p>
                <div className="flex flex-col gap-2.5">
                  {filtered.map((task) => (
                    <BugCard
                      key={task.id}
                      task={task}
                      text={text}
                      open={open.has(task.id)}
                      now={now}
                      who={who || text.unknownUser}
                      onToggle={() =>
                        setOpen((s) => {
                          const next = new Set(s);
                          if (next.has(task.id)) next.delete(task.id);
                          else next.add(task.id);
                          return next;
                        })
                      }
                      onUnauthorized={redirectToLogin}
                      onOpenImage={setImage}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {newBugOpen ? (
        <NewBugDialog
          assignees={assigneeUsers}
          severityField={severityFieldOf(tasks)}
          reporter={who}
          onClose={() => setNewBugOpen(false)}
          onCreated={() => setReloadKey((k) => k + 1)}
          onUnauthorized={redirectToLogin}
        />
      ) : null}

      {image ? (
        <Modal
          titleId="image-title"
          onDismiss={() => setImage(null)}
          panelClassName="max-w-4xl p-2"
        >
          <h2 id="image-title" className="sr-only">
            Attachment
          </h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- ClickUp 附件，外部地址 */}
          <img
            src={image}
            alt="Attachment"
            className="max-h-[85vh] w-full object-contain"
          />
        </Modal>
      ) : null}
    </main>
  );
}

function PillButton({
  active,
  onClick,
  label,
  sub,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub?: string;
  count: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex flex-col items-start rounded-lg border px-3 py-1.5 text-left text-xs",
        active
          ? "border-stone-800 bg-stone-800 text-white"
          : "border-stone-300 bg-white text-stone-700 hover:border-stone-400",
      )}
    >
      <span className="font-semibold">
        {label}
        {sub ? <span className="font-normal opacity-70"> {sub}</span> : null}
      </span>
      <span className="tabular-nums opacity-80">{count}</span>
    </button>
  );
}
