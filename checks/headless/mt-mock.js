// 模拟后端：Morning Tracking 页用到的接口 + dashboard 的两个接口。
// 控制：POST /__ctl {endMinute, fail401, pref, morning400, morningDelay}；GET /__log 取请求记录。
const http = require("http");

const LA = "America/Los_Angeles";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: LA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const H = 3600_000;

const ctl = { endMinute: 1439, fail401: false };
const log = [];
let pref = null;

function row(over) {
  return {
    id: 0,
    order_number: "",
    name: "",
    phone: "+15550000000",
    email: "zz@example.test",
    quantities: 2,
    pickup_time: "7:00 AM",
    pickup_location: "Hotel A",
    driver: "",
    vehicle_no: "B1",
    samsara_url: "",
    sms_status: "",
    email_state: "",
    checkin_status: "pending",
    checkin_time: null,
    action_taken_by: "",
    agent_name: "Agent Z",
    notes_count: 0,
    latest_note_author: "",
    latest_note_body: "",
    latest_note_direction: "",
    latest_note_channel: "",
    latest_note_at: null,
    wa_count: 0,
    latest_wa_author: "",
    latest_wa_body: "",
    latest_wa_direction: "",
    latest_wa_at: null,
    latest_wa_ts: "",
    wa_unhandled: false,
    wa_is_newer: false,
    wa_in_ts: "",
    wa_fallback: "",
    ...over,
  };
}

const rows = [
  row({
    id: 1,
    order_number: "A1001",
    name: "ZZ Test One",
    driver: "Mike",
    vehicle_no: "768",
    samsara_url: "https://cloud.samsara.com/o/1/fleet/viewer/zz768",
    live_url: "https://confirm.example.test/tracking/vehicle-live?van=768",
    sms_status: "delivered",
    email_state: "clicked",
    checkin_status: "checked_in",
    checkin_time: iso(0.5 * H),
    notes_count: 2,
    latest_note_body: "Running late",
    latest_note_direction: "sms_in",
    latest_note_channel: "sms",
  }),
  row({
    id: 5,
    order_number: "A1005",
    samsara_url: "javascript:alert(1)",
    name: "ZZ Test Five",
    sms_status: "",
    checkin_status: "checked_in",
    checkin_time: iso(0.2 * H),
    action_taken_by: "Annie Z",
    notes_count: 1,
    latest_note_author: "Annie Z",
    latest_note_body: "Called guest",
    latest_note_direction: "staff_note",
  }),
  row({
    id: 2,
    order_number: "A1002",
    name: "ZZ Test Two",
    driver: "Mike",
    sms_status: "sent:SM123",
    email_state: "sent",
    wa_count: 1,
    latest_wa_body: "Where is the bus?",
    latest_wa_direction: "sms_in",
    latest_wa_ts: iso(1 * H),
    wa_in_ts: iso(1 * H),
    wa_unhandled: true,
    wa_is_newer: true,
  }),
  row({
    id: 3,
    order_number: "A1003",
    name: "ZZ Test Three",
    phone: "",
    email: "",
    driver: "Ana",
    vehicle_no: "769",
    samsara_url: "https://cloud.samsara.com/o/1/fleet/viewer/zz769",
    live_url: "",
    sms_status: "undelivered",
    email_state: "failed",
  }),
  row({
    id: 4,
    order_number: "A1004",
    name: "ZZ Test Four",
    driver: "Ana",
    vehicle_no: "770",
    live_url: "http://confirm.example.test/tracking/vehicle-live?van=770",
    quantities: 0,
    sms_status: "failed: 30003",
    wa_count: 3,
    latest_wa_body: "Hello?",
    latest_wa_direction: "sms_in",
    latest_wa_ts: iso(30 * H),
    wa_in_ts: iso(30 * H),
    wa_unhandled: true,
    wa_is_newer: true,
    wa_fallback: "sms",
  }),
];

