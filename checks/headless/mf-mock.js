// 模拟后端：Tour manifest。控制：POST /__ctl {syncFail, syncSkipped, syncPast, busFail, allUploaded, done, pending, pendingOff, handledFail}；GET /__log。
const http = require("http");
const staffPerm = require("./staff-perm-mock");
// affiliate: true ⇒ GET manifest 带 affiliate 组（被转单客人）；notesEdit: true ⇒ 客人带 notes_edited / rezdy_notes 且有 PUT guest-notes；notesFail: 该接口 400 的原话。
const ctl = { syncFail: "", syncSkipped: false, syncPast: false, busFail: "", allUploaded: false, done: null, pending: [], pendingOff: false, handledFail: "", affiliate: false, notesEdit: false, notesFail: "", g198: false, g198Plain: false, textSize: false, textSizeFail: "", bmv: false, versionFail: "" };
// bmv: true ⇒ Bus Manifest 三版式（后端 task/bus-manifest-versions WIP f494b5b5 的形状）：tour.manifest_version / lunch_column、
// 客人 hotel_short / pickup_time_short / lunch_slots / lunch_mismatch、每车 lunch_mismatch_orders / restaurant（只 Lankun）；
// PUT /api/dispatch/manifest/version。versionFail：该接口 400 的原话；partner 一律 403。
const log = [];
function send(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function readRaw(req) { return new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c).toString("utf8"))); }); }
const guest = (id, order, extra = {}) => ({ id, row_key: order, row_no: id, order_number: order, first_name: "ZZ", last_name: "Test" + id, phone: "+1555", email: "x@x",
  quantities: "Adult", pax: 2, product: "Antelope", pickup_time: "6:30 AM", pickup_location: "Excalibur", special_requirements: "", bus_label: "A",
  boarding: null, boarding_at: null, name: "ZZ Test" + id, lunch: { turkey: 0, veggie: 0, beef: 0, default: false, check: false, has_lunch: false },
  lunch_text: "", ticket: "2 Adult", notes: "", notes_check: false, ticket_hl: false, ...extra });
