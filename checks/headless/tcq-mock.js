// 模拟后端：Transfer & Charter Quotation（G66 阶段二）+ 工作项接口。只连本机，绝不连真实后端。
// 计价照后端 app/services/tcq_pricing.py / tcq_quote.build_quote 抄的（简化：不做读取，parsed 是写死的）。
// 控制：POST /__ctl {role, unauth, failPreview, reset}；GET /__log 看请求。
const http = require("http");

const ctl = { role: "admin", unauth: false, failPreview: "" };
const log = [];

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readRaw(req) {
  return new Promise((r) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => r(Buffer.concat(chunks)));
  });
}

// ── 设置（同 migrate_v93 的种子；Mini bus / Mid-size 填了小费，测「单列一行」）──
const V = (id, name, seats, ai, ad, dep, fee, th, cmin, cbase, cot, ev, evmin, evot, grat, sort) => ({
  id, name, seats, arrival_intl_cents: ai, arrival_domestic_cents: ad, departure_cents: dep, airport_fee_cents: fee,
  transfer_hours: th, charter_min_hours: cmin, charter_base_cents: cbase, charter_overtime_cents: cot,
  event_rate_cents: ev, event_min_hours: evmin, event_overtime_cents: evot, gratuity_per_day_cents: grat,
  is_active: true, sort_order: sort,
});
let vehicles, events, terms, dictionary, airlines, places, items, quotes, seq, idSeq;
function reset() {
  vehicles = [
    V(1, "SUV", 6, 20000, 18000, 18000, 1000, 2, 2, 18000, 12000, 120000, 10, 11000, null, 10),
    V(2, "Sprinter (10)", 10, 15000, 13500, 13500, 1000, 2, 2, 16500, 9500, 95000, 10, 9500, null, 20),
    V(3, "Executive Sprinter (16)", 16, 18500, 16000, 16000, 1000, 2, 2, 19000, 11000, 110000, 10, 11000, null, 30),
    V(4, "Mini bus (22)", 22, 15000, 13500, 13500, 1000, 2, 2, 16500, 9500, 95000, 10, 9500, 11500, 40),
    V(5, "Mid-size coach (40)", 40, 37000, 32000, 32000, 2500, 3, 3, 38000, 12000, 140000, 10, 12000, 13500, 50),
    V(6, "Full-size coach (56)", 56, 39500, 37500, 37500, 2500, 3, 3, 40000, 13000, 150000, 10, 13000, null, 60),
  ];
  events = [
    { id: 1, name: "F1 Las Vegas Grand Prix", start_date: "2025-11-20", end_date: "2025-11-22", min_days: 3, cancel_days: 30 },
    { id: 2, name: "CES", start_date: "2026-01-06", end_date: "2026-01-09", min_days: 3, cancel_days: 30 },
    { id: 3, name: "NASCAR", start_date: null, end_date: null, min_days: null, cancel_days: 30 },
  ];
  terms = [
    ["quote_header", "text", "Quote header (company name on the PDF)", "National Park Express", 5],
    ["quote_prefix", "text", "Quote number prefix (NPE-2026-0001)", "NPE", 10],
    ["tax_pct", "number", "State excise tax (%)", "3", 20],
    ["deposit_pct", "number", "Deposit (%)", "10", 30],
    ["deposit_min", "number", "Deposit minimum ($)", "150", 40],
    ["card_fee_pct", "number", "Card processing fee (%)", "5", 50],
    ["pay_days", "number", "Full payment due (days before)", "14", 60],
    ["cancel_days", "number", "Cancellation notice, normal (days)", "7", 70],
    ["full_day_hours", "number", 'Hours for "all day" / "full day" when no hours are given', "10", 80],
    ["gratuity_text", "text", "Gratuity wording", "Driver gratuity: 15-20% of the total or $3 per person, whichever is greater", 90],
    ["overtime_text", "text", "Overtime wording", "Beyond the included hours, charged per hour; over 15 minutes counts as a full hour.", 100],
    ["inclusions_text", "text", "Inclusions (one per line)", "Professional English-speaking driver\nDriver wages, standard driving hours and fuel", 110],
    ["not_included_text", "text", "Not included (one per line)", "Tour guide services", 120],
    ["assumptions_text", "text", "Pricing assumptions (one per line)", "Final pricing is subject to adjustment", 130],
    ["deposit_text", "text", "Deposit wording", "A {deposit_pct}% deposit (minimum ${deposit_min}) is required to confirm the booking.", 140],
    ["card_fee_text", "text", "Card fee wording", "Card payments carry a {card_fee_pct}% processing fee.", 150],
    ["payment_text", "text", "Full payment wording", "Full payment is due {pay_days} days before the first service date.", 160],
    ["cancel_text", "text", "Cancellation wording", "Cancellations need {cancel_days} days notice before the service date.", 170],
    ["event_cancel_text", "text", "Cancellation wording on event dates", "During {event_name}, cancellations need {event_cancel_days} days notice.", 180],
  ].map(([key, kind, label, value, sort_order]) => ({ key, kind, label, value, sort_order }));
  dictionary = [
    { id: 1, kind: "arrival", term: "pickup" }, { id: 2, kind: "arrival", term: "接机" },
    { id: 3, kind: "departure", term: "drop-off" }, { id: 4, kind: "charter", term: "charter" },
    { id: 5, kind: "pax", term: "pax" }, { id: 6, kind: "hours", term: "hours" }, { id: 7, kind: "full_day", term: "all day" },
  ];
  airlines = [{ code: "AA", is_international: false }, { code: "KE", is_international: true }];
  places = [
    { id: 1, name: "Fontainebleau Las Vegas", kind: "hotel", aliases: ["Fontainebleau"] },
    { id: 2, name: "Las Vegas Convention Center", kind: "venue", aliases: ["LVCC"] },
    { id: 3, name: "Harry Reid International Airport", kind: "airport", aliases: ["LAS"] },
  ];
  const svc = (o) => ({ date: "", service: null, pax: null, flight: null, time: null, international: null, places: [], hours: null,
    line: "", flags: [], rate: "auto", options: [], selected: [], ...o });
  items = [
    item(2001, "ZZ Test Convention · May 29 – Jun 4", "review", {
      module: "tcq", version: 1,
      services: [
        svc({ date: "2026-05-29", service: "arrival", pax: 4, flight: "KE005", time: "16:20", international: true, places: ["Fontainebleau Las Vegas"], line: "5/29 接机 KE005 16:20 4人", selected: [1] }),
        svc({ date: "2026-05-30", service: "arrival", pax: 21, flight: "KE005", time: "16:20", international: true, places: ["Fontainebleau Las Vegas"], line: "5/30 接机 KE005 16:20 21人", flags: ["Hotel not given - Fontainebleau Las Vegas carried over from May 29."], selected: [4] }),
        svc({ date: "2026-05-30", service: "charter", pax: 4, hours: 10, places: ["Fontainebleau Las Vegas", "Las Vegas Convention Center"], line: "5/30 包车 一天 4人", selected: [1] }),
        svc({ date: "2026-06-02", service: "charter", pax: 2, places: ["Fontainebleau Las Vegas", "Bellagio"], line: "6/2 包车 2人", flags: ["Hours not stated - the minimum for each vehicle is assumed."], selected: [1] }),
        svc({ date: "2026-06-04", service: "departure", pax: 9, flight: "KE006", time: "23:50", places: ["Fontainebleau Las Vegas"], line: "6/4 送机 KE006 23:50 9人", selected: [2] }),
      ],
      unread: ["3. 送机需求 — 具体航班稍后确认", "<img src=x onerror=window.__xss=1> ZZ Test"],
    }, ""),
    item(2002, "ZZ Test unreadable", "draft", null, "No dates were found, so no services could be read."),
    item(2003, "ZZ Test private tour", "draft", null, "", { destination_code: "ptq", destination_name: "Private Tour Quotation" }),
  ];
  quotes = [];
  seq = 0;
  idSeq = 100;
}
function item(id, title, status, parsed, err, extra = {}) {
  return {
    id, item_no: `WS-${id}`, title, source: "paste", status_code: status, next_step: "Check the services", read_error: err,
    owner_id: 1, destination_code: "tcq", destination_name: "Transfer & Charter Quotation",
    created_at: "2026-10-15T19:00:00Z", updated_at: "2026-10-15T19:30:00Z", raw_text: "ZZ Test email", parsed, edited: null,
    files: [], history: [], ...extra,
  };
}
reset();

