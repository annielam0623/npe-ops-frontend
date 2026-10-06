// 模拟后端：Tour manifest。控制：POST /__ctl {previewFail, applyFail, busFail}；GET /__log。
const http = require("http");
const ctl = { previewFail: "", applyFail: "", busFail: "" };
const log = [];
function send(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function readRaw(req) { return new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c).toString("utf8"))); }); }
const guest = (id, order, extra = {}) => ({ id, row_key: order, row_no: id, order_number: order, first_name: "ZZ", last_name: "Test" + id, phone: "+1555", email: "x@x",
  quantities: "Adult", pax: 2, product: "Antelope", pickup_time: "6:30 AM", pickup_location: "Excalibur", special_requirements: "", bus_label: "A",
  boarding: null, boarding_at: null, name: "ZZ Test" + id, lunch: { turkey: 0, veggie: 0, beef: 0, default: false, check: false, has_lunch: false },
  lunch_text: "", ticket: "2 Adult", notes: "", notes_check: false, ticket_hl: false, ...extra });
const state = {
  guests: [guest(1, "CHD1"), guest(2, "CHD2", { bus_label: null, notes: "1 Turkey ??", notes_check: true, ticket_hl: true, ticket: "2 Adult + 1 Child" }), guest(3, "CHD3", { boarding: "boarded" })],
  attraction: { checkin_time: "8:00", pax_text: "", tour_time: "", confirmation_no: "" },
};
function view() {
  const sec = (gs, withAttr) => ({ key: "LOWER ANTELOPE", kind: "tour", title: "LOWER ANTELOPE", heading: `LOWER ANTELOPE {${gs.reduce((a, g) => a + g.pax, 0)}}`, name: "", pax: 0, color: "#bfe3b0", guests: gs,
    ...(withAttr ? { attraction: state.attraction, attraction_filled: true } : {}) });
  const onA = state.guests.filter((g) => g.bus_label === "A");
  const onB = state.guests.filter((g) => g.bus_label === "B");
  const un = state.guests.filter((g) => !g.bus_label);
  const shuttle = { key: "SHUTTLE OUT", kind: "outbound", title: "SHUTTLE OUT", heading: "SHUTTLE: LAS TO PAGE // OUTBOUND 2 PAX", name: "", pax: 2, color: "#f8c9a0", guests: [guest(9, "CHD9", { ticket: "Shuttle" })], attraction: { checkin_time: "", pax_text: "", tour_time: "", confirmation_no: "" }, attraction_filled: false };
  const block = (id, label, gs, extraSecs = []) => ({ bus: { id, bus_label: label, van: "20" + id, seats: 56, driver: "FREDDY", guide: "" }, bus_key: label, bus_number: `20${id}=${label}`,
    sections: gs.length ? [sec(gs, true), ...extraSecs] : extraSecs, totals: { pax: 0, guests: 0, boarded: 0, no_show: 0 },
    footer: [{ label: "TOTAL # OF PAX", value: 56, custom: false }, { label: "BUS SEATS LEFT", value: null, custom: false }, { label: "WHEELCHAIR", value: 1, custom: true }], empty_notes: false });
  return { run_date: "2026-10-05", date_label: "Mon, Oct 5, 2026",
    tour: { id: 3, name: "Antelope Canyon", color: "#8db76f", band_color: "#8db76f", section_color: "#d9ead0", lunch_note: "" },
    shuttle_colors: { outbound: "#f8c9a0", inbound: "#b9d3f0" },
    manifest: { id: 12, file_name: "ant.csv", uploaded_at: "2026-10-04T21:14:02+00:00", uploaded_by: "Annie" },
    mode: "lettered", bus_labels: ["A", "B"],
    blocks: [block(41, "A", onA, [shuttle]), block(42, "B", onB)],
    unplaced: { sections: un.length ? [sec(un, false)] : [], totals: { pax: un.reduce((a, g) => a + g.pax, 0), guests: un.length, boarded: 0, no_show: 0 }, empty_notes: false },
    totals: { pax: 8, guests: 4, boarded: 2, no_show: 0 } };
}
const cards = [
  { manifest_id: 3, title: "Antelope Canyon", name: "Antelope Canyon", buses: 2, mode: "lettered", uploaded: true, pax: 8, guests: 4, not_on_bus: 2, lunch: { turkey: 3, veggie: 1, beef: 0 }, file_name: "ant.csv", uploaded_at: "2026-10-04T21:14:02+00:00", uploaded_by: "Annie" },
  { manifest_id: 5, title: "West Rim Bus Tour", name: "West Rim", buses: 0, mode: "none", uploaded: false },
];
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, JSON.parse(await readRaw(req))); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, q };
  log.push(entry);
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: "staff", is_admin: false, is_superadmin: false });
  if (p === "/api/dispatch/day") {
    const LA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
    const t = LA.format(new Date());
    const [y, m, d] = t.split("-").map(Number);
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    return send(res, 200, { run_date: q.date || tomorrow, today: t, rows: [], sections: [], orphans: [], drivers: [], vehicles: [], locations: [], tours: [], guides: [], copy_from: null });
  }
  if (p === "/api/dispatch/imports/day") return send(res, 200, { last_ok: "", prefill: null });
  if (p === "/api/dispatch/imports/pull") return send(res, 200, { status: "nothing", message: "Nothing new", last_ok: "" });
  if (p === "/api/dispatch/manifests") return send(res, 200, { run_date: q.date, cards });
  if (p === "/api/dispatch/manifest") return send(res, 200, view());
  if (p === "/api/dispatch/manifests/preview" || p === "/api/dispatch/manifests/apply") {
    const raw = await readRaw(req);
    entry.manifestId = /name="manifest_id"\r\n\r\n(\d+)/.exec(raw)?.[1];
    entry.date = /name="date"\r\n\r\n([\d-]+)/.exec(raw)?.[1];
    entry.hasFile = /filename="ant\.csv"/.test(raw);
    if (p.endsWith("preview")) {
      if (ctl.previewFail) return send(res, 400, { detail: ctl.previewFail });
      return send(res, 200, { added: [{ order_number: "CHD7", name: "ZZ New", pax: 3, product: "Antelope", pickup_time: "6:30 AM", pickup_location: "MGM" }],
        removed: [{ order_number: "CHD3", name: "ZZ Gone", pax: 2, product: "Antelope", pickup_time: "6:30 AM", pickup_location: "Excalibur", bus_label: "A", boarding: "boarded" }],
        changed: [{ order_number: "CHD1", name: "ZZ Test1", pax: 2, product: "Antelope", pickup_time: "6:30 AM", pickup_location: "Excalibur", changes: ["pax 2 → 3", "phone changed"] }],
        unchanged: 5, rows: 8, pax: 20, first_upload: false });
    }
    if (ctl.applyFail) return send(res, 400, { detail: ctl.applyFail });
    return send(res, 200, { ok: true, added: 1, removed: 1, changed: 1, rows: 8, pax: 20 });
  }
  if (p === "/api/dispatch/manifests/guest-bus") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    if (ctl.busFail) return send(res, 400, { detail: ctl.busFail });
    state.guests.find((g) => g.id === b.guest_id).bus_label = b.bus_label;
    return send(res, 200, { ok: true, id: b.guest_id, bus_label: b.bus_label });
  }
  if (p === "/api/dispatch/manifests/attraction") {
    const b = JSON.parse(await readRaw(req)); entry.body = b;
    Object.assign(state.attraction, { checkin_time: b.checkin_time, pax_text: b.pax_text, tour_time: b.tour_time, confirmation_no: b.confirmation_no });
    return send(res, 200, { ok: true });
  }
  if (p === "/admin/dispatch/manifest/guide") { res.setHeader("Content-Type", "text/html"); return res.end(`<html><title>GUIDE ${q.bus}</title><body>GUIDE</body></html>`); }
  if (p === "/admin/dispatch/manifest/print") { res.setHeader("Content-Type", "text/html"); return res.end(`<html><title>PRINT ${q.date} ${q.tour} ${q.bus ?? "all"}</title><body>PRINT</body></html>`); }
  if (p === "/admin/dispatch/manifest/download") {
    entry.body = await readRaw(req);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="manifest-antelope-canyon-2026-10-05.xlsx"');
    return res.end("PK");
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("mf mock on 8799"));
