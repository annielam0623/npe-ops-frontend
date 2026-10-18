import { apiFetch } from "@/lib/api-client";
import type { Rule } from "@/lib/schedule-engine";
import type { ScheduleSlot } from "@/types";

/** GET / PUT /api/schedule/rules 的文档（后端只存、只校验、不执行；排班引擎在前端：lib/schedule-engine.ts）。 */
export interface ScheduleRulesDoc {
  version: 1;
  rules: Rule[];
  /** 服务器存的时间（ISO、不带时区后缀）；只读。 */
  updated_at: string | null;
  /** 保存人的用户 id；只读。 */
  updated_by: number | null;
}

/** 规则：所有登录的后台角色可读；还没存过返回空文档（不 404）。后端没上线时 404 ⇒ 页面不显示 Rules / Auto-fill。 */
export function fetchScheduleRules(
  signal?: AbortSignal,
): Promise<ScheduleRulesDoc> {
  return apiFetch<ScheduleRulesDoc>("/api/schedule/rules", {
    cache: "no-store",
    signal,
  });
}

/** 整份替换（supervisor 及以上）。出错 400 {detail:「第几条规则哪个键」}。 */
export function saveScheduleRules(rules: Rule[]): Promise<ScheduleRulesDoc> {
  return apiFetch<ScheduleRulesDoc>("/api/schedule/rules", {
    method: "PUT",
    body: { version: 1, rules },
  });
}

export interface BulkSlotInput {
  date: string;
  shift_type: string;
  start_time: string;
  end_time: string;
  employee_id: number | null;
}

export interface BulkSlotsResult {
  week_start: string;
  status: "draft" | "published";
  deleted: number;
  slots: ScheduleSlot[];
}

/**
 * 整周一次建（一个事务：要么全建要么全不建；只许 draft 周；单次最多 300 个）。
 * replace=true 先删掉这一周现有的全部时段；bulk 不复制上一周。
 */
export function bulkCreateSlots(
  weekStart: string,
  input: { replace: boolean; slots: BulkSlotInput[] },
): Promise<BulkSlotsResult> {
  return apiFetch<BulkSlotsResult>(
    `/api/schedule/weeks/${weekStart}/slots/bulk`,
    { method: "POST", body: input },
  );
}
