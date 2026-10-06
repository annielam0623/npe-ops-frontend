// 模拟后端：Pickup Locations 页。控制：POST /__ctl {fail401, staff, failList}；GET /__log。
const http = require("http");
const ctl = { fail401: false, staff: false, failList: false, depFail: false };
const log = [];
let nextId = 50;
let locations = [
  { id: 1, hotel_name: "Aria", photo_url: "https://nationalparkexpress.com/pickup/aria", instruction: "Meet at the tour lobby", instruction_short: "Tour lobby", aliases: "", map_image_url: "https://example.test/aria.png\nhttps://example.test/missing.png", is_active: true, is_tour_departure: false },
  { id: 2, hotel_name: "Resorts World", photo_url: null, instruction: null, instruction_short: "", aliases: "ResortsWLD, RWLV", map_image_url: "", is_active: true },
  { id: 3, hotel_name: "ZZ Test Qzx \"Quote\" <b>Inn</b>", photo_url: "javascript:alert(1)", instruction: "x", instruction_short: "y", aliases: "", map_image_url: "", is_active: false },
];
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
  if (p === "/api/pickup-locations/log") return send(res, 200, { entries, limit: 50 });
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
}).listen(8799, () => console.log("pickup mock on 8799"));
