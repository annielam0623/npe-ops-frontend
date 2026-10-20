// 模拟后端：Products 页的 Tour type 列（后端 manifests-fields 契约 E 及补充；auto-send 2026-10-15 加巴士团的 bus_tour_type）。
// 控制：POST /__ctl {fail401, failTour, failBusTour, noBus（后端还没上 auto-send：没有 bus_tour_types）, noTicket（只有 bus_tour_types）}；GET /__log。
// 原来的 products 套的模拟接口不返回 ticket_tour_type(s)，正好验证「后端还没上线时整列不显示」。
const http = require("http");
const ctl = { fail401: false, failTour: false, failBusTour: false, noBus: false, noTicket: false, failSection: false, noSectionTT: false };
const log = [];
const groups = [
  { id: 1, name: "upper_antelope", display_name: "Upper Antelope", booking_type: "bus_tour", is_active: true, sort_order: 1 },
  { id: 5, name: "tix_antelope", display_name: "Antelope Tickets", booking_type: "ticket", is_active: true, sort_order: 2 },
];
const TOUR_TYPES = [
  { key: "antelope", label: "Antelope Canyon" },
  { key: "brenda_a", label: "Brenda (Lower)" },
  { key: "brenda_b", label: "Brenda (Upper)" },
];
// 巴士团的 tour type（同人工发 Tour confirmation 弹窗那一份）。
const BUS_TOUR_TYPES = [
  { key: "grand_canyon_west", label: "Grand Canyon West Rim Bus Tour" },
  { key: "upper_antelope", label: "Upper Antelope Canyon Bus Tour" },
];
let products = [
  { id: 10, product_code: "UAC01", product_name: "Upper Antelope Bus", internal_name: "", manifest_id: 1, booking_type: "bus_tour", is_active: true, ticket_tour_type: null, bus_tour_type: null },
  { id: 20, product_code: "TIX01", product_name: "Antelope Tickets A", internal_name: "", manifest_id: 5, booking_type: "ticket", is_active: true, ticket_tour_type: "antelope", bus_tour_type: null },
  { id: 21, product_code: "TIX02", product_name: "Antelope Tickets B", internal_name: "", manifest_id: 5, booking_type: "ticket", is_active: true, ticket_tour_type: null, bus_tour_type: null },
  { id: 22, product_code: "TIX03", product_name: "Antelope Tickets C", internal_name: "", manifest_id: 5, booking_type: "ticket", is_active: true, ticket_tour_type: "gone_key", bus_tour_type: null },
  // 不是门票、还留着门票的旧值：现在显示巴士团的下拉（它自己的 bus_tour_type）。
  { id: 30, product_code: "OLDT", product_name: "Was a ticket", internal_name: "", manifest_id: null, booking_type: "bus_tour", is_active: true, ticket_tour_type: "brenda_a", bus_tour_type: "upper_antelope" },
  { id: 31, product_code: "BUS02", product_name: "Grand Canyon Bus", internal_name: "", manifest_id: 1, booking_type: "bus_tour", is_active: true, ticket_tour_type: null, bus_tour_type: null },
  // 班车：旧列里手填过的 bus_tour_type 不该显示（后端 G130 Safety rule）。
  { id: 33, product_code: "SHUT01", product_name: "Antelope Shuttle", internal_name: "", manifest_id: 1, booking_type: "shuttle", is_active: true, ticket_tour_type: null, bus_tour_type: "grand_canyon_west" },
  // 没分类的产品也算「不是门票」：巴士团的下拉。
  { id: 32, product_code: "NOCAT", product_name: "No category yet", internal_name: "", manifest_id: null, booking_type: null, is_active: true, ticket_tour_type: null, bus_tour_type: null },
];

