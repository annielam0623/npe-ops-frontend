import { apiFetch } from "@/lib/api-client";
import type { Rule } from "@/lib/schedule-engine";

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
