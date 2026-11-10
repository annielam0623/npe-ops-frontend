// 模拟后端：/manifests 页（后端 task/manifests-fields 契约 A–D，提交 04f3fa0）。
// 控制：POST /__ctl {fail401, role, fail, prefsFail, prefs:{bus,tickets}}；GET /__log。
// 置顶 74：/__ctl {waiver: true} 开 Brenda 胶囊（t:brenda，每行带 waiver_link_required + waiver 四列，形状照后端 brenda-waiver-link）；
//   {seedWaiver: true} 重置 waiver 数据；waiverPutFail：PUT 回 500。
// role: admin（默认，有金额组）| staff（没有金额组）| driver（403）。
const http = require("http");
const staffPerm = require("./staff-perm-mock");
const outcomeMock = require("./outcome-mock");
// sections：Antelope（g:3）分两节；sendFail：发送接口回 "400" / "502"；sendOf：记下每次发送的请求体。
// minus15：后端 7c 减 15 上线后（有 guest_pickup_time，CHD1002 当成 Rezdy 时间读不出 ⇒ 空）。
// busTour：{订单号: 产品默认的 tour type 键}，没列的是 ""（产品没配）。
// 这一天上次从 Rezdy 同步（{at, by} 或 null；/__ctl {rezdyLast} 设）。
let rezdyLast = null;
const ctl = { hiddenMode: "today", fail401: false, role: "admin", moneyAdminOnly: false, fail: false, prefsFail: false, cfm404: false, sections: false, sendFail: "", minus15: false, bcAlready: [], bcRace: [], bcBusy: false, bcCheckFail: 0, rezdyListsErr: "", busTour: {}, msgNames: null, msgEmails: null, sendDelay: 0, cfmPreviewFail: false, reminderSent: [], noBatch: false, cfmRule: null };
// cfmRule（后端 51ffe2ca 门票 Cfm # 规则）：null = 旧后端（行不带 cfm_not_needed / cfm_short，对比不带 current_too_short）；
// { notNeeded: [订单号] } = 这些单的门票团不需要 Cfm #（Hogan）。号短不短照后端算：整串里数字不到 6 个。
const cfmDigits = (v) => [...String(v ?? "")].filter((c) => c >= "0" && c <= "9").length;
const shortCfm = (v) => !!String(v ?? "").trim() && cfmDigits(v) < 6;
let batchSeq = 9000;
// 后端 G154：send_sms / send_email 都缺省 = SMS + Email；传了就都得是 bool、不能都 false。
function channels(body) {
  const { send_sms: sms, send_email: email } = body;
  if (sms === undefined && email === undefined) return { sms: true, email: true };
  if (typeof sms !== "boolean" || typeof email !== "boolean" || (!sms && !email)) return null;
  return { sms, email };
}
const GUEST_PICKUP = { key: "guest_pickup_time", label: "Pickup time", group: "trip", type: "text" };
function minus15(t, orderNumber) {
  const m = /^(\d{1,2}):(\d{2}) ([AP]M)$/.exec(t || "");
  if (!m || orderNumber === "CHD1002") return "";
  let mins = ((+m[1] % 12) + (m[3] === "PM" ? 12 : 0)) * 60 + +m[2] - 15;
  mins = (mins + 1440) % 1440;
  const h = Math.floor(mins / 60);
  return `${h % 12 || 12}:${String(mins % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
// 发过的：row_key → ISO。CHD1002 的团确认 10/6 已发过（测「已发过、跳过」和 Send anyway）。
const sentTour = new Map();
const sentTickets = new Map();
const prefs = { manifest_cols_bus: null, manifest_cols_tickets: null, manifest_cols_admin_fee: null };
const log = [];
const cfm = new Map(); // row_key → {confirmation_no, updated_by, updated_at}
// G245（置顶 82）：ctl.mismatch = 这几单 Rezdy 的 Cfm # 跟产品不符（staff 填了 Cfm # 就不算）；ctl.mismatchLate = 页面上没标、发的那一刻后端才挡。
const MISMATCH = { other_label: "Antelope Canyon X Confirmation #", other_value: "387826855" };
const mismatchOf = (order, key) => ((ctl.mismatch ?? []).includes(order) && !cfm.get(key)?.confirmation_no ? MISMATCH : null);
// G198（后端 8a bbf3d08）：按「日期 + 团 + 节」存的 Cfm #。ctl.g198 开着时 Antelope 的 UPPER ANTELOPE 节开了格。
const sectionCfm = new Map(); // `${date}|${manifest_id}|${section}` → {cfm_no, updated_by, updated_at}

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function g198Section(date, section) {
  const c = sectionCfm.get(`${date}|3|${section}`);
  return { show_cfm: true, cfm_no: c?.cfm_no ?? "", cfm_updated_by: c?.updated_by ?? null, cfm_updated_at: c?.updated_at ?? null, tour_time: "12:40P", checkin_time: "12:10P" };
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d ? JSON.parse(d) : null));
  });
}

const GROUPS = [
  { key: "guest", label: "Guest" },
  { key: "trip", label: "Trip" },
  { key: "booking", label: "Booking" },
  { key: "ours", label: "Our records" },
  { key: "questions", label: "Booking questions" },
  { key: "money", label: "Money" },
];
const BASE_CATALOG = [
  { key: "guest_name", label: "Guest", group: "guest", type: "text" },
  { key: "phone", label: "Phone", group: "guest", type: "text" },
  { key: "pax", label: "Pax", group: "guest", type: "number" },
  { key: "product", label: "Product", group: "trip", type: "text" },
  { key: "start_time", label: "Start time", group: "trip", type: "text" },
  { key: "pickup_time", label: "Pickup time", group: "trip", type: "text" },
  { key: "pickup_location", label: "Pickup location", group: "trip", type: "text" },
  { key: "order_number", label: "Order #", group: "booking", type: "text" },
  { key: "rezdy_cfm", label: "Rezdy Cfm #", group: "booking", type: "text" },
  { key: "comments", label: "Comments", group: "booking", type: "text" },
  { key: "date_created", label: "Booked at", group: "booking", type: "datetime" },
  { key: "staff_cfm", label: "Cfm #", group: "ours", type: "text" },
  { key: "staff_cfm_by", label: "Cfm # by", group: "ours", type: "text" },
  { key: "staff_cfm_at", label: "Cfm # at", group: "ours", type: "datetime" },
  { key: "transfer_return", label: "Return transfer", group: "trip", type: "bool" },
  { key: "sent_tour_at", label: "Tour confirmation sent", group: "ours", type: "datetime" },
  { key: "sent_tickets_at", label: "Ticket reminder sent", group: "ours", type: "datetime" },
  { key: "sent_tour_by", label: "Tour confirmation by", group: "ours", type: "text" },
  { key: "sent_tickets_by", label: "Ticket reminder by", group: "ours", type: "text" },
  // 后端 auto-send（2026-10-15）：产品默认的 tour type 键，没配是 ""。Send tour confirmation 弹窗补拉它来预填。
  { key: "bus_tour_type", label: "Bus tour type", group: "ours", type: "text" },
];
const MONEY = [
  { key: "order_total", label: "Order total", group: "money", type: "money" },
  { key: "currency", label: "Currency", group: "money", type: "text" },
];
const BUS_QUESTION = { key: "q:0123456789", label: "Dietary needs?", group: "questions", type: "text" };
const PAX_QUESTION = { key: "pq:abcdef0123", label: "Passport name (per guest)", group: "questions", type: "text" };

const DEFAULTS = {
  // 同后端：默认列里有 Tour confirmation sent（勾选发送时判断「已发过」也靠它）。
  bus: ["order_number", "guest_name", "pax", "pickup_time", "pickup_location", "rezdy_cfm", "staff_cfm", "sent_tour_at"],
  tickets: ["order_number", "guest_name", "pax", "start_time", "rezdy_cfm", "staff_cfm", "sent_tickets_at"],
};

// 当天的行：Bus 三颗胶囊（A→Z，none 最后），Tickets 两颗。值是这一行的全部字段，按 fields 裁剪后返回。
const ROWS = [
  { tab: "bus", pill: "g:3", order_number: "CHD1001", product_code: "ANT01", lane_source: "rezdy_bookings",
    v: { guest_name: "ZZ Test One", phone: "+15550000001", pax: 2, product: "Antelope Bus", pickup_time: "7:00 AM", pickup_location: "Aria",
      rezdy_cfm: "RZ-1", comments: "Window seat please, we are celebrating an anniversary trip with family", date_created: "2026-10-01T17:30:00Z",
      transfer_return: true, order_total: 249.5, currency: "USD", "q:0123456789": "Vegetarian", "pq:abcdef0123": "ZZ ONE; ZZ ONE JR" } },
  { tab: "bus", pill: "g:3", order_number: "CHD1002", product_code: "ANT01", lane_source: "legacy",
    v: { guest_name: "ZZ Test Two", phone: "=cmd", pax: 4, product: "Antelope Bus", pickup_time: "7:15 AM", pickup_location: "Resorts World",
      rezdy_cfm: null, comments: null, date_created: null, transfer_return: false, order_total: 100, currency: "USD" } },
  { tab: "bus", pill: "g:7", order_number: "CHD1003", product_code: "GCW01", lane_source: "rezdy_bookings",
    v: { guest_name: "ZZ Test Three", phone: "", pax: 1, product: "Grand Canyon West", pickup_time: "6:00 AM", pickup_location: "MGM Grand",
      rezdy_cfm: "RZ-3", order_total: 99, currency: "USD", "q:0123456789": "None" } },
  { tab: "bus", pill: "g:none", order_number: "CHD1004", product_code: "ZZNEW", lane_source: "rezdy_bookings",
    v: { guest_name: "ZZ Test Four", pax: 3, product: "ZZ New Product", pickup_time: "8:00 AM", order_total: 10, currency: "USD" } },
  { tab: "tickets", pill: "t:antelope", order_number: "CHD2001", product_code: "TIX01", lane_source: "rezdy_bookings",
    v: { guest_name: "ZZ Ticket One", pax: 2, product: "Antelope Tickets", start_time: "2026-10-07 07:00:00", order_total: 120, currency: "USD", "pq:abcdef0123": "ZZ T1" } },
  { tab: "tickets", pill: "t:none", order_number: "CHD2002", product_code: "TIX99", lane_source: "rezdy_bookings",
    v: { guest_name: "ZZ Ticket Two", pax: 1, product: "ZZ Ticket NoType", start_time: "2026-10-07 09:30:00" } },
];
// bulk：Grand Canyon West（g:7）多 12 单，测超过 10 位时分批发。
const BULK = Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return { tab: "bus", pill: "g:7", order_number: `CHD15${n}`, product_code: "GCW01", lane_source: "rezdy_bookings",
    v: { guest_name: `ZZ Bulk ${n}`, phone: `+155500015${n}`, pax: 1, product: "Grand Canyon West", pickup_time: "6:00 AM", pickup_location: "MGM Grand" } };
});
// cfmMix：Antelope Canyon（t:antelope）同一颗胶囊再加一单没有 Cfm # 的（CHD2001 有、这单没有），
// 测「同一屏既有能发的又有缺号的」混合勾选（任务 task/tickets-cfm-manual-select）。门 pill 不变，不影响胶囊 / 索引数量。
const MIXED = [
  { tab: "tickets", pill: "t:antelope", order_number: "CHD2004", product_code: "TIX01", lane_source: "rezdy_bookings",
    v: { guest_name: "ZZ Ticket Three", pax: 1, product: "Antelope Tickets", start_time: "2026-10-07 08:00:00" } },
];
// rezdyTix：门票行只有 Rezdy 自带的号（rezdy_cfm），staff 没填——后端 has_cfm() 算有号，前端不能标红（审计 #1）。
const REZDY_ONLY = [
  { tab: "tickets", pill: "t:antelope", order_number: "CHD2005", product_code: "TIX01", lane_source: "rezdy_bookings",
    v: { guest_name: "ZZ Ticket Rezdy", pax: 1, product: "Antelope Tickets", start_time: "2026-10-07 08:30:00", rezdy_cfm: "RZ-2005" } },
];
// 置顶 74：Upper Antelope (Brenda) 每单 waiver link。CHD2101 没填、CHD2102 填了、CHD2103 发过后改了（Changed since sent）、
// CHD2104 Cfm # 和链接都没有、CHD2105 同胶囊但这张门票不要 waiver。
const WAIVER_ROWS = [
  ["CHD2101", "ZZ Brenda One", true],
  ["CHD2102", "ZZ Brenda Two", true],
  ["CHD2103", "ZZ Brenda Three", true],
  ["CHD2104", "ZZ Brenda Four", true],
  ["CHD2105", "ZZ Brenda Other", false],
].map(([o, name, req]) => ({ tab: "tickets", pill: "t:brenda", order_number: o, product_code: req ? "BREN1" : "BREN9", lane_source: "rezdy_bookings", waiver: req,
  v: { guest_name: name, pax: 2, product: "Upper Antelope Brenda", start_time: "2026-10-07 09:30:00", phone: "+15550002100" } }));
const waiver = new Map(); // row_key → {waiver_link, updated_by, updated_at}
const waiverSent = new Map(); // row_key → 最近一次发出去的链接
function seedWaiver() {
  waiver.clear();
  waiverSent.clear();
  for (const r of WAIVER_ROWS) sentTickets.delete(rowKey(r, today));
  const k = (o) => rowKey(WAIVER_ROWS.find((r) => r.order_number === o), today);
  for (const o of ["CHD2101", "CHD2102", "CHD2103", "CHD2105"]) cfm.set(k(o), { confirmation_no: `BR-${o.slice(-3)}`, updated_by: "zztest", updated_at: "2026-10-07T18:05:00+00:00" });
  waiver.set(k("CHD2102"), { waiver_link: "https://waiver.example.com/s/B2", updated_by: "veronica", updated_at: "2026-10-07T21:14:00+00:00" });
  waiver.set(k("CHD2103"), { waiver_link: "https://waiver.example.com/s/B3new", updated_by: "annie", updated_at: "2026-10-07T22:02:00+00:00" });
  sentTickets.set(k("CHD2103"), "2026-10-06T23:10:00+00:00");
  waiverSent.set(k("CHD2103"), "https://waiver.example.com/s/B3old");
}
const waiverStatus = (r, key) => {
  if (!r.waiver) return "";
  const link = waiver.get(key)?.waiver_link ?? "";
  if (!link) return "No waiver link";
  return waiverSent.has(key) && waiverSent.get(key) !== link ? "Changed since sent" : "";
};
const WAIVER_FIELDS = [
  { key: "waiver_link", label: "Waiver link", group: "ours", type: "text" },
  { key: "waiver_status", label: "Waiver status", group: "ours", type: "text" },
  { key: "waiver_link_by", label: "Waiver link by", group: "ours", type: "text" },
  { key: "waiver_link_at", label: "Waiver link at", group: "ours", type: "datetime" },
];
const goodLink = (v) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(v);
const allRows = () => (ctl.bulk ? [...ROWS, ...BULK] : ROWS).concat(ctl.cfmMix ? MIXED : []).concat(ctl.rezdyTix ? REZDY_ONLY : []).concat(ctl.waiver ? WAIVER_ROWS : []);
let sendCalls = 0;
const PILL_LABEL = {
  "g:3": "Antelope Bus Tour",
  "g:7": "Grand Canyon West",
  "g:none": "No group yet",
  "t:antelope": "Antelope Canyon",
  "t:brenda": "Upper Antelope (Brenda)",
  "t:none": "No tour type yet",
};
// G142：接口给的团颜色（Settings → Products → Manifest setup 配的），不是按团名猜的。
// g:3 故意给一个和按名字猜（antelope → 紫 #7a6ba8）不一样的颜色，用来证明真用了接口的值；
// g:7 故意不配（null），验证没配时照旧按团名猜（west → 橙）；门票 / none 恒 null，同接口文档。
const PILL_COLOR = { "g:3": "#111827", "g:7": null, "g:none": null, "t:antelope": null, "t:brenda": null, "t:none": null };
const rowKey = (r, date) => `${r.order_number}|${r.product_code}|${date}`;
const SECTION_OF = { CHD1001: "tour:UPPER ANTELOPE", CHD1002: "outbound:SHUTTLE: LAS VEGAS → PAGE" };
// 实际要发的号：staff 填的优先，没有再用 Rezdy 自带的（同后端 cfm_value）。
const cfmOf = (r, key) => (cfm.get(key)?.confirmation_no ?? "").trim() || String(r?.v?.rezdy_cfm ?? "").trim();
const byKey = (key) => allRows().find((r) => rowKey(r, today) === key);

/** 发送接口共用：400 / 502、row_key 不在名单里整批 400。failOnCall：第 N 次发送请求回 502（测分批中途出错）。 */
function sendGate(keys) {
  sendCalls += 1;
  if (ctl.failOnCall && sendCalls === ctl.failOnCall) return [502, { detail: "Bad gateway" }];
  if (ctl.sendFail === "400") return [400, { detail: "These guests are no longer on this day: CHD9999. Reload the page. Nothing was sent." }];
  if (ctl.sendFail === "502") return [502, { detail: "Bad gateway" }];
  // G232：后端逐行复核，一批里夹一条不能发的行（CHD 组）整批 400。
  const unsendable = keys.filter((k) => (ctl.unsendable ?? []).includes(byKey(k)?.order_number));
  if (unsendable.length) return [400, { detail: "These guests are no longer on this date. Reload the page. Nothing was sent." }];
  const missing = keys.filter((k) => !byKey(k));
  if (missing.length) return [400, { detail: `Not on this day: ${missing.join(", ")}` }];
  return null;
}

/** 已发过的跳过，除非 send_anyway 里有它（preview_at 有就行，mock 不比时间）。 */
function sendRows(keys, sentMap, body) {
  const anyway = new Set(body.send_anyway ?? []);
  const results = [];
  const skipped = [];
  for (const k of keys) {
    const r = byKey(k);
    const name = r.v.guest_name;
    // 同后端：勾了 Send anyway 的单，只有最近一次发送不晚于 preview_at 才再发（看名单之后又有人发过 ⇒ 照样跳过）。
    const again = anyway.has(r.order_number) && body.preview_at && Date.parse(sentMap.get(k)) <= Date.parse(body.preview_at);
    if (sentMap.has(k) && !again) {
      skipped.push({ order_number: r.order_number, chd_number: r.order_number, name, reason: "already_sent", message: "Already sent Oct 6, 4:12 PM" });
      continue;
    }
    sentMap.set(k, "2026-10-07T18:30:00+00:00");
    results.push(r);
  }
  return { results, skipped };
}

// G62 群发查重：check 回的 checked_at；已收过的每单「谁、几点」发的。
const BC_CHECKED_AT = "2026-10-07T18:40:00+00:00";
const bcSent = (o) => ({ order_number: o, sent_at: "2026-10-06T23:12:00+00:00", sent_by: "veronica" });

function counts(rows) {
  return { rows: rows.length, orders: new Set(rows.map((r) => r.order_number)).size, pax: rows.reduce((s, r) => s + (r.v.pax || 0), 0) };
}

// G232 admin_fee 标签（CHD 组 = Admin fee，不能发；adminFee 开着才有）。
// 真实的 3 个产品（Annie 2026-11-02 Products 截图）：PLU3N8「Upgrade」、PXLTL1「Mystical Ante upgrade fee」、PFYF01「Reschedule Fee」。
const ADMIN_FEE_PRODUCTS = { PLU3N8: "Upgrade", PXLTL1: "Mystical Ante upgrade fee", PFYF01: "Reschedule Fee" };
const ADMIN_FEE_ROWS = [
  { o: "CHD-88041", code: "PLU3N8", v: { guest_name: "ZZ Test Lee", agent_name: "Viator", pax: 2, status: "Confirmed", item_amount: 40, order_total: 40, total_paid: 40, total_due: 0, currency: "USD" } },
  { o: "CHD-88057", code: "PLU3N8", v: { guest_name: "ZZ Test Garcia", agent_name: "Direct", pax: 3, status: "Confirmed", item_amount: 60, order_total: 60, total_paid: 0, total_due: 60, currency: "USD" } },
  { o: "CHD-88063", code: "PXLTL1", v: { guest_name: "ZZ Test Patel", agent_name: "GetYourGuide", pax: 2, status: "Confirmed", item_amount: 30, order_total: 30, total_paid: 30, total_due: 0, currency: "USD" } },
  { o: "CHD-88102", code: "PFYF01", v: { guest_name: "ZZ Test Nguyen", agent_name: "Direct", pax: 1, status: "Confirmed", item_amount: 25, order_total: 25, total_paid: 25, total_due: 0, currency: "USD" } },
  { o: "CHD-88110", code: "PFYF01", v: { guest_name: "ZZ Test Smith", agent_name: "Direct", pax: 1, status: "Cancelled", item_amount: 25, order_total: 25, total_paid: 0, total_due: 0, currency: "USD" } },
].map((r) => {
  // G232：PLU3N8 / PXLTL1 没有团日期，后端放在订单的 LA 下单日（shown_on "order_date"）；PFYF01 照团日期。
  const undated = r.code !== "PFYF01";
  const fee = { "CHD-88041": "From Lower Antelope, per person", "CHD-88057": "From Lower Antelope, per person", "CHD-88063": "From Lower Antelope, per person", "CHD-88102": "Rescheduling Fee", "CHD-88110": "Upgrade Fee, Rescheduling Fee" }[r.o];
  return { ...r, v: { ...r.v, product: ADMIN_FEE_PRODUCTS[r.code], fee_item: fee }, shown_on: undated ? "order_date" : null,
    reason_label: undated ? "Admin fee - no tour date, shown on order date (Nov 2)" : "Admin fee - not sent, not dispatched" };
});
// adminFeeNullPax：CHD-88110 拿不到件数（pax null，8/16 前的老单会这样），标签 / 胶囊带 pax_unknown。
const feeRows = () => ADMIN_FEE_ROWS.map((r) => (ctl.adminFeeNullPax && r.o === "CHD-88110" ? { ...r, v: { ...r.v, pax: null } } : r));
const feeCounts = (rs) => ({ rows: rs.length, orders: rs.length, pax: rs.reduce((n, r) => n + (r.v.pax ?? 0), 0), pax_unknown: rs.filter((r) => r.v.pax === null).length });
const adminFeeTab = () => ({ key: "admin_fee", label: "CHD", sendable: false, ...feeCounts(feeRows()) });
const ADMIN_FEE_CATALOG = [
  { key: "order_number", label: "Order #", group: "booking", type: "text" },
  { key: "guest_name", label: "Guest", group: "guest", type: "text" },
  { key: "agent_name", label: "Agent", group: "booking", type: "text" },
  { key: "product", label: "Product", group: "trip", type: "text" },
  { key: "fee_item", label: "Fee item", group: "trip", type: "text" },
  { key: "pax", label: "Pax", group: "guest", type: "number" },
  { key: "status", label: "Status", group: "booking", type: "text" },
  { key: "item_amount", label: "Amount (this item)", group: "money", type: "money" },
  { key: "order_total", label: "Order total", group: "money", type: "money" },
  { key: "total_paid", label: "Paid", group: "money", type: "money" },
  { key: "total_due", label: "Due", group: "money", type: "money" },
];
const ADMIN_FEE_DEFAULTS = ["order_number", "guest_name", "agent_name", "product", "fee_item", "pax", "status", "item_amount", "order_total", "total_paid", "total_due"];
function adminFeePage(url, date) {
  const known = new Set([...ADMIN_FEE_CATALOG.map((f) => f.key), "currency"]);
  const asked = url.searchParams.get("fields");
  const fields = (asked ? asked.split(",").filter(Boolean) : ADMIN_FEE_DEFAULTS).filter((k) => known.has(k));
  // adminFeePills: "product" = 每个产品一个胶囊（p:<code>，后端要新加）；其他 = 按组一个 CHD 胶囊（g:9，后端现在的做法）。
  const byProduct = ctl.adminFeePills === "product";
  const dayFee = date === today ? feeRows() : [];
  const pills = byProduct
    ? Object.keys(ADMIN_FEE_PRODUCTS).filter((c) => dayFee.some((r) => r.code === c)).map((c) => {
        const rs = dayFee.filter((r) => r.code === c);
        return { key: "p:" + c, label: ADMIN_FEE_PRODUCTS[c], color: null, sendable: false, ...feeCounts(rs) };
      })
    : dayFee.length ? [{ key: "g:20", label: "CHD", color: null, sendable: false, ...feeCounts(dayFee) }] : [];
  const askedPill = url.searchParams.get("pill");
  const pill = pills.some((p) => p.key === askedPill) ? askedPill : pills[0]?.key ?? null;
  const rows = dayFee.filter((r) => !byProduct || "p:" + r.code === pill).map((r) => {
    const all = { ...r.v, order_number: r.o };
    const values = {};
    for (const k of fields) values[k] = all[k] ?? null;
    return { row_key: `${r.o}|${r.code}|${date}`, order_number: r.o, product_code: r.code, tour_date: date, lane_source: "rezdy_bookings", leg: null, section: null,
      sendable: false, reason: "unmapped_group", reason_label: r.reason_label, shown_on: r.shown_on, values };
  });
  const tabs = ["bus", "tickets"].map((k) => ({ key: k, label: k === "bus" ? "Bus Tour" : "Tickets - SelfDrive", sendable: true, ...counts(allRows().filter((r) => r.tab === k)) }));
  if (date === today) tabs.push(adminFeeTab());
  return [200, { date, tab: "admin_fee", is_admin: ctl.role === "admin", tabs, pills, pill, catalog: ADMIN_FEE_CATALOG, groups: GROUPS, default_fields: ADMIN_FEE_DEFAULTS, fields, denied: [], unknown: [], sections: [], rows }];
}

function page(url) {
  const date = url.searchParams.get("date") || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [400, { detail: "Bad date" }];
  const tab = url.searchParams.get("tab") || "bus";
  if (tab !== "bus" && tab !== "tickets" && !(tab === "admin_fee" && ctl.adminFee)) return [400, { detail: "Bad tab" }];
  if (tab === "admin_fee") return adminFeePage(url, date);
  const isAdmin = ctl.role === "admin";
  // 后端 639b41b（2026-10-11）起 Money 组所有 staff 都能看；moneyAdminOnly 模拟旧行为，用来测「存着但没权限」的提示。
  const moneyOpen = isAdmin || !ctl.moneyAdminOnly;
  const dayRows = date === today ? allRows() : [];
  const tabRows = dayRows.filter((r) => r.tab === tab);
  const pillKeys = [...new Set(tabRows.map((r) => r.pill))].sort((a, b) =>
    a.endsWith(":none") ? 1 : b.endsWith(":none") ? -1 : PILL_LABEL[a].localeCompare(PILL_LABEL[b]),
  );
  const pills = pillKeys.map((k) => ({ key: k, label: PILL_LABEL[k], color: PILL_COLOR[k] ?? null, ...counts(tabRows.filter((r) => r.pill === k)) }));
  const asked = url.searchParams.get("pill");
  const pill = pillKeys.includes(asked) ? asked : pillKeys[0] ?? null;
  // 问卷题只列当天该标签出现过的。
  const questions = [];
  if (tabRows.some((r) => "q:0123456789" in r.v)) questions.push(BUS_QUESTION);
  if (tabRows.some((r) => "pq:abcdef0123" in r.v)) questions.push(PAX_QUESTION);
  const catalog = [...BASE_CATALOG, ...(ctl.minus15 ? [GUEST_PICKUP] : []), ...(ctl.waiver ? WAIVER_FIELDS : []), ...questions, ...(moneyOpen ? MONEY : [])];
  const known = new Set(catalog.map((f) => f.key));
  const moneyKeys = new Set(MONEY.map((f) => f.key));
  const asked_fields = url.searchParams.get("fields");
  const requested = asked_fields ? asked_fields.split(",").filter(Boolean) : DEFAULTS[tab];
  const fields = requested.filter((k) => known.has(k));
  const denied = requested.filter((k) => !known.has(k) && moneyKeys.has(k));
  const unknown = requested.filter((k) => !known.has(k) && !moneyKeys.has(k));
  const sectionsOn = ctl.sections && tab === "bus" && pill === "g:3";
  const rows = tabRows
    .filter((r) => r.pill === pill)
    .map((r) => {
      const key = rowKey(r, date);
      const c = cfm.get(key);
      const all = { ...r.v, order_number: r.order_number, staff_cfm: c?.confirmation_no ?? null, staff_cfm_by: c?.updated_by ?? null, staff_cfm_at: c?.updated_at ?? null,
        sent_tour_at: sentTour.get(key) ?? null, sent_tickets_at: sentTickets.get(key) ?? null,
        sent_tour_by: sentTour.has(key) ? "ZZ Test Staff" : null, sent_tickets_by: sentTickets.has(key) ? "ZZ Test Staff" : null,
        guest_pickup_time: minus15(r.v.pickup_time, r.order_number), bus_tour_type: ctl.busTour[r.order_number] ?? "",
        ...(ctl.waiver ? { waiver_link: r.waiver ? (waiver.get(key)?.waiver_link ?? "") : "", waiver_status: waiverStatus(r, key),
          waiver_link_by: r.waiver ? (waiver.get(key)?.updated_by ?? "") : "", waiver_link_at: r.waiver ? (waiver.get(key)?.updated_at ?? null) : null } : {}) };
      const values = {};
      for (const k of fields) values[k] = all[k] ?? null;
      // 短信两段（Annie 2026-10-15）：msgNames 换名字测最长名字展开；msgEmails 给行加 email 值（"" = 没邮箱）。
      if (ctl.msgNames?.[r.order_number] && "guest_name" in values) values.guest_name = ctl.msgNames[r.order_number];
      if (ctl.msgEmails && r.order_number in ctl.msgEmails) values.email = ctl.msgEmails[r.order_number];
      return { row_key: key, order_number: r.order_number, product_code: r.product_code, tour_date: date, lane_source: r.lane_source,
        section: sectionsOn ? SECTION_OF[r.order_number] : null, values,
        ...(ctl.waiver ? { waiver_link_required: !!r.waiver } : {}),
        ...(ctl.mismatch ? { cfm_mismatch: mismatchOf(r.order_number, key) } : {}),
        ...(ctl.cfmRule && r.tab === "tickets"
          ? (() => {
              const nn = (ctl.cfmRule.notNeeded ?? []).includes(r.order_number);
              return { cfm_not_needed: nn, cfm_short: !nn && shortCfm(cfmOf(r, key)) };
            })()
          : {}),
        // G36：returnLeg 开着时把 CHD1002 当成往返 shuttle 的回程那一行。
        leg: ctl.returnLeg && r.order_number === "CHD1002" ? "return" : null,
        // G189：shuttleRows 里的单带 shuttle: true（后端每行的 shuttle 标记），其余 false；没设 = 旧后端，不带这个字段。
        ...(ctl.shuttleRows ? { shuttle: ctl.shuttleRows.includes(r.order_number) } : {}),
        // G232：unsendable 设了 = 新后端，每行带 sendable；列表里的单 false + 原因。没设 = 旧后端，不带。
        ...(ctl.unsendable
          ? ctl.unsendable.includes(r.order_number)
            ? { sendable: false, reason: "unmapped_group", reason_label: "The group is Unmapped" }
            : { sendable: true }
          : {}) };
    });
  const tabs = ["bus", "tickets"].map((k) => ({ key: k, label: k === "bus" ? "Bus Tour" : "Tickets - SelfDrive", ...(ctl.adminFee ? { sendable: true } : {}), ...counts(dayRows.filter((r) => r.tab === k)) }));
  if (ctl.adminFee && date === today) tabs.push(adminFeeTab());
  // 分节：只有 Antelope（g:3）、只在 sections 开着时；后端规则是行已经按节排好。
  const sections = sectionsOn
    ? [
        { key: "tour:UPPER ANTELOPE", title: "UPPER ANTELOPE", kind: "tour", rows: 1, orders: 1, pax: 2, ...(ctl.g198 ? g198Section(date, "UPPER ANTELOPE") : {}) },
        { key: "outbound:SHUTTLE: LAS VEGAS → PAGE", title: "SHUTTLE: LAS VEGAS → PAGE", kind: "outbound", rows: 1, orders: 1, pax: 4 },
      ]
    : [];
  const out = { date, tab, is_admin: isAdmin, tabs, pills, pill, catalog, groups: GROUPS.filter((g) => moneyOpen || g.key !== "money"), default_fields: DEFAULTS[tab], fields, denied, unknown, sections, rows };
  // Hidden rows（后端 G167）：只有 include_hidden=true 才多一个 hidden 块；不传响应一字不变。ctl.hiddenMode: "today"（CHD 的 PFYF01 两条）/ "future"（多 Fees 和边界行）/ "none"。
  if (url.searchParams.get("include_hidden") === "true") {
    const mode = date === today ? ctl.hiddenMode : "none";
    const H = [
      ["CHD-88041", "PFYF01", "CHD", "unmapped", "unmapped", "unmapped_group", "The group is Unmapped", 2],
      ["CHD-88057", "PFYF01", "CHD", "unmapped", "unmapped", "unmapped_group", "The group is Unmapped", 3],
      ["CHD-91002", "PFEE02", "Fees", "custom", "fees", "custom_category_group", "The group is a custom category", 1],
      ["CHD-91044", "PFEE03", "Antelope Canyon", "bus_tour", "fees", "product_category_in_operational_group", "The product is in a non-operational category, but its group is operational", 1],
    ].slice(0, mode === "today" ? 2 : mode === "future" ? 4 : 0);
    const hrows = H.map(([o, code, grp, gtype, cat, reason, label, pax]) => {
      const all = { order_number: o, pax, guest_name: "ZZ Hidden " + o, product_name: "Hidden item " + code };
      const values = {};
      for (const k of fields) values[k] = all[k] ?? null;
      return { row_key: `${o}|${code}|${date}`, order_number: o, product_code: code, tour_date: date, lane_source: "rezdy_bookings", leg: null,
        group_name: grp, group_type: gtype, category_code: cat, reason, reason_label: label, values };
    });
    out.hidden = { pill: { key: "hidden", label: "Hidden rows", color: null, sendable: false, rows: hrows.length, orders: new Set(hrows.map((r) => r.order_number)).size, pax: H.reduce((n, h) => n + h[7], 0) }, rows: hrows };
  }
  return [200, out];
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      const body = (await readBody(req)) || {};
      if (body.prefs) {
        prefs.manifest_cols_bus = body.prefs.bus ?? null;
        prefs.manifest_cols_tickets = body.prefs.tickets ?? null;
        delete body.prefs;
      }
      if (body.clearCfm) {
        cfm.clear();
        delete body.clearCfm;
      }
      // seedCfmMap: [[订单号, 已存的 Cfm #], ...]（测上传前的对比）
      if (body.seedCfmMap) {
        for (const [o, no] of body.seedCfmMap) {
          const r = ROWS.find((x) => x.order_number === o);
          cfm.set(rowKey(r, today), { confirmation_no: no, updated_by: "zztest", updated_at: "2026-10-07T18:05:00+00:00" });
        }
        delete body.seedCfmMap;
      }
      if ("rezdyLast" in body) {
        rezdyLast = body.rezdyLast;
        delete body.rezdyLast;
      }
      // G189：只清团确认的发送记录（CHD1002 也变成没发过）。
      if (body.clearTour) {
        sentTour.clear();
        delete body.clearTour;
      }
      if (body.resetSent) {
        sentTour.clear();
        sentTickets.clear();
        sentTour.set(rowKey(ROWS[1], today), "2026-10-06T23:12:00+00:00");
        delete body.resetSent;
      }
      // 别人刚发过某一单（测「看名单之后又有人发」）：{ sentTourLater: "CHD1002" }。
      if (body.sentTourLater) {
        const r = ROWS.find((x) => x.order_number === body.sentTourLater);
        sentTour.set(rowKey(r, today), "2026-10-08T01:00:00+00:00");
        delete body.sentTourLater;
      }
      if (body.resetCalls) {
        sendCalls = 0;
        delete body.resetCalls;
      }
      if (body.seedWaiver) {
        seedWaiver();
        delete body.seedWaiver;
      }
      if (body.seedCfm) {
        cfm.set(rowKey(ROWS[4], today), { confirmation_no: "AC-55120", updated_by: "zztest", updated_at: "2026-10-07T18:05:00+00:00" });
        delete body.seedCfm;
      }
      Object.assign(ctl, body);
      return send(res, 200, { ctl, prefs });
    }
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }
    const entry = { method: req.method, path: p, query: url.search };
    log.push(entry);
    // G203 第二批：共用读接口（后端 f76d5e9）。
    if (p === "/api/manifests/action-log") return send(res, 200, { next_cursor: null, entries: [{ id: "2-1", at: "2026-10-28T17:00:00+00:00", by: "Annie Z", action: "update", label: "ZZ Test item", what: "Name", from: "Old", to: "New" }, { id: "1-1", at: "2026-10-27T17:00:00+00:00", by: "Max", action: "create", label: "ZZ Test item", what: "Name", from: null, to: "Old" }] });
    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
    if (staffPerm(ctl, p, res, send)) return; // 10c：模拟员工权限总开关开着的员工 / Super Admin（staff-perm-mock.js）
    // partner（CCL）：按勾显示（后端 G177 P2 已按勾放行 manifests.edit / send）；partnerCodes 不给时只勾 manifests.view。
    if (ctl.partner) {
      if (p === "/api/me") return send(res, 200, { id: 90, username: "ccl_ops", display_name: "CCL", initials: "CC", role: "partner", is_admin: false, is_superadmin: false, is_supervisor: false });
      if (p === "/api/settings/dashboard-widgets") return send(res, 200, { readable: true, widgets: [] });
      if (p === "/api/me/permissions") return send(res, 200, { is_superadmin: false, permissions: (ctl.partnerCodes || ["manifests.view"]).map((code) => ({ code, module: code.split(".")[0], wired: true })), default_home: "/manifests" });
    }
    if (p === "/api/me")
      return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.role, is_admin: ctl.role === "admin", is_superadmin: false });
    const pm = p.match(/^\/api\/user-prefs\/(manifest_cols_(bus|tickets|admin_fee))$/);
    if (pm) {
      if (req.method === "GET") {
        if (ctl.prefsFail) return send(res, 500, { detail: "prefs down" });
        return send(res, 200, { key: pm[1], value: prefs[pm[1]] });
      }
      const body = await readBody(req);
      entry.body = body;
      if (body.value === "FAILME" || ctl.prefsFail) return send(res, 500, { detail: "prefs down" });
      prefs[pm[1]] = body.value;
      return send(res, 200, { key: pm[1], value: body.value });
    }
    if (ctl.role === "driver") return send(res, 403, { detail: "Staff access required" });
    // G198：PUT /api/manifests/section-cfm（所有 staff 都能存；没开格的节 400 + 英文原因）。
    if (p === "/api/manifests/section-cfm" && req.method === "PUT") {
      const body = (await readBody(req)) || {};
      entry.body = body;
      if (body.manifest_id !== 3 || body.section !== "UPPER ANTELOPE" || ctl.sectionCfm400)
        return send(res, 400, { detail: `Section '${body.section}' does not have a Cfm # box.` });
      const cfmNo = String(body.cfm_no ?? "").trim();
      const k = `${body.tour_date}|3|${body.section}`;
      if (cfmNo) sectionCfm.set(k, { cfm_no: cfmNo, updated_by: "ZZ Test", updated_at: new Date().toISOString() });
      else sectionCfm.delete(k);
      return send(res, 200, { ok: true, tour_date: body.tour_date, manifest_id: 3, section: body.section, cfm_no: cfmNo });
    }
    if (p === "/api/manifests") {
      if (ctl.fail) return send(res, 500, { detail: "Internal Server Error" });
      const [status, body] = page(url);
      return send(res, status, body);
    }
    if (p === "/api/notifications/tour-confirmation/tour-types") {
      const t = (key, label) => ({ key, label, abbr: key, has_lunch: true, has_beef: false, lunch_group: "", file_slug: key });
      return send(res, 200, [t("upper_antelope", "Upper Antelope Canyon Bus Tour"), t("grand_canyon_west", "Grand Canyon West Rim Bus Tour")]);
    }
    // G62 群发查重（只读）：ctl.bcAlready = 已收过这条消息的订单号；ctl.bcCheckFail = 状态码（模拟查重出错）。
    if (p === "/api/manifests/broadcast/check" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      if (ctl.bcCheckFail) return send(res, ctl.bcCheckFail, { detail: "Check failed (mock)." });
      const orders = [...new Set((body.row_keys ?? []).map((k) => byKey(k)?.order_number).filter(Boolean))];
      return send(res, 200, { checked_at: BC_CHECKED_AT, already_sent: orders.filter((o) => ctl.bcAlready.includes(o)).map(bcSent) });
    }
    // G62：收过的默认跳过（send_anyway + preview_at 才再发）；ctl.bcRace = 查重之后才被别人发了的（照样跳过）；
    // ctl.bcBusy = 同一团期别人正在群发（409，什么都没发）。全被跳过 ⇒ results 空。
    if (p === "/api/manifests/broadcast" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      if (ctl.bcBusy) return send(res, 409, { detail: "Someone is already sending a message for this day. Wait a minute and try again." });
      const gate = sendGate(body.row_keys ?? []);
      if (gate) return send(res, ...gate);
      const orders = [...new Set(body.row_keys.map((k) => byKey(k).order_number))];
      const anyway = new Set(body.preview_at ? body.send_anyway ?? [] : []);
      const skipped = orders.filter((o) => ctl.bcRace.includes(o) || (ctl.bcAlready.includes(o) && !anyway.has(o)));
      const n = orders.length - skipped.length;
      return send(res, 200, { checked_at: "2026-10-07T18:41:00+00:00", skipped: skipped.map(bcSent), recipient_count: n,
        results: n ? [{ module: "tour", broadcast_id: 301, recipient_count: n, sms_sent: n, sms_failed: 0, email_sent: n - 1, email_failed: 1 }] : [] });
    }
    if (p === "/api/manifests/send-tour" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      if (ctl.sendDelay) await new Promise((r) => setTimeout(r, ctl.sendDelay));
      const keys = (body.groups ?? []).flatMap((g) => g.row_keys);
      const gate = sendGate(keys);
      if (gate) return send(res, ...gate);
      const ch = channels(body);
      if (!ch) return send(res, 400, { detail: "Choose SMS and/or Email." });
      const groups = body.groups.map((g) => {
        // G189：shuttle 行模板没填齐（shuttleBlock）/ Last Minute 下的 shuttle 行被拦，其余照发。
        const why = (k) => {
          const o = byKey(k).order_number;
          if (!(ctl.shuttleRows ?? []).includes(o)) return null;
          if (body.lane === "last_minute") return "Shuttle guests are not sent as Last Minute";
          return (ctl.shuttleBlock ?? []).includes(o) ? "Fill the shared Shuttle text (Email body, Guest page text) in Content Studio first" : null;
        };
        const blocked = g.row_keys.filter(why).map((k) => ({ order_number: byKey(k).order_number, reasons: [why(k)], can_override: false }));
        const { results, skipped } = sendRows(g.row_keys.filter((k) => !why(k)), sentTour, body);
        return { tour_type: g.tour_type, total: g.row_keys.length, sent: results.length,
          // 置顶 109：ctl.tourSmsFail = 这几单邮件发出、短信号码错（failed: Invalid phone）——前端只算一次 Sent，不算 Failed。
          results: results.map((r) => {
            const row = { order: r.order_number, name: r.v.guest_name, email_status: ch.email ? ((ctl.tourNoEmail ?? []).includes(r.order_number) ? "skipped - no email" : "sent") : "", sms_status: ch.sms ? ((ctl.tourSmsFail ?? []).includes(r.order_number) ? "failed: Invalid phone: 555" : r.v.phone ? "sent:SM1" : "skipped - no phone") : "" };
            // 置顶 109：ctl.newOutcome = 新后端（每行带 outcome / *_outcome）。
            return ctl.newOutcome ? outcomeMock.withOutcome(row, { sms: outcomeMock.channel(row.sms_status, ch.sms), email: outcomeMock.channel(row.email_status, ch.email) }) : row;
          }),
          skipped, ...(blocked.length ? { blocked } : {}), ...(ctl.noBatch ? {} : { batch_id: ++batchSeq }) };
      });
      return send(res, 200, { checked_at: "2026-10-07T18:29:00+00:00", sent: groups.reduce((n, g) => n + g.sent, 0), groups });
    }
    if (p === "/api/manifests/send-tickets" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      const gate = sendGate(body.row_keys ?? []);
      if (gate) return send(res, ...gate);
      const ch = channels(body);
      if (!ch) return send(res, 400, { detail: "Choose SMS and/or Email." });
      // G129：缺 Cfm # 不再整批 400：没发的进 blocked（can_override: true），其余照发；订单号在 send_anyway 里就照发（Cfm # 留空）。
      const sa = new Set(body.send_anyway ?? []);
      // tkBlock：这几单（发送那一刻才发现缺 Cfm #）后端照样给 blocked；订单号在 send_anyway 里才放行。
      const notNeeded = (k) => !!ctl.cfmRule && (ctl.cfmRule.notNeeded ?? []).includes(byKey(k).order_number);
      const reasonsOf = (k) => [
        ...(notNeeded(k) ? [] : !cfmOf(byKey(k), k) || (ctl.tkBlock ?? []).includes(byKey(k).order_number) ? ["No Cfm #"] : ctl.cfmRule && shortCfm(cfmOf(byKey(k), k)) ? ["Cfm # is too short (under 6 digits)"] : []),
        ...(byKey(k).waiver && !waiver.get(k)?.waiver_link ? ["No waiver link"] : []),
      ];
      // G245：号不对 = 硬拦（can_override false），send_anyway 也不放。
      const hard = (k) => mismatchOf(byKey(k).order_number, k) || (ctl.mismatchLate ?? []).includes(byKey(k).order_number);
      const hardBlocked = body.row_keys.filter(hard).map((k) => ({ order_number: byKey(k).order_number, reasons: [`Cfm # doesn't match the product (${MISMATCH.other_label}: ${MISMATCH.other_value})`], can_override: false }));
      const noCfm = body.row_keys.filter((k) => !hard(k) && reasonsOf(k).length);
      const blocked = [...hardBlocked, ...noCfm.filter((k) => !sa.has(byKey(k).order_number)).map((k) => ({ order_number: byKey(k).order_number, reasons: reasonsOf(k), can_override: true }))];
      const keys = body.row_keys.filter((k) => !blocked.some((b) => b.order_number === byKey(k).order_number));
      const { results, skipped } = sendRows(keys, sentTickets, body);
      // 发出去了 ⇒ 记下这次的链接（Changed since sent 跟着消失）。
      for (const r of results) if (r.waiver) waiverSent.set(rowKey(r, today), waiver.get(rowKey(r, today))?.waiver_link ?? "");
      return send(res, 200, { checked_at: "2026-10-07T18:29:00+00:00", sent: results.length,
        results: results.map((r) => {
          const row = { record_id: 1, chd_number: r.order_number, name: r.v.guest_name, sms_ok: ch.sms && !!r.v.phone, email_ok: ch.email ? { message_id: "m1" } : false };
          if (!ctl.newOutcome) return { ...row, sms_ok: ch.sms };
          // 置顶 109：新后端——没号码 = no_address（不算失败）。
          return outcomeMock.withOutcome(row, { sms: !ch.sms ? "not_used" : r.v.phone ? "sent" : "no_address", email: ch.email ? "sent" : "not_used" });
        }), skipped,
        ...(ctl.noBatch ? {} : { batch_id: keys.length ? ++batchSeq : null }),
        blocked, overridden_orders: noCfm.map((k) => byKey(k).order_number).filter((o) => sa.has(o) && results.some((r) => r.order_number === o)) });
    }
    // 置顶 74：一格 waiver link（后端 brenda-waiver-link）。
    if (p === "/api/manifests/waiver-link" && req.method === "PUT") {
      const body = await readBody(req);
      entry.body = body;
      if (ctl.role === "staff" && ctl.waiverNoEdit) return send(res, 403, { detail: "You do not have permission to do this." });
      if (ctl.waiverPutFail) return send(res, 500, { detail: "Something went wrong on our side." });
      const r = allRows().find((x) => x.order_number === body.order_number && x.product_code === body.product_code);
      if (!r || body.tour_date !== today) return send(res, 404, { detail: "That booking is not on this date in Rezdy. Reload the page." });
      if (!r.waiver) return send(res, 400, { detail: "This ticket does not use a per-order waiver link." });
      const v = String(body.waiver_link ?? "").trim();
      if (v && !goodLink(v)) return send(res, 400, { detail: "Waiver link must be a full web address starting with http:// or https://." });
      const key = rowKey(r, today);
      const row = { waiver_link: v, updated_by: "zztest", updated_at: "2026-10-07T23:00:00+00:00" };
      waiver.set(key, row);
      return send(res, 200, { order_number: r.order_number, product_code: r.product_code, tour_date: today, ...row });
    }
    // 置顶 74：上传两列表格（apply=false 只对比；true 写 new / changed）。
    if (p === "/api/manifests/waiver-links/upload" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      const items = body.items ?? [];
      const linksPer = new Map();
      for (const it of items) if (it.waiver_link) linksPer.set(it.order_number, new Set([...(linksPer.get(it.order_number) ?? []), it.waiver_link]));
      const done = new Set();
      const out = items.map((it) => {
        const o = (it.order_number ?? "").trim();
        const v = (it.waiver_link ?? "").trim();
        const r = allRows().find((x) => x.order_number === o);
        const key = r ? rowKey(r, today) : "";
        const current = r?.waiver ? (waiver.get(key)?.waiver_link ?? "") : "";
        const row = { order_number: o, waiver_link: v, current, status: "", error: null, saved: false };
        if (!r || body.tour_date !== today) row.status = "not_found";
        else if (!r.waiver) row.status = "not_waiver";
        else if (!v) row.status = "empty";
        else if (!goodLink(v)) { row.status = "bad_link"; row.error = "Waiver link must be a full web address starting with http:// or https://."; }
        else if ((linksPer.get(o)?.size ?? 0) > 1) row.status = "duplicate";
        else if (done.has(o) || current === v) row.status = "same";
        else {
          row.status = current ? "changed" : "new";
          if (body.apply) { waiver.set(key, { waiver_link: v, updated_by: "zztest", updated_at: "2026-10-07T23:10:00+00:00" }); done.add(o); row.saved = true; }
        }
        return row;
      });
      return send(res, 200, { tour_date: body.tour_date, applied: !!body.apply, items: out });
    }
    // 上传 Cfm # 之前的对比（后端 837360f）：只读；new / same / conflict / not_found；already_sent = 这单发过门票提醒。
    if (p === "/api/manifests/cfm/preview" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      if (ctl.cfmPreviewFail) return send(res, 500, { detail: "Something went wrong on our side." });
      const items = (body.items ?? []).map((it) => {
        const r = ROWS.find((x) => x.order_number === it.order_number && x.product_code === it.product_code);
        const inLane = !!r && body.tour_date === today;
        const current = inLane ? (cfm.get(rowKey(r, today))?.confirmation_no ?? "").trim() : "";
        const incoming = (it.confirmation_no ?? "").trim();
        const status = !inLane ? "not_found" : !current ? "new" : current === incoming ? "same" : "conflict";
        return { order_number: it.order_number, product_code: it.product_code, status, current, incoming, already_sent: ctl.reminderSent.includes(it.order_number),
          ...(ctl.cfmRule ? { current_too_short: shortCfm(current) } : {}) };
      });
      return send(res, 200, { tour_date: body.tour_date, items });
    }
    if (p === "/api/manifests/cfm" && req.method === "PUT") {
      const body = await readBody(req);
      entry.body = body;
      const r = ROWS.find((x) => x.order_number === body.order_number && x.product_code === body.product_code);
      if (!r || body.tour_date !== today || ctl.cfm404) return send(res, 404, { detail: "Not found in Rezdy" });
      const no = String(body.confirmation_no ?? "").trim();
      if (no.length > 100) return send(res, 400, { detail: "Too long" });
      const result = { confirmation_no: no, updated_by: "zztest", updated_at: "2026-10-07T18:05:00+00:00" };
      cfm.set(rowKey(r, body.tour_date), result);
      return send(res, 200, { order_number: body.order_number, product_code: body.product_code, tour_date: body.tour_date, ...result });
    }
    // Sync Rezdy（后端 G70）：ctl.rezdy = "ok"（默认）| "fail"（502）| "busy"（409）；过去的日子 400。
    if (p === "/api/manifests/rezdy-sync" && req.method === "GET") {
      return send(res, 200, { last_synced: rezdyLast });
    }
    if (p === "/api/manifests/rezdy-sync" && req.method === "POST") {
      const body = await readBody(req);
      entry.body = body;
      if (!body?.date) return send(res, 400, { detail: "date is required." });
      if (body.date < today) return send(res, 400, { detail: "Past days cannot be synced." });
      if (ctl.rezdy === "fail") return send(res, 502, { ok: false, last_synced: rezdyLast, error: "Could not reach Rezdy. Nothing was changed. Wait a minute and try again." });
      if (ctl.rezdy === "busy") return send(res, 409, { ok: false, busy: true, last_synced: rezdyLast, error: "Someone is already syncing this day. Wait a few seconds and look again." });
      rezdyLast = { at: new Date().toISOString(), by: "zztest" };
      // G74：顺带同步 Dispatch 团名单；ctl.rezdyListsErr = 团名单那步出错时后端给 staff 的那句话（仍是 200）。
      const lists = ctl.rezdyListsErr ? { guest_lists: null, guest_lists_error: ctl.rezdyListsErr } : { guest_lists: { synced: true, tours: [] } };
      return send(res, 200, { ok: true, last_synced: rezdyLast, checked: 3, new: ["CHD1001"], cancelled: ["CHD9999"], changed: ["CHD1002"], failed: [], ...lists });
    }
    send(res, 404, { detail: "mock: not found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("manifests mock on 8799, today", today));
