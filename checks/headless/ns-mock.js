// 模拟后端：Settings → Notifications（统一自动通知开关页；形状按后端设计稿 §11.4 和 7d 的草案，2026-10-24）。
// 控制：POST /__ctl {role: "superadmin"|"admin"|"staff", failPut, failScPut, extras, includeSc, autoSendOn, fail401, reset}；GET /__log。
const http = require("http");

const ctl = { role: "superadmin", failPut: "", failScPut: "", extras: false, includeSc: false, autoSendOn: false, fail401: false };
const log = [];

let switches;
let sc;
function fresh() {
  switches = [
    {
      key: "daily_task_reminders", label: "Daily task reminders", group: "Tasks", enabled: false, enabled_at: null, managed_elsewhere: false, wired: true,
      description: "Reminds staff about their daily tasks: 30 minutes before a task is due, and again if it is overdue and not done. While this is off, none of these are sent.",
      trigger: "A task is 30 minutes from its due time; a task is past due and not done.",
      recipients: "The person a task is assigned to. Every reminder also sends one email to reservations@.",
      sample: { subject: "Task due in 30 minutes", body: "Send last minute confirmations is due at 2:00 PM." },
    },
    {
      key: "operation_report_notify", label: "Incident notifications", group: "Daily Operation Report", enabled: false, enabled_at: null, managed_elsewhere: false, wired: true,
      description: "When someone logs an incident, tell the people in charge of that type. While this is off, nobody is notified.",
      trigger: "Right after an incident is saved.",
      recipients: "The people in charge of that type; if nobody is set up, supervisors and reservations@.",
      sample: { subject: "[NPE] Accident logged — Bus 3", body: "Accident logged by Annie at 7:05 AM." },
    },
  ];
  sc = { enabled: false, weekday: "wed", time: "09:00" };
}
fresh();

// can_edit：这两项 admin 就能改（周三确认走自己的接口，仅 Super Admin）。
function listFor(role) {
  const canEdit = role === "superadmin" || role === "admin";
  const out = switches.map((s) => ({ ...s, can_edit: canEdit }));
  if (ctl.includeSc) {
    out.push({ key: "schedule_confirm", label: "Weekly schedule confirmation", group: "Schedule", enabled: sc.enabled, managed_elsewhere: false, can_edit: role === "superadmin", wired: true,
      description: "SERVER TEXT: asks each employee to confirm next week’s schedule.", trigger: "SERVER TRIGGER", recipients: "SERVER RECIPIENTS", sample: "SERVER SAMPLE" });
  }
  if (ctl.extras) {
    // 登记了但还没接线的项；以及只带最少字段、sample 是纯字符串的未知项。
    out.push({ key: "future_thing", label: "Future thing", group: "Other", enabled: true, wired: false, can_edit: true, description: "Not wired yet.", trigger: "", recipients: "", sample: null });
    out.push({ key: "mystery", label: "Mystery notification", sample: "Plain string sample" });
  }
  return out;
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

  if (p === "/api/settings/notification-switches") {
    if (role === "staff") return send(res, 403, { detail: "Admin access required" });
    if (req.method === "PUT") {
      const body = JSON.parse(await raw(req));
      entry.body = body;
      if (ctl.failPut) return send(res, 500, { detail: ctl.failPut });
      const s = switches.find((x) => x.key === body.key);
      if (!s) return send(res, 400, { detail: `Unknown notification switch: ${body.key}` });
      s.enabled = body.enabled === true;
      s.enabled_at = s.enabled ? "2026-10-24T17:42:00-07:00" : null;
    }
    return send(res, 200, { switches: listFor(role) });
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

  if (p === "/api/settings/auto-send" && req.method === "GET") {
    if (role !== "superadmin") return send(res, 403, { detail: "Super Admin access required" });
    return send(res, 200, {
      readable: true,
      runs: [],
      config: {
        tour: { enabled: ctl.autoSendOn, times: ["18:00"], days_before: 1, alert_emails: [] },
        tickets: { enabled: false, times: ["18:00"], days_before: 1, summary_time: "18:00", summary_emails: [] },
      },
    });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("ns mock on 8799"));
