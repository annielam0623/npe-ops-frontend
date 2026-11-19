// 模拟后端：dashboard 订单查询（Order lookup）。只连本机，绝不连真实后端。
// 控制：POST /__ctl {unauth, noMoney}；GET /__log 看请求。
// 置顶 75：ZZTEST3 / ZZTEST5 有 agent reference（TA-77812 / TA-77899）；q 对上它 ⇒ 行带 reseller_reference + matched_agent_ref。
// noMoney：这个员工没勾 orders.money_view（后端不按 agent ref 搜、不给号码；/api/me/permissions 只给 orders.view）。
const http = require("http");

// ⑦ G360 Tour ended：ctl.tourEnd = two（两站）/ one（只有一站，last_stop 同第一站）/ firstOnly（last_stop 是 null）/ none（都是 null）/ 没设 = 旧后端没这几个键。
function tourEnd(mode) {
  const ti = { tour_ended_at: "2026-10-21T01:36:00Z", tour_ended_where: "Treasure Island" };
  if (mode === "two") return { ...ti, last_stop_at: "2026-10-21T01:57:00Z", last_stop_where: "Excalibur" };
  if (mode === "one") return { ...ti, last_stop_at: ti.tour_ended_at, last_stop_where: ti.tour_ended_where };
  if (mode === "firstOnly") return { ...ti, last_stop_at: null, last_stop_where: "" };
  if (mode === "none") return { tour_ended_at: null, tour_ended_where: "", last_stop_at: null, last_stop_where: "" };
  return {};
}
const ctl = { unauth: false, mlinks: false, hold: false, noMoney: false, sa: false, lifeVis: null, lifeVisible: false };
// 订单生命周期（Annie 2026-11-18 排法 A + 框 1）：sa = 这个人是 Super Admin（没登记开关 ⇒ 默认 super_admin_only 看得到）；
// lifeVis / lifeVisible = 后端登记了 order_lifecycle（visibility + visible_to_me）。都没设 ⇒ 普通员工、开关没登记 ⇒ 看不到（页面同以前）。
// 置顶 51 B：mlinks 开着 = 新后端，订单详情带 manifest_links（ZZTEST1 分在两处、ZZTEST2 一处、其余 []）；hold = ZZTEST2 是 On Hold。
const MLINKS = {
  ZZTEST1: [
    { date: "2026-10-20", tab: "bus", tab_label: "Bus Tour", pill: "g:3", pill_label: "Bryce & Zion", row_keys: ["ZZTEST1|PBZ|2026-10-20"] },
    { date: "2026-10-20", tab: "tickets", tab_label: "Tickets - SelfDrive", pill: "t:antelope", pill_label: "Upper Antelope", row_keys: ["ZZTEST1|TIX1|2026-10-20"] },
  ],
  ZZTEST2: [{ date: "2026-10-21", tab: "tickets", tab_label: "Tickets - SelfDrive", pill: "t:antelope", pill_label: "Upper Antelope", row_keys: ["ZZTEST2|TIX1|2026-10-21"] }],
};
// 144：ZZTEST4 的 ref 含 5633（同事电话 7029855633 的后 4 位），电话搜不能因此对上。
const AGENT_REF = { ZZTEST3: "TA-77812", ZZTEST4: "855633-01", ZZTEST5: "TA-77899" };
const log = [];

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
    req.on("end", () => r(d ? JSON.parse(d) : null));
  });
}

