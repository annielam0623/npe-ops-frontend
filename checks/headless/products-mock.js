// 模拟后端：Products 页。控制：POST /__ctl {fail401, staff, failMissing}；GET /__log。
const http = require("http");
const ctl = { fail401: false, staff: false, failMissing: false, slowNextProductPut: 0, slowNextGroupPut: 0, noRelay: false, relayFail: false, failSection: 0, categories: false, forecastSettings: false, forecastFail: "" };
// 7 Days Forecast 设置（后端 G63）：团 1 有主块和单独成块的 SUNSET。
let fcNextId = 600;
const fc = {
  blocks: [
    { manifest_id: 1, section: "", name: "Upper Antelope", rows: ["UPPER", "LOWER", "X"] },
    { manifest_id: 1, section: "SUNSET", name: "Upper Antelope · SUNSET", rows: ["SUNSET"] },
    { manifest_id: 2, section: "", name: "Other tour", rows: ["TOUR"] },
    { manifest_id: 7, section: "", name: "Private", rows: ["BUS TOUR"] },
  ],
  run_days: [{ manifest_id: 1, section: "", weekdays: [1, 2, 3, 4, 5, 6] }],
  closed_dates: [{ id: 501, manifest_id: 1, section: "", date_from: "2026-11-26", date_to: "2026-11-26", note: "ZZ Test holiday" }],
  allotments: [
    { id: null, manifest_id: 1, row_label: "UPPER", section: "", time_label: "12:40p", max_pax: 30, date_from: null, date_to: null },
    { id: 502, manifest_id: 1, row_label: "LOWER", section: "", time_label: "11a", max_pax: 20, date_from: "2026-11-20", date_to: "2026-11-30" },
  ],
  unmatched: [
    { kind: "allotment", manifest_id: 1, section: null, row_label: "VIP LOWER", id: null, date_from: null, label: 'Max allotments for "VIP LOWER" (25, 11a)' },
  ],
  order_detail_blocks: [],
};
const log = [];
const groups = [
  { id: 1, name: "upper_antelope", display_name: "Upper Antelope", booking_type: "bus_tour", is_active: true, sort_order: 1 },
  { id: 2, name: "shuttle_lv", display_name: "LV Shuttle", booking_type: "shuttle", is_active: true, sort_order: 2 },
  { id: 3, name: "old", display_name: "Old Group", booking_type: null, is_active: false, sort_order: 3 },
];
let products = [
  { id: 10, product_code: "UAC01", product_name: "Upper Antelope Bus", internal_name: "UA Bus", manifest_id: 1, booking_type: "bus_tour", is_active: true },
  { id: 11, product_code: "UAC02", product_name: "Upper Antelope VIP", internal_name: "", manifest_id: 1, booking_type: null, is_active: true },
  { id: 12, product_code: "SHT01", product_name: "LV Shuttle <b>x</b>", internal_name: "", manifest_id: 2, booking_type: "shuttle", is_active: true },
  { id: 13, product_code: "PFYF01", product_name: "", internal_name: "", manifest_id: null, booking_type: null, is_active: false },
  { id: 14, product_code: "LEG01", product_name: "Legacy", internal_name: "", manifest_id: null, booking_type: "weird_old", is_active: true },
];
let nextId = 100;
let nextExtraId = 50;
const missing = [
  { product_code: "NEW01", product_name: "ZZ Test New Tour", upcoming_rows: 5, total_rows: 7, first_date: "2026-10-05", last_date: "2026-11-02" },
  { product_code: "NEW02", product_name: "ZZ Test Fails", upcoming_rows: 2, total_rows: 2, first_date: "2026-10-09", last_date: "2026-10-09" },
  { product_code: "OLD01", product_name: "", upcoming_rows: 0, total_rows: 3, first_date: "2025-06-01", last_date: "2025-08-01" },
];
const setup = {
  groups: [{ id: 1, display_name: "Upper Antelope", is_active: true, manifest_color: "#8db76f", manifest_lunch_note: null,
    guests_per_bus: 54, forecast_split_sections: [], section_order: [], relay_round: "relay",
    counters: [], extras: [{ id: 5, name: "HELI", seats: 12 }],
    products: [{ id: 10, manifest_id: 1, product_code: "UAC01", product_name: "Upper Antelope Bus", internal_name: "UA Bus", is_active: true, manifest_section: "", manifest_section_kind: "tour", manifest_extra_id: null, return_pickup_time: "", return_pickup_place: "" },
      { id: 11, manifest_id: 1, product_code: "UAC02", product_name: "Upper Antelope VIP", internal_name: "", is_active: true, manifest_section: "", manifest_section_kind: "tour", manifest_extra_id: null, return_pickup_time: "", return_pickup_place: "" }] }],
  kinds: [{ value: "tour", label: "Tour" }, { value: "outbound", label: "Shuttle outbound" }, { value: "inbound", label: "Shuttle inbound" }, { value: "roundtrip", label: "Shuttle round trip" }],
  default_section: "BUS TOUR",
  // 后端 7c 减 15：Morning Relay 第几轮按团设。ctl.noRelay = 后端还没上线（没有这两个键）。
  relay_rounds: [{ value: "", label: "Not on Morning Relay" }, { value: "relay", label: "1st Round" }, { value: "relay_2", label: "2nd Round" }],
};
// 第二个团（同线上：Private 是 manifests.id 7、bus_tour、没有单独成块）——测切换团后 Forecast 设置 9–11 跟着换（Annie 10-15 说 Private 里看不到第 11 项）。
setup.groups.push({ id: 7, display_name: "Private", is_active: true, manifest_color: null, manifest_lunch_note: null,
  guests_per_bus: 54, forecast_split_sections: [], section_order: [], relay_round: "",
  counters: [], extras: [], products: [] });
