// 模拟后端：Dispatch Assignments。控制：POST /__ctl；GET /__log。
const http = require("http");
const ctl = { saveErr: "", fail401: false, pullStatus: "nothing", dayDelay: 0, failDay: false, altMeta: false, noMeta: false, relaySent: [], relay409: false, relay502: false, driverFail: false, saveDelay: 0, driverAlt: false };
const log = [];
function send(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function readRaw(req) { return new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c).toString("utf8"))); }); }
const TODAY = "2026-10-04";
const row = (o) => ({ id: null, shift: "relay", driver_hr_id: null, vehicle_id: null, note: "", manifest_id: null, guide_hr_id: null, bus_label: null,
  driver_name: null, guide_name: null, driver_typed_name: null, guide_typed_name: null, custom_tour_name: null, location_ids: [], ...o });
// 每天存的排车
const saved = {
  "2026-10-05": [
    row({ id: 801, shift: "relay", driver_hr_id: 1, vehicle_id: 10, location_ids: [100, 101] }),
    row({ id: 802, shift: "bus_tour", manifest_id: 3, driver_hr_id: 2, guide_hr_id: 2, vehicle_id: 11, bus_label: "A", location_ids: [102] }),
    row({ id: 803, shift: "bus_tour", manifest_id: 3, driver_hr_id: 2, vehicle_id: 11, bus_label: "A", location_ids: [102] }),
  ],
  "2026-10-06": [],
  "2026-10-07": [row({ id: 901, shift: "relay", driver_hr_id: 1, vehicle_id: 10, location_ids: [100] })],
};
const drivers = [
  { id: 1, name: "FREDDY", initials: "FL", license_state: "ok", license_days: null, license_blocked: false, position: "driver", assignments: ["morning_relay"] },
  { id: 2, name: "GIA", initials: "GA", license_state: "soon", license_days: 5, license_blocked: false, position: "both", assignments: [] },
  { id: 3, name: "OLD JOE", initials: "", license_state: "expired", license_days: null, license_blocked: true, position: "driver", assignments: [] },
  { id: 4, name: "Bruce O", initials: "BO", license_state: "ok", license_days: null, license_blocked: false, position: "driver", assignments: ["bus_tour"] },
  { id: 5, name: "Bruce W", initials: "BW", license_state: "ok", license_days: null, license_blocked: false, position: "driver", assignments: [] },
];
function day(date) {
  return {
    run_date: date, today: TODAY, rows: (saved[date] ?? []).map((r) => ({ ...r })),
    sections: [
      { shift: "relay", manifest_id: null, title: "Morning Relay · 1st Round", sub: "4:30 - 5:15 AM", default_location_ids: [] },
      { shift: "relay_2", manifest_id: null, title: "Morning Relay · 2nd Round", sub: "5:40 - 6:30 AM", default_location_ids: [] },
      { shift: "bus_tour", manifest_id: 3, title: "West Rim Bus Tour", sub: "TI 06:30", default_location_ids: [101, 102] },
      { shift: "bus_tour", manifest_id: 4, title: "Hoover Dam", sub: "", default_location_ids: [] },
      { shift: "private_tour", manifest_id: null, title: "Private Tour", sub: "Other times", default_location_ids: [] },
    ],
    orphans: [], drivers,
    vehicles: [{ id: 10, van_no: "768", has_tracking: true }, { id: 11, van_no: "2056", has_tracking: false }, { id: 12, van_no: "1328", has_tracking: true }],
    locations: [{ id: 100, name: "Excalibur", active: true }, { id: 101, name: "MGM", active: true }, { id: 102, name: "Treasure Island", active: true }, { id: 103, name: "Old Motel", active: false }],
    tours: [{ id: 3, display_name: "West Rim Bus Tour", is_active: true, own_section: true, time_note: null, default_location_ids: [101, 102] }, { id: 4, display_name: "Hoover Dam", is_active: true, own_section: true, time_note: null, default_location_ids: [] }, { id: 9, display_name: "Old Tour", is_active: false, own_section: false, time_note: null, default_location_ids: [] }],
    guides: [{ id: 2, name: "GIA" }, { id: 6, name: "PAM" }],
    ...(ctl.noMeta ? {} : { meta: ctl.altMeta ? {
      coverage_shifts: ["relay"], round_names: { relay: "Early Round", relay_2: "Late Round" }, relay_shifts: ["relay", "relay_2"],
      bus_tour_shift: "bus_tour", shift_assignment: { relay: "morning_relay", relay_2: "morning_relay", bus_tour: "bus_tour", private_tour: "private_tour" },
      assignment_labels: { morning_relay: "Relay (meta)", bus_tour: "Bus Tour", private_tour: "Private Tour" }, bus_labels: ["A", "B", "C", "D", "E", "F"] } : {
      coverage_shifts: ["relay", "relay_2"], round_names: { relay: "1st Round", relay_2: "2nd Round" }, relay_shifts: ["relay", "relay_2"],
      bus_tour_shift: "bus_tour", shift_assignment: { relay: "morning_relay", relay_2: "morning_relay", bus_tour: "bus_tour", private_tour: "private_tour" },
      assignment_labels: { morning_relay: "Morning Relay", bus_tour: "Bus Tour", private_tour: "Private Tour" }, bus_labels: ["A", "B", "C", "D", "E"] } }),
    copy_from: date === "2026-10-08" ? "2026-10-07" : date === "2026-10-05" ? "2026-10-04" : null,
  };
}
const ccl = (o) => ({ line_id: 345, driver_text: "FREDDY", guide_text: null, vehicle_text: "768", is_driver_guide: false, route_label: null, ccl_note: null, driver_candidates: [], guide_candidates: [], ...o });
const prefills = {
  // 没存过的一天：预填
  "2026-10-06": { import_id: 77, title: "NPE 10/6:", status: "pending", is_revision: false, raw_content: "NPE 10/6:\nWEST RIM\nBRUCE - 1328", applied: false,
    rows: [
      row({ shift: "relay", driver_hr_id: 1, vehicle_id: 10, ccl: ccl({}) }),
      row({ shift: "bus_tour", manifest_id: 3, vehicle_id: 12, location_ids: [101, 102], ccl: ccl({ line_id: 346, driver_text: "BRUCE", vehicle_text: "1328", route_label: "WESTRIM", driver_candidates: [{ id: 4, name: "Bruce O" }, { id: 5, name: "Bruce W" }] }) }),
    ],
    unread: [{ raw_line: "??", ccl_section: "X", reason: "No dash" }],
    closures: [{ ccl_section: "HOOVER DAM", shift: "bus_tour", manifest_id: 4, note: "Closed due to weather" }], changes: null },
  // 存过的一天：改版
  "2026-10-07": { import_id: 78, title: "NPE 10/7: Revision", status: "pending", is_revision: true, raw_content: "rev", applied: false,
    rows: [row({ shift: "relay", driver_hr_id: 2, vehicle_id: 12, ccl: ccl({ driver_text: "GIA", vehicle_text: "1328" }) }), row({ shift: "private_tour", driver_hr_id: 5, vehicle_id: 11, ccl: ccl({ line_id: 350, driver_text: "BRUCE W" }) })],
    unread: [], closures: [], changes: [{ kind: "changed", row_id: 901, ccl_row: 0, fields: ["driver", "vehicle"] }, { kind: "added", ccl_row: 1 }] },
};
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, JSON.parse(await readRaw(req))); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, q };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/dispatch/day" && req.method === "GET") {
    if (ctl.dayDelay) await new Promise((r) => setTimeout(r, ctl.dayDelay));
    if (ctl.failDay) return send(res, 502, { detail: "Bad gateway" });
    return send(res, 200, day(q.date || "2026-10-05"));
  }
  if (p === "/api/me") return send(res, 200, { id: 1, username: "annie", display_name: "Annie", initials: "AZ", role: "admin", is_admin: true, is_superadmin: false });
  if (p === "/api/dispatch/day" && req.method === "POST") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    // saveDelay：模拟存得慢（测存的时候行里的框关着）。
    if (ctl.saveDelay) await new Promise((r) => setTimeout(r, ctl.saveDelay));
    if (ctl.saveErr) return send(res, 400, { detail: ctl.saveErr });
    saved[b.date] = b.rows.map((r, i) => row({ ...r, id: 1000 + i, ccl: undefined, ccl_line_id: undefined }));
    if (b.ccl_import_id && prefills[b.date]) prefills[b.date].status = "applied";
    const typed = b.rows.map((r) => r.driver_typed_name).filter(Boolean);
    return send(res, 200, { ok: true, saved: b.rows.length, ccl_applied: !!b.ccl_import_id, typed_alert: typed.length ? "not_set_up" : null, typed_names: typed });
  }
  if (p === "/api/dispatch/copy") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    saved[b.date] = (saved[b.from] ?? []).map((r) => ({ ...r }));
    return send(res, 200, { ok: true, saved: saved[b.date].length, dropped: 1, dropped_expired: 1, dropped_deleted: 0 });
  }
  if (p === "/api/dispatch/imports/day") return send(res, 200, { last_ok: "10/04 02:13 PM", prefill: prefills[q.date] ?? null });
  if (p === "/api/dispatch/imports/pull") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    const msg = { nothing: "Nothing new from CCL since the last pull.", failed: "Pull failed: Discord rejected the bot token (401). Check DISCORD_BOT_TOKEN on Railway." }[ctl.pullStatus] ?? "ok";
    return send(res, 200, { status: ctl.pullStatus, message: msg, new: 0, revisions: 0, last_ok: "10/04 02:13 PM" });
  }
  if (p === "/api/dispatch/relay-pull") {
    const g = (o) => ({ id: 0, order_number: "", name: "ZZ Guest", pax: 2, pickup_time: "4:45 AM", pickup_location: "Excalibur", tour: "West Rim Bus Tour", sent: false, relay_status: "", changed: [], ...o });
    const sent = (o) => ctl.relaySent.includes(o);
    return send(res, 200, { run_date: q.date, round_labels: { relay: { name: "Morning Relay · 1st Round", when: "4:30 - 5:15 AM" }, relay_2: { name: "Morning Relay · 2nd Round", when: "5:40 - 6:30 AM" } },
      rounds: {
        relay: [{ car: { id: 801, van: "768", driver: "FREDDY" }, guests: [g({ id: 1, order_number: "R1", sent: sent("R1") }), g({ id: 2, order_number: "R2", sent: true, changed: ["pickup time 4:45 AM → 5:00 AM"] }), g({ id: 3, order_number: "R3", sent: true, relay_status: "no_show" })] }],
        relay_2: [{ car: { id: 802, van: null, driver: null }, guests: [] }],
      },
      need_a_look: [g({ id: 9, order_number: "R9", pickup_time: "7:30 AM", reason: "The time is outside both rounds" })],
      departure: 4 });
  }
  if (p === "/api/dispatch/relay-send/preview") return send(res, 200, { run_date: q.date, round: q.round, to_send: q.round === "relay" ? (ctl.relaySent.includes("R1") ? 0 : 1) : 0, already_sent: 2 });
  if (p === "/api/dispatch/relay-send") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.relay409) return send(res, 409, { detail: "Someone is already sending this round. Wait a minute and pull again." });
    if (ctl.relay502) return send(res, 502, { detail: "Bad gateway" });
    ctl.relaySent.push("R1");
    return send(res, 200, { round: b.round, sent: 1, failed: 0, already_sent: 2, results: [] });
  }
  if (p === "/api/dispatch/driver-notice") return send(res, 200, { run_date: q.date, text: "NPE: your runs for Mon 10/5: https://x/field", last_sent: ctl.driverSentAt ? { at: "2026-10-04T22:00:00+00:00", by: "annie", label: "Texted 1 driver" } : null,
    people: [{ name: "FREDDY", phone: "+17025550101", can_send: true, why: "", cars: [{ shift: "Morning Relay · 1st Round", van: "768", tour: null }] },
             { name: "GIA", phone: "", can_send: false, why: "No mobile number in Human Resource", cars: [{ shift: "Bus Tour", van: "2056", tour: "West Rim Bus Tour" }] },
             // driverAlt：排车存过之后多了一位能发的司机（测 Send texts now 先重读名单）。
             ...(ctl.driverAlt ? [{ name: "PAM", phone: "+17025550102", can_send: true, why: "", cars: [{ shift: "Morning Relay · 2nd Round", van: "1328", tour: null }] }] : [])] });
  if (p === "/api/dispatch/driver-notice/send") {
    const b = JSON.parse(await readRaw(req)); entry.body = b; ctl.driverSentAt = true;
    if (ctl.driver502) return send(res, 502, { detail: "Bad gateway" });
    return send(res, 200, { sent: ["FREDDY"], failed: ctl.driverFail ? [{ name: "BOB", error: "Twilio 21211" }] : [] });
  }
  // Step 1 的卡片：3 今天有块（Assign Bus 滚过去闪一下），9 没有块（滚到 Step 2 开头）。
  if (p === "/api/dispatch/manifests") {
    const card = (id, title) => ({ manifest_id: id, title, uploaded: false, guests: 0, pax: 0, buses: 0, not_on_bus: 0, lunch: null, uploaded_at: null, uploaded_by: null, mode: "single" });
    return send(res, 200, { run_date: q.date, cards: [card(3, "West Rim Bus Tour"), card(9, "Ghost Tour")] });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("da mock on 8799"));
