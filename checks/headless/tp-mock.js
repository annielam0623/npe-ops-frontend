// Team 权限 v2 的模拟接口（/api/team/* + Users 页要的几条）。数据按后端 v119 / v121：21 个模块、58 项、9 个职责、28 个账号 + 部门邮箱。
// 控制：/__control?reset=1 | viewer=superadmin|admin|anon | nohome=1（列表行不带 home_path）| nodefault=1（catalog 不带 default_items）
//       | detailfail=<id>（这个人的详情 500）| team500=1（/api/team/* 全部 500）| team403=1（/api/team/* 全部 403）| log=1
//       | acctype=1（后端上线账号类型：列表行带 account_type，多一个 partner 账号 CCL；新建 / 邀请按 account_type 存）
//       | typefail=1（下一次切换账号类型回 404 Member not found）
//       | staffonly=1（后端 d7：catalog 每项带 staff_only；关着时不带，前端按 isSendCode 判断）
// 后端 d7（53a1a39d）：外部账号存勾选时去掉发送项（B1），切成 partner 时删掉发送勾、返回删完的 items（B2）。
const http = require("http");
const MOCK_PORT = Number(process.env.MOCK_PORT) || 8799;

// 后端 d7：只给内部员工的 7 项（staff_only: true）。reports.send_daily 不在里面，staffonly=1 时测「按标记走、不按名字猜」。
const STAFF_ONLY = new Set(["dispatch.send", "manifests.send", "tour.send", "morning.send", "tickets.send", "broadcast.send", "messages.reply"]);
let staffOnlyFlag = false;
// d7 之前的后端（staffonly=0）不去发送项，原样存。
const stripSend = (items) => (staffOnlyFlag ? (items || []).filter((c) => !STAFF_ONLY.has(c)) : items || []);
const MODULES = [
  ["dashboard", "Dashboard", [["dashboard.view", "View Dashboard"]]],
  ["forecast", "30 Days Forecast", [["forecast.view", "View 30 Days Forecast"], ["forecast.edit", "Edit 30 Days Forecast"]]],
  ["manifests", "Manifests", [["manifests.view", "View Manifests"], ["manifests.edit", "Edit Manifests"], ["manifests.send", "Send from Manifests"], ["manifests.export", "Export Manifests"]]],
  ["orders", "Orders", [["orders.view", "View Orders"], ["orders.edit", "Edit Orders"], ["orders.export", "Export Orders"]]],
  ["dispatch", "Dispatch", [["dispatch.view", "View Dispatch"], ["dispatch.edit", "Edit Dispatch"], ["dispatch.send", "Send from Dispatch"]]],
  ["forms", "Forms", [["forms.view", "View Forms"], ["forms.edit", "Edit Forms"]]],
  ["schedule", "Staff Schedule", [["schedule.view", "View Staff Schedule"], ["schedule.edit", "Edit Staff Schedule"], ["schedule.publish", "Publish Staff Schedule"]]],
  ["tasks", "Tasks", [["tasks.view_own", "View own tasks"], ["tasks.view_all", "View everyone's tasks"], ["tasks.manage", "Manage tasks", "Templates, add tasks, assign to a person, change due time"]]],
  ["report", "Daily Operation Report", [["report.view", "View Daily Operation Report"], ["report.create", "Create report entries"], ["report.edit", "Edit report entries", "Status and follow-up person"]]],
  ["morning", "Morning Pickup", [["morning.view", "View Morning Pickup"], ["morning.send", "Send Morning Pickup"]]],
  ["tour", "Tour Confirmation", [["tour.view", "View Tour Confirmation"], ["tour.send", "Send Tour Confirmation"]]],
  ["tickets", "Ticket Reminder", [["tickets.view", "View Ticket Reminder"], ["tickets.send", "Send Ticket Reminder"]]],
  ["broadcast", "Broadcast", [["broadcast.send", "Send Broadcast"]]],
  ["messages", "Messages", [["messages.view", "View Messages"], ["messages.reply", "Reply to Messages"]]],
  ["logs", "Logs", [["logs.view", "View Logs", "Order / Send / Broadcast logs"], ["logs.export", "Export Logs"], ["logs.delete", "Delete send records by date"]]],
  ["reports", "Reports", [["reports.view", "View Reports"], ["reports.export", "Export Reports"], ["reports.send_daily", "Send the nightly 3-day operations Excel"]]],
  ["workspace", "My Workspace / Quotation", [["workspace.use", "Use My Workspace"], ["quotation.create", "Create quotations"], ["quotation.rates_edit", "Edit quotation rates", "Rate card and event calendar"]]],
  ["settings", "Settings", [["settings.content", "Settings: Content"], ["settings.pickup", "Settings: Pickup locations"], ["settings.products", "Settings: Products"], ["settings.forecast", "Settings: Forecast"], ["settings.farm_out", "Settings: Farm-out (writes, prices, export)"], ["settings.vehicles", "Settings: Vehicles"], ["settings.auto_send", "Settings: Auto send"], ["settings.test_orders", "Settings: Test orders"], ["settings.users", "Settings: Users and teams"], ["settings.schedule", "Settings: Schedule work window and shift types"], ["settings.hr.view", "Settings: View HR profiles"], ["settings.hr.edit", "Settings: Edit HR profiles"], ["settings.promotions", "Settings: Promotions upload"]]],
  ["team", "Team", [["team.staff_add", "Add staff to the roster"]]],
  ["taskboard", "Task Board", [["taskboard.use", "Use the internal Task Board"]]],
  ["bugs", "Bug Reports", [["bugs.use", "Use Bug Reports"]]],
];
const WIRED_ITEMS = new Set(["schedule.publish", "report.view", "report.create", "report.edit"]);
const ALL = MODULES.flatMap((m) => m[2].map((i) => i[0]));
const STAFF = ["dashboard.view", "forecast.view", "forecast.edit", "manifests.view", "manifests.edit", "manifests.send", "manifests.export", "orders.view", "orders.edit", "dispatch.view", "dispatch.edit", "dispatch.send", "forms.view", "forms.edit", "morning.view", "morning.send", "tour.view", "tour.send", "tickets.view", "tickets.send", "broadcast.send", "messages.view", "messages.reply", "logs.view", "logs.export", "reports.view", "reports.send_daily", "schedule.view", "tasks.view_own", "report.view", "report.create", "workspace.use", "quotation.create", "orders.export", "taskboard.use", "bugs.use", "reports.export"];
const SUPERVISOR = [...STAFF, "schedule.edit", "schedule.publish", "tasks.view_all", "tasks.manage", "report.edit", "team.staff_add", "settings.hr.view"];
const ADMIN = ALL.filter((c) => c !== "settings.schedule");
const DUTIES = [["guest_messages", "Guest messages"], ["complaints", "Complaints"], ["accidents_emergencies", "Accidents & emergencies"], ["cancellations", "Cancellations"], ["refunds", "Refunds"], ["dispatching", "Dispatching"], ["finance", "Finance"], ["products_suppliers", "Products & suppliers"], ["quotations", "Quotations"]];
const TEAMS = [{ id: 1, name: "Reservations", color: "#2563eb" }, { id: 2, name: "Operations", color: "#15803d" }, { id: 3, name: "Morning", color: "#b45309" }, { id: 4, name: "Tickets", color: "#dc2626" }, { id: 5, name: "Dispatch", color: "#7c3aed" }];

