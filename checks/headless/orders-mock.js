// 模拟后端：Orders。控制：POST /__ctl {fail401, failExport, partner}；GET /__log。
// partner = 勾了的项数组：/api/me 回 role=partner（ZZ Test Partner），/api/me/permissions 回这些项；null = 照旧（这些接口 404）。
const http = require("http");
const staffPerm = require("./staff-perm-mock");
const ctl = { fail401: false, failExport: false, partner: null };
const log = [];
const row = (i, o = {}) => ({ order_number: `CHDZZ${i}`, lane: "legacy", name: `ZZ Guest ${i}`, email: `g${i}@x`, phone: i % 2 ? "—" : `+1555${i}`, product_name: "Upper Antelope Bus Tour With Lunch And More", product_type: i % 3 === 0 ? "ticket" : "bus_tour", tour_date: "10/05/2026", pickup_time: "7:00 AM", pickup_location: "Aria", quantities: "2", agent_name: "Viator", source: "rezdy", created_at: "10/1/2026 9:00 AM", updated_at: "10/2/2026 9:00 AM", status: ["confirmed", "pending", "cancelled", "WEIRD"][i % 4], ...o });
const all = Array.from({ length: 70 }, (_, i) => row(i + 1));
const detail = {
  CHDTESTORDER1: {
    order_number: "CHDTESTORDER1", status: "confirmed", source: "excel", booking_type: "bus_tour", editable: true,
    guest: { name: "ZZ Test Guest", email: "zz@x", phone: "+1555", pax: 2 },
    product: { code: "UAC01", name: "Upper Antelope", type: "upper_antelope", tour_date: "10/05/2026", tour_time: "", pickup_time: "7:00 AM", pickup_location: "Aria", item_count: 2 },
    ops: { driver: "Bob", vehicle_no: "B1", driver_phone: "", agent_name: "Viator", confirmation_no: "C-1", tt_number: "", lunch_turkey: 1, lunch_veggie: 1, lunch_beef: 0 },
    price: { total_amount: 199.5, currency: "USD", total_paid: 199.5, total_due: 0, overridden: true },
    items_detail: [{ productName: "Upper Antelope", quantities: [{ optionLabel: "Adult", optionPrice: 99.75, value: 2 }], participants: [{ fields: [{ label: "Ticket Barcode", value: "ABCDEF123456" }, { label: "Name", value: "ZZ" }] }] }],
    order_detail: { resellerName: "Viator", commission: 20, paymentOption: "CC", resellerReference: "V-1", sourceChannel: "API", resellerComments: "<b>hi</b>" },
    special_requirements: "", notes: "", created_at: "10/1/2026", updated_at: "10/2/2026",
    activity_log: [{ id: 1, event_type: "field_updated", detail: "confirmation_no: 'C-0' → 'C-1'", actor: "annie", actor_type: "staff", created_at: "10/2/2026 9:00 AM" }],
    booking_notes: [],
  },
};
// G297：Notice 点进来的那一单（酒店空着）。
detail.CHDZZ8J8VYD = { ...detail.CHDTESTORDER1, order_number: "CHDZZ8J8VYD", editable: false, guest: { name: "ZZ Test Annie", email: "azhou@nationalparkexpress.com", phone: "+15550100000", pax: 2 }, product: { ...detail.CHDTESTORDER1.product, code: "GCW01", name: "Grand Canyon West Rim Bus Tour", type: "bus_tour", tour_date: "11/13/2026", pickup_location: "", pickup_time: "6:30 AM" } };
detail.CHDNODATE = { ...detail.CHDTESTORDER1, order_number: "CHDNODATE", product: { ...detail.CHDTESTORDER1.product, tour_date: "" } };
detail.CHDNEW = { ...detail.CHDTESTORDER1, order_number: "CHDNEW", editable: false, price: { ...detail.CHDTESTORDER1.price, overridden: false } };
// G280（后端 task/tripguru-intake 26fdfa29）：ctl.tripguru = 列表最前面两张 TripGuru 单（source tripguru、小写 status、pickup / agent「—」）。
const TG_ROWS = [
  { ...row(901), order_number: "NPE-ZZ1001", lane: "tripguru", source: "tripguru", status: "confirmed", name: "ZZ TripGuru One", phone: "+15550109001", product_name: "Grand Canyon West Rim Bus Tour", product_type: "bus_tour", pickup_time: "—", pickup_location: "—", agent_name: "—", quantities: "2" },
  { ...row(902), order_number: "NPE-ZZ1002", lane: "tripguru", source: "tripguru", status: "pending", name: "ZZ TripGuru Two", phone: "—", email: "tg2@x", product_name: "Antelope Canyon Tickets", product_type: "ticket", pickup_time: "—", pickup_location: "—", agent_name: "—", quantities: "3" },
];
detail["NPE-ZZ1001"] = {
  ...detail.CHDTESTORDER1, order_number: "NPE-ZZ1001", status: "confirmed", source: "tripguru", booking_type: "bus_tour", editable: false,
  guest: { name: "ZZ TripGuru One", email: "azhou@nationalparkexpress.com", phone: "+15550109001", pax: 2 },
  product: { code: "GCW01", name: "Grand Canyon West Rim Bus Tour", type: "bus_tour", tour_date: "11/12/2026", tour_time: "", pickup_time: "—", pickup_location: "—", item_count: 1 },
  ops: { driver: "", vehicle_no: "", driver_phone: "", agent_name: "", confirmation_no: "", tt_number: "", lunch_turkey: 0, lunch_veggie: 0, lunch_beef: 0 },
  price: { total_amount: 258, currency: "USD", total_paid: 258, total_due: 0, overridden: false },
  // 形状照后端 docs/integrations/tripguru-webhook-handoff-2026-11-10.md 第 2 节样例（35 转）：units {unitId, label, quantity}、startsAt / endsAt 带时区；
  // bookingFields / participants 形状未知，这里放一个通用键值的例子（真单到了再换）。
  items_detail: [{ itemId: "it-1", product: { id: "p-1", code: "GCW01", name: "Grand Canyon West Rim Bus Tour" }, selection: { kind: "timed", serviceDate: "2026-11-12", startsAt: "2026-11-12T07:30:00-08:00", endsAt: "2026-11-12T18:00:00-08:00", timezone: "America/Los_Angeles", option: { id: "o-1", code: "STD", name: "Standard" }, units: [{ unitId: "u-1", label: "Adult", quantity: 2 }] }, bookingFields: [{ key: "hotel", value: "ZZ Test Hotel" }], participants: [] }],
  order_detail: { orderNumber: "NPE-ZZ1001", status: "confirmed", resellerReference: "TG-ZZ-77", supplier: { internalNote: "ZZ Test internal note: guest asked for a window seat." }, notes: "Celebrating an anniversary" },
  special_requirements: "Celebrating an anniversary", notes: "", created_at: "11/10/2026", updated_at: "11/10/2026",
  activity_log: [], booking_notes: [],
};
// 没有内部备注（internalNote null）⇒ 详情不出 Internal note 卡。
detail["NPE-ZZ1002"] = { ...detail["NPE-ZZ1001"], order_number: "NPE-ZZ1002", status: "pending", order_detail: { ...detail["NPE-ZZ1001"].order_detail, orderNumber: "NPE-ZZ1002", supplier: { internalNote: null } } };

