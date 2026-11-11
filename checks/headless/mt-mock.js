// 模拟后端：Morning Tracking 页用到的接口 + dashboard 的两个接口。
// 控制：POST /__ctl {endMinute, fail401, pref, morning400, morningDelay}；GET /__log 取请求记录。
const http = require("http");
const staffPerm = require("./staff-perm-mock");
const outcomeMock = require("./outcome-mock");

const LA = "America/Los_Angeles";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: LA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const H = 3600_000;

// staleAction：A1005 点过 Take action 之后客人又来了留言（notes_unhandled，后端 `7c03bd3`）。
const ctl = { endMinute: 1439, fail401: false, multi: false, multi404: false, staleAction: false };
const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: LA, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 24 * H));
// Multi Orders 窗口的三张「不挂单」卡 + 一张「一单多团期」卡（ctl.multi 打开时才出现，见 /unhandled 里的说明）。
const MULTI_ADDR_ONE = "+15551230001"; // 有两张没出发的单：Reply / Assign / Assign 的 Move 都用它测。
const MULTI_ADDR_ZERO = "zztest-zero@example.test"; // 名下没有没出发的单：Take action 不经选单直接关。
const MULTI_ADDR_WAITING = "+15551230099"; // staff 已经回过、在等客人：不计入红胶囊。
const log = [];

// ── 司机实时页（ctl.live）：司机 / 导游在手机上标的。ISO 用今天洛杉矶的时间。
const laIso = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  // 洛杉矶 11 月是 PST（-08:00）；只用来显示几点，够了。
  return `${today}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-08:00`;
};
const LIVE_MARKS = {
  A1001: { status: "picked_up", at: laIso("05:42"), driver: "Mike", van: "Van 12" },
  A1002: { status: "no_show", at: laIso("06:03"), driver: "Mike", van: "Van 12" },
  A1003: { status: "boarded", at: laIso("07:02"), driver: "Ana", van: "Bus A" },
};
const relayGuest = (id, first, last, pax, order) => {
  const mk = LIVE_MARKS[order];
  const st = mk && mk.driver === "Mike" ? mk : null;
  return { id, first_name: first, last_name: last, pax, order_number: order, short_tag: order === "A1001" ? "GC" : "", phone: "+15550000000", relay_status: st ? st.status : null, relay_status_at: st ? st.at : null, checked_in_at: order === "A1001" ? "5:31 AM" : "" };
};
const tourGuest = (id, name, pax, order) => {
  const mk = LIVE_MARKS[order];
  const st = mk && mk.driver === "Ana" ? mk : null;
  return { id, name, guide_name: name, pax, order_number: order, ...(order === "A1003" ? { short_tag: "ZN" } : {}), lunch_text: "1 B 1 T", guide_lunch: { text: "1 B 1 T", bad: false }, boarding: st ? st.status : null, boarding_at: st ? st.at : null, relay_status: null };
};
function livePeople() {
  const g1 = relayGuest(1, "ZZ Test", "One", 2, "A1001");
  const g2 = relayGuest(2, "ZZ Test", "Two", 2, "A1002");
  const t3 = tourGuest(3, "ZZ Test Three", 2, "A1003");
  const t4 = tourGuest(4, "ZZ Test Four", 1, "A1004");
  const picked = [g1, g2].filter((g) => g.relay_status === "picked_up").reduce((a, g) => a + g.pax, 0);
  const ns = [g1, g2].filter((g) => g.relay_status === "no_show").reduce((a, g) => a + g.pax, 0);
  return [
    {
      kind: "driver", hr_id: 11, name: "Mike", first_shift: "relay", error: false,
      segments: [{
        id: 101, shift: "relay", kind: "", when: "", title: "Morning Relay · 1st Round", van: "Van 12", tour_unset: false,
        manifest: null, tour_compact: null, relay_guests: [g1, g2], relay_farm_out_guests: [],
        relay_summary: { pax: 4, pickups: 2, first: "5:40 AM", last: "5:55 AM", picked_up: picked, no_show: ns },
        relay_blocks: [
          { time: "5:40 AM", hotel: "ZZ Test Excalibur", spot: "South entrance", pax: 2, bookings: 1, guests: [g1], ...(ctl.noArrival ? {} : { arrived_at: laIso("05:38"), left_at: laIso("05:46") }) },
          { time: "5:55 AM", hotel: "ZZ Test Luxor", spot: "Taxi line", pax: 2, bookings: 1, guests: [g2], ...(ctl.noArrival ? {} : { arrived_at: laIso("05:53"), left_at: null }) },
        ],
      }],
      inbox: { unread_total: 1, threads: [{ order_number: "A1002", guest_name: "ZZ Test Two", pax: 2, pickup_location: "ZZ Test Luxor", pickup_time: "5:55 AM", van: "Van 12", last: { text: "Running 10 min late", at: laIso("05:58"), time: "5:58 AM", from: "guest" }, last_guest_text: "Running 10 min late", unread: true }] },
    },
    {
      kind: "guide", hr_id: 12, name: "Ana", first_shift: "tour", error: false,
      runs: [{
        id: 201, tour: "ZZ Test Grand Canyon", bus_label: "A", van: "Coach 21",
        manifest: {
          summary: { pax: 3, pickups: 1, first: "7:00 AM", last: "7:00 AM", picked_up: 2, no_show: 0 },
          guide_lunch_bar: [{ n: 2, label: "Beef" }, { n: 1, label: "Turkey" }],
          blocks: [{ time: "7:00 AM", hotel: "Treasure Island", kind: "tour", label: "Bus tour", pax: 3, bookings: 2, guests: [t3, t4] }],
        },
        relay_no_show: [],
      }],
    },
  ];
}
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
    notes_unhandled: false,
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
    driver_live_van: "771 B",
    guest_viewed_at: "2026-10-08T14:42:00Z",
    guest_link_stale: true,
    sms_status: "delivered",
    email_state: "clicked",
    checkin_status: "checked_in",
    checkin_time: iso(0.5 * H),
    notes_count: 2,
    latest_note_body: "Running late",
    latest_note_direction: "sms_in",
    latest_note_channel: "sms",
    notes_unhandled: true,
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
    driver_live_van: "",
    // G234：发送后在 Dispatch 换了司机（FREDDY → Ana），链接已跟新司机。
    driver_followed: { from: "FREDDY", to: "Ana", at: "2026-10-08T05:10:00-07:00", by: "annie" },
    guest_viewed_at: null,
    guest_link_stale: false,
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

