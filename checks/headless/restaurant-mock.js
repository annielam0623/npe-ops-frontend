// 模拟后端：Supplier › Restaurant 午餐店（G199，形状照后端 8a `task/g199-supplier-restaurant` 11636fb：
// app/routers/supplier.py + app/services/lunch_restaurants.py；400 原话照 8a 2026-10-27 发来的清单）。
// Manifest setup 那一行（lunch_restaurant）在 products 套里测。
// 控制：POST /__ctl {reset, fail401, staff, superadmin, unavailable, fail500, importFail, importConflict, importFileError}；GET /__log。端口默认 8799（MOCK_PORT 可改）。
const http = require("http");

const ctl = { fail401: false, staff: false, superadmin: false, unavailable: false, fail500: false, importFail: false, importConflict: false, importFileError: "" };
const log = [];

let restaurants, groups, nextId;
function reset() {
  restaurants = [
    {
      id: 1,
      name: "ZZ Test Bee's",
      footer: "(TEXT) POC: ZZ TEST 555-0100 & ZZ TEST 555-0101\nCALL no later than 7pm, night before  555-0102",
      staff_note: "",
      // 四栏（后端 20 3bcf395 / v127）：电话存 E.164，没填是 ""。
      address: "1201 ZZ Test Ave, Tusayan, AZ 86023",
      phone: "+19285550110",
      text_number: "",
      email: "",
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
// 四栏的检查 / 规整（照后端 20 的规则：电话数字和空格 ( ) + - .，10–15 位，存 E.164；email 要像 email）。
function cleanPhone(label, v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  if (/[^0-9\s()+\-.]/.test(s) || digits.length < 10 || digits.length > 15) throw new Bad(`${label} must be a phone number with 10 to 15 digits.`);
  if (s.startsWith("+")) return `+${digits}`;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}
function cleanEmail(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Bad("Email is not a valid email address.");
  return s;
}
function contactOf(b, cur) {
  const out = {};
  if ("address" in b || !cur) out.address = String(b.address || "").trim();
  if ("phone" in b || !cur) out.phone = cleanPhone("Phone", b.phone);
  if ("text_number" in b || !cur) out.text_number = cleanPhone("Text", b.text_number);
  if ("email" in b || !cur) out.email = cleanEmail(b.email);
  return out;
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
    // ⬆ Import（preview ③-4 / 需要后端 B6：标准 bulk_import 形状，同 vehicles / pickup）。multipart，不按 JSON 读。
    // 栏 key：name / address / phone / text_number / email / staff_note；按店名对上，没对上的新建（不分团）。
    // 错误原话照 lunch_restaurants.clean_*；控制 importFileError（400）/ importConflict（409）/ importFail（500）。
    if (p === "/api/supplier/restaurants/import/preview" || p === "/api/supplier/restaurants/import/commit") {
      const raw = (await readRaw(req)).toString();
      entry.hasFile = /filename="restaurant-import\.csv"/.test(raw);
      if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
      if (ctl.staff) return send(res, 403, { detail: "Admin access required" });
      if (ctl.importFileError) return send(res, 400, { detail: ctl.importFileError });
      if (p.endsWith("/preview")) {
        const rows = [
          { status: "update", id: 1, row: 2, values: { name: "ZZ Test Bee's", address: "1201 ZZ Test Ave, Tusayan, AZ 86023", phone: "+19285550110", text_number: "", email: "zz.bees@example.com", staff_note: "" }, before: { email: "" }, changed: ["email"], blanked: ["text_number", "staff_note"], errors: [] },
          { status: "new", id: null, row: 3, values: { name: "ZZ Test Grill", address: "12 Main St, Kanab, UT", phone: "+14355550101", text_number: "", email: "", staff_note: "" }, before: {}, changed: ["name", "address", "phone"], blanked: [], errors: [] },
          { status: "error", id: null, row: 4, values: { name: "ZZ Test Cafe", address: "", phone: "555-0", text_number: "", email: "", staff_note: "" }, before: {}, changed: [], blanked: [], errors: [{ field: "phone", message: "Phone doesn't look like a phone number. Use digits, e.g. (928) 555-0110." }] },
          { status: "error", id: null, row: 5, values: { name: "", address: "3 Lake Powell Blvd, Page, AZ", phone: "", text_number: "", email: "", staff_note: "" }, before: {}, changed: [], blanked: [], errors: [{ field: "name", message: "Enter the restaurant name." }] },
          { status: "error", id: null, row: 6, values: { name: "ZZ Test Grill", address: "", phone: "", text_number: "", email: "", staff_note: "" }, before: {}, changed: [], blanked: [], errors: [{ field: null, message: "Repeated above — skipped." }] },
        ];
        const counts = { new: 0, update: 0, unchanged: 0, error: 0 };
        for (const r of rows) counts[r.status]++;
        return send(res, 200, { columns: ["name", "address", "phone", "text_number", "email", "staff_note"], rows, counts });
      }
      if (ctl.importConflict) return send(res, 409, { detail: "Someone changed the restaurant list while this file was being saved. Nothing was saved — check the preview again." });
      if (ctl.importFail) return send(res, 500, { detail: "Database is busy" });
      restaurants.find((r) => r.id === 1).email = "zz.bees@example.com";
      restaurants.push({ id: nextId++, name: "ZZ Test Grill", footer: "", staff_note: "", address: "12 Main St, Kanab, UT", phone: "+14355550101", text_number: "", email: "", updated_by: "ZZ Test", updated_at: stamp() });
      return send(res, 200, { created: 1, updated: 1, unchanged: 0, skipped: 3 });
    }
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
        const r = { id: nextId++, ...f, ...contactOf(b, null), updated_by: "ZZ Test", updated_at: stamp() };
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
        const c = contactOf(b, r);
        const contactChanged = Object.keys(c).some((k) => c[k] !== r[k]);
        if (f.name !== r.name || f.footer !== r.footer || f.staff_note !== r.staff_note || contactChanged) Object.assign(r, f, c, { updated_by: "ZZ Test", updated_at: stamp() });
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