const entries = [
  { id: 1, entity_id: "10", label: "UAC01", action: "update", before: { internal_name: "", manifest_id: 3, booking_type: null }, after: { internal_name: "UA Bus", manifest_id: 1, booking_type: "bus_tour" }, actor: "annie", actor_name: "Annie Z", created_at: "2026-10-02T16:00:00+00:00" },
];

const withGroup = (p) => {
  const g = groups.find((x) => x.id === p.manifest_id);
  return { ...p, group_name: g ? g.display_name : null, group_sort: g ? g.sort_order : null };
};
const categories = [
  { code: "bus_tour", display_name: "Bus Tour", is_builtin: true, is_active: true },
  { code: "shuttle", display_name: "Shuttle", is_builtin: true, is_active: true },
  { code: "ticket", display_name: "Ticket", is_builtin: true, is_active: true },
  { code: "unmapped", display_name: "Unmapped", is_builtin: true, is_active: true },
];

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d ? JSON.parse(d) : null));
  });
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
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.staff ? "staff" : "admin", is_admin: !ctl.staff, is_superadmin: false });
  const B = "/api/settings/products";
  if (p === B && req.method === "GET") {
    const sorted = [...products].map(withGroup).sort((a, b) => (a.group_sort ?? 99) - (b.group_sort ?? 99) || a.product_name.localeCompare(b.product_name));
    return send(res, 200, { products: sorted });
  }
  // Categories（后端 G141 实际形状）：清单随 GET /groups 下发（见下）；code 正则同后端；内置四个不能停用；没有删除。
  if (p === `${B}/categories` && req.method === "POST") {
    if (!ctl.categories) return send(res, 404, { detail: "Not Found" });
    const body = await readBody(req);
    entry.body = body;
    if (typeof body.code !== "string" || !/^[a-z][a-z0-9_]{1,19}$/.test(body.code.trim())) return send(res, 400, { detail: "Code must be lowercase letters, numbers and underscores only, starting with a letter, 2-20 characters (for example chd_fee). It cannot be changed later." });
    if (typeof body.display_name !== "string" || !body.display_name.trim()) return send(res, 400, { detail: "Display name is required. It is the name staff see in the Category list." });
    if (categories.some((c) => c.code === body.code.trim())) return send(res, 400, { detail: "Someone else just added a category with that code. Reload the page." });
    const created = { code: body.code.trim(), display_name: body.display_name.trim().replace(/\s+/g, " "), is_builtin: false, is_active: true };
    categories.push(created);
    return send(res, 200, created);
  }
  const catActive = p.match(/^\/api\/settings\/products\/categories\/([^/]+)$/);
  if (catActive && req.method === "PATCH") {
    const body = await readBody(req);
    entry.body = body;
    const c = categories.find((x) => x.code === decodeURIComponent(catActive[1]));
    if (!c) return send(res, 400, { detail: "That category does not exist any more. Reload the page." });
    if (c.is_builtin) return send(res, 400, { detail: `"${c.display_name}" is a built-in category and cannot be deactivated.` });
    if (typeof body.is_active !== "boolean") return send(res, 400, { detail: "Active must be yes or no. Reload the page and try again." });
    c.is_active = body.is_active;
    return send(res, 200, c);
  }
  // Groups 管理（后端 85a5d95）：显示名不分大小写不能重复；Short name / Category 建了不能改；没有删除。
  if (p === `${B}/groups` && req.method === "POST") {
    const body = await readBody(req);
    entry.body = body;
    if (!/^[A-Za-z0-9]+$/.test(body.name || "")) return send(res, 400, { detail: "Short name: letters and numbers only, no spaces." });
    if (!body.booking_type) return send(res, 400, { detail: "Pick a category." });
    if (groups.some((g) => g.display_name.toLowerCase() === String(body.display_name).trim().toLowerCase())) return send(res, 400, { detail: `A group called "${body.display_name}" already exists.` });
    const g = { id: Math.max(...groups.map((x) => x.id)) + 1, name: body.name, display_name: String(body.display_name).trim(), booking_type: body.booking_type, is_active: true, sort_order: body.sort_order ?? Math.max(...groups.map((x) => x.sort_order)) + 1 };
    groups.push(g);
    groups.sort((a, b) => a.sort_order - b.sort_order);
    return send(res, 200, g);
  }
  const gm = p.match(/^\/api\/settings\/products\/groups\/(\d+)$/);
  if (gm && req.method === "PATCH") {
    const body = await readBody(req);
    entry.body = body;
    const g = groups.find((x) => x.id === Number(gm[1]));
    if ("name" in body || "booking_type" in body) return send(res, 400, { detail: "Short name and Category cannot be changed." });
    if ("sort_order" in body && !Number.isInteger(body.sort_order)) return send(res, 400, { detail: "Order must be a whole number from 0 to 9999." });
    if ("display_name" in body && groups.some((x) => x.id !== g.id && x.display_name.toLowerCase() === String(body.display_name).trim().toLowerCase())) return send(res, 400, { detail: `A group called "${body.display_name}" already exists.` });
    Object.assign(g, body);
    groups.sort((a, b) => a.sort_order - b.sort_order);
    return send(res, 200, g);
  }
  if (p === `${B}/groups`) {
    const active = (ctl.categories ? categories : categories.slice(0, 4)).filter((c) => c.is_active).map((c) => c.code).sort();
    return send(res, 200, ctl.categories ? { groups, booking_types: active, categories } : { groups, booking_types: active });
  }
  if (p === `${B}/missing`) return ctl.failMissing ? send(res, 500, { detail: "boom" }) : send(res, 200, { missing });
  if (p === `${B}/log`) return send(res, 200, { entries, limit: 50 });
  if (p === B && req.method === "POST") {
    const body = await readBody(req);
    entry.body = body;
    if (body.product_code === "NEW02") return send(res, 400, { detail: `"NEW02" is already in the list.` });
    products.push({ id: nextId++, product_code: body.product_code, product_name: body.product_name, internal_name: body.internal_name, manifest_id: body.manifest_id, booking_type: body.booking_type || null, is_active: true });
    return send(res, 200, { id: nextId - 1, product_code: body.product_code });
  }
  if (p === `${B}/bulk`) {
    const body = await readBody(req);
    entry.body = body;
    let updated = 0, unchanged = 0;
    for (const id of body.ids) {
      const prod = products.find((x) => x.id === id);
      const before = JSON.stringify(prod);
      if ("manifest_id" in body) prod.manifest_id = body.manifest_id;
      if ("booking_type" in body) prod.booking_type = body.booking_type || null;
      JSON.stringify(prod) === before ? unchanged++ : updated++;
    }
    return send(res, 200, { updated, unchanged, missing: 0 });
  }
  let m = p.match(/^\/api\/settings\/products\/(\d+)$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    entry.at = Date.now();
    if (ctl.slowNextProductPut) {
      const ms = ctl.slowNextProductPut;
      ctl.slowNextProductPut = 0;
      await new Promise((r) => setTimeout(r, ms));
    }
    entry.doneAt = Date.now();
    if (body.internal_name.length > 100 || body.internal_name === "FAIL") return send(res, 400, { detail: "Internal name is too long - the limit is 100." });
    Object.assign(products.find((x) => x.id === Number(m[1])), { ...body, booking_type: body.booking_type || null });
    return send(res, 200, { success: true });
  }
  m = p.match(/^\/api\/settings\/products\/(\d+)\/active$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    products.find((x) => x.id === Number(m[1])).is_active = body.active;
    return send(res, 200, { success: true, is_active: body.active });
  }
  const S = "/api/settings/manifest-setup";
  if (p === S) {
    if (!ctl.noRelay) return send(res, 200, setup);
    const { relay_rounds, ...old } = setup;
    void relay_rounds;
    return send(res, 200, { ...old, groups: old.groups.map(({ relay_round, ...g }) => (void relay_round, g)) });
  }
  m = p.match(/^\/api\/settings\/manifest-setup\/groups\/(\d+)\/relay-round$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    if (!["relay", "relay_2", ""].includes(body.relay_round)) return send(res, 400, { detail: "Pick 1st Round, 2nd Round or Not on Morning Relay." });
    if (ctl.relayFail) return send(res, 400, { detail: "Only admins can change the Morning Relay round." });
    setup.groups[0].relay_round = body.relay_round || null;
    // 同后端 put_relay_round（9102912）：清空时回 ""（GET 里是 null）。
    return send(res, 200, { ok: true, relay_round: body.relay_round || "" });
  }
  m = p.match(/^\/api\/settings\/manifest-setup\/groups\/(\d+)$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    entry.at = Date.now();
    if (ctl.slowNextGroupPut) {
      const ms = ctl.slowNextGroupPut;
      ctl.slowNextGroupPut = 0;
      await new Promise((r) => setTimeout(r, ms));
    }
    entry.doneAt = Date.now();
    if (body.lunch_note.includes("\n") || body.lunch_note === "BAD") return send(res, 400, { detail: "The lunch sheet line can only contain ordinary characters on one line." });
    // 同后端 clean_guests_per_bus：不在 payload 里 = 不改；1–99 的整数，否则 400。
    if ("guests_per_bus" in body && !(/^\d+$/.test(String(body.guests_per_bus).trim()) && +body.guests_per_bus >= 1 && +body.guests_per_bus <= 99))
      return send(res, 400, { detail: "Guests per bus must be a whole number between 1 and 99." });
    setup.groups[0].manifest_color = body.color || null;
    setup.groups[0].manifest_lunch_note = body.lunch_note;
    if ("guests_per_bus" in body) setup.groups[0].guests_per_bus = +body.guests_per_bus;
    return send(res, 200, { ok: true, manifest_color: body.color || null, manifest_lunch_note: body.lunch_note, guests_per_bus: setup.groups[0].guests_per_bus });
  }
  m = p.match(/^\/api\/settings\/manifest-setup\/groups\/(\d+)\/forecast-split-sections$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    const out = body.sections.map((s) => s.trim()).filter(Boolean);
    if (out.some((s) => s.toLowerCase() === "bus tour")) return send(res, 400, { detail: "BUS TOUR is the main part of the tour - it cannot be its own block." });
    setup.groups[0].forecast_split_sections = out;
    return send(res, 200, { ok: true, sections: out });
  }
  // Section order（后端 G50）：整组替换；不分大小写不能重复，最多 20 个。
  m = p.match(/^\/api\/settings\/manifest-setup\/groups\/(\d+)\/section-order$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    const out = body.sections.map((s) => s.trim()).filter(Boolean);
    const seen = new Set();
    for (const s of out) {
      if (seen.has(s.toLowerCase())) return send(res, 400, { detail: `${s} is in the list twice.` });
      seen.add(s.toLowerCase());
    }
    if (out.length > 20) return send(res, 400, { detail: "At most 20 sections can be put in order per tour." });
    setup.groups[0].section_order = out;
    return send(res, 200, { ok: true, sections: out });
  }
  // Extra（后端 ad8b7ab）：整组送，没送回来的删掉、挂着它的产品变回 Tour；座位 1–999；同团不分大小写不能重名。
  m = p.match(/^\/api\/settings\/manifest-setup\/groups\/(\d+)\/extras$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    const names = new Set();
    for (const x of body.extras) {
      if (!/^\d+$/.test(String(x.seats)) || +x.seats < 1 || +x.seats > 999) return send(res, 400, { detail: `${x.name}: seats must be a whole number between 1 and 999.` });
      if (names.has(x.name.toLowerCase())) return send(res, 400, { detail: `Two extras are called ${x.name}. Give each one its own name.` });
      names.add(x.name.toLowerCase());
    }
    const g = setup.groups[0];
    g.extras = body.extras.map((x) => ({ id: x.id ?? ++nextExtraId, name: x.name, seats: +x.seats }));
    const ids = new Set(g.extras.map((x) => x.id));
    for (const pr of g.products) if (pr.manifest_extra_id !== null && !ids.has(pr.manifest_extra_id)) pr.manifest_extra_id = null;
    return send(res, 200, { ok: true, extras: g.extras });
  }
  m = p.match(/^\/api\/settings\/manifest-setup\/products\/(\d+)$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    const sec = body.section.trim().toUpperCase();
    if (ctl.failSection && Number(m[1]) === ctl.failSection) return send(res, 400, { detail: "Section name already used by another group." });
    const pr = setup.groups[0].products.find((x) => x.id === Number(m[1])) ?? setup.groups[0].products[0];
    if (body.extra_id != null && body.kind !== "tour") return send(res, 400, { detail: "Only a Tour product can have an extra." });
    Object.assign(pr, { manifest_section: sec, manifest_section_kind: body.kind });
    if ("extra_id" in body) pr.manifest_extra_id = body.extra_id;
    // G36：回程接客时间 / 地点，不传 = 不改；同后端去掉首尾空格。
    if ("return_pickup_time" in body) pr.return_pickup_time = String(body.return_pickup_time).trim();
    if ("return_pickup_place" in body) pr.return_pickup_place = String(body.return_pickup_place).trim();
    return send(res, 200, { ok: true, section: sec, kind: body.kind, extra_id: pr.manifest_extra_id, return_pickup_time: pr.return_pickup_time, return_pickup_place: pr.return_pickup_place });
  }
  // ── 7 Days Forecast 设置（后端 G63，admin）。ctl.forecastSettings = false：后端还没上线（404），面板不显示 9–11。──
  if (p.startsWith("/api/settings/forecast")) {
    if (!ctl.forecastSettings) return send(res, 404, { detail: "Not Found" });
    if (ctl.staff) return send(res, 403, { detail: "Admin access required" });
    const F = fc;
    if (p === "/api/settings/forecast" && req.method === "GET") {
      return send(res, 200, F);
    }
    const body = req.method === "GET" || req.method === "DELETE" ? null : await readBody(req);
    entry.body = body;
    if (ctl.forecastFail) return send(res, 400, { detail: ctl.forecastFail });
    if (p === "/api/settings/forecast/run-days" && req.method === "PUT") {
      F.run_days = F.run_days.filter((r) => !(r.manifest_id === body.manifest_id && r.section === body.section));
      if (body.weekdays.length < 7) F.run_days.push({ manifest_id: body.manifest_id, section: body.section, weekdays: body.weekdays });
      F.unmatched = F.unmatched.filter((u) => !(u.kind === "run_days" && u.manifest_id === body.manifest_id && u.section === body.section));
      return send(res, 200, { ok: true });
    }
    if (p === "/api/settings/forecast/closed-dates" && req.method === "POST") {
      const id = ++fcNextId;
      F.closed_dates.push({ id, ...body });
      return send(res, 200, { ok: true, id });
    }
    let fm = p.match(/^\/api\/settings\/forecast\/closed-dates\/(\d+)$/);
    if (fm && req.method === "DELETE") {
      F.closed_dates = F.closed_dates.filter((c) => c.id !== +fm[1]);
      return send(res, 200, { ok: true });
    }
    if (p === "/api/settings/forecast/allotments" && req.method === "PUT") {
      F.allotments = F.allotments.filter((a) => !(a.date_from === null && a.manifest_id === body.manifest_id && a.row_label.toLowerCase() === body.row_label.toLowerCase()));
      F.allotments.push({ id: null, manifest_id: body.manifest_id, row_label: body.row_label, section: "", time_label: body.time_label, max_pax: body.max_pax, date_from: null, date_to: null });
      return send(res, 200, { ok: true });
    }
    if (p === "/api/settings/forecast/allotments" && req.method === "DELETE") {
      const mid = +url.searchParams.get("manifest_id");
      const row = url.searchParams.get("row_label");
      F.allotments = F.allotments.filter((a) => !(a.date_from === null && a.manifest_id === mid && a.row_label.toLowerCase() === row.toLowerCase()));
      F.unmatched = F.unmatched.filter((u) => !(u.kind === "allotment" && !u.date_from && u.manifest_id === mid && u.row_label === row));
      return send(res, 200, { ok: true });
    }
    if (p === "/api/settings/forecast/allotments/dates" && req.method === "POST") {
      const clash = F.allotments.find((a) => a.date_from && a.manifest_id === body.manifest_id && a.row_label === body.row_label && a.date_from <= body.date_to && body.date_from <= a.date_to);
      if (clash) return send(res, 400, { detail: `${body.row_label} already has a different cap from ${clash.date_from} to ${clash.date_to}.` });
      const id = ++fcNextId;
      F.allotments.push({ id, manifest_id: body.manifest_id, row_label: body.row_label, section: "", time_label: body.time_label, max_pax: body.max_pax, date_from: body.date_from, date_to: body.date_to });
      return send(res, 200, { ok: true, id });
    }
    fm = p.match(/^\/api\/settings\/forecast\/allotments\/dates\/(\d+)$/);
    if (fm && req.method === "DELETE") {
      F.allotments = F.allotments.filter((a) => a.id !== +fm[1]);
      return send(res, 200, { ok: true });
    }
    if (p === "/api/settings/forecast/order-detail" && req.method === "PUT") {
      F.order_detail_blocks = body.blocks;
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { detail: "mock: not found" });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("products mock on", process.env.MOCK_PORT || 8799));
