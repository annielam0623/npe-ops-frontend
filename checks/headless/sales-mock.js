// 模拟后端：Sales Report。控制：POST /__ctl {fail401, failMetric, failAll, failAgents, zero}；GET /__log。
const http = require("http");
// sa：当 Super Admin（截图用）。salesVis：「谁看得到」开关 sales_report 的档（2026-10-26）；默认当已放给所有人（其余检查照旧），null = 后端还没登记（404）。
const ctl = { fail401: false, salesVis: "staff" };
const log = [];
ctl.failMetric = "";
ctl.failAll = false;
ctl.failAgents = false;
ctl.zero = false;
ctl.hidePending = true;

// ── 新版数据：2 个 Group + Private（单 section）+ No group yet ──
const round2 = (v) => Math.round(v * 100) / 100;
const P = (code, label, o, price, extra = {}) => ({ code, label, o, price, in_products: true, ...extra });
const GROUPS = [
  { id: 3, name: "Antelope Canyon", has_sections: true, sections: [
    { title: "LOWER", kind: "tour", products: [P("LAK001", "Lower Antelope Canyon – Ken's Tours", 10, 89)] },
    { title: "UPPER", kind: "tour", products: [P("ANT101", "Antelope", 4, 79), P("ANT102", "Antelope", 2, 79), P("SUN107", "Sunset Add-on", 1, 30, { pendingOnly: true })] },
    { title: "One-way Shuttle: Page to Las Vegas", kind: "outbound", products: [P("PSH008", "One-way Shuttle: Page to Las Vegas", 3, 59)] },
  ] },
  { id: 4, name: "West Rim", has_sections: true, sections: [
    { title: "SUNSET", kind: "tour", products: [P("WRS301", "Grand Canyon West Rim Sunset", 2, 188)] },
    { title: "SUNSET", kind: "outbound", products: [P("WRS302", "Sunset Shuttle: Las Vegas to West Rim", 1, 55)] },
  ] },
  { id: 5, name: "Private", has_sections: false, sections: [
    { title: "BUS TOUR", kind: "tour", products: [P("PRV401", "Private Tour – Group of M", 1, 1450)] },
  ] },
  { id: null, name: "No group yet", has_sections: false, sections: [
    { title: "BUS TOUR", kind: "tour", products: [P("ZZ9001", "Viator Gift Voucher (from the Rezdy order)", 1, 120, { in_products: false })] },
  ] },
];
const ALL_PRODUCTS = GROUPS.flatMap((g) => g.sections.flatMap((s) => s.products));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function periodsFor(q) {
  const g = q.get("granularity");
  const out = [];
  if (g === "week") {
    const y = Number(q.get("year")), m = Number(q.get("month")), L = dim(y, m);
    [[1, 7], [8, 14], [15, 21], [22, 28], [29, L]].forEach(([a, b], k) => { if (a <= L) out.push({ key: `${y}-${m}-W${k + 1}`, label: `W${k + 1}`, start: iso(y, m, a), end: iso(y, m, Math.min(b, L)) }); });
  } else if (g === "month") {
    const y = Number(q.get("year"));
    for (let m = 1; m <= 12; m++) out.push({ key: `${y}-${m}`, label: MON[m - 1], start: iso(y, m, 1), end: iso(y, m, dim(y, m)) });
  } else if (g === "quarter") {
    const y = Number(q.get("year"));
    for (let i = 0; i < 4; i++) out.push({ key: `${y}-Q${i + 1}`, label: `Q${i + 1}`, start: iso(y, i * 3 + 1, 1), end: iso(y, i * 3 + 3, dim(y, i * 3 + 3)) });
  } else if (g === "year") {
    const y = Number(q.get("year")), n = Number(q.get("years") || 3);
    for (let i = n - 1; i >= 0; i--) out.push({ key: String(y - i), label: String(y - i), start: iso(y - i, 1, 1), end: iso(y - i, 12, 31) });
  } else if (q.get("start_date")) {
    const s = q.get("start_date"), e = q.get("end_date"), b = q.get("bucket") || "none";
    if (s > e) throw new Error("The start date is after the end date.");
    if (b === "none") out.push({ key: "total", label: "Total", start: s, end: e });
    else if (b === "month") {
      let [y, m] = s.split("-").map(Number);
      const [ey, em] = e.split("-").map(Number);
      while (y < ey || (y === ey && m <= em)) { out.push({ key: `${y}-${m}`, label: `${MON[m - 1]} ${y}`, start: iso(y, m, 1), end: iso(y, m, dim(y, m)) }); m++; if (m > 12) { m = 1; y++; } }
    } else out.push({ key: "w1", label: "W1", start: s, end: e });
  } else throw new Error("Pick a period.");
  return out;
}
function productCells(prod, metric, periods) {
  const cells = {};
  periods.forEach((per, i) => {
    const orders = ctl.zero ? 0 : prod.o * (i + 1);
    const pax = orders * 2;
    cells[per.key] = metric === "orders" ? orders : metric === "pax" ? pax : orders ? round2(pax * prod.price + 0.13) : 0;
  });
  return cells;
}
const sumData = (list, periods) => Object.fromEntries(periods.map((per) => [per.key, round2(list.reduce((s, d) => s + (d[per.key] || 0), 0))]));
const sumVals = (d) => round2(Object.values(d).reduce((s, v) => s + v, 0));
// Orders 在各层是后端去重算好的数（比下层相加小）；pax / amount 才是相加。
const dedup = (d, k) => Object.fromEntries(Object.entries(d).map(([key, v]) => [key, Math.floor(v * k)]));
function breakdown(metric, periods, basis, unit) {
  const groups = [];
  const grandParts = [];
  for (const g of GROUPS) {
    const sections = [];
    for (const s of g.sections) {
      let prods = s.products.map((p) => ({ p, data: productCells(p, metric, periods) }));
      // $ 只算 confirmed：全是 pending 的产品（停用且 0）被 $ 接口隐藏。
      if (metric === "amount" && ctl.hidePending) prods = prods.filter((x) => !x.p.pendingOnly);
      if (!prods.length) continue;
      let sd = sumData(prods.map((x) => x.data), periods);
      if (metric === "orders" && prods.length > 1) sd = dedup(sd, 0.9);
      sections.push({ title: s.title, kind: s.kind, total: sumVals(sd), data: sd,
        products: prods.map((x) => ({ product_code: x.p.code, label: x.p.label, category_code: "bus_tour", in_products: x.p.in_products, total: sumVals(x.data), data: x.data })) });
    }
    if (!sections.length) continue;
    let gd = sumData(sections.map((s) => s.data), periods);
    if (metric === "orders" && sections.length > 1) gd = dedup(gd, 0.9);
    grandParts.push(gd);
    groups.push({ group_id: g.id, group_name: g.name, category_code: "bus_tour", total: sumVals(gd), data: gd, has_sections: g.has_sections, sections });
  }
  let grand = sumData(grandParts, periods);
  if (metric === "orders") grand = dedup(grand, 0.95);
  const cat = Object.fromEntries(Object.entries(grand).map(([k, v]) => [k, round2(v * 0.5)]));
  return { metric, unit, basis, currency: "USD", range: { start: periods[0].start, end: periods[periods.length - 1].end }, periods, groups,
    grand_total: { total: sumVals(grand), data: grand },
    by_category: [{ code: "bus_tour", label: "Bus Tour", total: sumVals(cat), data: cat }] };
}
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
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.sa ? "superadmin" : "staff", is_admin: !!ctl.sa, is_superadmin: !!ctl.sa });
  if (p === "/api/settings/dashboard-widgets") {
    if (!ctl.salesVis) return send(res, 404, { detail: "Not Found" });
    return send(res, 200, { readable: true, widgets: [{ key: "sales_report", label: "Sales Report", visibility: ctl.salesVis, default: "super_admin_only", visible_to_me: ctl.salesVis === "staff" || !!ctl.sa }] });
  }
  const q = url.searchParams;
  // ── 新版：按 Group → section → 产品（后端 G161）。一次一个指标；amount 是美元（小数）。──
  if (p === "/api/sales-report/amount/products" || p === "/api/sales-report/amount/product-agents") {
    const metric = q.get("metric") || "amount";
    if (ctl.failMetric === metric) return send(res, 500, { detail: `mock: ${metric} is down` });
    if (ctl.failAll) return send(res, 500, { detail: "mock: everything is down" });
    let periods;
    try { periods = periodsFor(q); } catch (e) { return send(res, 400, { detail: String(e.message) }); }
    const basis = metric === "amount" ? "Confirmed bookings only" : "Every booking that is not cancelled (includes pending)";
    const unit = metric === "amount" ? "USD" : metric;
    if (p.endsWith("/product-agents")) {
      const code = q.get("product_code");
      const prod = ALL_PRODUCTS.find((x) => x.code === code);
      if (!prod) return send(res, 400, { detail: "Unknown product." });
      if (ctl.failAgents) return send(res, 500, { detail: "mock: agents are down" });
      const cells = productCells(prod, metric, periods);
      const split = (share) => Object.fromEntries(periods.map((per) => [per.key, round2(cells[per.key] * share)]));
      const a1 = split(0.6);
      const a2 = Object.fromEntries(periods.map((per) => [per.key, round2(cells[per.key] - a1[per.key])]));
      const sum = (d) => round2(Object.values(d).reduce((s, v) => s + v, 0));
      return send(res, 200, { metric, unit, basis, periods, product_code: code, label: prod.label,
        agents: [{ agent: "Viator", total: sum(a1), data: a1 }, { agent: "Direct", total: sum(a2), data: a2 }],
        grand_total: { total: sum(cells), data: cells } });
    }
    log[log.length - 1].metric = metric;
    return send(res, 200, breakdown(metric, periods, basis, unit));
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("sales mock on", process.env.MOCK_PORT || 8799));
