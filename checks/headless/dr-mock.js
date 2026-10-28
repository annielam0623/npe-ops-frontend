// 模拟后端：dashboard 改版阶段一（侧栏、My shortcuts、Messages 每窗两张、Settings → Navigation）。
// 控制：POST /__ctl {role, navConfig, failSave, failNavSave, shortcuts}；GET /__log 看请求。
const http = require("http");

const ctl = { role: "staff", navConfig: null, failSave: false, failNavSave: false, unhandled403: false };
let stored = null; // dashboard_shortcuts 的 value（字符串），null = 没存过
const log = [];
const H = 3600 * 1000;
const iso = (ago) => new Date(Date.now() - ago).toISOString();
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((r) => {
    let d = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (d += c));
    req.on("end", () => r(d ? JSON.parse(d) : null));
  });
}
function card(lane, i, body) {
  return {
    order_number: `${lane.toUpperCase()}${i}`, name: `ZZ Test ${lane} ${i}`, trip: "Yosemite", trip_fallback: "",
    channel: "sms", fallback_channel: "", direction: "sms_in", body, created_at: iso(i * H), pending_since: iso(i * H),
    is_modify: false, tour_date: today, track_url: `/admin/notifications/morning-pickup/tracking?date=${today}`,
  };
}
const LONG = "This guest wrote a much longer message so that this card is taller than the others in the window — ".repeat(3);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      const b = (await readBody(req)) || {};
      if ("shortcuts" in b) {
        stored = b.shortcuts;
        delete b.shortcuts;
      }
      Object.assign(ctl, b);
      return send(res, 200, { ...ctl, stored });
    }
    const body = req.method === "PUT" || req.method === "POST" ? await readBody(req) : null;
    log.push({ method: req.method, path: p, body });
    if (p === "/admin/dashboard") { res.setHeader("Content-Type", "text/html"); return res.end("<h1>LEGACY DASHBOARD</h1>"); }
    if (p === "/api/me") {
      return send(res, 200, {
        id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.role,
        is_admin: ctl.role !== "staff", is_superadmin: ctl.role === "superadmin",
      });
    }
    // Daily Operation Report 板块：对这个用户可见，没有未结记录（块本身的检查在 dor 套）。
    if (p === "/api/settings/dashboard-widgets") return send(res, 200, { readable: true, widgets: [{ key: "daily_operation_report", label: "Daily Operation Report", visibility: "staff", default: "super_admin_only", visible_to_me: true }, ...[["dashboard_stats", "Today at a glance"], ["dashboard_today_team", "Today's team"], ["dashboard_reply", "Reply pop-up in Messages"], ["farm_out_report", "Farm out Report"], ["sales_report", "Sales Report"], ["farm_out_settings", "Farm out settings"]].map(([key, label]) => ({ key, label, visibility: "staff", default: "super_admin_only", visible_to_me: true }))] });
    if (p === "/api/operation-reports") return send(res, 200, { items: [], counts: { complaint: 0, accident: 0, emergency: 0, total: 0 }, total: 0, limit: 50, offset: 0 });
    if (p === "/api/nav-config") return ctl.navConfig ? send(res, 200, ctl.navConfig) : send(res, 404, { detail: "Not Found" });
    if (p === "/api/admin/nav-config" && req.method === "PUT") {
      if (ctl.failNavSave) return send(res, 500, { detail: "mock nav save failed" });
      ctl.navConfig = body;
      return send(res, 200, body);
    }
    if (p === "/api/user-prefs/dashboard_shortcuts") {
      if (req.method === "PUT") {
        if (ctl.failSave) return send(res, 500, { detail: "mock save failed." });
        stored = body.value;
        return send(res, 200, { key: "dashboard_shortcuts", value: stored });
      }
      return send(res, 200, { key: "dashboard_shortcuts", value: stored });
    }
    if (p === "/api/notifications/unhandled") {
      // 没勾 messages.view（后端 d7 53a1a39d）：403。
      if (ctl.unhandled403) return send(res, 403, { detail: "Missing permission: messages.view" });
      return send(res, 200, {
        today,
        window_end: "10:30 AM",
        count: 6,
        lanes: {
          morning: [card("m", 1, LONG), card("m", 2, "short one"), card("m", 3, "third"), card("m", 4, "fourth")],
          tour: [card("t", 1, "only one")],
          tickets: [card("k", 1, "first"), card("k", 2, "second")],
          multi: [],
        },
      });
    }
    send(res, 404, { detail: "mock: not found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("dr mock on 8799"));
