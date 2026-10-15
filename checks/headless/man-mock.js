// 模拟后端：/manifests 页（后端 task/manifests-fields 契约 A–D，提交 04f3fa0）。
// 控制：POST /__ctl {fail401, role, fail, prefsFail, prefs:{bus,tickets}}；GET /__log。
// role: admin（默认，有金额组）| staff（没有金额组）| driver（403）。
const http = require("http");
// sections：Antelope（g:3）分两节；sendFail：发送接口回 "400" / "502"；sendOf：记下每次发送的请求体。
// minus15：后端 7c 减 15 上线后（有 guest_pickup_time，CHD1002 当成 Rezdy 时间读不出 ⇒ 空）。
// 这一天上次从 Rezdy 同步（{at, by} 或 null；/__ctl {rezdyLast} 设）。
let rezdyLast = null;
const ctl = { fail401: false, role: "admin", moneyAdminOnly: false, fail: false, prefsFail: false, cfm404: false, sections: false, sendFail: "", minus15: false };
const GUEST_PICKUP = { key: "guest_pickup_time", label: "Pickup time", group: "trip", type: "text" };
function minus15(t, orderNumber) {
  const m = /^(\d{1,2}):(\d{2}) ([AP]M)$/.exec(t || "");
  if (!m || orderNumber === "CHD1002") return "";
  let mins = ((+m[1] % 12) + (m[3] === "PM" ? 12 : 0)) * 60 + +m[2] - 15;
  mins = (mins + 1440) % 1440;
  const h = Math.floor(mins / 60);
  return `${h % 12 || 12}:${String(mins % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
// 发过的：row_key → ISO。CHD1002 的团确认 10/6 已发过（测「已发过、跳过」和 Send anyway）。
const sentTour = new Map();
const sentTickets = new Map();
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
  { key: "sent_tour_at", label: "Tour confirmation sent", group: "ours", type: "datetime" },
  { key: "sent_tickets_at", label: "Ticket reminder sent", group: "ours", type: "datetime" },
  { key: "sent_tour_by", label: "Tour confirmation by", group: "ours", type: "text" },
  { key: "sent_tickets_by", label: "Ticket reminder by", group: "ours", type: "text" },
];
const MONEY = [
  { key: "order_total", label: "Order total", group: "money", type: "money" },
  { key: "currency", label: "Currency", group: "money", type: "text" },
];
const BUS_QUESTION = { key: "q:0123456789", label: "Dietary needs?", group: "questions", type: "text" };
const PAX_QUESTION = { key: "pq:abcdef0123", label: "Passport name (per guest)", group: "questions", type: "text" };

const DEFAULTS = {
  // 同后端：默认列里有 Tour confirmation sent（勾选发送时判断「已发过」也靠它）。
  bus: ["order_number", "guest_name", "pax", "pickup_time", "pickup_location", "rezdy_cfm", "staff_cfm", "sent_tour_at"],
  tickets: ["order_number", "guest_name", "pax", "start_time", "staff_cfm", "sent_tickets_at"],
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
// bulk：Grand Canyon West（g:7）多 12 单，测超过 10 位时分批发。
const BULK = Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return { tab: "bus", pill: "g:7", order_number: `CHD15${n}`, product_code: "GCW01", lane_source: "rezdy_bookings",
    v: { guest_name: `ZZ Bulk ${n}`, phone: `+155500015${n}`, pax: 1, product: "Grand Canyon West", pickup_time: "6:00 AM", pickup_location: "MGM Grand" } };
});
const allRows = () => (ctl.bulk ? [...ROWS, ...BULK] : ROWS);
let sendCalls = 0;
const PILL_LABEL = {
  "g:3": "Antelope Bus Tour",
  "g:7": "Grand Canyon West",
  "g:none": "No group yet",
  "t:antelope": "Antelope Canyon",
  "t:none": "No tour type yet",
};
const rowKey = (r, date) => `${r.order_number}|${r.product_code}|${date}`;
const SECTION_OF = { CHD1001: "tour:UPPER ANTELOPE", CHD1002: "outbound:SHUTTLE: LAS VEGAS → PAGE" };
const byKey = (key) => allRows().find((r) => rowKey(r, today) === key);

/** 发送接口共用：400 / 502、row_key 不在名单里整批 400。failOnCall：第 N 次发送请求回 502（测分批中途出错）。 */
function sendGate(keys) {
  sendCalls += 1;
  if (ctl.failOnCall && sendCalls === ctl.failOnCall) return [502, { detail: "Bad gateway" }];
  if (ctl.sendFail === "400") return [400, { detail: "These guests are no longer on this day: CHD9999. Reload the page. Nothing was sent." }];
  if (ctl.sendFail === "502") return [502, { detail: "Bad gateway" }];
  const missing = keys.filter((k) => !byKey(k));
  if (missing.length) return [400, { detail: `Not on this day: ${missing.join(", ")}` }];
  return null;
}

/** 已发过的跳过，除非 send_anyway 里有它（preview_at 有就行，mock 不比时间）。 */
function sendRows(keys, sentMap, body) {
  const anyway = new Set(body.send_anyway ?? []);
  const results = [];
  const skipped = [];
  for (const k of keys) {
    const r = byKey(k);
    const name = r.v.guest_name;
    // 同后端：勾了 Send anyway 的单，只有最近一次发送不晚于 preview_at 才再发（看名单之后又有人发过 ⇒ 照样跳过）。
    const again = anyway.has(r.order_number) && body.preview_at && Date.parse(sentMap.get(k)) <= Date.parse(body.preview_at);
    if (sentMap.has(k) && !again) {
      skipped.push({ order_number: r.order_number, chd_number: r.order_number, name, reason: "already_sent", message: "Already sent Oct 6, 4:12 PM" });
      continue;
    }
    sentMap.set(k, "2026-10-07T18:30:00+00:00");
    results.push(r);
  }
  return { results, skipped };
}

function counts(rows) {
  return { rows: rows.length, orders: new Set(rows.map((r) => r.order_number)).size, pax: rows.reduce((s, r) => s + (r.v.pax || 0), 0) };
}

function page(url) {
  const date = url.searchParams.get("date") || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [400, { detail: "Bad date" }];
  const tab = url.searchParams.get("tab") || "bus";
  if (tab !== "bus" && tab !== "tickets") return [400, { detail: "Bad tab" }];
  const isAdmin = ctl.role === "admin";
  // 后端 639b41b（2026-10-11）起 Money 组所有 staff 都能看；moneyAdminOnly 模拟旧行为，用来测「存着但没权限」的提示。
  const moneyOpen = isAdmin || !ctl.moneyAdminOnly;
  const dayRows = date === today ? allRows() : [];
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
  const catalog = [...BASE_CATALOG, ...(ctl.minus15 ? [GUEST_PICKUP] : []), ...questions, ...(moneyOpen ? MONEY : [])];
  const known = new Set(catalog.map((f) => f.key));
  const moneyKeys = new Set(MONEY.map((f) => f.key));
  const asked_fields = url.searchParams.get("fields");
  const requested = asked_fields ? asked_fields.split(",").filter(Boolean) : DEFAULTS[tab];
  const fields = requested.filter((k) => known.has(k));
  const denied = requested.filter((k) => !known.has(k) && moneyKeys.has(k));
  const unknown = requested.filter((k) => !known.has(k) && !moneyKeys.has(k));
  const sectionsOn = ctl.sections && tab === "bus" && pill === "g:3";
  const rows = tabRows
    .filter((r) => r.pill === pill)
    .map((r) => {
      const key = rowKey(r, date);
      const c = cfm.get(key);
      const all = { ...r.v, order_number: r.order_number, staff_cfm: c?.confirmation_no ?? null, staff_cfm_by: c?.updated_by ?? null, staff_cfm_at: c?.updated_at ?? null,
        sent_tour_at: sentTour.get(key) ?? null, sent_tickets_at: sentTickets.get(key) ?? null,
        sent_tour_by: sentTour.has(key) ? "ZZ Test Staff" : null, sent_tickets_by: sentTickets.has(key) ? "ZZ Test Staff" : null,
        guest_pickup_time: minus15(r.v.pickup_time, r.order_number) };
      const values = {};
      for (const k of fields) values[k] = all[k] ?? null;
      return { row_key: key, order_number: r.order_number, product_code: r.product_code, tour_date: date, lane_source: r.lane_source,
        section: sectionsOn ? SECTION_OF[r.order_number] : null, values,
        // G36：returnLeg 开着时把 CHD1002 当成往返 shuttle 的回程那一行。
        leg: ctl.returnLeg && r.order_number === "CHD1002" ? "return" : null };
    });
  const tabs = ["bus", "tickets"].map((k) => ({ key: k, label: k === "bus" ? "Bus Tour" : "Tickets - SelfDrive", ...counts(dayRows.filter((r) => r.tab === k)) }));
  // 分节：只有 Antelope（g:3）、只在 sections 开着时；后端规则是行已经按节排好。
  const sections = sectionsOn
    ? [
        { key: "tour:UPPER ANTELOPE", title: "UPPER ANTELOPE", kind: "tour", rows: 1, orders: 1, pax: 2 },
        { key: "outbound:SHUTTLE: LAS VEGAS → PAGE", title: "SHUTTLE: LAS VEGAS → PAGE", kind: "outbound", rows: 1, orders: 1, pax: 4 },
      ]
    : [];
  return [200, { date, tab, is_admin: isAdmin, tabs, pills, pill, catalog, groups: GROUPS.filter((g) => moneyOpen || g.key !== "money"), default_fields: DEFAULTS[tab], fields, denied, unknown, sections, rows }];
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
      if ("rezdyLast" in body) {
        rezdyLast = body.rezdyLast;
        delete body.rezdyLast;
      }
      if (body.resetSent) {
        sentTour.clear();
        sentTickets.clear();
        sentTour.set(rowKey(ROWS[1], today), "2026-10-06T23:12:00+00:00");
        delete body.resetSent;
      }
      // 别人刚发过某一单（测「看名单之后又有人发」）：{ sentTourLater: "CHD1002" }。
      if (body.sentTourLater) {
        const r = ROWS.find((x) => x.order_number === body.sentTourLater);
        sentTour.set(rowKey(r, today), "2026-10-08T01:00:00+00:00");
        delete body.sentTourLater;
      }
      if (body.resetCalls) {
        sendCalls = 0;
        delete body.resetCalls;
      }
      if (body.seedCfm) {
        cfm.set(rowKey(ROWS[4], today), { confirmation_no: "AC-55120", updated_by: "zztest", updated_at: "2026-10-07T18:05:00+00:00" });
        delete body.seedCfm;
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
    if (p === "/api/notifications/tour-confirmation/tour-types") {
      const t = (key, label) => ({ key, label, abbr: key, has_lunch: true, has_beef: false, lunch_group: "", file_slug: key });
      return send(res, 200, [t("upper_antelope", "Upper Antelope Canyon Bus Tour"), t("grand_canyon_west", "Grand Canyon West Rim Bus Tour")]);
    }
    if (p === "/api/manifests/broadcast" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      const gate = sendGate(body.row_keys ?? []);
      if (gate) return send(res, ...gate);
      const orders = [...new Set(body.row_keys.map((k) => byKey(k).order_number))];
      const n = orders.length;
      return send(res, 200, { recipient_count: n, results: [{ module: "tour", broadcast_id: 301, recipient_count: n, sms_sent: n, sms_failed: 0, email_sent: n - 1, email_failed: 1 }] });
    }
    if (p === "/api/manifests/send-tour" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      const keys = (body.groups ?? []).flatMap((g) => g.row_keys);
      const gate = sendGate(keys);
      if (gate) return send(res, ...gate);
      const groups = body.groups.map((g) => {
        const { results, skipped } = sendRows(g.row_keys, sentTour, body);
        return { tour_type: g.tour_type, total: g.row_keys.length, sent: results.length,
          results: results.map((r) => ({ order: r.order_number, name: r.v.guest_name, email_status: "sent", sms_status: r.v.phone ? "sent:SM1" : "skipped - no phone" })),
          skipped };
      });
      return send(res, 200, { checked_at: "2026-10-07T18:29:00+00:00", sent: groups.reduce((n, g) => n + g.sent, 0), groups });
    }
    if (p === "/api/manifests/send-tickets" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      const gate = sendGate(body.row_keys ?? []);
      if (gate) return send(res, ...gate);
      const noCfm = body.row_keys.filter((k) => !cfm.get(k)?.confirmation_no);
      if (noCfm.length) return send(res, 400, { detail: `Add the Cfm # first: ${noCfm.map((k) => byKey(k).order_number).join(", ")}. Nothing was sent.` });
      const { results, skipped } = sendRows(body.row_keys, sentTickets, body);
      return send(res, 200, { checked_at: "2026-10-07T18:29:00+00:00", sent: results.length,
        results: results.map((r) => ({ record_id: 1, chd_number: r.order_number, name: r.v.guest_name, sms_ok: true, email_ok: { message_id: "m1" } })), skipped });
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
    // Sync Rezdy（后端 G70）：ctl.rezdy = "ok"（默认）| "fail"（502）| "busy"（409）；过去的日子 400。
    if (p === "/api/manifests/rezdy-sync" && req.method === "GET") {
      return send(res, 200, { last_synced: rezdyLast });
    }
    if (p === "/api/manifests/rezdy-sync" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      if (!body?.date) return send(res, 400, { detail: "date is required." });
      if (body.date < today) return send(res, 400, { detail: "Past days cannot be synced." });
      if (ctl.rezdy === "fail") return send(res, 502, { ok: false, last_synced: rezdyLast, error: "Could not reach Rezdy. Nothing was changed. Wait a minute and try again." });
      if (ctl.rezdy === "busy") return send(res, 409, { ok: false, busy: true, last_synced: rezdyLast, error: "Someone is already syncing this day. Wait a few seconds and look again." });
      rezdyLast = { at: new Date().toISOString(), by: "zztest" };
      return send(res, 200, { ok: true, last_synced: rezdyLast, checked: 3, new: ["CHD1001"], cancelled: ["CHD9999"], changed: ["CHD1002"], failed: [] });
    }
    send(res, 404, { detail: "mock: not found" });
  })
  .listen(8799, () => console.log("manifests mock on 8799, today", today));
