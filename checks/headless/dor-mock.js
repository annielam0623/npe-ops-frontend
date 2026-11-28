// 模拟后端：Daily Operation Report（形状按后端设计稿 §3 / §11，2026-10-24；最终样例出来后核对字段名）。
// 控制：POST /__ctl {supervisor, superadmin, partner, tick: {switchOn, codes}, putFail, visible, widgets404, reports403, notifyOff, notifyError, noUpdates, reset}；GET /__log。
const http = require("http");
const { permsBody } = require("./role-standard");

const ctl = { supervisor: true, superadmin: false, putFail: false, visible: true, widgets404: false, reports403: false, notifyOff: true, notifyError: false };
const log = [];

const PEOPLE = [
  { id: 7, username: "annie", display_name: "Annie" },
  { id: 8, username: "lizzie", display_name: "Lizzie" },
  { id: 9, username: "jing", display_name: "Jing" },
];
const person = (id) => PEOPLE.find((p) => p.id === id) || null;

function seed() {
  return [
    { id: 1, report_type: "accident", complaint_about: null, headline: "Bus 3", order_number: null, subject_name: null,
      what_happened: "ZZ Minor scrape in the hotel driveway.", status: "in_progress", follow_up: person(7),
      created_by: person(7), created_at: "2026-10-24T07:05:12-07:00", updated_at: "2026-10-24T07:20:40-07:00", resolved_at: null, resolved_by: null,
      details: { occurred_at: "2026-10-24T06:50:00-07:00", location: "Hotel driveway", vehicle_no: "Bus 3", driver_name: "Sample driver", injuries: "None", police_report: "no" } },
    { id: 2, report_type: "complaint", complaint_about: "driver", headline: "Sample driver", order_number: "CHDABC123", subject_name: "Sample driver",
      what_happened: "ZZ Guest says the bus left before the scheduled time.", status: "open", follow_up: null,
      created_by: person(8), created_at: "2026-10-24T08:12:00-07:00", updated_at: "2026-10-24T08:12:00-07:00", resolved_at: null, resolved_by: null, details: {} },
    { id: 3, report_type: "complaint", complaint_about: "itinerary", headline: "Antelope Canyon day tour", order_number: "CHDXYZ789", subject_name: "Antelope Canyon day tour",
      what_happened: "ZZ Guest asked for a refund: the Slot Canyon stop was too short.", status: "open", follow_up: person(8),
      created_by: person(8), created_at: "2026-10-24T09:40:00-07:00", updated_at: "2026-10-24T09:41:00-07:00", resolved_at: null, resolved_by: null, details: {} },
    { id: 4, report_type: "emergency", complaint_about: null, headline: "Two guests, Hoover Dam stop", order_number: null, subject_name: "Two guests, Hoover Dam stop",
      what_happened: "ZZ Guest felt faint at the stop, resolved after rest.", status: "resolved", follow_up: person(9),
      created_by: person(9), created_at: "2026-10-22T10:00:00-07:00", updated_at: "2026-10-22T11:00:00-07:00", resolved_at: "2026-10-22T11:00:00-07:00", resolved_by: "jing", details: {} },
  ];
}
// Updates（G224）：只能加，从旧到新。
function seedUpdates() {
  return [
    { id: 1, report_id: 1, text: "ZZ Called the hotel, no damage to their gate.", created_at: "2026-10-24T07:30:00-07:00", created_by: person(7) },
    { id: 2, report_id: 1, text: "ZZ Photos sent to the insurance company.\nWaiting for reply.", created_at: "2026-10-24T09:05:00-07:00", created_by: person(9) },
  ];
}
// G361 No show：ctl {ns: true} 时多一份 No show（id 5，Morning Tracking 建的，Farm out）；不开 = 旧套不受影响。
function seedNoShow() {
  return { id: 5, report_type: "no_show", complaint_about: null, headline: "ZZ Test Guest", order_number: "CHDNS0001", subject_name: "ZZ Test Guest",
    what_happened: "", status: "open", follow_up: null, created_by: person(8), created_at: "2026-11-26T07:42:00-08:00", updated_at: "2026-11-26T07:42:00-08:00",
    resolved_at: null, resolved_by: null,
    details: { tour_date: "2026-11-26", product_code: "GCW01", product_name: "Grand Canyon West Rim Day Tour", pickup_location: "Circus Circus",
      driver_name: "ZZ Test Driver", guide_name: "ZZ Test Guide", vehicle: "Bus 1328", reported_by: "office", reason: "wrong_pickup_info", source: "tracking", farm_out: true } };
}
let contacts = [];
let nextContactId = 1;
// 改期新单 CHDNS0009：ctl.nsBoarded = 新单已上车（ready_to_close）。
const PREFILL = {
  CHDNS0001: [
    { tour_date: "2026-11-26", product_code: "GCW01", product_name: "Grand Canyon West Rim Day Tour", guest_name: "ZZ Test Guest", pickup_location: "Circus Circus", driver_name: "ZZ Test Driver", guide_name: "ZZ Test Guide", vehicle: "Bus 1328", farm_out: true, on_main_manifest: true },
  ],
  CHDNS0002: [
    { tour_date: "2026-11-26", product_code: "GCW01", product_name: "Grand Canyon West Rim Day Tour", guest_name: "ZZ Two Days", pickup_location: "Excalibur", driver_name: "ZZ Test Driver", guide_name: "", vehicle: "Bus 1328", farm_out: false, on_main_manifest: true },
    { tour_date: "2026-11-27", product_code: "HD01", product_name: "Hoover Dam Tour", guest_name: "ZZ Two Days", pickup_location: "Excalibur", driver_name: "", guide_name: "", vehicle: "", farm_out: false, on_main_manifest: true },
  ],
};
let updates = seedUpdates();
let nextUpdateId = 3;
let reports = seed();
let nextId = 5;
const tokens = new Map();

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function raw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
function counts(items) {
  const c = { complaint: 0, accident: 0, emergency: 0, no_show: 0, total: items.length };
  items.forEach((r) => (c[r.report_type] += 1));
  return c;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") {
    const body = JSON.parse((await raw(req)) || "{}");
    if (body.reset) { reports = seed(); nextId = 5; updates = seedUpdates(); nextUpdateId = 3; tokens.clear(); log.length = 0; contacts = []; nextContactId = 1; }
    if (body.ns) { reports = reports.filter((r) => r.id !== 5).concat(seedNoShow()); nextId = Math.max(nextId, 6); }
    Object.assign(ctl, body, { reset: undefined });
    return send(res, 200, ctl);
  }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, query: url.search };
  log.push(entry);

  if (ctl.tick && p === "/api/me/permissions")
    return send(res, 200, { is_superadmin: false, permissions: ctl.tick.codes.map((code) => ({ code, module: code.split(".")[0], wired: true })), default_home: "/dashboard" });
  // 只看勾（2026-11-01）：没设 tick 时按角色标准回（partner 不在这里回，照旧 404 = 什么都不给）。
  if (p === "/api/me/permissions" && !ctl.partner)
    return send(res, 200, permsBody(ctl.superadmin ? "superadmin" : ctl.supervisor ? "supervisor" : "staff"));
  if (p === "/api/me")
    return send(res, 200, { id: 8, username: "lizzie", display_name: "Lizzie", initials: "L", role: ctl.partner ? "partner" : ctl.supervisor ? "supervisor" : "staff", is_admin: ctl.superadmin, is_superadmin: ctl.superadmin, is_supervisor: ctl.supervisor });

  if (p === "/api/settings/dashboard-widgets") {
    if (ctl.widgets404) return send(res, 404, { detail: "Not Found" });
    if (req.method === "PUT") {
      const body = JSON.parse(await raw(req));
      entry.body = body;
      if (!ctl.superadmin) return send(res, 403, { detail: "Super Admin access required." });
      if (ctl.putFail) return send(res, 500, { detail: "mock save failed" });
      // 三档：存请求里的那一档（staff / admin / super_admin_only）。
      ctl.visible = body.widgets?.daily_operation_report ?? ctl.visible;
    }
    // 后端：Super Admin 永远 visible_to_me=true；其他人看开关。
    // ctl.visible：true = staff、false = super_admin_only，或者 PUT 存下的那一档。
    const dorVis = ctl.visible === true ? "staff" : ctl.visible === false ? "super_admin_only" : ctl.visible;
    return send(res, 200, { readable: true, widgets: [{ key: "daily_operation_report", label: "Daily Operation Report", visibility: dorVis, default: "super_admin_only", visible_to_me: dorVis === "staff" || ctl.superadmin },
      // 统计行（本批新板块，默认只 Super Admin）：这套检查要看里面的 Open reports，当作已放给员工。
      { key: "dashboard_stats", label: "Today at a glance", visibility: "staff", default: "super_admin_only", visible_to_me: true },
      // 全部按照勾选：ctl.tick = { switchOn, codes } 时回员工权限总开关。
      ...(ctl.tick ? [{ key: "staff_permissions", label: "Staff permissions (ops gating)", visibility: ctl.tick.switchOn ? "staff" : "super_admin_only", default: "super_admin_only", visible_to_me: !!ctl.tick.switchOn }] : [])] });
  }

  if (p.startsWith("/api/operation-reports")) {
    if (ctl.reports403) return send(res, 403, { detail: "This section is not available yet." });
    if (p === "/api/operation-reports/assignees") return send(res, 200, { users: PEOPLE });
    // G361：No show 带出（后端契约 §4）。
    if (p === "/api/operation-reports/no-show/prefill") {
      const o = (url.searchParams.get("order_number") || "").toUpperCase();
      const days = PREFILL[o] || [];
      return send(res, 200, { order_number: o, found: days.length > 0, days });
    }
    // G361 N6：这单以前的记录。ctl.noOrdersView = 没有 orders.view ⇒ 不带 staff_notes / no_show_marks。
    if (p === "/api/operation-reports/order-context") {
      const o = (url.searchParams.get("order_number") || "").toUpperCase();
      const mine = reports.filter((r) => r.order_number === o || r.details?.new_order_number === o).sort((a, b) => b.id - a.id)
        .map((r) => ({ ...r, updates: updates.filter((u) => u.report_id === r.id), rescheduled_into_this_order: r.order_number !== o }));
      const out = { order_number: o, reports: mine };
      if (!ctl.noOrdersView && o === "CHDNS0001") {
        out.staff_notes = [{ id: 31, order_number: o, product_code: "GCW01", body: "ZZ Guest asked to change pickup to Circus Circus. The phone line gave Resorts World before, please double check with the guest.", source: "tracking", author: { username: "lizzie", display_name: "Lizzie" }, created_at: "2026-11-25T15:00:00-08:00" }];
        out.no_show_marks = [{ tour_date: "2026-11-26", col: "bus", source: "field", by: "ZZ Test Driver", at: "2026-11-26T07:40:00-08:00" }];
      } else if (!ctl.noOrdersView) { out.staff_notes = []; out.no_show_marks = []; }
      return send(res, 200, out);
    }
    const mc = p.match(/^\/api\/operation-reports\/(\d+)\/contacts$/);
    if (mc && req.method === "POST") {
      const body = JSON.parse((await raw(req)) || "{}");
      entry.body = body;
      if (ctl.partner) return send(res, 403, { detail: "Partners can read reports but cannot add contacts." });
      const r = reports.find((x) => x.id === Number(mc[1]));
      if (!r || r.report_type !== "no_show") return send(res, 400, { detail: "Contact attempts are only for No show reports." });
      const missing = ["method", "contacted_at", "reached"].filter((k) => body[k] === undefined || body[k] === "");
      if (body.reached && !body.guest_said) missing.push("guest_said");
      if (missing.length) return send(res, 400, { detail: "Please fill in: " + missing.join(", "), missing });
      const LBL = { phone: "Phone", text: "Text", whatsapp: "WhatsApp", email: "Email", in_person: "In person" };
      const c = { id: nextContactId++, report_id: r.id, method: body.method, method_label: LBL[body.method], contacted_at: body.contacted_at, reached: body.reached,
        guest_said: body.guest_said || null, created_at: "2026-11-26T10:41:00-08:00", created_by: { username: "lizzie", display_name: "Lizzie" } };
      contacts.push(c);
      return send(res, 201, { contact: c });
    }
    let m = p.match(/^\/api\/operation-reports\/(\d+)$/);
    if (m && req.method === "GET") {
      const r = reports.find((x) => x.id === Number(m[1]));
      if (!r) return send(res, 404, { detail: "That report does not exist." });
      const mine = updates.filter((u) => u.report_id === r.id);
      // 加过 Updates 的，修改记录里多一条 add_update（changes 为空，前端不显示）。
      const added = mine.map((u) => ({ at: u.created_at, by: u.created_by.display_name, action: "add_update", changes: [] }));
      const extras = r.report_type !== "no_show" ? {} : (() => {
        const no = r.details.new_order_number;
        const resched = no ? { order_number: no, found: no === "CHDNS0009", tour_date: no === "CHDNS0009" ? "2026-11-29" : null, status: no === "CHDNS0009" ? "Confirmed" : "", live: no === "CHDNS0009", boarded: !!ctl.nsBoarded } : null;
        return { contacts: contacts.filter((c) => c.report_id === r.id), rescheduled: resched, ready_to_close: r.status === "waiting_reschedule" && !!resched && resched.boarded && resched.live };
      })();
      return send(res, 200, { report: r, history: [{ at: r.created_at, by: "Annie", action: "create", changes: [] }, ...(r.status !== "open" ? [{ at: r.updated_at, by: "Annie", action: "update", changes: [{ field: "status", from: "open", to: r.status }] }] : []), ...added], ...(ctl.noUpdates ? {} : { updates: mine }), ...extras });
    }
    const mu = p.match(/^\/api\/operation-reports\/(\d+)\/updates$/);
    if (mu && req.method === "POST") {
      const body = JSON.parse((await raw(req)) || "{}");
      entry.body = body;
      if (ctl.partner) return send(res, 403, { detail: "Partners can read reports but cannot add updates." });
      const r = reports.find((x) => x.id === Number(mu[1]));
      if (!r) return send(res, 404, { detail: "That report does not exist." });
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return send(res, 400, { detail: "Write the update before saving.", missing: ["text"] });
      if (text.length > 2000) return send(res, 400, { detail: `The update is ${text.length} characters - the limit is 2000.` });
      const u = { id: nextUpdateId++, report_id: r.id, text, created_at: "2026-10-24T12:45:00-07:00", created_by: person(8) };
      updates.push(u);
      return send(res, 201, { update: u });
    }
    if (m && req.method === "PATCH") {
      const body = JSON.parse(await raw(req));
      entry.body = body;
      const r = reports.find((x) => x.id === Number(m[1]));
      if (!r) return send(res, 404, { detail: "That report does not exist." });
      // G361 契约 §3：No show 的 details 整份替换 staff 那部分（系统键保留）；决定的必填照后端。
      if (r.report_type === "no_show" && body.details) {
        const SERVER = ["source", "farm_out", "follow_up_task_id", "follow_up_task_for", "tracking_cleared_at", "ready_to_close_at"];
        if (SERVER.some((k) => k in body.details)) return send(res, 400, { detail: "Unknown or read-only details key." });
        const d = body.details;
        const fu = "follow_up_user_id" in body ? body.follow_up_user_id : r.follow_up?.id;
        if ((d.decision === "declined" || d.decision === "no_reply") && (!fu || !d.follow_up_due)) {
          const missing = [...(!fu ? ["follow_up_user_id"] : []), ...(!d.follow_up_due ? ["follow_up_due"] : [])];
          return send(res, 400, { detail: "Please fill in: " + missing.join(", "), missing });
        }
        if (d.decision === "accepted" && !d.new_order_number) return send(res, 400, { detail: "Please fill in: new_order_number", missing: ["new_order_number"] });
        const kept = Object.fromEntries(Object.entries(r.details).filter(([k]) => SERVER.includes(k)));
        r.details = { ...kept, ...d };
        if (d.decision === "accepted") r.status = "waiting_reschedule";
        else if (d.decision && (r.status === "open" || r.status === "waiting_reschedule")) r.status = "in_progress";
      }
      if (body.status) { r.status = body.status; r.resolved_at = body.status === "resolved" ? "2026-10-24T12:00:00-07:00" : null; }
      if ("follow_up_user_id" in body) r.follow_up = person(body.follow_up_user_id);
      // 每次改都换（同后端）：前端靠 updated_at 变了才重拉详情。No show 才用跳动的，旧套照旧固定值。
      r.updated_at = r.report_type === "no_show" ? new Date().toISOString() : "2026-10-24T12:00:00-07:00";
      return send(res, 200, { report: r });
    }
    if (p === "/api/operation-reports" && req.method === "GET") {
      const q = url.searchParams;
      const statuses = (q.get("status") || "open,in_progress,waiting_reschedule").split(",");
      let items = reports.filter((r) => statuses.includes(r.status));
      if (q.get("type")) items = items.filter((r) => r.report_type === q.get("type"));
      if (q.get("q")) items = items.filter((r) => (r.what_happened + (r.order_number || "")).toLowerCase().includes(q.get("q").toLowerCase()));
      if (q.get("follow_up_user_id") === "none") items = items.filter((r) => !r.follow_up);
      items = [...items].sort((a, b) => b.id - a.id);
      return send(res, 200, { items, counts: counts(items), total: items.length, limit: 50, offset: 0 });
    }
    if (p === "/api/operation-reports" && req.method === "POST") {
      const body = JSON.parse(await raw(req));
      entry.body = body;
      if (body.report_type === "no_show") {
        const missing = [...(!body.order_number ? ["order_number"] : []), ...(!body.details?.tour_date ? ["tour_date"] : [])];
        if (missing.length) return send(res, 400, { detail: "Please fill in: " + missing.join(", "), missing });
        const open = reports.find((r) => r.report_type === "no_show" && r.status !== "resolved" && r.order_number === body.order_number && r.details?.tour_date === body.details.tour_date);
        if (open) return send(res, 409, { detail: "There is already an open No show report for this order and tour date.", existing_id: open.id });
        const r = { id: nextId++, report_type: "no_show", complaint_about: null, headline: body.subject_name || body.order_number, order_number: body.order_number,
          subject_name: body.subject_name, what_happened: body.what_happened || "", status: "open", follow_up: person(body.follow_up_user_id), created_by: person(8),
          created_at: "2026-11-26T12:30:00-08:00", updated_at: "2026-11-26T12:30:00-08:00", resolved_at: null, resolved_by: null,
          details: { ...body.details, source: "manual", ...(PREFILL[body.order_number]?.[0]?.farm_out ? { farm_out: true } : {}) } };
        reports.push(r);
        return send(res, 201, { report: r, duplicate: false, notification: { in_app: 3, email: 0, used_fallback: false } });
      }
      if (!body.what_happened) return send(res, 400, { detail: "Please fill in: what_happened", missing: ["what_happened"] });
      const key = `${body.client_token}`;
      // 后端最终形状（5faa891e）：{report, duplicate, notification}；duplicate:true 时 notification 是 null；
      // 开关关着多 skipped:"switch_off"，通知出错 skipped:"error"。
      const notification = ctl.notifyError ? { in_app: 0, email: 0, used_fallback: false, skipped: "error" } : ctl.notifyOff ? { in_app: 0, email: 0, used_fallback: false, skipped: "switch_off" } : { in_app: 2, email: 3, used_fallback: true };
      // 置顶 109 W4 第二段（后端 f30d895a）：按人算的 sent / failed / no_contact；ctl.notifyFailed = 部门邮箱发不出；ctl.notifyAllFailed = 谁都没通知到；ctl.notifyLegacy = 旧后端。
      const RES = { name: "reservations@nationalparkexpress.com", error: "Email could not be sent" };
      if (!ctl.notifyLegacy) Object.assign(notification, notification.skipped ? { sent: [], failed: [], no_contact: [] } : ctl.notifyAllFailed ? { sent: [], failed: [{ name: "Sup", error: "In-app notice could not be written; email could not be sent" }, RES], no_contact: [] } : { sent: ["Staff Two", "Sup", ...(ctl.notifyFailed ? [] : [RES.name])], failed: ctl.notifyFailed ? [RES] : [], no_contact: [] });
      if (tokens.has(key)) return send(res, 200, { report: tokens.get(key), notification: null, duplicate: true });
      const r = {
        id: nextId++, report_type: body.report_type, complaint_about: body.complaint_about,
        headline: body.subject_name || body.details?.vehicle_no || TYPE_NAME[body.report_type], order_number: body.order_number, subject_name: body.subject_name,
        what_happened: body.what_happened, status: "open", follow_up: person(body.follow_up_user_id), created_by: person(8),
        created_at: "2026-10-24T12:30:00-07:00", updated_at: "2026-10-24T12:30:00-07:00", resolved_at: null, resolved_by: null, details: body.details || {},
      };
      reports.push(r);
      tokens.set(key, r);
      return send(res, 201, { report: r, duplicate: false, notification });
    }
  }
  // G361 Evidence：订单页现成接口（只给 Evidence 用到的键）；Phone AI 按号码搜（只 Super Admin）。
  if (p.startsWith("/api/operations/orders/") && req.method === "GET") {
    const o = decodeURIComponent(p.split("/").pop());
    if (o !== "CHDNS0001") return send(res, 404, { detail: "Order not found." });
    return send(res, 200, {
      order_number: o, status: "Confirmed", source: "rezdy", booking_type: "", editable: true,
      guest: { name: "ZZ Test Guest", email: "azhou@nationalparkexpress.com", phone: "+1 702 555 0101", pax: 2 },
      product: { code: "GCW01", name: "Grand Canyon West Rim Day Tour", tour_date: "11/26/2026" },
      confirmations: [
        { module: "tour_confirmation", tour_date: "2026-11-26", status: "unanswered", submitted_at: null, send_state: "sent", sent_at: "2026-11-24T15:10:00-08:00", email_status: "delivered", sms_status: "delivered" },
        { module: "morning", tour_date: "2026-11-26", status: "unanswered", submitted_at: null, send_state: "sent", sent_at: "2026-11-25T18:00:00-08:00", email_status: null, sms_status: "failed" },
      ],
      rezdy_changes: [{ at: "2026-11-25T10:00:00-08:00", source: "rezdy_push", by: "", changes: [{ field: "Pickup", before: "Resorts World", after: "Circus Circus" }] }],
      day_of_tour: [{ tour_date: "2026-11-26", leg: "", product_code: "GCW01", relay_mark: null, relay_original: null,
        bus_mark: { value: "no_show", label: "No show", by: "ZZ Test Driver", role: "guide", vehicle: "Bus 1328", at: "2026-11-26T07:40:00-08:00" }, bus_original: null }],
      staff_notes: [{ id: 31 }, { id: 32 }],
    });
  }
  if (p === "/api/voice/call-log/search" && req.method === "POST") {
    entry.body = JSON.parse((await raw(req)) || "{}");
    if (!ctl.superadmin) return send(res, 403, { detail: "Super Admin only." });
    return send(res, 200, { count: 1, calls: [] });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("dor mock on", process.env.MOCK_PORT || 8799));

const TYPE_NAME = { complaint: "Complaint", accident: "Accident", emergency: "Emergency", no_show: "No show" };
