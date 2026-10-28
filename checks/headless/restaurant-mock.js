// 模拟后端：Supplier › Restaurant 午餐店（G199，形状照后端 8a `task/g199-supplier-restaurant` 11636fb：
// app/routers/supplier.py + app/services/lunch_restaurants.py；400 原话照 8a 2026-10-27 发来的清单）。
// Manifest setup 那一行（lunch_restaurant）在 products 套里测。
// 控制：POST /__ctl {reset, fail401, staff, superadmin, unavailable, fail500}；GET /__log。端口默认 8799（MOCK_PORT 可改）。
const http = require("http");

const ctl = { fail401: false, staff: false, superadmin: false, unavailable: false, fail500: false };
const log = [];

let restaurants, groups, nextId;
function reset() {
  restaurants = [
    {
      id: 1,
      name: "ZZ Test Bee's",
      footer: "(TEXT) POC: ZZ TEST 555-0100 & ZZ TEST 555-0101\nCALL no later than 7pm, night before  555-0102",
      staff_note: "",
      updated_by: "Annie",
      updated_at: "2026-10-27T23:12:00+00:00",
    },
  ];
  // 团 → 店（一团一店）。Grand Canyon West 停用了，没有店。
  groups = [
    { id: 3, display_name: "Antelope", is_active: true, restaurant_id: 1 },
    { id: 4, display_name: "Bryce Zion", is_active: true, restaurant_id: null },
    { id: 5, display_name: "South Rim", is_active: true, restaurant_id: null },
    { id: 6, display_name: "Grand Canyon West", is_active: false, restaurant_id: null },
  ];
  nextId = 10;
}
reset();

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function listAll() {
  const rs = [...restaurants]
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id - b.id)
    .map((r) => ({ ...r, groups: groups.filter((g) => g.restaurant_id === r.id).map((g) => ({ id: g.id, display_name: g.display_name })) }));
  return { restaurants: rs, groups: groups.map((g) => ({ ...g })) };
}

