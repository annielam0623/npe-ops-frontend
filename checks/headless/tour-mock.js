// 模拟后端：Tour Confirmation 发送页。控制：POST /__ctl；GET /__log。
const http = require("http");
const ctl = { scenario: "normal", serverSkip: [], fail502At: 0, reject400: "", applyFail: false, batchFail: false, fail401: false, typesFail: false, applyDelay: 0, batchHtml: false, bulkHtmlAt: 0, bulkDelay: 0 };
const log = [];
function send(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function readRaw(req) { return new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c).toString("utf8"))); }); }
const TYPES = [
  { key: "upper_antelope", label: "Upper Antelope Canyon Bus Tour", abbr: "AC-U", has_lunch: true, has_beef: true, lunch_group: "Antelope", file_slug: "antelope-upper" },
  { key: "grand_canyon_west", label: "Grand Canyon West Rim Bus Tour", abbr: "West", has_lunch: false, has_beef: false, lunch_group: "", file_slug: "west" },
  { key: "hoover_dam", label: "Hoover Dam Tour", abbr: "HD", has_lunch: false, has_beef: false, lunch_group: "", file_slug: "hoover-highlights" },
];
const row = (o) => ({ order_number: "", first_name: "ZZ", last_name: "Test", name: "ZZ Test", email: "zz@example.test", phone: "+15550000000",
  quantities: "Adult: 2", pax: 2, pax_ok: true, qty_label: "Adult: 2", pickup_time: "6:30 AM", pickup_location: "MGM", mtlv_promo: "",
  duplicate: false, sent_label: "", listed_twice: false, listed_twice_conflict: false, upload_row: null, ...o });
