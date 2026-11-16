// 模拟后端：Content Studio。控制：POST /__ctl {fail401, staff}；GET /__log。
const http = require("http");
const ctl = { fail401: false, staff: false, shuttleCreateFail: "", shuttlePatchFail: "", shuttleProducts: false, shuttleProductsFail: 0, tixTypes: 403 };
const log = [];
const s = (key, value, by = null) => ({ key, value, label: null, updated_at: by ? "2026-08-19T18:02:28.452768" : null, updated_by: by });
const settings = [
  s("tmpl__global__tc_sms_with_lunch", "Hi {name}, confirm {label} on {date}: {url}", "annie"),
  s("tmpl__global__tc_sms_no_lunch", "Hi {name}: {url}"),
  s("tmpl__global__tc_email_intro", "Your {label} is on {date}."),
  s("tmpl__global__tc_email_greeting", "Hello"),
  s("tmpl__global__tc_guest_pickup_order", "location,sms"),
  s("tmpl__global__tc_guest_pu_notsure_head", "Not sure?"),
  s("tmpl__global__tix_general_reminder", "Bring ID\nArrive early"),
  s("tmpl__tix__upper_antelope_tsosie__prep_1_label", "Buy permit"),
  s("tmpl__tix__upper_antelope_tsosie__prep_1_url", "https://x"),
  s("tmpl__tix__upper_antelope_tsosie__prep_1_note", ""),
  s("tmpl__tix__upper_antelope_tsosie__prep_2_label", ""),
  s("tmpl__tix__upper_antelope_tsosie__prep_2_url", "https://keep-me"),
  s("tmpl__tix__upper_antelope_tsosie__prep_2_note", ""),
  s("tmpl__tix__upper_antelope_tsosie__prep_3_label", ""),
  s("tmpl__tix__upper_antelope_tsosie__prep_3_url", ""),
  s("tmpl__tix__upper_antelope_tsosie__prep_3_note", ""),
];
for (const set of ["tour", "tix"]) {
  for (let i = 1; i <= 8; i++) {
    settings.push(s(`tmpl__bcast__${set}__t${i}__title`, i <= 4 ? `Built-in ${i}` : i === 5 ? "Custom five" : ""));
    // tour 3 号存着特殊字符（短信 300 字 / 特殊字符规矩之前存的）：照常显示，只在存的时候拦。
    settings.push(s(`tmpl__bcast__${set}__t${i}__body`, set === "tour" && i === 3 ? "Hi {first_name} – “3”" : i <= 5 ? `Hi {first_name} ${i}` : ""));
  }
  settings.push(s(`tmpl__bcast__${set}__signature`, "- NPE"));
}
// Farm out Notice：Default + Partner A（自己的标题）+ Partner B（和 Default 一样）+ 已停用的 Old Co（不该出现）。
const FO_BODY = "Thank you for choosing to join us on our {tour_name} on {tour_date}!\n\nPLEASE NOTE:  {please_note}\n\n{map_link}";
const FO_SMS = "Dear {first_name}, your {tour_name} on {tour_date}: be at {pickup_spot} by {checkin_time}. Map: {map_link}";
const foPartners = [
  { id: 1, name: "Partner A", slug: "partner_a", is_active: true },
  { id: 2, name: "Partner B", slug: "partner_b", is_active: true },
  { id: 3, name: "Old Co", slug: "old_co", is_active: false },
];
for (const slug of ["default", "partner_a", "partner_b", "old_co"]) {
  settings.push(s(`tmpl__farmout__${slug}__email_subject`, slug === "partner_a" ? "A: your {tour_name} pick-up" : "Your {tour_name} pick-up on {tour_date}"));
  settings.push(s(`tmpl__farmout__${slug}__email_body`, FO_BODY));
  settings.push(s(`tmpl__farmout__${slug}__sms_body`, FO_SMS));
}
// Shuttle（G128）：1 个 shuttle group、2 个方向；outbound 的 4 个字段里有两个已经填过内容
// （测「显示已存的值」），inbound 和没填过的字段留空（测占位 / 空字符串回退）。
let shuttleRoutes = [
  { id: 1, manifest_id: 10, direction: "outbound", label: "Boulder City Shuttle — Outbound", sort_order: 1, is_active: true, group_name: "boulder_city", group_display_name: "Boulder City Shuttle" },
  { id: 2, manifest_id: 10, direction: "inbound", label: "Boulder City Shuttle — Inbound", sort_order: 2, is_active: true, group_name: "boulder_city", group_display_name: "Boulder City Shuttle" },
];
const shuttleGroups = [
  { id: 10, name: "boulder_city", display_name: "Boulder City Shuttle", is_active: true },
  { id: 11, name: "page", display_name: "Page Shuttle", is_active: true },
];
let nextShuttleId = 3;
settings.push(s("tmpl__shuttle__boulder_city__outbound__sms_body", "Hi {first_name}, your Boulder City shuttle departs soon.", "annie"));
settings.push(s("tmpl__shuttle__boulder_city__outbound__email_subject", "Your Boulder City Shuttle confirmation", "annie"));
settings.push(s("tmpl__shuttle__boulder_city__outbound__email_body", ""));
settings.push(s("tmpl__shuttle__boulder_city__outbound__guest_page_body", ""));
settings.push(s("tmpl__shuttle__boulder_city__inbound__sms_body", ""));
settings.push(s("tmpl__shuttle__boulder_city__inbound__email_subject", ""));
settings.push(s("tmpl__shuttle__boulder_city__inbound__email_body", ""));
settings.push(s("tmpl__shuttle__boulder_city__inbound__guest_page_body", ""));