const noEmailRow = row({ id: 6, order_number: "A1006", name: "ZZ Test Six", email: "", driver: "Ana" });

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
// 车号无效那一组（后端 0168958）：M02 车号 "0"、M04 空、M06 不在车辆表；M11 今天发过又车号无效；M12 今天发过。
const vanBad = new Set(["M02", "M04", "M06", "M11"]);
const vanRows = [
  ...morningRows.slice(0, 6),
  { ...morningRows[10], duplicate: true, sent_by: "annie", sent_at: "2026-10-06T12:30:00+00:00", partial: null },
  { ...morningRows[11], duplicate: true, sent_by: "annie", sent_at: "2026-10-06T12:31:00+00:00", partial: null },
].map((r) => ({ ...r, vehicle_no: r.order_number === "M04" ? "" : vanBad.has(r.order_number) ? "0" : "B12", van_invalid: vanBad.has(r.order_number) }));
function readRaw(req) {
  return new Promise((resolve) => {
    const c = [];
    req.on("data", (d) => c.push(d));
    req.on("end", () => resolve(Buffer.concat(c).toString("utf8")));
  });
}

const notes = {
  A1001: [
    // 后端 E188：电话 AI 替客人留的言。
    { id: 12, booking_id: 1, author_username: "voice_agent", direction: "voice_in", body: "Guest called: no confirmation yet", sms_status: null, email_status: null, created_at: "2026-10-03 07:20" },
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
      // 司机实时页：导游刚标了一位 No show（测 NEW / 页签数字）；clearNoShow 改回没标。
      if (ctl.addNoShow) {
        LIVE_MARKS[ctl.addNoShow] = { status: "no_show", at: laIso("07:05"), driver: "Ana", van: "Bus A" };
        delete ctl.addNoShow;
      }
      if (ctl.clearMark) {
        delete LIVE_MARKS[ctl.clearMark];
        delete ctl.clearMark;
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
    if (staffPerm(ctl, p, res, send)) return; // 10c：模拟员工权限总开关开着的员工 / Super Admin（staff-perm-mock.js）

    // Dashboard 的 Reply 弹框（本批新功能，默认只 Super Admin）：这套检查当作已放给员工。
    if (p === "/api/settings/dashboard-widgets") return send(res, 200, { readable: true, widgets: [["dashboard_stats", "Today at a glance"], ["dashboard_today_team", "Today's team"], ["dashboard_reply", "Reply pop-up in Messages"]].map(([key, label]) => ({ key, label, visibility: "staff", default: "super_admin_only", visible_to_me: true })) });
    if (p === "/api/me")
      return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: "admin", is_admin: true, is_superadmin: false });
    if (p === "/api/notifications/unhandled") {
      const multi = ctl.multi
        ? [
            {
              kind: "unassigned", order_number: "", name: "ZZ Test Multi One", trip: "", trip_fallback: "",
              channel: "sms", fallback_channel: "", direction: "sms_in", body: "Which day is my refund for?",
              created_at: iso(2 * H), pending_since: iso(2 * H), is_modify: false, tour_date: "", track_url: "",
              address: MULTI_ADDR_ONE, waiting: false, reply_channel: "sms",
              orders: [
                { order_number: "MO01", trip: "Yosemite Day Trip", dates: [today], lanes: ["bus"] },
                { order_number: "MO02", trip: "Zion Day Trip", dates: [tomorrow], lanes: ["bus"] },
              ],
              thread: [{ author: "", body: "Which day is my refund for?", direction: "sms_in", channel: "sms", created_at: iso(2 * H), failed: false }],
            },
            {
              kind: "unassigned", order_number: "", name: "", trip: "", trip_fallback: "",
              channel: "email", fallback_channel: "", direction: "email_in", body: "Please cancel one of my trips",
              created_at: iso(3 * H), pending_since: iso(3 * H), is_modify: false, tour_date: "", track_url: "",
              address: MULTI_ADDR_ZERO, waiting: false, reply_channel: "email",
              orders: [],
              thread: [{ author: "", body: "Please cancel one of my trips", direction: "email_in", channel: "email", created_at: iso(3 * H), failed: false }],
            },
            {
              kind: "unassigned", order_number: "", name: "ZZ Test Waiting", trip: "", trip_fallback: "",
              channel: "sms", fallback_channel: "", direction: "sms_in", body: "ok thanks",
              created_at: iso(5 * H), pending_since: iso(5 * H), is_modify: false, tour_date: "", track_url: "",
              address: MULTI_ADDR_WAITING, waiting: true, reply_channel: "sms",
              orders: [{ order_number: "MO03", trip: "Horseshoe Bend", dates: [tomorrow], lanes: ["bus"] }],
              thread: [
                { author: "", body: "ok thanks", direction: "sms_in", channel: "sms", created_at: iso(5 * H), failed: false },
                { author: "ZZ Test", body: "Got it, see you then!", direction: "sms_out", channel: "sms", created_at: iso(4 * H), failed: false },
              ],
            },
            {
              order_number: "MO10", name: "ZZ Test Trip", trip: "Bryce Canyon", trip_fallback: "",
              channel: "sms", fallback_channel: "", direction: "sms_in", body: "can I move my second date?",
              created_at: iso(H), pending_since: iso(H), is_modify: false, tour_date: today,
              track_url: `/admin/notifications/tour-confirmation/tracking?date=${today}`,
              kind: "multi_trip", dates: [today, tomorrow],
            },
          ]
        : [];
      return send(res, 200, {
        today,
        window_end: "10:30 AM",
        count: 2 + multi.filter((it) => !it.waiting).length,
        lanes: {
          morning: [{ order_number: "A1002", name: "ZZ Test Two", trip: "", trip_fallback: "Hotel A", channel: "sms", fallback_channel: "", direction: "sms_in", body: "hi", created_at: iso(H), pending_since: iso(H), is_modify: false, tour_date: today, track_url: `/admin/notifications/morning-pickup/tracking?date=${today}` }],
          tour: [{ order_number: "T1", name: "ZZ Tour", trip: "Yosemite", trip_fallback: "", channel: "sms", fallback_channel: "", direction: "sms_in", body: "hi", created_at: iso(H), pending_since: iso(H), is_modify: false, tour_date: today, track_url: `/admin/notifications/tour-confirmation/tracking?date=${today}` }],
          tickets: [],
          multi,
        },
      });
    }
    if (p === "/api/notifications/morning-pickup/tracking") {
      const date = url.searchParams.get("date");
      // 司机实时页（ctl.live）：每行多 live_status / live_status_at / live_driver / live_van / ns_unhandled（后端 fc 定）。
      // ns_unhandled 模拟「标在最后一次 Take action 之后」：No show 而且还没人点 Take action。
      // 置顶 58：ctl.arrivals = 新后端，每行带 arrived_at / left_at（A1001 到了又走、A1002 到了没走、其余 null）。
      const ARR = { A1001: { arrived_at: laIso("05:38"), left_at: laIso("05:46") }, A1002: { arrived_at: laIso("05:53"), left_at: null } };
      const withArrivals = (r) => (ctl.arrivals ? { ...r, ...(ARR[r.order_number] || { arrived_at: null, left_at: null }) } : r);
      const withLive = (r0) => {
        const r = withArrivals(r0);
        if (!ctl.live) return r;
        const mk = LIVE_MARKS[r.order_number];
        if (!mk) return { ...r, live_status: null, live_status_at: null, live_driver: "", live_van: "", ns_unhandled: false };
        return { ...r, live_status: mk.status, live_status_at: mk.at, live_driver: mk.driver, live_van: mk.van, ns_unhandled: mk.status === "no_show" && !r.action_taken_by };
      };
      return send(res, 200, {
        date,
        tracking_window: { end_minute: ctl.endMinute, end_label: ctl.endMinute === 0 ? "12:00 AM" : "11:59 PM" },
        rows: date !== today ? [] : [
          ...(ctl.staleAction ? rows.map((r) => (r.id === 5 ? { ...r, notes_unhandled: true } : r)) : rows).map(withLive),
          // 有电话、没邮箱：测对话框「短信最多两段」没邮箱时的提示（Annie 2026-10-15）。
          ...(ctl.noEmailRow ? [noEmailRow] : []),
        ],
      });
    }
    if (p === "/api/notifications/morning-pickup/live-drivers") {
      if (ctl.liveForbidden) return send(res, 403, { detail: "Live drivers is not open to you." });
      const date = url.searchParams.get("date");
      // liveCompact：再加一位有单独导游的团车司机（driver_tour_view：只看数字 + shuttle 块，名单是 null）。
      const compact = {
        kind: "driver", hr_id: 13, name: "Sam", first_shift: "tour", error: false, inbox: { unread_total: 0, threads: [] },
        segments: [{ id: 301, shift: "tour", kind: "", when: "", title: "ZZ Test West Rim", van: "Coach 30", tour_unset: false,
          manifest: null, relay_guests: null, relay_farm_out_guests: null,
          tour_compact: { total: 40, first: "7:00 AM", guide: "Ana", my_relay: 0, ti: 12, other_relay: 26, no_show: 2, not_split: false, unplaced: 3,
            shuttles: [{ label: "Shuttle outbound", kind: "outbound", time: "6:30 AM", hotel: "ZZ Test Shuttle Stop", product: "ZZ Test Shuttle", pax: 5, bookings: 2 }] } }],
      };
      return send(res, 200, { date, people: date === today ? [...livePeople(), ...(ctl.liveCompact ? [compact] : [])] : [] });
    }
    let m = p.match(/^\/api\/bookings\/(\d+)\/take-action$/);
    if (m && req.method === "PUT") {
      const r = rows.find((x) => x.id === Number(m[1]));
      if (!r) return send(res, 404, { detail: "Booking not found" });
      // slowTake：模拟写得慢（毫秒），测写的时候换日期。
      if (ctl.slowTake) await new Promise((ok) => setTimeout(ok, ctl.slowTake));
      // 同后端 G47：want=on 记上（已记过的重新记）、want=off 清掉、不带 = 开关；别的值 400。
      const want = url.searchParams.get("want");
      if (want && want !== "on" && want !== "off") return send(res, 400, { detail: "want must be on or off" });
      r.action_taken_by = want === "on" ? "ZZ Test" : want === "off" ? "" : r.action_taken_by ? "" : "ZZ Test";
      // 同后端：点了 = 两栏都算处理过；撤销 = 两栏回到没处理。
      r.notes_unhandled = r.wa_unhandled = !r.action_taken_by;
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
          sms_status: body.send_sms ? (fail ? "failed" : body.body.includes("NOCHANNEL") ? "no_channel" : "sent") : null,
          email_status: body.send_email ? (body.body.includes("FAILMAIL") ? "failed" : "sent") : null,
          created_at: "2026-10-03 08:00",
        };
        // 置顶 109 W3（后端 ceba9aaa）：正文带「W3」⇒ 回包加三个 outcome。NOPHONE = 没号码（sms_status null，同后端）、
        // NOMAIL = 没邮箱、NOCHANNEL = 没有可用短信渠道（skipped）、FAILME / FAILMAIL = 发失败。
        let w3 = null;
        if (body.body.includes("W3") && (body.send_sms || body.send_email)) {
          const t = body.body;
          const sms = !body.send_sms ? "not_used" : t.includes("NOPHONE") ? "no_address" : t.includes("NOCHANNEL") ? "skipped" : fail ? "failed" : "sent";
          const email = !body.send_email ? "not_used" : t.includes("NOMAIL") ? "no_address" : t.includes("FAILMAIL") ? "failed" : "sent";
          if (sms === "no_address") note.sms_status = null;
          if (email === "no_address") note.email_status = "skipped - no email";
          const used = [sms, email].filter((c) => c !== "not_used");
          const outcome = used.includes("sent") ? "sent" : used.includes("failed") ? "failed" : used.every((c) => c === "no_address") ? "no_contact" : "not_sent";
          w3 = { outcome, sms_outcome: sms, email_outcome: email };
        }
        (notes[order] ||= []).push(note);
        if (r && body.direction === "staff_note") {
          r.notes_count += 1;
          r.latest_note_body = body.body;
          r.latest_note_direction = "staff_note";
          r.latest_note_author = "ZZ Test";
        }
        return send(res, 200, w3 ? { note, ...w3 } : { note });
      }
      return send(res, 200, { notes: notes[order] || [], guest_note: "", action_taken_by: r ? r.action_taken_by : "" });
    }
    // ── dashboard Multi Orders 卡片的三个动作 ──
    if (p === "/booking-notes/multi/reply" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      if (ctl.multi404 && body.address === MULTI_ADDR_ONE) return send(res, 404, { detail: "Conversation not found or already assigned" });
      const failed = (body.body || "").includes("FAILSEND");
      // 置顶 109 W3：W3SKIP = 没有可用短信渠道（status no_channel，outcome not_sent / sms_outcome skipped）。
      if ((body.body || "").includes("W3SKIP")) return send(res, 200, { ok: true, channel: "sms", status: "no_channel", outcome: "not_sent", sms_outcome: "skipped", email_outcome: "not_used" });
      return send(res, 200, { ok: true, channel: body.address === MULTI_ADDR_ZERO ? "email" : "sms", status: failed ? "failed" : "sent" });
    }
    if (p === "/booking-notes/multi/assign" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      if (ctl.multi404 && body.address === MULTI_ADDR_ONE) return send(res, 404, { detail: "Conversation not found or already assigned" });
      return send(res, 200, { ok: true });
    }
    if (p === "/booking-notes/multi/take-action" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      if (ctl.multi404 && body.address === MULTI_ADDR_ONE) return send(res, 404, { detail: "Conversation not found or already assigned" });
      return send(res, 200, { ok: true });
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
      if (ctl.morningVan)
        return send(res, 200, { total: vanRows.length, rows: vanRows, preview_at: GUARD_PREVIEW_AT, van_invalid_count: vanRows.filter((r) => r.van_invalid).length });
      if (ctl.morningGuard) return send(res, 200, { total: guardRows.length, rows: guardRows, preview_at: GUARD_PREVIEW_AT });
      return send(res, 200, { total: morningRows.length, rows: morningRows });
    }
    if (p === "/send/morning-pickup" && req.method === "POST") {
      const raw = await readRaw(req);
      const field = (n) => (raw.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)`)) || [])[1];
      const orders = JSON.parse(field("selected_orders") || "[]");
      const sendType = field("send_type");
      entry.body = { orders, send_type: sendType, send_anyway: field("send_anyway"), van_anyway: field("van_anyway"), preview_at: field("preview_at") };
      if (ctl.morning400) return send(res, 400, { detail: ctl.morning400 });
      if (ctl.morningDelay) await new Promise((ok) => setTimeout(ok, ctl.morningDelay));
      if (ctl.morningVan) {
        // 同后端 send.py：没选中 → skipped 无 reason；车号无效又不在 van_anyway → invalid_van；发过的不在 send_anyway → already_sent。
        // ctl.morningVanIgnore：假装 van_anyway 没带（看 invalid_van 在结果里的写法）。
        const anyway = JSON.parse(field("send_anyway") || "[]");
        const vanOk = ctl.morningVanIgnore ? [] : JSON.parse(field("van_anyway") || "[]");
        const results = vanRows.map((r) => {
          const base = { order: r.order_number, name: r.name, phone: r.phone, pickup_time: r.pickup_time, sms_status: "", email_status: "" };
          if (!orders.includes(r.order_number)) return { ...base, skipped: true, reason: "", message: "" };
          if (r.van_invalid && !vanOk.includes(r.order_number))
            return { ...base, skipped: true, reason: "invalid_van", message: "Vehicle # missing or not recognised — fix it in the file and upload again, or tick Send anyway" };
          if (r.duplicate && !anyway.includes(r.order_number)) return { ...base, skipped: true, reason: "already_sent", message: "Already sent today" };
          return { ...base, sms_status: r.phone ? "sent:SM1" : "failed: Twilio 21604 missing To", skipped: false };
        });
        return send(res, 200, { total: results.length, results });
      }
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
        // 旧后端：没手机号照样调短信接口 → failed；没邮箱不发、留空。
        // 置顶 109：ctl.newOutcome = 新后端——没号码记 "skipped - no phone"，每行带 outcome / *_outcome。
        if (ctl.newOutcome) {
          const sms = sendType === "email" ? "" : r.phone ? "sent:SM1" : "skipped - no phone";
          const email = sendType === "sms" ? "" : r.email ? "sent" : "skipped - no email";
          const row = { order: r.order_number, name: r.name, phone: r.phone, pickup_time: r.pickup_time, sms_status: sms, email_status: email, skipped: false };
          return outcomeMock.withOutcome(row, { sms: outcomeMock.channel(sms, sendType !== "email"), email: outcomeMock.channel(email, sendType !== "sms") });
        }
        const sms = sendType === "email" ? "" : r.phone ? "sent:SM1" : "failed: Twilio 21604 missing To";
        const email = sendType === "sms" ? "" : r.email ? "sent" : "";
        return { order: r.order_number, name: r.name, phone: r.phone, pickup_time: r.pickup_time, sms_status: sms, email_status: email, skipped: false };
      });
      if (ctl.newOutcome) return send(res, 200, { total: results.length, ...outcomeMock.counts(results.filter((r) => !r.skipped)), results });
      return send(res, 200, { total: results.length, results });
    }
    send(res, 404, { detail: "mock: not found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("mock on", process.env.MOCK_PORT || 8799, "today", today));