// 后端 G130（migrate_v110）：Bus Manifest setup 里每节的默认 tour type；Products 页非门票产品的 Tour type 按它只读显示。
const setupGroup = {
  id: 1, display_name: "Upper Antelope", is_active: true, manifest_color: null, manifest_lunch_note: null, guests_per_bus: 54,
  forecast_split_sections: [], section_order: [], relay_round: "", extras: [],
  products: [
    { id: 10, manifest_id: 1, product_code: "UAC01", product_name: "Upper Antelope Bus", internal_name: "", is_active: true, manifest_section: "", manifest_section_kind: "tour", manifest_extra_id: null, return_pickup_time: "", return_pickup_place: "" },
    { id: 31, manifest_id: 1, product_code: "BUS02", product_name: "Grand Canyon Bus", internal_name: "", is_active: true, manifest_section: " lower ", manifest_section_kind: "tour", manifest_extra_id: null, return_pickup_time: "", return_pickup_place: "" },
    { id: 33, manifest_id: 1, product_code: "SHUT01", product_name: "Antelope Shuttle", internal_name: "", is_active: true, manifest_section: "SHUTTLE", manifest_section_kind: "outbound", manifest_extra_id: null, return_pickup_time: "", return_pickup_place: "" },
  ],
  section_tour_types: [{ section: "", tour_type: "upper_antelope" }, { section: "LOWER", tour_type: null }],
};
const entries = [
  { id: 2, entity_id: "30", label: "OLDT", action: "update", before: { bus_tour_type: null }, after: { bus_tour_type: "upper_antelope" }, actor: "annie", actor_name: "Annie Z", created_at: "2026-10-15T16:00:00+00:00" },
  { id: 1, entity_id: "20", label: "TIX01", action: "update", before: { ticket_tour_type: null }, after: { ticket_tour_type: "antelope" }, actor: "annie", actor_name: "Annie Z", created_at: "2026-10-07T16:00:00+00:00" },
];

