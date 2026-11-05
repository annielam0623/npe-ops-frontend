// 模拟后端：Settings → Human Resource。控制：POST /__ctl；GET /__log。
const http = require("http");
const { permsBody } = require("./role-standard");
const ctl = { fail401: false, staff: false, supervisor: false, writeForbidden: false, prefMissing: false, schedule: false, bulkErr: false, fail500: false, samsaraDup: false, importFail: false };
const log = [];
const blank = {
  legal_name: "", nickname: "", phone: "", personal_email: "", date_of_birth: "",
  license_number: "", license_state: "", license_class: "", license_expires: "", medical_card_expires: "",
  company: "", employment_status: "", job_class: "", position: "", badge_no: "", hired_on: "", separated_on: "",
  next_due: "", assignments: [], limited: [], languages: [], samsara_driver_id: "", emergency_name: "", emergency_phone: "", notes: "",
};
let nextId = 10;
const profiles = [
  { ...blank, id: 1, user_id: 5, legal_name: "Alice Driver", nickname: "AL", phone: "+1 702 555 0101", position: "driver",
    license_number: "D123", license_expires: "2026-09-01", medical_card_expires: "2027-05-01",
    assignments: ["morning_relay"], limited: ["in_town_only"], languages: ["english"], samsara_driver_id: "281474977",
    license_expiry_state: "expired", medical_expiry_state: "ok" },
  { ...blank, id: 2, user_id: null, legal_name: "Bob Guide", nickname: "", position: "guide",
    license_expires: "2026-10-20", license_expiry_state: "soon", medical_expiry_state: "none",
    languages: ["english", "mandarin"] },
  { ...blank, id: 3, user_id: null, legal_name: "Carl Unknown", position: "trainer", employment_status: "full_time",
    license_expiry_state: "none", medical_expiry_state: "none" },
];
let pref = null;
// 「Other spellings」（后端 G234 续）：ctl.spellings = true 时列表带 other_spellings、有 PUT …/spellings；关着 = 后端没上线。
// JOSEPH 已经是别人（Joe R）的写法 ⇒ 409。
const spellings = { 1: ["JOE ROD"] };
function withSpellings(p) {
  return ctl.spellings ? { ...p, other_spellings: spellings[p.id] ?? [] } : p;
}
// ── 置顶 86 Working Record（后端 18 WIP origin/task/day-snapshot 的形状）。日子按「洛杉矶今天那一周」排：d0 = 周日。
function laToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function weekDay(i) {
  const t = laToday();
  const [y, m, d] = t.split("-").map(Number);
  return addDays(t, i - new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}
/** 那天洛杉矶的钟点 ⇒ 带时区的 ISO（夏令时也对）。 */
function la(ymd, hm) {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offAt = (t) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "shortOffset" })
    .formatToParts(new Date(t)).find((x) => x.type === "timeZoneName").value.replace("GMT", "")) || 0; // "GMT-8" ⇒ -8
  // 两次：先按猜的时刻取偏移，再按算出的真实时刻重取（夏令时切换那天才对）。
  const first = guess - offAt(guess) * 3600000;
  return new Date(guess - offAt(first) * 3600000).toISOString();
}
const run = (shift, title, van, as, extra = {}) => ({ shift, kind: shift.startsWith("relay") ? "relay" : "tour", title, manifest_id: 1, tour_name: shift.startsWith("relay") ? "" : title, van, as, start_at: null, end_at: null, ...extra });
function wrPeople() {
  const [d0, d1, d2, d3] = [0, 1, 2, 3].map(weekDay);
  return [
    { hr_id: 101, name: "ZZ Test Dan", position: "driver", days: [
      { date: d0, role: "driver", source: "completed", snapshot: true, runs: [run("private_tour", "Private Tour", "", "driver")] },
      { date: d1, role: "driver", source: "completed", snapshot: true, runs: [run("bus_tour", "Bus tour South Rim", "2622", "driver")] },
      { date: d2, role: "driver", source: "not_completed", snapshot: true, runs: [run("relay", "Hotel pickups to Treasure Island", "Van 12", "driver"), run("bus_tour", "Bus tour Bryce & Zion", "2610", "driver")] },
      { date: d3, role: "driver", source: "live", snapshot: false, runs: [run("bus_tour", "Bus tour South Rim", "2622", "driver")] },
    ] },
    { hr_id: 102, name: "ZZ Test Carlos", position: "both", days: [
      { date: d1, role: "both", source: "completed", snapshot: true, runs: [run("bus_tour", "Bus tour South Rim", "2622", "driver"), run("bus_tour", "Bus tour South Rim", "2622", "guide")] },
      { date: d3, role: "driver", source: "live", snapshot: false, runs: [run("relay_2", "Hotel pickups to Treasure Island", "Van 7", "driver")] },
    ] },
    { hr_id: 103, name: "ZZ Test Lankun", position: "guide", days: [
      { date: d1, role: "guide", source: "completed", snapshot: true, runs: [run("bus_tour", "Bus tour Antelope Canyon", "2356", "guide")] },
    ] },
    { hr_id: 104, name: "ZZ Test Lee", position: "guide", days: [
      { date: d0, role: "guide", source: "completed", snapshot: false, runs: [run("bus_tour", "", "", "guide", { tour_name: "" })] },
    ] },
    { hr_id: 105, name: "ZZ Test Nopos", position: "", days: [
      { date: d2, role: "driver", source: "completed", snapshot: false, runs: [run("bus_tour", "Bus tour West Rim", "2400", "driver")] },
    ] },
  ];
}
function wrSnapshots() {
  const d1 = weekDay(1);
  const data = (title, van) => ({
    shifts: [{ shift: "bus_tour", title, van }],
    stops: [{ van, location_id: 1, hotel: "Excalibur", arrived_at: la(d1, "05:42"), left_at: la(d1, "05:51"), dwell_minutes: 9 }],
    sms: { sent: 3, by: [{ author: "ZZ Test Dan", count: 3, source: "driver_page" }] },
    guests: { pax: 23, picked_up: 21, boarded: 0, no_show: 2, not_marked: 0 },
    roster: [{ order_number: "CHDZZ001", pax: 2, status: "picked_up", at: la(d1, "05:45"), by: "ZZ Test Dan", source: "relay" },
      { order_number: "CHDZZ002", pax: 1, status: "no_show", at: la(d1, "05:50"), by: "ZZ Test Dan", source: "relay" }],
    generated_at: la(d1, "19:00"),
  });
  const snap = (hr_id, name, kind, version, trigger, at, d) => ({ hr_id, name, kind, run_date: d1, version, trigger, created_at: la(d1, at), data: d });
  return {
    [`101|${d1}|driver`]: [snap(101, "ZZ Test Dan", "driver", 1, "checked_out", "19:00", data("Bus tour South Rim", "2622")),
      snap(101, "ZZ Test Dan", "driver", 2, "after_completion", "19:12", { ...data("Bus tour South Rim", "2622"), sms: { sent: 4, by: [] } })],
    [`102|${d1}|driver`]: [snap(102, "ZZ Test Carlos", "driver", 1, "checked_out", "19:05", data("Bus tour South Rim", "2622"))],
    [`102|${d1}|guide`]: [snap(102, "ZZ Test Carlos", "guide", 1, "guide_time", "18:00", { ...data("Bus tour South Rim", "2622"), sms: { sent: 0, by: [] } })],
  };
}
function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}
function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
async function readBody(req) {
  const d = await readRaw(req);
  return d ? JSON.parse(d) : null;
}
function stateOf(p) {
  return { license_expiry_state: p.license_expires ? "ok" : "none", medical_expiry_state: p.medical_card_expires ? "ok" : "none" };
}
function previewRow(name, status, extra = {}) {
  return { ...Object.fromEntries(Object.keys(blank).map((k) => [k, ""])), legal_name: name, status, errors: [], before: {}, changed: [], blanked: [], ...extra };
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, await readBody(req)); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, query: url.search };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  // 全部按照勾选（置顶 10c）：ctl.tick = { switchOn, codes } 时回员工权限总开关和我的勾；没有 tick 照旧（接口 404 = 开关关着）。
  if (ctl.tick && p === "/api/settings/dashboard-widgets") return send(res, 200, { readable: true, widgets: [{ key: "staff_permissions", label: "Staff permissions (ops gating)", visibility: ctl.tick.switchOn ? "staff" : "super_admin_only", default: "super_admin_only", visible_to_me: !!ctl.tick.switchOn }] });
  if (ctl.tick && p === "/api/me/permissions") return send(res, 200, { is_superadmin: false, permissions: ctl.tick.codes.map((code) => ({ code, module: code.split(".")[0], wired: true })), default_home: "/dashboard" });
  // 只看勾（2026-11-01）：没设 tick 时按角色标准回。
  if (p === "/api/me/permissions") return send(res, 200, permsBody(ctl.superadmin ? "superadmin" : ctl.staff ? "staff" : ctl.supervisor ? "supervisor" : "admin"));
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.superadmin ? "superadmin" : ctl.staff ? "staff" : ctl.supervisor ? "supervisor" : "admin", is_admin: !ctl.staff && !ctl.supervisor, is_superadmin: !!ctl.superadmin, is_supervisor: !ctl.staff });
  if (p === "/api/user-prefs/hr_list_layout") {
    if (ctl.prefMissing) return send(res, 404, { detail: "Unknown preference key" });
    if (req.method === "PUT") { const b = await readBody(req); entry.body = b; pref = b.value; return send(res, 200, { ok: true }); }
    return send(res, 200, { key: "hr_list_layout", value: pref });
  }
  // 置顶 86 Working Record：ctl.widgets = [{key, visibility, visible_to_me}] 时回页面开关（不带 tick 也回）。
  if (ctl.widgets && p === "/api/settings/dashboard-widgets") return send(res, 200, { readable: true, widgets: ctl.widgets.map((w) => ({ label: w.key, default: "super_admin_only", ...w })) });
  if (p === "/api/field-calendar") {
    if (ctl.wrMissing) return send(res, 404, { detail: "Not Found" });
    if (ctl.wrFail) return send(res, 500, { detail: "Could not load the snapshots. Try again." });
    if (ctl.wrForbidden) return send(res, 403, { detail: "This page is not open to you." });
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const inRange = (person) => ({ ...person, days: person.days.filter((d) => d.date >= from && d.date <= to) });
    const hrId = url.searchParams.get("hr_id");
    if (hrId) {
      const one = wrPeople().find((x) => x.hr_id === Number(hrId));
      return send(res, 200, { ...inRange(one), from, to });
    }
    return send(res, 200, { from, to, people: wrPeople().map(inRange) });
  }
  const fs = /^\/api\/field-snapshots\/(\d+)$/.exec(p);
  if (fs) {
    const key = `${fs[1]}|${url.searchParams.get("date")}|${url.searchParams.get("kind")}`;
    const all = wrSnapshots()[key];
    if (!all) return send(res, 404, { detail: "No snapshot for that day." });
    const v = Number(url.searchParams.get("version")) || all.length;
    const pick = all[v - 1];
    return send(res, 200, { ...pick, versions: all.map((s) => ({ version: s.version, trigger: s.trigger, created_at: s.created_at })) });
  }
  if (ctl.writeForbidden && req.method !== "GET" && p.startsWith("/api/hr/"))return send(res, 403, { detail: "Admin access required" });
  if (p === "/api/hr/profiles" && req.method === "GET") {
    if (ctl.fail500) return send(res, 500, { detail: "Human Resource is misconfigured and has been disabled: x This needs a code fix, not a settings change." });
    return send(res, 200, { profiles: [...profiles].sort((a, b) => a.legal_name.localeCompare(b.legal_name)).map(withSpellings) });
  }
  if (p === "/api/hr/linkable-users") return send(res, 200, { users: [{ id: 7, label: "Dan D", role: "driver" }] });
  // G203 共用读接口（后端 3686fea）：只存字段名，每个字段一行，from / to 为 null。
  if (p === "/api/hr/action-log") {
    return send(res, 200, { next_cursor: null, entries: [
      { id: "3-1", at: "2026-10-03T18:00:00+00:00", by: "Annie", action: "update", label: "Alice Driver", what: "Nickname", from: null, to: null },
      { id: "3-2", at: "2026-10-03T18:00:00+00:00", by: "Annie", action: "update", label: "Alice Driver", what: "Assignment", from: null, to: null },
      { id: "2-1", at: "2026-10-03T17:00:00+00:00", by: "annie", action: "update", label: "Bob Guide", what: "Mobile", from: null, to: null },
      { id: "1-1", at: "2026-10-03T16:00:00+00:00", by: "Annie", action: "export", label: "", what: "Exported 3 profile(s) to Excel", from: null, to: null },
    ] });
  }
  if (p === "/api/hr/profiles" && req.method === "POST") {
    const b = await readBody(req); entry.body = b;
    if (!String(b.legal_name ?? "").trim()) return send(res, 400, { detail: "Legal Name is required." });
    const id = nextId++;
    profiles.push({ ...blank, ...b, id, ...stateOf(b) });
    return send(res, 200, { id, legal_name: b.legal_name });
  }
  const sm = /^\/api\/hr\/profiles\/(\d+)\/spellings$/.exec(p);
  if (sm && ctl.spellings && req.method === "PUT") {
    const b = await readBody(req); entry.body = b;
    const id = Number(sm[1]);
    const row = profiles.find((x) => x.id === id);
    if (!row) return send(res, 404, { detail: "That profile no longer exists — it may have been deleted." });
    const list = [...new Set((b.spellings ?? []).map((s) => String(s).trim().toUpperCase().replace(/ +/g, " ")).filter(Boolean))]
      .filter((s) => s !== String(row.nickname).toUpperCase()).sort();
    if (list.includes("JOSEPH")) return send(res, 409, { detail: "JOSEPH is already used for Joe R. Remove it there first." });
    spellings[id] = list;
    return send(res, 200, { spellings: list });
  }
  let m = /^\/api\/hr\/profiles\/(\d+)$/.exec(p);
  if (m && req.method === "PUT") {
    const b = await readBody(req); entry.body = b;
    const row = profiles.find((x) => x.id === Number(m[1]));
    if (!row) return send(res, 404, { detail: "That profile no longer exists — it may have been deleted." });
    Object.assign(row, b, stateOf(b));
    return send(res, 200, { success: true });
  }
  if (m && req.method === "DELETE") {
    if (ctl.schedule && url.searchParams.get("confirm_schedule") !== "true") {
      return send(res, 409, { detail: { needs_confirm: true, message: "This person is still on the dispatch schedule for Sat Oct 3. If you delete them, those vehicles will have no driver or guide until someone is assigned. Past days keep their name." } });
    }
    const i = profiles.findIndex((x) => x.id === Number(m[1]));
    if (i >= 0) profiles.splice(i, 1);
    return send(res, 200, { success: true });
  }
  if (p === "/api/hr/profiles/bulk") {
    const b = await readBody(req); entry.body = b;
    if (ctl.samsaraDup) return send(res, 400, { detail: "That Samsara Driver ID is already on another person's record. Each driver needs their own ID. Nothing was saved." });
    if (ctl.bulkErr) return send(res, 400, { detail: { message: "In Town Only drivers can't be given Bus Tour. Untick one of them.", profile_id: 1 } });
    // Other spellings（后端 01606b02）：逗号串 = 这个人的整份清单；JOSEPH 是别人的 ⇒ 409，整批不存。
    for (const e of b.edits) {
      if (typeof e.other_spellings === "string" && /(^|,) *joseph *(,|$)/i.test(e.other_spellings)) {
        return send(res, 409, { detail: { message: "JOSEPH is already used for Joe R. Remove it there first.", profile_id: e.id } });
      }
    }
    let updated = 0;
    for (const e of b.edits) {
      const row = profiles.find((x) => x.id === e.id);
      if (!row) continue;
      for (const [k, v] of Object.entries(e)) {
        if (k === "id") continue;
        if (k === "other_spellings") {
          spellings[e.id] = [...new Set(String(v).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
          continue;
        }
        row[k] = ["assignments", "limited", "languages"].includes(k) ? (v ? String(v).split(",") : []) : v;
      }
      updated++;
    }
    return send(res, 200, { success: true, updated, missing: 0, unchanged: 0 });
  }
  if (p === "/api/hr/export") {
    entry.method = req.method;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="NPE_Driver_List_2026-10-03.xlsx"');
    return res.end("PK-fake");
  }
  if (p === "/api/hr/import-preview" || p === "/api/hr/import-commit") {
    const raw = await readRaw(req);
    const overwrite = /name="overwrite"\r\n\r\ntrue/.test(raw);
    entry.overwrite = overwrite;
    entry.hasFile = /filename="hr\.csv"/.test(raw);
    if (p === "/api/hr/import-commit") {
      if (ctl.importFail) return send(res, 500, { detail: "Database is busy" });
      // 后端 G220（76de8f3）：commit 多 errors（个数）和 error_rows [{row, message}]；文件里重复的行算 skipped。
      return send(res, 200, { imported: 1, updated: overwrite ? 1 : 0, unchanged: 0, skipped: 1, skipped_names: overwrite ? ["ZZ Test New"] : ["Bob Guide"], vanished: 0, errors: 1, error_rows: [{ row: 5, message: "Phone number looks wrong." }] });
    }
    const rows = [
      // 后端 G220（76de8f3）的形状：每行带 row（Excel 行号）、errors、before；查不过的行 status "error"、errors 的 field 是 null；
      // 文件里重复的行照旧 duplicate_in_file，errors 写「Repeated above — skipped.」。
      previewRow("ZZ Test New", "new", { row: 2, employment_status: "full_time", assignments: "Morning Relay" }),
      overwrite
        ? previewRow("Bob Guide", "update", { row: 3, phone: "+1 555", changed: ["phone"], blanked: ["employment_status"], before: { phone: "+1 444" } })
        : previewRow("Bob Guide", "exists", { row: 3, phone: "+1 555" }),
      previewRow("ZZ Test New", "duplicate_in_file", { row: 4, errors: [{ field: null, message: "Repeated above — skipped." }] }),
      previewRow("ZZ Test Bad", "error", { row: 5, phone: "555-01", errors: [{ field: null, message: "Phone number looks wrong." }] }),
    ];
    return send(res, 200, {
      rows, headers: ["legal_name", "phone", "employment_status", "assignments"],
      file_columns: ["legal_name", "phone", "employment_status", "assignments"], overwrite,
      counts: { new: 1, exists: overwrite ? 0 : 1, update: overwrite ? 1 : 0, unchanged: 0, duplicate: 1, error: 1 },
    });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("hr mock up"));
