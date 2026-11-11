// 模拟后端：G282 员工申请休假 + 按管理层级批复（Staff Schedule › Leave 标签、Team 页 Manager / Reporting lines）。
// 形状照后端 21 2026-11-11 发的定稿草案。自己只管 /api/schedule/leave-requests* 和 /api/schedule/leave-routing*，
// 其余请求原样转给现成的模拟：upstream "sch"（sch-mock，Staff Schedule 页）或 "tp"（tp-mock，Team 页）。
// 两个上游在 MOCK_PORT+11 / +12 上由本进程起、随本进程退出。
// 控制：POST /__ctl {reset, upstream: "sch"|"tp", viewer: "staff"|"approver"|"superadmin"|"admin", notOnSchedule,
//        sch: {...转给 sch-mock 的 __ctl}, tp: "querystring 转给 tp-mock 的 __control"}；GET /__log（只记 leave 的写请求）。
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const PORT = Number(process.env.MOCK_PORT) || 8799;
const SCH_PORT = PORT + 11;
const TP_PORT = PORT + 12;
const kids = [];
function start(file, port) {
  const p = spawn(process.execPath, [path.join(__dirname, file)], {
    env: { ...process.env, MOCK_PORT: String(port) },
    stdio: "ignore",
  });
  kids.push(p);
}
start("sch-mock.js", SCH_PORT);
start("tp-mock.js", TP_PORT);
const stopKids = () => kids.forEach((k) => { try { k.kill(); } catch {} });
process.on("exit", stopKids);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

const ctl = { upstream: "sch", viewer: "staff", notOnSchedule: false };
const log = [];
let requests, routing, nextId;

// 人：user_id。Annie（1，Super Admin）、Tessa（2，admin，暂代 5 人的 Manager）、CLIN（3，admin，Anita 的 Manager）、
// Nadia（10）、Jing（11）、Lizzie（12）、Anita（13）、Veronica（14）、Jessica（15）。
const NAMES = { 1: "Annie", 2: "Tessa", 3: "CLIN", 10: "Nadia", 11: "Jing", 12: "Lizzie", 13: "Anita", 14: "Veronica", 15: "Jessica" };
function fresh() {
  nextId = 100;
  requests = [
    // Nadia 自己的
    { id: 1, employee_id: 3, user_id: 10, employee_name: "Nadia", date_from: "2026-11-24", date_to: "2026-11-26", kind: "pto", note: "Trip home", status: "pending", created_at: "2026-11-11T00:12:00Z", decided_by: null, decided_by_name: null, decided_at: null, decision_note: null },
    { id: 2, employee_id: 3, user_id: 10, employee_name: "Nadia", date_from: "2026-11-03", date_to: "2026-11-03", kind: "personal", note: "Moving day", status: "rejected", created_at: "2026-10-27T16:00:00Z", decided_by: 2, decided_by_name: "Tessa", decided_at: "2026-10-28T16:40:00Z", decision_note: "Short-staffed that day. Please pick another day." },
    { id: 3, employee_id: 3, user_id: 10, employee_name: "Nadia", date_from: "2026-10-30", date_to: "2026-10-30", kind: "sick", note: null, status: "approved", created_at: "2026-10-30T14:00:00Z", decided_by: 2, decided_by_name: "Tessa", decided_at: "2026-10-30T15:05:00Z", decision_note: null },
    // 别人的（Tessa 待批）
    { id: 11, employee_id: 5, user_id: 12, employee_name: "Lizzie", date_from: "2026-11-12", date_to: "2026-11-12", kind: "sick", note: "Fever, sorry", status: "pending", created_at: "2026-11-11T15:02:00Z", decided_by: null, decided_by_name: null, decided_at: null, decision_note: null,
      shifts: [{ date: "2026-11-12", shift_type: "close", label: "Close", start_time: "14:00:00", end_time: "22:00:00" }] },
    { id: 12, employee_id: 4, user_id: 11, employee_name: "Jing", date_from: "2026-11-14", date_to: "2026-11-16", kind: "pto", note: "Family event out of town", status: "pending", created_at: "2026-11-11T02:30:00Z", decided_by: null, decided_by_name: null, decided_at: null, decision_note: null, shifts: [] },
    // 别人先批了（ctl 打开 race 时 approve 回 409）
    { id: 14, employee_id: 6, user_id: 14, employee_name: "Veronica", date_from: "2026-11-14", date_to: "2026-11-14", kind: "personal", note: "Doctor appointment", status: "approved", created_at: "2026-11-10T22:15:00Z", decided_by: 2, decided_by_name: "Tessa", decided_at: "2026-11-11T17:41:00Z", decision_note: null },
  ];
  routing = {
    people: [
      { user_id: 2, name: "Tessa", role: "admin", manager_user_id: null, team_ids: [1, 2, 3, 4, 5] },
      { user_id: 3, name: "CLIN", role: "admin", manager_user_id: null, team_ids: [1] },
      { user_id: 10, name: "Nadia", role: "staff", manager_user_id: 2, team_ids: [1, 2, 4, 5] },
      { user_id: 11, name: "Jing", role: "staff", manager_user_id: 2, team_ids: [1, 2, 3, 4] },
      { user_id: 12, name: "Lizzie", role: "staff", manager_user_id: 2, team_ids: [1, 2, 3, 5] },
      { user_id: 13, name: "Anita", role: "staff", manager_user_id: 3, team_ids: [1, 2, 3, 4] },
      { user_id: 14, name: "Veronica", role: "staff", manager_user_id: 2, team_ids: [1, 3] },
      { user_id: 15, name: "Jessica", role: "staff", manager_user_id: 2, team_ids: [1, 2, 4, 5] },
    ],
    teams: [
      { id: 1, name: "Operations", lead_user_id: null },
      { id: 2, name: "Tour Confirmation", lead_user_id: null },
      { id: 6, name: "Tour Guides", lead_user_id: 12 },
    ],
    candidates: [1, 2, 3, 10, 11, 12, 13, 14, 15].map((id) => ({ user_id: id, name: NAMES[id], role: id <= 3 ? "admin" : "staff" })),
  };
  ctl.race = false;
}
fresh();

