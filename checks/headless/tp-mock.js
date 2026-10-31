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

let viewer, nohome, nodefault, acctype, typeFail, team500, team403, detailFail, delFail, contact404, importBad, importFail, people, contact, nextId;
// Team 页 Columns（后端 92）：账号里存的 team_list_layout（JSON 字符串；null = 没存过）；teamLayout404 = 后端还没认这个键。
let teamLayout = null, teamLayout404 = false;
const log = [];
// 停用 / 恢复成功后多出来的 Action Log 行（新的在上），reset 清空。
const extraLog = [];
function person(id, username, display_name, items, o = {}) {
  return { id, username, display_name, email: o.email === undefined ? `${username}@example.com` : o.email, role: o.role || "staff",
    is_active: o.is_active !== false, invite_used: o.invite_used !== false, items: [...items].sort(),
    duties: o.duties || [], team_ids: o.team_ids || [], home_path: o.home_path || null,
    phone: o.phone || null, hr_phone: o.hr_phone || null };
}
function reset() {
  teamLayout = null; teamLayout404 = false;
  extraLog.length = 0;
  viewer = "superadmin"; detailFail = 0; delFail = ""; contact404 = false; importBad = false; importFail = false; nohome = false; nodefault = false; acctype = false; typeFail = false; team500 = false; team403 = false;
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
    team_ids: p.team_ids, item_count: p.items.length, duties: p.duties, phone: p.phone };
  if (!nohome) r.home_path = p.home_path;
  if (acctype) r.account_type = p.role === "partner" ? "partner" : "staff";
  return r;
};
const detail = (p) => ({ id: p.id, username: p.username, display_name: p.display_name, email: p.email,
  can_login: p.is_active && p.invite_used, pending_invite: !p.invite_used, is_superadmin: p.role === "superadmin",
  items: p.items, duties: p.duties, team_ids: p.team_ids, home_path: p.home_path,
  phone: p.phone, hr_phone: p.hr_phone,
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
      if (q.contact404) contact404 = q.contact404 === "1";
      if (q.delfail) delFail = q.delfail === "0" ? "" : q.delfail;
      if (q.teamlayout404) teamLayout404 = q.teamlayout404 === "1";
      if (q.teamlayout === "get") return send(res, 200, { value: teamLayout });
      if (q.noemail) people.find((x) => x.id === Number(q.noemail)).email = null;
      if (q.importbad) importBad = q.importbad === "1";
      if (q.importfail) importFail = q.importfail === "1";
      if (q.hrphone) people.find((x) => x.id === Number(q.hrphone)).hr_phone = "(702) 555-0199";
      if (q.log) return send(res, 200, log);
      return send(res, 200, { ok: true });
    }
    log.push(`${m} ${p} ${raw}`);
    // G203 第二批：共用读接口（后端 f76d5e9），只给 Super Admin。
    if (p === "/api/team/action-log") return send(res, 200, { next_cursor: null, entries: [
      ...extraLog,
      { id: "2-1", at: "2026-10-28T17:00:00+00:00", by: "Annie Z", action: "update", label: "Grace Liu", what: "Team", from: "Ops", to: "Sales" },
      { id: "1-1", at: "2026-10-27T17:00:00+00:00", by: "Max", action: "update", label: "Ben", what: "Display name", from: "Benny", to: "Ben" },
    ] });
    // Team ⬆ Import（全站通用导入，preview ③-1）：后端还没有，照 types/bulk-import.ts 的标准形状模拟。
    if (p === "/api/team/contacts/import/preview" || p === "/api/team/contacts/import/commit") {
      if (viewer !== "superadmin") return send(res, 403, { detail: "Superadmin access required" });
      if (!/filename="team-import.csv"/.test(raw)) return send(res, 400, { detail: "No file uploaded" });
      if (p.endsWith("/preview")) {
        if (importBad) return send(res, 400, { detail: "Missing column: Username" });
        const R = (row, status, id, values, o = {}) => ({ row, status, id, values, before: o.before || {}, changed: o.changed || [], blanked: o.blanked || [], errors: o.errors || [] });
        const rows = [
          R(2, "update", 2, { username: "grace", name: "Grace Liu", email: "grace@example.com", phone: "(702) 555-0142" }, { before: { phone: "" }, changed: ["phone"] }),
          R(3, "update", 7, { username: "ben", name: "Ben Staff", email: "ben.new@example.com", phone: "" }, { before: { email: "ben@example.com" }, changed: ["email"], blanked: ["phone"] }),
          R(4, "unchanged", 3, { username: "kevin", name: "Kevin Ho", email: "kevin@example.com", phone: "" }),
          R(5, "error", 4, { username: "mia", name: "Mia Chen", email: "kevin@example.com", phone: "" }, { errors: [{ field: "email", message: "That email address is already used by Kevin Ho (@kevin)." }] }),
          R(6, "error", null, { username: "sofya", name: "", email: "s@example.com", phone: "" }, { errors: [{ field: null, message: "No one with username “sofya”. Did you mean sofia (Sofia Ruiz)? Fix it in the file and upload again." }] }),
          R(7, "error", 8, { username: "chloe", name: "Chloe Staff", email: "", phone: "555-01" }, { errors: [{ field: "phone", message: "Phone number looks wrong. Use 10 digits, or + and the country code." }] }),
        ];
        return send(res, 200, { columns: ["username", "name", "email", "phone"], rows, counts: { new: 0, update: 2, unchanged: 1, error: 3 } });
      }
      if (importFail) return send(res, 500, { detail: "Database is busy" });
      people.find((x) => x.id === 2).phone = "(702) 555-0142";
      people.find((x) => x.id === 7).email = "ben.new@example.com";
      return send(res, 200, { created: 0, updated: 2, unchanged: 1, skipped: 3 });
    }
    const body = raw ? JSON.parse(raw) : null;
    if (viewer === "anon") return send(res, 401, { detail: "Authentication required" });
    // 后端 92：GET → {key, value}；PUT {value: "<JSON 字符串>"} → staff 200 {ok:true}，partner 403。
    if (p === "/api/user-prefs/team_list_layout") {
      if (teamLayout404) return send(res, 404, { detail: "Not Found" });
      if (m === "GET") return send(res, 200, { key: "team_list_layout", value: teamLayout });
      if (m === "PUT") {
        if (viewer === "partner") return send(res, 403, { detail: "Not available for partner accounts." });
        teamLayout = body && typeof body.value === "string" ? body.value : null;
        return send(res, 200, { ok: true });
      }
    }
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
        const np = person(nextId++, body.username, body.display_name || body.username, [], { role: body.account_type === "partner" ? "partner" : "staff", email: body.email ?? null, phone: body.phone ?? null });
        apply(np, np.role === "partner" ? { ...body, items: stripSend(body.items) } : body);
        people.push(np);
        return send(res, 201, { ok: true, id: np.id, member: detail(np) });
      }
      if (p === "/api/team/invites" && m === "POST") {
        if (badType(body)) return send(res, 400, { detail: BAD_TYPE });
        const err = validate(body);
        if (err) return send(res, 400, { detail: err });
        const token = "tptok" + nextId;
        const np = person(nextId++, "__pending_" + token, null, [], { invite_used: false, is_active: false, email: body.email ?? null, phone: body.phone ?? null, role: body.account_type === "partner" ? "partner" : "staff" });
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
      // staff 联络方式（前端提给后端的形状）：格式不对 / email 重了 400 {detail: {field, message}}；有 HR 档案的不收 phone。
      const ctm = p.match(/^\/api\/team\/members\/(\d+)\/contact$/);
      if (ctm && m === "PUT") {
        const who = people.find((x) => x.id === Number(ctm[1]));
        // 后端 G219（acbae995）：账号不在了也是 {field, message}，status 404。
        if (!who || contact404) { contact404 = false; return send(res, 404, { detail: { field: "email", message: "That account is not on the Team page any more. Reload the page." } }); }
        const email = body.email;
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { detail: { field: "email", message: "Email address looks wrong." } });
        const other = email && people.find((x) => x.id !== who.id && (x.email || "").toLowerCase() === email.toLowerCase());
        if (other) return send(res, 400, { detail: { field: "email", message: `That email address is already used by ${other.display_name} (@${other.username}).` } });
        who.email = email;
        if ("phone" in body) who.phone = body.phone;
        return send(res, 200, { ok: true, member: detail(who) });
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

    // 合并后的 Team 页：名单从 /api/users 读（同一批人），Super Admin 再并进 /api/team。
    if (p === "/api/users" && m === "GET") {
      if (viewer === "anon") return send(res, 401, { detail: "Authentication required" });
      return send(res, 200, people.map((x) => ({ id: x.id, username: x.username, display_name: x.display_name,
        initials: null, role: x.role, is_active: x.is_active, invite_used: x.invite_used, invite_token: x.invite_used ? null : "tok-" + x.id,
        created_by: "annie", created_at: "2026-09-27T03:30:00+00:00", team_ids: x.team_ids, is_self: x.id === 1 })));
    }
    // 彻底删除（后端 G212 DELETE /api/users/{id}，3d 269c3ae）：delfail=linked / self / super / 403 / 404 照后端原话回错。
    const um = p.match(/^\/api\/users\/(\d+)(\/deactivate)?$/);
    if (um && (m === "DELETE" || (m === "POST" && um[2]))) {
      const who = people.find((x) => x.id === Number(um[1]));
      if (!who) return send(res, 404, { detail: "User not found" });
      if (m === "DELETE") {
        const DEL_FAIL = {
          linked: [400, "This account is still linked to dispatch or task records, so it cannot be deleted. Deactivate it instead."],
          self: [400, "Cannot delete yourself"],
          super: [400, "Cannot delete a superadmin account"],
          403: [403, "Superadmin access required"],
          404: [404, "User not found"],
        }[delFail];
        if (DEL_FAIL) return send(res, DEL_FAIL[0], { detail: DEL_FAIL[1] });
        people = people.filter((x) => x !== who);
        return send(res, 200, { ok: true });
      }
      who.is_active = false;
      extraLog.unshift({ id: `${10 + extraLog.length}-1`, at: "2026-10-30T20:00:00+00:00", by: "Annie Z", action: "update", label: who.username, what: "Status", from: "Active", to: "Inactive" });
      return send(res, 200, { ok: true });
    }
    // G212 B4：恢复也记进 Team 的 Action Log。
    const ra = p.match(/^\/api\/users\/(\d+)\/reactivate$/);
    if (ra && m === "POST") {
      const who = people.find((x) => x.id === Number(ra[1]));
      if (!who) return send(res, 404, { detail: "User not found" });
      who.is_active = true;
      extraLog.unshift({ id: `${10 + extraLog.length}-1`, at: "2026-10-30T20:00:00+00:00", by: "Annie Z", action: "update", label: who.username, what: "Status", from: "Inactive", to: "Active" });
      return send(res, 200, { ok: true });
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
