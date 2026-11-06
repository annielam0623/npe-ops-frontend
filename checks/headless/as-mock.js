// 模拟后端：Settings → Auto Send（后端 auto-send G76，接口说明 docs/interfaces/auto-send-2026-10-15.md）。
// 控制：POST /__ctl {fail401, staff, unreadable, failGet, failPut（400 的那句话）, slowPut（ms）, runs（"empty" | "default"）, config（整份换掉）, reset}；
// v3：true = 新后端（G258 / G259，0f task/auto-send-limits）：config 带新键，GET 另带 ticket_types / tour_templates，runs 带 last_minute / daily_report。
// GET /__log（每个请求 {method, path, body}）。
const http = require("http");
const { permsBody } = require("./role-standard");
const ctl = { fail401: false, staff: false, admin: false, unreadable: false, failPut: "", slowPut: 0, runs: "default", failGet: false, v3: false, r98: false };
// r98：置顶 98 的后端（tickets.daily_report.after_time、tour.daily_report {enabled, emails, after_time}）。
const log = [];

const DEFAULT_CONFIG = {
  tour: { enabled: false, times: ["09:00", "18:00"], days_before: 2, alert_emails: ["ops@example.com"] },
  tickets: { enabled: false, times: ["10:00"], days_before: 3, summary_time: "17:00", summary_emails: ["tickets@example.com"] },
};
// 新后端：GET 里照旧带着不再用的 summary_time / summary_emails / cfm_alert_emails（前端要不显示、也不发回去）。
const V3_CONFIG = {
  tour: { enabled: false, times: ["07:00", "18:00"], days_before: 3, alert_emails: ["ops@example.com"], last_minute_cutoff: "15:00", max_per_batch: 100, template_regular: "tour_confirmation", template_last_minute: "last_minute" },
  tickets: { enabled: false, times: ["09:00", "12:00", "17:00"], days_before: 5, summary_time: "09:00", summary_emails: ["old@example.com"], cfm_alert_emails: ["old@example.com"], max_per_batch: 150, lead_groups: [{ days_before: 3, ticket_types: ["lower"] }], daily_report: { enabled: false, emails: ["antelope@nationalparkexpress.com"] } },
};
const TICKET_TYPES = [
  { key: "lower", label: "Lower Antelope" },
  { key: "upper", label: "Upper Antelope" },
  { key: "horseshoe", label: "Horseshoe Bend" },
  { key: "canyon_x", label: "Canyon X" },
];
const TOUR_TEMPLATES = [
  { key: "tour_confirmation", label: "Tour confirmation" },
  { key: "last_minute", label: "Last Minute" },
];
const V3_RUNS = [
  { run_key: "last_minute|2026-11-06|23:59", kind: "last_minute", status: "done", stale: false, started_at: "2026-11-07T07:59:00Z", finished_at: "2026-11-07T07:59:04Z", summary: { dates: ["2026-11-07"], sent: 2, already_sent: 0, skipped: 0, alerted: 0, alert_failed: [] } },
  { run_key: "last_minute|2026-11-06|14:00", kind: "last_minute", status: "done", stale: false, started_at: "2026-11-06T22:00:00Z", finished_at: "2026-11-06T22:00:09Z", summary: { dates: ["2026-11-07"], sent: 4, already_sent: 1, skipped: 1, alerted: 1, alert_failed: [] } },
  { run_key: "last_minute|2026-11-06|13:00", kind: "last_minute", status: "done", stale: false, started_at: "2026-11-06T21:00:00Z", finished_at: "2026-11-06T21:00:03Z", summary: { dates: ["2026-11-07"], sent: 1, already_sent: 0, skipped: 0, alerted: 0, alert_failed: ["antelope@nationalparkexpress.com", "ops@example.com"] } },
  { run_key: "tickets:2026-11-05T17:00", kind: "tickets", status: "done", stale: false, started_at: "2026-11-06T01:00:00Z", finished_at: "2026-11-06T01:03:00Z", summary: { sent: 40, already_sent: 0, waiting: 2, deferred: 0, cap: null, daily_report: { status: "sent", listed: 3, email_failed: [] } } },
  { run_key: "tickets:2026-11-05T12:00", kind: "tickets", status: "done", stale: false, started_at: "2026-11-05T20:00:00Z", finished_at: "2026-11-05T20:03:00Z", summary: { sent: 150, already_sent: 0, waiting: 1, deferred: 12, cap: 150 } },
  { run_key: "tickets:2026-11-04T17:00", kind: "tickets", status: "done", stale: false, started_at: "2026-11-05T01:00:00Z", finished_at: "2026-11-05T01:01:00Z", summary: { sent: 9, already_sent: 0, waiting: 0, deferred: 0, cap: null, daily_report: { status: "sent", listed: 0, email_failed: [] } } },
  { run_key: "tickets:2026-11-03T17:00", kind: "tickets", status: "done", stale: false, started_at: "2026-11-04T01:00:00Z", finished_at: "2026-11-04T01:01:00Z", summary: { sent: 5, already_sent: 0, waiting: 0, deferred: 0, cap: null, daily_report: { status: "email_failed", listed: 2, email_failed: ["antelope@nationalparkexpress.com"] } } },
  { run_key: "tour:2026-11-02T18:00", kind: "tour", status: "done", stale: false, started_at: "2026-11-03T02:00:00Z", finished_at: "2026-11-03T02:01:00Z", summary: { sent: 50, already_sent: 0, skipped: 0, deferred: 0, cap: null, alerted: 0, alert_failed: [], daily_report: { status: "sent", listed: 2, email_failed: [] } } },
  { run_key: "tour:2026-11-03T07:00", kind: "tour", status: "done", stale: false, started_at: "2026-11-03T15:00:00Z", finished_at: "2026-11-03T15:02:00Z", summary: { sent: 100, already_sent: 0, skipped: 1, deferred: 7, cap: 100 } },
];
let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

