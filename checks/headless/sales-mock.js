// 模拟后端：Sales Report。控制：POST /__ctl {fail401, failWeekly}；GET /__log。
const http = require("http");
const ctl = { fail401: false, failWeekly: false };
const log = [];
const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
const row = (vals) => Object.fromEntries(vals.map((v, i) => [String(i + 1), v]));
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
  const q = url.searchParams;
  const k = q.get("metric") === "pax" ? 2 : 1;
  if (p === "/api/sales-report/monthly") {
    if (q.get("product_type") === "ticket") return send(res, 200, { agents: [], months: [...Array(12)].map((_, i) => i + 1), month_names: NAMES, data: {} });
    return send(res, 200, {
      agents: ["Viator", "<b>Direct</b>"],
      months: [...Array(12)].map((_, i) => i + 1),
      month_names: NAMES,
      data: { Viator: row([1200 * k, 0, 3, 0, 0, 0, 0, 0, 0, 5, 0, 0]), "<b>Direct</b>": row([1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0]) },
    });
  }
  if (p === "/api/sales-report/weekly") {
    if (ctl.failWeekly) return send(res, 422, { detail: "month is required" });
    return send(res, 200, { agents: ["Viator"], weeks: [1, 2, 3, 4], week_names: ["W1", "W2", "W3", "W4"], data: { Viator: row([1, 0, 2, 0]) }, month_name: "October", year: Number(q.get("year")) });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("sales mock on 8799"));