const state = {
  guests: [guest(1, "CHD1", { extra: "Heli" }),guest(2, "CHD2", { bus_label: null, notes: "1 Turkey ??", notes_check: true, ticket_hl: true, ticket: "2 Adult + 1 Child" }), guest(3, "CHD3", { pickup_location: "MGM Grand", boarding: "boarded", sync_status: "missing", sync_note: "Not in main manifest — check Rezdy" })],
  attraction: { checkin_time: "8:00", pax_text: "", tour_time: "", confirmation_no: "" },
  textSize: { A: { page: {}, columns: { pickup_location: { d: 3, bold: true } }, rows: {} }, B: { page: {}, columns: {}, rows: {} } },
  textHistory: [{ by: "Veronica", at: "Oct 26, 4:12 PM", what: "Pick-up Location column +3 px, Bold" }],
  version: "general",
};
// 三版式的客人字段：CHD3 点了 1 B 2 V、只有 2 人 ⇒ 餐不符；CHD2 读不出 ⇒「-」、不符；CHD9（shuttle）不带餐。
const BMV = {
  CHD1: { hotel_short: "Excalibur", lunch_slots: ["", "2 T", ""], lunch_mismatch: false },
  CHD2: { hotel_short: "Excalibur", lunch_slots: null, lunch_mismatch: true },
  CHD3: { hotel_short: "MGM", lunch_slots: ["1 B", "", "2 V"], lunch_mismatch: true },
  CHD9: { hotel_short: "Excalibur", lunch_slots: null, lunch_mismatch: false },
};
const bmvGuest = (g) => (ctl.bmv ? { ...g, pickup_time_short: g.pickup_time.replace(/\s*[AP]M$/i, ""), ...(BMV[g.order_number] || {}) } : g);
const mismatchOrders = (gs, label) => ctl.bmvClean ? [] : gs.filter((g) => BMV[g.order_number]?.lunch_mismatch).map((g) => ({ order_number: g.order_number, guest: g.name, pax: g.pax, lunch_text: BMV[g.order_number].lunch_slots ? BMV[g.order_number].lunch_slots.filter(Boolean).join(" ") : "-", bus_label: label, tour: "Antelope Canyon" }));
// 二期（Special Requirements 可编辑）：后端上线后客人才带 notes_edited / rezdy_notes。
const pub = (g0) => { const g = bmvGuest(g0); return ctl.notesEdit && g._rezdy !== undefined ? { ...g, notes_edited: !!g._edited, rezdy_notes: g._rezdy } : ctl.notesEdit ? { ...g, notes_edited: false, rezdy_notes: g.notes } : g; };
function view() {
  const sec = (gs0, withAttr) => ({ key: "LOWER ANTELOPE", kind: "tour", title: "LOWER ANTELOPE", heading: `LOWER ANTELOPE {${gs0.reduce((a, g) => a + g.pax, 0)}}`, name: "", pax: gs0.reduce((a, g) => a + g.pax, 0), color: "#bfe3b0", guests: gs0.map(pub),
    ...(withAttr ? { attraction: state.attraction, attraction_filled: true } : {}),
    // G198 后端 8a 的形状：A 车开了格、有时间有号（heading 后端拼好）；B 车开了格、没时间没号；Not on a bus 那块当没开格（heading 照旧）。
    // g198Plain：后端上线了、但这个组没开格（别的团）：每个 tour 节都带 show_cfm false + 时间，heading 照旧。
    ...(ctl.g198Plain ? { show_cfm: false, cfm_no: null, tour_time: "1:00P", checkin_time: "12:30P" } : ctl.g198 ? g198Fields(gs0, withAttr) : {}) });
  function g198Fields(gs0, withAttr) {
    const pax = gs0.reduce((a, g) => a + g.pax, 0);
    if (!withAttr) return { show_cfm: false, cfm_no: null, tour_time: "", checkin_time: "" };
    if (gs0.every((g) => g.bus_label === "A")) return { show_cfm: true, cfm_no: "395067", tour_time: "1:00P", checkin_time: "12:30P", heading: `LOWER ANTELOPE 1:00P (CHECK-IN 12:30P) - ${pax} PAX · CFM # 395067` };
    return { show_cfm: true, cfm_no: "", tour_time: "", checkin_time: "", heading: `LOWER ANTELOPE - ${pax} PAX` };
  }
  const onA = state.guests.filter((g) => g.bus_label === "A");
  const onB = state.guests.filter((g) => g.bus_label === "B");
  const un = state.guests.filter((g) => !g.bus_label);
  const shuttle = { key: "SHUTTLE OUT", kind: "outbound", title: "SHUTTLE OUT", heading: "SHUTTLE: LAS TO PAGE // OUTBOUND 2 PAX", name: "", pax: 2, color: "#f8c9a0", guests: [pub(guest(9, "CHD9", { ticket: "Shuttle" }))], attraction: { checkin_time: "", pax_text: "", tour_time: "", confirmation_no: "" }, attraction_filled: false };
  const block = (id, label, gs, extraSecs = []) => ({ bus: { id, bus_label: label, van: "20" + id, seats: 56, driver: "FREDDY", guide: "" }, bus_key: label, bus_number: `20${id}=${label}`,
    sections: gs.length ? [sec(gs, true), ...extraSecs] : extraSecs, totals: { pax: 0, guests: 0, boarded: 0, no_show: 0 },
    footer: [{ label: "TOTAL # OF PAX", value: 56, custom: false }, { label: "BUS SEATS LEFT", value: null, custom: false }, { label: "Heli SEATS LEFT", value: 4, custom: true }, { label: "INBOUND", value: 0, custom: false }, { label: "BUS SEATS USED", value: 6, custom: false }, { label: "NO LUNCH (INCL. SHUTTLE)", value: 2, custom: false }], empty_notes: false,
    ...(ctl.g198 ? { lunch: label === "A" ? { sections: [{ title: "LOWER ANTELOPE 1:00P - 4 PAX", rows: [{ name: "ZZ Test1", pax: 2, turkey: 2, veggie: 0, beef: 0, defaulted: true }, { name: "ZZ Test3", pax: 2, turkey: 1, veggie: 1, beef: 0, defaulted: false }] }], totals: { pax: 4, turkey: 3, veggie: 1, beef: 0 }, note: "(TEXT) POC: ZZ TEST 555-0100\nCALL no later than 7pm, night before  555-0101", title: "NPE Lunch Box - ZZ Test Bee's", restaurant: "ZZ Test Bee's" } : null } : {}),
    ...(ctl.textSize ? { text_size: state.textSize[label], text_size_history: state.textHistory } : {}),
    ...(ctl.bmv ? { lunch_mismatch_orders: mismatchOrders(gs, label),
      restaurant: state.version === "lankun" ? { name: "ZZ Test Bee's", title: "NPE Lunch Box - ZZ Test Bee's", footer_lines: ["(TEXT) POC: ZZ TEST 555-0100", "CALL no later than 7pm, night before"], totals: { beef: 1, turkey: 2, veggie: 2, total: 5 } } : null } : {}) });
  return { run_date: "2026-10-05", date_label: "Mon, Oct 5, 2026",
    tour: { id: 3, name: "Antelope Canyon", color: "#8db76f", band_color: "#8db76f", section_color: "#d9ead0", lunch_note: "",
      // 后端 1b2ea12a：开了 Cfm # 格的组 confirm_box = false（整团不出黄框），其他组 true。
      ...(ctl.g198 ? { confirm_box: false } : ctl.g198Plain ? { confirm_box: true } : {}),
      ...(ctl.bmv ? { manifest_version: state.version, lunch_column: true } : {}) },
    shuttle_colors: { outbound: "#f8c9a0", inbound: "#b9d3f0" },
    extra_row_color: "#f8cbad",
    manifest: { id: 12, file_name: "ant.csv", uploaded_at: "2026-10-04T21:14:02+00:00", uploaded_by: "Annie" },
    mode: "lettered", bus_labels: ["A", "B"],
    // g198：A 车多一节没开格的 UPPER（有 Tour time 也不写进标题，heading 照旧），测「没开格的节照旧」。
    blocks: [block(41, "A", onA, ctl.g198 ? [{ key: "UPPER ANTELOPE", kind: "tour", title: "UPPER ANTELOPE", heading: "UPPER ANTELOPE {0}", name: "", pax: 0, color: "#f3dcb4", guests: [], show_cfm: false, cfm_no: null, tour_time: "12:40P", checkin_time: "12:10P" }, shuttle] : [shuttle]), block(42, "B", onB)],
    unplaced: { sections: un.length ? [sec(un, false)] : [], totals: { pax: un.reduce((a, g) => a + g.pax, 0), guests: un.length, boarded: 0, no_show: 0 }, empty_notes: false },
    totals: ctl.affiliate ? { pax: 14, guests: 6, boarded: 2, no_show: 0, pax_ours: 8, pax_farm_out: 6 } : { pax: 8, guests: 4, boarded: 2, no_show: 0 },
    ...(ctl.affiliate ? { affiliate: { sections: [{ key: "LOWER KEN'S 1:00PM", kind: "tour", title: "LOWER KEN'S 1:00PM", heading: "LOWER KEN'S 1:00PM {6}", pax: 6, color: "#bfe3b0",
      guests: [guest(71, "CHD71", { pax: 2, first_name: "Fran", last_name: "Affil", pickup_time: "7:30 AM", pickup_location: "Paris Las Vegas", bus_label: null }), guest(72, "CHD72", { pax: 4, first_name: "Gale", last_name: "Affil", pickup_time: "7:50 AM", pickup_location: "Venetian", bus_label: null })] }],
      totals: { pax: 6, guests: 2, boarded: 0, no_show: 0 }, empty_notes: true } } : {}),
    // G65：取消 / 改期留在名单上（不在车上、不算总数）。
    gone: [
      { id: 21, order_number: "CHD21", name: "ZZ Test Cancel", product: "Lower Antelope", pickup_time: "6:15 AM", pickup_location: "MGM Grand", bus_label: "A", pax: 0, was_pax: 3, sync_status: "cancelled", sync_note: "Cancelled in Rezdy (Oct 14, 8:12 PM)" },
      { id: 22, order_number: "CHD22", name: "ZZ Test Move", product: "Upper Antelope", pickup_time: "6:30 AM", pickup_location: "Excalibur", bus_label: null, pax: 0, was_pax: 2, sync_status: "moved", sync_note: "Moved to 10/15 South Rim" },
    ] };
}
const cards = [
  { manifest_id: 3, title: "Antelope Canyon", name: "Antelope Canyon", buses: 2, mode: "lettered", uploaded: true, pax: 8, guests: 4, not_on_bus: 2, gone_orders: 2, missing_orders: 1, lunch: { turkey: 3, veggie: 1, beef: 0 }, file_name: "ant.csv", uploaded_at: "2026-10-04T21:14:02+00:00", uploaded_by: "Annie" },
  { manifest_id: 5, title: "West Rim Bus Tour", name: "West Rim", buses: 0, mode: "none", uploaded: false },
  // 比 3 早传完：显示顺序（传完的排最后、按传完先后）里排在 3 前面。
  { manifest_id: 7, title: "Hoover Dam", name: "Hoover Dam", buses: 1, mode: "single", uploaded: true, pax: 4, guests: 2, not_on_bus: 0, lunch: null, file_name: "hd.csv", uploaded_at: "2026-10-04T20:00:00+00:00", uploaded_by: "Annie" },
];
// allUploaded：5 也传完（最晚），Step 1 下面出现 Completed（G33）。
const cardsNow = () => cards.map((c) => (c.manifest_id === 5 && ctl.allUploaded
  ? { ...c, buses: 1, mode: "single", uploaded: true, pax: 2, guests: 1, not_on_bus: 0, lunch: null, file_name: "west.csv", uploaded_at: "2026-10-05T01:00:00+00:00", uploaded_by: "Annie" }
  : c));
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { const b = JSON.parse(await readRaw(req)); if (b.version) { state.version = b.version; delete b.version; } Object.assign(ctl, b); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, q };
  log.push(entry);
  // partner（CCL）：Dispatch 的编辑勾了也只能看（PARTNER_HELD）；manifests.edit 按勾（后端 G177 P2）。partnerCodes 不给时没勾 manifests.edit。
  if (staffPerm(ctl, p, res, send)) return; // 10c：模拟员工权限总开关开着的员工 / Super Admin（staff-perm-mock.js）
  if (ctl.partner) {
    if (p === "/api/me") return send(res, 200, { id: 90, username: "ccl_ops", display_name: "CCL", initials: "CC", role: "partner", is_admin: false, is_superadmin: false, is_supervisor: false });
    if (p === "/api/settings/dashboard-widgets") return send(res, 200, { readable: true, widgets: [] });
    if (p === "/api/me/permissions") return send(res, 200, { is_superadmin: false, permissions: (ctl.partnerCodes || ["dispatch.view", "dispatch.edit", "dispatch.send", "manifests.view"]).map((code) => ({ code, module: code.split(".")[0], wired: true })), default_home: "/dispatch" });
  }
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: "staff", is_admin: false, is_superadmin: false });
  // 第二辆车的 ⇄ Farm out（preview 7uRp5FHfFTsnRYemrrm1Wf）：foVis = 开关 farm_out_dispatch 对我开着；foPartners = 合作公司；
  // foLocked = 别人正在改这一天（edit-lock 409 的原话）；foSaveFail = section 400 的原话。
  if (p === "/api/settings/dashboard-widgets" && ctl.foVis) return send(res, 200, { readable: true, widgets: [{ key: "farm_out_dispatch", label: "Dispatch · Farm out", visibility: "staff", default: "super_admin_only", visible_to_me: true }] });
  if (p === "/api/farm-out/partners") return send(res, 200, ctl.foPartners || []);
  if (p === "/api/dispatch/edit-lock" && req.method === "POST") {
    entry.body = JSON.parse(await readRaw(req));
    if (ctl.foLocked) return send(res, 409, { detail: ctl.foLocked });
    return send(res, 200, { token: "zz-lock", stale: false, version: "v1" });
  }
  if (p === "/api/dispatch/edit-lock/release") { entry.body = JSON.parse(await readRaw(req)); return send(res, 200, { released: true }); }
  if (p === "/api/dispatch/section" && req.method === "POST") {
    entry.body = JSON.parse(await readRaw(req));
    if (ctl.foSaveFail) return send(res, 400, { detail: ctl.foSaveFail });
    return send(res, 200, { ok: true, unit: entry.body.unit, saved: entry.body.rows.length, ids: entry.body.rows.map((_, i) => 500 + i), version: "v2", typed_alert: null, typed_names: [] });
  }
  if (p === "/api/dispatch/day" && ctl.foVis && !ctl.partner) {
    // 2026-10-05 团 3：两辆巴士团车（id 41 = A、42 = B，同 GET manifest 的 bus.id），再加一辆别的团的车（不该被送去）。
    const row = (id, label, manifest_id, driver) => ({ id, shift: "bus_tour", driver_hr_id: 7, driver_typed_name: null, vehicle_id: id, manifest_id, custom_tour_name: null, guide_hr_id: null, guide_typed_name: null, bus_label: label, note: "", location_ids: [3], driver_name: driver, guide_name: null, ccl: null });
    return send(res, 200, { run_date: q.date, today: q.date, rows: [row(41, "A", 3, "FREDDY"), row(42, "B", 3, "FREDDY"), row(43, "A", 9, "OTHER")], sections: [], orphans: [], drivers: [], vehicles: [], locations: [], tours: [], guides: [], copy_from: null, meta: { bus_tour_shift: "bus_tour" } });
  }
  if (p === "/api/dispatch/day") {
    const LA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
    const t = LA.format(new Date());
    const [y, m, d] = t.split("-").map(Number);
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    return send(res, 200, { run_date: q.date || tomorrow, today: t, rows: [], sections: [], orphans: [], drivers: [], vehicles: [], locations: [], tours: [], guides: [], copy_from: null });
  }
  if (p === "/api/dispatch/imports/day") return send(res, 200, { last_ok: "", prefill: null });
  if (p === "/api/dispatch/imports/pull") return send(res, 200, { status: "nothing", message: "Nothing new", last_ok: "" });
  if (p === "/api/dispatch/manifests") return send(res, 200, { run_date: q.date, cards: cardsNow(), guest_lists_done: ctl.done });
  // G56：Completed 之后的变化。pendingOff = 接口还没上线（404）。
  if (p === "/api/dispatch/pending") {
    if (ctl.pendingOff) return send(res, 404, { detail: "Not Found" });
    return send(res, 200, { run_date: q.date, items: ctl.pending });
  }
  if (p === "/api/dispatch/pending/handled") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.handledFail) return send(res, 400, { detail: ctl.handledFail });
    const before = ctl.pending.length;
    ctl.pending = b.all ? [] : ctl.pending.filter((it) => !(b.ids || []).includes(it.id));
    return send(res, 200, { ok: true, handled: before - ctl.pending.length });
  }
  if (p === "/api/dispatch/manifests/complete") {
    const raw = await readRaw(req);
    entry.date = /name="date"\r\n\r\n([\d-]+)/.exec(raw)?.[1];
    ctl.done = { completed_by: "Annie", completed_at: "2026-10-05T16:00:00+00:00" };
    return send(res, 200, { ok: true });
  }
  // manifestDelayMs：GET 慢一点回来，好看「存完到重读回来之间」页面是什么样子。
  if (p === "/api/dispatch/manifest") { if (ctl.manifestDelayMs) await new Promise((r) => setTimeout(r, ctl.manifestDelayMs)); return send(res, 200, view()); }
  // G35：排车页打开 / 换天先同步名单（form: date）。
  if (p === "/api/dispatch/manifests/sync") {
    const raw = await readRaw(req);
    entry.date = /name="date"\r\n\r\n([\d-]+)/.exec(raw)?.[1];
    if (ctl.syncFail) return send(res, 500, { detail: ctl.syncFail });
    if (ctl.syncPast) return send(res, 200, { ok: true, run_date: entry.date, synced: false, tours: [] });
    const t = (id, skipped = []) => ({ manifest_id: id, added: 0, removed: 0, changed: 0, rows: 4, pax: 8, changed_any: false, skipped_orders: skipped });
    return send(res, 200, { ok: true, run_date: entry.date, synced: true,
      tours: [t(3, ctl.syncSkipped ? ["CHD88", "CHD89"] : []), t(5), t(7)] });
  }
  // 同步失败时的后备：上传 Rezdy CSV（form: date, manifest_id, file）。文件名带 xlsx ⇒ 后端原话 400。
  if (p === "/api/dispatch/manifests/preview" || p === "/api/dispatch/manifests/apply") {
    const raw = await readRaw(req);
    entry.date = /name="date"\r\n\r\n([\d-]+)/.exec(raw)?.[1];
    entry.manifest_id = /name="manifest_id"\r\n\r\n(\d+)/.exec(raw)?.[1];
    entry.filename = /filename="([^"]+)"/.exec(raw)?.[1];
    if (/\.xlsx$/i.test(entry.filename || "")) return send(res, 400, { detail: "Only the CSV downloaded from Rezdy can be uploaded here. Download the tour's CSV from Rezdy and upload it as is. Excel files (.xlsx) are not accepted." });
    if (p.endsWith("/apply")) {
      if (ctl.applyFail) return send(res, 500, { detail: ctl.applyFail });
      return send(res, 200, { ok: true, rows: 5, pax: 11, added: 1, removed: 1, changed: 1 });
    }
    if (ctl.noChanges) return send(res, 200, { added: [], removed: [], changed: [], unchanged: 4, rows: 4, pax: 8, first_upload: false });
    return send(res, 200, {
      added: [{ order_number: "CHD50", name: "ZZ Test New <b>x</b>", pax: 3, product: "Lower Antelope", pickup_time: "6:15 AM", pickup_location: "MGM Grand" }],
      removed: [{ order_number: "CHD2", name: "ZZ Test2", pax: 2, product: "Lower Antelope", pickup_time: "6:15 AM", pickup_location: "Excalibur", bus_label: "A", boarding: "boarded" }],
      changed: [{ order_number: "CHD1", name: "ZZ Test1", pax: 4, product: "Lower Antelope", pickup_time: "6:15 AM", pickup_location: "Excalibur", changes: ["pax 2 → 4"] }],
      unchanged: 2, rows: 5, pax: 11, first_upload: false,
    });
  }
  if (p === "/api/dispatch/manifests/guest-bus") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.busFail) return send(res, 400, { detail: ctl.busFail });
    state.guests.find((g) => g.id === b.guest_id).bus_label = b.bus_label;
    return send(res, 200, { ok: true, id: b.guest_id, bus_label: b.bus_label });
  }
  if (p === "/api/dispatch/manifests/guest-notes" && ctl.notesEdit) {
    const b = JSON.parse(await readRaw(req)); entry.body = b; entry.method = req.method;
    if (ctl.notesFail) return send(res, 400, { detail: ctl.notesFail });
    // 后端 G125（cc2c43ec，tour_manifest.py）的两种 400，原话照抄：没带 notes 键；有看不见的控制字符（换行、Tab 照收）。
    if (!("notes" in b)) return send(res, 400, { detail: "Send the notes text, or null to restore the Rezdy text." });
    if (typeof b.notes === "string" && /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(b.notes))
      return send(res, 400, { detail: "The notes contain a hidden control character (often from copy and paste). Retype that part and save again." });
    const g = state.guests.find((x) => x.id === b.guest_id);
    if (!g) return send(res, 404, { detail: "Guest not found." });
    if (g._rezdy === undefined) g._rezdy = g.notes;
    if (b.notes === null) { g.notes = g._rezdy; g._edited = false; }
    else { g.notes = b.notes; g._edited = true; }
    // 后端回 {ok, id, notes, rezdy_notes, notes_edited, notes_check}（前端存完整页重读，不读这些）。
    return send(res, 200, { ok: true, id: g.id, notes: g.notes, rezdy_notes: g._rezdy, notes_edited: !!g._edited, notes_check: false });
  }
  if (p === "/api/dispatch/manifests/attraction") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    Object.assign(state.attraction, { checkin_time: b.checkin_time, pax_text: b.pax_text, tour_time: b.tour_time, confirmation_no: b.confirmation_no });
    return send(res, 200, { ok: true });
  }
  if (p === "/api/dispatch/manifests/text-size" && ctl.textSize) {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.textSizeFail) return send(res, 400, { detail: ctl.textSizeFail });
    // 同后端 manifest_text_size.clean（156ae23）：列键只认 MANIFEST_COLUMNS 的键 + lunch；整行只收这台车上现在的订单号。
    const COLS = ["order_number", "pickup_time", "pickup_location", "last_name", "first_name", "phone", "pax", "ticket", "notes", "boarding", "lunch"];
    if (Object.keys(b.text_size?.columns || {}).some((k) => !COLS.includes(k))) return send(res, 400, { detail: "That column is not on the manifest. Reload the page and try again." });
    const onBus = new Set(state.guests.filter((g) => (g.bus_label || "") === b.bus_label).map((g) => g.order_number));
    if (Object.keys(b.text_size?.rows || {}).some((k) => !onBus.has(k))) return send(res, 400, { detail: "That booking is not on this bus any more. Reload the page and try again." });
    state.textSize[b.bus_label] = b.text_size;
    state.textHistory = [{ by: "ZZ Test Staff", at: "just now", what: "Changed" }, ...state.textHistory].slice(0, 5);
    return send(res, 200, { ok: true, text_size: b.text_size, text_size_history: state.textHistory });
  }
  if (p === "/api/dispatch/manifest/version" && ctl.bmv) {
    const b = JSON.parse(await readRaw(req)); entry.body = b; entry.method = req.method;
    if (ctl.partner) return send(res, 403, { detail: "Partners can only view." });
    if (ctl.versionFail) return send(res, 400, { detail: ctl.versionFail });
    state.version = b.version;
    return send(res, 200, { ok: true, version: b.version });
  }
  if (p === "/admin/dispatch/manifest/guide") { res.setHeader("Content-Type", "text/html"); return res.end(`<html><title>GUIDE ${q.bus}</title><body>GUIDE</body></html>`); }
  if (p === "/admin/dispatch/manifest/print") { res.setHeader("Content-Type", "text/html"); return res.end(`<html><title>PRINT ${q.date} ${q.tour} ${q.bus ?? "all"}</title><body>PRINT</body></html>`); }
  if (p === "/admin/dispatch/manifest/download") {
    entry.body = await readRaw(req);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="manifest-antelope-canyon-2026-10-05.xlsx"');
    return res.end("PK");
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT || 8799), () => console.log("mf mock up"));
