// 模拟后端：Farm out Report（/api/farm-out/*）。控制：POST /__ctl {fail401, fail403, fail404, fail500, empty}；GET /__log。
const http = require("http");
// sa：当 Super Admin。frVis：「谁看得到」开关 farm_out_report 的档（2026-10-25）；默认当已放给所有人（其余检查照旧），null = 后端还没登记（404）。
const ctl = { fail401: false, fail403: false, fail404: false, fail500: false, empty: false, frVis: "staff" };
const log = [];
const partners = [
  { id: 1, name: "Partner A", slug: "partner_a", is_active: true },
  { id: 2, name: "Partner B", slug: "partner_b", is_active: true },
];
const rows = [
  { date: "2026-10-16", tour: "West Rim", order_number: "CHDVX81A", ota_conf_number: "GYG-7731042", guest: "Chen Wei", adults: 2, children: 1, partner: "Partner A", handled_by: "Annie", guest_paid: 447, payable: 305, difference: 142 },
  { date: "2026-10-16", tour: "West Rim", order_number: "CHDVX93K", ota_conf_number: "CHDVX93K", guest: "Maria Lopez", adults: 2, children: 0, partner: "Partner A", handled_by: "Annie", guest_paid: 298, payable: 200, difference: 98, payable_changed_by: "Annie", payable_changed_at: "2026-10-15T17:58:00" },
  { date: "2026-10-17", tour: "Zion", order_number: "CHDVXB11", ota_conf_number: "VTR-118230", guest: "Kim Jisoo", adults: 1, children: 0, partner: "Partner B", handled_by: "Max", guest_paid: 150, payable: null, difference: null },
];
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
    if (!ctl.frVis) return send(res, 404, { detail: "Not Found" });
    return send(res, 200, { readable: true, widgets: [{ key: "farm_out_report", label: "Farm out Report", visibility: ctl.frVis, default: "super_admin_only", visible_to_me: ctl.frVis === "staff" || !!ctl.sa }] });
  }
  if (ctl.fail403 && p === "/api/farm-out/report") return send(res, 403, { detail: "Forbidden" });
  if (ctl.fail404 && p.startsWith("/api/farm-out/")) return send(res, 404, { detail: "Not Found" });
  if (p === "/api/farm-out/partners") return send(res, 200, partners);
  if (p === "/api/farm-out/report") {
    if (ctl.fail500) return send(res, 500, { detail: "Internal Server Error" });
    const pid = url.searchParams.get("partner_id");
    let out = ctl.empty ? [] : rows;
    if (pid) out = out.filter((r) => r.partner === partners.find((x) => String(x.id) === pid)?.name);
    return send(res, 200, { rows: out });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("fr mock on 8799"));
