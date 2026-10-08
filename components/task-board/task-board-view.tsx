"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ImageLightbox } from "@/components/bug-reports/image-lightbox";
import { LegacySearch } from "@/components/bug-reports/legacy-search";
import {
  COUNT_CLASS,
  ERROR_CLASS,
  HEADER_SUB_CLASS,
  HEADER_TITLE_CLASS,
  LOADING_CLASS,
  REFRESH_BUTTON_CLASS,
  TOOLBAR_INPUT_CLASS,
  TRUNCATED_CLASS,
} from "@/components/bug-reports/legacy-styles";
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
    // 照旧页面 task_board.html：内容区不加外框，各块之间靠下边距。
    <main className="text-stone-800">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={HEADER_TITLE_CLASS}>Task Board</span>
          <span className={HEADER_SUB_CLASS}>数据来自 ClickUp · Supplier</span>
        </div>
        <button
          type="button"
          onClick={() => (lists ? refresh() : setReloadKey((k) => k + 1))}
          className={REFRESH_BUTTON_CLASS}
        >
          刷新数据
        </button>
      </header>

      {initError ? (
        <div role="alert" className={ERROR_CLASS}>
          初始化失败：{initError}
        </div>
      ) : !lists ? (
        <div className={LOADING_CLASS}>加载中…</div>
      ) : (
        <>
          <div role="tablist" className="mb-3.5 flex flex-wrap gap-2">
            {TABS.map((t) => {
              const n = countFor(t.key);
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-[10px] border px-4 py-2 text-[13px] font-medium",
                    active
                      ? "border-[#0f172a] bg-[#0f172a] text-white"
                      : "border-[#e2e8f0] bg-white text-[#64748b] hover:border-[#94a3b8] hover:text-[#0f172a]",
                  )}
                >
                  {t.label}
                  {n !== null ? (
                    <span
                      className={cn(
                        "rounded-[20px] px-[7px] py-px text-[11px]",
                        active
                          ? "bg-white/[.22] text-white"
                          : "bg-[#f1f5f9] text-[#475569]",
                      )}
                    >
                      {n}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* 旧页面在文档标签下只藏搜索框和「显示已完成」，工具条本身还在；这里照旧。 */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[12px] border border-[#e2e8f0] bg-white px-4 py-3">
            {tab !== "docs" ? (
              <LegacySearch
                label="搜索"
                value={search}
                placeholder="搜索标题、负责人…"
                onChange={setSearch}
                widthClass="w-[240px]"
              />
            ) : null}
            {tab === "sprint" && lists.sprints.length ? (
              <select
                aria-label="Sprint"
                value={sprintId ?? ""}
                onChange={(e) => setSprintId(e.target.value)}
                className={cn(TOOLBAR_INPUT_CLASS, "cursor-pointer")}
              >
                {lists.sprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : null}
            {tab !== "docs" ? (
              <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-[#475569] select-none">
                <input
                  type="checkbox"
                  checked={showDone}
                  onChange={(e) => setShowDone(e.target.checked)}
                />
                显示已完成
              </label>
            ) : null}
            {tab === "assigned" && taskData?.assigned ? (
              <span
                className={cn(
                  "text-[12px]",
                  taskData.assigned.found
                    ? "text-[#94a3b8]"
                    : "font-semibold text-[#b45309]",
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
                className="ml-auto cursor-pointer rounded-[6px] border-0 bg-[#0f172a] px-3.5 py-1.5 text-[13px] font-semibold text-white"
              >
                + 新建到 {poolName}
              </button>
            ) : null}
          </div>

          {taskData?.truncated ? (
            <p role="alert" className={TRUNCATED_CLASS}>
              ⚠️
              数据可能不完整：任务条数超出单次拉取上限，下面显示的不是全部。请告知
              Max。
            </p>
          ) : null}

          {tab === "sprint" && !lists.sprints.length ? (
            <div className={LOADING_CLASS}>没有可显示的 Sprint</div>
          ) : !slot || slot.status === "loading" ? (
            <div className={LOADING_CLASS}>正在从 ClickUp 拉取数据…</div>
          ) : slot.status === "error" ? (
            <div role="alert" className={ERROR_CLASS}>
              没能从 ClickUp 取到数据 —— <b>这不代表这里没有任务</b>
              ，是取数据失败了。
              <div className="mt-1 text-[12px]">{slot.message}</div>
            </div>
          ) : slot.data.kind === "docs" ? (
            <DocsView docs={slot.data.docs} />
          ) : filtered.length === 0 ? (
            <>
              <div className={COUNT_CLASS}>
                显示 0 / {slot.data.tasks.length} 条
                {hiddenDone ? `（已隐藏 ${hiddenDone} 条已完成）` : ""}
              </div>
              <div className={LOADING_CLASS}>暂无任务</div>
            </>
          ) : (
            <>
              <div className={COUNT_CLASS}>
                显示 {filtered.length} / {slot.data.tasks.length} 条
                {hiddenDone ? `（已隐藏 ${hiddenDone} 条已完成）` : ""}
              </div>
              <div>
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

          <TaskBoardHowToUse />
        </>
      )}

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
        <ImageLightbox
          url={image}
          alt="附件"
          closeButton={false}
          onClose={() => setImage(null)}
        />
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

/** 文档标签，照旧页面 .doc-layout / .doc-tree / .doc-body。 */
function DocsView({ docs }: { docs: ClickUpDoc[] }) {
  const [selected, setSelected] = useState<string | null>(() => {
    for (const d of docs) {
      const first = flattenPages(d.pages)[0];
      if (first) return first.page.id;
    }
    return null;
  });
  if (!docs.length)
    return <div className={LOADING_CLASS}>Supplier 文件夹下暂无文档</div>;
  const all = docs.flatMap((d) => flattenPages(d.pages));
  const page = all.find((p) => p.page.id === selected)?.page;
  return (
    <div className="grid items-start gap-4 min-[901px]:grid-cols-[260px_1fr]">
      <nav
        aria-label="文档"
        className="rounded-[12px] border border-[#e2e8f0] bg-white p-3 min-[901px]:sticky min-[901px]:top-3"
      >
        {docs.map((d) => (
          <div key={d.id}>
            <div className="mt-2.5 mb-1.5 text-[11px] font-bold tracking-[.05em] text-[#94a3b8] uppercase">
              {d.name}
            </div>
            {d.error ? (
              <div className="block px-2.5 py-1.5 text-[13px] leading-[1.4] text-[#ef4444]">
                ⚠️ 内容取不到（{d.error}）
              </div>
            ) : (
              flattenPages(d.pages).map(({ page: p, depth }) => (
                <button
                  key={p.id}
                  type="button"
                  aria-current={p.id === selected}
                  onClick={() => setSelected(p.id)}
                  style={{ paddingLeft: `${10 + depth * 14}px` }}
                  className={cn(
                    "block w-full cursor-pointer rounded-[8px] py-1.5 pr-2.5 text-left text-[13px] leading-[1.4]",
                    p.id === selected
                      ? "bg-[#0f172a] text-white"
                      : "text-[#475569] hover:bg-[#f1f5f9] hover:text-[#0f172a]",
                  )}
                >
                  {p.name}
                </button>
              ))
            )}
          </div>
        ))}
      </nav>
      <div className="min-w-0 overflow-x-auto rounded-[12px] border border-[#e2e8f0] bg-white px-7 py-6">
        {page ? (
          page.content?.trim() ? (
            <Markdown source={page.content} />
          ) : (
            <p className="text-[13px] text-[#64748b]">这一页没有内容。</p>
          )
        ) : (
          <p className="text-[13px] text-[#64748b]">选左边的一页查看。</p>
        )}
      </div>
    </div>
  );
}

/** 底部说明，文字照旧页面（英文在前、中文在后，同一块）；框的样式用共用的 HowToUse 那套。 */
function TaskBoardHowToUse() {
  return (
    <details className="mt-4 mb-8 max-w-[760px] rounded-[10px] border border-[#d4e6c3] bg-[#f7f9f5] px-5 py-4 text-[12px] leading-[1.9] text-[#4a5a3a]">
      <summary className="cursor-pointer font-semibold text-[#3B6D11]">
        📖 How to use — Task Board / 使用说明
      </summary>
      <ol className="mt-2 list-decimal pl-[18px]">
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
      <div className="mt-2.5 border-t border-[#d4e6c3] pt-2.5">
        ⚠️ 没能从 ClickUp 取到数据 means the fetch failed, not that the list is
        empty: click 刷新数据. After 任务已建好，但附件上传失败, do not submit
        again.
      </div>
      <ol className="mt-3.5 list-decimal border-t border-[#d4e6c3] pt-2.5 pl-[18px]">
        <li>选标签，标签上的数字是未完成的任务数。</li>
        <li>按标题或负责人搜索；勾选显示已完成，连已完成的一起显示。</li>
        <li>点一条任务看详情和评论；在 ClickUp 查看 ↗ 打开原条目。</li>
        <li>
          发评论：写内容，点发送。新建任务（只有 Requirement pool、Bug pool）：+
          新建到 … → Submit。
        </li>
        <li>点刷新数据重新拉取当前标签。</li>
      </ol>
      <div className="mt-2.5 border-t border-[#d4e6c3] pt-2.5">
        ⚠️ 「没能从 ClickUp
        取到数据」是取数据失败，不是列表为空：点刷新数据。看到「任务已建好，但附件上传失败」不要再提交。
      </div>
    </details>
  );
}
