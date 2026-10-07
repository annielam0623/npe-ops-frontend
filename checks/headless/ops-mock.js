// 模拟后端：Ops Summary。控制：POST /__ctl {fail401, failTickets, pwdChange}；GET /__log。
const http = require("http");
const ctl = { fail401: false, failTickets: false, pwdChange: false };
const log = [];
const z = { total: 0, success: 0, failed: 0 };
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
  log.push({ path: p, query: url.search });
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  // 还在用初始密码：和真实后端一样，任何接口都回 403「Password change required」，不是 401（后端 G32 第 4 条）。
  if (ctl.pwdChange) return send(res, 403, { detail: "Password change required" });
  if (p === "/api/ops-summary/send-stats")
    return send(res, 200, {
      tour_confirmation: { email: { total: 1200, success: 1100, failed: 50 }, sms: { total: 300, success: 297, failed: 3 }, both: z },
      morning_pickup: { email: z, sms: z, both: z },
      tickets_reminder: { email: z, sms: z, both: { total: 10, success: 5, failed: 5 } },
    });
  if (p === "/api/ops-summary/response-stats")
    return send(res, 200, { total: 100, yes: 70, modify: 5, pending: 25, avg_hours_yes: 3.5, avg_hours_modify: null, pct_yes: 70, pct_modify: 5, pct_pending: 25 });
  if (p === "/api/ops-summary/tickets-response-stats") {
    if (ctl.failTickets) return send(res, 500, { detail: "Internal Server Error" });
    return send(res, 200, { total: 40, yes: 30, pending: 10, pct_yes: 75, pct_pending: 25 });
  }
  if (p === "/api/ops-summary/morning-response-stats")
    return send(res, 200, { total: 20, checked_in: 15, not_yet: 5, pct_checked_in: 75, pct_not_yet: 25 });
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("ops mock on 8799"));
