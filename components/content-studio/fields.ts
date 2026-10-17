/**
 * Content Studio 的字段清单（照旧页面 settings_templates.html，标签、行数、变量一致）。
 * ⛔ 键名错一个字，保存就会 404（后端只改已有的键）。
 */

export interface TextField {
  key: string;
  label: string;
  rows?: number;
  /** 可以插入的变量，例如 {name}；发出去时换成真实数据。 */
  vars?: string[];
  /** 短信：算字数、不能换行、超 1600 不让存。 */
  sms?: boolean;
  type?: "text" | "dynamic_lines";
  /** dynamic_lines 最多几行。 */
  max?: number;
  hint?: string;
}

export const VAR_WARN =
  "⚠ Do not remove or modify the { } variables — they are replaced with real guest data when sent.";

/** 预览和字数计算用的示例数据（同旧页面）。 */
export const SAMPLE: Record<string, string> = {
  "{name}": "Sarah",
  "{first_name}": "Sarah",
  "{date}": "January 10, 2026",
  "{tour_date}": "January 10, 2026",
  "{label}": "Grand Canyon South Rim Bus Tour",
  "{qty}": "3",
  "{url}": "https://confirm.nationalparkexpress.com/c/example",
  "{sms_label}": "Grand Canyon South Rim Tour",
  "{checkin}": "9:00 AM",
  "{tour_time}": "10:00 AM",
  "{chd}": "CHDEXAMPLE",
};

/** 把 {变量} 换成示例数据（全部替换；旧页面预览只换第一处）。 */
export function fillSample(text: string): string {
  return text.replace(/\{[a-z_]+\}/g, (m) => SAMPLE[m] ?? m);
}

export const TC_TOURS = [
  { key: "upper_antelope", label: "Upper Antelope" },
  { key: "lower_antelope", label: "Lower Antelope" },
  { key: "antelope_x", label: "Antelope X" },
  { key: "grand_canyon_south", label: "GC South Rim" },
  { key: "grand_canyon_west", label: "GC West Rim" },
  { key: "bryce_zion", label: "Bryce & Zion" },
  { key: "valley_of_fire_full", label: "Valley of Fire (Full)" },
  { key: "valley_of_fire_half", label: "Valley of Fire (Half)" },
  { key: "hoover_dam", label: "Hoover Dam" },
] as const;

export const TIX_TOURS = [
  { key: "upper_antelope_tsosie", label: "U-Antelope (Tsosie)" },
  { key: "upper_antelope_brenda", label: "U-Antelope (Brenda)" },
  { key: "upper_antelope_brenda_no_fee", label: "U-Antelope (Brenda, no fee)" },
  { key: "upper_antelope_aact", label: "U-Antelope (AACT)" },
  {
    key: "upper_antelope_hogan_transport",
    label: "U-Antelope (Hogan Transport)",
  },
  { key: "upper_antelope_hogan_hiking", label: "U-Antelope (Hogan Hiking)" },
  { key: "lower_antelope_kens", label: "L-Antelope (Ken's)" },
  { key: "lower_antelope_dixie", label: "L-Antelope (Dixie's)" },
  { key: "canyon_x", label: "Canyon X" },
  { key: "rattlesnake_aact", label: "Rattlesnake (AACT)" },
  { key: "secret_antelope_hbt", label: "Secret Antelope (HBT)" },
  {
    key: "secret_antelope_combo_hbt",
    label: "Combo - Secret Antelope + HB Overlook (C-HBT)",
  },
  // 后端 2026-10-11 `a0d1413`（migrate_v84）新增的三个，名字照旧 settings_templates.html。
  { key: "deer_canyon", label: "Deer Canyon" },
  { key: "sand_dune_canyon", label: "Sand Dune Canyon" },
  { key: "wind_pebble_canyon", label: "Wind Pebble Canyon (Full)" },
] as const;

const g = (k: string) => `tmpl__global__${k}`;