function order(on, over = {}) {
  return {
    order_number: on, status: "Confirmed", source: "rezdy", booking_type: "bus_tour", editable: false,
    guest: { name: "ZZ Test Guest", email: "zz@example.com", phone: "+1 555 0100", pax: 2 },
    product: {
      code: "PBZ", name: "Bryce & Zion Day Tour", type: "", tour_date: "10/20/2026", tour_time: "6:00 AM",
      pickup_time: "5:45 AM", pickup_location: "ZZ Hotel Lobby", item_count: 1,
    },
    ops: {
      driver: "ZZ Driver", vehicle_no: "12", driver_phone: "", agent_name: "Viator", confirmation_no: "CF-1",
      tt_number: "", lunch_turkey: 1, lunch_veggie: 1, lunch_beef: 0,
    },
    price: { total_amount: 100, currency: "USD", total_paid: 100, total_due: 0, overridden: false },
    items_detail: null, order_detail: null, special_requirements: "", notes: "",
    created_at: "10/1/2026 9:00 AM", updated_at: "10/1/2026 9:00 AM", activity_log: [], booking_notes: [],
    ...over,
  };
}
const ORDERS = {
  ZZTEST1: order("ZZTEST1", {
    order_detail: { dateCreated: "2026-10-01T16:57:02Z" },
    // Chat history（订单详情接口 booking_notes，旧 → 新）：4 条 ⇒ 默认列最新 3 条 + Show all 4。
    booking_notes: [
      { id: 801, author: "kevin", direction: "sms_out", body: "Hi, your pickup tomorrow is 5:45 AM at the ZZ Hotel Lobby.", sms_status: "delivered", email_status: "", created_at: "10/19/2026 6:00 PM" },
      { id: 802, author: "", direction: "voice_in", body: "Hi, calling about tomorrow's pickup, can we bring a stroller?", sms_status: "", email_status: "", created_at: "10/19/2026 6:58 PM" },
      { id: 803, author: "", direction: "sms_in", channel: "whatsapp", body: "Can we bring a stroller?", sms_status: "", email_status: "", created_at: "10/19/2026 7:10 PM" },
      { id: 804, author: "annie", direction: "email_out", body: "Yes, strollers are fine.", sms_status: "", email_status: "sent", created_at: "10/19/2026 7:30 PM" },
    ],
    // 接口按时间新 → 旧。有意义的 4 条（guest_modify_requested / field_updated / refreshed_from_rezdy / booking_updated），系统记录 2 条。
    activity_log: [
      { id: 6, event_type: "guest_modify_requested", detail: "Guest asked to change pickup", actor: "Guest", actor_type: "guest", created_at: "10/18/2026 5:12 PM" },
      { id: 5, event_type: "field_updated", detail: "lunch_turkey: '0' → '1'", actor: "Annie Z", actor_type: "staff", created_at: "10/12/2026 3:40 PM" },
      { id: 4, event_type: "refreshed_from_rezdy", detail: "Refreshed from Rezdy — Phone: '+1 555 0000' → '+1 555 0100'; Email: '' → 'zz@example.com'", actor: "Annie Z", actor_type: "staff", created_at: "10/11/2026 9:00 AM" },
      // id 7：两分钟后又一次 Rezdy 推送（rezdy_changes 里没有）；rezdy_changes 那条 push 只配最近的 id 3，id 7 照旧出「Updated by Rezdy」。
      { id: 7, event_type: "booking_updated", detail: "Rezdy sync (webhook) — 1 item row(s), status CONFIRMED", actor: "rezdy", actor_type: "system", created_at: "10/10/2026 11:04 AM" },
      { id: 3, event_type: "booking_updated", detail: "Rezdy sync (webhook) — 1 item row(s), status CONFIRMED", actor: "rezdy", actor_type: "system", created_at: "10/10/2026 11:02 AM" },
      { id: 2, event_type: "booking_handled", detail: "Marked handled", actor: "system", actor_type: "system", created_at: "10/2/2026 8:00 AM" },
      { id: 1, event_type: "booking_created", detail: "Rezdy sync (webhook) — 1 item row(s), status CONFIRMED", actor: "rezdy", actor_type: "system", created_at: "10/1/2026 9:58 AM" },
    ],
    day_of_tour: [
      { tour_date: "2026-10-20", leg: "", product_code: "PBZ", product_name: "Bryce & Zion Day Tour",
        relay_mark: { value: "picked_up", label: "Picked up", by: "Jane D.", role: "relay", vehicle: "2101", at: "2026-10-20T12:50:00Z" }, relay_original: null,
        bus_mark: { value: "no_show", label: "No show", by: "Mike R.", role: "guide", vehicle: "3001", at: "2026-10-20T13:30:00Z" }, bus_original: null },
      // 回程那条不能用在 Relay / Bus 格子里。
      { tour_date: "2026-10-20", leg: "return", product_code: "PBZ", product_name: "Bryce & Zion Day Tour",
        relay_mark: null, relay_original: null,
        bus_mark: { value: "boarded", label: "Boarded", by: "WRONG", role: "guide", vehicle: "9999", at: "2026-10-21T02:00:00Z" }, bus_original: null },
    ],
    // bf 合同草稿：按单的答复 / 餐 + 餐厅 / 到站（ctl.noLifeKeys 模拟旧后端没有这三个键）。
    // bf 第 2 项：confirmations 也带门票行（module tickets_reminder）。
    confirmations: [
      // bf 第 2 项固定状态：send_state / sent_at / email_status / sms_status / sent_by。morning 行故意跟 send-log 不一样（kim 6:30）⇒ 看得出读的是这里。
      { module: "tour_confirmation", tour_date: "2026-10-20", status: "yes", submitted_at: "2026-10-18T22:31:00Z", lunch: null, lunch_by_guest: false, send_state: "sent", sent_at: "2026-10-18T21:05:00Z", email_status: "opened", sms_status: "delivered", sent_by: "veronica" },
      { module: "tickets_reminder", tour_date: "2026-10-20", status: "reschedule_req", submitted_at: "2026-10-19T17:00:00Z", lunch: null, lunch_by_guest: false, send_state: "unsent", sent_at: null, email_status: "", sms_status: "", sent_by: "" },
      { module: "morning_pickup", tour_date: "2026-10-20", status: "", submitted_at: null, lunch: null, lunch_by_guest: false, send_state: "sent", sent_at: "2026-10-20T01:30:00Z", email_status: "", sms_status: "delivered", sent_by: "kim" },
    ],
    lunch_by_day: [{ tour_date: "2026-10-20", product: "PBZ", bus_label: "A", has_lunch: true, turkey: 1, veggie: 1, beef: 0, defaulted: false, check: false, changed: false, text: "1 Turkey, 1 Veggie", restaurant: "ZZ Test Diner" }],
    live_by_day: [{ tour_date: "2026-10-20", live_status: "picked_up", live_status_at: "2026-10-20T12:50:00Z", live_driver: "Jane D.", live_van: "2101", arrived_at: "2026-10-20T12:44:00Z", left_at: "2026-10-20T12:53:00Z" }],
    // 生命周期第 2 项（bf 合同 rezdy_changes）：跨分钟也配（refresh 9:01:30 ↔ activity 9:00）。同一件事的 activity_log 那两条（id 4 refreshed_from_rezdy、id 3 booking_updated）是重复的，前端以这里为准。
    rezdy_changes: [
      { at: "2026-10-11T16:01:30Z", source: "refresh_from_rezdy", by: "Annie Z", changes: [{ field: "Email", before: "", after: "zz@example.com" }, { field: "Phone", before: "+1 555 0000", after: "+1 555 0100" }] },
      // 后端一条里按标签字母序存（Email < Phone、Item < Tour date）；前端排成固定顺序（Phone, Email / Tour date, Item）。
      { at: "2026-10-10T18:02:40Z", source: "rezdy_push", by: "", changes: [{ field: "Item PXTRA", before: null, after: "PXTRA" }, { field: "Tour date (PBZ)", before: "10/19/2026", after: "10/20/2026" }] },
    ],
  }),
  ZZTEST2: (() => {
    const o = order("ZZTEST2", { booking_type: "ticket" });
    o.guest = { ...o.guest, name: "ZZ Test Ticketholder", phone: "(702) 555-0199" };
    o.product = { ...o.product, name: "Upper Antelope Canyon", tour_date: "2026-10-21", pickup_time: "", pickup_location: "" };
    o.ops = { ...o.ops, driver: "", vehicle_no: "" };
    return o;
  })(),
  ZZTEST3: (() => {
    const o = order("ZZTEST3");
    o.product = { ...o.product, tour_date: "—" };
    return o;
  })(),
  ZZTEST4: (() => {
    const o = order("ZZTEST4", { status: "Cancelled" });
    o.product = { ...o.product, tour_date: "10/22/2026", item_count: 3 };
    return o;
  })(),
  ZZTEST5: (() => {
    const o = order("ZZTEST5");
    o.product = { ...o.product, tour_date: "10/23/2026" };
    return o;
  })(),
};