const withGroup = (p) => {
  const g = groups.find((x) => x.id === p.manifest_id);
  return { ...p, group_name: g ? g.display_name : null, group_sort: g ? g.sort_order : null };
};
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
const validKey = (k) => k === null || TOUR_TYPES.some((t) => t.key === k);
const validBusKey = (k) => k === null || BUS_TOUR_TYPES.some((t) => t.key === k);

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, await readBody(req)); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, query: url.search };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: "admin", is_admin: true, is_superadmin: false });
  const B = "/api/settings/products";
  if (p === B && req.method === "GET")
    return send(res, 200, { products: products.map(withGroup).map(({ bus_tour_type, ...x }) => (ctl.noBus ? x : { ...x, bus_tour_type })) });
  if (p === `${B}/groups`)
    return send(res, 200, { groups, booking_types: ["bus_tour", "shuttle", "ticket", "unmapped"],
      ...(ctl.noTicket ? {} : { ticket_tour_types: TOUR_TYPES }), ...(ctl.noBus ? {} : { bus_tour_types: BUS_TOUR_TYPES }) });
  if (p === `${B}/missing`) return send(res, 200, { missing: [] });
  if (p === `${B}/log`) return send(res, 200, { entries, limit: 50 });
  if (p === "/api/settings/manifest-setup") {
    const kinds = [{ value: "tour", label: "Tour" }, { value: "outbound", label: "Shuttle outbound" }, { value: "inbound", label: "Shuttle inbound" }, { value: "roundtrip", label: "Shuttle round trip" }];
    if (ctl.noSectionTT) { const { section_tour_types, ...old } = setupGroup; void section_tour_types; return send(res, 200, { groups: [old], kinds, default_section: "BUS TOUR" }); }
    return send(res, 200, { groups: [setupGroup], kinds, default_section: "BUS TOUR", tour_types: BUS_TOUR_TYPES });
  }
  if (/^\/api\/settings\/manifest-setup\/groups\/1\/section-tour-type$/.test(p) && req.method === "PUT") {
    const body = await readBody(req);
    entry.body = body;
    await new Promise((r) => setTimeout(r, 200));
    if (ctl.failSection) return send(res, 400, { detail: "This section has no Tour products in this group." });
    if (body.tour_type && !validBusKey(body.tour_type)) return send(res, 400, { detail: "Unknown tour type." });
    const row = setupGroup.section_tour_types.find((x) => x.section === body.section);
    if (!row) return send(res, 400, { detail: "This section has no Tour products in this group." });
    row.tour_type = body.tour_type || null;
    return send(res, 200, { ok: true, section: body.section, tour_type: row.tour_type });
  }
  if (p === `${B}/bulk`) {
    const body = await readBody(req);
    entry.body = body;
    if ("ticket_tour_type" in body) {
      if ("manifest_id" in body || "booking_type" in body) return send(res, 400, { detail: "Change tour type on its own." });
      if (!validKey(body.ticket_tour_type)) return send(res, 400, { detail: "Unknown tour type." });
      const sel = products.filter((x) => body.ids.includes(x.id));
      if (body.ticket_tour_type !== null && sel.some((x) => x.booking_type !== "ticket")) return send(res, 400, { detail: "Only ticket products have a tour type." });
    }
    // 同后端（auto-send 契约）：bus_tour_type 规矩同 ticket_tour_type，两个不能一起带；设值时选中的有门票 ⇒ 整批 400。
    if ("bus_tour_type" in body) {
      if ("ticket_tour_type" in body || "manifest_id" in body || "booking_type" in body) return send(res, 400, { detail: "Change tour type on its own." });
      if (!validBusKey(body.bus_tour_type)) return send(res, 400, { detail: "Unknown tour type." });
      const sel = products.filter((x) => body.ids.includes(x.id));
      if (body.bus_tour_type !== null && sel.some((x) => x.booking_type === "ticket")) return send(res, 400, { detail: "Ticket products use the ticket tour type." });
    }
    let updated = 0, unchanged = 0;
    for (const id of body.ids) {
      const prod = products.find((x) => x.id === id);
      const before = JSON.stringify(prod);
      if ("manifest_id" in body) prod.manifest_id = body.manifest_id;
      if ("booking_type" in body) prod.booking_type = body.booking_type || null;
      if ("ticket_tour_type" in body) prod.ticket_tour_type = body.ticket_tour_type;
      if ("bus_tour_type" in body) prod.bus_tour_type = body.bus_tour_type;
      JSON.stringify(prod) === before ? unchanged++ : updated++;
    }
    return send(res, 200, { updated, unchanged, missing: 0 });
  }
  let m = p.match(/^\/api\/settings\/products\/(\d+)\/tour-type$/);
  if (m && req.method === "PATCH") {
    const body = await readBody(req);
    entry.body = body;
    await new Promise((r) => setTimeout(r, 200));
    const prod = products.find((x) => x.id === Number(m[1]));
    if (ctl.failTour) return send(res, 400, { detail: "Tour type rejected (mock)." });
    if (!validKey(body.ticket_tour_type)) return send(res, 400, { detail: "Unknown tour type." });
    if (body.ticket_tour_type !== null && prod.booking_type !== "ticket") return send(res, 400, { detail: "Only ticket products have a tour type." });
    prod.ticket_tour_type = body.ticket_tour_type;
    entries.unshift({ id: entries.length + 1, entity_id: String(prod.id), label: prod.product_code, action: "update", before: { ticket_tour_type: null }, after: { ticket_tour_type: body.ticket_tour_type }, actor: "zztest", actor_name: "ZZ Test", created_at: "2026-10-07T18:00:00+00:00" });
    return send(res, 200, { success: true, ticket_tour_type: body.ticket_tour_type });
  }
  m = p.match(/^\/api\/settings\/products\/(\d+)\/bus-tour-type$/);
  if (m && req.method === "PATCH") {
    const body = await readBody(req);
    entry.body = body;
    await new Promise((r) => setTimeout(r, 200));
    const prod = products.find((x) => x.id === Number(m[1]));
    if (ctl.failBusTour) return send(res, 400, { detail: "Bus tour type rejected (mock)." });
    if (!validBusKey(body.bus_tour_type)) return send(res, 400, { detail: "Unknown tour type." });
    if (body.bus_tour_type !== null && prod.booking_type === "ticket") return send(res, 400, { detail: "Ticket products use the ticket tour type." });
    entries.unshift({ id: entries.length + 1, entity_id: String(prod.id), label: prod.product_code, action: "update", before: { bus_tour_type: prod.bus_tour_type }, after: { bus_tour_type: body.bus_tour_type }, actor: "zztest", actor_name: "ZZ Test", created_at: "2026-10-15T18:00:00+00:00" });
    prod.bus_tour_type = body.bus_tour_type;
    return send(res, 200, { success: true, bus_tour_type: body.bus_tour_type });
  }
  m = p.match(/^\/api\/settings\/products\/(\d+)$/);
  if (m) {
    const body = await readBody(req);
    entry.body = body;
    Object.assign(products.find((x) => x.id === Number(m[1])), { ...body, booking_type: body.booking_type || null });
    return send(res, 200, { success: true });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("products tour-type mock on 8799"));
