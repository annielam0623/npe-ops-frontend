// 模拟后端：Settings → Human Resource › Payroll（138 / G309，合同 v2 + Extras 选人 v3）。控制：POST /__ctl；GET /__log。
// 只连 localhost，绝不连真实后端。
// 期间：页面第一次不带 date（= 今天）；这里把今天当成 2026-11-05（固定数据，不随真实日期变）。
const http = require("http");
const { STANDARD, permsBody } = require("./role-standard");

const autoLock = { enabled: false, enabled_at: null };
const ctl = {
  superadmin: true,
  /** 不是 Super Admin 时，在 Admin 标准权限上加的勾（例如 ["settings.payroll.view"]）。 */
  codes: [],
  /** PUT /api/payroll/runs/{id} 对这一趟回 400（后端原句）。 */
  runFail: null,
  periodFail: false,
  /** G363 车型补贴（合同 guide-pay-vehicle-extra-2026-11-22.md）：true ⇒ 趟带 van / vehicle_model / vehicle_extra…、rates 带 vehicle_rates。 */
  g363: false,
  /** PUT /api/payroll/vehicle-rates 回 400（后端原句）。 */
  vehicleFail: false,
};
// G363：车型补贴价目（v180 起始行 + 一行锁之后的 SUV）；那天的车号 / 车型按趟号。
const VRATES = [
  { id: 1, model: "Sprinter", manifest_id: 3, tour: "Antelope Canyon", mode: "add", amount: "50.00", from: "2026-11-01", to: null, active: true },
  { id: 2, model: "Mini Van", manifest_id: 5, tour: "Bryce & Zion", mode: "total", amount: "320.00", from: "2026-11-01", to: null, active: true },
  { id: 3, model: "SUV", manifest_id: 3, tour: "Antelope Canyon", mode: "total", amount: "350.00", from: "2026-12-01", to: null, active: true },
];
const VEHMAP = {
  811: { van: "2622", model: "" },
  812: { van: "2041", model: "Sprinter" },
  818: { van: "2622B", model: "Mini Van" },
  819: { van: "2041", model: "Sprinter" },
  820: { van: "2041", model: "Sprinter" },
  821: { van: "2622", model: "" },
  822: { van: "2700", model: "Mini  Van" },
};
const log = [];

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
  // 同后端 extras_total：只算这天能勾的（extras_allowed 里有的）；小费只算 Private Tour（:215）。
  const ex = r.extras.filter((x) => r.extras_allowed.some((a) => a.code === x.code)).reduce((a, x) => a + Number(x.amount), 0);
  const tipsN = r.shift === "private_tour" ? Number(r.tips ?? 0) : 0;
  const status = !r.guide_name ? "no_guide" : r.shift !== "private_tour" && r.rate_fee === null && r.fee_override === null ? "no_rate" : "paid";
  const out = { ...r, fee: m2(fee), extras_total: m2(ex), total: m2(fee + ex + tipsN), status, locked: locks.some((l) => r.date >= l.from && r.date <= l.to) };
  if (!ctl.g363) return out;
  // 同后端规则：司机导游、Bus tour、有价格、没手改 Fee、那天的车型在补贴表里 ⇒ add 加上去 / total 补到总价（不低于 0）。
  const vm = VEHMAP[r.assignment_id] ?? { van: "", model: "" };
  let vx = null;
  if (r.role === "driver_guide" && r.shift === "bus_tour" && r.rate_fee !== null && r.fee_override === null && vm.model) {
    // 同后端 vehicle_rate_key：只去头尾空格 + 小写，中间空格不并（「Mini  Van」≠「Mini Van」）。
    const vr = VRATES.find((x) => x.active && x.model.trim().toLowerCase() === vm.model.trim().toLowerCase() && x.manifest_id === r.manifest_id && x.from <= r.date && (!x.to || x.to >= r.date));
    if (vr) {
      const amt = vr.mode === "add" ? Number(vr.amount) : Math.max(0, Number(vr.amount) - Number(r.rate_fee));
      vx = { rate_id: vr.id, model: vr.model, mode: vr.mode, rate_amount: vr.amount, amount: m2(amt) };
    }
  }
  const vxAmt = vx ? Number(vx.amount) : 0;
  return {
    ...out, van: vm.van, vehicle_model: vm.model,
    guide_position: r.guide_hr_id === 201 ? "both" : r.guide_in_hr && r.guide_name ? "guide" : "",
    vehicle_extra: vx, vehicle_extra_amount: m2(vxAmt), personal_and_vehicle: !!vx && r.assignment_id === 812,
    total: m2(Number(out.total) + vxAmt),
  };
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
  // G363 才有的两趟：Bryce & Zion 开 Mini Van（Total 320 − 价格 275 = 补 45）；Antelope 开 Sprinter 但 Fee 手改了（没有补贴）。
  mk({ ...KEVIN, g363only: true, date: "2026-11-04", assignment_id: 818, role: "driver_guide", driver_hr_id: 201, driver_name: "Kevin Tran", tour: "Bryce & Zion", manifest_id: 5, rate_id: 4, rate_fee: "275.00" }),
  mk({ ...KEVIN, g363only: true, date: "2026-11-10", assignment_id: 819, role: "driver_guide", driver_hr_id: 201, driver_name: "Kevin Tran", rate_id: 2, rate_fee: "280.00", fee_override: "300.00" }),
  // 后端核对 2b48ccc8 第 3 条：South Rim 开 Sprinter、Fee 手改了——South Rim 没有 Sprinter 补贴，点 Use the price 不该写 after Save。
  mk({ ...KEVIN, g363only: true, date: "2026-11-09", assignment_id: 820, role: "driver_guide", driver_hr_id: 201, driver_name: "Kevin Tran", tour: "Grand Canyon South Rim", manifest_id: 4, rate_id: 3, rate_fee: "270.00", fee_override: "290.00" }),
  // 后端核对条件 A / 1：Bus tour 存着小费 25（不算）、勾着一个这天不能勾的 Long day（不算）。
  mk({ ...KEVIN, g363only: true, date: "2026-11-07", assignment_id: 821, rate_id: 1, rate_fee: "230.00", tips: "25.00", extras_allowed: [], extras: [LONG] }),
  // 条件 B：车型打成「Mini  Van」（两个空格）、Fee 手改——对不上 Mini Van 补贴，点 Use the price 不写 after Save。
  mk({ ...KEVIN, g363only: true, date: "2026-11-05", assignment_id: 822, role: "driver_guide", driver_hr_id: 201, driver_name: "Kevin Tran", tour: "Bryce & Zion", manifest_id: 5, rate_id: 4, rate_fee: "275.00", fee_override: "280.00" }),
];
const runsOct = [mk({ ...KEVIN, date: "2026-10-20", assignment_id: 701, rate_id: 1, rate_fee: "230.00" })];

