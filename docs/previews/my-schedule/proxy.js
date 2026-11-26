// My schedule preview 用：/api/schedule/leave-requests* → leave-mock，其余 → sc-mock；ctl.hourly ⇒ 给 Jing（ME=1）周二加一条自己的 pto（模拟 G382 按小时假，confirmation 接口只回 kind）。
const http = require("http");
const SC = 8901, LV = 8911;
const ctl = { hourly: false };
http.createServer((req, res) => {
  if (req.url === "/__pctl") {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { Object.assign(ctl, JSON.parse(b || "{}")); res.end("{}"); });
    return;
  }
  const port = req.url.startsWith("/api/schedule/leave-requests") || req.url.startsWith("/__lctl") ? LV : SC;
  const path = req.url.replace("/__lctl", "/__ctl");
  const up = http.request({ host: "127.0.0.1", port, path, method: req.method, headers: req.headers }, (r) => {
    const intercept = ctl.hourly && req.method === "GET" && path.startsWith("/api/schedule/confirmation?");
    if (!intercept) { res.writeHead(r.statusCode, r.headers); r.pipe(res); return; }
    let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => {
      const d = JSON.parse(b);
      const tue = d.slots.find((s) => s.employee_id === 1 && s.date === addDays(d.week_start, 2)) || d.slots.find((s) => s.employee_id === 1);
      if (tue) d.time_off.push({ employee_id: 1, date: tue.date, kind: "pto" });
      const out = JSON.stringify(d);
      res.writeHead(r.statusCode, { "content-type": "application/json", "content-length": Buffer.byteLength(out) });
      res.end(out);
    });
  });
  req.pipe(up);
}).listen(8931, () => console.log("proxy up"));
function addDays(ymd, n) { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
