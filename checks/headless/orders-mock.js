// 模拟后端：Orders。控制：POST /__ctl {fail401, failExport}；GET /__log。
const http = require("http");
const ctl = { fail401: false, failExport: false };
const log = [];
const row = (i, o = {}) => ({ order_number: `CHDZZ${i}`, lane: "legacy", name: `ZZ Guest ${i}`, email: `g${i}@x`, phone: i % 2 ? "—" : `+1555${i}`, product_name: "Upper Antelope Bus Tour With Lunch And More", product_type: i % 3 === 0 ? "ticket" : "bus_tour", tour_date: "10/05/2026", pickup_time: "7:00 AM", pickup_location: "Aria", quantities: "2", agent_name: "Viator", source: "rezdy", created_at: "10/1/2026 9:00 AM", updated_at: "10/2/2026 9:00 AM", status: ["confirmed", "pending", "cancelled", "WEIRD"][i % 4], ...o });
const all = Array.from({ length: 70 }, (_, i) => row(i + 1));
const detail = {
  CHDTESTORDER1: {
    order_number: "CHDTESTORDER1", status: "confirmed", source: "excel", booking_type: "bus_tour", editable: true,
    guest: { name: "ZZ Test Guest", email: "zz@x", phone: "+1555", pax: 2 },
    product: { code: "UAC01", name: "Upper Antelope", type: "upper_antelope", tour_date: "10/05/2026", tour_time: "", pickup_time: "7:00 AM", pickup_location: "Aria", item_count: 2 },
    ops: { driver: "Bob", vehicle_no: "B1", driver_phone: "", agent_name: "Viator", confirmation_no: "C-1", tt_number: "", lunch_turkey: 1, lunch_veggie: 1, lunch_beef: 0 },
    price: { total_amount: 199.5, currency: "USD", total_paid: 199.5, total_due: 0, overridden: true },
    items_detail: [{ productName: "Upper Antelope", quantities: [{ optionLabel: "Adult", optionPrice: 99.75, value: 2 }], participants: [{ fields: [{ label: "Ticket Barcode", value: "ABCDEF123456" }, { label: "Name", value: "ZZ" }] }] }],
    order_detail: { resellerName: "Viator", commission: 20, paymentOption: "CC", resellerReference: "V-1", sourceChannel: "API", resellerComments: "<b>hi</b>" },
    special_requirements: "", notes: "", created_at: "10/1/2026", updated_at: "10/2/2026",
    activity_log: [{ id: 1, event_type: "field_updated", detail: "confirmation_no: 'C-0' → 'C-1'", actor: "annie", actor_type: "staff", created_at: "10/2/2026 9:00 AM" }],
    booking_notes: [],
  },
};
detail.CHDNEW = { ...detail.CHDTESTORDER1, order_number: "CHDNEW", editable: false, price: { ...detail.CHDTESTORDER1.price, overridden: false } };

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
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, await readBody(req)); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, query: url.search };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  const q = url.searchParams;
  if (p === "/api/operations/orders") {
    let rows = all;
    if (q.get("q")) rows = rows.filter((r) => r.order_number.includes(q.get("q")) || r.name.toLowerCase().includes(q.get("q").toLowerCase()));
    if (q.get("date_to") === "2000-01-01") rows = [];
    const page = Number(q.get("page") || 1);
    return send(res, 200, { total: rows.length, page, pages: Math.ceil(rows.length / 50), records: rows.slice((page - 1) * 50, page * 50) });
  }
  if (p === "/api/operations/orders/export") {
    if (ctl.failExport) return send(res, 500, { detail: "Internal Server Error" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="orders_2026-10-03.xlsx"');
    return res.end("XLSX");
  }
  let m = p.match(/^\/api\/operations\/orders\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const d = detail[id];
    if (req.method === "GET") return d ? send(res, 200, d) : send(res, 404, { detail: "Order not found" });
    const body = await readBody(req);
    entry.body = body;
    if (!d.editable) return send(res, 409, { detail: "This order is stored in the new Rezdy table, which is read-only for now." });
    if (typeof body.lunch_turkey === "number" && body.lunch_turkey < 0) return send(res, 422, { detail: [{ loc: ["body", "lunch_turkey"], msg: "Input should be greater than or equal to 0" }] });
    if ("confirmation_no" in body) d.ops.confirmation_no = body.confirmation_no ?? "";
    for (const k of ["lunch_turkey", "lunch_veggie", "lunch_beef"]) if (k in body) d.ops[k] = body[k];
    let priced = false;
    for (const k of ["total_amount", "total_paid", "total_due", "currency"]) if (k in body) { d.price[k] = body[k]; priced = true; }
    if (priced) d.price.overridden = true;
    return send(res, 200, { updated: Object.keys(body).length, fields: Object.keys(body), price_overridden: priced });
  }
  m = p.match(/^\/api\/operations\/orders\/([^/]+)\/unlock-price$/);
  if (m) { detail[decodeURIComponent(m[1])].price.overridden = false; return send(res, 200, { unlocked: true }); }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("orders mock on 8799"));
