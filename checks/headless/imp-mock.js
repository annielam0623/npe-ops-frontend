// 模拟后端：Dispatch Imports。控制：POST /__ctl；GET /__log。
const http = require("http");
const ctl = { fail401: false, pullStatus: "nothing", badSince: false, delayFirst: 0, failList: false };
const log = [];
function send(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function readRaw(req) { return new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c).toString("utf8"))); }); }
const line = (o) => ({ line_no: 1, raw_line: "", ccl_section: "MORNING RELAY", shift: "relay", tour_name: null, bus_label: null,
  driver_text: null, guide_text: null, vehicle_text: null, is_driver_guide: false, route_label: null, ccl_note: null,
  parse_ok: true, parse_error: null, driver_match: null, guide_match: null, driver_choices: "", guide_choices: "",
  vehicle_match: null, vehicle_inactive: false, ...o });
const imp = (o) => ({ id: 1, service_date: "2026-10-05", title: "NPE 10/5:", raw_content: "NPE 10/5:\n<b>FREDDY</b> - 768", is_revision: false,
  status: "pending", posted_at: "2026-10-04T21:13:00+00:00", edited_at: null, version_at: null, superseded_at: null, applied_at: null,
  imported_at: null, vehicle_count: 0, failed_count: 0, lines: [], closures: [], ...o });
let pulled = false;
function list(since) {
  const imports = [
    imp({ id: 11, service_date: "2026-10-05", title: "NPE 10/5: Revision", is_revision: true, status: "applied", vehicle_count: 3, failed_count: 1,
      edited_at: "2026-10-04T22:30:00+00:00",
      lines: [
        line({ line_no: 1, driver_text: "FREDDY", vehicle_text: "768", driver_match: "Freddy L", vehicle_match: "768" }),
        line({ line_no: 2, ccl_section: "WEST RIM", shift: "bus_tour", tour_name: "West Rim Bus Tour", bus_label: "A", driver_text: "BRUCE", vehicle_text: "9999",
          is_driver_guide: true, driver_choices: "Bruce O or Bruce W", route_label: "WESTRIM", ccl_note: "late start" }),
        line({ line_no: 3, ccl_section: "PRIVATE", shift: "private_tour", driver_text: "ZED", guide_text: "PAM", vehicle_text: "2056",
          driver_match: "ZED (typed, not in HR)", guide_match: null, guide_choices: "", vehicle_match: "2056", vehicle_inactive: true }),
        line({ line_no: 4, ccl_section: "WEST RIM", shift: null, parse_ok: false, parse_error: "No dash between name and vehicle", raw_line: "BOB 1328 ??", driver_text: "BOB" }),
      ],
      closures: [{ line_no: 5, ccl_section: "HOOVER DAM", shift: "bus_tour", tour_name: "Hoover Dam", note: null },
                 { line_no: 6, ccl_section: "ANTELOPE", shift: "bus_tour", tour_name: null, note: "Closed due to weather" }] }),
    imp({ id: 10, service_date: "2026-10-05", status: "superseded", vehicle_count: 1, lines: [line({ driver_text: "FREDDY", vehicle_text: "768", driver_match: "Freddy L", vehicle_match: "768" })] }),
  ];
  if (pulled) imports.push(imp({ id: 12, service_date: "2026-10-06", title: "NPE 10/6:", vehicle_count: 1, lines: [line({ driver_text: "GIA", driver_match: "GIA" })] }));
  return { since: since || "2026-09-27", last_ok: "2026-10-04T21:13:00+00:00", last_failed: "2026-10-04T21:43:00+00:00",
    last_error: "Discord rejected the bot token (401).", imports: since === "2026-10-30" ? [] : imports };
}
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
  if (p === "/api/dispatch/imports" && req.method === "GET") {
    if (ctl.delayFirst && q.since === "2026-10-01") await new Promise((r) => setTimeout(r, ctl.delayFirst));
    if (ctl.failList) return send(res, 502, { detail: "Bad gateway" });
    if (q.since && !/^\d{4}-\d{2}-\d{2}$/.test(q.since)) return send(res, 400, { detail: "since must be a date like 2026-10-03" });
    return send(res, 200, list(q.since));
  }
  if (p === "/api/dispatch/imports/pull") {
    entry.body = JSON.parse((await readRaw(req)) || "{}");
    await new Promise((r) => setTimeout(r, 300));
    if (ctl.pullStatus === "new") pulled = true;
    const msg = { nothing: "Nothing new from CCL since the last pull.", new: "1 new schedule from CCL.", failed: "Pull failed: Discord rejected the bot token (401).", busy: "Another pull is running. Try again in a moment." }[ctl.pullStatus];
    return send(res, 200, { status: ctl.pullStatus, message: msg, last_ok: "10/04 03:00 PM" });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("imp mock on 8799"));
