// 模拟后端：Send Log / Order Log 的日期范围 + MTLV。GET /__log 看请求参数。
const http = require("http");
const log = [];
function send(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
const YMD = /^\d{4}-\d{2}-\d{2}$/;
// G230：Send Log 按组。每组的行（新的在前）；组头的数字是整组的，不受筛选影响。
const row = (id, batch_id, module, order, first, extra = {}) => ({ id, batch_id, sent_at: "2026-10-04T21:00:00+00:00", module, order_number: order, first_name: first, last_name: "Test", email: order.toLowerCase() + "@x", phone: "+1", tour_date: "2026-10-05", tour_type: "x", email_status: "sent", sms_status: "delivered", error_msg: null, sent_by: "annie", mtlv_eligible: false, ...extra });
const GROUP_ROWS = {
  702: [row(7023, 702, "tour_confirmation", "CHD7", "ZZ Seven"), row(7022, 702, "tour_confirmation", "CHD6", "ZZ Six"), row(7021, 702, "tour_confirmation", "CHD5", "ZZ Five")],
  701: [row(7013, 701, "tickets_reminder", "CHD3", "ZZ Three"), row(7012, 701, "tickets_reminder", "CHD2", "ZZ Two", { sms_status: "failed: 21211", email_status: "", error_msg: "Twilio 21211 invalid number" }), row(7011, 701, "tickets_reminder", "CHD1", "ZZ <b>One</b>", { mtlv_eligible: true, email_status: "" })],
  703: [row(7031, 703, "reply_sms", "CHD12", "ZZ Twelve", { email_status: "", sent_by: "jchen" })],
};
// ?batch=650：不在今天的组（不在组列表里，只有明细和行）。
const EXTRA_ROWS = { 650: [row(6501, 650, "tour_confirmation", "CHD650", "ZZ Hoover")] };
const GROUP_HEADS = [
  { batch_id: 702, module: "last_minute", tour_type: "grand_canyon_west", tour_label: "Grand Canyon West Rim Bus Tour (Last Minute)", tour_date: "2026-10-05", send_type: "combined", sent_by: "annie", started_at: "2026-10-04T22:10:00+00:00", started_at_label: "Oct 4, 2026 3:10 PM", summary: { file_rows: 3, sent: 3, failed: 0, skipped: 0, not_sent: 0 } },
  { batch_id: 701, module: "tickets_reminder", tour_type: "upper_antelope_tsosie", tour_label: "Chief Tsosie Tours", tour_date: "2026-10-05", send_type: "sms", sent_by: "max", started_at: "2026-10-04T21:00:00+00:00", started_at_label: "Oct 4, 2026 2:00 PM", summary: { file_rows: 14, sent: 9, failed: 1, no_contact: 1, skipped: 2, not_sent: 1 } },
  { batch_id: 703, module: "reply_sms", tour_type: "", tour_label: "Guest reply", tour_date: "", send_type: "sms", sent_by: "jchen", started_at: "2026-10-04T20:00:00+00:00", started_at_label: "Oct 4, 2026 1:00 PM", summary: { file_rows: 1, sent: 1, failed: 0, skipped: 0, not_sent: 0 } },
];
/** 同后端 _send_log_where 的行筛选（日期不看）。 */
const rowMatch = (r, q) =>
  (!q.order_number || r.order_number.toUpperCase().includes(q.order_number.toUpperCase())) &&
  (q.mtlv_eligible !== "true" || r.mtlv_eligible) &&
  (!q.module || r.module === q.module) &&
  (!q.channel || (q.channel === "EMAIL" ? !!r.email_status : !!r.sms_status)) &&
  (!q.status || (r.email_status + " " + r.sms_status).includes(q.status));
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  if (p === "/__log") return send(res, 200, log);
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  log.push({ method: req.method, path: p, q });
  for (const k of ["date", "date_from", "date_to"]) {
    if (q[k] !== undefined && !YMD.test(q[k])) return send(res, 400, { detail: `${k} must be a date like 2026-10-03` });
  }
  if (q.date_from && q.date_to && q.date_from > q.date_to) return send(res, 400, { detail: "date_from must not be after date_to" });
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: "staff", is_admin: false, is_superadmin: false });
  if (p === "/api/notifications/send-log") {
    // 页面只拿它列 ⚠️ Errors。
    const rows = Object.values(GROUP_ROWS).flat().filter((r) => rowMatch(r, q));
    return send(res, 200, { total: rows.length, page: 1, stats: { total: 2, tour_confirmation: 1, morning_pickup: 0, tickets_reminder: 1, mtlv: 1 }, rows });
  }
  if (p === "/api/notifications/send-log/groups") {
    if (Number(q.page_size) > 100) return send(res, 400, { detail: "page must be 1 or more and page_size from 1 to 100." });
    const groups = GROUP_HEADS.map((g) => {
      const m = GROUP_ROWS[g.batch_id].filter((r) => rowMatch(r, q));
      return { ...g, matched_rows: m.length, matched_orders: m.map((r) => r.order_number) };
    }).filter((g) => g.matched_rows > 0);
    // Custom 9/20–9/25：假装有 150 组（翻页用）；第 2 页只有 703。
    const many = q.date_from === "2026-09-20";
    const total = groups.reduce((n, g) => n + g.matched_rows, 0);
    return send(res, 200, { total, total_groups: many ? 150 : groups.length, page: Number(q.page) || 1, page_size: Number(q.page_size),
      stats: { total, tour_confirmation: 3, morning_pickup: 0, tickets_reminder: 3, mtlv: 1 },
      groups: many && q.page === "2" ? groups.filter((g) => g.batch_id === 703) : groups });
  }
  const gr = p.match(/^\/api\/notifications\/send-log\/groups\/(\d+)\/rows$/);
  if (gr) {
    const rows = GROUP_ROWS[gr[1]] || EXTRA_ROWS[gr[1]];
    if (!rows) return send(res, 404, { detail: "Send batch not found." });
    return send(res, 200, { batch_id: Number(gr[1]), rows: rows.map((r) => ({ ...r, matched: rowMatch(r, q) })) });
  }
  // G129：带着问题、有人点了 Send anyway 发出去的（只有订单号和原因，没有客人信息）。
  if (p === "/api/send-log/overrides") {
    return send(res, 200, { overrides: [
      { id: 12, module: "morning_relay:relay", run_date: "2026-10-20", orders: ["CHD1", "CHD2"], reasons: { CHD1: ["Relay car 2101 has no driver"], CHD2: ["Relay car 2101 has no driver"] }, actor: "sam", actor_name: "Sam", created_at: "2026-10-20T17:03:11+00:00" },
      { id: 11, module: "farm_out_notice", run_date: "2026-10-20", orders: ["CHDF002"], reasons: { CHDF002: ["Missing pick-up location"] }, actor: "sam", actor_name: null, created_at: "2026-10-20T16:41:00+00:00" },
      { id: 10, module: "tickets_reminder", run_date: "2026-10-21", orders: ["CHD7781", "CHD7794"], reasons: { CHD7781: ["No Cfm #"], CHD7794: ["No Cfm #"] }, actor: "sam", actor_name: "Sam", created_at: "2026-10-20T16:12:00+00:00" },
    ] });
  }
  if (p === "/api/send-batches") {
    return send(res, 200, { batches: [
      { id: 702, module: "last_minute", tour_type: "grand_canyon_west", tour_label: "Grand Canyon West Rim Bus Tour (Last Minute)", tour_date: "2026-10-05", send_type: "combined", sent_by: "annie", started_at: "Oct 4, 2026 3:10 PM", summary: { file_rows: 3, sent: 3, failed: 0, skipped: 0, not_sent: 0 } },
      { id: 701, module: "tickets_reminder", tour_type: "upper_antelope_tsosie", tour_label: "Chief Tsosie Tours", tour_date: "2026-10-05", send_type: "sms", sent_by: "max", started_at: "Oct 4, 2026 2:00 PM", summary: { file_rows: 14, sent: 9, failed: 1, no_contact: 1, skipped: 2, not_sent: 1 } },
    ] });
  }
  const bm = p.match(/^\/api\/send-batches\/(\d+)$/);
  if (bm) {
    const id = Number(bm[1]);
    if (id === 404) return send(res, 404, { detail: "Send batch not found." });
    // 回复客人：一条一组。
    if (id === 703) return send(res, 200, { id, module: "reply_sms", tour_type: "", tour_label: "Guest reply", tour_date: "", send_type: "sms", sent_by: "jchen", started_at: "Oct 4, 2026 1:00 PM",
      summary: { file_rows: 1, sent: 1, failed: 0, skipped: 0, not_sent: 0, email: { delivered: 0, waiting: 0, problem: 0, none: 1 }, sms: { delivered: 1, waiting: 0, problem: 0, none: 0 } }, rows: [], skipped: [] });
    const base = id === 650
      ? { id: 650, module: "tour_confirmation", tour_type: "hoover_dam", tour_label: "Hoover Dam Tour", tour_date: "2026-09-30", send_type: "email", sent_by: "annie", started_at: "Sep 29, 2026 11:52 PM" }
      : { id, module: "tickets_reminder", tour_type: "upper_antelope_tsosie", tour_label: "Chief Tsosie Tours", tour_date: "2026-10-05", send_type: "sms", sent_by: "max", started_at: "Oct 4, 2026 2:00 PM" };
    return send(res, 200, { ...base,
      summary: { file_rows: 14, sent: 9, failed: 1, no_contact: 1, skipped: 2, not_sent: 1, email: { delivered: 0, waiting: 0, problem: 0, none: 10 }, sms: { delivered: 7, waiting: 2, problem: 1, none: 0 } },
      rows: [
        { order_number: "CHD1", name: "ZZ <b>One</b>", email: "a@x", phone: "+1", sent_at: "Oct 4, 2026 2:00 PM", went_out: true, email_status: "", email_state: "none", sms_status: "delivered", sms_state: "delivered", error_msg: "" },
        { order_number: "CHD2", name: "ZZ Two", email: "b@x", phone: "+2", sent_at: "Oct 4, 2026 2:00 PM", went_out: false, email_status: "", email_state: "none", sms_status: "failed: 21211", sms_state: "problem", error_msg: "" },
      ],
      skipped: [{ order_number: "CHD9", name: "ZZ Nine", reason: "Already sent for this date and tour" }] });
  }
  if (p === "/api/activities/order-log") {
    return send(res, 200, { total: 1, page: 1, stats: { staff_actions: 1, guest_actions: 0 }, records: [
      { id: 1, order_number: "CHD1", tour_date: "10/4/2026", event_type: "field_updated", event_label: "Field Updated", event_color: "#378ADD", detail: "x", actor: "annie", actor_type: "staff", modified_at: "10/3/2026 9:00 AM" },
    ] });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("catchup mock on", process.env.MOCK_PORT || 8799));