/**
 * MTLV 那 6 个字段：旧页面跟着后端开关 MTLV_GUEST_SELECTION_ENABLED（现在是 False）不显示。
 * 前端拿不到这个开关，先照现状不显示；开关翻回来时这里要改成 true。
 */
export const MTLV_GUEST_ENABLED = false;

export const TC_GLOBAL_FIELDS: TextField[] = [
  {
    key: g("tc_guest_pickup_box_title"),
    label: "Pickup box section title",
    rows: 1,
  },
  {
    key: g("tc_guest_pu_sms_head"),
    label: "Pickup step: SMS reminder — heading",
    rows: 1,
  },
  {
    key: g("tc_guest_pu_sms_text"),
    label: "Pickup step: SMS reminder — body text",
    rows: 2,
  },
  {
    key: g("tc_guest_pu_wrong_number"),
    label: "Pickup step: Wrong number hint",
    rows: 1,
  },
  {
    key: g("tc_guest_pu_head_head"),
    label: 'Pickup step: "Head to location" title',
    rows: 1,
  },
  {
    key: g("tc_guest_pu_depart_warn"),
    label: "Pickup step: Departure warning (red)",
    rows: 1,
  },
  {
    key: g("tc_guest_pu_checkin_head"),
    label: 'Pickup step: "Check in when you arrive" title',
    rows: 1,
  },
  {
    key: g("tc_guest_pu_checkin_text"),
    label: "Pickup step: Check in body text",
    rows: 2,
  },
  {
    key: g("tc_guest_pu_notsure_head"),
    label: 'Pickup step: "Not sure where to go?" title',
    rows: 1,
  },
  {
    key: g("tc_guest_already_submitted"),
    label: '"Already submitted" info box (green)',
    rows: 2,
  },
  { key: g("tc_guest_lunch_title"), label: "Lunch section title", rows: 1 },
  {
    key: g("tc_guest_lunch_hint"),
    label: "Lunch section hint",
    rows: 1,
    vars: ["{qty}"],
  },
  {
    key: g("tc_guest_lunch_default"),
    label: "Lunch default note (small text)",
    rows: 1,
  },
  ...(MTLV_GUEST_ENABLED
    ? [
        { key: g("tc_guest_mtlv_title"), label: "MTLV section title", rows: 1 },
        {
          key: g("tc_guest_mtlv_hint"),
          label: "MTLV hint paragraph",
          rows: 3,
          vars: ["{qty}"],
        },
        {
          key: g("tc_guest_mtlv_bullet_1"),
          label: "MTLV bullet 1 — visit info",
          rows: 3,
        },
        {
          key: g("tc_guest_mtlv_bullet_2"),
          label: "MTLV bullet 2 — disclaimer",
          rows: 3,
        },
        {
          key: g("tc_guest_mtlv_locked_cancelled"),
          label: "MTLV locked — cancelled message",
          rows: 1,
        },
        {
          key: g("tc_guest_mtlv_locked_confirmed"),
          label: "MTLV locked — confirmed message",
          rows: 1,
        },
      ]
    : []),
  { key: g("tc_guest_notes_title"), label: "Notes section title", rows: 1 },
  {
    key: g("tc_guest_notes_placeholder"),
    label: "Notes textarea placeholder",
    rows: 1,
  },
  {
    key: g("tc_guest_last_update_label"),
    label: '"Your last update" label',
    rows: 1,
  },
  { key: g("tc_guest_submit_btn"), label: "Submit button text", rows: 1 },
  { key: g("tc_guest_footer_thanks"), label: "Footer thank you text", rows: 2 },
  {
    key: g("tc_guest_date_modal_title"),
    label: "Date change modal title",
    rows: 1,
  },
  {
    key: g("tc_guest_date_modal_desc"),
    label: "Date change modal description",
    rows: 2,
  },
  {
    key: g("guest_thanks_text"),
    label: "Thank you page body text (after submit)",
    rows: 2,
  },
  { key: g("guest_expired_text"), label: "Expired link page text", rows: 2 },
];

