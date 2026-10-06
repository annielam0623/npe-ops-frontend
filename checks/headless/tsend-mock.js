// 模拟后端：门票发送（防重发）。控制：POST /__ctl {scenario, serverSkip, fail502At, reject400, fail401, noPhone, applyDelay}；GET /__log。
const http = require("http");
const ctl = { scenario: "normal", serverSkip: ["T05"], fail502At: 0, reject400: "", fail401: false, batchFail: false, noPhone: [], applyDelay: 0 };
let nextBatch = 700;
const log = [];
let bulkCalls = 0;
function send(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function readRaw(req) { return new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c).toString("utf8"))); }); }
function row(n, extra = {}) {
  return { order_number: n, confirmation_no: "C" + n, name: "ZZ Test " + n, email: `${n}@x.test`, phone: "+15550000" + n.slice(-2),
    quantities: "Adult: 2", checkin_time: "9:00 AM", tour_time: "10:00 AM", duplicate: false,
    pax: 2, pax_ok: true, qty_label: "Adult: 2", upload_row: { "Order Number": n }, listed_twice: false, listed_twice_conflict: false, ...extra };
}
function rows() {
  if (ctl.scenario === "reupload") {
    return { rows: [
      row("R01", { upload_status: "added", changes: [] }),
      row("R02", { upload_status: "changed", duplicate: true, changes: [{ col: "Check-in Time", old: "8:30 AM", new: "9:00 AM" }] }),
      row("R03", { upload_status: "unchanged", changes: [] }),
    ], conflicts: [], compare: { reupload: true, removed: [{ order_number: "R09", name: "ZZ Gone", pax: 3, checkin_time: "8:00 AM", tour_time: "9:00 AM" }], counts: {} } };
  }
  if (ctl.scenario === "blocked") {
    return { rows: [row("B01", { pax: 0, pax_ok: false, qty_label: "", quantities: "" }), row("B02", { listed_twice_conflict: true }), row("B02", { listed_twice_conflict: true, phone: "+1999" }), row("", { name: "No Order Guest" })], conflicts: ["B02"] };
  }
  const r = [row("T01", { duplicate: true }), row("T02"), row("T02", { listed_twice: true })];
  for (let i = 3; i <= 12; i++) r.push(row("T" + String(i).padStart(2, "0")));
  // noPhone：这几单没手机号（结果页 No address 单独算）。
  return { rows: r.map((x) => (ctl.noPhone.includes(x.order_number) ? { ...x, phone: "" } : x)), conflicts: [] };
}
http.createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, JSON.parse(await readRaw(req))); bulkCalls = 0; return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/notifications/tickets-reminder/message-preview") return send(res, 200, { sms: "SMS", email: "<p>Email</p>", guest_page: "<p>Page</p>" });
  if (p === "/api/tickets-reminder/check-duplicates") {
    await readRaw(req);
    const { rows: r, conflicts, compare } = rows();
    return send(res, 200, { duplicates: r.filter((x) => x.duplicate).map((x) => x.order_number), total: r.length, rows: r,
      listed_twice_conflicts: conflicts, compare: compare ?? { reupload: false, removed: [], counts: {} }, preview_at: "2026-10-04T07:00:00.123456+00:00", warning: ctl.scenario === "blocked" ? "This CSV is not saved as UTF-8." : "",
      checkin_note: ctl.scenario === "blocked" ? "Check-in Time was worked out: Tour Time minus 50 minutes (set in Content Studio for Upper Antelope Canyon). Check the times below." : "" });
  }
  if (p === "/api/tickets-reminder/apply") {
    const body = JSON.parse(await readRaw(req));
    entry.body = body;
    if (ctl.applyDelay) await new Promise((r) => setTimeout(r, ctl.applyDelay));
    if (ctl.applyFail) return send(res, 400, { detail: "Guest count not found in Quantities: R01" });
    return send(res, 200, { updated: 1, added: 1 });
  }
  if (p === "/api/tickets-reminder/batches") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.batchFail) return send(res, 400, { detail: "send_type must be combined, sms or email." });
    return send(res, 200, { batch_id: ++nextBatch });
  }
  if (p === "/api/tickets-reminder/send-bulk") {
    const body = JSON.parse(await readRaw(req));
    entry.body = body;
    bulkCalls++;
    if (ctl.reject400 && bulkCalls === 1) return send(res, 400, { detail: ctl.reject400 });
    if (ctl.fail502At && bulkCalls === ctl.fail502At) return send(res, 502, { detail: "Bad gateway" });
    const results = [], skipped = [];
    for (const g of body.guests) {
      if (ctl.serverSkip.includes(g.chd_number)) { skipped.push({ chd_number: g.chd_number, name: `${g.first_name} ${g.last_name}`, reason: "already_sent", message: "Already sent for this date and tour" }); continue; }
      // 同后端：没号码 / 没邮箱的那条渠道不发，记 false。
      const smsOk = body.send_type !== "email" && !!g.phone;
      const emailOk = body.send_type !== "sms" && g.customer_email ? { message_id: "m" } : false;
      results.push({ record_id: 1, sms_ok: smsOk, email_ok: emailOk, name: `${g.first_name} ${g.last_name}`, chd_number: g.chd_number });
    }
    return send(res, 200, { sent: results.length, results, skipped });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("tsend mock on 8799"));
