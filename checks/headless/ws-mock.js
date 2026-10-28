// 模拟后端：My Workspace（G66 阶段一）。只连本机，绝不连真实后端。
// 控制：POST /__ctl {role, noDest, noUpload, failCreate, unauth}；GET /__log 看请求。
const http = require("http");

const ctl = { role: "admin", noDest: false, noUpload: false, failCreate: false, unauth: false };
const log = [];
const H = 3600 * 1000;
const iso = (ago) => new Date(Date.now() - ago).toISOString();

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

let destinations = [
  {
    id: 1, code: "tcq", name: "Transfer & Charter Quotation",
    description: "Airport transfers and hourly charters · transportation rate card",
    accepts_text: true, accepts_file: true, is_enabled: true, sort_order: 10,
  },
];
let statuses = [
  { code: "draft", name: "Draft", color: "#fbbf24", sort_order: 10, is_active: true, is_closed: false },
  { code: "review", name: "Waiting for review", color: "#c4b5fd", sort_order: 20, is_active: true, is_closed: false },
  { code: "sent", name: "Quote sent", color: "#38bdf8", sort_order: 30, is_active: true, is_closed: false },
  { code: "done", name: "Done", color: "#86efac", sort_order: 40, is_active: true, is_closed: true },
  { code: "cancel", name: "Cancelled", color: "#94a3b8", sort_order: 50, is_active: true, is_closed: true },
];
let general = { item_prefix: "WS", upload_max_bytes: 10 * 1024 * 1024, upload_types: ["xlsx", "csv", "pdf", "docx"] };
const people = [
  { id: 1, name: "ZZ Test" },
  { id: 2, name: "ZZ Test Jing" },
  { id: 3, name: "ZZ Test Nadia" },
];
const NOT_BUILT = "Reading for this destination is not built yet. The work item is saved; track it with the status and next step.";
const EMAIL = `Hi NPE team,

ZZ Test request — please quote airport transfers for our group:
5/29 pickup at LAS, KE005 arriving 16:20, 6 guests, to the Bellagio.
5/30 charter 6:30 PM – 11:00 PM, 6 guests.
6/4 drop-off to LAS, KE006 departing 11:30, 6 guests.

Thank you,
ZZ Test Contact`;

