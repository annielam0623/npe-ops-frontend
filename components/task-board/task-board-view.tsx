"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";
import { Panel } from "@/components/ui/panel";
import { isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { describeClickUpError } from "@/lib/bug-reports-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import {
  fetchTaskBoardAssigned,
  fetchTaskBoardDocs,
  fetchTaskBoardLists,
  fetchTaskBoardTasks,
} from "@/lib/task-board-api";
import { cn } from "@/lib/utils";
import type {
  ClickUpDoc,
  ClickUpDocPage,
  ClickUpTask,
  TaskBoardLists,
} from "@/types";

import {
  compareTasks,
  isDone,
  pickDefaultSprint,
  SUBMIT_TABS,
  type TabKey,
  TABS,
} from "./config";
import { Markdown } from "./markdown";
import { NewTaskDialog } from "./new-task-dialog";
import { TaskCard } from "./task-card";

type TaskData = {
  kind: "tasks";
  tasks: ClickUpTask[];
  truncated: boolean;
  /** 「指派给我」才有：按哪个邮箱查的、在 ClickUp 成员里找到了没有。 */
  assigned?: { email: string; found: boolean };
};
type DocsData = { kind: "docs"; docs: ClickUpDoc[] };
type Loaded = TaskData | DocsData;
type Slot =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: Loaded };

