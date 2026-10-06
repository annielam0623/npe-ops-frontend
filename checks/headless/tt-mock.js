// 模拟后端：Tour Confirmation Tracking。控制：POST /__ctl；GET /__log。
const http = require("http");
// notesActionBy：对话接口回的处理人（模拟读所有线时回的是别的线）；slowTake：take-action 延迟毫秒；extraRow：多一行 T07。
const ctl = { fail401: false, confFail: false, pref: null, newMsg: false, importBad: false, notesActionBy: "", slowTake: 0, extraRow: false };
const log = [];
function send(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function readRaw(req) { return new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c).toString("utf8"))); }); }
const TYPES = [
  { key: "upper_antelope", label: "Upper Antelope Canyon Bus Tour", abbr: "AC-U", has_lunch: true, has_beef: true, lunch_group: "Antelope", file_slug: "antelope-upper" },
  { key: "lower_antelope", label: "Lower Antelope Canyon Bus Tour", abbr: "AC-L", has_lunch: true, has_beef: true, lunch_group: "Antelope", file_slug: "antelope-lower" },
  { key: "grand_canyon_south", label: "Grand Canyon South Rim Bus Tour", abbr: "South", has_lunch: true, has_beef: false, lunch_group: "South", file_slug: "south" },
  { key: "grand_canyon_west", label: "Grand Canyon West Rim Bus Tour", abbr: "West", has_lunch: false, has_beef: false, lunch_group: "", file_slug: "west" },
];
const row = (o) => ({ id: 0, order_number: "", first_name: "ZZ", guest_name: "ZZ Test", email: "zz@example.test", phone: "+15550000000", quantities: 2,
  pickup_time: "6:30 AM", pickup_location: "MGM", tour_date: "2026-10-10", tour_type: "upper_antelope", email_status: "sent", email_state: "", sms_status: "sent:SM1",
  confirmation_status: "pending", lunch_turkey: 0, lunch_veggie: 0, lunch_beef: 0, notes: "", submission_count: 0, submitted_at: "", upload_row: null,
  mtlv_eligible: false, mtlv_qty: null, mtlv_ticket_status: null, mtlv_ticket_sent_by: "", mtlv_ticket_sent_at: "", action_taken_by: "",
  notes_count: 0, latest_note_author: "", latest_note_body: "", latest_note_direction: "", latest_note_channel: "", latest_note_at: "",
  wa_count: 0, latest_wa_author: "", latest_wa_body: "", latest_wa_direction: "", latest_wa_at: "", latest_wa_ts: "", wa_unhandled: false, wa_is_newer: false, wa_in_ts: "", wa_fallback: "", ...o });
