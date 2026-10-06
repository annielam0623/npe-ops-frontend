// 模拟后端：Settings → Human Resource。控制：POST /__ctl；GET /__log。
const http = require("http");
const ctl = { fail401: false, staff: false, prefMissing: false, schedule: false, bulkErr: false, fail500: false };
const log = [];
const blank = {
  legal_name: "", nickname: "", phone: "", personal_email: "", date_of_birth: "",
  license_number: "", license_state: "", license_class: "", license_expires: "", medical_card_expires: "",
  company: "", employment_status: "", job_class: "", position: "", badge_no: "", hired_on: "", separated_on: "",
  next_due: "", assignments: [], limited: [], languages: [], emergency_name: "", emergency_phone: "", notes: "",
};
let nextId = 10;
const profiles = [
  { ...blank, id: 1, user_id: 5, legal_name: "Alice Driver", nickname: "AL", phone: "+1 702 555 0101", position: "driver",
    license_number: "D123", license_expires: "2026-09-01", medical_card_expires: "2027-05-01",
    assignments: ["morning_relay"], limited: ["in_town_only"], languages: ["english"],
    license_expiry_state: "expired", medical_expiry_state: "ok" },
  { ...blank, id: 2, user_id: null, legal_name: "Bob Guide", nickname: "", position: "guide",
    license_expires: "2026-10-20", license_expiry_state: "soon", medical_expiry_state: "none",
    languages: ["english", "mandarin"] },
  { ...blank, id: 3, user_id: null, legal_name: "Carl Unknown", position: "trainer", employment_status: "full_time",
    license_expiry_state: "none", medical_expiry_state: "none" },
];
let pref = null;
function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}
function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
async function readBody(req) {
  const d = await readRaw(req);
  return d ? JSON.parse(d) : null;
}
function stateOf(p) {
  return { license_expiry_state: p.license_expires ? "ok" : "none", medical_expiry_state: p.medical_card_expires ? "ok" : "none" };
}
function previewRow(name, status, extra = {}) {
  return { ...Object.fromEntries(Object.keys(blank).map((k) => [k, ""])), legal_name: name, status, changed: [], blanked: [], ...extra };
}
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
  if (p === "/api/user-prefs/hr_list_layout") {
    if (ctl.prefMissing) return send(res, 404, { detail: "Unknown preference key" });
    if (req.method === "PUT") { const b = await readBody(req); entry.body = b; pref = b.value; return send(res, 200, { ok: true }); }
    return send(res, 200, { key: "hr_list_layout", value: pref });
  }
  if (p === "/api/hr/profiles" && req.method === "GET") {
    if (ctl.fail500) return send(res, 500, { detail: "Human Resource is misconfigured and has been disabled: x This needs a code fix, not a settings change." });
    return send(res, 200, { profiles: [...profiles].sort((a, b) => a.legal_name.localeCompare(b.legal_name)) });
  }
  if (p === "/api/hr/linkable-users") return send(res, 200, { users: [{ id: 7, label: "Dan D", role: "driver" }] });
  if (p === "/api/hr/log") {
    return send(res, 200, { limit: 50, entries: [
      { id: 3, entity_id: null, label: "Edited 2 profile(s) on the list", action: "update", before: null, after: { source: "list", edited: [{ name: "Alice Driver", changed_fields: ["nickname", "assignments"] }] }, actor: "annie", actor_name: "Annie", created_at: "2026-10-03T18:00:00+00:00" },
      { id: 2, entity_id: "2", label: "Bob Guide", action: "update", before: null, after: { changed_fields: ["phone"] }, actor: "annie", actor_name: "", created_at: "2026-10-03T17:00:00+00:00" },
      { id: 1, entity_id: null, label: "Exported 3 profile(s) to Excel", action: "export", before: null, after: { rows: 3, columns: [] }, actor: "annie", actor_name: "Annie", created_at: "2026-10-03T16:00:00+00:00" },
    ] });
  }
  if (p === "/api/hr/profiles" && req.method === "POST") {
    const b = await readBody(req); entry.body = b;
    if (!String(b.legal_name ?? "").trim()) return send(res, 400, { detail: "Legal Name is required." });
    const id = nextId++;
    profiles.push({ ...blank, ...b, id, ...stateOf(b) });
    return send(res, 200, { id, legal_name: b.legal_name });
  }
  let m = /^\/api\/hr\/profiles\/(\d+)$/.exec(p);
  if (m && req.method === "PUT") {
    const b = await readBody(req); entry.body = b;
    const row = profiles.find((x) => x.id === Number(m[1]));
    if (!row) return send(res, 404, { detail: "That profile no longer exists — it may have been deleted." });
    Object.assign(row, b, stateOf(b));
    return send(res, 200, { success: true });
  }
  if (m && req.method === "DELETE") {
    if (ctl.schedule && url.searchParams.get("confirm_schedule") !== "true") {
      return send(res, 409, { detail: { needs_confirm: true, message: "This person is still on the dispatch schedule for Sat Oct 3. If you delete them, those vehicles will have no driver or guide until someone is assigned. Past days keep their name." } });
    }
    const i = profiles.findIndex((x) => x.id === Number(m[1]));
    if (i >= 0) profiles.splice(i, 1);
    return send(res, 200, { success: true });
  }
  if (p === "/api/hr/profiles/bulk") {
    const b = await readBody(req); entry.body = b;
    if (ctl.bulkErr) return send(res, 400, { detail: { message: "In Town Only drivers can't be given Bus Tour. Untick one of them.", profile_id: 1 } });
    let updated = 0;
    for (const e of b.edits) {
      const row = profiles.find((x) => x.id === e.id);
      if (!row) continue;
      for (const [k, v] of Object.entries(e)) {
        if (k === "id") continue;
        row[k] = ["assignments", "limited", "languages"].includes(k) ? (v ? String(v).split(",") : []) : v;
      }
      updated++;
    }
    return send(res, 200, { success: true, updated, missing: 0, unchanged: 0 });
  }
  if (p === "/api/hr/export") {
    entry.method = req.method;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="NPE_Driver_List_2026-10-03.xlsx"');
    return res.end("PK-fake");
  }
  if (p === "/api/hr/import-preview" || p === "/api/hr/import-commit") {
    const raw = await readRaw(req);
    const overwrite = /name="overwrite"\r\n\r\ntrue/.test(raw);
    entry.overwrite = overwrite;
    entry.hasFile = /filename="hr\.csv"/.test(raw);
    if (p === "/api/hr/import-commit") {
      return send(res, 200, { imported: 1, updated: overwrite ? 1 : 0, unchanged: 0, skipped: overwrite ? 0 : 1, skipped_names: overwrite ? [] : ["Bob Guide"], vanished: 0 });
    }
    const rows = [
      previewRow("ZZ Test New", "new", { employment_status: "full_time", assignments: "Morning Relay" }),
      overwrite
        ? previewRow("Bob Guide", "update", { phone: "+1 555", changed: ["phone"], blanked: ["employment_status"] })
        : previewRow("Bob Guide", "exists", { phone: "+1 555" }),
      previewRow("ZZ Test New", "duplicate_in_file"),
    ];
    return send(res, 200, {
      rows, headers: ["legal_name", "phone", "employment_status", "assignments"],
      file_columns: ["legal_name", "phone", "employment_status", "assignments"], overwrite,
      counts: { new: 1, exists: overwrite ? 0 : 1, update: overwrite ? 1 : 0, unchanged: 0, duplicate: 1 },
    });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("hr mock on 8799"));
