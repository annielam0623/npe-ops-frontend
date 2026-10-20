// 周三确认下周排班（员工这一边）检查用的模拟接口。后端 G138 已上线（`npe-confirmation-service` 4368567，
// 接口说明 docs/interfaces/schedule-wed-confirm-2026-10-20.md），形状照它对齐（lib/schedule-confirm-api.ts）。
// ctl：unavail = 当没有这个功能（404，兼容老环境）；fail401 = 没登录；reset = 回到还没回应的样子。
const http = require("http");

const ctl = { unavail: false, fail401: false };
const log = [];
const WEEK = "2026-10-25";
let nextReqId = 1;
let response = null; // {answer, answered_at, requests}

const NAMES = { 1: "Avery", 2: "Brooks", 3: "Chen", 4: "Diaz" };
// shift × day（周日起）：员工 id
const BASE = {
  open: [1, 2, 3, 4, 2, 3, 1],
  mid: [3, 4, 1, 2, 4, 2, 3],
  close: [4, 3, 2, 3, 1, 4, 2],
};
const TIMES = { open: ["02:00", "10:00"], mid: ["09:00", "17:00"], close: ["15:00", "23:00"] };

function dates() {
  const [y, m, d] = WEEK.split("-").map(Number);
  return Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
}
function data() {
  const days = dates();
  let id = 1;
  const slots = [];
  for (const k of Object.keys(BASE))
    BASE[k].forEach((emp, i) =>
      slots.push({ id: id++, date: days[i], shift_type: k, start_time: TIMES[k][0], end_time: TIMES[k][1], employee_id: emp, employee_name: NAMES[emp] }),
    );
  return {
    week_start: WEEK,
    person: { employee_id: 1, name: "Avery" },
    shift_types: [
      { key: "open", label: "Open" },
      { key: "mid", label: "Mid" },
      { key: "close", label: "Close" },
    ],
    slots,
    my_response: response,
    open: true,
  };
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
      if (b.reset) response = null;
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
      return send(res, 200, { id: 9, username: "avery", display_name: "Avery", initials: "AV", role: "staff", is_admin: false, is_superadmin: false });
    const m = /^\/api\/schedule\/confirmation(?:\/link\/([^/]+))?(\/accept|\/changes)?$/.exec(p);
    if (m) {
      if (ctl.unavail) return send(res, 404, { detail: "Not Found" });
      if (m[1] === "expired") return send(res, 410, { detail: "This link has expired." });
      if (!m[2] && req.method === "GET") {
        // 真实后端 `week` 是必填 Query(...)，登录态和 token 态都一样，不带会 422（同 schedule_link.py
        // 的注释：第一版漏了这个参数，点开邮件链接会直接看到 FastAPI 的 422 页面）。
        if (!url.searchParams.get("week")) return send(res, 422, { detail: [{ loc: ["query", "week"], msg: "field required" }] });
        return send(res, 200, data());
      }
      if (m[2] === "/accept" && req.method === "POST") {
        response = { answer: "accepted", answered_at: "2026-10-07T16:20:00+00:00", requests: [] };
        return send(res, 200, { ok: true });
      }
      if (m[2] === "/changes" && req.method === "POST") {
        response = {
          answer: "wants_changes",
          answered_at: "2026-10-07T16:25:00+00:00",
          requests: (entry.body?.additions ?? []).map((a) => ({ id: nextReqId++, date: a.date, shift_type: a.shift_type, status: "pending" })),
        };
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 404, { detail: "mock: not found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("sc mock on", process.env.MOCK_PORT || 8799));
