import { apiFetch } from "@/lib/api-client";

/**
 * Content Studio：邮件 / 短信 / 客人页 / 群发模板的文字。全部 require_admin。
 * ⚠️ **每次保存都是直接改生产库**，下一条发出的短信、邮件、下一次打开的客人页就用新文字；没有历史记录，改了找不回来。
 */
export interface TemplateSetting {
  key: string;
  value: string | null;
  label: string | null;
  /** 不带时区的 UTC 时间（"2026-08-19T18:02:28"）；从没改过为 null。 */
  updated_at: string | null;
  updated_by: string | null;
}

export function fetchTemplateSettings(
  signal?: AbortSignal,
): Promise<TemplateSetting[]> {
  return apiFetch<TemplateSetting[]>("/api/template-settings", {
    cache: "no-store",
    signal,
  });
}

/** 只能改已经存在的键（没有的 404）；键必须以 tmpl__ 开头（否则 400）。 */
export async function saveTemplateSetting(
  key: string,
  value: string,
): Promise<void> {
  await apiFetch("/api/template-settings/save", {
    method: "POST",
    body: { key, value },
  });
}

/**
 * 门票客人页「Prepare for Your Tour」框的真实渲染（只读，不写库）。只支持 tix / prep_steps。
 * overrides 是还没保存的值，active_key 会被高亮。
 */
export async function previewTixPrepare(input: {
  tourType: string;
  overrides: Record<string, string>;
  activeKey: string | null;
  signal?: AbortSignal;
}): Promise<string> {
  const result = await apiFetch<{ html: string }>(
    "/api/template-settings/preview",
    {
      method: "POST",
      signal: input.signal,
      body: {
        module: "tix",
        tab: "prep_steps",
        tour_type: input.tourType,
        overrides: input.overrides,
        active_key: input.activeKey,
      },
    },
  );
  return result.html;
}
