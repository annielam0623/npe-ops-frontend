import type { ClickUpAttachment, ClickUpComment, ClickUpTask } from "@/types";

/** 读 ClickUp 下拉型自定义字段：值是选项的 orderindex（Workstream 也可能是选项 id）。 */
function optionName(task: ClickUpTask, field: string): string | null {
  const f = task.custom_fields?.find((x) => x.name === field);
  if (!f || f.value === null || f.value === undefined) return null;
  const opt = f.type_config?.options?.find(
    (o) => o.orderindex === f.value || o.id === f.value,
  );
  return opt?.name ?? null;
}

export const getSeverity = (t: ClickUpTask) => optionName(t, "Bug Severity");
export const getReason = (t: ClickUpTask) => optionName(t, "Bug原因");
export const getWorkstream = (t: ClickUpTask) => optionName(t, "Workstream");

export function getReportedBy(t: ClickUpTask): string | null {
  const m = (t.text_content ?? "").match(/\[Reported by:\s*(.+?)\]/);
  return m ? m[1].trim() : null;
}

export const statusOf = (t: ClickUpTask) =>
  (t.status?.status ?? "").toLowerCase();

/** 关闭了的（已上线 / 已拒绝 / 转为需求）。按子串判，同旧页面。 */
export function isClosed(t: ClickUpTask): boolean {
  const s = statusOf(t);
  return (
    s.includes("complete") ||
    s.includes("上线") ||
    s.includes("已拒绝") ||
    s.includes("cr") ||
    s.includes("rejected")
  );
}

/** 状态徽章的配色，照旧页面 bug_reports.html 的 .b-new / .b-prog / .b-closed / .b-done / .b-open。 */
export function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("new") || s.includes("新建"))
    return "border-[#e2e8f0] bg-[#f1f5f9] text-[#475569]";
  if (s.includes("progress") || s.includes("进行"))
    return "border-[#7dd3fc] bg-[#e0f2fe] text-[#075985]";
  if (s.includes("complete") || s.includes("上线") || s.includes("done"))
    return "border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]";
  if (s.includes("fixed") || s.includes("passed"))
    return "border-[#86efac] bg-[#dcfce7] text-[#166534]";
  return "border-[#fde68a] bg-[#fef3c7] text-[#92400e]";
}

/** 严重程度徽章，照旧页面 .b-p0 / .b-p1 / .b-p2 / .b-p3。 */
export function severityTone(s: string): string {
  if (s === "P0") return "border-[#fca5a5] bg-[#fee2e2] text-[#991b1b]";
  if (s === "P1") return "border-[#fdba74] bg-[#ffedd5] text-[#9a3412]";
  if (s === "P2") return "border-[#93c5fd] bg-[#dbeafe] text-[#1e40af]";
  return "border-[#cbd5e1] bg-[#f1f5f9] text-[#475569]";
}

export const daysSince = (ms: string, now: number) =>
  Math.floor((now - Number(ms)) / 86_400_000);

export const formatDay = (ms: string) =>
  new Date(Number(ms)).toLocaleDateString("en-US");

export type StatKey = "active" | "P0" | "P1" | "P2" | "no-owner";

export function matchesStat(t: ClickUpTask, key: StatKey | null): boolean {
  if (!key) return true;
  if (key === "active") return !isClosed(t);
  if (key === "no-owner") return !isClosed(t) && !t.assignees?.length;
  return getSeverity(t) === key;
}

export type SortKey = "priority" | "days-desc" | "updated-desc";

const SEV_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** 关闭的永远排最后；默认按严重程度、再按新建时间（新的在前）。 */
export function compareTasks(
  a: ClickUpTask,
  b: ClickUpTask,
  sort: SortKey,
): number {
  const done = Number(isClosed(a)) - Number(isClosed(b));
  if (done) return done;
  if (sort === "days-desc")
    return Number(a.date_created) - Number(b.date_created);
  if (sort === "updated-desc")
    return Number(b.date_updated) - Number(a.date_updated);
  const sa = SEV_ORDER[getSeverity(a) ?? ""] ?? 4;
  const sb = SEV_ORDER[getSeverity(b) ?? ""] ?? 4;
  if (sa !== sb) return sa - sb;
  return Number(b.date_created) - Number(a.date_created);
}

/** 只让 http(s) 地址做成链接 / 图片。 */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * 评论和附件在 ClickUp 里没有关联。本系统发评论时总是先传附件再发评论，所以按
 * 「同一个上传人 + 附件时间不晚于评论 + 相差 90 秒内」配对，每个附件只用一次（同旧页面）。
 */
export function matchAttachments(
  comments: ClickUpComment[],
  attachments: ClickUpAttachment[],
): Map<string, string[]> {
  const WINDOW_MS = 90_000;
  const used = new Set<string>();
  const map = new Map<string, string[]>();
  const validAttachments = attachments.filter(
    (a) => a.user?.id && !Number.isNaN(Number(a.date)),
  );
  const sorted = comments
    .filter((c) => c.user?.id && !Number.isNaN(Number(c.date)))
    .sort((a, b) => Number(a.date) - Number(b.date));
  for (const c of sorted) {
    const cDate = Number(c.date);
    const matched = validAttachments.filter(
      (a) =>
        !used.has(a.id) &&
        a.user?.id === c.user?.id &&
        Number(a.date) <= cDate &&
        cDate - Number(a.date) <= WINDOW_MS,
    );
    if (matched.length) {
      matched.forEach((a) => used.add(a.id));
      map.set(
        c.id,
        matched.map((a) => a.url),
      );
    }
  }
  return map;
}

/** Workstream 选项在 ClickUp 里的 id（新建 bug 时写自定义字段用）。⚠️ ClickUp 那边改了要跟着改。 */
export const WORKSTREAM_FIELD_ID = "564243b5-f057-4195-b0b0-fedd4164369d";
export const WORKSTREAM_OPTION_IDS: Record<string, string> = {
  Hotel: "d07884ea-5fdd-4851-840c-b964deeaf163",
  Tour: "fe3e41eb-4f5c-41fc-acc7-5924618baacb",
  Activity: "6d0f5780-f926-4a18-8df3-aaa9507057c1",
  OA: "f42a56e6-9405-4cab-8387-4bf6fe77cbab",
  API: "7659e076-726b-4efa-a684-5f95f8c12393",
  Payment: "d8b80dd8-4eeb-4677-b1d9-8f4fcb2c6f79",
};

/** "2026-10-03" → 本地零点的毫秒（旧页面按 UTC 零点算，截止日早一天）。 */
export function localMidnight(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** 「Bug Severity」字段的 id 和选项（按 orderindex 排），从任意一个带这个字段的 bug 里读。 */
export function severityFieldOf(
  tasks: ClickUpTask[],
): { id: string; options: { id: string; name: string }[] } | null {
  for (const t of tasks) {
    const f = t.custom_fields?.find((x) => x.name === "Bug Severity");
    if (f?.type_config?.options?.length) {
      return {
        id: f.id,
        options: [...f.type_config.options]
          .sort((a, b) => a.orderindex - b.orderindex)
          .map((o) => ({ id: o.id, name: o.name })),
      };
    }
  }
  return null;
}
