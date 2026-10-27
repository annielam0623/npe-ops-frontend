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
  /** 只许用 vars 里的变量：写了别的 {xxx}（打错字）就标红、不让存（Farm out Notice 用）。 */
  strictVars?: boolean;
  /** 链接格：不是 http(s) 开头就提示「客人看不到」（照存，不拦）。 */
  url?: boolean;
  /** 短信字数按这份示例算（覆盖 SAMPLE 里的同名项）。 */
  smsSample?: Record<string, string>;
  /** 短信字数条 + 要拆成几条短信的提示（Farm out Notice 用）。 */
  smsMeter?: boolean;
  /** Reset to Default：把这一格的草稿换成这个键已保存的值（非 Default 的 Farm out 版本用）。 */
  resetKey?: string;
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
  // Farm out Notice 的短信字数按这些算（{please_note} 按空算：每个团的注意事项长短不一）。
  "{tour_name}": "Grand Canyon West Rim",
  "{pickup_spot}": "Bellagio South Tour Lobby",
  "{checkin_time}": "6:40 AM",
  "{depart_time}": "6:50 AM",
  "{please_note}": "",
  "{return_time}": "5:00- 6:30 PM",
  "{pickup_full_name}":
    "Bellagio Hotel & Casino , Underground South Tour Lobby",
  "{pickup_address}": "3600 S Las Vegas Blvd, Las Vegas, NV 89109",
  "{map_link}": "https://goo.gl/maps/SpW2EnpwM55Hvr637",
  "{pickup_time}": "6:40 AM",
};

/**
 * Shuttle 模板的 Insert 变量（Annie 2026-10-26 定四组：客人名 + 日期、接客时间 + 接客点 + 地图、人数；
 * 名字沿用已有的同义变量，只有 {pickup_time} 是新的）。
 * {url} = 确认链接：Annie 2026-10-26 晚改回保留 guest page——短信和邮件都放同一条链接，
 * 客人点开就进 guest page，照门票做法点开即算 yes（后端 G189）。
 */
export const SHUTTLE_VARS = [
  "{name}",
  "{date}",
  "{pickup_time}",
  "{pickup_spot}",
  "{map_link}",
  "{url}",
  "{qty}",
];

/**
 * Shuttle 两层（Annie 2026-10-27「动手」，preview https://claude.ai/artifact/UDTdCZUSMuxkcgUWh7g7eB 第 4 版）。
 * 下面的 key 只用来**认**接口返回的是哪一格（放哪个标签、Preview 放哪里）；保存一律用接口返回的 key，不自己拼（8a）。
 */
export const SHUTTLE_SHARED_KEYS = {
  sms: "tmpl__global__shuttle_sms_body",
  email: "tmpl__global__shuttle_email_body",
  guest: "tmpl__global__shuttle_guest_page_body",
} as const;
/** 客人看到的标题 / 链接文字（公共、可选；空着用接口给的 default）。界面上的名字照 preview。 */
export const SHUTTLE_LABEL_KEYS = {
  heading: "tmpl__global__shuttle_route_heading",
  maps: "tmpl__global__shuttle_maps_label",
  apple: "tmpl__global__shuttle_apple_maps_label",
  photo: "tmpl__global__shuttle_photo_label",
} as const;
export const SHUTTLE_LABEL_NAMES: Record<string, string> = {
  [SHUTTLE_LABEL_KEYS.heading]: "Section title",
  [SHUTTLE_LABEL_KEYS.maps]: "Google Maps link",
  [SHUTTLE_LABEL_KEYS.apple]: "Apple Maps link",
  [SHUTTLE_LABEL_KEYS.photo]: "Location photo link",
};
/** 每条线追加内容的 key 最后一段（`tmpl__shuttle__{code}__{这里}`）。 */
export type ShuttleRoutePart =
  "route_info" | "maps_url" | "apple_maps_url" | "location_photo";
