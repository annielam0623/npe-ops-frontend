// 模拟后端：/manifests 页（后端 task/manifests-fields 契约 A–D，提交 04f3fa0）。
// 控制：POST /__ctl {fail401, role, fail, prefsFail, prefs:{bus,tickets}}；GET /__log。
// role: admin（默认，有金额组）| staff（没有金额组）| driver（403）。
const http = require("http");
const ctl = { fail401: false, role: "admin", fail: false, prefsFail: false, cfm404: false };
const prefs = { manifest_cols_bus: null, manifest_cols_tickets: null };
const log = [];
const cfm = new Map(); // row_key → {confirmation_no, updated_by, updated_at}

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

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

const GROUPS = [
  { key: "guest", label: "Guest" },
  { key: "trip", label: "Trip" },
  { key: "booking", label: "Booking" },
  { key: "ours", label: "Our records" },
  { key: "questions", label: "Booking questions" },
  { key: "money", label: "Money" },
];
const BASE_CATALOG = [
  { key: "guest_name", label: "Guest", group: "guest", type: "text" },
  { key: "phone", label: "Phone", group: "guest", type: "text" },
  { key: "pax", label: "Pax", group: "guest", type: "number" },
  { key: "product", label: "Product", group: "trip", type: "text" },
  { key: "start_time", label: "Start time", group: "trip", type: "text" },
  { key: "pickup_time", label: "Pickup time", group: "trip", type: "text" },
  { key: "pickup_location", label: "Pickup location", group: "trip", type: "text" },
  { key: "order_number", label: "Order #", group: "booking", type: "text" },
  { key: "rezdy_cfm", label: "Rezdy Cfm #", group: "booking", type: "text" },
  { key: "comments", label: "Comments", group: "booking", type: "text" },
  { key: "date_created", label: "Booked at", group: "booking", type: "datetime" },
  { key: "staff_cfm", label: "Cfm #", group: "ours", type: "text" },
  { key: "staff_cfm_by", label: "Cfm # by", group: "ours", type: "text" },
  { key: "staff_cfm_at", label: "Cfm # at", group: "ours", type: "datetime" },
  { key: "transfer_return", label: "Return transfer", group: "trip", type: "bool" },
];
const MONEY = [
  { key: "order_total", label: "Order total", group: "money", type: "money" },
  { key: "currency", label: "Currency", group: "money", type: "text" },
];
const BUS_QUESTION = { key: "q:0123456789", label: "Dietary needs?", group: "questions", type: "text" };
const PAX_QUESTION = { key: "pq:abcdef0123", label: "Passport name (per guest)", group: "questions", type: "text" };

const DEFAULTS = {
  bus: ["order_number", "guest_name", "pax", "pickup_time", "pickup_location", "rezdy_cfm", "staff_cfm"],
  tickets: ["order_number", "guest_name", "pax", "start_time", "staff_cfm"],
};

// 当天的行：Bus 三颗胶囊（A→Z，none 最后），Tickets 两颗。值是这一行的全部字段，按 fields 裁剪后返回。
const ROWS = [
  { tab: "bus", pill: "g:3", order_number: "CHD1001", product_code: "ANT01", lane_source: "rezdy_bookings",
    v: { guest_name: "ZZ Test One", phone: "+15550000001", pax: 2, product: "Antelope Bus", pickup_time: "7:00 AM", pickup_location: "Aria",
      rezdy_cfm: "RZ-1", comments: "Window seat please, we are celebrating an anniversary trip with family", date_created: "2026-10-01T17:30:00Z",
      transfer_return: true, order_total: 249.5, currency: "USD", "q:0123456789": "Vegetarian", "pq:abcdef0123": "ZZ ONE; ZZ ONE JR" } },
  { tab: "bus", pill: "g:3", order_number: "CHD1002", product_code: "ANT01", lane_source: "legacy",
    v: { guest_name: "ZZ Test Two", phone: "=cmd", pax: 4, product: "Antelope Bus", pickup_time: "7:15 AM", pickup_location: "Resorts World",
      rezdy_cfm: null, comments: null, date_created: null, transfer_return: false, order_total: 100, currency: "USD" } },
  { tab: "bus", pill: "g:7", order_number: "CHD1003", product_code: "GCW01", lane_source: "rezdy_bookings",
    v: { guest_name: "ZZ Test Three", phone: "", pax: 1, product: "Grand Canyon West", pickup_time: "6:00 AM", pickup_location: "MGM Grand",
      rezdy_cfm: "RZ-3", order_total: 99, currency: "USD", "q:0123456789": "None" } },
  { tab: "bus", pill: "g:none", order_number: "CHD1004", product_code: "ZZNEW", lane_source: "rezdy_bookings",
    v: { guest_name: "ZZ Test Four", pax: 3, product: "ZZ New Product", pickup_time: "8:00 AM", order_total: 10, currency: "USD" } },
  { tab: "tickets", pill: "t:antelope", order_number: "CHD2001", product_code: "TIX01", lane_source: "rezdy_bookings",
    v: { guest_name: "ZZ Ticket One", pax: 2, product: "Antelope Tickets", start_time: "2026-10-07 07:00:00", order_total: 120, currency: "USD", "pq:abcdef0123": "ZZ T1" } },
  { tab: "tickets", pill: "t:none", order_number: "CHD2002", product_code: "TIX99", lane_source: "rezdy_bookings",
    v: { guest_name: "ZZ Ticket Two", pax: 1, product: "ZZ Ticket NoType", start_time: "2026-10-07 09:30:00" } },
];
const PILL_LABEL = {
  "g:3": "Antelope Bus Tour",
  "g:7": "Grand Canyon West",
  "g:none": "No group yet",
  "t:antelope": "Antelope Canyon",
  "t:none": "No tour type yet",
};
const rowKey = (r, date) => `${r.order_number}|${r.product_code}|${date}`;

