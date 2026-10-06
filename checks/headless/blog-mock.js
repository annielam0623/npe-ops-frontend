// 模拟后端：Broadcasting Log。控制：POST /__ctl {fail401, failRecipients}；GET /__log。
const http = require("http");
const ctl = { fail401: false, failRecipients: false };
const log = [];
const rows = [
  { id: 2, sent_by: "annie", module: "tickets", group_filter: "pending", status_filter: "all", tour_date: "2026-10-04", product_label: "U-TC, L-KT", template_name: null, message_body: "Hi {first_name}, wind on {tour_date}. " + "x".repeat(80) + ', "quoted"', recipient_count: 3, sms_sent: 2, sms_failed: 1, email_sent: 3, email_failed: 0, created_at: "2026-10-03 07:00" },
  { id: 1, sent_by: "max", module: "tour", group_filter: "mtlv", status_filter: "all", tour_date: "2026-10-02", product_label: null, template_name: "Weather delay", message_body: "Storm", recipient_count: 1, sms_sent: 1, sms_failed: 0, email_sent: 0, email_failed: 1, created_at: "2026-10-01 09:30" },
];
const recipients = {
  2: [
    { order_number: "CHDZZ1", customer_name: "ZZ Test A", phone: "+1555", email: "a@x", sms_status: "sent", email_status: "delivered" },
    { order_number: "CHDZZ2", customer_name: null, phone: null, email: "b@x", sms_status: "skipped", email_status: "bounce" },
    { order_number: "CHDZZ3", customer_name: "ZZ Test C", phone: "+1556", email: null, sms_status: "failed", email_status: null },
  ],
};
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") {
    let d = "";
    req.on("data", (c) => (d += c));
    await new Promise((r) => req.on("end", r));
    Object.assign(ctl, JSON.parse(d || "{}"));
    return send(res, 200, ctl);
  }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  log.push({ method: req.method, path: p, query: url.search });
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/broadcasting-log") {
    const q = url.searchParams;
    return send(res, 200, { rows: rows.filter((r) => (!q.get("module") || r.module === q.get("module")) && (!q.get("group") || r.group_filter === q.get("group"))) });
  }
  const m = p.match(/^\/api\/broadcasting-log\/(\d+)\/recipients$/);
  if (m) {
    if (ctl.failRecipients) return send(res, 403, { detail: "Password change required" });
    return send(res, 200, { recipients: recipients[m[1]] || [] });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("blog mock on 8799"));
