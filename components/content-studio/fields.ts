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
