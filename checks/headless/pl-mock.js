// 模拟后端：Pickup Locations 页。控制：POST /__ctl {fail401, staff, failList}；GET /__log。
const http = require("http");
const ctl = { fail401: false, staff: false, failList: false, depFail: false, importFail: false, importConflict: false, previewBad: false };
const log = [];
let nextId = 50;
let locations = [
  { id: 1, hotel_name: "Aria", photo_url: "https://nationalparkexpress.com/pickup/aria", instruction: "Meet at the tour lobby", instruction_short: "Tour lobby", aliases: "", map_image_url: "https://example.test/aria.png\nhttps://example.test/missing.png", is_active: true, is_tour_departure: false },
  { id: 2, hotel_name: "Resorts World", photo_url: null, instruction: null, instruction_short: "", aliases: "ResortsWLD, RWLV", map_image_url: "", is_active: true },
  { id: 3, hotel_name: "ZZ Test Qzx \"Quote\" <b>Inn</b>", photo_url: "javascript:alert(1)", instruction: "x", instruction_short: "y", aliases: "", map_image_url: "", is_active: false },
];
const OLD_INN = [["Hotel Name", "Old Inn"], ["Photo URL", ""], ["Details (email & guest page & AI Agent)", "Gone"], ["Short (for SMS)", ""], ["Aliases", ""], ["Map image", ""], ["Tour bus departure", "No"]];
const ACTION_LOG = [
  { id: "3-1", at: "2026-10-01T16:00:00+00:00", by: "Annie Z", action: "update", label: "Aria", what: "Short (for SMS)", from: "Lobby", to: "Tour lobby" },
  ...OLD_INN.map(([what, from], i) => ({ id: `2-${i + 1}`, at: "2026-09-30T16:00:00+00:00", by: "annie", action: "delete", label: "Old Inn", what, from, to: null })),
  { id: "1-1", at: "2026-09-29T16:00:00+00:00", by: "Max", action: "deactivate", label: "ZZ Test", what: "Status", from: "Active", to: "Inactive" },
];
const OLDER = [{ id: "0-1", at: "2026-08-21T16:00:00+00:00", by: "Max", action: "update", label: "", what: "Imported 12 hotels from the old list", from: null, to: null }];
const entries = [
  { id: 3, entity_id: "1", label: "Aria", action: "update", before: { hotel_name: "Aria", instruction_short: "Lobby", photo_url: "", instruction: "", aliases: "", map_image_url: "" }, after: { hotel_name: "Aria", instruction_short: "Tour lobby", photo_url: "", instruction: "", aliases: "", map_image_url: "" }, actor: "annie", actor_name: "Annie Z", created_at: "2026-10-01T16:00:00+00:00" },
  { id: 2, entity_id: "9", label: "Old Inn", action: "delete", before: { hotel_name: "Old Inn", photo_url: "", instruction: "Gone", instruction_short: "", aliases: "", map_image_url: "" }, after: null, actor: "annie", actor_name: "", created_at: "2026-09-30T16:00:00+00:00" },
  { id: 1, entity_id: "3", label: "ZZ Test", action: "deactivate", before: { is_active: true }, after: { is_active: false }, actor: "max", actor_name: "Max", created_at: "2026-09-29T16:00:00" },
];

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d ? JSON.parse(d) : null));
  });
}
function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
// ⬆ Import（全站通用导入，后端还没上；形状是前端提给后端的，见 types/pickup-locations.ts PickupImportRow）。
const IMPORT_PREVIEW = {
  columns: ["hotel_name", "instruction_short", "aliases", "is_tour_departure"],
  rows: [
    { status: "update", id: 1, row: 2, values: { hotel_name: "Aria", instruction_short: "Tour lobby east", aliases: "", is_tour_departure: "No" }, before: { instruction_short: "Tour lobby" }, changed: ["instruction_short"], blanked: ["aliases"], errors: [], matched_alias: null },
    { status: "update", id: 2, row: 3, values: { hotel_name: "RWLV", instruction_short: "", aliases: "ResortsWLD, RWLV", is_tour_departure: "Yes" }, before: { is_tour_departure: "No" }, changed: ["is_tour_departure"], blanked: ["instruction_short"], errors: [], matched_alias: "RWLV" },
    { status: "new", id: null, row: 4, values: { hotel_name: "ZZ Test Import Inn", instruction_short: "Front door", aliases: "", is_tour_departure: "No" }, before: {}, changed: [], blanked: [], errors: [], matched_alias: null },
    { status: "error", id: null, row: 5, values: { hotel_name: "ZZ Test <b>Long</b>", instruction_short: "x".repeat(130), aliases: "", is_tour_departure: "No" }, before: {}, changed: [], blanked: [], errors: [{ field: "instruction_short", message: "Short (for SMS) is 130 characters — the limit is 120." }], matched_alias: null },
    { status: "error", id: null, row: 6, values: { hotel_name: "ZZ Test Import Inn", instruction_short: "", aliases: "", is_tour_departure: "" }, before: {}, changed: [], blanked: [], errors: [{ field: null, message: "Repeated above — skipped." }], matched_alias: null },
  ],
  // 后端 G220（76de8f3）：preview 多 counts；matched_alias 只在按别名对上时才有（这里照旧都给）。
  counts: { new: 1, update: 2, unchanged: 0, error: 2 },
};
function validate(body, selfId) {
  if (body.instruction_short.length > 120) return `Short (for SMS) is ${body.instruction_short.length} characters — the limit is 120.`;
  if (body.map_image_url.split("\n").filter(Boolean).length > 2) return "Up to 2 map images per hotel";
  if (!body.hotel_name) return "hotel_name is required";
  if (selfId === undefined && locations.some((l) => l.hotel_name.toLowerCase() === body.hotel_name.toLowerCase())) return `"${body.hotel_name}" already exists`;
  for (const a of body.aliases.split(",").map((x) => x.trim()).filter(Boolean)) {
    const other = locations.find((l) => l.id !== selfId && l.aliases.toLowerCase().split(/,\s*/).includes(a.toLowerCase()));
    if (other) return `"${a}" already points to "${other.hotel_name}".`;
  }
  return null;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, await readBody(req)); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, query: url.search };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.staff ? "staff" : "admin", is_admin: !ctl.staff, is_superadmin: false });
  if (p === "/api/pickup-locations/import/preview" || p === "/api/pickup-locations/import/commit") {
    const raw = await readRaw(req);
    entry.hasFile = /filename="pl-import\.csv"/.test(raw);
    if (p.endsWith("/preview")) {
      if (ctl.previewBad) return send(res, 400, { detail: "Missing column: Hotel Name" });
      return send(res, 200, IMPORT_PREVIEW);
    }
    if (ctl.importFail) return send(res, 500, { detail: "Database is busy" });
    // 后端原话（pickup_locations.py）：整批一个事务，中途有人改了酒店清单就 409、全回滚。
    if (ctl.importConflict) return send(res, 409, { detail: "Someone changed the hotel list while this file was being saved. Nothing was saved — check the preview again." });
    locations.find((l) => l.id === 1).instruction_short = "Tour lobby east";
    locations.find((l) => l.id === 2).is_tour_departure = true;
    locations.push({ id: nextId++, hotel_name: "ZZ Test Import Inn", photo_url: null, instruction: null, instruction_short: "Front door", aliases: "", map_image_url: "", is_active: true, is_tour_departure: false });
    return send(res, 200, { created: 1, updated: 2, unchanged: 0, skipped: 2 });
  }
  // G203 共用读接口（后端 3686fea）：第一页 + next_cursor，before=older 再给一页更早的。
  if (p === "/api/pickup-locations/action-log") {
    if (url.searchParams.get("before") === "older") return send(res, 200, { entries: OLDER, next_cursor: null });
    return send(res, 200, { entries: ACTION_LOG, next_cursor: "older" });
  }
  if (p === "/api/pickup-locations" && req.method === "GET") {
    if (ctl.failList) return send(res, 500, { detail: "Internal Server Error" });
    return send(res, 200, { locations: [...locations].sort((a, b) => a.hotel_name.localeCompare(b.hotel_name)) });
  }
  if (p === "/api/pickup-locations" && req.method === "POST") {
    const body = await readBody(req);
    entry.body = body;
    const err = validate(body);
    if (err) return send(res, 400, { detail: err });
    const loc = { id: nextId++, ...body, is_active: true };
    locations.push(loc);
    return send(res, 200, { id: loc.id, hotel_name: loc.hotel_name });
  }
  let m = p.match(/^\/api\/pickup-locations\/(\d+)$/);
  if (m && req.method === "PUT") {
    const body = await readBody(req);
    entry.body = body;
    const err = validate(body, Number(m[1]));
    if (err) return send(res, 400, { detail: err });
    Object.assign(locations.find((l) => l.id === Number(m[1])), body);
    return send(res, 200, { success: true });
  }
  if (m && req.method === "DELETE") {
    if (m[1] === "1") return send(res, 409, { detail: "Aria is in the Dispatch schedule (Oct 3). It cannot be deleted while it is scheduled." });
    locations = locations.filter((l) => l.id !== Number(m[1]));
    return send(res, 200, { success: true });
  }
  m = p.match(/^\/api\/pickup-locations\/(\d+)\/tour-departure$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    if (ctl.depFail) return send(res, 403, { detail: "Admin access required" });
    locations.find((l) => l.id === Number(m[1])).is_tour_departure = body.tour_departure;
    return send(res, 200, { success: true, is_tour_departure: body.tour_departure });
  }
  m = p.match(/^\/api\/pickup-locations\/(\d+)\/active$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    locations.find((l) => l.id === Number(m[1])).is_active = body.active;
    return send(res, 200, { success: true, is_active: body.active });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("pickup mock on", process.env.MOCK_PORT || 8799));