const meUserId = () => (ctl.viewer === "staff" ? 10 : ctl.viewer === "superadmin" ? 1 : 2);
const daysOf = (r) => Math.round((Date.parse(r.date_to) - Date.parse(r.date_from)) / 864e5) + 1;
const pub = (r) => { const { shifts, user_id, ...rest } = r; return { ...rest, days: daysOf(r) }; };
function queueItem(r) {
  const route = ctl.viewer === "superadmin" ? "super_admin" : "manager";
  return { ...pub(r), user_id: r.user_id, team_names: [], route, approver_names: ["Tessa"], shifts: r.shifts || [], blocked: (r.shifts || []).length > 0, can_decide: true };
}
function visibleToApprover(r) {
  if (ctl.viewer === "superadmin") return true;
  if (ctl.viewer === "approver" || ctl.viewer === "admin") return r.user_id !== 2 && routing.people.find((p) => p.user_id === r.user_id)?.manager_user_id === 2;
  return false;
}
const isApprover = () => ctl.viewer !== "staff";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(body === undefined ? "" : JSON.stringify(body));
}
function raw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
function proxy(req, res, body) {
  const port = ctl.upstream === "tp" ? TP_PORT : SCH_PORT;
  const up = http.request({ host: "127.0.0.1", port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", () => send(res, 502, { detail: "upstream mock down" }));
  up.end(body);
}
const already = (r) => ({ detail: `This request was already ${r.status} by ${r.decided_by_name || "someone else"}.`, code: "already_decided", request: pub(r) });

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const buf = await raw(req);
  const json = () => { try { return JSON.parse(buf.toString("utf8") || "{}"); } catch { return {}; } };

  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") {
    const b = json();
    if (b.reset) { fresh(); log.length = 0; }
    for (const k of ["upstream", "viewer", "notOnSchedule", "race", "failDecide", "failLead", "hrDuty"]) if (k in b) ctl[k] = b[k];
    if (b.sch) await fetch(`http://127.0.0.1:${SCH_PORT}/__ctl`, { method: "POST", body: JSON.stringify(b.sch) });
    if (b.tp) await fetch(`http://127.0.0.1:${TP_PORT}/__control?${b.tp}`);
    return send(res, 200, { ok: true, ctl });
  }

  // ── leave-requests ──
  if (p === "/api/schedule/leave-requests/mine" && req.method === "GET") {
    const uid = meUserId();
    return send(res, 200, {
      employee: ctl.notOnSchedule ? null : { id: 3, name: NAMES[uid] },
      requests: requests.filter((r) => r.user_id === uid).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(pub),
    });
  }
  if (p === "/api/schedule/leave-requests" && req.method === "GET") {
    const status = url.searchParams.get("status") || "pending";
    const vis = requests.filter(visibleToApprover);
    const pend = vis.filter((r) => r.status === "pending");
    const list = status === "pending" ? pend : vis.filter((r) => r.status !== "pending");
    return send(res, 200, { is_approver: isApprover(), pending_count: isApprover() ? pend.length : 0, requests: isApprover() ? list.map(queueItem) : [] });
  }
  if (p === "/api/schedule/leave-requests" && req.method === "POST") {
    const b = json();
    log.push({ op: "create", body: b });
    if (ctl.notOnSchedule) return send(res, 400, { detail: "You are not on the staff schedule, so you can't request leave here." });
    if (!b.date_from || !b.date_to) return send(res, 400, { detail: "Pick the first and last day." });
    if (b.date_to < b.date_from) return send(res, 400, { detail: "The last day is before the first day." });
    if (b.note && b.note.length > 120) return send(res, 400, { detail: "Note can be up to 120 characters." });
    const r = { id: nextId++, employee_id: 3, user_id: meUserId(), employee_name: NAMES[meUserId()], date_from: b.date_from, date_to: b.date_to, kind: b.kind, note: b.note || null, status: "pending", created_at: new Date().toISOString(), decided_by: null, decided_by_name: null, decided_at: null, decision_note: null };
    requests.push(r);
    return send(res, 201, { request: pub(r) });
  }
  let m = /^\/api\/schedule\/leave-requests\/(\d+)\/(withdraw|approve|reject)$/.exec(p);
  if (m && req.method === "POST") {
    const id = Number(m[1]);
    const op = m[2];
    const b = json();
    log.push({ op, id, body: b });
    const r = requests.find((x) => x.id === id);
    if (!r) return send(res, 404, { detail: "Leave request not found." });
    if (op === "withdraw") {
      if (r.user_id !== meUserId()) return send(res, 404, { detail: "Leave request not found." });
      if (ctl.race && r.status === "pending") Object.assign(r, { status: "approved", decided_by: 2, decided_by_name: "Tessa", decided_at: new Date().toISOString() });
      if (r.status !== "pending") return send(res, 409, already(r));
      Object.assign(r, { status: "withdrawn", decided_at: new Date().toISOString() });
      return send(res, 200, { request: pub(r) });
    }
    if (!visibleToApprover(r)) return send(res, 404, { detail: "Leave request not found." });
    if (ctl.failDecide) return send(res, 400, { detail: ctl.failDecide });
    if (ctl.race && r.status === "pending") Object.assign(r, { status: "approved", decided_by: 1, decided_by_name: "Annie", decided_at: new Date().toISOString() });
    if (r.status !== "pending") return send(res, 409, already(r));
    const by = meUserId();
    Object.assign(r, { status: op === "approve" ? "approved" : "rejected", decided_by: by, decided_by_name: NAMES[by], decided_at: new Date().toISOString(), decision_note: op === "reject" ? b.note || null : null });
    return send(res, 200, { request: pub(r), time_off: [] });
  }

  // ── leave-routing ──
  if (p === "/api/schedule/leave-routing" && req.method === "GET") {
    if (ctl.viewer === "staff" || ctl.viewer === "approver") return send(res, 403, { detail: "Forbidden" });
    return send(res, 200, routing);
  }
  m = /^\/api\/schedule\/leave-routing\/(managers|team-leads)\/(\d+)$/.exec(p);
  if (m && req.method === "PUT") {
    const id = Number(m[2]);
    const b = json();
    log.push({ op: m[1], id, body: b });
    if (ctl.viewer !== "superadmin") return send(res, 403, { detail: "Only a Super Admin can change this." });
    if (m[1] === "managers") {
      const person = routing.people.find((x) => x.user_id === id);
      if (!person) return send(res, 404, { detail: "Member not found." });
      if (b.manager_user_id === id) return send(res, 400, { detail: "A person can't be their own manager." });
      person.manager_user_id = b.manager_user_id;
      return send(res, 200, { user_id: id, manager_user_id: b.manager_user_id });
    }
    const team = routing.teams.find((t) => t.id === id);
    if (!team) return send(res, 404, { detail: "Team not found." });
    if (ctl.failLead) return send(res, 400, { detail: "Pick an active staff or admin account." });
    team.lead_user_id = b.lead_user_id;
    return send(res, 200, { team_id: id, lead_user_id: b.lead_user_id });
  }

  // 截图用（ctl.hrDuty）：后端 21 在迁移里加职责 hr（Team 页职责那一栏多一个勾「HR」），grace（2）勾上。
  if (ctl.hrDuty && ctl.upstream === "tp" && req.method === "GET" && (p === "/api/team/catalog" || p === "/api/team/members/2")) {
    const r = await fetch(`http://127.0.0.1:${TP_PORT}${req.url}`, { headers: { cookie: req.headers.cookie || "" } });
    const body = await r.json();
    if (p === "/api/team/catalog") body.duties = [...(body.duties || []), { code: "hr", display_name: "HR", description: "Gets a notice and an email when someone's leave is approved." }];
    else body.duties = [...(body.duties || []), "hr"];
    return send(res, r.status, body);
  }

  return proxy(req, res, buf);
}).listen(PORT, () => console.log("leave mock up on " + PORT));