let rows = [
  row({ id: 1, order_number: "T01", guest_name: "ZZ One", first_name: "ZZOne", confirmation_status: "yes", lunch_turkey: 1, lunch_veggie: 1, lunch_beef: 0, submitted_at: "10/03 09:00 AM", submission_count: 2, email_state: "opened", sms_status: "delivered",
    mtlv_eligible: true, mtlv_qty: 2, mtlv_ticket_status: "pending_send", upload_row: [["Order Number", "T01"], ["Hotel Note", "Late check-in"]] }),
  row({ id: 2, order_number: "T02", guest_name: "ZZ Two", tour_type: "lower_antelope", confirmation_status: "modify_req", notes: "Can we move to 7am?", sms_status: "undelivered", email_status: "", email_state: "" }),
  row({ id: 3, order_number: "T03", guest_name: "ZZ Three", tour_type: "grand_canyon_south", confirmation_status: "yes", lunch_turkey: 2, lunch_veggie: 0, lunch_beef: 9, email_state: "failed", email_status: "failed: bounce", sms_status: "failed",
    mtlv_eligible: true, mtlv_qty: null }),
  row({ id: 4, order_number: "T04", guest_name: "ZZ Four", tour_type: "grand_canyon_west", confirmation_status: "cancel", mtlv_eligible: true, mtlv_qty: 0, mtlv_ticket_status: "cancel",
    notes_count: 2, latest_note_body: "Thanks", latest_note_direction: "sms_in", latest_note_channel: "sms", action_taken_by: "Annie" }),
  row({ id: 5, order_number: "T05", guest_name: "ZZ Five", wa_count: 1, latest_wa_body: "Hello?", latest_wa_direction: "whatsapp_in", latest_wa_ts: "2026-10-09T18:00:00+00:00", wa_unhandled: true, wa_is_newer: true,
    wa_in_ts: new Date().toISOString(), upload_row: [["Order Number", "T05"], ["Agent", "Viator"]] }),
  row({ id: 6, order_number: "T06", guest_name: "ZZ Six", tour_type: "mystery_tour", sms_status: "", email_status: "", email_state: "" }),
];
const notes = {};
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, JSON.parse(await readRaw(req))); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, q };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/me") return send(res, 200, { id: 1, username: "annie", display_name: "Annie", initials: "AZ", role: "admin", is_admin: true, is_superadmin: false });
  if (p === "/api/notifications/tour-confirmation/tour-types") return send(res, 200, TYPES);
  if (p === "/api/notifications/tour-confirmation/tracking") {
    let out = rows;
    if (ctl.newMsg) out = rows.map((r) => (r.id === 3 ? { ...r, notes_count: 1, latest_note_body: "New!", latest_note_direction: "sms_in", latest_note_channel: "sms" } : r));
    if (ctl.extraRow) out = [...out, row({ id: 7, order_number: "T07", guest_name: "ZZ Seven", first_name: "ZZSeven", phone: "+15550000007" })];
    return send(res, 200, { date: q.date, rows: q.date === "2026-10-10" ? out : [] });
  }
  if (p === "/api/broadcasting-log") return send(res, 200, { rows: q.date === "2026-10-10" ? [{ id: 5, template_name: "Weather delay", created_at: "10/09 3:00 PM", sent_by: "annie", message_body: "Hi all" }] : [] });
  if (p === "/api/user-prefs/tour_col_order") {
    if (req.method === "PUT") { entry.body = JSON.parse(await readRaw(req)); ctl.pref = entry.body.value; return send(res, 200, { ok: true }); }
    return send(res, 200, { key: "tour_col_order", value: ctl.pref });
  }
  let m = p.match(/^\/api\/bookings\/(\d+)\/(confirmation|lunch|mtlv-ticket-status|take-action)$/);
  if (m) {
    const r = rows.find((x) => x.id === Number(m[1]));
    const body = req.method === "PUT" ? JSON.parse((await readRaw(req)) || "{}") : {};
    entry.body = body;
    if (m[2] === "confirmation") {
      if (ctl.confFail) return send(res, 400, { detail: "Invalid confirmation: maybe" });
      r.confirmation_status = body.confirmation;
      if (body.confirmation === "cancel") { r.lunch_turkey = r.lunch_veggie = r.lunch_beef = 0; if (r.mtlv_eligible) { r.mtlv_qty = 0; r.mtlv_ticket_status = "cancel"; } }
    } else if (m[2] === "lunch") {
      Object.assign(r, body);
    } else if (m[2] === "mtlv-ticket-status") {
      r.mtlv_ticket_status = body.mtlv_ticket_status;
      if (body.mtlv_ticket_status === "sent") { r.mtlv_ticket_sent_by = "Annie Z"; r.mtlv_ticket_sent_at = "10/9/26 3:10 PM"; } else { r.mtlv_ticket_sent_by = ""; r.mtlv_ticket_sent_at = ""; }
      if (body.mtlv_ticket_status === "cancel") r.mtlv_qty = 0;
    } else {
      if (ctl.slowTake) await new Promise((ok) => setTimeout(ok, ctl.slowTake));
      r.action_taken_by = r.action_taken_by ? "" : "Annie";
      // 标记写完的时刻：之后的第一次 tracking 请求就是写完后的重拉。
      log.push({ method: "MARK", path: "take-action-done", q: {} });
      return send(res, 200, { ok: true, action_taken_by: r.action_taken_by ? "annie" : "", action_taken_at: null });
    }
    return send(res, 200, { ok: true });
  }
  m = p.match(/^\/booking-notes\/by-order\/(.+)$/);
  if (m) {
    const o = decodeURIComponent(m[1]);
    if (req.method === "POST") {
      const body = JSON.parse(await readRaw(req)); entry.body = body;
      const note = { id: 900, booking_id: 0, author_username: "Annie", direction: body.direction, body: body.body, sms_status: body.send_sms ? "sent" : null, email_status: body.send_email ? "sent" : null, created_at: "2026-10-09 10:00" };
      (notes[o] ||= []).push(note);
      return send(res, 200, { note });
    }
    return send(res, 200, { notes: [{ id: 1, booking_id: 0, author_username: "", direction: "sms_in", body: "Hi from guest", sms_status: null, email_status: null, created_at: "2026-10-09 09:00" }, ...(notes[o] || [])], guest_note: "", action_taken_by: ctl.notesActionBy || "" });
  }
  if (p === "/api/broadcast-templates") return send(res, 200, { tour: { templates: [{ name: "t1", label: "Weather delay", body: "Hi {first_name}, weather on {tour_date}." }], signature: "- NPE" }, tix: { templates: [], signature: "" } });
  if (p === "/booking-notes/broadcast/send") {
    const body = JSON.parse(await readRaw(req)); entry.body = body;
    return send(res, 200, { broadcast_id: 9, recipient_count: body.recipients.length, sms_sent: body.recipients.length, sms_failed: 0, email_sent: 0, email_failed: 0 });
  }
  if (p === "/send/tour-tracking-import-preview") {
    const raw = await readRaw(req);
    entry.tourType = (raw.match(/name="tour_type"\r\n\r\n([^\r]*)/) || [])[1];
    entry.tourDate = (raw.match(/name="tour_date"\r\n\r\n([^\r]*)/) || [])[1];
    if (ctl.importBad) return send(res, 400, { detail: "Missing required columns: Pick-up Location" });
    return send(res, 200, { total: 2, warning: "", rows: [
      { order_number: "T01", first_name: "ZZ", last_name: "One", email: "a@x", phone: "+1", quantities: "Adult: 2", pax: 2, pax_ok: true, qty_label: "Adult: 2", mtlv_promo: "", pickup_time: "6:30 AM", pickup_location: "MGM", duplicate: true },
      { order_number: "T09", first_name: "ZZ", last_name: "Nine", email: "n@x", phone: "+9", quantities: "Adult: 1", pax: 1, pax_ok: true, qty_label: "Adult: 1", mtlv_promo: "ELIGIBLE", pickup_time: "6:45 AM", pickup_location: "TI", duplicate: false },
    ] });
  }
  if (p === "/send/tour-tracking-import-commit") {
    const body = JSON.parse(await readRaw(req)); entry.body = body;
    return send(res, 200, { inserted: body.guests.length, failed: 0, errors: [] });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("tt mock on 8799"));
