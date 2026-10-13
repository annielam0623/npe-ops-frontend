// 模拟后端：Products 页。控制：POST /__ctl {fail401, staff, failMissing}；GET /__log。
const http = require("http");
const ctl = { fail401: false, staff: false, failMissing: false, slowNextProductPut: 0, slowNextGroupPut: 0 };
const log = [];
const groups = [
  { id: 1, name: "upper_antelope", display_name: "Upper Antelope", booking_type: "bus_tour", is_active: true, sort_order: 1 },
  { id: 2, name: "shuttle_lv", display_name: "LV Shuttle", booking_type: "shuttle", is_active: true, sort_order: 2 },
  { id: 3, name: "old", display_name: "Old Group", booking_type: null, is_active: false, sort_order: 3 },
];
let products = [
  { id: 10, product_code: "UAC01", product_name: "Upper Antelope Bus", internal_name: "UA Bus", manifest_id: 1, booking_type: "bus_tour", is_active: true },
  { id: 11, product_code: "UAC02", product_name: "Upper Antelope VIP", internal_name: "", manifest_id: 1, booking_type: null, is_active: true },
  { id: 12, product_code: "SHT01", product_name: "LV Shuttle <b>x</b>", internal_name: "", manifest_id: 2, booking_type: "shuttle", is_active: true },
  { id: 13, product_code: "PFYF01", product_name: "", internal_name: "", manifest_id: null, booking_type: null, is_active: false },
  { id: 14, product_code: "LEG01", product_name: "Legacy", internal_name: "", manifest_id: null, booking_type: "weird_old", is_active: true },
];
let nextId = 100;
let nextExtraId = 50;
const missing = [
  { product_code: "NEW01", product_name: "ZZ Test New Tour", upcoming_rows: 5, total_rows: 7, first_date: "2026-10-05", last_date: "2026-11-02" },
  { product_code: "NEW02", product_name: "ZZ Test Fails", upcoming_rows: 2, total_rows: 2, first_date: "2026-10-09", last_date: "2026-10-09" },
  { product_code: "OLD01", product_name: "", upcoming_rows: 0, total_rows: 3, first_date: "2025-06-01", last_date: "2025-08-01" },
];
const setup = {
  groups: [{ id: 1, display_name: "Upper Antelope", is_active: true, manifest_color: "#8db76f", manifest_lunch_note: null,
    guests_per_bus: 54, forecast_split_sections: [], section_order: [],
    counters: [], extras: [{ id: 5, name: "HELI", seats: 12 }],
    products: [{ id: 10, manifest_id: 1, product_code: "UAC01", product_name: "Upper Antelope Bus", internal_name: "UA Bus", is_active: true, manifest_section: "", manifest_section_kind: "tour", manifest_extra_id: null, return_pickup_time: "", return_pickup_place: "" }] }],
  kinds: [{ value: "tour", label: "Tour" }, { value: "outbound", label: "Shuttle outbound" }, { value: "inbound", label: "Shuttle inbound" }, { value: "roundtrip", label: "Shuttle round trip" }],
  default_section: "BUS TOUR",
};
const entries = [
  { id: 1, entity_id: "10", label: "UAC01", action: "update", before: { internal_name: "", manifest_id: 3, booking_type: null }, after: { internal_name: "UA Bus", manifest_id: 1, booking_type: "bus_tour" }, actor: "annie", actor_name: "Annie Z", created_at: "2026-10-02T16:00:00+00:00" },
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
  const B = "/api/settings/products";
  if (p === B && req.method === "GET") {
    const sorted = [...products].map(withGroup).sort((a, b) => (a.group_sort ?? 99) - (b.group_sort ?? 99) || a.product_name.localeCompare(b.product_name));
    return send(res, 200, { products: sorted });
  }
  // Groups 管理（后端 85a5d95）：显示名不分大小写不能重复；Short name / Category 建了不能改；没有删除。
  if (p === `${B}/groups` && req.method === "POST") {
    const body = await readBody(req);
    entry.body = body;
    if (!/^[A-Za-z0-9]+$/.test(body.name || "")) return send(res, 400, { detail: "Short name: letters and numbers only, no spaces." });
    if (!body.booking_type) return send(res, 400, { detail: "Pick a category." });
    if (groups.some((g) => g.display_name.toLowerCase() === String(body.display_name).trim().toLowerCase())) return send(res, 400, { detail: `A group called "${body.display_name}" already exists.` });
    const g = { id: Math.max(...groups.map((x) => x.id)) + 1, name: body.name, display_name: String(body.display_name).trim(), booking_type: body.booking_type, is_active: true, sort_order: body.sort_order ?? Math.max(...groups.map((x) => x.sort_order)) + 1 };
    groups.push(g);
    groups.sort((a, b) => a.sort_order - b.sort_order);
    return send(res, 200, g);
  }
  const gm = p.match(/^\/api\/settings\/products\/groups\/(\d+)$/);
  if (gm && req.method === "PATCH") {
    const body = await readBody(req);
    entry.body = body;
    const g = groups.find((x) => x.id === Number(gm[1]));
    if ("name" in body || "booking_type" in body) return send(res, 400, { detail: "Short name and Category cannot be changed." });
    if ("sort_order" in body && !Number.isInteger(body.sort_order)) return send(res, 400, { detail: "Order must be a whole number from 0 to 9999." });
    if ("display_name" in body && groups.some((x) => x.id !== g.id && x.display_name.toLowerCase() === String(body.display_name).trim().toLowerCase())) return send(res, 400, { detail: `A group called "${body.display_name}" already exists.` });
    Object.assign(g, body);
    groups.sort((a, b) => a.sort_order - b.sort_order);
    return send(res, 200, g);
  }
  if (p === `${B}/groups`) return send(res, 200, { groups, booking_types: ["bus_tour", "shuttle", "ticket", "unmapped"] });
  if (p === `${B}/missing`) return ctl.failMissing ? send(res, 500, { detail: "boom" }) : send(res, 200, { missing });
  if (p === `${B}/log`) return send(res, 200, { entries, limit: 50 });
  if (p === B && req.method === "POST") {
    const body = await readBody(req);
    entry.body = body;
    if (body.product_code === "NEW02") return send(res, 400, { detail: `"NEW02" is already in the list.` });
    products.push({ id: nextId++, product_code: body.product_code, product_name: body.product_name, internal_name: body.internal_name, manifest_id: body.manifest_id, booking_type: body.booking_type || null, is_active: true });
    return send(res, 200, { id: nextId - 1, product_code: body.product_code });
  }
  if (p === `${B}/bulk`) {
    const body = await readBody(req);
    entry.body = body;
    let updated = 0, unchanged = 0;
    for (const id of body.ids) {
      const prod = products.find((x) => x.id === id);
      const before = JSON.stringify(prod);
      if ("manifest_id" in body) prod.manifest_id = body.manifest_id;
      if ("booking_type" in body) prod.booking_type = body.booking_type || null;
      JSON.stringify(prod) === before ? unchanged++ : updated++;
    }
    return send(res, 200, { updated, unchanged, missing: 0 });
  }
  let m = p.match(/^\/api\/settings\/products\/(\d+)$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    entry.at = Date.now();
    if (ctl.slowNextProductPut) {
      const ms = ctl.slowNextProductPut;
      ctl.slowNextProductPut = 0;
      await new Promise((r) => setTimeout(r, ms));
    }
    entry.doneAt = Date.now();
    if (body.internal_name.length > 100 || body.internal_name === "FAIL") return send(res, 400, { detail: "Internal name is too long - the limit is 100." });
    Object.assign(products.find((x) => x.id === Number(m[1])), { ...body, booking_type: body.booking_type || null });
    return send(res, 200, { success: true });
  }
  m = p.match(/^\/api\/settings\/products\/(\d+)\/active$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    products.find((x) => x.id === Number(m[1])).is_active = body.active;
    return send(res, 200, { success: true, is_active: body.active });
  }
  const S = "/api/settings/manifest-setup";
  if (p === S) return send(res, 200, setup);
  m = p.match(/^\/api\/settings\/manifest-setup\/groups\/(\d+)$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    entry.at = Date.now();
    if (ctl.slowNextGroupPut) {
      const ms = ctl.slowNextGroupPut;
      ctl.slowNextGroupPut = 0;
      await new Promise((r) => setTimeout(r, ms));
    }
    entry.doneAt = Date.now();
    if (body.lunch_note.includes("\n") || body.lunch_note === "BAD") return send(res, 400, { detail: "The lunch sheet line can only contain ordinary characters on one line." });
    // 同后端 clean_guests_per_bus：不在 payload 里 = 不改；1–99 的整数，否则 400。
    if ("guests_per_bus" in body && !(/^\d+$/.test(String(body.guests_per_bus).trim()) && +body.guests_per_bus >= 1 && +body.guests_per_bus <= 99))
      return send(res, 400, { detail: "Guests per bus must be a whole number between 1 and 99." });
    setup.groups[0].manifest_color = body.color || null;
    setup.groups[0].manifest_lunch_note = body.lunch_note;
    if ("guests_per_bus" in body) setup.groups[0].guests_per_bus = +body.guests_per_bus;
    return send(res, 200, { ok: true, manifest_color: body.color || null, manifest_lunch_note: body.lunch_note, guests_per_bus: setup.groups[0].guests_per_bus });
  }
  m = p.match(/^\/api\/settings\/manifest-setup\/groups\/(\d+)\/forecast-split-sections$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    const out = body.sections.map((s) => s.trim()).filter(Boolean);
    if (out.some((s) => s.toLowerCase() === "bus tour")) return send(res, 400, { detail: "BUS TOUR is the main part of the tour - it cannot be its own block." });
    setup.groups[0].forecast_split_sections = out;
    return send(res, 200, { ok: true, sections: out });
  }
  // Section order（后端 G50）：整组替换；不分大小写不能重复，最多 20 个。
  m = p.match(/^\/api\/settings\/manifest-setup\/groups\/(\d+)\/section-order$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    const out = body.sections.map((s) => s.trim()).filter(Boolean);
    const seen = new Set();
    for (const s of out) {
      if (seen.has(s.toLowerCase())) return send(res, 400, { detail: `${s} is in the list twice.` });
      seen.add(s.toLowerCase());
    }
    if (out.length > 20) return send(res, 400, { detail: "At most 20 sections can be put in order per tour." });
    setup.groups[0].section_order = out;
    return send(res, 200, { ok: true, sections: out });
  }
  // Extra（后端 ad8b7ab）：整组送，没送回来的删掉、挂着它的产品变回 Tour；座位 1–999；同团不分大小写不能重名。
  m = p.match(/^\/api\/settings\/manifest-setup\/groups\/(\d+)\/extras$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    const names = new Set();
    for (const x of body.extras) {
      if (!/^\d+$/.test(String(x.seats)) || +x.seats < 1 || +x.seats > 999) return send(res, 400, { detail: `${x.name}: seats must be a whole number between 1 and 999.` });
      if (names.has(x.name.toLowerCase())) return send(res, 400, { detail: `Two extras are called ${x.name}. Give each one its own name.` });
      names.add(x.name.toLowerCase());
    }
    const g = setup.groups[0];
    g.extras = body.extras.map((x) => ({ id: x.id ?? ++nextExtraId, name: x.name, seats: +x.seats }));
    const ids = new Set(g.extras.map((x) => x.id));
    for (const pr of g.products) if (pr.manifest_extra_id !== null && !ids.has(pr.manifest_extra_id)) pr.manifest_extra_id = null;
    return send(res, 200, { ok: true, extras: g.extras });
  }
  m = p.match(/^\/api\/settings\/manifest-setup\/products\/(\d+)$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    const sec = body.section.trim().toUpperCase();
    const pr = setup.groups[0].products[0];
    if (body.extra_id != null && body.kind !== "tour") return send(res, 400, { detail: "Only a Tour product can have an extra." });
    Object.assign(pr, { manifest_section: sec, manifest_section_kind: body.kind });
    if ("extra_id" in body) pr.manifest_extra_id = body.extra_id;
    // G36：回程接客时间 / 地点，不传 = 不改；同后端去掉首尾空格。
    if ("return_pickup_time" in body) pr.return_pickup_time = String(body.return_pickup_time).trim();
    if ("return_pickup_place" in body) pr.return_pickup_place = String(body.return_pickup_place).trim();
    return send(res, 200, { ok: true, section: sec, kind: body.kind, extra_id: pr.manifest_extra_id, return_pickup_time: pr.return_pickup_time, return_pickup_place: pr.return_pickup_place });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("products mock on 8799"));