function periodOf(date) {
  // 页面第一次不带 date（= 今天）：固定当成 2026-11-05。带了 date 就照用——不能拿「真实的今天」比，
  // 不然真实今天正好是翻期算出来的那一天（例：11/1 + 16 = 11/17）时会被当成 11/05、翻不过去。
  const d = date || "2026-11-05";
  const [y, m, dd] = d.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, "0");
  const from = `${y}-${pad(m)}-${dd <= 15 ? "01" : "16"}`;
  const to = `${y}-${pad(m)}-${dd <= 15 ? "15" : pad(last)}`;
  return { from, to };
}
function period(date) {
  const { from, to } = periodOf(date);
  const src = from === "2026-11-01" ? runsNov.filter((r) => ctl.g363 || !r.g363only) : from === "2026-10-16" ? runsOct : null;
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
  if (p === "/__ctl") {
    const b = await readBody(req);
    // autoRow: true ⇒ 多一条系统自动锁（created_by "system"、note "Auto lock"）；false ⇒ 拿掉。autoLockReset ⇒ 开关回到关。
    if (b.autoRow === true && !locks.some((l) => l.id === 50)) locks.push({ id: 50, from: "2026-11-10", to: "2026-11-12", note: "Auto lock", created_by: "system" });
    if (b.autoRow === false) { const i = locks.findIndex((l) => l.id === 50); if (i >= 0) locks.splice(i, 1); }
    if (b.autoLockReset) Object.assign(autoLock, { enabled: false, enabled_at: null });
    Object.assign(ctl, b);
    return send(res, 200, ctl);
  }
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
    return send(res, 200, period(url.searchParams.get("date") || null));
  }
  if (p === "/api/payroll/period.csv") {
    res.setHeader("Content-Type", "text/csv");
    return res.end("Person,Date,Tour,Role,Fee,Fee changed by hand,Extras,Extras total,Tips,Total,Status,Day\n");
  }
  // ctl.antRemoved：ANT relay 的金额行都被 Remove 了——同后端 GET rates 只回启用的行，整个加购项不出现（Annie 2026-11-17）。
  // ctl.longDayRemoved 同理。extras = 加购项名单（后端 558e1176）：每个 code 一条、含全删了的（active false）；ctl.noCatalog = 旧后端没有这个键。
  if (p === "/api/payroll/rates" && req.method === "GET") {
    const gone = new Set([...(ctl.antRemoved ? ["ant_relay"] : []), ...(ctl.longDayRemoved ? ["long_day"] : [])]);
    const codes = [...new Map(extraRates.map((x) => [x.code, x.name])).entries()].sort((x, y) => x[0].localeCompare(y[0]));
    // ctl.extraEditable：多一行锁之后的 Long day（id 3，Dec 1 起），给 Extras 的 Edit 检查用（另外两行都碰到锁住的 11/1–2）。
    const extra3 = ctl.extraEditable ? [{ id: 3, code: "long_day", name: "Long day", from: "2026-12-01", to: null, amount: "40.00", active: true, applies_to: "all", people: [] }] : [];
    return send(res, 200, { rates, extra_rates: [...extraRates, ...extra3].filter((x) => !gone.has(x.code)), locks,
      ...(ctl.noCatalog ? {} : { extras: codes.map(([code, name]) => ({ code, name, active: !gone.has(code) })) }),
      // guides = HR 里 Guide / Driver + Guide 所有人（合同 d8a4f4b5）；ZZ Test Lan 本期没出车。ctl.noGuides = 旧后端没有这个键。
      ...(ctl.noGuides ? {} : { guides: [{ hr_id: 201, name: "Kevin Tran" }, { hr_id: 305, name: "ZZ Test Lan" }] }),
      ...(ctl.g363 ? { vehicle_rates: VRATES.filter((x) => x.active), vehicle_models: ["Mini Van", "SUV", "Sprinter"] } : {}) });
  }
  if (p === "/api/payroll/vehicle-rates" && req.method === "PUT") {
    entry.body = await readBody(req);
    if (ctl.vehicleFail) return send(res, 400, { detail: "Sprinter on South Rim already has an extra starting 2026-12-01. Change that one instead." });
    const old = VRATES.find((x) => x.id === entry.body.id);
    return send(res, 200, { changed: true, vehicle_rate: { ...(old ?? { id: 99, active: true }), ...entry.body } });
  }
  if (/^\/api\/payroll\/vehicle-rates\/\d+$/.test(p) && req.method === "DELETE") return send(res, 200, { changed: true, vehicle_rate: VRATES.find((x) => `/api/payroll/vehicle-rates/${x.id}` === p) ?? null });
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
  if (lm && req.method === "PUT") {
    entry.body = await readBody(req);
    const l = locks.find((x) => x.id === Number(lm[1]));
    if (!l) return send(res, 404, { detail: "Lock not found." });
    // ctl.lockPutErr = {status, detail}：后端拒（例如别的窗口刚加了重叠的锁、页面还没刷新），前端要照原句红字。
    if (ctl.lockPutErr) return send(res, ctl.lockPutErr.status, { detail: ctl.lockPutErr.detail });
    const eb = entry.body;
    if (!("from" in eb) && !("to" in eb) && !("note" in eb)) return send(res, 400, { detail: "Send from, to or note." });
    // 同后端：不能跟**别的**锁重叠（自己的旧范围不算）。
    const nf = eb.from ?? l.from, nt = eb.to ?? l.to;
    const ov = locks.find((x) => x.id !== l.id && nf <= x.to && nt >= x.from);
    if (ov) return send(res, 400, { detail: `${ov.from} to ${ov.to} is already locked. Pick dates that don't overlap.` });
    Object.assign(l, { from: nf, to: nt, note: "note" in eb ? eb.note : l.note });
    return send(res, 200, { changed: true, lock: l });
  }
  if (lm && req.method === "DELETE") {
    const i = locks.findIndex((l) => l.id === Number(lm[1]));
    const [gone] = i >= 0 ? locks.splice(i, 1) : [null];
    return gone ? send(res, 200, { unlocked: gone }) : send(res, 404, { detail: "Lock not found." });
  }
  // 自动锁开关（合同 d8a4f4b5）：GET（view）回 {enabled, enabled_at, can_edit}，can_edit 只有 Super Admin；PUT 只有 Super Admin，别人 403。
  if (p === "/api/payroll/auto-lock" && req.method === "GET") return send(res, 200, { enabled: autoLock.enabled, enabled_at: autoLock.enabled_at, can_edit: !!ctl.superadmin });
  if (p === "/api/payroll/auto-lock" && req.method === "PUT") {
    const b = await readBody(req);
    entry.body = b;
    // 后端 require_superadmin 的原句。ctl.autoLock403：前端还当自己是 Super Admin（页面没刷新就被降级），后端拒。
    if (!ctl.superadmin || ctl.autoLock403) return send(res, 403, { detail: "Superadmin access required" });
    if (typeof b.enabled !== "boolean" || ctl.autoLock400) return send(res, 400, { detail: "Send enabled: true or false." });
    if (ctl.autoLockFail) return send(res, 500, { detail: "Could not save. Try again." });
    const changed = b.enabled !== autoLock.enabled;
    autoLock.enabled = b.enabled;
    autoLock.enabled_at = b.enabled ? "2026-11-17T22:30:00-08:00" : null;
    return send(res, 200, { ...autoLock, changed, can_edit: true });
  }
  if (p === "/api/payroll/action-log") return send(res, 200, { entries: history, next_cursor: null });
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("payroll mock up"));
