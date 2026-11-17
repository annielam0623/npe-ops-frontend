// 模拟后端：Settings → Human Resource › Payroll（138 / G309，合同 v2 + Extras 选人 v3）。控制：POST /__ctl；GET /__log。
// 只连 localhost，绝不连真实后端。
// 期间：页面第一次按「洛杉矶今天」请求；这里把今天当成 2026-11-05（固定数据，不随真实日期变）。
const http = require("http");
const { STANDARD, permsBody } = require("./role-standard");

const ctl = {
  superadmin: true,
  /** 不是 Super Admin 时，在 Admin 标准权限上加的勾（例如 ["settings.payroll.view"]）。 */
  codes: [],
  /** PUT /api/payroll/runs/{id} 对这一趟回 400（后端原句）。 */
  runFail: null,
  periodFail: false,
};
const log = [];

function laToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const s = Buffer.concat(chunks).toString("utf8");
      resolve(s ? JSON.parse(s) : null);
    });
  });
}
const m2 = (n) => Number(n).toFixed(2);

const locks = [{ id: 1, from: "2026-11-01", to: "2026-11-02", note: "Paid Nov 1–2", created_by: "Annie" }];
const ANT = { code: "ant_relay", name: "ANT relay", amount: "66.00" };
const LONG = { code: "long_day", name: "Long day", amount: "40.00" };

/** 一趟（合同 v2 形状）。fee / total / status 由 finish() 算。 */
function mk(o) {
  return {
    date: "2026-11-03", assignment_id: null, shift: "bus_tour", manifest_id: 3, tour: "Antelope Canyon",
    guide_hr_id: null, guide_name: null, guide_in_hr: true, driver_hr_id: null, driver_name: null, role: "guide",
    rate_id: null, rate_fee: null, fee_override: null, extras_allowed: [], extras: [], tips: null,
    day_status: "completed", locked: false, ...o,
  };
}
function finish(r) {
  const fee = r.fee_override !== null ? Number(r.fee_override) : Number(r.rate_fee ?? 0);
  const ex = r.extras.reduce((a, x) => a + Number(x.amount), 0);
  const status = !r.guide_name ? "no_guide" : r.shift !== "private_tour" && r.rate_fee === null && r.fee_override === null ? "no_rate" : "paid";
  return { ...r, fee: m2(fee), extras_total: m2(ex), total: m2(fee + ex + Number(r.tips ?? 0)), status, locked: locks.some((l) => r.date >= l.from && r.date <= l.to) };
}

const KEVIN = { guide_hr_id: 201, guide_name: "Kevin Tran", guide_in_hr: true };
// Nov 1–15：会被改的数据（PUT 改这里）。
const runsNov = [
  mk({ ...KEVIN, date: "2026-11-02", assignment_id: 811, rate_id: 1, rate_fee: "230.00" }),
  mk({ ...KEVIN, date: "2026-11-03", assignment_id: 812, role: "driver_guide", driver_hr_id: 201, driver_name: "Kevin Tran", rate_id: 2, rate_fee: "280.00", extras_allowed: [ANT, LONG], extras: [ANT] }),
  mk({ ...KEVIN, date: "2026-11-06", assignment_id: 813, tour: "Grand Canyon South Rim", manifest_id: 4, rate_id: 3, rate_fee: "230.00", extras_allowed: [LONG], day_status: "not_completed" }),
  mk({ ...KEVIN, date: "2026-11-08", assignment_id: 814, shift: "private_tour", manifest_id: null, tour: "Private Tour", tips: "150.00", extras_allowed: [LONG] }),
  mk({ guide_hr_id: null, guide_name: "Jake ", guide_in_hr: false, date: "2026-11-04", assignment_id: 815, rate_id: 1, rate_fee: "230.00", fee_override: "260.00", extras_allowed: [ANT, LONG] }),
  mk({ guide_hr_id: null, guide_name: "Jake ", guide_in_hr: false, date: "2026-11-05", assignment_id: null, tour: "Bryce & Zion", manifest_id: 5, rate_id: 4, rate_fee: "250.00" }),
  mk({ guide_hr_id: 202, guide_name: "Lisa Park", guide_in_hr: true, date: "2026-11-09", assignment_id: 816, tour: "Zion Typed Tour", manifest_id: null }),
  mk({ date: "2026-11-07", assignment_id: 817, shift: "private_tour", manifest_id: null, tour: "Private Tour" }),
];
const runsOct = [mk({ ...KEVIN, date: "2026-10-20", assignment_id: 701, rate_id: 1, rate_fee: "230.00" })];

