// 模拟后端：Dispatch 单子页只需要 /api/me。控制：POST /__ctl {fail401, role}。
const http = require("http");
const ctl = { fail401: false, forbid: false, admin: false };
const log = [];
function send(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function readBody(req) { return new Promise((r) => { let d = ""; req.setEncoding("utf8"); req.on("data", (c) => (d += c)); req.on("end", () => r(d ? JSON.parse(d) : null)); }); }
http.createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, await readBody(req)); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  log.push({ method: req.method, path: p });
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (ctl.forbid) return send(res, 403, { detail: "Staff access required" });
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.admin ? "admin" : "staff", is_admin: ctl.admin, is_superadmin: false });
  if (p === "/api/dispatch/manifest") return send(res, 500, { detail: "mock" });
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("sheet mock on 8799"));
