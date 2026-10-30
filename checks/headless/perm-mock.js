// 模拟后端：全部按照勾选（置顶 10c）。控制：POST /__ctl {role, switchOn, codes}；GET /__log。
// role：staff / admin / superadmin；switchOn = 员工权限总开关 staff_permissions 对我开着；codes = 我勾了的权限码。
// Farm out 两页另有「谁看得到」开关 farm_out_settings：这里放给所有人，只测勾选。
// 各页的列表接口一律回 500（检查只看「有没有去请求」：被挡住的页不请求，放行的页会请求）。
const http = require("http");
const ctl = { role: "staff", switchOn: false, codes: [] };
const log = [];
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((r) => {
    const c = [];
    req.on("data", (d) => c.push(d));
    req.on("end", () => r(c.length ? JSON.parse(Buffer.concat(c).toString("utf8")) : {}));
  });
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, await readBody(req)); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  log.push({ method: req.method, path: p });
  const superadmin = ctl.role === "superadmin";
  const admin = ctl.role === "admin" || superadmin;
  if (p === "/api/me")
    return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.role, is_admin: admin, is_superadmin: superadmin, is_supervisor: admin });
  if (p === "/api/settings/dashboard-widgets")
    return send(res, 200, { readable: true, widgets: [{ key: "staff_permissions", label: "Staff permissions (ops gating)", visibility: ctl.switchOn ? "staff" : "super_admin_only", default: "super_admin_only", visible_to_me: ctl.switchOn || superadmin }, { key: "farm_out_settings", label: "Farm out Partners & Timetable", visibility: "staff", default: "super_admin_only", visible_to_me: true }] });
  if (p === "/api/me/permissions")
    return send(res, 200, { is_superadmin: superadmin, permissions: ctl.codes.map((code) => ({ code, module: code.split(".")[0], wired: true })), default_home: "/dashboard" });
  return send(res, 500, { detail: "mock: not served" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("perm mock on", process.env.MOCK_PORT || 8799));
