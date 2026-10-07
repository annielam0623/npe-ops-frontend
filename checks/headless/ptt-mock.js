// 模拟后端：Products 页的 Tour type 列（后端 manifests-fields 契约 E 及补充）。控制：POST /__ctl {fail401, failTour}；GET /__log。
// 原来的 products 套的模拟接口不返回 ticket_tour_type(s)，正好验证「后端还没上线时整列不显示」。
const http = require("http");
const ctl = { fail401: false, failTour: false };
const log = [];
const groups = [
  { id: 1, name: "upper_antelope", display_name: "Upper Antelope", booking_type: "bus_tour", is_active: true, sort_order: 1 },
  { id: 5, name: "tix_antelope", display_name: "Antelope Tickets", booking_type: "ticket", is_active: true, sort_order: 2 },
];
const TOUR_TYPES = [
  { key: "antelope", label: "Antelope Canyon" },
  { key: "brenda_a", label: "Brenda (Lower)" },
  { key: "brenda_b", label: "Brenda (Upper)" },
];
let products = [
  { id: 10, product_code: "UAC01", product_name: "Upper Antelope Bus", internal_name: "", manifest_id: 1, booking_type: "bus_tour", is_active: true, ticket_tour_type: null },
  { id: 20, product_code: "TIX01", product_name: "Antelope Tickets A", internal_name: "", manifest_id: 5, booking_type: "ticket", is_active: true, ticket_tour_type: "antelope" },
  { id: 21, product_code: "TIX02", product_name: "Antelope Tickets B", internal_name: "", manifest_id: 5, booking_type: "ticket", is_active: true, ticket_tour_type: null },
  { id: 22, product_code: "TIX03", product_name: "Antelope Tickets C", internal_name: "", manifest_id: 5, booking_type: "ticket", is_active: true, ticket_tour_type: "gone_key" },
  { id: 30, product_code: "OLDT", product_name: "Was a ticket", internal_name: "", manifest_id: null, booking_type: "bus_tour", is_active: true, ticket_tour_type: "brenda_a" },
];
const entries = [
  { id: 1, entity_id: "20", label: "TIX01", action: "update", before: { ticket_tour_type: null }, after: { ticket_tour_type: "antelope" }, actor: "annie", actor_name: "Annie Z", created_at: "2026-10-07T16:00:00+00:00" },
];

const withGroup = (p) => {
  const g = groups.find((x) => x.id === p.manifest_id);
  return { ...p, group_name: g ? g.display_name : null, group_sort: g ? g.sort_order : null };
};
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
const validKey = (k) => k === null || TOUR_TYPES.some((t) => t.key === k);

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, await readBody(req)); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, query: url.search };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: "admin", is_admin: true, is_superadmin: false });
  const B = "/api/settings/products";
  if (p === B && req.method === "GET") return send(res, 200, { products: products.map(withGroup) });
  if (p === `${B}/groups`) return send(res, 200, { groups, booking_types: ["bus_tour", "shuttle", "ticket", "unmapped"], ticket_tour_types: TOUR_TYPES });
  if (p === `${B}/missing`) return send(res, 200, { missing: [] });
  if (p === `${B}/log`) return send(res, 200, { entries, limit: 50 });
  if (p === "/api/settings/manifest-setup") return send(res, 200, { groups: [], kinds: [], default_section: "BUS TOUR" });
  if (p === `${B}/bulk`) {
    const body = await readBody(req);
    entry.body = body;
    if ("ticket_tour_type" in body) {
      if ("manifest_id" in body || "booking_type" in body) return send(res, 400, { detail: "Change tour type on its own." });
      if (!validKey(body.ticket_tour_type)) return send(res, 400, { detail: "Unknown tour type." });
      const sel = products.filter((x) => body.ids.includes(x.id));
      if (body.ticket_tour_type !== null && sel.some((x) => x.booking_type !== "ticket")) return send(res, 400, { detail: "Only ticket products have a tour type." });
    }
    let updated = 0, unchanged = 0;
    for (const id of body.ids) {
      const prod = products.find((x) => x.id === id);
      const before = JSON.stringify(prod);
      if ("manifest_id" in body) prod.manifest_id = body.manifest_id;
      if ("booking_type" in body) prod.booking_type = body.booking_type || null;
      if ("ticket_tour_type" in body) prod.ticket_tour_type = body.ticket_tour_type;
      JSON.stringify(prod) === before ? unchanged++ : updated++;
    }
    return send(res, 200, { updated, unchanged, missing: 0 });
  }
  let m = p.match(/^\/api\/settings\/products\/(\d+)\/tour-type$/);
  if (m && req.method === "PATCH") {
    const body = await readBody(req);
    entry.body = body;
    await new Promise((r) => setTimeout(r, 200));
    const prod = products.find((x) => x.id === Number(m[1]));
    if (ctl.failTour) return send(res, 400, { detail: "Tour type rejected (mock)." });
    if (!validKey(body.ticket_tour_type)) return send(res, 400, { detail: "Unknown tour type." });
    if (body.ticket_tour_type !== null && prod.booking_type !== "ticket") return send(res, 400, { detail: "Only ticket products have a tour type." });
    prod.ticket_tour_type = body.ticket_tour_type;
    entries.unshift({ id: entries.length + 1, entity_id: String(prod.id), label: prod.product_code, action: "update", before: { ticket_tour_type: null }, after: { ticket_tour_type: body.ticket_tour_type }, actor: "zztest", actor_name: "ZZ Test", created_at: "2026-10-07T18:00:00+00:00" });
    return send(res, 200, { success: true, ticket_tour_type: body.ticket_tour_type });
  }
  m = p.match(/^\/api\/settings\/products\/(\d+)$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    Object.assign(products.find((x) => x.id === Number(m[1])), { ...body, booking_type: body.booking_type || null });
    return send(res, 200, { success: true });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("products tour-type mock on 8799"));
