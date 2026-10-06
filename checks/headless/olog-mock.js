// 模拟后端：Order Log。130 条记录，分页。控制：POST /__ctl {fail401, fail500}；GET /__log。
const http = require("http");
const ctl = { fail401: false, fail500: false, overlap: false };
const log = [];
const types = [
  ["status_changed", "Status Changed", "#534AB7", "staff"],
  ["lunch_selected", "Lunch Updated", "#3B6D11", "guest"],
  ["field_updated", "field_updated", "#888", "staff"],
  ["action_taken", "Action Taken", "#A32D2D", "staff"],
];
const all = Array.from({ length: 130 }, (_, i) => {
  const [t, label, color, actor] = types[i % 4];
  return { id: i + 1, order_number: `CHDZZ${i + 1}`, tour_date: "10/4/2026", event_type: t, event_label: label, event_color: i === 5 ? "red;background:url(x)" : color, detail: i === 1 ? "<img src=x onerror=alert(1)>" : i === 3 ? "=1+2" : i === 7 ? "-5" : i === 9 ? "@SUM(A1)" : `detail ${i}`, actor: actor === "guest" ? "ZZ Guest" : "annie", actor_type: actor, modified_at: "10/3/2026 9:05 AM" };
});
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
  if (p === "/api/activities/order-log") {
    if (ctl.fail500) return send(res, 500, { detail: "Internal Server Error" });
    const q = url.searchParams;
    let rows = all;
    // overlap：450 条、每页和上一页重叠 5 条（模拟后端 created_at 相同、没有次序键时分页重复）。
    if (ctl.overlap) {
      const big = Array.from({ length: 450 }, (_, i) => ({ ...all[0], id: 1000 + i, order_number: `CHDBIG${i}`, detail: `big ${i}` }));
      const page = Number(q.get("page") || 1);
      const size = Number(q.get("page_size") || 50);
      const start = Math.max(0, (page - 1) * size - (page > 1 ? 5 : 0));
      return send(res, 200, { total: big.length, page, stats: {}, records: big.slice(start, start + size) });
    }
    if (q.get("event_type")) rows = rows.filter((r) => r.event_type === q.get("event_type"));
    if (q.get("actor_type")) rows = rows.filter((r) => r.actor_type === q.get("actor_type"));
    if (q.get("order_number")) rows = rows.filter((r) => r.order_number.toLowerCase().includes(q.get("order_number").toLowerCase()));
    const page = Number(q.get("page") || 1);
    const size = Number(q.get("page_size") || 50);
    const stats = {};
    rows.forEach((r) => (stats[r.event_type] = (stats[r.event_type] || 0) + 1));
    return send(res, 200, { total: rows.length, page, stats, records: rows.slice((page - 1) * size, page * size) });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("olog mock on 8799"));
