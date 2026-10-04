import type { ClickUpTask, TaskBoardList } from "@/types";

export type TabKey =
  "sprint" | "requirement" | "backlog" | "bug_pool" | "assigned" | "docs";

export const TABS: readonly { key: TabKey; label: string }[] = [
  { key: "sprint", label: "Supplier Sprint" },
  { key: "requirement", label: "Requirement pool" },
  { key: "backlog", label: "Backlog" },
  { key: "bug_pool", label: "Bug pool" },
  { key: "assigned", label: "Assigned to me" },
  { key: "docs", label: "📄 文档" },
];

/** 只有这两个池子能新建（Backlog 刻意不开放）。 */
export const SUBMIT_TABS: Partial<Record<TabKey, string>> = {
  requirement: "Requirement pool",
  bug_pool: "Bug pool",
};

/** Task Board 发的评论前面加的标记。 */
export const TB_MARK = "🧩";

/** 完成了的：status.type 是 closed / done，或状态名像「完成 / 上线 / 拒绝」（同旧页面）。 */
export function isDone(t: ClickUpTask): boolean {
  const type = (t.status?.type ?? "").toLowerCase();
  if (type === "closed" || type === "done") return true;
  const s = (t.status?.status ?? "").toLowerCase();
  return /complete|completed|done|已上线|已完成|已拒绝|rejected|close/.test(s);
}

export function statusTone(t: ClickUpTask): string {
  if (isDone(t)) return "bg-stone-200 text-stone-600";
  const s = (t.status?.status ?? "").toLowerCase();
  if (/new|新建|to do|open/.test(s)) return "bg-sky-100 text-sky-800";
  if (/progress|进行|doing|qa|review|verification/.test(s))
    return "bg-amber-100 text-amber-800";
  return "bg-violet-100 text-violet-800";
}

/** Supplier 的任务用 ClickUp 自带的 priority（不是 Bug Reports 的 Bug Severity 字段）。 */
export function priorityOf(t: ClickUpTask): string | null {
  return t.priority?.priority
    ? String(t.priority.priority).toLowerCase()
    : null;
}

export function priorityTone(p: string): string {
  if (p === "urgent") return "bg-red-600 text-white";
  if (p === "high") return "bg-orange-500 text-white";
  if (p === "normal") return "bg-blue-600 text-white";
  return "bg-stone-400 text-white";
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** 没完成的在前；再按优先级（没有的最后）；再按最近更新。 */
export function compareTasks(a: ClickUpTask, b: ClickUpTask): number {
  const done = Number(isDone(a)) - Number(isDone(b));
  if (done) return done;
  const pa = PRIORITY_ORDER[priorityOf(a) ?? ""] ?? 4;
  const pb = PRIORITY_ORDER[priorityOf(b) ?? ""] ?? 4;
  if (pa !== pb) return pa - pb;
  return Number(b.date_updated) - Number(a.date_updated);
}

/**
 * Sprint 的日期从列表名里的「(M/D - M/D)」读（列表自带的起止日是脏数据，同旧页面）。
 * 年份不在名字里：今年和去年都试，跨年区间（12/28 - 1/4）结束日算下一年。
 * 旧页面只试今年，1 月看到去年 12 月开始的 Sprint 会算错。
 */
function sprintRanges(name: string, now: Date): { start: Date; end: Date }[] {
  const m = name.match(
    /\((\d{1,2})\/(\d{1,2})\s*[-–~]\s*(\d{1,2})\/(\d{1,2})\)/,
  );
  if (!m) return [];
  const year = now.getFullYear();
  return [year, year - 1].map((y) => {
    const start = new Date(y, Number(m[1]) - 1, Number(m[2]), 0, 0, 0);
    const end = new Date(y, Number(m[3]) - 1, Number(m[4]), 23, 59, 59);
    if (end < start) end.setFullYear(y + 1);
    return { start, end };
  });
}

/** 默认 Sprint：包含今天的 → 已经开始的里最晚开始的 → 第一个。 */
export function pickDefaultSprint(
  sprints: TaskBoardList[],
  now = new Date(),
): string | null {
  if (!sprints.length) return null;
  let containing: TaskBoardList | null = null;
  let latest: { s: TaskBoardList; start: Date } | null = null;
  for (const s of sprints) {
    for (const r of sprintRanges(s.name, now)) {
      if (now >= r.start && now <= r.end && !containing) containing = s;
      if (now >= r.start && (!latest || r.start > latest.start))
        latest = { s, start: r.start };
    }
  }
  return (containing ?? latest?.s ?? sprints[0]).id;
}

export const formatDay = (ms: string | null | undefined) => {
  const n = Number(ms);
  return ms && !Number.isNaN(n) ? new Date(n).toLocaleDateString("en-US") : "";
};

/** 评论区的中文文字。 */
export const COMMENT_TEXT = {
  commentLoading: "加载中…",
  commentFail: "评论加载失败 —— 不代表没有评论",
  noComment: "暂无评论",
  history: "评论历史",
  addComment: "发表评论",
  commentHolder: "留言…",
  selectFiles: "📎 点击选择文件",
  send: "发送",
  sending: "提交中…",
  submitOk: "✓ 已提交到 ClickUp",
  log: "Task Board",
  needContent: "请输入内容或选择文件",
  submitFail: "提交失败：",
  attachFail: "附件上传失败：",
  uploaded: (who: string, n: number) => `${who} 上传了 ${n} 个附件`,
};