/** 接客步骤顺序卡片插在这个字段后面（同旧页面）。 */
export const PICKUP_ORDER_AFTER = g("tc_guest_pu_notsure_head");
export const PU_ORDER_KEY = g("tc_guest_pickup_order");
export const PU_DEFAULT_ORDER = [
  "sms",
  "location",
  "checkin",
  "notsure",
] as const;
export const PU_STEP_LABELS: Record<string, string> = {
  sms: "📱 Morning of your tour — SMS reminder",
  location: "⏰ Head to your pickup location",
  checkin: "✅ Check in when you arrive",
  notsure: "🗺️ Not sure where to go?",
};

export const TC_EMAIL_FIELDS: TextField[] = [
  { key: g("tc_email_greeting"), label: "Opening greeting", rows: 2 },
  {
    key: g("tc_email_intro"),
    label: "Intro line",
    rows: 2,
    vars: ["{label}", "{date}"],
  },
  { key: g("tc_email_review"), label: "Review / reconfirm line", rows: 2 },
  { key: g("tc_email_closing"), label: "Closing paragraph", rows: 4 },
  {
    key: g("tc_email_link_expiry"),
    label: "Link expiry notice (below CTA button)",
    rows: 2,
  },
  { key: g("tc_email_footer_contact"), label: "Footer contact block", rows: 3 },
];

export const TC_LM_EMAIL_FIELDS: TextField[] = [
  {
    key: g("tc_email_greeting"),
    label: "Opening greeting (shared with main email)",
    rows: 1,
  },
  {
    key: g("tc_lm_email_intro_with_lunch"),
    label: "Intro — tours WITH lunch",
    rows: 2,
  },
  {
    key: g("tc_lm_email_intro_no_lunch"),
    label: "Intro — tours WITHOUT lunch",
    rows: 2,
  },
  { key: g("tc_lm_email_closing"), label: "Closing line", rows: 1 },
  {
    key: g("tc_lm_email_btn_lunch"),
    label: "CTA button — tours with lunch",
    rows: 1,
  },
  {
    key: g("tc_lm_email_btn_no_lunch"),
    label: "CTA button — tours without lunch",
    rows: 1,
  },
  {
    key: g("tc_email_link_expiry"),
    label: "Link expiry notice (shared with main email)",
    rows: 1,
  },
  {
    key: g("tc_email_footer_contact"),
    label: "Footer contact block (shared with main email)",
    rows: 3,
  },
];

export const TC_SMS_FIELDS: TextField[] = [
  {
    key: g("tc_sms_with_lunch"),
    label: "SMS body — tours WITH lunch",
    rows: 4,
    sms: true,
    vars: ["{name}", "{label}", "{date}", "{url}"],
  },
  {
    key: g("tc_sms_no_lunch"),
    label: "SMS body — tours WITHOUT lunch",
    rows: 4,
    sms: true,
    vars: ["{name}", "{label}", "{date}", "{url}"],
  },
];

export function tcGuestFields(t: string): TextField[] {
  return [
    {
      key: `tmpl__tc__${t}__reminders`,
      label: "Important Reminders (one bullet per line)",
      rows: 5,
    },
    {
      key: `tmpl__tc__${t}__extra_reminders`,
      label: "Tour-specific extra reminders",
      type: "dynamic_lines",
      max: 3,
    },
    ...(t === "grand_canyon_south" || t === "bryce_zion"
      ? [
          {
            key: `tmpl__tc__${t}__park_fee_nonresident`,
            label: "Park fee — non-US residents",
            rows: 2,
          },
          {
            key: `tmpl__tc__${t}__park_fee_resident`,
            label: "Park fee — US residents",
            rows: 2,
          },
        ]
      : []),
    ...(t === "grand_canyon_south"
      ? [
          {
            key: `tmpl__tc__${t}__lunch_extra_note`,
            label:
              "Lunch section — extra note (shown after the lunch hint, this tour only)",
            rows: 2,
          },
        ]
      : []),
  ];
}