function rows(scenario) {
  if (scenario === "normal") {
    const out = [];
    for (let i = 1; i <= 12; i++) {
      const n = `N${String(i).padStart(2, "0")}`;
      out.push(row({ order_number: n, first_name: `ZZ${i}`, name: `ZZ${i} Test`, upload_row: { "Order Number": n } }));
    }
    out[0] = { ...out[0], duplicate: true, sent_label: "Sent by annie on 10/4 2:13 PM" };
    out[2] = { ...out[2], email: "", mtlv_promo: "ELIGIBLE" };
    out[3] = { ...out[3], phone: "", mtlv_promo: "2" };
    out.splice(2, 0, { ...out[1], listed_twice: true });
    return { rows: out, listed_twice_conflicts: [] };
  }
  if (scenario === "xlsx") {
    return { rows: [{ ...row({ order_number: "X01", quantities: 3 }), pax: undefined, pax_ok: undefined, qty_label: undefined }].map((r) => { delete r.pax; delete r.pax_ok; delete r.qty_label; return r; }), listed_twice_conflicts: [] };
  }
  if (scenario === "reupload") {
    return {
      rows: [
        row({ order_number: "R01", name: "ZZ Added", upload_status: "added", changes: [] }),
        row({ order_number: "R02", name: "ZZ Changed", upload_status: "changed", duplicate: true, sent_label: "Sent by annie on 10/4 2:13 PM", changes: [{ col: "Pick-up Time", old: "6:30 AM", new: "7:00 AM" }] }),
        row({ order_number: "R03", name: "ZZ Same", upload_status: "unchanged", changes: [] }),
      ],
      listed_twice_conflicts: [],
      compare: { reupload: true, removed: [{ order_number: "R09", name: "ZZ Gone", pax: 2, pickup_time: "6:30 AM", pickup_location: "Excalibur" }], counts: {} },
    };
  }
  if (scenario === "blocked") {
    return {
      rows: [
        row({ order_number: "B01", pax: 0, pax_ok: false, quantities: "" }),
        row({ order_number: "B02", listed_twice_conflict: true }),
        row({ order_number: "B02", listed_twice: true, listed_twice_conflict: true }),
        row({ order_number: "", name: "No Order Guest" }),
      ],
      listed_twice_conflicts: ["B02"],
      warning: "This CSV is not saved as UTF-8. Check the names below.",
    };
  }
  return { rows: [], listed_twice_conflicts: [] };
}
let bulkCalls = 0;
let nextBatch = 500;
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, JSON.parse(await readRaw(req))); bulkCalls = 0; return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, q };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/me") return send(res, 200, { id: 1, username: "annie", display_name: "Annie", initials: "AZ", role: "admin", is_admin: true, is_superadmin: false });
  if (p === "/api/notifications/tour-confirmation/tour-types") return ctl.typesFail ? send(res, 500, { detail: "boom" }) : send(res, 200, TYPES);
  if (p === "/api/notifications/tour-confirmation/message-preview") return send(res, 200, { sms: `SMS for ${q.tour_type} ${q.tour_date}`, email: "<p>email</p>", guest_page: "<p>page</p>" });
  if (p === "/api/notifications/tour-confirmation/preview") {
    const raw = await readRaw(req);
    const field = (n) => (raw.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)`)) || [])[1];
    entry.form = { tour_type: field("tour_type"), tour_date: field("tour_date"), lane: field("lane") ?? null, file: (raw.match(/filename="([^"]*)"/) || [])[1] };
    if (ctl.scenario === "parseError") return send(res, 400, { detail: "Missing required columns: Pick-up Location" });
    const r = rows(ctl.scenario);
    return send(res, 200, { total: r.rows.length, duplicates: r.rows.filter((x) => x.duplicate).length, rows: r.rows,
      compare: r.compare ?? { reupload: false, removed: [], counts: {} }, warning: r.warning ?? "", listed_twice_conflicts: r.listed_twice_conflicts,
      preview_at: "2026-10-04T14:00:00.123456-07:00" });
  }
  if (p === "/send/tour-batches") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.batchFail) return send(res, 400, { detail: "send_type must be combined, sms or email." });
    if (ctl.batchHtml) { res.setHeader("Content-Type", "text/html"); return res.end("<html>cloudflare</html>"); }
    return send(res, 200, { batch_id: ++nextBatch });
  }
  if (p === "/send/tour-confirmation-bulk" || p === "/send/last-minute-confirmation-bulk") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    bulkCalls++;
    if (ctl.reject400 && bulkCalls === 1) return send(res, 400, { detail: ctl.reject400 });
    if (ctl.fail502At && bulkCalls === ctl.fail502At) return send(res, 502, { detail: "Bad gateway" });
    if (ctl.bulkHtmlAt && bulkCalls === ctl.bulkHtmlAt) { res.setHeader("Content-Type", "text/html"); return res.end("<html>ok</html>"); }
    if (ctl.bulkDelay) await new Promise((r) => setTimeout(r, ctl.bulkDelay));
    const results = [], skipped = [];
    for (const g of b.guests) {
      if (ctl.serverSkip.includes(g.order_number)) { skipped.push({ order: g.order_number, order_number: g.order_number, name: `${g.first_name} ${g.last_name}`, reason: "already_sent", message: "Already sent for this date and tour" }); continue; }
      const em = b.send_type === "sms" ? "" : g.customer_email ? "sent" : "skipped - no email";
      const sm = b.send_type === "email" ? "" : g.phone ? (g.order_number === "N05" ? "failed: Twilio 21211 invalid number" : "sent:SM123") : "skipped - no phone";
      results.push({ order: g.order_number, name: `${g.first_name} ${g.last_name}`, email_status: em, sms_status: sm });
    }
    return send(res, 200, { total: b.guests.length, sent: results.length, results, skipped });
  }
  if (p === "/send/tour-confirmation-apply") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.applyDelay) await new Promise((r) => setTimeout(r, ctl.applyDelay));
    if (ctl.applyFail) return send(res, 400, { detail: "Guest count not found in Quantities: R01" });
    return send(res, 200, { updated: 1, added: 1 });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("tour mock on 8799"));
