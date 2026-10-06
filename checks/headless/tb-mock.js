// 模拟后端：Task Board。控制：POST /__ctl {fail401, failBacklog, failUpload, slowSprint}；GET /__log。
const http = require("http");
const ctl = { fail401: false, failBacklog: false, failUpload: false };
const log = [];
const now = Date.now();
const DAY = 86_400_000;
const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const today = new Date();
const curName = `Supplier 02 (${md(new Date(now - 3 * DAY))} - ${md(new Date(now + 3 * DAY))})`;
const oldName = `Supplier 01 (${md(new Date(now - 20 * DAY))} - ${md(new Date(now - 14 * DAY))})`;
const task = (o) => ({ url: `https://app.clickup.com/t/${o.id}`, text_content: "", status: { status: "to do", type: "open" }, priority: null, assignees: [], date_created: String(now - DAY), date_updated: String(now - DAY), due_date: null, ...o });
const lists = {
  s1: [task({ id: "a1", name: "ZZ old sprint task" })],
  s2: [
    task({ id: "b1", name: "ZZ Normal task", priority: { priority: "normal" }, assignees: [{ id: 1, username: "Amy", initials: "A" }] }),
    task({ id: "b2", name: "ZZ Urgent task", priority: { priority: "urgent" }, due_date: String(now + 2 * DAY) }),
    task({ id: "b3", name: "ZZ Done task", status: { status: "complete", type: "closed" } }),
  ],
  req: [task({ id: "r1", name: "ZZ Req", text_content: "[Reported by: Annie]\n\nNeed X" })],
  bl: [],
  bug: [task({ id: "g1", name: "ZZ Bug pool item" })],
};
let nextId = 1;
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function raw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString(req.headers["content-type"]?.includes("json") ? "utf8" : "latin1")));
  });
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/__log") return send(res, 200, log);
  if (p === "/__ctl") { Object.assign(ctl, JSON.parse((await raw(req)) || "{}")); return send(res, 200, ctl); }
  if (p === "/auth/login") { res.setHeader("Content-Type", "text/html"); return res.end("LOGIN"); }
  const entry = { method: req.method, path: p, query: url.search };
  log.push(entry);
  if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
  if (p === "/api/me") return send(res, 200, { id: 1, username: "zztest", display_name: "ZZ Tester", initials: "ZT", role: "staff", is_admin: false, is_superadmin: false });
  if (p === "/api/task-board/lists")
    return send(res, 200, {
      sprints: [{ id: "s1", name: oldName, task_count: 1, archived: false }, { id: "s2", name: curName, task_count: 3, archived: false }],
      pools: [],
      pool_ids: { requirement: "req", backlog: "bl", bug_pool: "bug" },
    });
  if (p === "/api/task-board/tasks" && req.method === "GET") {
    const id = url.searchParams.get("list_id");
    if (id === "bl" && ctl.failBacklog) return send(res, 502, { err: "ClickUp upstream error", where: "list/bl/task", upstream_status: 503 });
    return send(res, 200, { tasks: lists[id] || [], truncated: id === "bug" });
  }
  if (p === "/api/task-board/tasks" && req.method === "POST") {
    const body = JSON.parse(await raw(req));
    entry.body = body;
    const id = `n${nextId++}`;
    (lists[body.list_id] ||= []).push(task({ id, name: body.title }));
    return send(res, 200, { id });
  }
  if (p === "/api/task-board/members") return send(res, 200, { members: [{ id: 7, username: "Max" }] });
  if (p === "/api/task-board/assigned") return send(res, 200, { tasks: [task({ id: "x1", name: "ZZ assigned", list: { name: "Bug pool" } })], resolved_user_id: null, email: "azhou@example.test", truncated: false });
  if (p === "/api/task-board/docs")
    return send(res, 200, {
      docs: [
        { id: "d1", name: "Spec", pages: [{ id: "p1", name: "Overview", content: "# Title\n\n**Bold** text with `code` and [link](https://example.test) and [bad](javascript:alert(1))\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>", pages: [{ id: "p2", name: "Child", content: "" }] }], error: null },
        { id: "d2", name: "Broken", pages: [], error: "ClickUp 500" },
      ],
    });
  let m = p.match(/^\/api\/bug-reports\/task\/([^/]+)$/);
  if (m) return send(res, 200, { id: m[1], attachments: [] });
  m = p.match(/^\/api\/bug-reports\/task\/([^/]+)\/comment$/);
  if (m && req.method === "GET") return send(res, 200, { comments: m[1] === "b1" ? [{ id: "c1", comment_text: "🧩 Amy: hi", date: String(now - 1000), user: { id: 9, username: "bot" } }] : [] });
  if (m && req.method === "POST") { entry.body = JSON.parse(await raw(req)); return send(res, 200, { id: "c" }); }
  m = p.match(/^\/api\/bug-reports\/task\/([^/]+)\/attachment$/);
  if (m) {
    entry.file = ((await raw(req)).match(/filename="([^"]+)"/) || [])[1];
    if (ctl.failUpload) return send(res, 502, { err: "ClickUp upstream error", upstream_status: 413, upstream_err: "Too large" });
    return send(res, 200, { url: "https://example.test/up.png" });
  }
  send(res, 404, { detail: "mock: not found" });
}).listen(8799, () => console.log("tb mock on 8799"));