const conv = {
  notes_count: 0, latest_note_author: "", latest_note_body: "", latest_note_direction: "", latest_note_channel: "",
  notes_unhandled: false, wa_count: 0, latest_wa_author: "", latest_wa_body: "", latest_wa_direction: "", latest_wa_ts: "",
  wa_unhandled: false, wa_is_newer: false, wa_in_ts: "", wa_fallback: "", action_taken_by: "",
};
function tourRow(on, over = {}) {
  return {
    ...conv, id: 11, order_number: on, first_name: "ZZ", last_name: "Test", guest_name: "", email: "zz@example.com",
    phone: "+1 555 0100", quantities: 2, pickup_time: "5:45 AM", pickup_location: "ZZ Hotel Lobby", tour_date: "2026-10-20",
    tour_type: "bryce_zion", email_status: "sent", email_state: "opened", sms_status: "delivered", confirmation_status: "yes",
    lunch_turkey: 1, lunch_veggie: 1, lunch_beef: 0, notes: "", submission_count: 1, submitted_at: "10/18 3:12 PM",
    upload_row: null, mtlv_eligible: false, mtlv_qty: null, mtlv_ticket_status: null, mtlv_ticket_sent_by: "", mtlv_ticket_sent_at: "",
    ...over,
  };
}
function morningRow(on, over = {}) {
  return {
    ...conv, id: 21, order_number: on, name: "ZZ Test", phone: "+1 555 0100", email: "zz@example.com", quantities: 2,
    pickup_time: "5:45 AM", pickup_location: "ZZ Hotel Lobby", driver: "ZZ Driver", vehicle_no: "12", sms_status: "sent:SM1",
    email_state: "", checkin_status: "checked_in", checkin_time: "2026-10-20T12:47:00Z", agent_name: "", guest_viewed_at: null,
    ...over,
  };
}
function ticketRow(on, over = {}) {
  return {
    ...conv, id: 31, order_number: on, confirmation_no: "AC-77", guest_name: "ZZ Test", phone: "+1 555 0100", email: "zz@example.com",
    quantities: 2, tour_date: "2026-10-21", tour_type: "upper_antelope_tsosie", checkin_time: "9:30 AM", tour_time: "10:00 AM",
    email_status: "sent", email_state: "", sms_status: "delivered", confirmation_status: "pending", submitted_at: null,
    resubmitted: false, guest_notes: "", upload_row: null, ...over,
  };
}

