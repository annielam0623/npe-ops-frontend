// 模拟后端：Daily Operation Report（形状按后端设计稿 §3 / §11，2026-10-24；最终样例出来后核对字段名）。
// 控制：POST /__ctl {supervisor, superadmin, partner, tick: {switchOn, codes}, putFail, visible, widgets404, reports403, notifyOff, notifyError, reset}；GET /__log。
const http = require("http");

const ctl = { supervisor: true, superadmin: false, putFail: false, visible: true, widgets404: false, reports403: false, notifyOff: true, notifyError: false };
const log = [];

const PEOPLE = [
  { id: 7, username: "annie", display_name: "Annie" },
  { id: 8, username: "lizzie", display_name: "Lizzie" },
  { id: 9, username: "jing", display_name: "Jing" },
];
const person = (id) => PEOPLE.find((p) => p.id === id) || null;

function seed() {
  return [
    { id: 1, report_type: "accident", complaint_about: null, headline: "Bus 3", order_number: null, subject_name: null,
      what_happened: "ZZ Minor scrape in the hotel driveway.", status: "in_progress", follow_up: person(7),
      created_by: person(7), created_at: "2026-10-24T07:05:12-07:00", updated_at: "2026-10-24T07:20:40-07:00", resolved_at: null, resolved_by: null,
      details: { occurred_at: "2026-10-24T06:50:00-07:00", location: "Hotel driveway", vehicle_no: "Bus 3", driver_name: "Sample driver", injuries: "None", police_report: "no" } },
    { id: 2, report_type: "complaint", complaint_about: "driver", headline: "Sample driver", order_number: "CHDABC123", subject_name: "Sample driver",
      what_happened: "ZZ Guest says the bus left before the scheduled time.", status: "open", follow_up: null,
      created_by: person(8), created_at: "2026-10-24T08:12:00-07:00", updated_at: "2026-10-24T08:12:00-07:00", resolved_at: null, resolved_by: null, details: {} },
    { id: 3, report_type: "complaint", complaint_about: "itinerary", headline: "Antelope Canyon day tour", order_number: "CHDXYZ789", subject_name: "Antelope Canyon day tour",
      what_happened: "ZZ Guest asked for a refund: the Slot Canyon stop was too short.", status: "open", follow_up: person(8),
      created_by: person(8), created_at: "2026-10-24T09:40:00-07:00", updated_at: "2026-10-24T09:41:00-07:00", resolved_at: null, resolved_by: null, details: {} },
    { id: 4, report_type: "emergency", complaint_about: null, headline: "Two guests, Hoover Dam stop", order_number: null, subject_name: "Two guests, Hoover Dam stop",
      what_happened: "ZZ Guest felt faint at the stop, resolved after rest.", status: "resolved", follow_up: person(9),
      created_by: person(9), created_at: "2026-10-22T10:00:00-07:00", updated_at: "2026-10-22T11:00:00-07:00", resolved_at: "2026-10-22T11:00:00-07:00", resolved_by: "jing", details: {} },
  ];
}
let reports = seed();
let nextId = 5;
const tokens = new Map();

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function raw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
function counts(items) {
  const c = { complaint: 0, accident: 0, emergency: 0, total: items.length };
  items.forEach((r) => (c[r.report_type] += 1));
  return c;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") {
    const body = JSON.parse((await raw(req)) || "{}");
    if (body.reset) { reports = seed(); nextId = 5; tokens.clear(); log.length = 0; }
    Object.assign(ctl, body, { reset: undefined });
    return send(res, 200, ctl);
  }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, query: url.search };
  log.push(entry);

  if (ctl.tick && p === "/api/me/permissions")
    return send(res, 200, { is_superadmin: false, permissions: ctl.tick.codes.map((code) => ({ code, module: code.split(".")[0], wired: true })), default_home: "/dashboard" });
  if (p === "/api/me")
    return send(res, 200, { id: 8, username: "lizzie", display_name: "Lizzie", initials: "L", role: ctl.partner ? "partner" : ctl.supervisor ? "supervisor" : "staff", is_admin: ctl.superadmin, is_superadmin: ctl.superadmin, is_supervisor: ctl.supervisor });

  if (p === "/api/settings/dashboard-widgets") {
    if (ctl.widgets404) return send(res, 404, { detail: "Not Found" });
    if (req.method === "PUT") {
      const body = JSON.parse(await raw(req));
      entry.body = body;
      if (!ctl.superadmin) return send(res, 403, { detail: "Super Admin access required." });
      if (ctl.putFail) return send(res, 500, { detail: "mock save failed" });
      // 三档：存请求里的那一档（staff / admin / super_admin_only）。
      ctl.visible = body.widgets?.daily_operation_report ?? ctl.visible;
    }
    // 后端：Super Admin 永远 visible_to_me=true；其他人看开关。
    // ctl.visible：true = staff、false = super_admin_only，或者 PUT 存下的那一档。
    const dorVis = ctl.visible === true ? "staff" : ctl.visible === false ? "super_admin_only" : ctl.visible;
    return send(res, 200, { readable: true, widgets: [{ key: "daily_operation_report", label: "Daily Operation Report", visibility: dorVis, default: "super_admin_only", visible_to_me: dorVis === "staff" || ctl.superadmin },
      // 统计行（本批新板块，默认只 Super Admin）：这套检查要看里面的 Open reports，当作已放给员工。
      { key: "dashboard_stats", label: "Today at a glance", visibility: "staff", default: "super_admin_only", visible_to_me: true },
      // 全部按照勾选：ctl.tick = { switchOn, codes } 时回员工权限总开关。
      ...(ctl.tick ? [{ key: "staff_permissions", label: "Staff permissions (ops gating)", visibility: ctl.tick.switchOn ? "staff" : "super_admin_only", default: "super_admin_only", visible_to_me: !!ctl.tick.switchOn }] : [])] });
  }

  if (p.startsWith("/api/operation-reports")) {
    if (ctl.reports403) return send(res, 403, { detail: "This section is not available yet." });
    if (p === "/api/operation-reports/assignees") return send(res, 200, { users: PEOPLE });
    let m = p.match(/^\/api\/operation-reports\/(\d+)$/);
    if (m && req.method === "GET") {
      const r = reports.find((x) => x.id === Number(m[1]));
      if (!r) return send(res, 404, { detail: "That report does not exist." });
      return send(res, 200, { report: r, history: [{ at: r.created_at, by: "Annie", action: "create", changes: [] }, ...(r.status !== "open" ? [{ at: r.updated_at, by: "Annie", action: "update", changes: [{ field: "status", from: "open", to: r.status }] }] : [])] });
    }
    if (m && req.method === "PATCH") {
      const body = JSON.parse(await raw(req));
      entry.body = body;
      const r = reports.find((x) => x.id === Number(m[1]));
      if (!r) return send(res, 404, { detail: "That report does not exist." });
      if (body.status) { r.status = body.status; r.resolved_at = body.status === "resolved" ? "2026-10-24T12:00:00-07:00" : null; }
      if ("follow_up_user_id" in body) r.follow_up = person(body.follow_up_user_id);
      r.updated_at = "2026-10-24T12:00:00-07:00";
      return send(res, 200, { report: r });
    }
    if (p === "/api/operation-reports" && req.method === "GET") {
      const q = url.searchParams;
      const statuses = (q.get("status") || "open,in_progress").split(",");
      let items = reports.filter((r) => statuses.includes(r.status));
      if (q.get("type")) items = items.filter((r) => r.report_type === q.get("type"));
      if (q.get("q")) items = items.filter((r) => (r.what_happened + (r.order_number || "")).toLowerCase().includes(q.get("q").toLowerCase()));
      if (q.get("follow_up_user_id") === "none") items = items.filter((r) => !r.follow_up);
      items = [...items].sort((a, b) => b.id - a.id);
      return send(res, 200, { items, counts: counts(items), total: items.length, limit: 50, offset: 0 });
    }
    if (p === "/api/operation-reports" && req.method === "POST") {
      const body = JSON.parse(await raw(req));
      entry.body = body;
      if (!body.what_happened) return send(res, 400, { detail: "Please fill in: what_happened", missing: ["what_happened"] });
      const key = `${body.client_token}`;
      // 后端最终形状（5faa891e）：{report, duplicate, notification}；duplicate:true 时 notification 是 null；
      // 开关关着多 skipped:"switch_off"，通知出错 skipped:"error"。
      const notification = ctl.notifyError ? { in_app: 0, email: 0, used_fallback: false, skipped: "error" } : ctl.notifyOff ? { in_app: 0, email: 0, used_fallback: false, skipped: "switch_off" } : { in_app: 2, email: 3, used_fallback: true };
      if (tokens.has(key)) return send(res, 200, { report: tokens.get(key), notification: null, duplicate: true });
      const r = {
        id: nextId++, report_type: body.report_type, complaint_about: body.complaint_about,
        headline: body.subject_name || body.details?.vehicle_no || TYPE_NAME[body.report_type], order_number: body.order_number, subject_name: body.subject_name,
        what_happened: body.what_happened, status: "open", follow_up: person(body.follow_up_user_id), created_by: person(8),
        created_at: "2026-10-24T12:30:00-07:00", updated_at: "2026-10-24T12:30:00-07:00", resolved_at: null, resolved_by: null, details: body.details || {},
      };
      reports.push(r);
      tokens.set(key, r);
      return send(res, 201, { report: r, duplicate: false, notification });
    }
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("dor mock on", process.env.MOCK_PORT || 8799));

const TYPE_NAME = { complaint: "Complaint", accident: "Accident", emergency: "Emergency" };
