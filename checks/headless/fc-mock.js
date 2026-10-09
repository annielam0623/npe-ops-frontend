// 模拟后端：30 Days Forecast。控制：POST /__ctl {fail401, forbid, pwdChange}；GET /__log。
const http = require("http");
const ctl = { fail401: false, forbid: false, pwdChange: false, error: false };
const log = [];
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
// 30 天固定数据：含一个明显的峰值（第 10 天，index 10，500 人）和一个 0 人的天（index 3），
// 用来检查统计卡、峰值标签、表格 0 的显示都对。总和 = 2976，平均 = round(2976/30) = 99。
const PAX = [
  120, 80, 95, 0, 150, 200, 180, 90, 60, 70, 500, 110, 95, 88, 77, 66, 120,
  130, 140, 150, 90, 80, 70, 60, 50, 40, 30, 20, 10, 5,
];
function days() {
  const start = Date.UTC(2026, 0, 1); // 2026-01-01（第 0 天，页面上显示成 Today）
  return PAX.map((pax, i) => ({
    date: new Date(start + i * 86400000).toISOString().slice(0, 10),
    pax,
  }));
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
  if (p === "/auth/login") {
    res.setHeader("Content-Type", "text/html");
    return res.end("LOGIN");
  }
  log.push({ path: p, query: url.search });
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  // 还在用初始密码：和真实后端一样，任何接口都回 403「Password change required」，不是 401（后端 G32 第 4 条）。
  if (ctl.pwdChange)
    return send(res, 403, { detail: "Password change required" });
  // driver / guide：require_staff 拒绝，但不是密码问题。
  if (ctl.forbid) return send(res, 403, { detail: "Staff access required" });
  if (p === "/api/forecast/30-day") {
    if (ctl.error) return send(res, 500, { detail: "Internal Server Error" });
    return send(res, 200, days());
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("forecast mock on 8799"));
