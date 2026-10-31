// 周三确认下周排班（员工这一边）检查用的模拟接口。G138 改版（Annie 2026-10-30「动手」）：形状照 4e 2026-10-30 晚的
// 「G138 后端最终接口」（lib/schedule-confirm-api.ts）：整周所有人的班、deadline、my_requests / requests_for_me。
// ctl：unavail = 当没有这个功能（404）；fail401 = 没登录；past = 过了周四 12 点；published = 已发布；
//      peerAsk = Nadia 找我换班；reset = 回到还没回应的样子。
const http = require("http");

const ctl = { unavail: false, fail401: false, past: false, published: false, peerAsk: false };
const log = [];
const WEEK = "2026-11-01";
let nextReqId = 1;
let response = null;
let myRequests = [];
let peerAnswered = false;

const ME = 1;
const EMPLOYEES = [
  { employee_id: 1, name: "Jing" },
  { employee_id: 2, name: "Lizzie" },
  { employee_id: 3, name: "Nadia" },
  { employee_id: 4, name: "Veronica" },
];
const TIMES = { open: ["02:00", "12:00"], mid: ["10:00", "18:00"], close: ["11:30", "21:30"] };
// [员工, 周几(0=Sun), 班次]；员工 null = 空班
const PLAN = [
  [1, 0, "open"], [1, 2, "mid"], [1, 4, "close"], [1, 6, "close"],
  [2, 0, "mid"], [2, 1, "open"], [2, 3, "open"], [2, 4, "open"],
  [3, 0, "close"], [3, 1, "mid"], [3, 2, "close"], [3, 3, "close"], [3, 5, "mid"], [3, 6, "open"],
  [4, 1, "close"], [4, 2, "open"], [4, 3, "mid"], [4, 4, "mid"], [4, 5, "open"],
  [null, 5, "close"],
];

function day(i) {
  const [y, m, d] = WEEK.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
}
const SLOTS = PLAN.map(([emp, i, k], n) => ({
  id: 100 + n, date: day(i), shift_type: k, start_time: TIMES[k][0], end_time: TIMES[k][1], employee_id: emp, note: null, mine: emp === ME,
}));
const rs = (s) => (s ? { id: s.id, date: s.date, shift_type: s.shift_type, start_time: s.start_time, end_time: s.end_time } : null);
const slot = (id) => SLOTS.find((s) => s.id === id);
const nameOf = (id) => EMPLOYEES.find((e) => e.employee_id === id)?.name;

function forMe() {
  if (!ctl.peerAsk || peerAnswered) return [];
  // Nadia 拿她 Wed Close 换我 Tue Mid
  return [{
    id: 900, kind: "swap", status: "awaiting_peer", from: { employee_id: 3, name: "Nadia" },
    my_slot: rs(slot(111)), their_slot: rs(slot(101)), peer: { employee_id: ME, name: "Jing" },
    date: null, shift_type: null, peer_timed_out: false, created_at: "2026-10-28T20:00:00Z", decided_at: null,
  }];
}

function data() {
  const closed = ctl.published ? "published" : ctl.past ? "past_deadline" : null;
  return {
    week_start: WEEK,
    week_status: ctl.published ? "published" : "draft",
    person: { employee_id: ME, name: "Jing" },
    deadline: "2026-10-29T12:00:00-07:00",
    open: !closed,
    closed_reason: closed,
    shift_types: [
      { key: "open", label: "Open", default_start_time: "02:00", default_end_time: "12:00" },
      { key: "mid", label: "Mid", default_start_time: "10:00", default_end_time: "18:00" },
      { key: "close", label: "Close", default_start_time: "11:30", default_end_time: "21:30" },
    ],
    employees: EMPLOYEES,
    slots: SLOTS,
    time_off: [{ employee_id: 4, date: day(6), kind: null }],
    my_response: response,
    my_requests: myRequests,
    requests_for_me: forMe(),
  };
}

function toRequest(b) {
  const base = { id: nextReqId++, from: { employee_id: ME, name: "Jing" }, my_slot: null, their_slot: null, peer: null, date: null, shift_type: null, peer_timed_out: false, created_at: "2026-10-28T21:00:00Z", decided_at: null };
  if (b.kind === "swap") {
    const t = slot(b.their_slot_id);
    return { ...base, kind: "swap", status: "awaiting_peer", my_slot: rs(slot(b.my_slot_id)), their_slot: rs(t), peer: { employee_id: t.employee_id, name: nameOf(t.employee_id) } };
  }
  if (b.kind === "move") return { ...base, kind: "move", status: "pending", my_slot: rs(slot(b.my_slot_id)), date: b.date };
  return { ...base, kind: "add", status: "pending", date: b.date, shift_type: b.shift_type };
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d ? JSON.parse(d) : null));
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      const b = (await readBody(req)) || {};
      if (b.reset) {
        response = null;
        myRequests = [];
        peerAnswered = false;
      }
      delete b.reset;
      Object.assign(ctl, b);
      return send(res, 200, ctl);
    }
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }
    const entry = { method: req.method, path: p, q: Object.fromEntries(url.searchParams) };
    log.push(entry);
    if (req.method === "POST") entry.body = await readBody(req);
    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
    if (p === "/api/me")
      return send(res, 200, { id: 9, username: "jing", display_name: "Jing", initials: "JI", role: "staff", is_admin: false, is_superadmin: false });
    const m = /^\/api\/schedule\/confirmation(?:\/link\/([^/]+))?(\/accept|\/changes|\/requests\/(\d+)\/answer)?$/.exec(p);
    if (m) {
      if (ctl.unavail) return send(res, 404, { detail: "Not Found" });
      if (m[1] === "expired") return send(res, 410, { detail: "This link has expired." });
      if (!m[2] && req.method === "GET") {
        // 后端 `week` 是必填 Query(...)，登录态和 token 态都一样，不带会 422。
        if (!url.searchParams.get("week")) return send(res, 422, { detail: [{ loc: ["query", "week"], msg: "field required" }] });
        return send(res, 200, data());
      }
      if (req.method === "POST" && !data().open && m[2] !== "/accept")
        return send(res, 409, { detail: "The deadline to reply was Thu, Oct 29 at 12:00 PM. Ask your supervisor for any changes." });
      if (m[2] === "/accept" && req.method === "POST") {
        response = { answer: "accepted", answered_at: "2026-10-28T16:20:00+00:00" };
        return send(res, 200, data());
      }
      if (m[2] === "/changes" && req.method === "POST") {
        response = { answer: "wants_changes", answered_at: "2026-10-28T16:25:00+00:00" };
        myRequests = [...myRequests, ...(entry.body?.requests ?? []).map(toRequest)];
        return send(res, 200, data());
      }
      if (m[3] && req.method === "POST") {
        if (Number(m[3]) !== 900) return send(res, 403, { detail: "This request isn't for you." });
        peerAnswered = true;
        return send(res, 200, data());
      }
    }
    return send(res, 404, { detail: "mock: not found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("sc mock on", process.env.MOCK_PORT || 8799));
