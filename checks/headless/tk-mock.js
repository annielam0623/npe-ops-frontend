// 模拟后端：Tickets Tracking 页用到的接口。控制：POST /__ctl {fail401, bump}；GET /__log。
const http = require("http");

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const H = 3600_000;
const ctl = { fail401: false };
const log = [];

function row(over) {
  return {
    id: 0, order_number: "", confirmation_no: "", guest_name: "", phone: "+15550000001",
    email: "zz@example.test", quantities: 2, tour_date: today, tour_type: "upper_antelope_tsosie",
    checkin_time: "8:00 AM", tour_time: "9:00 AM", email_status: "", email_state: "", sms_status: "",
    confirmation_status: "pending", submitted_at: null, resubmitted: false, action_taken_by: "",
    guest_notes: "", upload_row: null,
    notes_count: 0, latest_note_author: "", latest_note_body: "", latest_note_direction: "",
    latest_note_channel: "", latest_note_at: null,
    wa_count: 0, latest_wa_author: "", latest_wa_body: "", latest_wa_direction: "", latest_wa_at: null,
    latest_wa_ts: "", wa_unhandled: false, wa_is_newer: false, wa_in_ts: "", wa_fallback: "",
    ...over,
  };
}

const rows = [
  row({ id: 11, order_number: "CHDZZ1", confirmation_no: "C-1", guest_name: "ZZ Test Alpha", quantities: 3,
    confirmation_status: "yes", sms_status: "delivered", email_status: "sent", email_state: "opened",
    submitted_at: iso(2 * H), resubmitted: true, guest_notes: "We will be 10 min late",
    upload_row: [["Booking Ref", "R-100"], ["Hotel", "Lodge A"]] }),
  row({ id: 12, order_number: "CHDZZ2", guest_name: "ZZ Test Bravo", quantities: 2,
    sms_status: "sent", email_status: "sent",
    upload_row: [["Booking Ref", "R-200"], ["Hotel", "Lodge B"]] }),
  row({ id: 13, order_number: "CHDZZ3", guest_name: "ZZ Test Charlie", quantities: 4, tour_type: "lower_antelope_kens",
    confirmation_status: "reschedule_req", sms_status: "undelivered", email_status: "failed" }),
  row({ id: 14, order_number: "CHDZZ4", guest_name: "ZZ Test Delta", quantities: 1, tour_type: "upper_antelope_brenda_no_fee",
    phone: "", email: "", sms_status: "failed",
    wa_count: 1, latest_wa_body: "Hola", latest_wa_direction: "sms_in", latest_wa_ts: iso(H), wa_in_ts: iso(H),
    wa_unhandled: true, wa_is_newer: true }),
  row({ id: 15, order_number: "CHDZZ5", guest_name: "  ZZ Test Echo", quantities: 2, tour_type: "lower_antelope_kens",
    confirmation_status: "yes", sms_status: "queued", notes_count: 1, latest_note_body: "Thanks!",
    latest_note_direction: "sms_in", latest_note_channel: "sms", action_taken_by: "Annie Z" }),
];
const notes = { 11: [{ id: 1, booking_id: 11, order_number: "CHDZZ1", author_username: "Annie Z", direction: "sms_out", body: "Reminder", sms_status: "sent", email_status: null, created_at: "2026-10-01 09:00" }] };
const broadcasts = [{ id: 7, sent_by: "annie", module: "tickets", template_name: "Weather delay", message_body: "Storm today", recipient_count: 3, sms_sent: 3, sms_failed: 0, email_sent: 3, email_failed: 0, created_at: `${today} 07:00` }];

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("latin1")));
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") {
    const body = JSON.parse((await readRaw(req)) || "{}");
    if (body.bump) {
      const r = rows.find((x) => x.id === body.bump);
      r.notes_count += 1; r.latest_note_body = "New message!"; r.latest_note_direction = "sms_in"; r.latest_note_channel = "sms";
    }
    Object.assign(ctl, body);
    return send(res, 200, ctl);
  }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, query: url.search };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/user-prefs/tickets_col_order") {
    if (req.method === "PUT") { const b = JSON.parse(await readRaw(req)); entry.body = b; ctl.pref = b.value; return send(res, 200, { ok: true }); }
    return send(res, 200, { key: "tickets_col_order", value: ctl.pref ?? null });
  }

  if (p === "/api/notifications/tickets-reminder/tracking") {
    // extraRow：多一行 CHDZZ6（测群发弹窗开着时表格重拉）。
    const out = ctl.extraRow ? [...rows, row({ id: 16, order_number: "CHDZZ6", guest_name: "ZZ Test Foxtrot", sms_status: "sent" })] : rows;
    return send(res, 200, { date: url.searchParams.get("date"), rows: url.searchParams.get("date") === today ? out : [] });
  }
  if (p === "/api/broadcasting-log")
    return send(res, 200, { rows: url.searchParams.get("date") === today ? broadcasts : [] });
  if (p === "/api/tickets-reminder/update-status") {
    const body = JSON.parse(await readRaw(req));
    entry.body = body;
    if (!["yes", "pending", "reschedule_req"].includes(body.confirmation)) return send(res, 400, { detail: "Invalid confirmation value" });
    rows.filter((r) => r.order_number === body.chd_number && r.tour_date === body.service_date).forEach((r) => (r.confirmation_status = body.confirmation));
    return send(res, 200, { ok: true });
  }
  let m = p.match(/^\/api\/bookings\/(\d+)\/take-action$/);
  if (m) {
    const r = rows.find((x) => x.id === Number(m[1]));
    // slowTake：模拟写得慢（毫秒），测写的时候换日期。
    if (ctl.slowTake) await new Promise((ok) => setTimeout(ok, ctl.slowTake));
    r.action_taken_by = r.action_taken_by ? "" : "ZZ Test";
    // 标记写完的时刻：之后的第一次 tracking 请求就是写完后的重拉。
    log.push({ method: "MARK", path: "take-action-done", query: "" });
    return send(res, 200, { ok: true, action_taken_by: r.action_taken_by ? "zztest" : "", action_taken_at: null });
  }
  m = p.match(/^\/booking-notes\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    if (req.method === "POST") {
      const body = JSON.parse(await readRaw(req));
      entry.body = body;
      const note = { id: 900 + (notes[id]?.length || 0), booking_id: id, order_number: "", author_username: "ZZ Test", direction: body.direction, body: body.body, sms_status: body.send_sms ? "sent" : null, email_status: body.send_email ? "sent" : null, created_at: "2026-10-03 10:00" };
      (notes[id] ||= []).push(note);
      return send(res, 200, { note });
    }
    return send(res, 200, { notes: notes[id] || [] });
  }
  if (p === "/api/broadcast-templates")
    return send(res, 200, { tour: { templates: [], signature: "" }, tix: { templates: [{ name: "t1", label: "Wind alert", body: "Hi {first_name}, wind on {tour_date}." }], signature: "- NPE Tickets" } });
  if (p === "/booking-notes/broadcast/send") {
    const body = JSON.parse(await readRaw(req));
    entry.body = body;
    return send(res, 200, { broadcast_id: 8, recipient_count: body.recipients.length, sms_sent: body.send_sms ? body.recipients.filter((r) => r.phone).length : 0, sms_failed: 0, email_sent: body.send_email ? body.recipients.filter((r) => r.email).length : 0, email_failed: 1 });
  }
  if (p === "/api/tickets-reminder/tracking-import-preview") {
    const raw = await readRaw(req);
    entry.hasFile = raw.includes('name="manifest"');
    entry.tourType = (raw.match(/name="tour_type"\r\n\r\n([^\r]*)/) || [])[1];
    entry.serviceDate = (raw.match(/name="service_date"\r\n\r\n([^\r]*)/) || [])[1];
    if (raw.includes("BADFILE")) return send(res, 200, { error: "Missing column: CHD Number", duplicates: [], total: 0, rows: [] });
    const badPax = raw.includes("BADPAX");
    return send(res, 200, {
      duplicates: ["CHDZZ1"], total: 3, warning: "Encoding guessed as Windows-1252.",
      rows: [
        { order_number: "CHDZZ1", first_name: "ZZ", last_name: "Alpha", phone: "1", email: "a@x", pax: 3, pax_ok: true, qty_label: "3 Adults", checkin_time: "8", tour_time: "9", duplicate: true, upload_row: [["A", "1"]] },
        { order_number: "CHDZZ8", first_name: "ZZ", last_name: "New", phone: "2", email: "b@x", pax: badPax ? 0 : 2, pax_ok: !badPax, qty_label: "2 Adults", checkin_time: "8", tour_time: "9", duplicate: false },
        { order_number: "CHDZZ9", first_name: "ZZ", last_name: "Newer", phone: "3", email: "c@x", pax: 1, pax_ok: true, qty_label: "1 Adult", checkin_time: "8", tour_time: "9", duplicate: false },
      ],
    });
  }
  if (p === "/api/tickets-reminder/tracking-import-commit") {
    const body = JSON.parse(await readRaw(req));
    entry.body = body;
    return send(res, 200, { inserted: body.guests.length, failed: 0, errors: [] });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("tickets mock on 8799", today));
