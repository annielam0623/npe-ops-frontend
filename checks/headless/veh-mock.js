// 模拟后端：Settings → Vehicles。控制：POST /__ctl；GET /__log。
const http = require("http");
const ctl = { fail401: false, staff: false, failActive: false, importFail: false };
const log = [];
const P = "https://cloud.samsara.com/";
let nextId = 10;
const vehicles = [
  { id: 1, van_no: "768", samsara_url: P + "o/abc", is_active: true, notes: "Big bus", seats: 54, scheduled_days: 12, custom: { "1": "ABC123", "2": "old secret" } },
  { id: 2, van_no: "2657", samsara_url: "", is_active: true, notes: "", seats: null, scheduled_days: 1, custom: {} },
  { id: 3, van_no: "Sienna Van", samsara_url: "", is_active: false, notes: "old", seats: 7, scheduled_days: 0, custom: {} },
];
const columns = [{ id: 1, label: "Plate", is_hidden: false }, { id: 2, label: "Old Code", is_hidden: true }];
let nextCol = 3;
function send(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
function readBody(req) { return new Promise((r) => { let d = ""; req.setEncoding("utf8"); req.on("data", (c) => (d += c)); req.on("end", () => r(d ? JSON.parse(d) : null)); }); }
function clean(b) {
  const van_no = String(b.van_no || "").trim().split(/\s+/).filter(Boolean).join(" ");
  if (!van_no) throw "Enter the vehicle number.";
  if (b.samsara_url && !b.samsara_url.startsWith(P)) throw `That is not a Samsara live-location link. It must start with ${P} - copy the share link from Samsara. Leave it empty if this vehicle has no GPS.`;
  const seats = b.seats === "" || b.seats == null ? null : Number(b.seats);
  return { van_no, samsara_url: b.samsara_url || "", notes: (b.notes || "").trim(), seats };
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
  if (p === "/api/settings/vehicles" && req.method === "GET") return send(res, 200, { vehicles, columns });
  if (p === "/api/settings/vehicles" && req.method === "PUT") {
    const b = await readBody(req); entry.body = b;
    const errors = {};
    for (const r of b.vehicles) {
      try { const v = clean(r); const row = vehicles.find((x) => x.id === r.id); if (v.van_no !== row.van_no && r.confirm_rename !== true) throw "Confirm to change it."; } catch (e) { errors[r.id] = e; }
    }
    if (Object.keys(errors).length) return send(res, 400, { detail: { message: `Nothing was saved. Fix the ${Object.keys(errors).length} row(s) marked in red, then click Save all again.`, errors } });
    for (const r of b.vehicles) { const row = vehicles.find((x) => x.id === r.id); Object.assign(row, clean(r)); for (const [k, v] of Object.entries(r.custom || {})) { if (v) row.custom[k] = v; else delete row.custom[k]; } }
    return send(res, 200, { success: true, saved: b.vehicles.length });
  }
  if (p === "/api/settings/vehicles/columns" && req.method === "POST") {
    const b = await readBody(req); entry.body = b;
    const label = String(b.label || "").trim();
    if (!label) return send(res, 400, { detail: "Enter a name for the column." });
    if (columns.some((c) => c.label.toLowerCase() === label.toLowerCase())) return send(res, 400, { detail: `There is already a column called ${label} (it may be hidden - look under Extra columns).` });
    const col = { id: nextCol++, label, is_hidden: false };
    columns.push(col);
    return send(res, 200, { column: col });
  }
  const mc = /^\/api\/settings\/vehicles\/columns\/(\d+)$/.exec(p);
  if (mc) {
    const b = await readBody(req); entry.body = b;
    const c = columns.find((x) => x.id === Number(mc[1]));
    Object.assign(c, b);
    return send(res, 200, { column: c });
  }
  // ⬆ Import（全站通用导入，标准接口形状见 types/bulk-import.ts；后端还没上）。
  if (p === "/api/settings/vehicles/import/preview" || p === "/api/settings/vehicles/import/commit") {
    const raw = await readRaw(req);
    entry.hasFile = /filename="veh-import\.csv"/.test(raw);
    if (p.endsWith("/preview")) return send(res, 200, {"columns": ["van_no", "seats", "custom:1", "notes", "is_active"], "rows": [{"status": "update", "id": 1, "values": {"van_no": "768", "seats": "54", "custom:1": "ABC124", "notes": "", "is_active": "Active"}, "before": {"custom:1": "ABC123"}, "changed": ["custom:1"], "blanked": ["notes"], "errors": []}, {"status": "unchanged", "id": 2, "values": {"van_no": "2657", "seats": "", "custom:1": "", "notes": "", "is_active": "Active"}, "before": {}, "changed": [], "blanked": [], "errors": []}, {"status": "new", "id": null, "values": {"van_no": "ZZ Test Van", "seats": "15", "custom:1": "", "notes": "", "is_active": "Active"}, "before": {}, "changed": [], "blanked": [], "errors": []}, {"status": "error", "id": null, "values": {"van_no": "999", "seats": "lots", "custom:1": "", "notes": "", "is_active": "Active"}, "before": {}, "changed": [], "blanked": [], "errors": [{"field": "seats", "message": "Seats must be a whole number."}]}, {"status": "error", "id": null, "values": {"van_no": "ZZ Test Van", "seats": "", "custom:1": "", "notes": "", "is_active": ""}, "before": {}, "changed": [], "blanked": [], "errors": [{"field": null, "message": "Repeated above — skipped."}]}]});
    if (ctl.importFail) return send(res, 500, { detail: "Database is busy" });
    vehicles.find((v) => v.id === 1).custom["1"] = "ABC124"; vehicles.push({ id: nextId++, van_no: "ZZ Test Van", samsara_url: "", is_active: true, notes: "", seats: 15, scheduled_days: 0, custom: {} });
    return send(res, 200, {"created": 1, "updated": 1, "unchanged": 1, "skipped": 2});
  }
  // G203 共用读接口（后端 3686fea）：自加列后端写现在的列名，停用写 Status Active → Inactive。
  if (p === "/api/settings/vehicles/action-log") return send(res, 200, { next_cursor: null, entries: [
    { id: "4-1", at: "2026-10-03T20:00:00+00:00", by: "Annie", action: "add column", label: "Plate", what: "Column", from: null, to: "Plate" },
    { id: "3-1", at: "2026-10-03T19:00:00+00:00", by: "Annie", action: "update", label: "768", what: "Plate", from: "", to: "ABC123" },
    { id: "2-1", at: "2026-10-03T18:00:00+00:00", by: "Annie", action: "rename", label: "769", what: "Number", from: "768", to: "769" },
    { id: "1-1", at: "2026-10-02T18:00:00+00:00", by: "Annie", action: "deactivate", label: "Sienna Van", what: "Status", from: "Active", to: "Inactive" },
  ] });
  if (p === "/api/settings/vehicles" && req.method === "POST") {
    const b = await readBody(req); entry.body = b;
    try {
      const v = clean(b);
      if (vehicles.some((x) => x.van_no.toLowerCase() === v.van_no.toLowerCase())) return send(res, 400, { detail: `Vehicle ${v.van_no} is already in the list.` });
      const row = { id: nextId++, ...v, is_active: true, scheduled_days: 0, custom: {} };
      vehicles.push(row);
      return send(res, 200, { vehicle: { id: row.id, ...v } });
    } catch (e) { return send(res, 400, { detail: e }); }
  }
  let m = /^\/api\/settings\/vehicles\/(\d+)$/.exec(p);
  if (m) {
    const b = await readBody(req); entry.body = b;
    const row = vehicles.find((x) => x.id === Number(m[1]));
    try {
      const v = clean(b);
      if (v.van_no !== row.van_no && b.confirm_rename !== true) return send(res, 400, { detail: "Confirm to change it." });
      Object.assign(row, v);
      for (const [k, val] of Object.entries(b.custom || {})) { if (val) row.custom[k] = val; else delete row.custom[k]; }
      return send(res, 200, { success: true });
    } catch (e) { return send(res, 400, { detail: e }); }
  }
  m = /^\/api\/settings\/vehicles\/(\d+)\/active$/.exec(p);
  if (m) {
    const b = await readBody(req); entry.body = b;
    if (ctl.failActive) return send(res, 400, { detail: "That vehicle is not in the list any more. Reload the page." });
    vehicles.find((x) => x.id === Number(m[1])).is_active = b.active;
    return send(res, 200, { success: true, is_active: b.active });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("veh mock on", process.env.MOCK_PORT || 8799));
