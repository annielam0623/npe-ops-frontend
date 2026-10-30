// 模拟后端：Settings → Driver Quick Replies（G98，后端 d0 task/driver-messages）。控制：POST /__ctl；GET /__log。
const http = require("http");
const ctl = { fail401: false, staff: false, staleOrder: false, failLoad: false, log403: false };
const log = [];
let nextId = 4;
let nextLog = 3;
const replies = [
  { id: 1, body: "2 minutes away", sort_order: 1, active: true, updated_at: null },
  { id: 2, body: "Stay where you are", sort_order: 2, active: true, updated_at: null },
  { id: 3, body: "I can't find you, call me", sort_order: 3, active: false, updated_at: "2026-10-28T17:00:00+00:00" },
];
const entries = [
  { id: 2, entity_id: "3", label: "I can't find you, call me", action: "update", before: { body: "I can't find you", active: true, sort_order: 3 }, after: { body: "I can't find you, call me", active: false, sort_order: 3 }, actor: "annie", actor_name: "Annie Z", created_at: "2026-10-28T17:00:00+00:00" },
  { id: 1, entity_id: "9", label: "Old reply", action: "delete", before: { body: "Old reply", active: true, sort_order: 4 }, after: null, actor: "max", actor_name: "", created_at: "2026-10-27T17:00:00+00:00" },
];
function send(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function readBody(req) { return new Promise((r) => { let d = ""; req.setEncoding("utf8"); req.on("data", (c) => (d += c)); req.on("end", () => r(d ? JSON.parse(d) : null)); }); }
// 后端同样的校验（文字照后端的英文人话）。
function problem(body, selfId) {
  const t = String(body ?? "").trim();
  if (!t) return "Type the reply first.";
  if ([...t].length > 80) return "A quick reply can be at most 80 characters.";
  if (/[{}]/.test(t)) return "Quick replies can't contain { or }.";
  if (replies.some((r) => r.id !== selfId && r.body.toLowerCase() === t.toLowerCase())) return "That reply is already in the list.";
  return null;
}
function addLog(action, label, before, after) {
  entries.unshift({ id: nextLog++, entity_id: null, label, action, before, after, actor: "zztest", actor_name: "ZZ Test", created_at: new Date().toISOString() });
}
/** 旧形状 entries 拆成共用读接口的逐字段行（同后端 B1：一处改动一行）。 */
const WHAT = { body: "Reply", sort_order: "Position", active: "Shown to drivers" };
const showV = (k, v) => (v === null || v === undefined ? null : k === "active" ? (v ? "On" : "Off") : String(v));
function sharedRows() {
  const out = [{ id: "0-1", at: "2026-10-20T17:00:00+00:00", by: "Max", action: "update", label: "Ancient reply", what: "Reply", from: null, to: null }];
  for (const e of [...entries].reverse()) {
    const at = e.created_at, by = e.actor_name || e.actor;
    const ks = e.action === "update" ? Object.keys(WHAT).filter((k) => JSON.stringify(e.before?.[k]) !== JSON.stringify(e.after?.[k])) : ["body"];
    ks.forEach((k, i) => out.unshift({ id: `${e.id}-${i}`, at, by, action: e.action, label: e.label, what: WHAT[k], from: showV(k, e.before?.[k]), to: showV(k, e.after?.[k]) }));
  }
  return out;
}
const sorted = () => [...replies].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, await readBody(req)); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, query: url.search };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.staff ? "staff" : "admin", is_admin: !ctl.staff, is_superadmin: false });
  if (!p.startsWith("/api/driver-quick-replies")) return send(res, 404, { detail: "mock: not found" });
  if (ctl.staff) return send(res, 403, { detail: "Admin access required" });
  if (p === "/api/driver-quick-replies/log") return send(res, 200, { entries, limit: 50 });
  // G203 第四批：共用读接口（admin），what = Reply / Position / Shown to drivers；旧条目 from / to 是 null。
  if (p === "/api/driver-quick-replies/action-log") {
    if (ctl.log403) return send(res, 403, { detail: "Admin access required" });
    return send(res, 200, { next_cursor: null, entries: sharedRows() });
  }
  if (p === "/api/driver-quick-replies" && req.method === "GET") {
    if (ctl.failLoad) return send(res, 500, { detail: "Internal Server Error" });
    return send(res, 200, { replies: sorted() });
  }
  if (p === "/api/driver-quick-replies" && req.method === "POST") {
    const b = await readBody(req); entry.body = b;
    const why = problem(b.body);
    if (why) return send(res, 400, { detail: why });
    const reply = { id: nextId++, body: b.body.trim(), sort_order: Math.max(0, ...replies.map((r) => r.sort_order)) + 1, active: true, updated_at: new Date().toISOString() };
    replies.push(reply);
    addLog("create", reply.body, null, { body: reply.body, active: true, sort_order: reply.sort_order });
    return send(res, 200, { ok: true, reply });
  }
  if (p === "/api/driver-quick-replies/order" && req.method === "PUT") {
    const b = await readBody(req); entry.body = b;
    const ids = b.ids || [];
    if (ctl.staleOrder || ids.length !== replies.length || new Set(ids).size !== ids.length || !ids.every((id) => replies.some((r) => r.id === id)))
      return send(res, 400, { detail: "The list has changed since you opened this page." });
    ids.forEach((id, i) => (replies.find((r) => r.id === id).sort_order = i + 1));
    addLog("reorder", "Order", null, { ids });
    return send(res, 200, { ok: true, replies: sorted() });
  }
  const m = /^\/api\/driver-quick-replies\/(\d+)$/.exec(p);
  if (m) {
    const r = replies.find((x) => x.id === Number(m[1]));
    if (!r) return send(res, 404, { detail: "That reply no longer exists." });
    if (req.method === "PATCH") {
      const b = await readBody(req); entry.body = b;
      if (!("body" in b) && !("active" in b)) return send(res, 400, { detail: "Nothing to change." });
      if ("body" in b) { const why = problem(b.body, r.id); if (why) return send(res, 400, { detail: why }); }
      const before = { body: r.body, active: r.active, sort_order: r.sort_order };
      if ("body" in b) r.body = b.body.trim();
      if ("active" in b) r.active = !!b.active;
      r.updated_at = new Date().toISOString();
      addLog("update", r.body, before, { body: r.body, active: r.active, sort_order: r.sort_order });
      return send(res, 200, { ok: true, reply: r });
    }
    if (req.method === "DELETE") {
      replies.splice(replies.indexOf(r), 1);
      addLog("delete", r.body, { body: r.body, active: r.active, sort_order: r.sort_order }, null);
      return send(res, 200, { ok: true });
    }
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("quick replies mock up"));
