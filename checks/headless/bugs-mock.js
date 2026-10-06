// 模拟后端：Bug Reports（ClickUp 代理）。控制：POST /__ctl {fail401, failList, truncated, failUpload, failComment}；GET /__log。
const http = require("http");
const ctl = { fail401: false, failList: false, truncated: false, failUpload: false, failComment: false, meDelay: 0, listDelay: 0 };
const log = [];
const DAY = 86_400_000;
const now = Date.now();
const sevField = (v) => ({ id: "sev", name: "Bug Severity", value: v, type_config: { options: [{ id: "p0", name: "P0", orderindex: 0 }, { id: "p1", name: "P1", orderindex: 1 }, { id: "p2", name: "P2", orderindex: 2 }] } });
const reasonField = (v) => ({ id: "rs", name: "Bug原因", value: v, type_config: { options: [{ id: "r0", name: "UI问题", orderindex: 0 }, { id: "r1", name: "逻辑错误", orderindex: 1 }] } });
const wsField = (v) => ({ id: "564243b5-f057-4195-b0b0-fedd4164369d", name: "Workstream", value: v, type_config: { options: [{ id: "fe3e41eb-4f5c-41fc-acc7-5924618baacb", name: "Tour", orderindex: 1 }] } });
const amy = { id: 1, username: "Amy", initials: "A", profilePicture: null };
const bob = { id: 2, username: "Bob", initials: "B", profilePicture: "javascript:alert(1)" };
let tasks = [
  { id: "t1", name: "ZZ <b>Login</b> fails", url: "https://app.clickup.com/t/t1", text_content: "[Reported by: Annie]\n\nSteps...", status: { status: "in progress" }, assignees: [amy], date_created: String(now - 10 * DAY), date_updated: String(now - 1 * DAY), custom_fields: [sevField(0), reasonField(1), wsField("fe3e41eb-4f5c-41fc-acc7-5924618baacb")] },
  { id: "t2", name: "ZZ Typo", url: "javascript:alert(2)", text_content: "", status: { status: "new" }, assignees: [], date_created: String(now - 2 * DAY), date_updated: String(now - 2 * DAY), custom_fields: [sevField(2)] },
  { id: "t3", name: "ZZ Old done", url: "https://app.clickup.com/t/t3", text_content: "[Reported by: Max]", status: { status: "complete" }, assignees: [bob], date_created: String(now - 40 * DAY), date_updated: String(now - 30 * DAY), custom_fields: [sevField(0)] },
  { id: "t4", name: "ZZ Rejected", url: "https://app.clickup.com/t/t4", text_content: null, status: { status: "已拒绝" }, assignees: [], date_created: String(now - 5 * DAY), date_updated: String(now - 5 * DAY), custom_fields: [] },
];
const comments = {
  t1: [
    { id: "c2", comment_text: "📅 Daily: still broken", date: String(now - 1000), user: { id: 9, username: "bot" } },
    { id: "c1", comment_text: "Amy: looking", date: String(now - 100_000), user: { id: 9, username: "bot" } },
  ],
};
const attachments = { t1: [{ id: "a1", url: "https://example.test/shot.png", date: String(now - 30_000), user: { id: 9 } }] };
let nextTask = 100;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function raw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("latin1")));
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, JSON.parse((await raw(req)) || "{}")); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/me" && ctl.meDelay) await new Promise((r) => setTimeout(r, ctl.meDelay));
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Tester", initials: "ZT", role: "staff", is_admin: false, is_superadmin: false });
  if (p === "/api/bug-reports/tasks" && req.method === "GET") {
    if (ctl.listDelay) await new Promise((r) => setTimeout(r, ctl.listDelay));
    if (ctl.failList) return send(res, 502, { err: "ClickUp upstream error", where: "bug-reports task list", upstream_status: 503 });
    return send(res, 200, { tasks, truncated: ctl.truncated });
  }
  if (p === "/api/bug-reports/tasks" && req.method === "POST") {
    const body = JSON.parse(await raw(req));
    entry.body = body;
    if (body.name === "BAD") return send(res, 502, { err: "ClickUp upstream error", where: "bug-reports create task", upstream_status: 400, upstream_err: "Task name invalid" });
    const id = `n${nextTask++}`;
    tasks.push({ id, name: body.name, url: `https://app.clickup.com/t/${id}`, text_content: body.description, status: { status: "new" }, assignees: [], date_created: String(Date.now()), date_updated: String(Date.now()), custom_fields: [] });
    return send(res, 200, { id });
  }
  let m = p.match(/^\/api\/bug-reports\/task\/([^/]+)$/);
  if (m) return send(res, 200, { id: m[1], attachments: attachments[m[1]] || [] });
  m = p.match(/^\/api\/bug-reports\/task\/([^/]+)\/comment$/);
  if (m && req.method === "GET") return send(res, 200, { comments: comments[m[1]] || [] });
  if (m && req.method === "POST") {
    const body = JSON.parse(await raw(req));
    entry.body = body;
    if (ctl.failComment) return send(res, 502, { err: "ClickUp upstream error", where: "bug-reports post comment", upstream_status: 500 });
    (comments[m[1]] ||= []).unshift({ id: `c${Date.now()}`, comment_text: body.comment_text, date: String(Date.now()), user: { id: 9, username: "bot" } });
    return send(res, 200, { id: "x" });
  }
  m = p.match(/^\/api\/bug-reports\/task\/([^/]+)\/attachment$/);
  if (m) {
    const body = await raw(req);
    entry.filename = (body.match(/filename="([^"]+)"/) || [])[1];
    if (ctl.failUpload) return send(res, 502, { err: "ClickUp upstream error", where: "bug-reports attachment", upstream_status: 413, upstream_err: "File too large" });
    return send(res, 200, { url: "https://example.test/up.png" });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("bugs mock on 8799"));