// Shuttle 两层（后端 8a task/g189-shuttle-shared 的形状）：ctl.shuttleProducts = true 才有这个接口，否则 404（= 旧后端）。
// shared：短信 / 邮件已填，客人页文字空着（= 公共部分没填齐）；4 个标题 / 链接文字预填默认。
// 每条线 4 格追加：BZSO 的 route_info 只在接口里有值；BCRT 4 格都填了；BZND 带 error。
const SH_VARS = ["{name}", "{date}", "{pickup_time}", "{pickup_spot}", "{map_link}", "{url}", "{qty}"];
const shuttleShared = () => ({
  fields: [
    { key: "tmpl__global__shuttle_sms_body", label: "SMS body", rows: 4, value: "Hi {name}, your shuttle on {date}: pickup {pickup_time} at {pickup_spot}. Confirm: {url}", vars: SH_VARS },
    { key: "tmpl__global__shuttle_email_body", label: "Email body", rows: 6, value: "Thank you for booking your shuttle. Be at {pickup_spot} before {pickup_time}.", vars: SH_VARS },
    { key: "tmpl__global__shuttle_guest_page_body", label: "Guest page text", rows: 4, value: "", vars: SH_VARS },
  ],
  text_fields: [
    { key: "tmpl__global__shuttle_route_heading", label: "Route information heading", rows: 1, value: "Route Information", default: "Route Information" },
    { key: "tmpl__global__shuttle_maps_label", label: "Google Maps link text", rows: 1, value: "Google Maps", default: "Google Maps" },
    { key: "tmpl__global__shuttle_apple_maps_label", label: "Apple Maps link text", rows: 1, value: "Apple Maps", default: "Apple Maps" },
    { key: "tmpl__global__shuttle_photo_label", label: "Location photo link text", rows: 1, value: "Location photo", default: "Location photo" },
  ],
  missing: ["Guest page text"],
  complete: false,
});
const SF = [["route_info", "Route-Specific Information", "dynamic_lines"], ["maps_url", "Google Maps URL", "url"], ["apple_maps_url", "Apple Maps URL (leave blank to hide)", "url"], ["location_photo", "Location photo URL", "url"]];
const shuttleProd = (code, name, direction, values = {}, error) => ({
  product_code: code, product_name: name, direction, is_active: true, sendable: false, ...(error ? { error } : {}),
  fields: SF.map(([f, label, type]) => ({ key: `tmpl__shuttle__${code.toLowerCase()}__${f}`, label, rows: 1, type, value: values[f] || "" })),
});
// Page：Products 里设了团颜色（manifest-setup 给）；BZ：没设颜色（灰）；Boulder City：Shuttle 接口自己带 color。
const shuttleGroupsV2 = () => [
  { manifest_id: 1, group_name: "page", group_display_name: "Page", sort_order: 1, products: [
    shuttleProd("PGLV", "One-way Shuttle: Las Vegas to Page", "inbound"),
    shuttleProd("PGBR", "One-way Shuttle: Page to Bryce Canyon", "outbound"),
    shuttleProd("PGVG", "One-way Shuttle: Page to Las Vegas", "outbound"),
    shuttleProd("PGBI", "One-way Shuttle: Bryce Canyon to Page", "inbound"),
  ] },
  { manifest_id: 2, group_name: "bz", group_display_name: "BZ", sort_order: 2, products: [
    shuttleProd("BZWO", "One-way Shuttle: Bryce Canyon Area to Zion National Park, Winter Schedule", "outbound"),
    shuttleProd("BZSO", "One-way Shuttle: Bryce Canyon Area to Zion National Park, Summer Schedule", "outbound", { route_info: "BZ summer line (value only from the products API)" }),
    shuttleProd("BZND", "One-way Shuttle: Zion National Park to Page", "tour", {}, "This product code is not set up for sending."),
  ] },
  { manifest_id: 3, group_name: "boulder_city", group_display_name: "Boulder City", sort_order: 3, color: "#9d98ae", products: [
    shuttleProd("BCRT", "Boulder City Shuttle", "roundtrip", { route_info: "Meet at the lobby\nBring ID", maps_url: "https://maps.app.goo.gl/bc", apple_maps_url: "https://maps.apple.com/?q=bc", location_photo: "https://x/bc.jpg" }),
  ] },
];
const setupGroupsV2 = [
  { id: 1, display_name: "Page", is_active: true, manifest_color: "#4e617e", manifest_lunch_note: null, guests_per_bus: 54, forecast_split_sections: [], section_order: [], extras: [], products: [] },
  { id: 2, display_name: "BZ", is_active: true, manifest_color: null, manifest_lunch_note: null, guests_per_bus: 54, forecast_split_sections: [], section_order: [], extras: [], products: [] },
  { id: 3, display_name: "Boulder City", is_active: true, manifest_color: "#111111", manifest_lunch_note: null, guests_per_bus: 54, forecast_split_sections: [], section_order: [], extras: [], products: [] },
];
// 已经在 settings 列表里的（Page 的产品，页面一打开 studio 就读到了）；BZ / Boulder City 的键不在列表里，
// 模拟「服务端打开页面时才补种」：第一次 GET 接口时才进 byKey，保存才不会 404。
for (const g of shuttleGroupsV2().filter((x) => x.manifest_id === 1)) {
  for (const prod of g.products) for (const f of prod.fields) { const r = s(f.key, f.value, f.value ? "annie" : null); settings.push(r); }
}