// Farm out（G40）：查单时两套上车资料；lead_with 由后端定（partner = 通知发出后到发车后 1 小时）。
const FV = { partner_pickup: { hotel: "Bellagio South Tour Lobby", checkin_time: "06:40", depart_time: "06:50" }, notice_sent_at: null, notice_sent_by: null };
detail.CHDFOP = { ...detail.CHDTESTORDER1, order_number: "CHDFOP", editable: false, farm_out_view: { ...FV, lead_with: "partner", notice_sent_at: "2026-10-15T18:12:00-07:00", notice_sent_by: "Annie" } };
detail.CHDFOO = { ...detail.CHDTESTORDER1, order_number: "CHDFOO", editable: false, farm_out_view: { ...FV, lead_with: "ours" } };

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
// 后端 G204（bd 0ee8d00）：partner 的订单详情各层（含嵌套）去掉代理商 / 佣金 / 付款这些 key，ops.agent_name 为 ""；列表 agent_name 为「—」。
const PARTNER_STRIP = ["resellerName", "commission", "paymentOption", "resellerReference", "resellerComments", "resellerAlias", "resellerId", "resellerSource", "resellerUser", "payments"];
function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !PARTNER_STRIP.includes(k)).map(([k, x]) => [k, strip(x)]));
  return v;
}
function forPartner(d) {
  return { ...d, order_detail: strip(d.order_detail), items_detail: strip(d.items_detail), ops: { ...d.ops, agent_name: "" } };
}
// 题 8（后端 36 task/agent-view）：没勾 orders.money_view ⇒ 详情 price = null、ops.agent_name = ""、去掉代理商 / 付款 / 金额；列表 agent_name「—」。
// ctl.keepMoney = true ⇒ 模拟旧后端（照样给），看前端自己藏不藏。
function lacksMoney() {
  if (ctl.keepMoney) return false;
  const ticks = ctl.staffPerms || ctl.partner;
  return Array.isArray(ticks) && !ctl.superAdmin && !ticks.includes("orders.money_view");
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") {
    Object.assign(ctl, await readBody(req));
    // G297：ctl.resetHotel ⇒ CHDZZ8J8VYD 的酒店重新变空（Refresh from Rezdy 会补上 Excalibur）。
    if (ctl.resetHotel) { detail.CHDZZ8J8VYD.product.pickup_location = ""; ctl.resetHotel = false; }
    return send(res, 200, ctl);
  }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, query: url.search };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (staffPerm(ctl, p, res, send)) return; // 10c：模拟员工权限总开关开着的员工 / Super Admin（staff-perm-mock.js）
  const q = url.searchParams;
  if (ctl.partner && p === "/api/me") {
    return send(res, 200, { id: 9, username: "zzpartner", display_name: "ZZ Test Partner", initials: "ZP", role: "partner", is_admin: false, is_superadmin: false, is_supervisor: false });
  }
  if (ctl.partner && p === "/api/settings/dashboard-widgets") {
    return send(res, 200, { widgets: [{ key: "staff_permissions", visibility: "super_admin_only", default: "super_admin_only", visible_to_me: false }] });
  }
  if (ctl.partner && p === "/api/me/permissions") {
    return send(res, 200, { is_superadmin: false, permissions: ctl.partner.map((code) => ({ code, module: code.split(".")[0], wired: true })), default_home: null });
  }
  if (p === "/api/operations/orders") {
    let rows = ctl.tripguru ? [...TG_ROWS, ...all] : all;
    // 置顶 75：q 以 TA- 开头 = 按 agent reference 搜（能看 agent 的人才对得上）：第一单带 reseller_reference + matched_agent_ref。
    if (q.get("q")?.startsWith("TA-")) rows = ctl.partner || lacksMoney() ? [] : [{ ...all[0], reseller_reference: "TA-55001", matched_agent_ref: true }];
    else if (q.get("q")) rows = rows.filter((r) => r.order_number.includes(q.get("q")) || r.name.toLowerCase().includes(q.get("q").toLowerCase()));
    if (q.get("date_to") === "2000-01-01") rows = [];
    const page = Number(q.get("page") || 1);
    let records = rows.slice((page - 1) * 50, page * 50);
    if (ctl.partner || lacksMoney()) records = records.map((r) => ({ ...r, agent_name: "—" }));
    return send(res, 200, { total: rows.length, page, pages: Math.ceil(rows.length / 50), records });
  }
  if (p === "/api/operations/orders/export") {
    if (ctl.failExport) return send(res, 500, { detail: "Internal Server Error" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="orders_2026-10-03.xlsx"');
    return res.end("XLSX");
  }
  let m = p.match(/^\/api\/operations\/orders\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const d = detail[id];
    // 置顶 51 B：ctl.mlinks = 新后端，详情带 manifest_links（一处）。
    const ml = ctl.mlinks ? { manifest_links: [{ date: "2026-10-03", tab: "bus", tab_label: "Bus Tour", pill: "g:3", pill_label: "Bryce & Zion", row_keys: [`${id}|PBZ|2026-10-03`] }] } : {};
    if (req.method === "GET") return d ? send(res, 200, { ...(lacksMoney() ? { ...forPartner(d), price: null } : ctl.partner ? forPartner(d) : d), ...ml }) : send(res, 404, { detail: "Order not found" });
    const body = await readBody(req);
    entry.body = body;
    if (!d.editable) return send(res, 409, { detail: "This order is stored in the new Rezdy table, which is read-only for now." });
    if (typeof body.lunch_turkey === "number" && body.lunch_turkey < 0) return send(res, 422, { detail: [{ loc: ["body", "lunch_turkey"], msg: "Input should be greater than or equal to 0" }] });
    if ("confirmation_no" in body) d.ops.confirmation_no = body.confirmation_no ?? "";
    for (const k of ["lunch_turkey", "lunch_veggie", "lunch_beef"]) if (k in body) d.ops[k] = body[k];
    let priced = false;
    for (const k of ["total_amount", "total_paid", "total_due", "currency"]) if (k in body) { d.price[k] = body[k]; priced = true; }
    if (priced) d.price.overridden = true;
    return send(res, 200, { updated: Object.keys(body).length, fields: Object.keys(body), price_overridden: priced });
  }
  // 置顶 111「Refresh from Rezdy」（后端 3e 形状）：ctl.refresh = updated | same | cancelled | not_applied | kept | 404 | 409feed | 409busy | 502 | 503 | 500；没设 = updated。
  m = p.match(/^\/api\/operations\/orders\/([^/]+)\/refresh-from-rezdy$/);
  if (m && req.method === "POST") {
    const id = decodeURIComponent(m[1]);
    const d = detail[id];
    const err = { 404: [404, "Order not found in Rezdy. Nothing was changed."], "409feed": [409, "This order is not in Order List's Rezdy feed, so it cannot be refreshed from Rezdy."], "409busy": [409, "A refresh for this order is already running. Please wait a moment."], 502: [502, "Could not reach Rezdy. Nothing was changed. Please try again in a minute."], 503: [503, "Refresh from Rezdy is not available right now. Nothing was changed."], 500: [500, "Could not save the update from Rezdy. Nothing was changed."] }[ctl.refresh];
    if (ctl.refreshDelay) await new Promise((r) => setTimeout(r, ctl.refreshDelay));
    if (err) return send(res, err[0], { detail: err[1] });
    const kind = ctl.refresh || "updated";
    const base = { order_number: id, rezdy_status: "CONFIRMED", kept: [] };
    if (kind === "same") return send(res, 200, { ...base, result: "updated", message: "Already up to date with Rezdy. Nothing changed.", changed: [] });
    if (kind === "not_applied") return send(res, 200, { ...base, result: "not_applied", rezdy_status: "PROCESSING", message: "Rezdy sent this order without its details (status PROCESSING). Nothing was changed.", changed: [] });
    if (kind === "cancelled") { d.status = "cancelled"; return send(res, 200, { ...base, result: "updated", rezdy_status: "CANCELLED", message: "This order is CANCELLED in Rezdy. Order List now shows it as cancelled.", changed: [{ field: "Status", before: "CONFIRMED", after: "CANCELLED" }] }); }
    if (kind === "kept") return send(res, 200, { ...base, result: "updated", message: "Updated from Rezdy: 1 field(s) changed. Rezdy has no phone for this order — kept the existing one.", changed: [{ field: "Email", before: "old@x", after: "new@x" }], kept: ["Phone"] });
    // G297：酒店空着的单 Refresh 后 Rezdy 补上了酒店。
    if (!d.product.pickup_location) {
      d.product = { ...d.product, pickup_location: "Excalibur" };
      return send(res, 200, { ...base, result: "updated", message: "Updated from Rezdy: 1 field(s) changed.", changed: [{ field: "Pickup location", before: null, after: "Excalibur" }] });
    }
    const before = d.guest.phone;
    d.guest = { ...d.guest, phone: "+15550109999" };
    d.activity_log = [{ id: 9001, event_type: "refreshed_from_rezdy", detail: `Refreshed from Rezdy — Phone: '${before}' → '+15550109999'`, actor: "ZZ Test Staff", actor_type: "staff", created_at: "11/9/2026 9:40 PM" }, ...(d.activity_log || [])];
    return send(res, 200, { ...base, result: "updated", message: "Updated from Rezdy: 2 field(s) changed.", changed: [{ field: "Phone", before, after: "+15550109999" }, { field: "Pickup time (P0ABCD)", before: null, after: "5:45 AM" }] });
  }
  // G297：Order 页「Send tour confirmation」。ctl.sendTour = sent | nohotel | 400 | failed；没设 = sent。
  if (p === "/api/manifests/send-tour-order" && req.method === "POST") {
    const body = await readBody(req);
    entry.body = body;
    if (ctl.sendDelay) await new Promise((r) => setTimeout(r, ctl.sendDelay));
    const kind = ctl.sendTour || "sent";
    if (kind === "400") return send(res, 400, { detail: `Order ${body.order_number} is not on the Main manifest for ${body.date}. Nothing was sent.` });
    const d = detail[body.order_number] || {};
    const name = d.guest?.name || "ZZ Test Guest";
    const g = { tour_type: "grand_canyon_west", batch_id: 701, total: 1, sent: 0, results: [], skipped: [], blocked: [] };
    if (kind === "nohotel") g.skipped.push({ order: body.order_number, order_number: body.order_number, name, reason: "no_pickup_location", message: "Pickup location is empty in Rezdy" });
    else if (kind === "failed") g.results.push({ order: body.order_number, name, email_status: "failed: SendGrid 550 mailbox unavailable", sms_status: "failed: Twilio 21211 invalid number" });
    else { g.sent = 1; g.results.push({ order: body.order_number, name, email_status: "sent", sms_status: "sent" }); }
    return send(res, 200, { checked_at: "2026-11-12T10:00:00-08:00", sent: g.sent, groups: [g] });
  }
  m = p.match(/^\/api\/operations\/orders\/([^/]+)\/unlock-price$/);
  if (m) { detail[decodeURIComponent(m[1])].price.overridden = false; return send(res, 200, { unlocked: true }); }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("orders mock on 8799"));
