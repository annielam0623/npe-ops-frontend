// 模拟后端：Content Studio。控制：POST /__ctl {fail401, staff}；GET /__log。
const http = require("http");
const ctl = { fail401: false, staff: false, shuttleCreateFail: "", shuttlePatchFail: "" };
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
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("cs mock on 8799"));