function periodOf(date) {
  const d = date === laToday() ? "2026-11-05" : date;
  const [y, m, dd] = d.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, "0");
  const from = `${y}-${pad(m)}-${dd <= 15 ? "01" : "16"}`;
  const to = `${y}-${pad(m)}-${dd <= 15 ? "15" : pad(last)}`;
  return { from, to };
}
function period(date) {
  const { from, to } = periodOf(date);
  const src = from === "2026-11-01" ? runsNov : from === "2026-10-16" ? runsOct : null;
  const through = from === "2026-11-01" ? "2026-11-10" : from === "2026-10-16" ? to : from < "2026-11-01" ? to : null;
  const runs = (src ?? []).map(finish).sort((a, b) => a.date.localeCompare(b.date));
  const paid = runs.filter((r) => r.status === "paid");
  const map = new Map();
  for (const r of paid) {
    const k = r.guide_in_hr ? `hr:${r.guide_hr_id}` : `typed:${r.guide_name.trim().toLowerCase()}`;
    if (!map.has(k)) map.set(k, { hr_id: r.guide_hr_id, in_hr: r.guide_in_hr, name: r.guide_name.trim(), total: 0, runs: [] });
    const p = map.get(k);
    p.runs.push(r);
    p.total += Number(r.total);
  }
  const people = [...map.values()].map((p) => ({ ...p, total: m2(p.total) })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    from, to, through, locks: locks.filter((l) => l.to >= from && l.from <= to),
    total: m2(people.reduce((a, p) => a + Number(p.total), 0)), people,
    unpaid: runs.filter((r) => r.status !== "paid"), runs: paid,
  };
}