const STATUSES = [
  { code: "draft", name: "Draft", color: "#fbbf24", sort_order: 10, is_active: true, is_closed: false },
  { code: "review", name: "Waiting for review", color: "#c4b5fd", sort_order: 20, is_active: true, is_closed: false },
  { code: "quote_sent", name: "Quote sent", color: "#38bdf8", sort_order: 30, is_active: true, is_closed: false },
  { code: "done", name: "Done", color: "#86efac", sort_order: 40, is_active: true, is_closed: true },
];
function full(it) {
  const s = STATUSES.find((x) => x.code === it.status_code);
  return { ...it, read_failed: !!it.read_error, owner_name: "ZZ Test", status_name: s?.name ?? null, status_color: s?.color ?? null, is_closed: !!s?.is_closed };
}

// ── 计价（照 tcq_pricing.py）──
function money(c) {
  const a = Math.abs(c);
  return `${c < 0 ? "-" : ""}$${Math.floor(a / 100).toLocaleString("en-US")}${a % 100 ? `.${String(a % 100).padStart(2, "0")}` : ""}`;
}
const termVal = (k) => terms.find((t) => t.key === k)?.value ?? "";
const termNum = (k) => Number(termVal(k)) || 0;
const eventOn = (day) => events.find((e) => e.start_date && e.end_date && e.start_date <= day && day <= e.end_date) || null;
const hh = (x) => String(Number(x));
const extra = (h, inc) => Math.max(0, Math.ceil(h - inc - 1e-9));
function price(kind, v, { international, hours, rate, day }) {
  if (kind === "arrival") {
    const base = international ? v.arrival_intl_cents : v.arrival_domestic_cents;
    return { price_cents: base + v.airport_fee_cents, calc: `${money(base)} (${international ? "international" : "domestic"}) + ${money(v.airport_fee_cents)} airport fee`,
      included_hours: v.transfer_hours, overtime_cents: v.charter_overtime_cents, event: null, rate_used: "normal" };
  }
  if (kind === "departure") {
    return { price_cents: v.departure_cents + v.airport_fee_cents, calc: `${money(v.departure_cents)} + ${money(v.airport_fee_cents)} airport fee`,
      included_hours: v.transfer_hours, overtime_cents: v.charter_overtime_cents, event: null, rate_used: "normal" };
  }
  const h = hours ?? v.charter_min_hours;
  const match = eventOn(day);
  if (rate === "event" || (rate === "auto" && match)) {
    const x = extra(h, v.event_min_hours);
    return { price_cents: v.event_rate_cents + x * v.event_overtime_cents,
      calc: `event rate ${money(v.event_rate_cents)} (${hh(v.event_min_hours)} hr min)${x ? ` + ${x} × ${money(v.event_overtime_cents)}` : ""}`,
      included_hours: Math.max(h, v.event_min_hours), overtime_cents: v.event_overtime_cents, event: match && rate !== "normal" ? match.name : null, rate_used: "event" };
  }
  const x = extra(h, v.charter_min_hours);
  return { price_cents: v.charter_base_cents + x * v.charter_overtime_cents,
    calc: `${money(v.charter_base_cents)} (${hh(v.charter_min_hours)} hr min)${x ? ` + ${x} × ${money(v.charter_overtime_cents)}` : ""}`,
    included_hours: Math.max(h, v.charter_min_hours), overtime_cents: v.charter_overtime_cents, event: null, rate_used: "normal" };
}
const LABEL = { arrival: "Airport pickup", departure: "Airport drop-off", charter: "Charter" };
function describe(s, p) {
  if (s.description) return s.description;
  const parts = [LABEL[s.service]];
  if (s.service === "charter") {
    parts[0] += `, ${hh(p.included_hours)} hour${p.included_hours !== 1 ? "s" : ""}`;
    if (p.rate_used === "event") parts[0] += ` (event rate${p.event ? `, ${p.event}` : ""})`;
  } else {
    const fl = [s.flight, s.time].filter(Boolean).join(" ");
    if (fl) parts.push(fl);
  }
  if (s.places.length) parts.push(s.places.join(" to "));
  if (s.pax) parts.push(`${s.pax} guest${s.pax !== 1 ? "s" : ""}`);
  return parts.join(" - ");
}
function fill(t, vals) {
  return t.replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
}
const lines = (s) => (s || "").split("\n").map((l) => l.trim()).filter(Boolean);
class Bad extends Error {}
function buildQuote(req) {
  if (!req.services.some((s) => s.vehicles.length) && !req.manual_lines.length) throw new Bad("Pick at least one vehicle, or add a line, before making a quote.");
  const active = vehicles.filter((v) => v.is_active);
  const byId = new Map(active.map((v) => [v.id, v]));
  const blocks = new Map();
  const flags = [];
  const used = {};
  const blockFor = (v) => {
    const key = `v${v.id}`;
    if (!blocks.has(key)) blocks.set(key, { key, vehicle_id: v.id, title: `${v.name} - ${v.seats} seats`, seats: v.seats, lines: [], dates: new Set() });
    return blocks.get(key);
  };
  req.services.forEach((s, i) => {
    for (const pick of s.vehicles) {
      const v = byId.get(pick.vehicle_id);
      if (!v) throw new Bad(`Service ${i + 1}: a picked vehicle is no longer on the rate card. Pick again.`);
      const p = price(s.service, v, { international: s.international, hours: s.hours, rate: s.rate, day: s.date });
      const m = eventOn(s.date);
      if (p.rate_used === "event" && m) used[m.name] = m.cancel_days;
      const amount = pick.price_cents == null ? p.price_cents : pick.price_cents;
      const b = blockFor(v);
      b.dates.add(s.date);
      b.lines.push({ kind: "service", service: s.service, date: s.date, description: describe(s, p), qty: "1", unit_cents: amount, amount_cents: amount,
        taxable: true, original_cents: p.price_cents, overridden: amount !== p.price_cents, calc: p.calc, rate: s.rate, rate_used: p.rate_used,
        event: p.event, included_hours: p.included_hours, overtime_cents: p.overtime_cents });
    }
  });
  let gratInTerms = req.gratuity === "terms";
  for (const b of blocks.values()) {
    const v = byId.get(b.vehicle_id);
    if (req.gratuity === "line" && v.gratuity_per_day_cents) {
      const d = b.dates.size;
      b.lines.push({ kind: "gratuity", date: null, description: "Driver gratuity (per vehicle, per day)", qty: String(d), unit_cents: v.gratuity_per_day_cents, amount_cents: d * v.gratuity_per_day_cents, taxable: false });
    } else if (req.gratuity === "line") {
      gratInTerms = true;
      flags.push(`${v.name} has no gratuity per day on the rate card, so the gratuity is in the terms.`);
    }
  }
  req.manual_lines.forEach((m) => {
    let b;
    if (m.vehicle_id != null) b = blockFor(byId.get(m.vehicle_id));
    else {
      const name = m.group || "Other";
      const key = `g:${name.toLowerCase()}`;
      if (!blocks.has(key)) blocks.set(key, { key, vehicle_id: null, title: name, seats: null, lines: [], dates: new Set() });
      b = blocks.get(key);
    }
    b.lines.push({ kind: "manual", date: m.date, description: m.description, qty: String(m.qty), unit_cents: m.unit_price_cents, amount_cents: Math.round(m.qty * m.unit_price_cents), taxable: m.taxable });
  });
  const pct = req.tax ? termNum("tax_pct") : 0;
  const out = [...blocks.values()].map((b) => {
    b.lines.sort((x, y) => (x.kind === "gratuity") - (y.kind === "gratuity") || (x.date || "9999").localeCompare(y.date || "9999"));
    const sub = b.lines.reduce((a, l) => a + l.amount_cents, 0);
    const taxable = b.lines.filter((l) => l.taxable).reduce((a, l) => a + l.amount_cents, 0);
    const tax = req.tax ? Math.round((taxable * pct) / 100) : 0;
    return { key: b.key, vehicle_id: b.vehicle_id, title: b.title, seats: b.seats, lines: b.lines, subtotal_cents: sub, taxable_cents: taxable, tax_cents: tax, total_cents: sub + tax };
  });
  out.sort((a, b) => (a.vehicle_id !== null) - (b.vehicle_id !== null) || (a.seats || 0) - (b.seats || 0) || a.title.localeCompare(b.title));
  const vb = out.filter((b) => b.vehicle_id !== null);
  const covers = vb.map((b) => JSON.stringify(b.lines.filter((l) => l.kind === "service").map((l) => [l.date, l.service]).sort()));
  const vals = Object.fromEntries(["tax_pct", "deposit_pct", "deposit_min", "card_fee_pct", "pay_days", "cancel_days"].map((k) => [k, termVal(k)]));
  const conditions = [fill(termVal("overtime_text"), vals)];
  if (gratInTerms) conditions.push(fill(termVal("gratuity_text"), vals));
  for (const k of ["deposit_text", "card_fee_text", "payment_text", "cancel_text"]) conditions.push(fill(termVal(k), vals));
  for (const [name, days] of Object.entries(used).sort()) conditions.push(fill(termVal("event_cancel_text"), { ...vals, event_name: name, event_cancel_days: String(days) }));
  const t = {
    header: termVal("quote_header"),
    inclusions: lines(req.inclusions ?? termVal("inclusions_text")),
    not_included: lines(req.not_included ?? termVal("not_included_text")),
    assumptions: lines(req.assumptions ?? termVal("assumptions_text")),
    conditions: conditions.filter((c) => c.trim()),
    tax_label: `State excise tax (${termVal("tax_pct")}%)`,
  };
  const texts = [req.client, t.header, ...t.inclusions, ...t.not_included, ...t.assumptions, ...out.flatMap((b) => [b.title, ...b.lines.map((l) => l.description)])];
  const bad = [];
  for (const s of texts) for (const ch of s || "") if (ch.charCodeAt(0) > 255 && !"–—‘’“”…→•".includes(ch) && !bad.includes(ch)) bad.push(ch);
  return {
    client: req.client, blocks: out, alternatives: vb.length > 1 && covers.every((c) => c === covers[0]), tax_on: req.tax, tax_pct: String(pct),
    subtotal_cents: out.reduce((a, b) => a + b.subtotal_cents, 0), tax_cents: out.reduce((a, b) => a + b.tax_cents, 0),
    total_cents: out.reduce((a, b) => a + b.total_cents, 0), terms: t, flags, pdf_problems: bad.slice(0, 20),
  };
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      const b = JSON.parse((await readRaw(req)).toString() || "{}");
      if (b.reset) reset();
      delete b.reset;
      Object.assign(ctl, b);
      log.length = 0;
      return send(res, 200, ctl);
    }
    const raw = req.method === "GET" || req.method === "DELETE" ? null : await readRaw(req);
    const body = raw ? JSON.parse(raw.toString() || "null") : null;
    log.push({ method: req.method, path: p, body });

    if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("<h1>LEGACY LOGIN</h1>"); }
    if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.role, is_admin: ctl.role !== "staff", is_superadmin: false });
    if (ctl.unauth && (p.startsWith("/api/workspace") || p.startsWith("/api/tcq") || p.startsWith("/api/settings"))) return send(res, 401, { detail: "Not authenticated" });
    if (p.startsWith("/api/user-prefs/")) return send(res, 200, { key: p.split("/").pop(), value: null });
    if (p === "/api/nav-config") return send(res, 404, { detail: "Not Found" });

    if (p === "/api/workspace/statuses") return send(res, 200, { statuses: STATUSES });
    if (p === "/api/workspace/colleagues") return send(res, 200, { colleagues: [{ id: 1, name: "ZZ Test" }] });
    let m = /^\/api\/workspace\/items\/(\d+)$/.exec(p);
    if (m) {
      const it = items.find((i) => i.id === Number(m[1]));
      if (!it) return send(res, 404, { detail: "Work item not found." });
      if (req.method === "PUT") {
        for (const k of ["title", "next_step", "edited"]) if (k in body) it[k] = body[k];
        if ("status" in body) it.status_code = body.status;
        it.updated_at = new Date().toISOString();
      }
      return send(res, 200, full(it));
    }
    if (p === "/api/tcq/rate-card") return send(res, 200, { vehicles: vehicles.filter((v) => v.is_active) });
    m = /^\/api\/workspace\/items\/(\d+)\/tcq-quote(\/preview)?$/.exec(p);
    if (m) {
      const it = items.find((i) => i.id === Number(m[1]));
      if (!it) return send(res, 404, { detail: "Work item not found." });
      if (m[2] && ctl.failPreview) return send(res, 400, { detail: ctl.failPreview });
      let q;
      try {
        q = buildQuote(body);
      } catch (e) {
        if (e instanceof Bad) return send(res, 400, { detail: e.message });
        throw e;
      }
      if (m[2]) return send(res, 200, q);
      if (q.pdf_problems.length) return send(res, 400, { detail: `The PDF can only show English letters. Replace these characters first: ${q.pdf_problems.join(" ")}` });
      seq += 1;
      const no = `${termVal("quote_prefix")}-2026-${String(seq).padStart(4, "0")}`;
      const saved = { id: ++idSeq, quote_no: no, item_id: it.id, item_no: it.item_no, client: q.client, lines: { blocks: q.blocks, flags: q.flags, request: body, tax_on: q.tax_on, alternatives: q.alternatives },
        terms: q.terms, subtotal_cents: q.subtotal_cents, tax_pct: q.tax_pct, tax_cents: q.tax_cents, total_cents: q.total_cents, created_by_name: "ZZ Test", created_at: new Date().toISOString() };
      quotes.unshift(saved);
      it.status_code = "quote_sent";
      it.next_step = `Send ${no} to the client`;
      it.updated_at = new Date().toISOString();
      return send(res, 200, saved);
    }
    m = /^\/api\/workspace\/items\/(\d+)\/tcq-quotes$/.exec(p);
    if (m) {
      return send(res, 200, { quotes: quotes.filter((q) => q.item_id === Number(m[1])).map(({ id, quote_no, client, total_cents, created_at, created_by_name }) => ({ id, quote_no, client, total_cents, created_at, created_by_name })) });
    }
    m = /^\/api\/tcq\/quotes\/(\d+)\/pdf$/.exec(p);
    if (m) { res.setHeader("Content-Type", "application/pdf"); return res.end("%PDF-1.4 mock"); }

    // ── Settings（admin）──
    if (p.startsWith("/api/settings/tcq") && ctl.role === "staff") return send(res, 403, { detail: "Admin only" });
    if (p === "/api/settings/tcq") {
      return send(res, 200, { vehicles, events, terms, dictionary, dictionary_kinds: ["arrival", "departure", "charter", "pax", "hours", "full_day"], airlines, places, place_kinds: ["hotel", "venue", "airport"] });
    }
    m = /^\/api\/settings\/tcq\/vehicles(?:\/(\d+))?$/.exec(p);
    if (m) {
      if (!body.name || !body.name.trim()) return send(res, 400, { detail: "The vehicle name must be 1-80 characters." });
      if (m[1]) {
        const v = vehicles.find((x) => x.id === Number(m[1]));
        Object.assign(v, body);
        return send(res, 200, v);
      }
      const v = { id: ++idSeq, ...body };
      vehicles.push(v);
      return send(res, 200, v);
    }
    m = /^\/api\/settings\/tcq\/events(?:\/(\d+))?$/.exec(p);
    if (m) {
      if (req.method === "DELETE") { events = events.filter((e) => e.id !== Number(m[1])); return send(res, 200, { ok: true }); }
      if (!body.start_date !== !body.end_date) return send(res, 400, { detail: "Fill in both dates, or leave both empty." });
      if (m[1]) { const e = events.find((x) => x.id === Number(m[1])); Object.assign(e, body); return send(res, 200, e); }
      const e = { id: ++idSeq, ...body };
      events.push(e);
      return send(res, 200, e);
    }
    if (p === "/api/settings/tcq/terms") {
      for (const [k, v] of Object.entries(body)) terms.find((t) => t.key === k).value = v;
      return send(res, 200, body);
    }
    m = /^\/api\/settings\/tcq\/dictionary(?:\/(\d+))?$/.exec(p);
    if (m) {
      if (req.method === "DELETE") { dictionary = dictionary.filter((d) => d.id !== Number(m[1])); return send(res, 200, { ok: true }); }
      if (dictionary.some((d) => d.kind === body.kind && d.term.toLowerCase() === body.term.toLowerCase())) return send(res, 400, { detail: "This word is already in the list." });
      const d = { id: ++idSeq, kind: body.kind, term: body.term };
      dictionary.push(d);
      return send(res, 200, d);
    }
    m = /^\/api\/settings\/tcq\/airlines\/([^/]+)$/.exec(p);
    if (m) {
      const code = decodeURIComponent(m[1]).toUpperCase();
      if (req.method === "DELETE") { airlines = airlines.filter((a) => a.code !== code); return send(res, 200, { ok: true }); }
      if (!/^[A-Z0-9]{2,3}$/.test(code)) return send(res, 400, { detail: "An airline code is 2-3 letters or digits, like KE or B6." });
      airlines = [...airlines.filter((a) => a.code !== code), { code, is_international: body.is_international }];
      return send(res, 200, { code, is_international: body.is_international });
    }
    m = /^\/api\/settings\/tcq\/places(?:\/(\d+))?$/.exec(p);
    if (m) {
      if (req.method === "DELETE") { places = places.filter((x) => x.id !== Number(m[1])); return send(res, 200, { ok: true }); }
      const row = { name: body.name, kind: body.kind, aliases: body.aliases.join(", ") };
      if (m[1]) {
        const x = places.find((y) => y.id === Number(m[1]));
        Object.assign(x, { ...row, aliases: body.aliases });
        return send(res, 200, { id: x.id, ...row });
      }
      const id = ++idSeq;
      places.push({ id, ...row, aliases: body.aliases });
      return send(res, 200, { id, ...row });
    }
    return send(res, 404, { detail: "Not Found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("tcq mock up"));
