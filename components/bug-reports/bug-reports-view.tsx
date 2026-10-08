"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HowToUse } from "@/components/ui/how-to-use";
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
import { ImageLightbox } from "./image-lightbox";
import { LegacySearch } from "./legacy-search";
import {
  COUNT_CLASS,
  ERROR_CLASS,
  HEADER_SUB_CLASS,
  HEADER_TITLE_CLASS,
  LOADING_CLASS,
  REFRESH_BUTTON_CLASS,
  TOOLBAR_INPUT_CLASS,
  TRUNCATED_CLASS,
} from "./legacy-styles";
import { NewBugDialog } from "./new-bug-dialog";

interface BugList {
  tasks: ClickUpTask[];
  truncated: boolean;
}

type LoadState =
  // 刷新时留着上一份列表：BugCard 不卸载，展开的评论草稿不丢。
  | { kind: "loading"; previous: BugList | null }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | ({ kind: "ready" } & BugList);

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

/** 筛选下拉（旧页面 .br-filters select）；第一项本身就写着「所有优先级」这类名字。 */
const SELECT = cn(TOOLBAR_INPUT_CLASS, "cursor-pointer");

export function BugReportsView() {
  const [lang, setLang] = useState<Lang>("zh");
  const text = TEXT[lang];
  const [state, setState] = useState<LoadState>({
    kind: "loading",
    previous: null,
  });
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
    setState((prev) => ({
      kind: "loading",
      previous:
        prev.kind === "ready"
          ? { tasks: prev.tasks, truncated: prev.truncated }
          : prev.kind === "loading"
            ? prev.previous
            : null,
    }));
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

  const list: BugList | null =
    state.kind === "ready"
      ? state
      : state.kind === "loading"
        ? state.previous
        : null;
  const tasks = useMemo(() => list?.tasks ?? [], [list]);

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
    // 照旧页面 bug_reports.html：内容区不加外框，各块之间靠下边距（16 / 20px）。
    <main className="text-stone-800">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={HEADER_TITLE_CLASS}>Bug Reports</span>
          <span className={HEADER_SUB_CLASS}>{text.pageSub}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLang((l) => (l === "zh" ? "en" : "zh"))}
            className="cursor-pointer rounded-[8px] border border-[#e2e8f0] bg-white px-3.5 py-1.5 text-[13px] font-semibold text-[#0f172a]"
          >
            {text.langButton}
          </button>
          <button
            type="button"
            disabled={state.kind !== "ready"}
            onClick={() => setNewBugOpen(true)}
            className="cursor-pointer rounded-[8px] border border-[#e2e8f0] bg-white px-3.5 py-1.5 text-[13px] font-bold text-[#0f172a] hover:border-[#94a3b8] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {text.newBug}
          </button>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className={REFRESH_BUTTON_CLASS}
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
            className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6"
          >
            {stats.map((s) => {
              const active = s.key ? stat === s.key : false;
              return (
                <button
                  key={s.label}
                  type="button"
                  aria-pressed={s.key ? stat === s.key : !stat}
                  onClick={() => {
                    setStat((cur) => (s.key && cur !== s.key ? s.key : null));
                    setPill(null);
                  }}
                  className={cn(
                    "cursor-pointer rounded-[12px] border px-4 py-3.5 text-left transition-[border-color,box-shadow] duration-150 select-none",
                    active
                      ? "border-[#0f172a] bg-[#f8fafc] shadow-[0_0_0_2px_#0f172a]"
                      : "border-[#e2e8f0] bg-white hover:border-[#94a3b8] hover:shadow-[0_1px_4px_rgba(0,0,0,0.06)]",
                  )}
                >
                  <div className="mb-1 text-[11px] text-[#64748b]">
                    {s.label}
                  </div>
                  <div
                    className="text-[22px] font-bold"
                    style={{ color: s.color }}
                  >
                    {list ? s.value : "…"}
                  </div>
                </button>
              );
            })}
          </section>

          {/* 状态按钮单选，「全部」= 空值（旧页面 .status-filter-row / .sf-btn）。 */}
          <div
            role="group"
            aria-label="Status"
            className="mb-4 flex flex-wrap gap-2"
          >
            {[
              {
                value: "",
                label: text.allPill,
                sub: undefined,
                count: tasks.length,
              },
              ...STATUS_PILLS.map((p) => ({
                value: p.value,
                label: lang === "zh" ? p.zh : p.en,
                sub: lang === "zh" ? p.en : undefined,
                count: tasks.filter((t) =>
                  statusOf(t).includes(p.value.toLowerCase()),
                ).length,
              })),
            ].map((p) => {
              const active = (pill ?? "") === p.value;
              return (
                <button
                  key={p.value || "all"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    if (!p.value) {
                      setPill(null);
                      return;
                    }
                    setPill(p.value);
                    set("status", "");
                  }}
                  className={cn(
                    "cursor-pointer rounded-[10px] border px-3.5 py-2 text-left text-[13px] leading-[1.4] font-medium",
                    active
                      ? "border-[#0f172a] bg-[#0f172a] text-white"
                      : "border-[#e2e8f0] bg-white text-[#64748b] hover:border-[#94a3b8] hover:text-[#0f172a]",
                  )}
                >
                  <div className="text-[11px]">
                    {p.label}
                    {p.sub ? (
                      <span className="text-[11px]"> {p.sub}</span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[18px] font-bold">{p.count}</div>
                </button>
              );
            })}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-[12px] border border-[#e2e8f0] bg-white px-4 py-3">
            <LegacySearch
              label="Search"
              value={filters.search}
              placeholder={text.search}
              onChange={(v) => set("search", v)}
              widthClass="w-[220px]"
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

          {list?.truncated ? (
            <p role="alert" className={TRUNCATED_CLASS}>
              {text.truncated}
            </p>
          ) : null}

          {state.kind === "loading" && !list ? (
            <div className={LOADING_CLASS}>{text.loading}</div>
          ) : state.kind === "error" ? (
            <div role="alert" className={ERROR_CLASS}>
              {text.connError}
              <br />
              <b>{text.connErrorNote}</b>
              <br />
              <small>{state.message}</small>
              <div>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className={cn(REFRESH_BUTTON_CLASS, "mt-3")}
                >
                  {text.refresh}
                </button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            stat && !otherFilters ? (
              <div className={cn(LOADING_CLASS, "text-[#16a34a]")}>
                {text.cleared}
              </div>
            ) : (
              <div className={LOADING_CLASS}>
                {pill &&
                !tasks.some((t) => statusOf(t).includes(pill.toLowerCase()))
                  ? text.empty
                  : text.noResult}
              </div>
            )
          ) : (
            <>
              <div className={COUNT_CLASS}>
                {text.showing(filtered.length, tasks.length)}
                {state.kind === "loading" ? (
                  <span role="status" className="ml-2 text-[#94a3b8]">
                    {text.loading}
                  </span>
                ) : null}
              </div>
              <div className={cn(state.kind === "loading" && "opacity-60")}>
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
      <HowToUse
        title={
          lang === "zh" ? "使用说明 — Bug Reports" : "How to use — Bug Reports"
        }
        items={
          lang === "zh"
            ? [
                "点数字卡片筛选，再点一次取消；点状态按钮筛选，点「全部」取消。也可以用搜索框和下拉框。",
                "点一条 bug 展开，看描述和评论；在 ClickUp 查看 ↗ 打开原条目。",
                "发评论：写内容（可点 📎 点击选择文件 加附件），点发送；看到 ✓ 已提交到 ClickUp 就是发出去了。",
                "报新 bug：点 ＋ 新建 Bug，填 Title 等，点 Submit。",
                "点刷新数据重新拉取；右上角 EN 切换成英文。",
              ]
            : [
                "Click a number card to filter; click it again to clear. Click a status button to filter; All clears it. The search box and drop-downs also narrow the list.",
                "Click a bug to see its description and comments. View in ClickUp ↗ opens it in ClickUp.",
                "To comment: type, attach with 📎 Click to select files if needed, click Send. ✓ Submitted to ClickUp means it went through.",
                "To report a bug: click ＋ New Bug, fill in Title and the rest, click Submit.",
                "Click Refresh to reload. 中文 switches back to Chinese.",
              ]
        }
        warning={
          lang === "zh"
            ? "「连接失败」是没取到数据，不是没有 bug：点刷新数据。只有附件上传失败时 bug 已经建好，不要重复提交。"
            : "Connection failed means nothing was loaded, not that there are no bugs: click Refresh. If only an attachment fails, the bug is already saved: do not submit again."
        }
      />

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
        <ImageLightbox url={image} onClose={() => setImage(null)} />
      ) : null}
    </main>
  );
}
