// 模拟后端：Settings → Notifications（统一自动通知开关页；形状按后端设计稿 §11.4 和 7d 的草案，2026-10-24）。
// 控制：POST /__ctl {role: "superadmin"|"admin"|"staff", failPut, failScPut, extras, serverText, autoSendOn, unreadable, fail401, reset}；GET /__log。
const http = require("http");

const ctl = { role: "superadmin", failPut: "", failScPut: "", extras: false, serverText: false, autoSendOn: false, unreadable: false, fail401: false };
// 截图用：环境变量 MOCK_CTL（JSON）在启动时预设控制项。
if (process.env.MOCK_CTL) Object.assign(ctl, JSON.parse(process.env.MOCK_CTL));
const log = [];

// 形状按后端 task/dor-backend-impl 5faa891e 的真实代码（2026-10-24，26 给的最终字段）：
// {readable, switches:[{key,label,description,group,enabled,managed_elsewhere,can_edit,wired}]}；
// enabled_at 只有 operation_report_notify / daily_task_reminders 有；没有 trigger / recipients / sample；
// auto_send_tour / auto_send_tickets 只在 superadmin 的 GET 里；PUT body {"switches": {key: bool}}，返回整份。
let state;
let widgetVis;
let sc;
function fresh() {
  state = { operation_report_notify: { on: false, at: null }, daily_task_reminders: { on: false, at: null } };
  // 「谁看得到」开关（2026-10-25）：开始时一个都没登记（同后端现状），PUT 过的才有。
  widgetVis = {};
  sc = { enabled: false, weekday: "wed", time: "09:00" };
}
fresh();

function listFor(role) {
  const sup = role === "superadmin";
  // Annie 2026-10-24：只有 Super Admin 能改任何通知开关（PUT 对 admin 也 403），admin 的 GET 里 can_edit 全是 false。
  const canEdit = sup;
  const out = [
    { key: "operation_report_notify", label: "Daily Operation Report: notify the people in charge", group: "Daily Operation Report", enabled: state.operation_report_notify.on, enabled_at: state.operation_report_notify.at, managed_elsewhere: false, can_edit: canEdit, wired: true,
      description: "When someone logs an incident, the people in charge are notified (in the system and by email). While this is off, incidents are still saved but nobody is notified." },
    { key: "daily_task_reminders", label: "Daily tasks: reminders and shift-end alerts", group: "Daily tasks", enabled: state.daily_task_reminders.on, enabled_at: state.daily_task_reminders.at, managed_elsewhere: false, can_edit: canEdit, wired: true,
      description: "Reminds people 30 minutes before a task is due and again when it is overdue, and tells the supervisors when a shift ends with tasks still open. While this is off, none of these are sent." },
    { key: "schedule_confirm", label: "Wednesday schedule confirmation", group: "Staff schedule", enabled: sc.enabled, managed_elsewhere: false, can_edit: sup, wired: true,
      description: "Sends staff next week's schedule to confirm every Wednesday. While this is off, nothing is sent." },
  ];
  if (sup) {
    out.push({ key: "auto_send_tour", label: "Tour confirmations (scheduled)", group: "Auto-send", enabled: ctl.autoSendOn, managed_elsewhere: true, can_edit: false, wired: true, manage_api: "/api/settings/auto-send", description: "Managed on the Auto Send page." });
    out.push({ key: "auto_send_tickets", label: "Ticket reminders (scheduled)", group: "Auto-send", enabled: false, managed_elsewhere: true, can_edit: false, wired: true, manage_api: "/api/settings/auto-send", description: "Managed on the Auto Send page." });
  }
  if (ctl.serverText) {
    const d = out.find((s) => s.key === "daily_task_reminders");
    d.trigger = "SERVER TRIGGER"; d.recipients = "SERVER RECIPIENTS"; d.sample = "SERVER SAMPLE";
  }
  if (ctl.extras) {
    // 登记了但还没接线的项；以及只带最少字段、sample 是纯字符串的未知项。
    out.push({ key: "future_thing", label: "Future thing", group: "Other", enabled: true, wired: false, can_edit: true, description: "Not wired yet." });
    out.push({ key: "mystery", label: "Mystery notification", sample: "Plain string sample" });
  }
  return { readable: !ctl.unreadable, switches: out };
}

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

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") {
    const body = JSON.parse((await raw(req)) || "{}");
    if (body.reset) { fresh(); log.length = 0; }
    delete body.reset;
    Object.assign(ctl, body);
    return send(res, 200, ctl);
  }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  const role = ctl.role;

  if (p === "/api/me")
    return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role, is_admin: role !== "staff", is_superadmin: role === "superadmin" });

  if (p === "/api/settings/dashboard-widgets") {
    if (req.method === "PUT") {
      const body = JSON.parse(await raw(req));
      entry.body = body;
      if (role !== "superadmin") return send(res, 403, { detail: "Super Admin access required." });
      Object.assign(widgetVis, body.widgets || {});
    }
    const widgets = Object.entries(widgetVis).map(([key, visibility]) => ({ key, label: key, visibility, default: visibility, visible_to_me: visibility === "staff" || role === "superadmin" || (visibility === "admin" && role === "admin") }));
    return send(res, 200, { readable: true, widgets });
  }

  if (p === "/api/settings/notification-switches") {
    if (req.method === "PUT" && role !== "superadmin") return send(res, 403, { detail: "Super Admin access required" });
    if (req.method === "PUT") {
      const body = JSON.parse(await raw(req));
      entry.body = body;
      if (ctl.failPut) return send(res, 500, { detail: ctl.failPut });
      const ch = body.switches;
      if (!ch || typeof ch !== "object") return send(res, 400, { detail: 'Send {"switches": {"<switch key>": true}}.' });
      const known = ["operation_report_notify", "daily_task_reminders", "schedule_confirm"];
      const unknown = Object.keys(ch).filter((k) => !known.includes(k));
      if (unknown.length) return send(res, 400, { detail: "Unknown notification switch: " + unknown.join(", ") });
      for (const [k, v] of Object.entries(ch)) if (typeof v !== "boolean") return send(res, 400, { detail: `Switch '${k}' must be true or false.` });
      if ("schedule_confirm" in ch && role !== "superadmin") return send(res, 403, { detail: "Only a Super Admin can change: schedule_confirm" });
      for (const [k, v] of Object.entries(ch)) {
        if (k === "schedule_confirm") sc.enabled = v;
        else { state[k].on = v; state[k].at = v ? "2026-10-24T17:42:00-07:00" : null; }
      }
    }
    return send(res, 200, listFor(role));
  }

  if (p === "/api/settings/schedule-confirm") {
    if (req.method === "PUT") {
      const body = JSON.parse(await raw(req));
      entry.body = body;
      if (role !== "superadmin") return send(res, 403, { detail: "Super Admin access required" });
      if (ctl.failScPut) return send(res, 400, { detail: ctl.failScPut });
      sc = { enabled: body.enabled === true, weekday: "wed", time: body.time };
    }
    return send(res, 200, sc);
  }

  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("ns mock on 8799"));
