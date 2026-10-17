// 模拟后端：Dispatch Assignments。控制：POST /__ctl；GET /__log。
const http = require("http");
// 截图用：环境变量 MOCK_CTL（JSON）在启动时预设控制项，例 MOCK_CTL='{"completed":true}'（shoot.js 起模拟接口时会带上环境变量）。
const ctl = { completed: false, saveErr: "", fail401: false, pullStatus: "nothing", dayDelay: 0, failDay: false, altMeta: false, noMeta: false, relaySent: [], relayExtra: false, relayLater: [], relayRace: [], relayGone: [], relay409: false, relay502: false, driverFail: false, saveDelay: 0, driverAlt: false, driverAllOk: false, emptyHoover: false,
  // Farm out（G40）：farmOut = 开着才有 /api/farm-out/*（关着 404，页面和以前一样）；foSendErr = 发通知某一批 500。
  farmOut: false, foSendErr: false,
  // G71 编辑锁：lockOther = {by, since, by_me?}（GET 带 edit_lock；by_me 不为 true 时占的时候 409）；lock409 = 只有占的时候 409（GET 不带）；
  // acquireErr = 占的时候 400 的原话；acquireDelay = 占得慢（ms）；hb409 / save409 / copy409 = 那一步 409；
  // timing = {remind_after_s, auto_save_after_s, heartbeat_every_s}（不设 = GET 不带 edit_timing，页面用 600/300/60）。
  lockOther: null, lock409: false, acquireErr: "", acquireDelay: 0, hb409: false, save409: false, copy409: false, timing: null };
if (process.env.MOCK_CTL) Object.assign(ctl, JSON.parse(process.env.MOCK_CTL));
const log = [];
function send(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function readRaw(req) { return new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c).toString("utf8"))); }); }
const TODAY = "2026-10-04";
const row = (o) => ({ id: null, shift: "relay", driver_hr_id: null, vehicle_id: null, note: "", manifest_id: null, guide_hr_id: null, bus_label: null,
  driver_name: null, guide_name: null, driver_typed_name: null, guide_typed_name: null, custom_tour_name: null, location_ids: [], ...o });
// G82（后端 draft，2026-10-16）：2026-10-23 有 3 张 Rezdy Private 订单、3 台 Private 车。ctl.noG82 = 后端没上线（不带订单字段）。
const PRIVATE_DAY = "2026-10-23";
const PRIVATE_SEATS = { 11: null, 14: 14, 15: 24, 16: 56 };
const privateOrders = () => [
  { order_number: "CHDWNB38F", guest_name: "ZZ Test Guest", pax: 4, product: "Private Upper Antelope Canyon", pickup_time: "5:30 AM", pickup_location: "Sunset Station", notes: "Pickup Point: Sunset Station at 6:00AM / Main Valet. ZZ Test wheelchair guest." },
  { order_number: "CHDK70GRP", guest_name: "ZZ Test Group", pax: 70, product: "Private Hoover Dam Tour", pickup_time: "8:00 AM", pickup_location: "Excalibur", notes: "Corporate group, meet in the lobby at 7:45 AM." },
  { order_number: "CHDNOCAR1", guest_name: "ZZ Test Nocar", pax: 6, product: "Private Valley of Fire Tour", pickup_time: "8:15 AM", pickup_location: "Venetian", notes: null, skip_match: true },
];
// 每天存的排车
const saved = {
  "2026-10-05": [
    row({ id: 801, shift: "relay", driver_hr_id: 1, vehicle_id: 10, location_ids: [100, 101] }),
    row({ id: 802, shift: "bus_tour", manifest_id: 3, driver_hr_id: 2, guide_hr_id: 2, vehicle_id: 11, bus_label: "A", location_ids: [102] }),
    row({ id: 803, shift: "bus_tour", manifest_id: 3, driver_hr_id: 2, vehicle_id: 11, bus_label: "A", location_ids: [102] }),
  ],
  "2026-10-06": [],
  "2026-10-07": [row({ id: 901, shift: "relay", driver_hr_id: 1, vehicle_id: 10, location_ids: [100] })],
  // Seat guests：West Rim 两台车（A / B），Hoover Dam 一台车。
  "2026-10-09": [
    row({ id: 1101, shift: "bus_tour", manifest_id: 3, driver_hr_id: 2, vehicle_id: 11, bus_label: "A", location_ids: [102] }),
    row({ id: 1102, shift: "bus_tour", manifest_id: 3, driver_hr_id: 4, vehicle_id: 12, bus_label: "B", location_ids: [101] }),
    row({ id: 1103, shift: "bus_tour", manifest_id: 4, driver_hr_id: 5, vehicle_id: 10, bus_label: null, location_ids: [] }),
  ],
  // 按人数开车窗（G29 第 3 条）：West Rim 存了三台、只要两台（B 没人坐 ⇒ 标黄）；Hoover Dam 没车、要一台（补开）。
  "2026-10-10": [
    row({ id: 1201, shift: "bus_tour", manifest_id: 3, driver_hr_id: 2, vehicle_id: 11, bus_label: "A", location_ids: [102] }),
    row({ id: 1202, shift: "bus_tour", manifest_id: 3, driver_hr_id: 4, vehicle_id: 12, bus_label: "B", location_ids: [101] }),
    row({ id: 1203, shift: "bus_tour", manifest_id: 3, driver_hr_id: 5, vehicle_id: 10, bus_label: "C", location_ids: [101] }),
  ],
};
saved[PRIVATE_DAY] = [
  row({ id: 3001, shift: "private_tour", driver_hr_id: 5, vehicle_id: 14, custom_tour_name: "ZZ Test Charter", order_number: null, order_number_set_by_staff: false }),
  row({ id: 3002, shift: "private_tour", driver_hr_id: 4, vehicle_id: 16, order_number: null, order_number_set_by_staff: false }),
  row({ id: 3003, shift: "private_tour", driver_hr_id: 1, vehicle_id: 15, order_number: null, order_number_set_by_staff: false }),
];
// G71 编辑锁专用：10-20 两轮各一台；10-21 空、照抄 10-20；10-22 只有 1st Round（Copy 1st Round）。
saved["2026-10-20"] = [
  row({ id: 2001, shift: "relay", driver_hr_id: 1, vehicle_id: 10, location_ids: [100] }),
  row({ id: 2002, shift: "relay_2", driver_hr_id: 5, vehicle_id: 12, location_ids: [101] }),
];
saved["2026-10-22"] = [row({ id: 2201, shift: "relay", driver_hr_id: 1, vehicle_id: 10, location_ids: [100] })];
// 2026-10-16 紧急：按已选车的座位数开车窗（不再只看 guests_per_bus）。59 人、Bus A 选了 59 座的 1960（id 13）⇒ 不该冒出 Bus B。
saved["2026-10-17"] = [row({ id: 2301, shift: "bus_tour", manifest_id: 3, driver_hr_id: 2, vehicle_id: 13, bus_label: "A", location_ids: [102] })];
// Farm out（G40）：10-18 = West Rim Bus A + Bus B（Farm out，转给 Partner A）；10-19 = 两台普通车（点 Farm out 键用）。
saved["2026-10-18"] = [
  row({ id: 2401, shift: "bus_tour", manifest_id: 3, driver_hr_id: 2, vehicle_id: 11, bus_label: "A", location_ids: [102] }),
  row({ id: 2402, shift: "bus_tour", manifest_id: 3, bus_label: "B", farm_out: true, partner_id: 1, partner_name: "Partner A" }),
];
saved["2026-10-19"] = [
  row({ id: 2501, shift: "bus_tour", manifest_id: 3, driver_hr_id: 2, vehicle_id: 11, bus_label: "A", location_ids: [102] }),
  row({ id: 2502, shift: "bus_tour", manifest_id: 3, driver_hr_id: 4, vehicle_id: 12, bus_label: "B", location_ids: [101] }),
];
const FO_SENT = "2026-10-16T01:12:00+00:00";
const foFarm = (o) => ({ partner_id: 1, partner_location_id: null, checkin_time: null, checkin_time_set_by_staff: false, depart_time: null, depart_time_set_by_staff: false,
  payable_amount: null, payable_set_by_staff: false, payable_changed_by: null, payable_changed_at: null, notice_sent_at: null, notice_sent_by: null, ...o });