export const TIX_GLOBAL_FIELDS: TextField[] = [
  {
    key: g("tix_general_reminder"),
    label:
      "Know Before You Go — General Reminder (one item per line; 3–4 lines recommended)",
    type: "dynamic_lines",
    max: 10,
    hint: 'Shared across all tours. For tour-specific items, edit that tour\'s "Tour-Specific Information" instead.',
  },
  {
    key: g("tix_email_warning"),
    label: "Warning box — late check-in / timezone (one item per line)",
    rows: 3,
  },
  // 后端 2026-10-08 `e584ceb`（tix-az-note-editable）：原来写死的 Arizona 说明和时钟标签改成可编辑。清空 = 客人看不到这一行。
  {
    key: g("tix_az_note"),
    label:
      "Arizona timezone note (email + guest page, below Check-in / Tour Time)",
    rows: 2,
  },
  {
    key: g("tix_az_clock_label"),
    label:
      "Guest page live-clock label (the number itself is computed live, not stored here)",
    rows: 1,
  },
  {
    key: g("tix_guest_cfm_note"),
    label: "Confirmation# note on guest page",
    rows: 2,
  },
  {
    key: g("tix_guest_checkin_note"),
    label: "Check-in note — tours with no Confirmation# (email + guest page)",
    rows: 2,
  },
  {
    key: g("tix_guest_already_info"),
    label: '"If you have questions" info box (green box)',
    rows: 3,
  },
  {
    key: g("tix_guest_checkbox_text"),
    label: "Checkbox / confirmation statement",
    rows: 2,
  },
  { key: g("tix_guest_submit_btn"), label: "Submit button text", rows: 1 },
  { key: g("tix_guest_thanks_small"), label: "Thank you footer text", rows: 2 },
  { key: g("tix_guest_prepare_title"), label: "Prepare box — title", rows: 1 },
  {
    key: g("tix_guest_prepare_intro"),
    label: "Prepare box — intro paragraph",
    rows: 3,
  },
  {
    key: g("tix_thanks_message"),
    label: "Thank-you page message (use {date})",
    rows: 3,
    vars: ["{date}"],
  },
  { key: g("tix_expired_title"), label: "Expired link page — title", rows: 1 },
  {
    key: g("tix_expired_message"),
    label: "Expired link page — message (one item per line)",
    rows: 3,
  },
  {
    key: g("tix_staffmail_subject"),
    label: "Staff email — subject (use {chd} {label} {date})",
    rows: 1,
    vars: ["{chd}", "{label}", "{date}"],
  },
  { key: g("tix_staffmail_title"), label: "Staff email — heading", rows: 1 },
];

export const TIX_EMAIL_FIELDS: TextField[] = [
  { key: g("tix_email_intro"), label: "Intro paragraph", rows: 2 },
  {
    key: g("tix_email_cta_desc"),
    label: "Paragraph above CTA button",
    rows: 3,
  },
  { key: g("tix_email_cta_btn"), label: "CTA button text", rows: 1 },
  {
    key: g("tix_email_link_expiry"),
    label: "Link expiry notice (below CTA button)",
    rows: 2,
  },
  {
    key: g("tix_email_resource_weather"),
    label: "Resource link text — Local Time & Weather",
    rows: 1,
  },
  {
    key: g("tix_email_resource_photo"),
    label: "Resource link text — Location Photo",
    rows: 1,
  },
  { key: g("tix_email_questions"), label: "Questions / contact line", rows: 2 },
  { key: g("tix_email_footer"), label: "Footer text", rows: 2 },
];

export const TIX_SMS_FIELDS: TextField[] = [
  {
    key: g("tix_sms_body"),
    label: "SMS body",
    rows: 4,
    sms: true,
    vars: [
      "{name}",
      "{sms_label}",
      "{date}",
      "{checkin}",
      "{tour_time}",
      "{url}",
    ],
  },
];

