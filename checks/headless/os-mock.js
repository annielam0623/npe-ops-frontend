// 模拟后端：dashboard 订单查询（Order lookup）。只连本机，绝不连真实后端。
// 控制：POST /__ctl {unauth}；GET /__log 看请求。
const http = require("http");

const ctl = { unauth: false };
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
  ZZTEST1: order("ZZTEST1"),
  ZZTEST2: (() => {
    const o = order("ZZTEST2", { booking_type: "ticket" });
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
    morning: [morningRow("ZZTEST1")],
  },
  "2026-10-21": {
    tickets: [ticketRow("ZZTEST2", { guest_notes: "Arriving late", notes_count: 0, checkin_location: "Tse Bighanilini Tours, Highway 98, Milepost 299.8, Page, AZ 86040 (Between 299 and 300)" })],
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
    if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: "staff", is_admin: false, is_superadmin: false });
    if (p.startsWith("/api/user-prefs/")) return send(res, 200, { key: p.split("/").pop(), value: null });
    if (p === "/api/notifications/unhandled") return send(res, 200, { today: "2026-10-20", window_end: "10:30 AM", count: 0, lanes: { morning: [], tour: [], tickets: [], multi: [] } });
    if (p === "/api/notifications/tour-confirmation/tour-types") return send(res, 200, [{ key: "bryce_zion", abbr: "BZ", label: "Bryce & Zion", has_lunch: true, has_beef: false, lunch_group: "BZ" }]);
    if (p === "/api/broadcasting-log") return send(res, 200, { rows: [] });

    const m = /^\/api\/operations\/orders\/([^/]+)$/.exec(p);
    if (m) {
      if (ctl.unauth) return send(res, 401, { detail: "Not authenticated" });
      const on = decodeURIComponent(m[1]);
      if (on === "ZZFAIL") return send(res, 500, { detail: "mock order failure" });
      return ORDERS[on] ? send(res, 200, ORDERS[on]) : send(res, 404, { detail: "Order not found" });
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
  .listen(8799, () => console.log("os mock on 8799"));