// Pay rates 卡（5a）用的 GET /api/payroll/rates。
const rates = [
  { id: 1, manifest_id: 3, custom_tour: null, tour: "Antelope Canyon", from: "2026-01-01", to: null, applies_to: "all", people: [], guide_fee: "230.00", driver_guide_fee: "280.00", ant_relay: true, active: true },
  { id: 3, manifest_id: 4, custom_tour: null, tour: "Grand Canyon South Rim", from: "2026-01-01", to: null, applies_to: "all", people: [], guide_fee: "230.00", driver_guide_fee: "270.00", ant_relay: false, active: true },
  { id: 5, manifest_id: 3, custom_tour: null, tour: "Antelope Canyon", from: "2026-11-01", to: "2026-11-30", applies_to: "people", people: [{ person_key: "hr:201", hr_id: 201, name: "Kevin Tran" }], guide_fee: "240.00", driver_guide_fee: "290.00", ant_relay: true, active: true },
];
const extraRates = [
  { id: 1, code: "ant_relay", name: "ANT relay", from: "2026-01-01", to: null, amount: "66.00", active: true, applies_to: "all", people: [] },
  { id: 2, code: "long_day", name: "Long day", from: "2026-01-01", to: null, amount: "40.00", active: true, applies_to: "all", people: [] },
];
const history = [
  { id: 3, at: "2026-11-10T20:00:00+00:00", by: "Annie", action: "update", label: "Jake · Nov 4 · Antelope Canyon", what: "fee", from: "price", to: "$260.00 (by hand)" },
  { id: 2, at: "2026-11-09T20:00:00+00:00", by: "Annie", action: "create", label: "Nov 1–2, 2026", what: "lock", from: null, to: "Paid Nov 1–2" },
  { id: 1, at: "2026-11-08T20:00:00+00:00", by: "Annie", action: "create", label: "Antelope Canyon", what: "price", from: null, to: "Guide $230.00 · Driver + Guide $280.00 · ANT relay" },
];

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, await readBody(req)); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, query: url.search };
  log.push(entry);
  if (p === "/api/me/permissions") return send(res, 200, permsBody(ctl.superadmin ? "superadmin" : "admin", ctl.superadmin ? undefined : [...STANDARD.admin, ...ctl.codes]));
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.superadmin ? "superadmin" : "admin", is_admin: true, is_superadmin: !!ctl.superadmin, is_supervisor: true });
  if (p === "/api/hr/profiles") return send(res, 200, { profiles: [{ id: 1, user_id: null, legal_name: "ZZ Test Kevin", nickname: "", position: "guide", assignments: [], limited: [], languages: [], license_expiry_state: "none", medical_expiry_state: "none" }] });
  if (p === "/api/hr/linkable-users") return send(res, 200, { users: [] });
  if (p === "/api/hr/action-log") return send(res, 200, { next_cursor: null, entries: [] });

  if (p === "/api/payroll/period") {
    if (ctl.periodFail) return send(res, 500, { detail: "Could not reach the database. Try again." });
    return send(res, 200, period(url.searchParams.get("date") || laToday()));
  }
  if (p === "/api/payroll/period.csv") {
    res.setHeader("Content-Type", "text/csv");
    return res.end("Person,Date,Tour,Role,Fee,Fee changed by hand,Extras,Extras total,Tips,Total,Status,Day\n");
  }
  if (p === "/api/payroll/rates" && req.method === "GET") return send(res, 200, { rates, extra_rates: extraRates, locks });
  if (p === "/api/payroll/rates" && req.method === "PUT") { entry.body = await readBody(req); return send(res, 200, { changed: true, rate: { ...rates[0], ...entry.body } }); }
  if (p === "/api/payroll/extra-rates" && req.method === "PUT") { entry.body = await readBody(req); return send(res, 200, { changed: true, extra_rate: { ...extraRates[0], ...entry.body } }); }
  if (/^\/api\/payroll\/(rates|extra-rates)\/\d+$/.test(p) && req.method === "DELETE") return send(res, 200, { changed: true });
  const rm = /^\/api\/payroll\/runs\/(\d+)$/.exec(p);
  if (rm && req.method === "PUT") {
    const b = await readBody(req);
    entry.body = b;
    const id = Number(rm[1]);
    if (ctl.runFail === id) return send(res, 400, { detail: "Pay from 2026-11-01 to 2026-11-05 is locked. Unlock it first, then save." });
    const r = runsNov.find((x) => x.assignment_id === id);
    if (!r) return send(res, 404, { detail: "Run not found." });
    if (b.fee !== undefined) r.fee_override = b.fee === "" ? null : m2(b.fee);
    if (b.tips !== undefined) r.tips = b.tips === "" ? null : m2(b.tips);
    if (b.extras) {
      for (const [code, on] of Object.entries(b.extras)) {
        r.extras = r.extras.filter((x) => x.code !== code);
        if (on) r.extras.push(r.extras_allowed.find((x) => x.code === code));
      }
    }
    return send(res, 200, { changed: true, run: { assignment_id: id, date: r.date, tour: r.tour, tips: r.tips, fee: finish(r).fee, extras: r.extras.map((x) => x.code) } });
  }
  if (p === "/api/payroll/locks" && req.method === "POST") {
    const b = await readBody(req);
    entry.body = b;
    const lock = { id: locks.length + 10, from: b.from, to: b.to, note: b.note ?? null, created_by: "ZZ Test" };
    locks.push(lock);
    return send(res, 200, { lock });
  }
  const lm = /^\/api\/payroll\/locks\/(\d+)$/.exec(p);
  if (lm && req.method === "DELETE") {
    const i = locks.findIndex((l) => l.id === Number(lm[1]));
    const [gone] = i >= 0 ? locks.splice(i, 1) : [null];
    return gone ? send(res, 200, { unlocked: gone }) : send(res, 404, { detail: "Lock not found." });
  }
  if (p === "/api/payroll/action-log") return send(res, 200, { entries: history, next_cursor: null });
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("payroll mock up"));
