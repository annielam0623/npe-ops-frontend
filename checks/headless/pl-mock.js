// 模拟后端：Pickup Locations 页。控制：POST /__ctl {fail401, staff, failList}；GET /__log。
const http = require("http");
const ctl = { fail401: false, staff: false, failList: false, depFail: false, split: false, timesFail: false };
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

// ── split（preview v3 Pickup 分开 + Shuttle 站时间）：POST /__ctl {split:true} 换成下面这份数据 ──
// 形状照 preview「需要后端」B1–B3b 暂定。季节按今天（LA）算：Summer = 今天前 30 天到后 3 天，Winter = 接着 120 天，之后没接上。
const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d);
const plusDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const TODAY = ymd(new Date());
const ROUTES = [
  { product_id: 11, label: "Las Vegas → St George" },
  { product_id: 12, label: "Las Vegas → Zion" },
  { product_id: 13, label: "St George → Las Vegas" },
  { product_id: 14, label: "Las Vegas → Page" },
];
const routeLabel = (id) => ROUTES.find((r) => r.product_id === id)?.label ?? `#${id}`;
let seasons = [];
let nextSeasonId = 3;
const tm = (product_id, run_no, season_id, stop_time) => ({ product_id, route_label: routeLabel(product_id), run_no, season_id, stop_time, no_service: stop_time === null });
function splitData() {
  seasons = [
    { id: 1, name: `Summer ${plusDays(TODAY, -30).slice(0, 4)}`, starts_on: plusDays(TODAY, -30), ends_on: plusDays(TODAY, 3) },
    { id: 2, name: `Winter ${plusDays(TODAY, 4).slice(0, 4)}`, starts_on: plusDays(TODAY, 4), ends_on: plusDays(TODAY, 124) },
  ];
  const base = { photo_url: null, instruction: "Meet at the front entrance", aliases: "", map_image_url: "", is_active: true, is_tour_departure: false };
  return [
    { ...base, id: 1, hotel_name: "Bellagio", instruction_short: "Bell", is_tour_bus: true, is_shuttle: false, times: [] },
    { ...base, id: 2, hotel_name: "Treasure Island", instruction_short: "TI", is_tour_departure: true, is_tour_bus: true, is_shuttle: true, times: [tm(11, 1, 1, "07:00"), tm(11, 1, 2, "07:30"), tm(12, 1, 1, "06:30"), tm(12, 1, 2, null)] },
    { ...base, id: 3, hotel_name: "St George – Main St", instruction_short: "St George", is_tour_bus: false, is_shuttle: true, times: [tm(11, 1, 1, "09:45"), tm(11, 1, 2, "10:15"), tm(13, 1, 1, "15:30")] },
    { ...base, id: 4, hotel_name: "Kanab – Visitor Center", instruction_short: "Kanab", is_tour_bus: false, is_shuttle: true, times: [] },
    { ...base, id: 5, hotel_name: "The Strat", instruction_short: "Strat", is_tour_bus: null, is_shuttle: null, times: [] },
  ];
}
function overlapError(list) {
  const s = [...list].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  for (let i = 1; i < s.length; i++) if (s[i].starts_on <= s[i - 1].ends_on) return `${s[i - 1].name} and ${s[i].name} overlap.`;
  return null;
}
function timesError(times) {
  const seen = new Set();
  for (const t of times) {
    if (!seasons.some((x) => x.id === t.season_id)) return "That season does not exist.";
    if (!ROUTES.some((r) => r.product_id === t.product_id)) return "That route is not a shuttle product.";
    if (!t.no_service && !/^\d\d:\d\d$/.test(t.stop_time || "")) return "Time is not valid.";
    const k = `${t.product_id}|${t.run_no}|${t.season_id}`;
    if (seen.has(k)) return `${routeLabel(t.product_id)} is listed twice for one season.`;
    seen.add(k);
  }
  return null;
}

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
  if (p === "/__ctl") {
    const b = await readBody(req);
    if (b && b.split && !ctl.split) locations = splitData();
    Object.assign(ctl, b);
    return send(res, 200, ctl);
  }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, query: url.search };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.staff ? "staff" : "admin", is_admin: !ctl.staff, is_superadmin: false });
  // G203 共用读接口（后端 3686fea）：第一页 + next_cursor，before=older 再给一页更早的。
  if (p === "/api/pickup-locations/action-log") {
    if (url.searchParams.get("before") === "older") return send(res, 200, { entries: OLDER, next_cursor: null });
    return send(res, 200, { entries: ACTION_LOG, next_cursor: "older" });
  }
  if (p === "/api/pickup-locations/seasons") {
    if (!ctl.split) return send(res, 404, { detail: "Not Found" });
    if (req.method === "PUT") {
      const body = await readBody(req);
      entry.body = body;
      const err = overlapError(body.seasons);
      if (err) return send(res, 400, { detail: err });
      // b0 定稿：删掉还有站在用的季节 ⇒ 409，detail 一句话。
      const keep = new Set(body.seasons.map((x) => x.id).filter(Boolean));
      const used = seasons.find((s) => !keep.has(s.id) && locations.some((l) => (l.times ?? []).some((t) => t.season_id === s.id)));
      if (used) return send(res, 409, { detail: `${used.name} still has stop times. Remove them first.` });
      seasons = body.seasons.map((x) => ({ ...x, id: x.id ?? nextSeasonId++ }));
    }
    return send(res, 200, { seasons: [...seasons].sort((a, b) => a.starts_on.localeCompare(b.starts_on)) });
  }
  if (p === "/api/pickup-locations/shuttle-routes") {
    if (!ctl.split) return send(res, 404, { detail: "Not Found" });
    return send(res, 200, { routes: ROUTES });
  }
  if (p === "/api/pickup-locations" && req.method === "GET") {
    if (ctl.failList) return send(res, 500, { detail: "Internal Server Error" });
    return send(res, 200, { locations: [...locations].sort((a, b) => a.hotel_name.localeCompare(b.hotel_name)) });
  }
  if (p === "/api/pickup-locations" && req.method === "POST") {
    const body = await readBody(req);
    entry.body = body;
    const err = validate(body) || (ctl.split && !body.is_tour_bus && !body.is_shuttle ? "Pick Tour bus, Shuttle, or both." : null);
    if (err) return send(res, 400, { detail: err });
    const loc = { id: nextId++, ...body, is_active: true, ...(ctl.split ? { times: [] } : {}) };
    locations.push(loc);
    return send(res, 200, { id: loc.id, hotel_name: loc.hotel_name });
  }
  let m = p.match(/^\/api\/pickup-locations\/(\d+)$/);
  if (m && req.method === "PUT") {
    const body = await readBody(req);
    entry.body = body;
    const err = validate(body, Number(m[1])) || (ctl.split && body.times ? timesError(body.times) : null) || (ctl.split && ctl.timesFail ? "Las Vegas → St George is listed twice for one season." : null);
    if (err) return send(res, 400, { detail: err });
    const loc = locations.find((l) => l.id === Number(m[1]));
    Object.assign(loc, body);
    if (ctl.split && body.times) loc.times = body.times.map((t) => ({ ...t, route_label: routeLabel(t.product_id) }));
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
