// 模拟后端：Content Studio。控制：POST /__ctl {fail401, staff}；GET /__log。
const http = require("http");
const ctl = { fail401: false, staff: false };
const log = [];
const s = (key, value, by = null) => ({ key, value, label: null, updated_at: by ? "2026-08-19T18:02:28.452768" : null, updated_by: by });
const settings = [
  s("tmpl__global__tc_sms_with_lunch", "Hi {name}, confirm {label} on {date}: {url}", "annie"),
  s("tmpl__global__tc_sms_no_lunch", "Hi {name}: {url}"),
  s("tmpl__global__tc_email_intro", "Your {label} is on {date}."),
  s("tmpl__global__tc_email_greeting", "Hello"),
  s("tmpl__global__tc_guest_pickup_order", "location,sms"),
  s("tmpl__global__tc_guest_pu_notsure_head", "Not sure?"),
  s("tmpl__global__tix_general_reminder", "Bring ID\nArrive early"),
  s("tmpl__tix__upper_antelope_tsosie__prep_1_label", "Buy permit"),
  s("tmpl__tix__upper_antelope_tsosie__prep_1_url", "https://x"),
  s("tmpl__tix__upper_antelope_tsosie__prep_1_note", ""),
  s("tmpl__tix__upper_antelope_tsosie__prep_2_label", ""),
  s("tmpl__tix__upper_antelope_tsosie__prep_2_url", "https://keep-me"),
  s("tmpl__tix__upper_antelope_tsosie__prep_2_note", ""),
  s("tmpl__tix__upper_antelope_tsosie__prep_3_label", ""),
  s("tmpl__tix__upper_antelope_tsosie__prep_3_url", ""),
  s("tmpl__tix__upper_antelope_tsosie__prep_3_note", ""),
];
for (const set of ["tour", "tix"]) {
  for (let i = 1; i <= 8; i++) {
    settings.push(s(`tmpl__bcast__${set}__t${i}__title`, i <= 4 ? `Built-in ${i}` : i === 5 ? "Custom five" : ""));
    settings.push(s(`tmpl__bcast__${set}__t${i}__body`, i <= 5 ? `Hi {first_name} ${i}` : ""));
  }
  settings.push(s(`tmpl__bcast__${set}__signature`, "- NPE"));
}
const byKey = Object.fromEntries(settings.map((r) => [r.key, r]));
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d ? JSON.parse(d) : null));
  });
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, await readBody(req)); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Test", initials: "ZT", role: ctl.staff ? "staff" : "admin", is_admin: !ctl.staff, is_superadmin: false });
  if (p === "/api/template-settings") return send(res, 200, settings);
  if (p === "/api/template-settings/save") {
    const body = await readBody(req);
    entry.body = body;
    if (!body.key.startsWith("tmpl__")) return send(res, 400, { detail: "Invalid key prefix" });
    if (!byKey[body.key]) return send(res, 404, { detail: `Settings key not seeded: ${body.key}` });
    byKey[body.key].value = body.value;
    return send(res, 200, { ok: true, key: body.key });
  }
  if (p === "/api/template-settings/preview") {
    const body = await readBody(req);
    entry.body = body;
    return send(res, 200, { html: `<div class="gf-prepare-box">${body.overrides[`tmpl__tix__${body.tour_type}__prep_1_label`] || ""}</div>` });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("cs mock on 8799"));