export function TaskBoardView() {
  const [lists, setLists] = useState<TaskBoardLists | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("sprint");
  const [sprintId, setSprintId] = useState<string | null>(null);
  /** 按 key（列表 id / assigned / docs）缓存，切回来不重拉；刷新才重拉。 */
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [search, setSearch] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [who, setWho] = useState("");
  const [creating, setCreating] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);
  /** 每个缓存键最新一次请求的序号：只认最新的结果（刷新 / 切走再切回时旧响应作废）。 */
  const seqRef = useRef<Record<string, number>>({});

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    fetchCurrentUser()
      .then((me) => setWho(me.display_name || me.username))
      .catch(() => {});
    const controller = new AbortController();
    fetchTaskBoardLists(controller.signal)
      .then((l) => {
        setLists(l);
        setSprintId(pickDefaultSprint(l.sprints));
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 401)) redirectToLogin();
        else setInitError(describeClickUpError(e));
      });
    return () => controller.abort();
  }, [redirectToLogin, reloadKey]);

  /** 当前标签对应的缓存键。 */
  const slotKey = useMemo(() => {
    if (!lists) return null;
    if (tab === "sprint") return sprintId ? `list:${sprintId}` : null;
    if (tab === "assigned" || tab === "docs") return tab;
    return `list:${lists.pool_ids[tab]}`;
  }, [lists, tab, sprintId]);

  const load = useCallback(
    async (key: string) => {
      const seq = (seqRef.current[key] ?? 0) + 1;
      seqRef.current[key] = seq;
      const stale = () => seqRef.current[key] !== seq;
      setSlots((s) => ({ ...s, [key]: { status: "loading" } }));
      try {
        let data: Loaded;
        if (key === "docs") {
          data = { kind: "docs", docs: await fetchTaskBoardDocs() };
        } else if (key === "assigned") {
          const r = await fetchTaskBoardAssigned();
          data = {
            kind: "tasks",
            tasks: r.tasks,
            truncated: r.truncated,
            assigned: { email: r.email, found: r.resolved_user_id !== null },
          };
        } else {
          const r = await fetchTaskBoardTasks(key.slice(5));
          data = { kind: "tasks", tasks: r.tasks, truncated: r.truncated };
        }
        if (!stale())
          setSlots((s) => ({ ...s, [key]: { status: "ready", data } }));
      } catch (e) {
        if (stale()) return;
        if (isStatus(e, 401)) {
          redirectToLogin();
          return;
        }
        setSlots((s) => ({
          ...s,
          [key]: { status: "error", message: describeClickUpError(e) },
        }));
      }
    },
    [redirectToLogin],
  );

  // 只拉当前标签、没拉过（或刷新清掉了）才拉；结果按键存，切标签时慢的旧请求只会写到它自己的键上。
  const slot = slotKey ? slots[slotKey] : undefined;
  useEffect(() => {
    if (!slotKey || slot) return;
    void load(slotKey);
  }, [slotKey, slot, load]);

  function refresh() {
    if (!slotKey) return;
    setSlots((s) => {
      const next = { ...s };
      delete next[slotKey];
      return next;
    });
  }

  function countFor(key: TabKey): number | null {
    if (!lists) return null;
    const k =
      key === "sprint"
        ? sprintId
          ? `list:${sprintId}`
          : null
        : key === "assigned" || key === "docs"
          ? key
          : `list:${lists.pool_ids[key]}`;
    const s = k ? slots[k] : undefined;
    if (s?.status !== "ready") return null;
    return s.data.kind === "docs"
      ? s.data.docs.length
      : s.data.tasks.filter((t) => !isDone(t)).length;
  }

  const taskData =
    slot?.status === "ready" && slot.data.kind === "tasks" ? slot.data : null;
  const filtered = useMemo(() => {
    if (!taskData) return [];
    const q = search.trim().toLowerCase();
    return taskData.tasks
      .filter((t) => showDone || !isDone(t))
      .filter(
        (t) =>
          !q ||
          t.name.toLowerCase().includes(q) ||
          (t.assignees ?? []).some((a) => a.username.toLowerCase().includes(q)),
      )
      .sort(compareTasks);
  }, [taskData, search, showDone]);
  const hiddenDone =
    taskData && !showDone ? taskData.tasks.filter(isDone).length : 0;
  const poolName = SUBMIT_TABS[tab];
  const submitListId =
    lists && poolName && (tab === "requirement" || tab === "bug_pool")
      ? lists.pool_ids[tab]
      : null;

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1300px] flex-col gap-4 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
              System
            </span>
            <h1 className="text-2xl font-semibold text-stone-900">
              Task Board
            </h1>
            <p className="text-sm text-stone-500">
              数据来自 ClickUp · Supplier
            </p>
          </div>
          <button
            type="button"
            onClick={() => (lists ? refresh() : setReloadKey((k) => k + 1))}
            className={SECONDARY_BUTTON_CLASS}
          >
            刷新数据
          </button>
        </header>

        {initError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-800"
          >
            初始化失败：{initError}
          </div>
        ) : !lists ? (
          <Panel>加载中…</Panel>
        ) : (
          <>
            <div
              role="tablist"
              className="flex flex-wrap gap-1 border-b border-stone-300"
            >
              {TABS.map((t) => {
                const n = countFor(t.key);
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
                      tab === t.key
                        ? "border-stone-900 text-stone-900"
                        : "border-transparent text-stone-500 hover:text-stone-800",
                    )}
                  >
                    {t.label}
                    {n !== null ? (
                      <span className="rounded-full bg-stone-200 px-1.5 text-xs">
                        {n}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {tab !== "docs" ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  type="search"
                  aria-label="搜索"
                  value={search}
                  placeholder="搜索标题、负责人…"
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-56 rounded-md border border-stone-300 bg-white px-3 py-1.5"
                />
                {tab === "sprint" && lists.sprints.length ? (
                  <select
                    aria-label="Sprint"
                    value={sprintId ?? ""}
                    onChange={(e) => setSprintId(e.target.value)}
                    className="rounded-md border border-stone-300 bg-white px-3 py-1.5"
                  >
                    {lists.sprints.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={showDone}
                    onChange={(e) => setShowDone(e.target.checked)}
                  />
                  显示已完成
                </label>
                {tab === "assigned" && taskData?.assigned ? (
                  <span
                    className={cn(
                      "text-xs",
                      taskData.assigned.found
                        ? "text-stone-500"
                        : "font-semibold text-amber-700",
                    )}
                  >
                    {taskData.assigned.found
                      ? `ClickUp 账号：${taskData.assigned.email}`
                      : `⚠️ 在 ClickUp 成员里找不到 ${taskData.assigned.email}，下面的空白不代表你没有任务`}
                  </span>
                ) : null}
                {submitListId && poolName ? (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="ml-auto rounded-md bg-stone-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
                  >
                    + 新建到 {poolName}
                  </button>
                ) : null}
              </div>
            ) : null}

            {taskData?.truncated ? (
              <p
                role="alert"
                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
              >
                ⚠️
                数据可能不完整：任务条数超出单次拉取上限，下面显示的不是全部。请告知
                Max。
              </p>
            ) : null}

            {tab === "sprint" && !lists.sprints.length ? (
              <Panel>没有可显示的 Sprint</Panel>
            ) : !slot || slot.status === "loading" ? (
              <Panel>正在从 ClickUp 拉取数据…</Panel>
            ) : slot.status === "error" ? (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-800"
              >
                没能从 ClickUp 取到数据 —— <b>这不代表这里没有任务</b>
                ，是取数据失败了。
                <div className="mt-1 text-xs">{slot.message}</div>
              </div>
            ) : slot.data.kind === "docs" ? (
              <DocsView docs={slot.data.docs} />
            ) : filtered.length === 0 ? (
              <Panel>
                暂无任务{hiddenDone ? `（已隐藏 ${hiddenDone} 条已完成）` : ""}
              </Panel>
            ) : (
              <>
                <p className="text-xs text-stone-500">
                  显示 {filtered.length} / {slot.data.tasks.length} 条
                  {hiddenDone ? `（已隐藏 ${hiddenDone} 条已完成）` : ""}
                </p>
                <div className="flex flex-col gap-2.5">
                  {filtered.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      showList={tab === "assigned"}
                      open={open.has(t.id)}
                      who={who || "未知用户"}
                      onToggle={() =>
                        setOpen((s) => {
                          const next = new Set(s);
                          if (next.has(t.id)) next.delete(t.id);
                          else next.add(t.id);
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

            <HowToUse />
          </>
        )}
      </div>

      {creating && submitListId && poolName ? (
        <NewTaskDialog
          listId={submitListId}
          poolName={poolName}
          who={who}
          onClose={() => setCreating(false)}
          onCreated={refresh}
          onUnauthorized={redirectToLogin}
        />
      ) : null}

      {image ? (
        <Modal
          titleId="tb-image"
          onDismiss={() => setImage(null)}
          panelClassName="max-w-4xl p-2"
        >
          <h2 id="tb-image" className="sr-only">
            附件
          </h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- ClickUp 附件，外部地址 */}
          <img
            src={image}
            alt="附件"
            className="max-h-[85vh] w-full object-contain"
          />
        </Modal>
      ) : null}
    </main>
  );
}

function flattenPages(
  pages: ClickUpDocPage[],
  depth = 0,
): { page: ClickUpDocPage; depth: number }[] {
  return pages.flatMap((p) => [
    { page: p, depth },
    ...flattenPages(p.pages ?? [], depth + 1),
  ]);
}

function DocsView({ docs }: { docs: ClickUpDoc[] }) {
  const [selected, setSelected] = useState<string | null>(() => {
    for (const d of docs) {
      const first = flattenPages(d.pages)[0];
      if (first) return first.page.id;
    }
    return null;
  });
  if (!docs.length) return <Panel>Supplier 文件夹下暂无文档</Panel>;
  const all = docs.flatMap((d) => flattenPages(d.pages));
  const page = all.find((p) => p.page.id === selected)?.page;
  return (
    <div className="grid gap-4 md:grid-cols-[260px_1fr]">
      <nav
        aria-label="文档"
        className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white p-3 text-sm"
      >
        {docs.map((d) => (
          <div key={d.id}>
            <div className="mb-1 font-semibold text-stone-800">{d.name}</div>
            {d.error ? (
              <p className="text-xs text-red-700">⚠️ 内容取不到（{d.error}）</p>
            ) : (
              flattenPages(d.pages).map(({ page: p, depth }) => (
                <button
                  key={p.id}
                  type="button"
                  aria-current={p.id === selected}
                  onClick={() => setSelected(p.id)}
                  style={{ paddingLeft: `${8 + depth * 12}px` }}
                  className={cn(
                    "block w-full rounded py-1 pr-2 text-left",
                    p.id === selected
                      ? "bg-stone-800 text-white"
                      : "text-stone-700 hover:bg-stone-100",
                  )}
                >
                  {p.name}
                </button>
              ))
            )}
          </div>
        ))}
      </nav>
      <div className="min-w-0 rounded-lg border border-stone-200 bg-white px-5 py-4">
        {page ? (
          page.content?.trim() ? (
            <Markdown source={page.content} />
          ) : (
            <p className="text-sm text-stone-500">这一页没有内容。</p>
          )
        ) : (
          <p className="text-sm text-stone-500">选左边的一页查看。</p>
        )}
      </div>
    </div>
  );
}

function HowToUse() {
  return (
    <details className="max-w-3xl rounded-lg border border-sky-200 bg-sky-50 px-5 py-4 text-sm leading-relaxed text-stone-700">
      <summary className="cursor-pointer font-semibold text-sky-900">
        📖 How to use — Task Board / 使用说明
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Pick a tab. The number on it counts tasks not done.</li>
        <li>
          Search by title or assignee. Tick 显示已完成 to include finished
          tasks.
        </li>
        <li>
          Click a task to see details and comments. 在 ClickUp 查看 ↗ opens it
          in ClickUp.
        </li>
        <li>
          To comment: type, click 发送. To add a task (Requirement pool, Bug
          pool): + 新建到 … → Submit.
        </li>
        <li>Click 刷新数据 to reload the tab.</li>
      </ol>
      <p className="mt-2">
        ⚠️ 没能从 ClickUp 取到数据 means the fetch failed, not that the list is
        empty: click 刷新数据. After 任务已建好，但附件上传失败, do not submit
        again.
      </p>
      <ol className="mt-3 list-decimal space-y-1 border-t border-sky-200 pt-3 pl-5">
        <li>选标签，标签上的数字是未完成的任务数。</li>
        <li>按标题或负责人搜索；勾选显示已完成，连已完成的一起显示。</li>
        <li>点一条任务看详情和评论；在 ClickUp 查看 ↗ 打开原条目。</li>
        <li>
          发评论：写内容，点发送。新建任务（只有 Requirement pool、Bug pool）：+
          新建到 … → Submit。
        </li>
        <li>点刷新数据重新拉取当前标签。</li>
      </ol>
      <p className="mt-2">
        ⚠️ 「没能从 ClickUp
        取到数据」是取数据失败，不是列表为空：点刷新数据。看到「任务已建好，但附件上传失败」不要再提交。
      </p>
    </details>
  );
}
