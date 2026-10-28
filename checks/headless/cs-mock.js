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
    byKey[body.key].value = body.value;
    return send(res, 200, { ok: true, key: body.key });
  }
  if (p === "/api/template-settings/preview") {
    const body = await readBody(req);
    entry.body = body;
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