// 每天三张表：别的单当陪衬（不能被挑出来）。
const OTHER = (date) => ({
  tour: [tourRow("OTHER1", { id: 99, tour_date: date })],
  tickets: [ticketRow("OTHER2", { id: 98, tour_date: date })],
  morning: [morningRow("OTHER3", { id: 97 })],
});
const DAYS = {
  "2026-10-20": {
    tour: [
      tourRow("zztest1", {
        notes_count: 2, latest_note_author: "", latest_note_body: "Can we bring a stroller?", latest_note_direction: "sms_in",
        latest_note_channel: "sms", notes_unhandled: true,
      }),
    ],
    morning: [morningRow("ZZTEST1", { arrived_at: "2026-10-20T12:45:00Z", left_at: "2026-10-20T12:52:00Z" })],
  },
  "2026-10-21": {
    tickets: [ticketRow("ZZTEST2", { contact_changed: true, guest_notes: "Arriving late", notes_count: 0, checkin_location: "Tse Bighanilini Tours, Highway 98, Milepost 299.8, Page, AZ 86040 (Between 299 and 300)" })],
  },
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      Object.assign(ctl, (await readBody(req)) || {});
      log.length = 0;
      return send(res, 200, ctl);
    }
    log.push({ method: req.method, path: p, query: url.search });
    if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("<h1>LEGACY LOGIN</h1>"); }
    if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.sa ? "admin" : "staff", is_admin: !!ctl.sa, is_superadmin: !!ctl.sa });
    if (p === "/api/settings/dashboard-widgets" && ctl.lifeVis)
      return send(res, 200, { readable: true, widgets: [{ key: "order_lifecycle", label: "Order lifecycle", visibility: ctl.lifeVis, default: "super_admin_only", visible_to_me: !!ctl.lifeVisible }] });
    // 生命周期：send-log 按单号是「包含」匹配（ZZTEST10 也会回来，前端要精确过滤）；tour_date 不是这天的（改期前）不算。
    if (p === "/api/notifications/send-log") {
      const q = (url.searchParams.get("order_number") || "").toUpperCase();
      const all = [
        { sent_at: "2026-10-17T20:00:00Z", module: "tour_confirmation", order_number: "ZZTEST1", tour_date: "2026-10-20", sent_by: "kevin", sms_status: "delivered", email_status: "sent" },
        { sent_at: "2026-10-18T21:05:00Z", module: "tour_confirmation", order_number: "ZZTEST1", tour_date: "2026-10-20", sent_by: "veronica", sms_status: "delivered", email_status: "opened", sms_channel: "sms", delivered_at: "2026-10-18T21:05:30Z", opened_at: "2026-10-18T22:00:00Z" },
        { sent_at: "2026-10-19T00:00:00Z", module: "tour_confirmation", order_number: "ZZTEST1", tour_date: "2026-10-15", sent_by: "OLDDATE", sms_status: "delivered", email_status: "sent" },
        { sent_at: "2026-10-19T23:00:00Z", module: "tour_confirmation", order_number: "ZZTEST10", tour_date: "2026-10-20", sent_by: "WRONGORDER", sms_status: "delivered", email_status: "sent" },
        { sent_at: "2026-10-19T02:30:00Z", module: "last_minute", order_number: "ZZTEST1", tour_date: "2026-10-20", sent_by: "kevin", sms_status: "delivered", email_status: "" },
        { sent_at: "2026-10-20T01:00:00Z", module: "morning_pickup", order_number: "ZZTEST1", tour_date: "2026-10-20", sent_by: "scheduler", sms_status: "delivered", email_status: "sent" },
        { sent_at: "2026-10-19T16:00:00Z", module: "tickets_reminder", order_number: "ZZTEST2", tour_date: "2026-10-21", sent_by: "scheduler", sms_status: "delivered", email_status: "sent" },
      ].map((r) => ({ first_name: "ZZ", last_name: "Test", email: "", phone: "", tour_type: "", error_msg: null, mtlv_eligible: false, ...r }));
      // 同后端：sent_at 新 → 旧，按 page_size 截。
      // order_exact=true（bf 合同草稿）⇒ 精确匹配；ctl.containsOnly 模拟还没上的后端（照旧「包含」）。
      const exact = url.searchParams.get("order_exact") === "true" && !ctl.containsOnly;
      const matched = all.filter((r) => (exact ? r.order_number.toUpperCase() === q : r.order_number.toUpperCase().includes(q))).sort((a, b) => b.sent_at.localeCompare(a.sent_at));
      const rows = matched.slice(0, Number(url.searchParams.get("page_size")) || 100);
      return send(res, 200, { total: matched.length, page: 1, stats: {}, rows });
    }
    if (p === "/api/me/permissions" && ctl.noMoney) return send(res, 200, { is_superadmin: false, permissions: [{ code: "orders.view", module: "orders", wired: true }], default_home: null });
    if (p.startsWith("/api/user-prefs/")) return send(res, 200, { key: p.split("/").pop(), value: null });
    if (p === "/api/notifications/unhandled") return send(res, 200, { today: "2026-10-20", window_end: "10:30 AM", count: 0, lanes: { morning: [], tour: [], tickets: [], multi: [] } });
    if (p === "/api/notifications/tour-confirmation/tour-types") return send(res, 200, [{ key: "bryce_zion", abbr: "BZ", label: "Bryce & Zion", has_lunch: true, has_beef: false, lunch_group: "BZ" }]);
    if (p === "/api/broadcasting-log") return send(res, 200, { rows: [] });

    // 订单列表搜索（同后端 _SEARCH_COLS：单号、名、姓、邮箱、电话、产品名逐列 ILIKE）。
    if (p === "/api/operations/orders") {
      if (ctl.unauth) return send(res, 401, { detail: "Not authenticated" });
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const rows = Object.values(ORDERS).map((o) => {
        const [first, ...rest] = o.guest.name.split(" ");
        return {
          cols: [o.order_number, first, rest.join(" "), o.guest.email, o.guest.phone, o.product.name],
          rec: {
            order_number: o.order_number, lane: "rezdy_new", name: o.guest.name, email: o.guest.email, phone: o.guest.phone,
            product_name: o.product.name, product_type: o.booking_type, tour_date: o.product.tour_date, pickup_time: o.product.pickup_time || "—",
            pickup_location: o.product.pickup_location || "—", quantities: "2", agent_name: "Viator", source: "rezdy",
            created_at: "10/1/2026 9:00 AM", updated_at: "10/1/2026 9:00 AM", status: o.status,
          },
        };
      });
      const hits = rows
        .map((r) => {
          const ref = ctl.noMoney ? "" : AGENT_REF[r.rec.order_number] || "";
          const byRef = !!q && !!ref && ref.toLowerCase().includes(q);
          const byCol = !q || r.cols.some((c) => String(c).toLowerCase().includes(q));
          if (!byCol && !byRef) return null;
          return ctl.noMoney ? r.rec : { ...r.rec, reseller_reference: ref || "—", matched_agent_ref: byRef && !byCol };
        })
        .filter(Boolean);
      return send(res, 200, { total: hits.length, page: 1, pages: 1, records: hits });
    }
    const m = /^\/api\/operations\/orders\/([^/]+)$/.exec(p);
    if (m) {
      if (ctl.unauth) return send(res, 401, { detail: "Not authenticated" });
      const on = decodeURIComponent(m[1]);
      if (on === "ZZFAIL") return send(res, 500, { detail: "mock order failure" });
      if (!ORDERS[on]) return send(res, 404, { detail: "Order not found" });
      const o = { ...ORDERS[on], ...(ctl.hold && on === "ZZTEST2" ? { status: "On Hold" } : {}) };
      // ⑦ G360：每次请求按 ctl.tourEnd 给 live_by_day 加回程到站（ORDERS 是启动时建好的）。
      if (o.live_by_day) o.live_by_day = o.live_by_day.map((x) => ({ ...x, ...tourEnd(ctl.tourEnd) }));
      // multiDay：2 日团第 1 天大巴不回 LV（null），第 2 天回程才有；sameDay：同一天两行，一行空、一行有（空的在前）。
      if (o.live_by_day && (ctl.tourEnd === "multiDay" || ctl.tourEnd === "sameDay")) {
        const d1 = { ...o.live_by_day[0], ...tourEnd("none") };
        const back = { ...o.live_by_day[0], ...tourEnd("two") };
        o.live_by_day = ctl.tourEnd === "multiDay"
          ? [{ ...back, tour_date: "2026-10-21", tour_ended_at: "2026-10-22T01:10:00Z", tour_ended_where: "Excalibur Hotel", last_stop_at: null, last_stop_where: "" }, d1]
          : [d1, back];
      }
      // G351（后端 4aea93a5）：Refresh 的 activity_log 对 partner 不能看的字段只写「Internal notes (Rezdy): changed」。
      // 这两条没配上 rezdy_changes（partner 那份去掉了），照 activity_log 文字解析：changed 在最后 / 在前面两种。
      // 后端（PASS 时建议）：按「: changed」后缀认、不按字段名 ⇒ 另放一条假字段 Foo。
      if (ctl.g351 && on === "ZZTEST1") o.activity_log = [
        { id: 13, event_type: "refreshed_from_rezdy", detail: "Refreshed from Rezdy — Email: 'a@example.com' → 'b@example.com'; Foo: changed", actor: "Annie Z", actor_type: "staff", created_at: "10/19/2026 10:00 AM" },
        { id: 12, event_type: "refreshed_from_rezdy", detail: "Refreshed from Rezdy — Internal notes (Rezdy): changed; Phone: '+1 555 0100' → '+1 555 0200'", actor: "Annie Z", actor_type: "staff", created_at: "10/19/2026 9:00 AM" },
        { id: 11, event_type: "refreshed_from_rezdy", detail: "Refreshed from Rezdy — Status: 'CONFIRMED' → 'ON_HOLD'; Internal notes (Rezdy): changed", actor: "Annie Z", actor_type: "staff", created_at: "10/19/2026 8:00 AM" },
        ...o.activity_log,
      ];
      return send(res, 200, ctl.mlinks ? { ...o, manifest_links: MLINKS[on] ?? [] } : o);
    }
    const date = url.searchParams.get("date");
    const merge = (lane) => [...OTHER(date)[lane], ...((DAYS[date] || {})[lane] || [])];
    if (p === "/api/notifications/tour-confirmation/tracking") {
      if (date === "2026-10-23") return send(res, 500, { detail: "mock tour tracking failure" });
      return send(res, 200, { date, rows: merge("tour") });
    }
    if (p === "/api/notifications/tickets-reminder/tracking") return send(res, 200, { date, rows: merge("tickets") });
    if (p === "/api/notifications/morning-pickup/tracking") {
      return send(res, 200, { date, tracking_window: { end_minute: 630, end_label: "10:30 AM" }, rows: merge("morning") });
    }
    return send(res, 404, { detail: "Not Found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("os mock on", process.env.MOCK_PORT || 8799));