export function tixGuestFields(t: string): TextField[] {
  return [
    {
      key: `tmpl__tix__${t}__checkin_location`,
      label: "Check-in location",
      rows: 2,
    },
    // 不是客人文案：门票发送页上传没有 Check-in Time 的 Rezdy 原文件时用（后端 37f4020，migrate_v75 seed）。
    {
      key: `tmpl__tix__${t}__checkin_minutes`,
      label: "Check-in minutes before tour time",
      rows: 1,
      hint: "Not shown to guests. Used on Tickets Reminder — Send when a file has no Check-in Time, such as the Rezdy CSV: 50 means a 9:40 AM tour checks in at 8:50 AM. Whole minutes only. Leave blank and such files are refused for this tour.",
    },
    { key: `tmpl__tix__${t}__maps_url`, label: "Google Maps URL", rows: 1 },
    {
      key: `tmpl__tix__${t}__apple_maps_url`,
      label: "Apple Maps URL (leave blank to hide)",
      rows: 1,
    },
    {
      key: `tmpl__tix__${t}__location_photo`,
      label: "Location photo URL",
      rows: 1,
    },
    {
      key: `tmpl__tix__${t}__extra_notes`,
      label: "Tour-Specific Information",
      type: "dynamic_lines",
      max: 3,
    },
  ];
}

/** 门票「Prepare for Your Tour」最多 3 步，每步 3 个键。 */
export const PREP_STEPS = 3;
export const prepKey = (t: string, n: number, part: "label" | "url" | "note") =>
  `tmpl__tix__${t}__prep_${n}_${part}`;

// ── Farm out Notice（转单通知） ──────────────────────────────────────────────
// Annie 两轮 HTML 样稿已批准（2026-10 mock round 2）：主色 #475569（深蓝灰），
// 不是第一轮样稿截图里的紫色——那版已作废。

/**
 * 合作方名单：真正的接口是 Settings → Farm out Partners（另一个窗口在建，见 lib/farm-out-api.ts /
 * types/farm-out.ts），这两个仓库文件此模块故意不 import，避免并行开发期间互相耦合。
 * 这里先本地写死两个示例名字；接上后端后，应该把这个列表换成从 Settings → Farm out Partners 的 API 拿，
 * 不再写死在这个文件里。
 */
export const FARMOUT_PARTNERS = ["Partner A", "Partner B"] as const;

/** 合作方名字 → 键名用的 slug（"Partner A" → "partner_a"）。 */
export function farmoutSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const FARMOUT_DEFAULT_VERSION = "default";

/** Default + 每个合作方一个版本（版本选择器用的 pills）。 */
export const FARMOUT_VERSIONS: { key: string; label: string }[] = [
  { key: FARMOUT_DEFAULT_VERSION, label: "Default" },
  ...FARMOUT_PARTNERS.map((p) => ({ key: farmoutSlug(p), label: p })),
];

/**
 * ⚠️ 后端目前只接受已经存在的键，没种过的键保存时 404（同 Content Studio 其它模块）。
 * 接真后端前，Default + 每个合作方各 3 个键（email_subject / email_body / sms_body）要先在后端种好，
 * 否则每个合作方版本的 Save 都会报 "Settings key not seeded"。
 */
export const farmoutKey = (
  version: string,
  part: "email_subject" | "email_body" | "sms_body",
) => `tmpl__farmout__${version}__${part}`;

export const FARMOUT_VARS = [
  "{first_name}",
  "{tour_name}",
  "{tour_date}",
  "{pickup_spot}",
  "{checkin_time}",
  "{depart_time}",
  "{please_note}",
  "{return_time}",
  "{pickup_full_name}",
  "{pickup_address}",
  "{map_link}",
];

