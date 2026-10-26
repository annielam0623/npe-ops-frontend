import { apiFetch } from "@/lib/api-client";

/**
 * 门票团（后端 G190，表 tix_tour_types）。key 建好不可改，只能停用不能删除。
 * Content Studio 用的三个接口要 admin + 开关 `content_studio_tix_tour_types`（默认 admin），
 * 开关关着或接口还没上线时 403 / 404——调用方当「看不到新建 / 编辑入口」处理。
 */
export interface TixTourType {
  id: number;
  key: string;
  /** 内部全名，staff 看。 */
  label: string;
  /** 客人看得到的门票名字（短信、确认页）。 */
  sms_label: string;
  /** Tickets Tracking 表里的简称。 */
  abbr: string;
  skip_confirmation_no: boolean;
  sort_order: number;
  is_active: boolean;
}

/** 全部门票团（含停用的），按 sort_order。 */
export function fetchTixTourTypes(
  signal?: AbortSignal,
): Promise<{ tour_types: TixTourType[] }> {
  return apiFetch<{ tour_types: TixTourType[] }>(
    "/api/settings/tix-tour-types",
    { cache: "no-store", signal },
  );
}

/** 新建只填 key + label（Annie 2026-10-26）；后端同时种好这个团所有的内容 key。key 重复 / 格式不对 400。 */
export function createTixTourType(input: {
  key: string;
  label: string;
}): Promise<TixTourType> {
  return apiFetch<TixTourType>("/api/settings/tix-tour-types", {
    method: "POST",
    body: input,
  });
}

/** key 不能改；其余可改。 */
export function updateTixTourType(
  id: number,
  patch: {
    label?: string;
    sms_label?: string;
    abbr?: string;
    is_active?: boolean;
  },
): Promise<TixTourType> {
  return apiFetch<TixTourType>(`/api/settings/tix-tour-types/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

/** 门票发送页下拉用（staff）：只有能发送的团（必填 5 项都填了、没停用）。 */
export function fetchSendableTixTourTypes(
  signal?: AbortSignal,
): Promise<{ key: string; label: string; abbr: string }[]> {
  return apiFetch<{ key: string; label: string; abbr: string }[]>(
    "/api/tickets-reminder/tour-types",
    { cache: "no-store", signal },
  );
}

/** 后端的 key 规则：小写字母开头，字母 / 数字 / _，字母或数字结尾，3–50 个字符。 */
export const TIX_KEY_RE = /^[a-z][a-z0-9_]{1,48}[a-z0-9]$/;

/** 按团名猜一个 key（新建表单预填，建之前还能改）。 */
export function suggestTixKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 50)
    .replace(/_+$/, "");
}