let nextId = 1045;
const items = [
  mk(1042, "ZZ Test Convention · May 29 – Jun 4", "paste", "draft", 1, 2 * H, "5 items to check, then send", NOT_BUILT),
  mk(1041, "ZZ Test Agency · LAS transfers", "paste", "sent", 1, 6 * H, "Follow up if no reply by Oct 16", ""),
  mk(1039, "ZZ Test rate request.xlsx", "file", "review", 2, 26 * H, "Check the 3 lines that do not match", ""),
  mk(1036, "ZZ Test charter · Oct 20", "paste", "review", 1, 80 * H, "Confirm the hotel before sending", ""),
  mk(1030, "ZZ Test old quote", "paste", "done", 1, 200 * H, "", ""),
  // 客人内容里有 HTML：页面必须当文字显示（不能变成元素）。
  mk(1029, "<img src=x onerror=window.__xss=1> ZZ Test", "paste", "review", 3, 90 * H, "<b>bold?</b>", ""),
];
items.find((i) => i.id === 1029).raw_text = "<script>window.__xss=1</script> ZZ Test raw";
function mk(id, title, source, status, owner, ago, next, err) {
  return {
    id, item_no: `WS-${id}`, title, source, status_code: status, next_step: next, read_error: err,
    owner_id: owner, destination_code: "tcq", destination_name: "Transfer & Charter Quotation",
    created_at: iso(ago + H), updated_at: iso(ago), raw_text: source === "paste" ? EMAIL : "",
    parsed: null, edited: null,
    files: source === "file" ? [{ id: 7, filename: title, content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: 48213, created_at: iso(ago) }] : [],
    history: [
      { action: "update", before_data: { status_code: "draft", owner_id: owner }, after_data: { status_code: status, owner_id: owner }, actor: "zztest", actor_name: "ZZ Test", created_at: iso(ago) },
      { action: "create", before_data: null, after_data: { status_code: "draft", owner_id: owner }, actor: "zztest", actor_name: "ZZ Test", created_at: iso(ago + H) },
    ],
  };
}
function summary(it) {
  const s = statuses.find((x) => x.code === it.status_code);
  const { raw_text, parsed, edited, read_error, files, history, ...rest } = it;
  return {
    ...rest, read_failed: !!read_error, owner_name: people.find((p) => p.id === it.owner_id)?.name ?? "",
    status_name: s?.name ?? null, status_color: s?.color ?? null, is_closed: !!s?.is_closed,
  };
}
const full = (it) => ({ ...summary(it), raw_text: it.raw_text, parsed: it.parsed, edited: it.edited, read_error: it.read_error, files: it.files, history: it.history });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      const b = JSON.parse((await readRaw(req)).toString() || "{}");
      if (b.reset) {
        destinations[0].name = "Transfer & Charter Quotation";
        general = { item_prefix: "WS", upload_max_bytes: 10 * 1024 * 1024, upload_types: ["xlsx", "csv", "pdf", "docx"] };
        delete b.reset;
      }
      Object.assign(ctl, b);
      log.length = 0;
      return send(res, 200, ctl);
    }
    const raw = req.method === "GET" ? null : await readRaw(req);
    const ct = req.headers["content-type"] || "";
    const body = raw && ct.includes("json") ? JSON.parse(raw.toString() || "null") : null;
    log.push({ method: req.method, path: p, query: url.search, body, multipart: ct.includes("multipart") ? raw.toString("latin1").slice(0, 2000) : null });
    // G203 第二批：共用读接口（后端 f76d5e9）。
    if (p === "/api/settings/workspace/action-log") return send(res, 200, { next_cursor: null, entries: [{ id: "2-1", at: "2026-10-28T17:00:00+00:00", by: "Annie Z", action: "update", label: "ZZ Test item", what: "Name", from: "Old", to: "New" }, { id: "1-1", at: "2026-10-27T17:00:00+00:00", by: "Max", action: "create", label: "ZZ Test item", what: "Name", from: null, to: "Old" }] });

    if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("<h1>LEGACY LOGIN</h1>"); }
    if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.role, is_admin: ctl.role !== "staff", is_superadmin: false });
    if (ctl.unauth && p.startsWith("/api/workspace")) return send(res, 401, { detail: "Not authenticated" });
    if (p.startsWith("/api/user-prefs/")) return send(res, 200, { key: p.split("/").pop(), value: null });
    if (p === "/api/nav-config") return send(res, 404, { detail: "Not Found" });

    if (p === "/api/workspace/destinations") {
      const on = ctl.noDest ? [] : destinations.filter((d) => d.is_enabled).sort((a, b) => a.sort_order - b.sort_order);
      return send(res, 200, {
        destinations: on.map(({ is_enabled, sort_order, ...d }) => d),
        show_upload: !ctl.noUpload && on.some((d) => d.accepts_file),
        upload_max_bytes: general.upload_max_bytes, upload_types: general.upload_types,
      });
    }
    if (p === "/api/workspace/statuses") return send(res, 200, { statuses: statuses.filter((s) => s.is_active) });
    if (p === "/api/workspace/colleagues") return send(res, 200, { colleagues: people });
    if (p === "/api/workspace/items" && req.method === "GET") {
      const scope = url.searchParams.get("scope");
      const status = url.searchParams.get("status");
      const base = items.filter((i) => scope === "team" || i.owner_id === 1);
      const counts = {};
      for (const i of base) counts[i.status_code] = (counts[i.status_code] || 0) + 1;
      const rows = base
        .filter((i) => (status ? i.status_code === status : !statuses.find((s) => s.code === i.status_code)?.is_closed))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return send(res, 200, { items: rows.map(summary), truncated: false, counts });
    }
    if (p === "/api/workspace/items" && req.method === "POST") {
      if (ctl.failCreate) return send(res, 400, { detail: "Save it as .xlsx and upload again." });
      const text = raw.toString("utf8");
      const m = /name="text"\r\n\r\n([\s\S]*?)\r\n--/.exec(text);
      const f = /filename="([^"]+)"/.exec(text);
      const id = nextId++;
      const it = mk(id, f ? f[1] : "", f ? "file" : "paste", "draft", 1, 0, "", NOT_BUILT);
      it.raw_text = m ? m[1] : "";
      it.history = [it.history[1]];
      items.push(it);
      return send(res, 200, full(it));
    }
    let m = /^\/api\/workspace\/items\/(\d+)$/.exec(p);
    if (m) {
      const it = items.find((i) => i.id === Number(m[1]));
      if (!it) return send(res, 404, { detail: "Work item not found." });
      if (req.method === "PUT") {
        const before = { status_code: it.status_code, owner_id: it.owner_id, title: it.title };
        if ("title" in body) it.title = body.title;
        if ("status" in body) it.status_code = body.status;
        if ("next_step" in body) it.next_step = body.next_step;
        it.updated_at = new Date().toISOString();
        it.history.unshift({ action: "update", before_data: before, after_data: { ...before, status_code: it.status_code, title: it.title }, actor: "zztest", actor_name: "ZZ Test", created_at: it.updated_at });
      }
      return send(res, 200, full(it));
    }
    m = /^\/api\/workspace\/items\/(\d+)\/assign$/.exec(p);
    if (m) {
      const it = items.find((i) => i.id === Number(m[1]));
      const before = { owner_id: it.owner_id };
      it.owner_id = body.owner_id;
      it.history.unshift({ action: "assign", before_data: before, after_data: { owner_id: it.owner_id }, actor: "zztest", actor_name: "ZZ Test", created_at: new Date().toISOString() });
      return send(res, 200, full(it));
    }
    m = /^\/api\/workspace\/items\/(\d+)\/regenerate$/.exec(p);
    if (m) return send(res, 400, { detail: NOT_BUILT });

    if (p === "/api/settings/workspace") {
      if (ctl.role === "staff") return send(res, 403, { detail: "Admin only" });
      return send(res, 200, {
        destinations, statuses,
        general: { item_prefix: general.item_prefix, upload_max_mb: general.upload_max_bytes / 1024 / 1024, upload_types: general.upload_types },
        readable_types: ["xlsx", "csv", "pdf", "docx"],
      });
    }
    m = /^\/api\/settings\/workspace\/destinations\/(\d+)$/.exec(p);
    if (m) {
      const d = destinations.find((x) => x.id === Number(m[1]));
      Object.assign(d, body);
      return send(res, 200, d);
    }
    m = /^\/api\/settings\/workspace\/statuses\/(\w+)$/.exec(p);
    if (m) {
      const s = statuses.find((x) => x.code === m[1]);
      if (s.code === "draft" && (!body.is_active || body.is_closed)) return send(res, 400, { detail: "Draft can't be turned off or closed." });
      Object.assign(s, body);
      return send(res, 200, s);
    }
    if (p === "/api/settings/workspace/general") {
      general = { item_prefix: body.item_prefix, upload_max_bytes: Math.round(body.upload_max_mb * 1024 * 1024), upload_types: body.upload_types };
      return send(res, 200, general);
    }
    return send(res, 404, { detail: "Not Found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("ws mock up"));