export const SHUTTLE_ROUTE_PARTS: readonly ShuttleRoutePart[] = [
  "route_info",
  "maps_url",
  "apple_maps_url",
  "location_photo",
];
export function shuttleRoutePart(key: string): ShuttleRoutePart | null {
  const last = key.split("__").pop() ?? "";
  return (SHUTTLE_ROUTE_PARTS as readonly string[]).includes(last)
    ? (last as ShuttleRoutePart)
    : null;
}
/** 后端只显示 http(s) 且有主机名的链接（别的照存，但客人看不到；例如「http:javascript:…」「https:\\x」）。 */
export function isWebLink(s: string): boolean {
  const t = s.trim();
  if (!/^https?:\/\/[^\s/\\?#]/i.test(t) || /\s/.test(t)) return false;
  try {
    const u = new URL(t);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

/** Shuttle Preview 的示例数据（同 preview：ZZ Test Dev、Oct 28、Excalibur）。 */
export const SHUTTLE_SAMPLE: Record<string, string> = {
  "{name}": "Dev",
  "{date}": "October 28, 2026",
  "{pickup_time}": "5:30 AM",
  "{pickup_spot}": "Excalibur Tour Lobby",
  "{map_link}": "https://goo.gl/maps/Exc4l1bur",
  "{url}": "https://confirm.nationalparkexpress.com/s/9Kd4",
  "{qty}": "1",
};
export const SHUTTLE_SUBJECT_NOTE =
  "The subject is the same for every shuttle, like Tour emails: Shuttle Confirmation — product name — date [order #]. Nothing to fill in here.";

/** 把 {变量} 换成示例数据（全部替换；旧页面预览只换第一处）。 */
export function fillSample(
  text: string,
  sample: Record<string, string> = SAMPLE,
): string {
  return text.replace(/\{[a-z_]+\}/g, (m) => sample[m] ?? m);
}

/** 文字里写了、但不在允许清单里的 {变量}（去重，按出现顺序）。 */
export function unknownVars(
  text: string,
  allowed: readonly string[],
): string[] {
  const out: string[] = [];
  for (const m of text.match(/\{[A-Za-z0-9_]*\}/g) ?? []) {
    if (!allowed.includes(m) && !out.includes(m)) out.push(m);
  }
  return out;
}

/** 短信拆成几条：GSM-7 单条 160，拆开后每条 153。 */
export function smsSegments(length: number): number {
  return length <= 160 ? 1 : Math.ceil(length / 153);
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

// ── Farm out Notice（转单通知，每家合作公司一份）─────────────────────────────

/**
 * 键名 `tmpl__farmout__<slug>__<field>`，Default 的 slug 是 "default"（后端草稿 2026-10-16：
 * 新公司建号时程序从 default 复制，不在迁移里预插）。
 */
export type FarmOutField = "email_subject" | "email_body" | "sms_body";
export const foKey = (slug: string, field: FarmOutField) =>
  `tmpl__farmout__${slug}__${field}`;

/** 反过来拆键名；不是 Farm out 的键返回 null。 */
export function parseFoKey(
  key: string,
): { slug: string; field: FarmOutField } | null {
  const m = /^tmpl__farmout__(.+)__(email_subject|email_body|sms_body)$/.exec(
    key,
  );
  return m ? { slug: m[1], field: m[2] as FarmOutField } : null;
}

/** 变量说明表（Content Studio 里的 Variables）。 */
export const FO_VAR_INFO: { v: string; meaning: string }[] = [
  { v: "{first_name}", meaning: "Guest's first name" },
  { v: "{tour_name}", meaning: "Tour name" },
  { v: "{tour_date}", meaning: "Tour date" },
  { v: "{pickup_spot}", meaning: "Short pick-up name" },
  { v: "{checkin_time}", meaning: "Arrive-by time" },
  { v: "{depart_time}", meaning: "Time the bus leaves" },
  {
    v: "{please_note}",
    meaning: "Per-tour notice. If the tour has none, the whole line is removed",
  },
  { v: "{return_time}", meaning: "Estimated return time" },
  { v: "{pickup_full_name}", meaning: "Full pick-up location name" },
  { v: "{pickup_address}", meaning: "Pick-up street address" },
  { v: "{map_link}", meaning: "Google Maps link to the pick-up" },
];

export const FO_VARS = [
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

/** 默认文字：邮件正文 = 任务包「通知模板」原文（占位换成变量），标题和短信是 Annie 2026-10-15 确认的起始文字。 */
export const FO_DEFAULTS: Record<FarmOutField, string> = {
  email_subject: "Your {tour_name} pick-up on {tour_date}",
  email_body: `Thank you for choosing to join us on our {tour_name} on {tour_date}!

Please arrive at the {pickup_spot} by {checkin_time} for boarding. The bus will depart at {depart_time} to ensure the tour remains on schedule for all guests; the vehicle cannot wait for late arrivals.

PLEASE NOTE:  {please_note}

Departure Time : {depart_time}
Estimated return time: {return_time}
Location: {pickup_full_name}
{pickup_address}
Google Map Link to your Pick-Up Location : Ensure your mobile device has location permissions set to allow GPS tracking
{map_link}

If you have any questions please call us at 702-420-3156, thank you!`,
  sms_body:
    "Dear {first_name}, your {tour_name} on {tour_date}: please be at {pickup_spot} by {checkin_time}. The bus leaves at {depart_time} and cannot wait. {please_note} Map: {map_link} Questions: 702-420-3156",
};

/** 预览用样例（任务包样例值：西峡谷、Bellagio、Oct 16）。 */
export const FO_SAMPLE: Record<string, string> = {
  "{first_name}": "Wei",
  "{tour_name}": "Grand Canyon West Rim",
  "{tour_date}": "Thursday, October 16",
  "{pickup_spot}": "Bellagio South Tour Lobby",
  "{checkin_time}": "6:40 AM",
  "{depart_time}": "6:50 AM",
  "{please_note}":
    "Due to recent safety concerns, backpacks and large bags are not permitted inside the Grand Canyon (You may leave it on the bus while at the Grand Canyon) Hoover Dam security prohibits us from transporting or storing luggage on the bus.",
  "{return_time}": "5:00- 6:30 PM",
  "{pickup_full_name}":
    "Bellagio Hotel & Casino , Underground South Tour Lobby",
  "{pickup_address}": "3600 S Las Vegas Blvd, Las Vegas, NV 89109",
  "{map_link}": "https://goo.gl/maps/SpW2EnpwM55Hvr637",
};

/**
 * 换成示例数据给 Farm out Notice 预览用。一行里出现的变量全部是空值时整行（连标签文字）都不显示——
 * 目前只有 "PLEASE NOTE:  {please_note}" 会用到（该团没填注意事项，通知里整段不出现），规则是通用的。
 */
export function fillFarmOut(
  text: string,
  sample: Record<string, string> = FO_SAMPLE,
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

/**
 * longestNote：所有团里最长的 PLEASE NOTE（读不到就不传，按空算）。
 * 短信字数按它算，注意事项再长也不会把短信顶过 300。
 */
export function foFields(
  slug: string,
  tab: "Email" | "SMS",
  longestNote = "",
): TextField[] {
  const resetFor = (f: FarmOutField) =>
    slug === "default" ? undefined : foKey("default", f);
  if (tab === "SMS") {
    return [
      {
        key: foKey(slug, "sms_body"),
        label: "SMS text",
        rows: 6,
        sms: true,
        smsMeter: true,
        strictVars: true,
        smsSample: { "{please_note}": longestNote },
        resetKey: resetFor("sms_body"),
        vars: FO_VARS,
        hint: longestNote
          ? "Counted with the longest PLEASE NOTE of all tours, so a long note can't push it over the limit."
          : "Counted with {please_note} left empty, because the note changes per tour.",
      },
    ];
  }
  return [
    {
      key: foKey(slug, "email_subject"),
      label: "Email subject",
      rows: 1,
      vars: FO_VARS,
      strictVars: true,
      resetKey: resetFor("email_subject"),
    },
    {
      key: foKey(slug, "email_body"),
      label: "Email body",
      rows: 16,
      vars: FO_VARS,
      strictVars: true,
      resetKey: resetFor("email_body"),
    },
  ];
}