// 门票团（G190，tix_tour_types）：ctl.tixTypes = 200 才有接口；403 = 开关没放给我（默认）；0 = 404；其他数字 = 那个错误码。
const TIX_KEYS = ["upper_antelope_tsosie", "upper_antelope_brenda", "upper_antelope_brenda_no_fee", "upper_antelope_aact", "upper_antelope_hogan_transport", "upper_antelope_hogan_hiking", "lower_antelope_kens", "lower_antelope_dixie", "canyon_x", "rattlesnake_aact", "secret_antelope_hbt", "secret_antelope_combo_hbt", "deer_canyon", "sand_dune_canyon", "wind_pebble_canyon"];
const tixTypes = TIX_KEYS.map((key, i) => ({ id: i + 1, key, label: `${key} full name`, sms_label: "Upper Antelope Canyon Tour", abbr: `T${i + 1}`, skip_confirmation_no: false, sort_order: i + 1, is_active: key !== "rattlesnake_aact" }));
const TIX_FIELDS = ["checkin_location", "checkin_minutes", "maps_url", "apple_maps_url", "location_photo", "extra_notes",
  ...[1, 2, 3].flatMap((n) => ["label", "url", "note"].map((p) => `prep_${n}_${p}`))];

// ── G228 Team Messages（后端 4e 设计，还没上 main）：23 个键、种子原文、必填 / 变量 / 短信规则 ──
// [id, label, 种子, 必填, 允许的变量, 短信（driver / guide 要 {link}、按真实链接量 160）]
const SUBJ = ["{week}"], SCHED = ["{name}", "{week}"];
const TEAM = [
  ["field_driver_sms", "Driver text", "NPE: Manifest for {date}, tap to open: {link}", true, ["{date}", "{link}"], "sms"],
  ["field_guide_sms", "Guide text", "NPE guide {date}: {link}", true, ["{date}", "{link}"], "sms"],
  ["rest_title", "Restaurant first line", "NPE lunch update - {date}", true, ["{date}"], "gsm"],
  ["rest_total_label", "Restaurant total label", "total", false, [], "gsm"],
  ["rest_changed_label", "Restaurant changes label", "Changed today:", false, [], "gsm"],
  ["rest_questions", "Restaurant questions line", "Questions: {guide} {guide_phone}", false, ["{guide}", "{guide_phone}"], "gsm"],
  ["rest_email_subject", "Restaurant email subject", "NPE lunch update - {tour}", true, ["{tour}"], ""],
  ["sched_greeting", "Schedule greeting", "Hi {name},", false, SCHED, ""],
  ["sched_week_subject", "Schedule email subject", "Your schedule — week of {week}", true, SUBJ, ""],
  ["sched_week_intro", "Schedule intro", "Here is your schedule for the week of {week}:", false, SCHED, ""],
  ["sched_week_empty", "Schedule no shifts", "No shifts this week.", false, SCHED, ""],
  ["sched_week_link_text", "Schedule link text", "Open my schedule", true, SCHED, ""],
  ["sched_changed_subject", "Schedule changed subject", "Your schedule changed — week of {week}", true, SUBJ, ""],
  ["sched_edited_subject", "Schedule edited subject", "Schedule edited — week of {week}", true, SUBJ, ""],
  ["sched_changed_intro", "Schedule changed intro", "Your schedule for the week of {week} has changed:", false, SCHED, ""],
  ["sched_edited_intro", "Schedule edited intro", "The schedule for the week of {week} has changed:", false, SCHED, ""],
  ["sched_changed_footer", "Schedule changed footer", "You can see this in the Notice panel on your Dashboard.", false, SCHED, ""],
  ["sched_pdf_attached_note", "PDF attachment note", "The full team schedule is attached.", false, SUBJ, ""],
  ["sched_confirm_changes_subject", "Confirm changes subject", "Please confirm your schedule changes — week of {week}", true, SUBJ, ""],
  ["sched_confirm_changes_intro", "Confirm changes intro", "Your schedule for the week of {week} has changed:", false, SCHED, ""],
  ["sched_confirm_changes_ask", "Confirm changes ask", "Please check and confirm:", false, SCHED, ""],
  ["sched_confirm_link_text", "Confirm link text", "Confirm my schedule", true, SCHED, ""],
  ["sched_weekly_confirm_subject", "Weekly confirm subject", "Confirm your schedule — week of {week}", true, SUBJ, ""],
  ["sched_weekly_confirm_intro", "Weekly confirm intro", "Your schedule for the week of {week} is up. Please confirm it:", false, SCHED, ""],
  // 整段排班（Period › Share with staff，后端 33 v161 种子）。
  ["sched_period_subject", "Period subject", "Your schedule — {start} to {end}", true, ["{start}", "{end}", "{weeks}"], ""],
  ["sched_period_intro", "Period intro", "Here is your schedule for the next {weeks} weeks ({start} – {end}). Please confirm it:", false, ["{start}", "{end}", "{weeks}"], ""],
  ["sched_period_link_text", "Period link text", "Confirm my schedule", true, [], ""],
];
const TEAM_RULES = {};
for (const [id, label, seed, required, allowed, kind] of TEAM) {
  const key = `tmpl__global__${id}`;
  settings.push({ ...s(key, seed), label: `[Team Messages] ${label}` });
  TEAM_RULES[key] = { label, required, allowed, kind };
}
const GSM_BASIC = new Set(Array.from("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"));
const GSM_EXT = new Set(Array.from("^{}\\[~]|€"));
/** 同后端 team_messages.validate()：不过回 400 英文 detail（4e 的原话）。 */
function teamProblem(key, value) {
  const r = TEAM_RULES[key];
  if (!r) return null;
  if (r.required && !String(value).trim()) return `${r.label} can't be blank.`;
  const unknown = (String(value).match(/\{[^}]*\}/g) || []).find((v) => !r.allowed.includes(v));
  if (unknown) return `Unknown placeholder ${unknown}. You can use: ${r.allowed.join(", ") || "(none)"}.`;
  if (r.kind === "sms" || r.kind === "gsm") {
    const bad = [...new Set(Array.from(String(value)).filter((c) => !GSM_BASIC.has(c) && !GSM_EXT.has(c)))];
    if (bad.length) return `This has a character texts can't send (${bad.join(" ")}).`;
  }
  if (r.kind === "sms") {
    const n = (String(value).match(/\{link\}/g) || []).length;
    if (n !== 1) return "Put {link} in exactly once.";
    const filled = String(value).trim().replace(/\{date\}/g, "Sat, Oct 31").replace(/\{link\}/g, "x".repeat(95));
    const len = Array.from(filled).reduce((a, c) => a + (GSM_EXT.has(c) ? 2 : 1), 0);
    if (len > 160) return `Too long for one text by ${len - 160} characters.`;
  }
  return null;
}
// ── 128 / G299 Guest Page 整页就地编辑（后端 d2 task/g299-guest-page-edit，docs/interfaces/tc-guest-page-edit-2026-11-13.md）──
// 9 个巴士团；含餐 6 个（Beef 只 Antelope 三个）；门票框 has_park_fee 只 GC South、Bryce & Zion。
const GP_TOURS = ["upper_antelope", "lower_antelope", "antelope_x", "grand_canyon_south", "grand_canyon_west", "bryce_zion", "valley_of_fire_full", "valley_of_fire_half", "hoover_dam"];
const GP_LUNCH = new Set(["upper_antelope", "lower_antelope", "antelope_x", "grand_canyon_south", "bryce_zion", "valley_of_fire_full"]);
const GP_BEEF = new Set(["upper_antelope", "lower_antelope", "antelope_x"]);
const GP_FEE = new Set(["grand_canyon_south", "bryce_zion"]);
const GP_SLOTS = ["pickup", "fee", "lunch", "notes", "submit"];
const GG = (k) => `tmpl__global__tc_guest_${k}`;
const GUEST_SEEDS = {
  pickup_box_title: "🚌 Your Pick-up Process",
  pu_sms_head: "Morning of your tour — SMS reminder",
  pu_sms_text: "We'll send you an SMS with your <strong>check-in link</strong> and <strong>live vehicle tracking</strong> before departure.",
  pu_wrong_number: "Wrong number? Let us know in the Notes section below.",
  pu_head_head: "Head to your pickup location",
  pu_depart_warn: "⚠ We depart promptly — the vehicle cannot wait for late arrivals.",
  pu_checkin_head: "Check in when you arrive",
  pu_checkin_text: "Use the link in your SMS to check in on the spot. Your guide will be looking out for you!",
  already_submitted: "Response already submitted. You can update it below.",
  lunch_title: "🥪 Lunch Selection",
  lunch_hint: "Select for all <strong>{qty}</strong> guest(s). Total must equal your party size.",
  lunch_default: "Default is Turkey Sandwich if no selection received.",
  notes_title: "📝 Notes",
  notes_placeholder: "Special requests, dietary notes...",
  last_update_label: "📝 Your last update",
  submit_btn: "Submit Confirmation",
  footer_thanks: "Thank you for choosing National Park Express — we look forward to your adventure! 🏞️",
  date_modal_title: "📅 Select New Tour Date",
  date_modal_desc: "Please select your requested new date below.",
  lunch_warn_title: "⚠ Lunch Selection Incomplete",
  lunch_warn_body: "You have {count} guest(s) without a lunch selection. Unselected guests will be noted for your guide to arrange on the day.",
  lunch_warn_back: "← Go Back",
  lunch_warn_continue: "Continue",
};
for (const [k, v] of Object.entries(GUEST_SEEDS)) settings.push({ ...s(GG(k), v), label: `[TC Guest Page] ${k.replace(/_/g, " ")}` });
for (const slot of GP_SLOTS) for (const i of [1, 2]) settings.push({ ...s(GG(`add_${slot}_${i}`), ""), label: `[TC Guest Page] Added line — ${slot} (${i})` });
for (const t of GP_TOURS) {
  const T = (f) => `tmpl__tc__${t}__${f}`;
  // Bryce & Zion 的提醒里故意放一个会跑脚本的 <img onerror>：沙箱 iframe 里不许跑（SA-1）。
  settings.push(s(T("reminders"), t === "bryce_zion" ? "Bring a photo ID.\nWear good shoes.<img src=x onerror=\"window.top.__pwned=1\">" : "Bring a photo ID.\nWear good shoes."));
  settings.push(s(T("extra_reminders"), t === "hoover_dam" ? "Lunch is not included." : ""));
  if (GP_FEE.has(t)) {
    settings.push(s(T("park_fee_nonresident"), "Non-US residents pay a <strong>$100 per person</strong> park fee."));
    settings.push(s(T("park_fee_resident"), t === "bryce_zion" ? "" : "US residents: the park entry fee is included."));
  }
  if (t === "grand_canyon_south") settings.push(s(T("lunch_extra_note"), "Lunch is at the Village picnic area."));
  for (const slot of GP_SLOTS) for (const i of [1, 2]) settings.push({ ...s(T(`add_${slot}_${i}`), ""), label: `[TC Guest Page] Added line — ${slot} (${i}, this tour only)` });
  // 邮件的键（下一步用）：不该出现在客人页的改动 / List view 里。
  settings.push(s(T("email_add_body_1"), "Email only line"));
}
const GP_LUNCH_ERRORS = {
  blank: "This text can't be blank — guests need it in the Lunch Selection Incomplete dialog.",
  count: "Keep {count} in the text — it is replaced with the number of guests.",
};
function guestPageProblem(key, value) {
  if (!key.startsWith(GG("lunch_warn_"))) return null;
  if (!String(value).trim()) return GP_LUNCH_ERRORS.blank;
  if (key === GG("lunch_warn_body") && !String(value).includes("{count}")) return GP_LUNCH_ERRORS.count;
  return null;
}
/** 照后端 guest._render(preview=True) 的标记拼一份客人页（不是真样式，够前端测）。 */
function guestPreviewHtml(t, overrides) {
  const v = (k) => (k in overrides ? String(overrides[k]) : byKey[k]?.value ?? "");
  const K = (k, html) => `<span data-tmpl-key="${k}">${html}</span>`;
  const empty = (k) => `<span data-tmpl-key="${k}" data-empty="1"></span>`;
  const state = (n, html) => `<div data-preview-state="${n}">${html}</div>`;
  const g = (k) => K(GG(k), v(GG(k)) || GUEST_SEEDS[k] || "");
  const T = (f) => `tmpl__tc__${t}__${f}`;
  const adds = (slot, wrap) => {
    const keys = [GG(`add_${slot}_1`), GG(`add_${slot}_2`), T(`add_${slot}_1`), T(`add_${slot}_2`)];
    return keys.map((k) => (v(k).trim() ? wrap(K(k, v(k).replace(/\n/g, "<br>"))) : empty(k))).join("") + `<span data-add-slot="${slot}"></span>`;
  };
  const steps = {
    sms: `<div class="gf-pu-step" data-pickup-step="sms"><div class="gf-pu-head">${g("pu_sms_head")}</div><div class="gf-pu-text">${g("pu_sms_text")}</div><div class="gf-pu-sub">${g("pu_wrong_number")}</div></div>`,
    location: `<div class="gf-pu-step" data-pickup-step="location"><div class="gf-pu-head">${g("pu_head_head")}</div><div class="gf-pu-text">Please arrive at <strong>Excalibur</strong> by <strong>8:00 AM</strong>.</div><div class="gf-pu-warn">${g("pu_depart_warn")}</div></div>`,
    checkin: `<div class="gf-pu-step" data-pickup-step="checkin"><div class="gf-pu-head">${g("pu_checkin_head")}</div><div class="gf-pu-text">${g("pu_checkin_text")}</div></div>`,
    notsure: `<div class="gf-pu-step" data-pickup-step="notsure"><div class="gf-pu-head">${g("pu_notsure_head")}</div><div class="gf-pu-text"><a href="#" target="_blank">Excalibur Pickup Photos →</a></div></div>`,
  };
  const order = (v(GG("pickup_order")) || "sms,location,checkin,notsure").split(",").map((x) => x.trim()).filter((x) => steps[x]);
  for (const x of ["sms", "location", "checkin", "notsure"]) if (!order.includes(x)) order.push(x);
  const feeItem = (f) => (v(T(f)) ? `<li>${K(T(f), v(T(f)))}</li>` : empty(T(f)));
  const fee = GP_FEE.has(t) ? `<div class="gf-fee-box"><div class="gf-box-title">ℹ️ National Park Entry Fee</div><ul>${feeItem("park_fee_nonresident")}${feeItem("park_fee_resident")}${adds("fee", (h) => `<li>${h}</li>`).replace(/<span data-add-slot="fee"><\/span>$/, "")}</ul><span data-add-slot="fee"></span></div>` : "";
  const items = [["🦃", "Turkey Sandwich", 1], ["🥗", "Veggie Sandwich", 1], ...(GP_BEEF.has(t) ? [["🥩", "Beef Sandwich", 0]] : [])];
  const lunch = GP_LUNCH.has(t)
    ? state("lunch", `<div class="gf-section" id="lunch-section"><h2>${g("lunch_title")}</h2><p class="gf-hint">${K(GG("lunch_hint"), (v(GG("lunch_hint")) || GUEST_SEEDS.lunch_hint).replace("{qty}", "2"))}</p>${t === "grand_canyon_south" ? (v(T("lunch_extra_note")) ? `<p class="gf-hint">${K(T("lunch_extra_note"), v(T("lunch_extra_note")))}</p>` : empty(T("lunch_extra_note"))) : ""}<div class="gf-lunch-grid">${items.map(([i, n, q]) => `<div class="gf-lunch-item" data-lunch-item>${i} ${n} <b>${q}</b></div>`).join("")}</div><p class="gf-small">${g("lunch_default")}</p>${adds("lunch", (h) => `<p class="gf-hint">${h}</p>`)}</div>`) +
      state("lunch_warn", `<div style="padding:16px 0"><div><h3>${g("lunch_warn_title")}</h3><p>${K(GG("lunch_warn_body"), v(GG("lunch_warn_body")).replace("{count} guest(s)", "<strong>1 guest(s)</strong>"))}</p><button type="button">${g("lunch_warn_back")}</button><button type="button">${g("lunch_warn_continue")}</button></div></div>`)
    : "";
  const rem = (f) => { const li = v(T(f)).split("\n").map((x) => x.trim()).filter(Boolean).map((x) => `<li>${x}</li>`).join(""); return li ? `<ul data-tmpl-key="${T(f)}">${li}</ul>` : empty(T(f)); };
  const body = `<div class="gf-wrap"><div class="gf-card">
<div class="gf-header"><h1>Tour Confirmation</h1><div class="gf-tour-badge" data-tour-badge>${t}</div><div class="gf-meta">Order #SAMPLE123 · John · Party of 2</div></div>
<div class="gf-pickup-box"><div class="gf-box-title">${g("pickup_box_title")}</div>${order.map((x) => steps[x]).join("")}${adds("pickup", (h) => `<div class="gf-pu-text">${h}</div>`)}</div>
${fee}
${state("already_submitted", `<div class="gf-info">${g("already_submitted")}</div>`)}
<form method="post"><div class="gf-section"><label class="gf-yn yes"><input type="radio" name="confirmation" value="yes"> YES</label></div>
${lunch}
<div class="gf-reminders"><div class="gf-box-title">📌 Important Reminders</div>${rem("reminders")}${rem("extra_reminders")}</div>
<div class="gf-section">${state("last_update", `<div><div>${g("last_update_label")}</div><div>[2026-11-12 09:14] Guest note added.</div></div>`)}<h2>${g("notes_title")} <span class="gf-opt">(optional)</span></h2>${adds("notes", (h) => `<p class="gf-hint">${h}</p>`)}<textarea name="notes" data-tmpl-key="${GG("notes_placeholder")}" placeholder="${(v(GG("notes_placeholder")) || "").replace(/"/g, "&quot;")}"></textarea></div>
<div class="gf-submit"><button type="submit" class="gf-btn">${g("submit_btn")}</button><p class="gf-small">${g("footer_thanks")}</p>${adds("submit", (h) => `<p class="gf-small">${h}</p>`)}</div>
</form>
${state("date_modal", `<div style="padding:16px 0"><h3>${g("date_modal_title")}</h3><p>${g("date_modal_desc")}</p></div>`)}
</div></div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tour Confirmation</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#f0f4f8;font-family:Arial,sans-serif;color:#333;padding:16px}.gf-wrap{max-width:580px;margin:0 auto}.gf-card{background:#fff;border-radius:16px}.gf-header{background:#1a3a5c;color:#fff;padding:22px}.gf-pickup-box,.gf-fee-box,.gf-section,.gf-reminders,.gf-submit{padding:16px 22px}.gf-pu-step{padding:10px 0}.gf-reminders ul,.gf-fee-box ul{padding-left:18px}textarea{width:100%;min-height:60px}</style></head><body>${body}</body></html>`;
}
const byKey = Object.fromEntries(settings.map((r) => [r.key, r]));
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d ? JSON.parse(d) : null));
  });
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, await readBody(req)); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p };
  log.push(entry);
  // G203 第二批：共用读接口（后端 f76d5e9）。
  if (p === "/api/template-settings/action-log") return send(res, 200, { next_cursor: null, entries: [{ id: "2-1", at: "2026-10-28T17:00:00+00:00", by: "Annie Z", action: "update", label: "ZZ Test item", what: "Name", from: "Old", to: "New" }, { id: "1-1", at: "2026-10-27T17:00:00+00:00", by: "Max", action: "create", label: "ZZ Test item", what: "Name", from: null, to: "Old" }] });
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.staff ? "staff" : "admin", is_admin: !ctl.staff, is_superadmin: false });
  if (p === "/api/farm-out/partners") return send(res, 200, foPartners);
  if (p === "/api/farm-out/tour-meta") return send(res, 200, [{ manifest_id: 1, tour_name: "West Rim", please_note: "Backpacks are not permitted." }]);
  if (p === "/api/template-settings") return send(res, 200, settings);
  if (p === "/api/template-settings/save") {
    const body = await readBody(req);
    entry.body = body;
    if (!body.key.startsWith("tmpl__")) return send(res, 400, { detail: "Invalid key prefix" });
    if (!byKey[body.key]) return send(res, 404, { detail: `Settings key not seeded: ${body.key}` });
    // ctl.teamSaveFail：后端拒了一个页面没挡住的（例如别的规则），原话照回。
    if (TEAM_RULES[body.key] && ctl.teamSaveFail) return send(res, 400, { detail: ctl.teamSaveFail });
    const teamErr = teamProblem(body.key, body.value);
    if (teamErr) return send(res, 400, { detail: teamErr });
    const gpErr = guestPageProblem(body.key, body.value);
    if (gpErr) return send(res, 400, { detail: gpErr });
    byKey[body.key].value = body.value;
    byKey[body.key].updated_by = "zztest";
    byKey[body.key].updated_at = "2026-10-30T20:00:00";
    return send(res, 200, { ok: true, key: body.key });
  }
  if (p === "/api/template-settings/preview") {
    const body = await readBody(req);
    entry.body = body;
    if (body.module === "tc" && body.tab === "guest_page") {
      if (ctl.guestPreviewFail) return send(res, 400, { detail: ctl.guestPreviewFail });
      if (!GP_TOURS.includes(body.tour_type)) return send(res, 400, { detail: "Unknown tour_type" });
      return send(res, 200, { html: guestPreviewHtml(body.tour_type, body.overrides || {}) });
    }
    return send(res, 200, { html: `<div class="gf-prepare-box">${body.overrides[`tmpl__tix__${body.tour_type}__prep_1_label`] || ""}</div>` });
  }
  if (p === "/api/settings/shuttle-routes" && req.method === "GET") {
    return send(res, 200, { routes: shuttleRoutes, shuttle_groups: shuttleGroups });
  }
  if (p === "/api/settings/shuttle-routes" && req.method === "POST") {
    const body = await readBody(req);
    entry.body = body;
    if (ctl.shuttleCreateFail) return send(res, 400, { detail: ctl.shuttleCreateFail });
    const group = shuttleGroups.find((g) => g.id === body.manifest_id);
    if (!group) return send(res, 400, { detail: "manifest is not a shuttle group." });
    if (shuttleRoutes.some((r) => r.manifest_id === body.manifest_id && r.direction === body.direction)) {
      return send(res, 400, { detail: "A route for this group and direction already exists." });
    }
    const route = { id: nextShuttleId++, manifest_id: body.manifest_id, direction: body.direction, label: body.label, sort_order: shuttleRoutes.length + 1, is_active: true, group_name: group.name, group_display_name: group.display_name };
    shuttleRoutes.push(route);
    for (const f of ["sms_body", "email_subject", "email_body", "guest_page_body"]) {
      const key = `tmpl__shuttle__${group.name}__${body.direction}__${f}`;
      const row = s(key, "");
      settings.push(row);
      byKey[key] = row;
    }
    return send(res, 200, route);
  }
  const shuttleIdMatch = p.match(/^\/api\/settings\/shuttle-routes\/(\d+)$/);
  if (shuttleIdMatch && req.method === "PATCH") {
    const route = shuttleRoutes.find((r) => r.id === Number(shuttleIdMatch[1]));
    const body = await readBody(req);
    entry.body = body;
    if (!route) return send(res, 404, { detail: "Route not found." });
    if (ctl.shuttlePatchFail) return send(res, 400, { detail: ctl.shuttlePatchFail });
    if ("manifest_id" in body || "direction" in body) return send(res, 400, { detail: "manifest_id and direction cannot be changed." });
    if (typeof body.label === "string") route.label = body.label;
    if (typeof body.is_active === "boolean") route.is_active = body.is_active;
    if (typeof body.sort_order === "number") route.sort_order = body.sort_order;
    return send(res, 200, route);
  }
  if (p === "/api/settings/shuttle/products" && req.method === "GET") {
    if (!ctl.shuttleProducts) return send(res, 404, { detail: "Not Found" });
    if (ctl.shuttleProductsFail) return send(res, ctl.shuttleProductsFail, { detail: "Shuttle products are unavailable." });
    const groups = shuttleGroupsV2();
    const shared = shuttleShared();
    // GET 时后端把所有 key 建好（之后保存不会 404）；已经存过的值以 byKey 为准。
    for (const f of [...shared.fields, ...shared.text_fields, ...groups.flatMap((g) => g.products.flatMap((prod) => prod.fields))]) {
      if (!byKey[f.key]) byKey[f.key] = s(f.key, f.value);
      f.value = byKey[f.key].value;
    }
    return send(res, 200, { shared, groups });
  }
  if (p.startsWith("/api/settings/tix-tour-types")) {
    if (ctl.tixTypes !== 200) return send(res, ctl.tixTypes || 404, { detail: ctl.tixTypes === 403 ? "This feature isn't available to you." : "Not Found" });
    if (req.method === "GET") return send(res, 200, { tour_types: tixTypes });
    const body = await readBody(req);
    entry.body = body;
    if (req.method === "POST") {
      if (!/^[a-z][a-z0-9_]{1,48}[a-z0-9]$/.test(body.key || "")) return send(res, 400, { detail: "Key: lowercase letters, numbers and _ only." });
      if (tixTypes.some((t) => t.key === body.key)) return send(res, 400, { detail: `Key ${body.key} is already used.` });
      const row = { id: tixTypes.length + 1, key: body.key, label: body.label, sms_label: "", abbr: "", skip_confirmation_no: false, sort_order: tixTypes.length + 1, is_active: true };
      tixTypes.push(row);
      // 新建时后端种齐这个团所有的内容 key（含 checkin_minutes、prep 9 个）。
      for (const f of TIX_FIELDS) { const k = `tmpl__tix__${body.key}__${f}`; if (!byKey[k]) { byKey[k] = s(k, ""); settings.push(byKey[k]); } }
      return send(res, 200, row);
    }
    const m = p.match(/\/(\d+)$/);
    const row = m && tixTypes.find((t) => t.id === Number(m[1]));
    if (req.method === "PATCH" && row) {
      if ("key" in body) return send(res, 400, { detail: "key cannot be changed." });
      Object.assign(row, body);
      return send(res, 200, row);
    }
  }
  if (p === "/api/settings/manifest-setup" && req.method === "GET") {
    return send(res, 200, { groups: setupGroupsV2, kinds: [], default_section: "" });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("cs mock on 8799"));