// 最近的批次（新的在前）：每种状态 / 结果各一行。
const RUNS = [
  { run_key: "tour:2026-10-15T18:00", kind: "tour", status: "done", stale: false, started_at: "2026-10-16T01:00:00Z", finished_at: "2026-10-16T01:02:00Z", summary: { sent: 12, already_sent: 3, skipped: 2 } },
  { run_key: "tickets:2026-10-15T10:00", kind: "tickets", status: "done", stale: false, started_at: "2026-10-15T17:00:00Z", finished_at: "2026-10-15T17:01:00Z", summary: { sent: 4, already_sent: 0, waiting: 5 } },
  { run_key: "tickets_summary:2026-10-14:sent", kind: "tickets_summary", status: "done", stale: false, started_at: "2026-10-15T00:00:00Z", finished_at: "2026-10-15T00:00:05Z", summary: { date: "2026-10-15", status: "sent", total: 9, unsent: 3 } },
  { run_key: "tickets_summary:2026-10-13:email_failed", kind: "tickets_summary", status: "done", stale: false, started_at: "2026-10-14T00:00:00Z", finished_at: "2026-10-14T00:00:05Z", summary: { date: "2026-10-14", status: "email_failed" } },
  { run_key: "tickets_summary:2026-10-12:no_tickets", kind: "tickets_summary", status: "done", stale: false, started_at: "2026-10-13T00:00:00Z", finished_at: "2026-10-13T00:00:05Z", summary: { date: "2026-10-13", status: "no_tickets" } },
  { run_key: "tickets_summary:2026-10-11:already", kind: "tickets_summary", status: "done", stale: false, started_at: "2026-10-12T00:00:00Z", finished_at: "2026-10-12T00:00:05Z", summary: { date: "2026-10-12", status: "already_sent" } },
  { run_key: "tour:2026-10-11T09:00", kind: "tour", status: "failed", stale: false, started_at: "2026-10-11T16:00:00Z", finished_at: "2026-10-11T16:00:01Z", summary: { error: "Database is not reachable (mock)." } },
  { run_key: "tour:2026-10-10T18:00", kind: "tour", status: "off", stale: false, started_at: "2026-10-11T01:00:00Z", finished_at: "2026-10-11T01:00:00Z", summary: null },
  { run_key: "tickets:2026-10-10T10:00", kind: "tickets", status: "running", stale: false, started_at: "2026-10-10T17:00:00Z", finished_at: null, summary: null },
  { run_key: "tour:2026-10-09T09:00", kind: "tour", status: "running", stale: true, started_at: "2026-10-09T16:00:00Z", finished_at: null, summary: null },
];

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
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 同后端的检查（不合法 ⇒ 400 + 一句英文）。 */
function validate(c) {
  if (!c?.tour || !c.tickets || typeof c.tour.enabled !== "boolean" || typeof c.tickets.enabled !== "boolean") return "Send the whole settings.";
  const times = [...c.tour.times, ...c.tickets.times, ...(ctl.v3 ? [] : [c.tickets.summary_time])];
  for (const t of times) if (!HHMM.test(t)) return `${t} is not a time like 09:00.`;
  for (const d of [c.tour.days_before, c.tickets.days_before]) if (!Number.isInteger(d) || d < 1 || d > 14) return "Days before must be a whole number from 1 to 14.";
  if (ctl.v3) {
    const seen = new Set();
    for (const g of c.tickets.lead_groups || []) for (const k of g.ticket_types) {
      if (seen.has(k)) return `Start sending, by ticket type: a ticket type can be in one time only (${k}).`;
      seen.add(k);
    }
  }
  return "";
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") {
    const b = (await readBody(req)) || {};
    if (b.reset || b.v3 !== undefined) {
      config = JSON.parse(JSON.stringify(b.v3 ?? ctl.v3 ? V3_CONFIG : DEFAULT_CONFIG));
      if ((b.v3 ?? ctl.v3) && (b.r98 ?? ctl.r98)) {
        config.tickets.daily_report.after_time = "17:00";
        config.tour.daily_report = { enabled: false, emails: ["reservations@nationalparkexpress.com"], after_time: "18:00" };
      }
      delete b.reset;
    }
    if (b.config) {
      config = b.config;
      delete b.config;
    }
    Object.assign(ctl, b);
    return send(res, 200, { ctl, config });
  }
  if (p === "/auth/login") {
    res.setHeader("Content-Type", "text/html");
    return res.end("LOGIN");
  }
  const entry = { method: req.method, path: p };
  log.push(entry);
  // G203 第二批：共用读接口（后端 f76d5e9）。
  if (p === "/api/settings/auto-send/action-log") return send(res, 200, { next_cursor: null, entries: [{ id: "2-1", at: "2026-10-28T17:00:00+00:00", by: "Annie Z", action: "update", label: "ZZ Test item", what: "Name", from: "Old", to: "New" }, { id: "1-1", at: "2026-10-27T17:00:00+00:00", by: "Max", action: "create", label: "ZZ Test item", what: "Name", from: null, to: "Old" }] });
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  // 默认是 Super Admin：auto-send 只对 Super Admin 开放（Annie 2026-10-24），admin / staff 打接口都是 403。
  // 只看勾（2026-11-01）：按角色标准回（admin 标准里没有 settings.auto_send）。
  if (p === "/api/me/permissions") return send(res, 200, permsBody(ctl.staff ? "staff" : ctl.admin ? "admin" : "superadmin"));
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.staff ? "staff" : ctl.admin ? "admin" : "superadmin", is_admin: !ctl.staff, is_superadmin: !ctl.staff && !ctl.admin });
  if (p === "/api/settings/auto-send" && req.method === "GET") {
    if (ctl.staff || ctl.admin) return send(res, 403, { detail: "Super Admin access required" });
    if (ctl.failGet) return send(res, 500, { detail: "Internal Server Error" });
    // 读不出来：后端按关处理（两个开关都 false 的默认设置）。
    const cfg = ctl.unreadable
      ? { tour: { ...config.tour, enabled: false }, tickets: { ...config.tickets, enabled: false } }
      : config;
    if (ctl.v3) return send(res, 200, { config: cfg, readable: !ctl.unreadable, runs: ctl.runs === "empty" ? [] : V3_RUNS, ticket_types: TICKET_TYPES, tour_templates: TOUR_TEMPLATES });
    return send(res, 200, { config: cfg, readable: !ctl.unreadable, runs: ctl.runs === "empty" ? [] : RUNS });
  }
  if (p === "/api/settings/auto-send" && req.method === "PUT") {
    const b = await readBody(req);
    entry.body = b;
    if (ctl.slowPut) await new Promise((r) => setTimeout(r, ctl.slowPut));
    if (ctl.failPut) return send(res, 400, { detail: ctl.failPut });
    const bad = validate(b);
    if (bad) return send(res, 400, { detail: bad });
    const kept = ctl.v3 ? { tour: { ...config.tour, ...b.tour }, tickets: { ...config.tickets, ...b.tickets } } : b;
    config = JSON.parse(JSON.stringify(kept));
    // 同后端：after_time 不在这张卡的 times 里 ⇒ 落到最后一批（不报错）。
    for (const sec of ["tour", "tickets"]) {
      const dr = config[sec].daily_report;
      if (dr && dr.after_time !== undefined && !config[sec].times.includes(dr.after_time)) dr.after_time = [...config[sec].times].sort().at(-1);
    }
    ctl.unreadable = false;
    return send(res, 200, config);
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("auto-send mock on", process.env.MOCK_PORT || 8799));
