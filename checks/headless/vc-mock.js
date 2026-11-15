// 模拟后端：Settings → Phone AI Calls（145，后端 G178 ③，f4 定稿 2026-11-15）。
// GET /api/voice/call-log?date&phone_last4&endpoint&limit；POST /api/voice/call-log/search {phone, date?, phone_last4?, endpoint?, limit?}。
// 控制：POST /__ctl {role: "superadmin" | "admin" | "staff", fail401, fail500, many（返回 1000 条）}；GET /__log（每个请求 {method, url, body}）。
const http = require("http");
const { permsBody } = require("./role-standard");

const ctl = { role: "superadmin", fail401: false, fail500: false, many: false };
const log = [];

const laDay = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};
const TODAY = laDay(0);
const TWO_AGO = laDay(-2);

let nextId = 100;
const call = (day, clock, o) => ({
  id: nextId++,
  called_at: `${day}T12:00:00Z`,
  called_at_la: `${day} ${clock}`,
  endpoint: "lookup",
  phone: null,
  phone_last4: null,
  status_code: 200,
  found_count: 0,
  action: null,
  request_order: null,
  duration_ms: 150,
  results: [],
  ...o,
});

// 全部虚构（号码 555-55xx）。最新在前。
const CALLS = [
  call(TODAY, "04:02:18 PM", { endpoint: "lookup-by-order", phone: "+15555550112", phone_last4: "0112", duration_ms: 140, request_order: "CHD7Q2PLM" }),
  call(TODAY, "03:47:05 PM", { endpoint: "message", phone: "+15555550128", phone_last4: "0128", found_count: 1, duration_ms: 310, action: "Note added to order", results: [{ order_number: "CHDK83TWA", tour_date: "2026-11-15", pickup_time: "6:45 AM", pickup_location: "Luxor" }] }),
  call(TODAY, "03:30:51 PM", { phone: "+15555550971", phone_last4: "0971", found_count: 1, duration_ms: 180, results: [{ order_number: "CHDRP2XDM", tour_date: "2026-11-17", pickup_time: "6:00 AM", pickup_location: "Bellagio Hotel" }] }),
  call(TODAY, "02:58:31 PM", { phone: "+447700900406", phone_last4: "0406", found_count: 2, duration_ms: 2350, results: [{ order_number: "CHDM2V7KQ", tour_date: "2026-11-15", pickup_time: "5:30 AM", pickup_location: "Excalibur" }, { order_number: "CHDM2V7KR", tour_date: "2026-11-16", pickup_time: "7:15 AM", pickup_location: "Excalibur" }] }),
  call(TODAY, "10:02:13 AM", { endpoint: "lookup-by-order", phone: null, phone_last4: null, status_code: 422, found_count: null, duration_ms: 12 }),
  call(TODAY, "09:31:57 AM", { endpoint: "complaint", phone: "+15555550176", phone_last4: "0176", found_count: 1, duration_ms: 12400, action: "Complaint logged", results: [{ order_number: "CHDX4E9NB", tour_date: "2026-11-13", pickup_time: "6:10 AM", pickup_location: "MGM Grand" }] }),
  call(TODAY, "08:40:26 AM", { phone: "+15555550199", phone_last4: "0199", status_code: 503, found_count: 0, duration_ms: 1240 }),
  call(TWO_AGO, "08:12:40 PM", { phone: "+15555550971", phone_last4: "0971", found_count: 1, duration_ms: 210, results: [{ order_number: "CHDRP2XDM", tour_date: "2026-11-17", pickup_time: "6:00 AM", pickup_location: "Bellagio Hotel" }] }),
  // v167 之前的旧行：没有完整号码、没有 duration_ms、results 没有 pickup 两个键。
  { id: nextId++, called_at: `${TWO_AGO}T15:14:02Z`, called_at_la: `${TWO_AGO} 07:14:02 AM`, endpoint: "lookup", phone: null, phone_last4: "3048", status_code: 200, found_count: 1, action: null, request_order: null, results: [{ order_number: "CHDV6N1RT", tour_date: TWO_AGO }] },
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
    req.on("end", () => {
      try {
        r(d ? JSON.parse(d) : null);
      } catch {
        r(null);
      }
    });
  });
}
const digits = (s) => String(s ?? "").replace(/\D/g, "");

function pick(list, { date, endpoint, limit }) {
  let out = list;
  if (date) out = out.filter((c) => c.called_at_la.startsWith(date));
  if (endpoint) out = out.filter((c) => c.endpoint === endpoint);
  return out.slice(0, limit || 200);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__ctl") {
      Object.assign(ctl, (await readBody(req)) || {});
      return send(res, 200, ctl);
    }
    if (p === "/__log") return send(res, 200, log);
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }
    const entry = { method: req.method, url: req.url, path: p };
    log.push(entry);
    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
    if (p === "/api/me/permissions") return send(res, 200, permsBody(ctl.role));
    if (p === "/api/me")
      return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.role, is_admin: ctl.role !== "staff", is_superadmin: ctl.role === "superadmin" });
    const isList = p === "/api/voice/call-log" && req.method === "GET";
    const isSearch = p === "/api/voice/call-log/search" && req.method === "POST";
    if (isList || isSearch) {
      const body = isSearch ? (await readBody(req)) || {} : null;
      if (body) entry.body = body;
      if (ctl.role !== "superadmin") return send(res, 403, { detail: "Super Admin access required" });
      if (ctl.fail500) return send(res, 500, { detail: "Internal Server Error" });
      const limit = Number((isSearch ? body.limit : url.searchParams.get("limit")) || 200);
      if (ctl.many) {
        const calls = Array.from({ length: limit }, (_, i) => call(TODAY, "09:00:00 AM", { id: 10000 + i, phone: "+15555550100", phone_last4: "0100" }));
        return send(res, 200, { count: calls.length, calls });
      }
      if (isSearch) {
        const q = digits(body.phone);
        if (body.phone !== undefined && q.length < 3) return send(res, 422, { detail: "Type at least 3 digits of the phone number." });
        const list = CALLS.filter((c) => !q || (c.phone && digits(c.phone).includes(q)));
        const calls = pick(list, { date: body.date, endpoint: body.endpoint, limit });
        return send(res, 200, { count: calls.length, calls });
      }
      const calls = pick(CALLS, { date: url.searchParams.get("date"), endpoint: url.searchParams.get("endpoint"), limit });
      return send(res, 200, { count: calls.length, calls });
    }
    send(res, 404, { detail: "mock: not found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("voice-calls mock on", process.env.MOCK_PORT || 8799, "today", TODAY));