// 早班发送页的 manifest：12 单（分两批），M03 没手机号。
const morningRows = Array.from({ length: 12 }, (_, i) => {
  const n = `M${String(i + 1).padStart(2, "0")}`;
  return { order_number: n, name: `ZZ Test ${n}`, phone: i === 2 ? "" : "+1555000" + String(i).padStart(4, "0"), email: "",
    pickup_time: "7:00 AM", pickup_location: "Hotel A", driver: "", vehicle_no: "", duplicate: false, sent_by: "", sent_at: "" };
});
// 服务端查重那一组（后端 2026-10-06 E141）：M11 今天发过、短信失败邮件已送达；M12 今天发过；
// M05 是 CSV 行、人数算不出；文件里 M01 有两行。
const GUARD_PREVIEW_AT = "2026-10-06T06:00:00-07:00";
const guardRows = [
  ...morningRows.slice(0, 10).map((r) => (r.order_number === "M05" ? { ...r, pax: 0, pax_ok: false } : { ...r, partial: null })),
  { ...morningRows[0], name: "ZZ Test M01 second row" },
  { ...morningRows[10], duplicate: true, sent_by: "annie", sent_at: "2026-10-06T12:30:00+00:00", partial: { failed: "sms", other: "delivered" } },
  { ...morningRows[11], duplicate: true, sent_by: "annie", sent_at: "2026-10-06T12:31:00+00:00", partial: null },
];
function readRaw(req) {
  return new Promise((resolve) => {
    const c = [];
    req.on("data", (d) => c.push(d));
    req.on("end", () => resolve(Buffer.concat(c).toString("utf8")));
  });
}