const foOrders = [
  { order_number: "CHDA001", name: "ZZ Test Ours", pax: 3, guest_ids: [20], pickup_time: "6:30 AM", pickup_location: "TI", bus_label: "A", staff: false, ota_conf_number: "CHDA001", adult: 3, child: 0, infant: 0, farm_out: null },
  { order_number: "CHDF001", name: "ZZ Test Sent", pax: 3, guest_ids: [21, 22], pickup_time: "6:40 AM", pickup_location: "Bellagio", bus_label: "B", staff: true, ota_conf_number: "GYG-7731042", adult: 2, child: 1, infant: 0,
    farm_out: foFarm({ partner_location_id: 1, checkin_time: "06:40", depart_time: "06:50", payable_amount: 305, notice_sent_at: FO_SENT, notice_sent_by: "Annie" }) },
  { order_number: "CHDF002", name: "ZZ Test Two", pax: 3, guest_ids: [23], pickup_time: "6:40 AM", pickup_location: "Venetian", bus_label: "B", staff: true, ota_conf_number: "CHDF002", adult: 2, child: 0, infant: 1,
    farm_out: foFarm({ partner_location_id: 2, checkin_time: "06:45", checkin_time_set_by_staff: true, depart_time: "06:55", depart_time_set_by_staff: true, payable_amount: 200, payable_set_by_staff: true, payable_changed_by: "Annie", payable_changed_at: "2026-10-16T00:58:00+00:00" }) },
  { order_number: "CHDF003", name: "ZZ Test Three", pax: 1, guest_ids: [24], pickup_time: "6:40 AM", pickup_location: "Venetian", bus_label: "B", staff: true, ota_conf_number: "VTR-118230", adult: 1, child: 0, infant: 0,
    farm_out: foFarm({ payable_amount: 105 }) },
];
const FO_PRISTINE = JSON.stringify(foOrders);
const FO_LOCS = [
  { id: 1, hotel_name: "Bellagio", spot: "Underground South Tour Lobby", address: "3600 S Las Vegas Blvd", map_link: "https://goo.gl/maps/x", sort_order: 1 },
  { id: 2, hotel_name: "Venetian", spot: "Ground Transportation Area", address: "3355 S Las Vegas Blvd", map_link: "https://goo.gl/maps/y", sort_order: 2 },
];
// 每天排班的版本：存 / 照抄 / 别人存（ctl otherSave）一次加 1。
const versions = {};
const ver = (d) => `v${versions[d] ?? 1}`;
const bump = (d) => { versions[d] = (versions[d] ?? 1) + 1; };
let tokenSeq = 0;
const LOCK_409 = "veronica is editing this day (since 10:05 AM). You can look, but you cannot change it until they save or leave.";
// Seat guests（GET /api/dispatch/seating）：只有 2026-10-09 有名单。auto = 自动分车会放的那台车。
const seatOrders = [
  { order_number: "SG1", name: "ZZ Test Alpha", pax: 2, guest_ids: [1, 2], pickup_time: "6:30 AM", pickup_location: "TI", auto: "A" },
  { order_number: "SG2", name: "ZZ Test Bravo", pax: 2, guest_ids: [3, 4], pickup_time: "6:30 AM", pickup_location: "TI", auto: "A" },
  { order_number: "SG3", name: "ZZ Test Charlie", pax: 3, guest_ids: [5, 6, 7], pickup_time: "6:40 AM", pickup_location: "Bellagio", auto: "B" },
  { order_number: "SG4", name: "ZZ Test Delta", pax: 2, guest_ids: [8, 9], pickup_time: "6:40 AM", pickup_location: "Bellagio", auto: null },
].map((o) => ({ ...o, bus_label: o.auto, staff: false }));
function seating(date) {
  if (date === "2026-10-18") {
    // Farm out 车不限座：capacity null（后端第三版接口）。
    const bus = (label, van) => ({ label, van, seats: label === "B" ? null : 14, capacity: label === "B" ? null : 14, pax: foOrders.filter((o) => o.bus_label === label).reduce((n, o) => n + o.pax, 0), ...(label === "B" ? { farm_out: true, partner_name: "Partner A" } : {}) });
    const onB = foOrders.filter((o) => o.bus_label === "B").reduce((n, o) => n + o.pax, 0);
    return { run_date: date, tours: [{ manifest_id: 3, title: "West Rim Bus Tour", name: "West Rim", uploaded: true, mode: "lettered", guests_per_bus: 14, pax: 10, pax_farm_out: onB, pax_ours: 10 - onB,
      buses: [bus("A", "2056"), bus("B", "")], orders: foOrders.map((o) => JSON.parse(JSON.stringify(o))) }] };
  }
  if (date !== "2026-10-09") return { run_date: date, tours: [{ manifest_id: 3, title: "West Rim Bus Tour", name: "West Rim", uploaded: false, mode: "lettered", guests_per_bus: 4, pax: 0, buses: [], orders: [] }] };
  const bus = (label, van) => ({ label, van, seats: 4, capacity: 4, pax: seatOrders.filter((o) => o.bus_label === label).reduce((n, o) => n + o.pax, 0) });
  return { run_date: date, tours: [
    { manifest_id: 3, title: "West Rim Bus Tour", name: "West Rim", uploaded: true, mode: "lettered", guests_per_bus: 4, pax: 9,
      buses: [bus("A", "768"), bus("B", "1328")], orders: seatOrders.map(({ auto, ...o }) => o) },
    { manifest_id: 4, title: "Hoover Dam", name: "Hoover Dam", uploaded: true, mode: "single", guests_per_bus: 50, pax: 5,
      buses: [{ label: null, van: "771", seats: null, capacity: 50, pax: 5 }], orders: [] },
  ] };
}
const drivers = [
  { id: 1, name: "FREDDY", initials: "FL", license_state: "ok", license_days: null, license_blocked: false, position: "driver", assignments: ["morning_relay"] },
  { id: 2, name: "GIA", initials: "GA", license_state: "soon", license_days: 5, license_blocked: false, position: "both", assignments: [] },
  { id: 3, name: "OLD JOE", initials: "", license_state: "expired", license_days: null, license_blocked: true, position: "driver", assignments: [] },
  { id: 4, name: "Bruce O", initials: "BO", license_state: "ok", license_days: null, license_blocked: false, position: "driver", assignments: ["bus_tour"] },
  { id: 5, name: "Bruce W", initials: "BW", license_state: "ok", license_days: null, license_blocked: false, position: "driver", assignments: [] },
];
function day(date) {
  const g82 = date === PRIVATE_DAY && !ctl.noG82;
  const dayRows = (saved[date] ?? []).map((r) => {
    const c = { ...r };
    if (date === PRIVATE_DAY && ctl.noG82) { delete c.order_number; delete c.order_number_set_by_staff; }
    return c;
  });
  return {
    run_date: date, today: TODAY, rows: dayRows,
    ...(g82 ? { private_orders: privateOrders().map(({ skip_match, ...o }) => ({ ...o, assigned_assignment_ids: dayRows.filter((r) => r.order_number === o.order_number).map((r) => r.id) })) } : {}),
    sections: [
      { shift: "relay", manifest_id: null, title: "Morning Relay · 1st Round", sub: "4:30 - 5:15 AM", default_location_ids: [] },
      { shift: "relay_2", manifest_id: null, title: "Morning Relay · 2nd Round", sub: "5:40 - 6:30 AM", default_location_ids: [] },
      { shift: "bus_tour", manifest_id: 3, title: "West Rim Bus Tour", sub: "TI 06:30", default_location_ids: [101, 102] },
      { shift: "bus_tour", manifest_id: 4, title: "Hoover Dam", sub: "", default_location_ids: [] },
      { shift: "private_tour", manifest_id: null, title: "Private Tour", sub: "Other times", default_location_ids: [] },
    ],
    orphans: [], drivers,
    // seats：Settings → Vehicles 填的座位数（2026-10-16 紧急加的字段），没填是 null。1960（id 13）填了 59，专给开车窗那组检查用。
    vehicles: [{ id: 10, van_no: "768", has_tracking: true, seats: null }, { id: 11, van_no: "2056", has_tracking: false, seats: null }, { id: 12, van_no: "1328", has_tracking: true, seats: null }, { id: 13, van_no: "1960", has_tracking: true, seats: 59 },
      ...(date === PRIVATE_DAY ? [{ id: 14, van_no: "612", has_tracking: true, seats: 14 }, { id: 15, van_no: "22", has_tracking: true, seats: 24 }, { id: 16, van_no: "41", has_tracking: true, seats: 56 }] : [])],
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
    copy_from: date === "2026-10-08" ? "2026-10-07" : date === "2026-10-05" ? "2026-10-04" : date === "2026-10-21" ? "2026-10-20" : null,
    version: ver(date),
    edit_lock: ctl.lockOther ? { by_me: false, ...ctl.lockOther } : null,
    ...(ctl.timing ? { edit_timing: ctl.timing } : {}),
  };
}
// Morning Relay（G61）：R2 / R3 一直是发过的；R5 发过、没有 sent_at（只写 Sent）；其余发过的（ctl.relaySent）是 annie 发的。
const RELAY_PULL_AT = "2026-10-05T11:55:00+00:00";
const RELAY_SENT_META = {
  R2: { sent_at: "2026-10-05T11:30:00+00:00", sent_by: "veronica" },
  R3: { sent_at: "2026-10-05T11:30:00+00:00", sent_by: "veronica" },
  R5: { sent_at: null, sent_by: "" },
};
const relayIsSent = (o) => ["R2", "R3"].includes(o) || (o === "R5" && ctl.relayExtra) || ctl.relaySent.includes(o);
const relayRound1 = () => ["R1", "R2", "R3", ...(ctl.relayExtra ? ["R4", "R5"] : [])];
const ccl = (o) => ({ line_id: 345, driver_text: "FREDDY", guide_text: null, vehicle_text: "768", is_driver_guide: false, route_label: null, ccl_note: null, driver_candidates: [], guide_candidates: [], ...o });
const prefills = {
  // 自动填充 + CCL 确认（Annie 2026-10-11）：没存过的一天，名单要两台、CCL 只给一台 ⇒ CCL 那台填进 A，B 留空（等 farm out）。
  "2026-10-12": { import_id: 79, title: "NPE 10/12:", status: "pending", is_revision: false, raw_content: "NPE 10/12: WEST RIM BRUCE O - 1328", applied: false,
    rows: [row({ shift: "bus_tour", manifest_id: 3, driver_hr_id: 4, vehicle_id: 12, bus_label: "A", location_ids: [101, 102], ccl: ccl({ line_id: 360, driver_text: "BRUCE O", vehicle_text: "1328", route_label: "WESTRIM" }) })],
    unread: [], closures: [], changes: null },
  // 没存过的一天：预填
  "2026-10-06": { import_id: 77, title: "NPE 10/6:", status: "pending", is_revision: false, raw_content: "NPE 10/6:\nWEST RIM\nBRUCE - 1328\n**??**", applied: false,
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
  if (p === "/__ctl") {
    Object.assign(ctl, JSON.parse(await readRaw(req)));
    // resetSeats：Seat guests 的单回到自动分车的位置（前面的检查挪过车）。
    if (ctl.resetFo) { const fresh = JSON.parse(FO_PRISTINE); foOrders.splice(0, foOrders.length, ...fresh); ctl.resetFo = false; }
    if (ctl.resetSeats) { for (const o of seatOrders) { o.bus_label = o.auto; o.staff = false; } ctl.resetSeats = false; }
    // otherSave = {date, vehicle_id}：别人存了这一天（第一台车换车、版本加 1）。
    if (ctl.otherSave) { const o = ctl.otherSave; saved[o.date][0] = { ...saved[o.date][0], vehicle_id: o.vehicle_id }; bump(o.date); ctl.otherSave = null; }
    return send(res, 200, ctl);
  }
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
  // G71 编辑锁（后端 docs/interfaces/dispatch-edit-lock-2026-10-15.md）。entry.resp 记下回给页面的，测试拿来比 token。
  if (p === "/api/dispatch/edit-lock") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.acquireDelay) await new Promise((r) => setTimeout(r, ctl.acquireDelay));
    if (ctl.acquireErr) return send(res, 400, { detail: ctl.acquireErr });
    if (ctl.lock409 || (ctl.lockOther && !ctl.lockOther.by_me)) return send(res, 409, { detail: LOCK_409 });
    entry.resp = { token: `tok-${++tokenSeq}`, stale: b.version !== ver(b.date), version: ver(b.date), ...(ctl.timing ? { edit_timing: ctl.timing } : {}) };
    return send(res, 200, entry.resp);
  }
  if (p === "/api/dispatch/edit-lock/heartbeat") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.hb409) return send(res, 409, { detail: "Your editing session ended (no activity for a while). Reload to see the latest schedule." });
    return send(res, 200, { ok: true });
  }
  if (p === "/api/dispatch/edit-lock/release") {
    // 页面卸载时用 fetch keepalive 发，body 照样是 JSON。
    const raw = await readRaw(req); try { entry.body = JSON.parse(raw); } catch { entry.body = raw; }
    return send(res, 200, { released: true });
  }
  if (p === "/api/dispatch/day" && req.method === "POST") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.save409) return send(res, 409, { detail: "veronica is editing this day now. Your changes were not saved." });
    // saveDelay：模拟存得慢（测存的时候行里的框关着）。
    if (ctl.saveDelay) await new Promise((r) => setTimeout(r, ctl.saveDelay));
    if (ctl.saveErr) return send(res, 400, { detail: ctl.saveErr });
    saved[b.date] = b.rows.map((r, i) => row({ ...r, id: 1000 + i, ccl: undefined, ccl_line_id: undefined, ...(r.farm_out ? { partner_name: r.partner_id === 1 ? "Partner A" : r.partner_id === 2 ? "Partner B" : null } : {}) }));
    bump(b.date);
    if (b.ccl_import_id && prefills[b.date]) prefills[b.date].status = "applied";
    const typed = b.rows.map((r) => r.driver_typed_name).filter(Boolean);
    return send(res, 200, { ok: true, saved: b.rows.length, ccl_applied: !!b.ccl_import_id, typed_alert: typed.length ? "not_set_up" : null, typed_names: typed });
  }
  if (p === "/api/dispatch/copy") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.copy409) return send(res, 409, { detail: "veronica is editing this day now. Nothing was copied." });
    saved[b.date] = (saved[b.from] ?? []).map((r) => ({ ...r }));
    bump(b.date);
    return send(res, 200, { ok: true, saved: saved[b.date].length, dropped: 1, dropped_expired: 1, dropped_deleted: 0 });
  }
  // G82 配订单：staff 指定的行原样保留；其余的按订单人数从大到小配，每张订单拿最大的车直到座位够。
  if (p === "/api/dispatch/private-match" && req.method === "POST") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.matchErr) return send(res, 500, { detail: "Internal Server Error" });
    // skip_match：模拟"这张订单没车可配"（它不参与配对，永远在 unmatched_orders 里）。
    const orders = privateOrders().filter((o) => !o.skip_match).sort((x, y) => y.pax - x.pax);
    const out = new Map();
    const free = [];
    for (const r of b.rows) {
      if (r.order_number_set_by_staff) out.set(r.key, { key: r.key, order_number: r.order_number, over_capacity: false });
      else free.push(r);
    }
    free.sort((x, y) => (PRIVATE_SEATS[y.vehicle_id] ?? 0) - (PRIVATE_SEATS[x.vehicle_id] ?? 0));
    const unmatched = privateOrders().filter((o) => o.skip_match).map((o) => o.order_number);
    for (const o of orders) {
      if (!free.length) { unmatched.push(o.order_number); continue; }
      let seats = 0;
      while (free.length && seats < o.pax) { const r = free.shift(); seats += PRIVATE_SEATS[r.vehicle_id] ?? 0; out.set(r.key, { key: r.key, order_number: o.order_number, over_capacity: false }); }
      if (seats < o.pax) for (const m of out.values()) if (m.order_number === o.order_number) m.over_capacity = true;
    }
    for (const r of free) out.set(r.key, { key: r.key, order_number: null, over_capacity: false });
    return send(res, 200, { matches: [...out.values()], unmatched_orders: unmatched });
  }
  if (p === "/api/dispatch/imports/day") return send(res, 200, { last_ok: "10/04 02:13 PM", prefill: prefills[q.date] ?? null });
  if (p === "/api/dispatch/imports/pull") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    const msg = { nothing: "Nothing new from CCL since the last pull.", failed: "Pull failed: Discord rejected the bot token (401). Check DISCORD_BOT_TOKEN on Railway." }[ctl.pullStatus] ?? "ok";
    return send(res, 200, { status: ctl.pullStatus, message: msg, new: 0, revisions: 0, last_ok: "10/04 02:13 PM" });
  }
  // G61（后端 2026-10-15）：每位客人多 sent_at / sent_by，顶层多 checked_at。
  // relayExtra：1st Round 多 R4（没发过）、R5（发过、没有 sent_at ⇒ 只写 Sent）。
  // relayLater：拉名单之后别人发了（preview 的 already_sent_orders 有、发送时跳过；名单上还是没发）。
  // relayRace：preview 之后才被别人发的（只在发送时跳过）。relayGone：发送时已不在这一轮（not_on_round）。
  if (p === "/api/dispatch/relay-pull") {
    const g = (o) => ({ id: 0, order_number: "", name: "ZZ Guest", pax: 2, pickup_time: "4:45 AM", pickup_location: "Excalibur", tour: "West Rim Bus Tour", sent: false, sent_at: null, sent_by: "", relay_status: "", changed: [], ...o });
    const sentMeta = (o) => (relayIsSent(o) ? { sent: true, ...(RELAY_SENT_META[o] ?? { sent_at: "2026-10-05T12:00:00+00:00", sent_by: "annie" }) } : { sent: false });
    const extra = ctl.relayExtra ? [g({ id: 4, order_number: "R4", ...sentMeta("R4") }), g({ id: 5, order_number: "R5", ...sentMeta("R5") })] : [];
    return send(res, 200, { run_date: q.date, checked_at: RELAY_PULL_AT, round_labels: { relay: { name: "Morning Relay · 1st Round", when: "4:30 - 5:15 AM" }, relay_2: { name: "Morning Relay · 2nd Round", when: "5:40 - 6:30 AM" } },
      rounds: {
        relay: [{ car: { id: 801, van: "768", driver: "FREDDY" }, guests: [g({ id: 1, order_number: "R1", ...sentMeta("R1") }), g({ id: 2, order_number: "R2", ...sentMeta("R2"), changed: ["pickup time 4:45 AM → 5:00 AM"] }), g({ id: 3, order_number: "R3", ...sentMeta("R3"), relay_status: "no_show" }), ...extra] }],
        relay_2: [{ car: { id: 802, van: null, driver: null }, guests: [] }],
      },
      need_a_look: [g({ id: 9, order_number: "R9", pickup_time: "7:30 AM", reason: "Pickup time could not be worked out from the time in Rezdy" })],
      departure: 4 });
  }
  if (p === "/api/dispatch/relay-send/preview") {
    const orders = q.round === "relay" ? relayRound1() : [];
    const already = orders.filter((o) => relayIsSent(o) || ctl.relayLater.includes(o));
    return send(res, 200, { run_date: q.date, round: q.round, to_send: orders.length - already.length, already_sent: already.length, already_sent_orders: already, checked_at: "2026-10-05T11:58:00+00:00" });
  }
  if (p === "/api/dispatch/relay-send") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.relay409) return send(res, 409, { detail: "Someone is already sending this round. Wait a minute and pull again." });
    if (ctl.relay502) return send(res, 502, { detail: "Bad gateway" });
    // 同后端：order_numbers 不传 = 这一轮全部；发过的跳过，除非在 send_anyway 里（带了 preview_at）。
    const round = b.round === "relay" ? relayRound1() : [];
    const anyway = new Set(b.preview_at ? b.send_anyway ?? [] : []);
    const asked = b.order_numbers ?? round;
    const notOnRound = asked.filter((o) => !round.includes(o) || ctl.relayGone.includes(o));
    const skipped = [], resent = [], sentNow = [];
    for (const o of asked) {
      if (notOnRound.includes(o)) continue;
      const was = relayIsSent(o) || ctl.relayLater.includes(o) || ctl.relayRace.includes(o);
      if (was && !anyway.has(o)) { skipped.push(o); continue; }
      if (was) resent.push(o);
      sentNow.push(o);
      if (!ctl.relaySent.includes(o)) ctl.relaySent.push(o);
    }
    // results 同后端 send_morning_row() 的每行形状（Morning Pickup 发送页同一个）。
    return send(res, 200, { round: b.round, sent: sentNow.length, failed: 0, already_sent: skipped.length, already_sent_orders: skipped, resent, not_on_round: notOnRound, checked_at: "2026-10-05T12:01:00+00:00",
      results: sentNow.map((o) => ({ order: `CHD${o}`, name: "ZZ Test Relay", phone: "+15550000009", pickup_time: "6:15 AM", sms_status: "sent:SM1", email_status: "", skipped: false })) });
  }
  if (p === "/api/dispatch/driver-notice") return send(res, 200, { run_date: q.date, text: `NPE: Your manifest for Mon, Oct 5 is ready. Log in to see your bus and guests: https://confirm.nationalparkexpress.com/driver?date=${q.date}`, last_sent: ctl.driverSentAt ? { at: "2026-10-04T22:00:00+00:00", by: "annie", label: "Texted 1 driver" } : null,
    people: [{ key: "hr:1", name: "FREDDY", phone: "+17025550101", can_send: true, why: "", cars: [{ shift: "Morning Relay · 1st Round", van: "768", tour: null }] },
             // driverAllOk：GIA 也能发（测收起状态的提示行显示 Last sent，而不是橙字）。
             ctl.driverAllOk
               ? { key: "hr:2", name: "GIA", phone: "+17025550103", can_send: true, why: "", cars: [{ shift: "Bus Tour", van: "2056", tour: "West Rim Bus Tour" }] }
               : { key: "hr:2", name: "GIA", phone: "", can_send: false, why: "No mobile number in Human Resource", cars: [{ shift: "Bus Tour", van: "2056", tour: "West Rim Bus Tour" }] },
             // driverAlt：排车存过之后多了一位能发的司机（测 Send texts now 先重读名单）。
             ...(ctl.driverAlt ? [{ key: "typed:PAM", name: "PAM", phone: "+17025550102", can_send: true, why: "", cars: [{ shift: "Morning Relay · 2nd Round", van: "1328", tour: null }] }] : [])] });
  if (p === "/api/dispatch/driver-notice/send") {
    const b = JSON.parse(await readRaw(req)); entry.body = b; ctl.driverSentAt = true;
    if (ctl.driver502) return send(res, 502, { detail: "Bad gateway" });
    return send(res, 200, { sent: ["FREDDY"], failed: ctl.driverFail ? [{ name: "BOB", error: "Twilio 21211" }] : [] });
  }
  // Farm out（G40，后端草稿 docs/interfaces/farm-out-2026-10-16.md）：ctl.farmOut 开着才有，关着 404。
  if (p.startsWith("/api/farm-out/")) {
    if (!ctl.farmOut) return send(res, 404, { detail: "Not Found" });
    if (p === "/api/farm-out/partners") return send(res, 200, [{ id: 1, name: "Partner A", slug: "partner_a", is_active: true }, { id: 2, name: "Partner B", slug: "partner_b", is_active: true }]);
    if (p === "/api/farm-out/partners/1/locations" || p === "/api/farm-out/partners/2/locations") return send(res, 200, FO_LOCS);
    if (p === "/api/farm-out/partners/1/timetable") return send(res, 200, { hotels: FO_LOCS.map((l) => ({ id: l.id, hotel_name: l.hotel_name, spot: l.spot })), tours: [{ manifest_id: 3, tour_name: "West Rim" }], cells: { "1_3": "06:50", "2_3": "06:50" } });
    if (p === "/api/farm-out/partners/2/timetable") return send(res, 200, { hotels: FO_LOCS.map((l) => ({ id: l.id, hotel_name: l.hotel_name, spot: l.spot })), tours: [{ manifest_id: 3, tour_name: "West Rim" }], cells: {} });
    if (p.startsWith("/api/farm-out/orders/") && req.method === "PATCH") {
      const b = JSON.parse(await readRaw(req)); entry.body = b;
      const o = foOrders.find((x) => x.order_number === decodeURIComponent(p.split("/").pop()));
      if (!o?.farm_out) return send(res, 404, { detail: "Not on a farm out vehicle" });
      const f = o.farm_out;
      if ("partner_location_id" in b) { f.partner_location_id = b.partner_location_id; if (b.partner_location_id && !f.depart_time_set_by_staff) { f.checkin_time = "06:40"; f.depart_time = "06:50"; } }
      if ("checkin_time" in b) { f.checkin_time = b.checkin_time; f.checkin_time_set_by_staff = true; }
      if ("depart_time" in b) { f.depart_time = b.depart_time; f.depart_time_set_by_staff = true; }
      if ("payable_amount" in b) { f.payable_amount = b.payable_amount; f.payable_set_by_staff = true; f.payable_changed_by = "Annie"; f.payable_changed_at = "2026-10-16T02:00:00+00:00"; }
      return send(res, 200, f);
    }
    if (p === "/api/farm-out/notices/preview") {
      const b = JSON.parse(await readRaw(req)); entry.body = b;
      return send(res, 200, b.orders.map((r) => r.order_number).map((n) => { const o = foOrders.find((x) => x.order_number === n); const miss = o?.farm_out?.partner_location_id ? [] : ["Missing hotel"];
        return { order_number: n, channel_text: { email_subject: "Your West Rim pick-up on Sunday, October 18", email_body: `Thank you for choosing to join us, ${o?.name}!\n\nPlease arrive at the Bellagio South Tour Lobby by 6:40 AM.`, sms_body: `Dear ${o?.name}, be at the Bellagio South Tour Lobby by 6:40 AM.` }, missing: miss }; }));
    }
    if (p === "/api/farm-out/notices/send") {
      const b = JSON.parse(await readRaw(req)); entry.body = b;
      if (ctl.foSendErr) return send(res, 500, { detail: "Farm out notice failed" });
      const results = b.orders.map((r) => r.order_number).map((n) => { const o = foOrders.find((x) => x.order_number === n); if (o?.farm_out) { o.farm_out.notice_sent_at = "2026-10-16T03:00:00+00:00"; o.farm_out.notice_sent_by = "Annie"; }
        return { order_number: n, name: o?.name ?? n, email_status: b.channel === "sms" ? "" : "Sent", sms_status: b.channel === "email" ? "" : (n === "CHDF002" ? "Failed: number unreachable" : "Sent") }; });
      return send(res, 200, { total: results.length, sent: results.length, failed: results.filter((r) => /Failed/.test(r.sms_status)).length, results });
    }
    return send(res, 404, { detail: "mock: not found" });
  }
  if (p === "/api/dispatch/seating") return send(res, 200, seating(q.date));
  if (p === "/api/dispatch/seating/move") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.seatErr) return send(res, 400, { detail: ctl.seatErr });
    const fo = foOrders.find((x) => x.guest_ids.join() === (b.guest_ids || []).join());
    if (fo) { fo.bus_label = b.bus_label; if (b.bus_label === "A") fo.farm_out = null; return send(res, 200, { ok: true, moved: fo.guest_ids.length, bus_label: b.bus_label, run_date: "2026-10-18", manifest_id: 3 }); }
    const o = seatOrders.find((x) => x.guest_ids.join() === (b.guest_ids || []).join());
    if (!o) return send(res, 400, { detail: "Some of these guests are no longer on the list. Reload the page." });
    // G56：Completed 那天选 Auto 不自动分车，原样留着、回 auto_skipped（autoSkip 开着时模拟）。
    if (!b.bus_label && ctl.autoSkip) return send(res, 200, { ok: true, moved: 0, bus_label: null, auto_skipped: true, run_date: "2026-10-09", manifest_id: 3 });
    if (b.bus_label) { o.bus_label = b.bus_label; o.staff = true; } else { o.bus_label = o.auto; o.staff = false; }
    return send(res, 200, { ok: true, moved: o.guest_ids.length, bus_label: b.bus_label || null, run_date: "2026-10-09", manifest_id: 3 });
  }
  // Sync Rezdy（后端 G70）：ctl.rezdy = "ok"（默认）| "fail"（502）；ctl.rezdyLast = {at, by} | 不设（null）。
  if (p === "/api/manifests/rezdy-sync" && req.method === "GET") return send(res, 200, { last_synced: ctl.rezdyLast ?? null });
  if (p === "/api/dispatch/manifests/rezdy-sync" && req.method === "POST") {
    entry.raw = await readRaw(req);
    if (ctl.rezdy === "fail") return send(res, 502, { ok: false, last_synced: ctl.rezdyLast ?? null, error: "Could not reach Rezdy. Nothing was changed. Wait a minute and try again." });
    ctl.rezdyLast = { at: new Date().toISOString(), by: "annie" };
    return send(res, 200, { ok: true, last_synced: ctl.rezdyLast, checked: 4, new: ["CHD1"], cancelled: ["CHD2"], changed: [], failed: ["CHD3"],
      run_date: "2026-10-05", guest_lists: { ok: true, run_date: "2026-10-05", synced: true, tours: [] } });
  }
  // G35：排车页打开 / 换天先同步名单；这里不改任何东西。
  if (p === "/api/dispatch/manifests/sync") return send(res, 200, { ok: true, run_date: q.date ?? "", synced: true, tours: [] });
  // Step 1 的卡片：3 今天有块（Assign Bus 滚过去闪一下），9 没有块（滚到 Step 2 开头）。
  // G56：completed = 2026-10-09 点过 Completed，之后 SG4 是新单（没坐上车）、SG3 改了。
  if (p === "/api/dispatch/pending") {
    if (ctl.pendingOff) return send(res, 404, { detail: "Not Found" });
    if (!ctl.completed || q.date !== "2026-10-09") return send(res, 200, { run_date: q.date, items: [] });
    return send(res, 200, { run_date: q.date, items: [
      { id: 21, manifest_id: 3, tour: "West Rim Bus Tour", order_number: "SG4", kind: "added", detail: "2 pax · 6:40 AM Bellagio", old_bus: null, relay: "", created_at: "2026-10-10T03:42:00+00:00" },
      { id: 22, manifest_id: 3, tour: "West Rim Bus Tour", order_number: "SG3", kind: "changed", detail: "pax 2 → 3; pickup 6:30 AM TI → 6:40 AM Bellagio", old_bus: "B", relay: "", created_at: "2026-10-10T04:05:00+00:00" },
    ] });
  }
  if (p === "/api/dispatch/manifests") {
    const card = (id, title) => ({ manifest_id: id, title, uploaded: false, guests: 0, pax: 0, buses: 0, not_on_bus: 0, lunch: null, uploaded_at: null, uploaded_by: null, mode: "single" });
    // 2026-10-09（Check the bus 改版 cb3887d）：3 车够但还有人没分到车 ⇒ Seat guests；4 要多开一台车 ⇒ Check the bus 实心。
    // guests_per_bus 5 / 3（不是 4 / 2）：2026-10-16 开车窗改按已选车的座位数算，这两台存着的车（11、12）没填 seats、
    // 退回 guests_per_bus 当容量——数要能让「2 台已经够坐」这件事仍然成立（9 ≤ 5+5、5 ≤ 3+3），不然会多冒出一台。
    if (q.date === "2026-10-09") return send(res, 200, { run_date: q.date, cards: [
      { ...card(3, "West Rim Bus Tour"), uploaded: true, pax: 9, guests: 4, buses: 2, mode: "lettered", not_on_bus: 2, buses_needed: 2, guests_per_bus: 5 },
      { ...card(4, "Hoover Dam"), uploaded: true, pax: 5, guests: 2, buses: 1, mode: "single", not_on_bus: 3, buses_needed: 2, guests_per_bus: 3 },
    ], guest_lists_done: ctl.completed ? { completed_by: "Annie", completed_at: "2026-10-09T22:40:00+00:00" } : null });
    if (q.date === "2026-10-12") return send(res, 200, { run_date: q.date, cards: [
      { ...card(3, "West Rim Bus Tour"), uploaded: true, pax: 70, guests: 30, buses: 0, mode: "none", not_on_bus: 70, buses_needed: 2, guests_per_bus: 54, bus_pax: {} },
    ] });
    // 2026-10-16 紧急：59 人，Bus A 已经选了 1960（59 座，见 vehicles）⇒ 一台够坐，不该冒出 Bus B（旧算法 ceil(59/54)=2 会冒出）。
    if (q.date === "2026-10-17") return send(res, 200, { run_date: q.date, cards: [
      { ...card(3, "West Rim Bus Tour"), uploaded: true, pax: 59, guests: 20, buses: 1, mode: "lettered", not_on_bus: 0, buses_needed: 2, guests_per_bus: 54, bus_pax: { A: 59 } },
    ] });
    if (q.date === "2026-10-18" || q.date === "2026-10-19") return send(res, 200, { run_date: q.date, cards: [
      { ...card(3, "West Rim Bus Tour"), uploaded: true, pax: 10, guests: 4, buses: 2, mode: "lettered", not_on_bus: 0, buses_needed: 2, guests_per_bus: 14, bus_pax: { A: 3, B: 7 } },
    ] });
    if (q.date === "2026-10-10") return send(res, 200, { run_date: q.date, cards: [
      { ...card(3, "West Rim Bus Tour"), uploaded: true, pax: 7, guests: 3, buses: 3, mode: "lettered", not_on_bus: 0, buses_needed: 2, guests_per_bus: 4, bus_pax: { A: 4, B: 0, C: 3 } },
      { ...card(4, "Hoover Dam"), uploaded: true, pax: 3, guests: 1, buses: 0, mode: "none", not_on_bus: 3, buses_needed: 1, guests_per_bus: 50, bus_pax: {} },
    ] });
    // emptyHoover：Hoover Dam 也有卡片、没客人（没排车）⇒ Step 2 收起来（Annie 2026-10-15）。
    return send(res, 200, { run_date: q.date, cards: [card(3, "West Rim Bus Tour"), card(9, "Ghost Tour"), ...(ctl.emptyHoover ? [card(4, "Hoover Dam")] : [])] });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("da mock on", process.env.MOCK_PORT || 8799));
