// G333 preview 用：8962 → 模拟后端 8961；Bus Manifest 回包里把 CHD2 改成「不带餐却写了三明治」（同后端 82f9fec8 的字段）。
const http = require("http");
const NOTE = "Booked without lunch, but Special requirements ask for 2 T. Check the order.";
function walk(o) {
  if (Array.isArray(o)) return o.forEach(walk);
  if (!o || typeof o !== "object") return;
  if (o.order_number === "CHD2" && "notes" in o) Object.assign(o, { notes: "2 turkey sandwiches, no onion", notes_check: true, lunch_note: NOTE, lunch_slots: null, lunch_mismatch: true, ticket: "2 Adult (No Lunch)", ticket_hl: false });
  if (o.order_number === "CHD2" && "lunch_text" in o && "bus_label" in o && !("notes" in o)) o.reason = NOTE;
  Object.values(o).forEach(walk);
}
http.createServer((req, res) => {
  const up = http.request({ host: "127.0.0.1", port: 8961, path: req.url, method: req.method, headers: req.headers }, (r) => {
    if (!(req.method === "GET" && req.url.startsWith("/api/dispatch/manifest"))) { res.writeHead(r.statusCode, r.headers); r.pipe(res); return; }
    let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => {
      let out = b; try { const d = JSON.parse(b); walk(d); out = JSON.stringify(d); } catch {}
      const h = { ...r.headers }; delete h["content-length"]; delete h["transfer-encoding"];
      res.writeHead(r.statusCode, { ...h, "content-length": Buffer.byteLength(out) }); res.end(out);
    });
  });
  req.pipe(up);
}).listen(8962, () => console.log("proxy up"));