function counts(rows) {
  return { rows: rows.length, orders: new Set(rows.map((r) => r.order_number)).size, pax: rows.reduce((s, r) => s + (r.v.pax || 0), 0) };
}

function page(url) {
  const date = url.searchParams.get("date") || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [400, { detail: "Bad date" }];
  const tab = url.searchParams.get("tab") || "bus";
  if (tab !== "bus" && tab !== "tickets") return [400, { detail: "Bad tab" }];
  const isAdmin = ctl.role === "admin";
  const dayRows = date === today ? ROWS : [];
  const tabRows = dayRows.filter((r) => r.tab === tab);
  const pillKeys = [...new Set(tabRows.map((r) => r.pill))].sort((a, b) =>
    a.endsWith(":none") ? 1 : b.endsWith(":none") ? -1 : PILL_LABEL[a].localeCompare(PILL_LABEL[b]),
  );
  const pills = pillKeys.map((k) => ({ key: k, label: PILL_LABEL[k], ...counts(tabRows.filter((r) => r.pill === k)) }));
  const asked = url.searchParams.get("pill");
  const pill = pillKeys.includes(asked) ? asked : pillKeys[0] ?? null;
  // 问卷题只列当天该标签出现过的。
  const questions = [];
  if (tabRows.some((r) => "q:0123456789" in r.v)) questions.push(BUS_QUESTION);
  if (tabRows.some((r) => "pq:abcdef0123" in r.v)) questions.push(PAX_QUESTION);
  const catalog = [...BASE_CATALOG, ...questions, ...(isAdmin ? MONEY : [])];
  const known = new Set(catalog.map((f) => f.key));
  const moneyKeys = new Set(MONEY.map((f) => f.key));
  const asked_fields = url.searchParams.get("fields");
  const requested = asked_fields ? asked_fields.split(",").filter(Boolean) : DEFAULTS[tab];
  const fields = requested.filter((k) => known.has(k));
  const denied = requested.filter((k) => !known.has(k) && moneyKeys.has(k));
  const unknown = requested.filter((k) => !known.has(k) && !moneyKeys.has(k));
  const rows = tabRows
    .filter((r) => r.pill === pill)
    .map((r) => {
      const key = rowKey(r, date);
      const c = cfm.get(key);
      const all = { ...r.v, order_number: r.order_number, staff_cfm: c?.confirmation_no ?? null, staff_cfm_by: c?.updated_by ?? null, staff_cfm_at: c?.updated_at ?? null };
      const values = {};
      for (const k of fields) values[k] = all[k] ?? null;
      return { row_key: key, order_number: r.order_number, product_code: r.product_code, tour_date: date, lane_source: r.lane_source, values };
    });
  const tabs = ["bus", "tickets"].map((k) => ({ key: k, label: k === "bus" ? "Bus Tour" : "Tickets - SelfDrive", ...counts(dayRows.filter((r) => r.tab === k)) }));
  return [200, { date, tab, is_admin: isAdmin, tabs, pills, pill, catalog, groups: GROUPS.filter((g) => isAdmin || g.key !== "money"), default_fields: DEFAULTS[tab], fields, denied, unknown, rows }];
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      const body = (await readBody(req)) || {};
      if (body.prefs) {
        prefs.manifest_cols_bus = body.prefs.bus ?? null;
        prefs.manifest_cols_tickets = body.prefs.tickets ?? null;
        delete body.prefs;
      }
      if (body.clearCfm) {
        cfm.clear();
        delete body.clearCfm;
      }
      Object.assign(ctl, body);
      return send(res, 200, { ctl, prefs });
    }
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }
    const entry = { method: req.method, path: p, query: url.search };
    log.push(entry);
    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
    if (p === "/api/me")
      return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.role, is_admin: ctl.role === "admin", is_superadmin: false });
    const pm = p.match(/^\/api\/user-prefs\/(manifest_cols_(bus|tickets))$/);
    if (pm) {
      if (req.method === "GET") {
        if (ctl.prefsFail) return send(res, 500, { detail: "prefs down" });
        return send(res, 200, { key: pm[1], value: prefs[pm[1]] });
      }
      const body = await readBody(req);
      entry.body = body;
      if (body.value === "FAILME" || ctl.prefsFail) return send(res, 500, { detail: "prefs down" });
      prefs[pm[1]] = body.value;
      return send(res, 200, { key: pm[1], value: body.value });
    }
    if (ctl.role === "driver") return send(res, 403, { detail: "Staff access required" });
    if (p === "/api/manifests") {
      if (ctl.fail) return send(res, 500, { detail: "Internal Server Error" });
      const [status, body] = page(url);
      return send(res, status, body);
    }
    if (p === "/api/manifests/cfm" && req.method === "PUT") {
      const body = await readBody(req);
      entry.body = body;
      const r = ROWS.find((x) => x.order_number === body.order_number && x.product_code === body.product_code);
      if (!r || body.tour_date !== today || ctl.cfm404) return send(res, 404, { detail: "Not found in Rezdy" });
      const no = String(body.confirmation_no ?? "").trim();
      if (no.length > 100) return send(res, 400, { detail: "Too long" });
      const result = { confirmation_no: no, updated_by: "zztest", updated_at: "2026-10-07T18:05:00+00:00" };
      cfm.set(rowKey(r, body.tour_date), result);
      return send(res, 200, { order_number: body.order_number, product_code: body.product_code, tour_date: body.tour_date, ...result });
    }
    send(res, 404, { detail: "mock: not found" });
  })
  .listen(8799, () => console.log("manifests mock on 8799, today", today));
