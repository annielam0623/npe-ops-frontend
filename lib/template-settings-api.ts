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

/**
 * G299 / 128：Tour Confirmation 客人页整页（真 _render + GUEST_CSS，示例客人 John / 2 人 / SAMPLE123）。只读，不写库。
 * overrides 是还没保存的草稿（只带改过的键）。回来的 html 带编辑标记（data-tmpl-key / data-empty / data-preview-state /
 * data-pickup-step / data-add-slot），没有 <script>。
 * ⚠️ 安全要求 SA-1：只能放进 sandbox="allow-same-origin" 的 iframe（srcdoc），不加 allow-scripts / allow-popups / allow-forms；
 *    绝不把 html 或任何 tmpl__ 值当 HTML 放进父页面（编辑框用 textContent / value）。
 */
export interface TcSamplePickup {
  id: number;
  name: string;
  /** 「Tour bus departure」那一站（排第一个，Default 用它）。 */
  departure: boolean;
}

export interface TcGuestPagePreview {
  html: string;
  /** G320：Sample pickup 下拉的地点（启用中的 Pickup locations，出发站排第一）。旧后端没有 = []。 */
  sample_pickups: TcSamplePickup[];
  /** 这次用的是哪个：choice = "" / "variable" / id 字符串。 */
  sample_pickup: {
    choice: string;
    location_id: number | null;
    pickup_time: string | null;
  } | null;
}

/**
 * G320（后端 a8f0ce4a，契约 docs/interfaces/g320-guest-sample-2026-11-23.md）：pickupLocation 只影响这一张示例，不存。
 * "" = 默认（出发站 + 这个团真的接客时间）；"variable" = 全部紫色虚线变量；"<id>" = 那家酒店。
 * 每位客人不同的值（日期、单号、名字、人数、电话、接客地点 / 时间、Where to meet、地图）在 html 里是
 * span.gf-var / div.gf-var-box（data-sample-var，不带 data-tmpl-key，点击编辑不理它们）。
 */
export async function previewTcGuestPage(input: {
  tourType: string;
  overrides: Record<string, string>;
  pickupLocation?: string;
  signal?: AbortSignal;
}): Promise<TcGuestPagePreview> {
  const result = await apiFetch<Partial<TcGuestPagePreview> & { html: string }>(
    "/api/template-settings/preview",
    {
      method: "POST",
      signal: input.signal,
      body: {
        module: "tc",
        tab: "guest_page",
        tour_type: input.tourType,
        overrides: input.overrides,
        pickup_location: input.pickupLocation ?? "",
      },
    },
  );
  return {
    html: result.html,
    sample_pickups: Array.isArray(result.sample_pickups)
      ? result.sample_pickups
      : [],
    sample_pickup: result.sample_pickup ?? null,
  };
}