const notes = {
  A1001: [
    { id: 11, booking_id: 1, author_username: "", direction: "sms_in", body: "Running late", sms_status: null, email_status: null, created_at: "2026-10-03 07:10" },
    { id: 10, booking_id: 1, author_username: "Annie Z", direction: "sms_out", body: "Good morning", sms_status: "sent", email_status: "failed", created_at: "2026-10-03 06:00" },
  ],
};
let nextNoteId = 100;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data ? JSON.parse(data) : null));
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      Object.assign(ctl, (await readBody(req)) || {});
      if ("pref" in ctl) {
        pref = ctl.pref;
        delete ctl.pref;
      }
      return send(res, 200, { ctl, pref });
    }
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("<h1>LEGACY LOGIN</h1>");
    }
    const entry = { method: req.method, path: p, query: url.search };
    log.push(entry);
    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });

    if (p === "/api/me")
      return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: "admin", is_admin: true, is_superadmin: false });
    if (p === "/api/notifications/unhandled")
      return send(res, 200, {
        today,
        window_end: "10:30 AM",
        count: 2,
        lanes: {
          morning: [{ order_number: "A1002", name: "ZZ Test Two", trip: "", trip_fallback: "Hotel A", channel: "sms", fallback_channel: "", direction: "sms_in", body: "hi", created_at: iso(H), pending_since: iso(H), is_modify: false, tour_date: today, track_url: `/admin/notifications/morning-pickup/tracking?date=${today}` }],
          tour: [{ order_number: "T1", name: "ZZ Tour", trip: "Yosemite", trip_fallback: "", channel: "sms", fallback_channel: "", direction: "sms_in", body: "hi", created_at: iso(H), pending_since: iso(H), is_modify: false, tour_date: today, track_url: `/admin/notifications/tour-confirmation/tracking?date=${today}` }],
          tickets: [],
        },
      });
    if (p === "/api/notifications/morning-pickup/tracking") {
      const date = url.searchParams.get("date");
      return send(res, 200, {
        date,
        tracking_window: { end_minute: ctl.endMinute, end_label: ctl.endMinute === 0 ? "12:00 AM" : "11:59 PM" },
        rows: date === today ? rows : [],
      });
    }
    let m = p.match(/^\/api\/bookings\/(\d+)\/take-action$/);
    if (m && req.method === "PUT") {
      const r = rows.find((x) => x.id === Number(m[1]));
      if (!r) return send(res, 404, { detail: "Booking not found" });
      // slowTake：模拟写得慢（毫秒），测写的时候换日期。
      if (ctl.slowTake) await new Promise((ok) => setTimeout(ok, ctl.slowTake));
      r.action_taken_by = r.action_taken_by ? "" : "ZZ Test";
      // 标记写完的时刻：之后的第一次 tracking 请求就是写完后的重拉。
      log.push({ method: "MARK", path: "take-action-done", query: "" });
      return send(res, 200, { ok: true, action_taken_by: r.action_taken_by ? "zztest" : "", action_taken_at: null });
    }
    m = p.match(/^\/booking-notes\/by-order\/([^/]+)$/);
    if (m) {
      const order = decodeURIComponent(m[1]);
      const r = rows.find((x) => x.order_number === order);
      if (req.method === "POST") {
        const body = await readBody(req);
        entry.body = body;
        const fail = body.body.includes("FAILME");
        const note = {
          id: nextNoteId++,
          booking_id: r ? r.id : 0,
          order_number: order,
          author_username: "ZZ Test",
          direction: body.direction,
          body: body.body,
          sms_status: body.send_sms ? (fail ? "failed" : "sent") : null,
          email_status: body.send_email ? "sent" : null,
          created_at: "2026-10-03 08:00",
        };
        (notes[order] ||= []).push(note);
        if (r && body.direction === "staff_note") {
          r.notes_count += 1;
          r.latest_note_body = body.body;
          r.latest_note_direction = "staff_note";
          r.latest_note_author = "ZZ Test";
        }
        return send(res, 200, { note });
      }
      return send(res, 200, { notes: notes[order] || [], guest_note: "", action_taken_by: r ? r.action_taken_by : "" });
    }
    if (p === "/api/user-prefs/morning_col_order") {
      if (req.method === "PUT") {
        const body = await readBody(req);
        entry.body = body;
        pref = body.value;
        return send(res, 200, { ok: true });
      }
      return send(res, 200, { key: "morning_col_order", value: pref });
    }
    // ── Morning 发送页（审查修正：400 没发、No address、发送中后退）──
    if (p === "/api/notifications/morning-pickup/message-preview")
      return send(res, 200, { sms: "Morning SMS", guest_page: "<p>page</p>" });
    if (p === "/api/notifications/morning-pickup/preview" && req.method === "POST") {
      await readRaw(req);
      if (ctl.morningGuard) return send(res, 200, { total: guardRows.length, rows: guardRows, preview_at: GUARD_PREVIEW_AT });
      return send(res, 200, { total: morningRows.length, rows: morningRows });
    }
    if (p === "/send/morning-pickup" && req.method === "POST") {
      const raw = await readRaw(req);
      const field = (n) => (raw.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)`)) || [])[1];
      const orders = JSON.parse(field("selected_orders") || "[]");
      const sendType = field("send_type");
      entry.body = { orders, send_type: sendType, send_anyway: field("send_anyway"), preview_at: field("preview_at") };
      if (ctl.morning400) return send(res, 400, { detail: ctl.morning400 });
      if (ctl.morningDelay) await new Promise((ok) => setTimeout(ok, ctl.morningDelay));
      if (ctl.morningGuard) {
        // 同后端 send.py：没选中 → skipped 无 reason；同单第二行 → listed_twice；发过的除非 Send anyway + preview_at → already_sent。
        // ctl.morningSentSince：预览之后别人刚发过的单（服务端查到、页面不知道）。
        const anyway = JSON.parse(field("send_anyway") || "[]");
        const okPreview = field("preview_at") === GUARD_PREVIEW_AT;
        const seen = new Set();
        const results = guardRows.map((r) => {
          const base = { order: r.order_number, name: r.name, phone: r.phone, pickup_time: r.pickup_time, sms_status: "", email_status: "" };
          if (!orders.includes(r.order_number)) return { ...base, skipped: true, reason: "", message: "" };
          if (seen.has(r.order_number)) return { ...base, skipped: true, reason: "listed_twice", message: "Listed twice in this file" };
          seen.add(r.order_number);
          const sentBefore = r.duplicate || (ctl.morningSentSince || []).includes(r.order_number);
          if (sentBefore && !(r.duplicate && anyway.includes(r.order_number) && okPreview))
            return { ...base, skipped: true, reason: "already_sent", message: "Already sent today" };
          return { ...base, sms_status: r.phone ? "sent:SM1" : "failed: Twilio 21604 missing To", skipped: false };
        });
        return send(res, 200, { total: results.length, results });
      }
      const results = morningRows.map((r) => {
        if (!orders.includes(r.order_number))
          return { order: r.order_number, name: r.name, phone: r.phone, pickup_time: r.pickup_time, sms_status: "", email_status: "", skipped: true };
        // 同后端：没手机号照样调短信接口 → failed；没邮箱不发、留空。
        const sms = sendType === "email" ? "" : r.phone ? "sent:SM1" : "failed: Twilio 21604 missing To";
        const email = sendType === "sms" ? "" : r.email ? "sent" : "";
        return { order: r.order_number, name: r.name, phone: r.phone, pickup_time: r.pickup_time, sms_status: sms, email_status: email, skipped: false };
      });
      return send(res, 200, { total: results.length, results });
    }
    send(res, 404, { detail: "mock: not found" });
  })
  .listen(8799, () => console.log("mock on 8799, today", today));