let viewer, nohome, nodefault, acctype, typeFail, team500, team403, detailFail, people, contact, nextId;
const log = [];
function person(id, username, display_name, items, o = {}) {
  return { id, username, display_name, email: o.email === undefined ? `${username}@example.com` : o.email, role: o.role || "staff",
    is_active: o.is_active !== false, invite_used: o.invite_used !== false, items: [...items].sort(),
    duties: o.duties || [], team_ids: o.team_ids || [], home_path: o.home_path || null };
}
function reset() {
  viewer = "superadmin"; detailFail = 0; nohome = false; nodefault = false; acctype = false; typeFail = false; team500 = false; team403 = false;
  people = [
    person(1, "annie", "Annie", ALL, { role: "superadmin", team_ids: [1, 2] }),
    person(2, "grace", "Grace Liu", ADMIN, { role: "admin", duties: ["complaints", "refunds"], team_ids: [1] }),
    person(3, "kevin", "Kevin Ho", ADMIN, { role: "admin", duties: ["dispatching"], team_ids: [2, 5], home_path: "/dispatch" }),
    person(4, "mia", "Mia Chen", ADMIN, { role: "admin", duties: ["finance"], team_ids: [1] }),
    person(5, "daniel", "Daniel Park", SUPERVISOR, { role: "supervisor", duties: ["guest_messages"], team_ids: [2, 3], home_path: "/manifests" }),
    person(6, "sofia", "Sofia Ruiz", SUPERVISOR, { role: "supervisor", team_ids: [1, 4] }),
  ];
  const staff = ["ben", "chloe", "ethan", "fiona", "gabe", "hana", "ivan", "jade", "kai", "lena", "marco", "nina", "omar", "priya", "quinn", "rosa", "sam", "tara", "uma", "zz.test"];
  staff.forEach((u, i) => people.push(person(7 + i, u, u === "zz.test" ? "ZZ Test Staff" : u[0].toUpperCase() + u.slice(1) + " Staff", STAFF,
    { team_ids: i % 5 === 4 ? [] : [(i % 5) + 1], is_active: u !== "uma", home_path: u === "ben" ? "/morning-pickup/tracking" : null })));
  people.push(person(27, "__pending_abcd1234", null, STAFF, { invite_used: false, is_active: false, email: null }));
  people.push(person(28, "__pending_efgh5678", null, [], { invite_used: false, is_active: false, email: null }));
  nextId = 29;
  contact = { kind: "dept_contact", id: 1, name: "Reservations", email: "reservations@nationalparkexpress.com", duties: ["complaints"] };
}
reset();