class Bad extends Error {}
function cleanName(v) {
  if (v != null && typeof v !== "string") throw new Bad("The restaurant name must be text.");
  const s = (v || "").split(/\s+/).filter(Boolean).join(" ");
  if (!s) throw new Bad("Enter the restaurant name.");
  if (s.length > 80) throw new Bad(`The restaurant name is ${s.length} characters - the limit is 80.`);
  return s;
}
function cleanFooter(v) {
  if (v != null && typeof v !== "string") throw new Bad("The lunch sheet footer must be text.");
  const lines = (v || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.split(/\s+/).filter(Boolean).join(" ")).filter(Boolean);
  if (lines.length > 2) throw new Bad("The lunch sheet footer can have at most 2 lines.");
  const s = lines.join("\n");
  if (s.length > 300) throw new Bad(`The lunch sheet footer is ${s.length} characters - the limit is 300.`);
  return s;
}
function cleanNote(v) {
  const s = (v || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).join("\n").replace(/^\n+|\n+$/g, "");
  if (s.length > 1000) throw new Bad(`The staff note is ${s.length} characters - the limit is 1000.`);
  return s;
}
function cleanIds(v) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.some((m) => !Number.isInteger(m))) throw new Bad("The tour list could not be read. Please reload the page.");
  return [...new Set(v)].sort((a, b) => a - b);
}
const taken = (name, except) => restaurants.some((r) => r.name.toLowerCase() === name.toLowerCase() && r.id !== except);
function assign(rid, ids) {
  if (ids.some((m) => !groups.find((g) => g.id === m))) throw new Bad("One of the tours is not in the bus tour list. Reload the page and try again.");
  const moved = {};
  for (const g of groups) {
    if (ids.includes(g.id)) {
      if (g.restaurant_id != null && g.restaurant_id !== rid) moved[g.id] = g.restaurant_id;
      g.restaurant_id = rid;
    } else if (g.restaurant_id === rid) g.restaurant_id = null;
  }
  return moved;
}
const stamp = () => new Date().toISOString();

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      const body = JSON.parse((await readRaw(req)).toString() || "{}");
      if (body.reset) {
        reset();
        log.length = 0;
      }
      Object.assign(ctl, { ...body, reset: undefined });
      return send(res, 200, ctl);
    }
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }
    const entry = { method: req.method, path: p, query: url.search };
    log.push(entry);
    // G203 第二批：共用读接口（后端 f76d5e9）。
    if (p === "/api/supplier/restaurants/action-log") return send(res, 200, { next_cursor: null, entries: [{ id: "2-1", at: "2026-10-28T17:00:00+00:00", by: "Annie Z", action: "update", label: "ZZ Test item", what: "Name", from: "Old", to: "New" }, { id: "1-1", at: "2026-10-27T17:00:00+00:00", by: "Max", action: "create", label: "ZZ Test item", what: "Name", from: null, to: "Old" }] });
    const raw = await readRaw(req);
    if (raw.length) entry.body = JSON.parse(raw.toString());
    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
    if (p === "/api/me")
      return send(res, 200, {
        id: 1,
        username: "zztest",
        display_name: "ZZ Test",
        initials: "ZT",
        role: ctl.staff ? "staff" : ctl.superadmin ? "superadmin" : "admin",
        is_admin: !ctl.staff,
        is_superadmin: ctl.superadmin,
      });

    // 侧栏 Supplier › Partners 的「谁看得到」（farm_out_settings）放给所有人，Supplier 组才画得出来。
    if (p === "/api/settings/dashboard-widgets")
      return send(res, 200, { readable: true, widgets: [{ key: "farm_out_settings", label: "farm_out_settings", visibility: "staff", default: "super_admin_only", visible_to_me: true }] });
    if (!p.startsWith("/api/supplier/restaurants")) return send(res, 404, { detail: "mock: not found" });
    if (ctl.unavailable) return send(res, 404, { detail: "Not Found" });
    if (ctl.staff) return send(res, 403, { detail: "Admin access required" });
    if (ctl.fail500 && req.method !== "GET") return send(res, 500, { detail: "Could not save. Nothing was changed - try again." });

    try {
      if (p === "/api/supplier/restaurants" && req.method === "GET") return send(res, 200, listAll());
      const b = entry.body || {};
      if (p === "/api/supplier/restaurants" && req.method === "POST") {
        const f = { name: cleanName(b.name), footer: cleanFooter(b.footer), staff_note: cleanNote(b.staff_note) };
        const ids = cleanIds(b.manifest_ids);
        if (taken(f.name)) throw new Bad(`There is already a restaurant called ${f.name}.`);
        const r = { id: nextId++, ...f, updated_by: "ZZ Test", updated_at: stamp() };
        restaurants.push(r);
        const moved = assign(r.id, ids);
        return send(res, 200, { ok: true, id: r.id, ...f, manifest_ids: ids, moved_from: moved });
      }
      const m = /^\/api\/supplier\/restaurants\/(\d+)$/.exec(p);
      const r = m && restaurants.find((x) => x.id === Number(m[1]));
      if (m && !r) throw new Bad("That restaurant is no longer there. Reload the page.");
      if (r && req.method === "PUT") {
        const f = { name: cleanName(b.name), footer: cleanFooter(b.footer), staff_note: cleanNote(b.staff_note) };
        if (f.name.toLowerCase() !== r.name.toLowerCase() && taken(f.name, r.id)) throw new Bad(`There is already a restaurant called ${f.name}.`);
        const cur = groups.filter((g) => g.restaurant_id === r.id).map((g) => g.id);
        const ids = "manifest_ids" in b ? cleanIds(b.manifest_ids) : cur;
        const moved = ids.join(",") !== cur.join(",") ? assign(r.id, ids) : {};
        if (f.name !== r.name || f.footer !== r.footer || f.staff_note !== r.staff_note) Object.assign(r, f, { updated_by: "ZZ Test", updated_at: stamp() });
        return send(res, 200, { ok: true, id: r.id, ...f, manifest_ids: ids, ...(Object.keys(moved).length ? { moved_from: moved } : {}) });
      }
      if (r && req.method === "DELETE") {
        const names = groups.filter((g) => g.restaurant_id === r.id).map((g) => g.display_name);
        if (names.length) throw new Bad(`${r.name} is still the lunch restaurant for ${names.join(", ")}. Remove those tours from it first.`);
        restaurants = restaurants.filter((x) => x !== r);
        return send(res, 200, { ok: true, id: r.id });
      }
      return send(res, 405, { detail: "Method Not Allowed" });
    } catch (e) {
      if (e instanceof Bad) return send(res, 400, { detail: e.message });
      throw e;
    }
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("restaurant mock up"));