/** 一个版本（Default 或某合作方）的某个字段定义：标签带版本名，方便预览区显示。 */
export function farmoutField(
  version: string,
  versionLabel: string,
  part: "email_subject" | "email_body" | "sms_body",
): TextField {
  const key = farmoutKey(version, part);
  if (part === "email_subject") {
    return { key, label: `Email subject (${versionLabel})`, rows: 1, vars: FARMOUT_VARS };
  }
  if (part === "email_body") {
    return { key, label: `Email body (${versionLabel})`, rows: 10, vars: FARMOUT_VARS };
  }
  return {
    key,
    label: `SMS body (${versionLabel})`,
    rows: 4,
    sms: true,
    vars: FARMOUT_VARS,
  };
}

/** 预览 / Preview 面板找标签用：每个版本的 3 个字段都列一遍。 */
export function farmoutFieldEntries(): TextField[] {
  const out: TextField[] = [];
  for (const v of FARMOUT_VERSIONS) {
    out.push(farmoutField(v.key, v.label, "email_subject"));
    out.push(farmoutField(v.key, v.label, "email_body"));
    out.push(farmoutField(v.key, v.label, "sms_body"));
  }
  return out;
}

/**
 * 预览用的示例数据（Annie 批准的样稿第二轮用的那套，和其它模块的 SAMPLE 不是一套、变量名也不同）。
 */
export const FARMOUT_SAMPLE: Record<string, string> = {
  "{first_name}": "Wei",
  "{tour_name}": "Grand Canyon West Rim",
  "{tour_date}": "Thursday, October 16",
  "{pickup_spot}": "Bellagio South Tour Lobby",
  "{checkin_time}": "6:40 AM",
  "{depart_time}": "6:50 AM",
  "{please_note}":
    "Due to recent safety concerns, backpacks and large bags are not permitted inside the Grand Canyon (You may leave it on the bus while at the Grand Canyon) Hoover Dam security prohibits us from transporting or storing luggage on the bus.",
  "{return_time}": "5:00- 6:30 PM",
  "{pickup_full_name}": "Bellagio Hotel & Casino , Underground South Tour Lobby",
  "{pickup_address}": "3600 S Las Vegas Blvd, Las Vegas, NV 89109",
  "{map_link}": "https://goo.gl/maps/SpW2EnpwM55Hvr637",
};

/**
 * 换成示例数据给 Farm out Notice 预览用（不是 fillSample：那个只做逐字替换，不会删空行）。
 * 一行里出现的变量全部是空值时，整行（连标签文字一起）都不显示——现在只有
 * "PLEASE NOTE:  {please_note}" 会用到，但规则是通用的：哪一行全靠变量撑着、变量又是空的，就不该剩一行空文字。
 */
export function renderFarmoutTemplate(
  text: string,
  sample: Record<string, string> = FARMOUT_SAMPLE,
): string {
  return text
    .split("\n")
    .filter((line) => {
      const vars = line.match(/\{[a-z_]+\}/g);
      if (!vars) return true;
      return !vars.every((v) => !(sample[v] ?? "").trim());
    })
    .map((line) => line.replace(/\{[a-z_]+\}/g, (m) => sample[m] ?? m))
    .join("\n");
}

// ── 群发模板 ────────────────────────────────────────────────────────────────

export type BroadcastSet = "tour" | "tix";
export const BC_SLOTS = 8;
/** 前 4 个是内置模板：能改名、改正文，不能删（Annie 2026-08-19 定）。 */
export const BC_BUILTIN = 4;
export const BC_VARS = ["{first_name}", "{tour_date}"];
export const bcTitleKey = (set: BroadcastSet, i: number) =>
  `tmpl__bcast__${set}__t${i}__title`;
export const bcBodyKey = (set: BroadcastSet, i: number) =>
  `tmpl__bcast__${set}__t${i}__body`;
export const bcSigKey = (set: BroadcastSet) => `tmpl__bcast__${set}__signature`;