const row = (p) => {
  const r = { kind: "user", id: p.id, username: p.username, display_name: p.display_name, email: p.email,
    can_login: p.is_active && p.invite_used, pending_invite: !p.invite_used, is_superadmin: p.role === "superadmin",
    team_ids: p.team_ids, item_count: p.items.length, duties: p.duties };
  if (!nohome) r.home_path = p.home_path;
  if (acctype) r.account_type = p.role === "partner" ? "partner" : "staff";
  return r;
};
const detail = (p) => ({ id: p.id, username: p.username, display_name: p.display_name, email: p.email,
  can_login: p.is_active && p.invite_used, pending_invite: !p.invite_used, is_superadmin: p.role === "superadmin",
  items: p.items, duties: p.duties, team_ids: p.team_ids, home_path: p.home_path,
  ...(acctype ? { account_type: p.role === "partner" ? "partner" : "staff" } : {}) });
const BAD_TYPE = "Account type must be staff or partner.";
const badType = (b) => acctype && b.account_type !== undefined && !["staff", "partner"].includes(b.account_type);
function validate(b) {
  const bad = (b.items || []).filter((c) => !ALL.includes(c));
  if (bad.length) return "Unknown permission item(s): " + bad.join(", ");
  if (b.home_path && !/^\/[A-Za-z0-9/_-]*$/.test(b.home_path)) return "Home page must be a path inside the site, such as /manifests";
  return null;
}
function apply(p, b) {
  p.items = [...new Set(b.items || [])].sort();
  p.duties = [...new Set(b.duties || [])].sort();
  p.team_ids = [...new Set(b.team_ids || [])].sort((a, c) => a - c);
  p.home_path = b.home_path || null;
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const m = req.method;
    if (p === "/__control") {
      const q = Object.fromEntries(url.searchParams);
      if (q.reset) { reset(); log.length = 0; }
      if (q.viewer) viewer = q.viewer;
      if (q.nohome) nohome = q.nohome === "1";
      if (q.nodefault) nodefault = q.nodefault === "1";
      if (q.acctype === "1" && !acctype) {
        acctype = true;
        people.push(person(nextId++, "ccl", "CCL Transportation", ["forecast.view"], { role: "partner", email: "ops@ccl.example", home_path: "/forecast" }));
      }
      if (q.typefail) typeFail = q.typefail === "1";
      if (q.staffonly) staffOnlyFlag = q.staffonly === "1";
      if (q.team500) team500 = q.team500 === "1";
      if (q.team403) team403 = q.team403 === "1";
      if (q.detailfail) detailFail = Number(q.detailfail);
      if (q.log) return send(res, 200, log);
      return send(res, 200, { ok: true });
    }
    log.push(`${m} ${p} ${raw}`);
    const body = raw ? JSON.parse(raw) : null;
    if (viewer === "anon") return send(res, 401, { detail: "Authentication required" });
    if (p === "/api/me") {
      return send(res, 200, { id: viewer === "superadmin" ? 1 : 2, username: viewer === "superadmin" ? "annie" : "grace",
        display_name: "Viewer", initials: "VW", role: viewer, is_admin: true, is_superadmin: viewer === "superadmin", is_supervisor: true });
    }

    if (p.startsWith("/api/team/")) {
      if (team500) return send(res, 500, { detail: "Internal Server Error" });
      if (team403 || viewer !== "superadmin") return send(res, 403, { detail: "Superadmin access required" });
      if (p === "/api/team/catalog" && m === "GET") {
        const out = {
          modules: MODULES.map(([code, display_name, items]) => {
            const its = items.map(([c, n, d]) => ({ code: c, display_name: n, description: d || "", wired: WIRED_ITEMS.has(c), ...(staffOnlyFlag ? { staff_only: STAFF_ONLY.has(c) } : {}) }));
            return { code, display_name, wired: its.every((i) => i.wired), items: its };
          }),
          duties: DUTIES.map(([code, display_name]) => ({ code, display_name, description: "" })),
          teams: TEAMS,
        };
        if (!nodefault) out.default_items = STAFF;
        return send(res, 200, out);
      }
      if (p === "/api/team/members" && m === "GET") return send(res, 200, [...people.map(row), contact]);
      if (p === "/api/team/members" && m === "POST") {
        if (!body.username || body.username.length < 3) return send(res, 400, { detail: "Username must be at least 3 characters." });
        if (people.some((x) => x.username.toLowerCase() === body.username.toLowerCase())) return send(res, 400, { detail: "That username is already taken. Please choose another." });
        if (!body.password || body.password.length < 6) return send(res, 400, { detail: "Password must be at least 6 characters." });
        if (badType(body)) return send(res, 400, { detail: BAD_TYPE });
        const err = validate(body);
        if (err) return send(res, 400, { detail: err });
        const np = person(nextId++, body.username, body.display_name || body.username, [], { role: body.account_type === "partner" ? "partner" : "staff" });
        apply(np, np.role === "partner" ? { ...body, items: stripSend(body.items) } : body);
        people.push(np);
        return send(res, 201, { ok: true, id: np.id, member: detail(np) });
      }
      if (p === "/api/team/invites" && m === "POST") {
        if (badType(body)) return send(res, 400, { detail: BAD_TYPE });
        const err = validate(body);
        if (err) return send(res, 400, { detail: err });
        const token = "tptok" + nextId;
        const np = person(nextId++, "__pending_" + token, null, [], { invite_used: false, is_active: false, email: null, role: body.account_type === "partner" ? "partner" : "staff" });
        apply(np, np.role === "partner" ? { ...body, items: stripSend(body.items) } : body);
        people.push(np);
        return send(res, 201, { ok: true, id: np.id, invite_url: "http://127.0.0.1:" + MOCK_PORT + "/register/" + token, invite_token: token, member: detail(np) });
      }
      const mm = p.match(/^\/api\/team\/members\/(\d+)$/);
      if (mm) {
        const who = people.find((x) => x.id === Number(mm[1]));
        if (!who) return send(res, 404, { detail: "Member not found" });
        if (m === "GET" && who.id === detailFail) return send(res, 500, { detail: "Internal Server Error" });
        if (m === "GET") return send(res, 200, detail(who));
        if (m === "PUT") {
          if (who.role === "superadmin") return send(res, 403, { detail: "A Super Admin account cannot be edited here" });
          if ((body.items || []).includes("FAIL")) return send(res, 400, { detail: "Unknown permission item(s): FAIL" });
          // 后端 8a 安全修补：partner 不能有职责，带了 duties 就 400。
          if (who.role === "partner" && body.duties !== undefined) return send(res, 400, { detail: "External partner accounts cannot have notification duties." });
          const err = validate(body);
          if (err) return send(res, 400, { detail: err });
          apply(who, who.role === "partner" ? { ...body, items: stripSend(body.items) } : body);
          return send(res, 200, { ok: true, member: detail(who) });
        }
      }
      // 切换账号类型（后端 8a）：只 superadmin 能调；勾选不动；partner → staff 一律 role=staff。
      const am = p.match(/^\/api\/team\/members\/(\d+)\/account-type$/);
      if (am && m === "PUT") {
        const who = people.find((x) => x.id === Number(am[1]));
        if (typeFail) { typeFail = false; return send(res, 404, { detail: "Member not found" }); }
        if (!who) return send(res, 404, { detail: "Member not found" });
        if (who.role === "superadmin") return send(res, 403, { detail: "A Super Admin account cannot be edited here" });
        if (!["staff", "partner"].includes(body.account_type)) return send(res, 400, { detail: BAD_TYPE });
        if (body.account_type === "partner") {
          who.role = "partner";
          who.items = stripSend(who.items).sort();
        } else if (who.role === "partner") who.role = "staff";
        return send(res, 200, { ok: true, member: detail(who) });
      }
      const cm = p.match(/^\/api\/team\/contacts\/(\d+)\/duties$/);
      if (cm && m === "PUT") {
        if (Number(cm[1]) !== contact.id) return send(res, 404, { detail: "Department contact not found" });
        // 后端按职责的 sort_order 排（不是按字母）。
        contact.duties = DUTIES.map((x) => x[0]).filter((c) => body.duties.includes(c));
        return send(res, 200, { ok: true, duties: contact.duties });
      }
    }

    // Users 页要的几条（只够打开页面、点 Invite Staff、改角色）。
    if (p === "/api/users" && m === "GET") {
      return send(res, 200, people.filter((x) => x.id <= 3 || x.id === 27).map((x) => ({ id: x.id, username: x.username, display_name: x.display_name,
        initials: null, role: x.role, is_active: x.is_active, invite_used: x.invite_used, invite_token: x.invite_used ? null : "tok-" + x.id,
        created_by: "annie", created_at: "2026-09-27T03:30:00+00:00", team_ids: x.team_ids, is_self: x.id === 1 })));
    }
    if (p === "/api/admin/teams" && m === "GET") return send(res, 200, TEAMS.map((t) => ({ ...t, description: null, member_count: 0, created_at: null })));
    if (p === "/api/users/invite" && m === "POST") return send(res, 200, { invite_url: "http://127.0.0.1:" + MOCK_PORT + "/register/basic1", invite_token: "basic1" });
    const rm = p.match(/^\/api\/users\/(\d+)\/role$/);
    if (rm && m === "POST") {
      const who = people.find((x) => x.id === Number(rm[1]));
      who.role = body.role;
      return send(res, 200, { ok: true, role: body.role });
    }
    send(res, 404, { detail: "Not Found" });
  });
}).listen(MOCK_PORT, () => console.log("mock on " + MOCK_PORT));
