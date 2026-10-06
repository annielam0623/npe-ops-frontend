// 模拟后端：Send Log / Order Log 的日期范围 + MTLV。GET /__log 看请求参数。
const http = require("http");
const log = [];
function send(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
const YMD = /^\d{4}-\d{2}-\d{2}$/;
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
    const rows = [
      { sent_at: "2026-10-03T18:00:00+00:00", module: "tickets_reminder", order_number: "CHD1", first_name: "ZZ", last_name: "Test", email: "a@x", phone: "+1", tour_date: "2026-10-04", tour_type: "x", email_status: "sent", sms_status: "delivered", error_msg: null, sent_by: "annie", mtlv_eligible: true },
      { sent_at: "2026-10-03T17:00:00+00:00", module: "tour_confirmation", order_number: "CHD2", first_name: "ZZ", last_name: "Two", email: "b@x", phone: "+2", tour_date: "2026-10-05", tour_type: "y", email_status: "sent", sms_status: "sent", error_msg: null, sent_by: "annie", mtlv_eligible: false },
    ].filter((r) => q.mtlv_eligible !== "true" || r.mtlv_eligible);
    return send(res, 200, { total: rows.length, page: 1, stats: { total: 2, tour_confirmation: 1, morning_pickup: 0, tickets_reminder: 1, mtlv: 1 }, rows });
  }
  if (p === "/api/send-batches") {
    return send(res, 200, { batches: [
      { id: 702, module: "last_minute", tour_type: "grand_canyon_west", tour_label: "Grand Canyon West Rim Bus Tour (Last Minute)", tour_date: "2026-10-05", send_type: "combined", sent_by: "annie", started_at: "Oct 4, 2026 3:10 PM", summary: { file_rows: 3, sent: 3, failed: 0, skipped: 0, not_sent: 0 } },
      { id: 701, module: "tickets_reminder", tour_type: "upper_antelope_tsosie", tour_label: "Chief Tsosie Tours", tour_date: "2026-10-05", send_type: "sms", sent_by: "max", started_at: "Oct 4, 2026 2:00 PM", summary: { file_rows: 13, sent: 9, failed: 1, skipped: 2, not_sent: 1 } },
    ] });
  }
  const bm = p.match(/^\/api\/send-batches\/(\d+)$/);
  if (bm) {
    const id = Number(bm[1]);
    if (id === 404) return send(res, 404, { detail: "Send batch not found." });
    const base = id === 650
      ? { id: 650, module: "tour_confirmation", tour_type: "hoover_dam", tour_label: "Hoover Dam Tour", tour_date: "2026-09-30", send_type: "email", sent_by: "annie", started_at: "Sep 29, 2026 11:52 PM" }
      : { id, module: "tickets_reminder", tour_type: "upper_antelope_tsosie", tour_label: "Chief Tsosie Tours", tour_date: "2026-10-05", send_type: "sms", sent_by: "max", started_at: "Oct 4, 2026 2:00 PM" };
    return send(res, 200, { ...base,
      summary: { file_rows: 13, sent: 9, failed: 1, skipped: 2, not_sent: 1, email: { delivered: 0, waiting: 0, problem: 0, none: 10 }, sms: { delivered: 7, waiting: 2, problem: 1, none: 0 } },
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
}).listen(8799, () => console.log("catchup mock on 8799"));
