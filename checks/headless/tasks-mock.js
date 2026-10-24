// 模拟后端：任务框（阶段三）。响应形状已对齐后端 G131（2026-10-22 上线，app/routers/tasks.py）：
// role / from_role 恒为 null、班次时间是 24 小时 "HH:MM"、新增任务收 assigned_admin_user_id。
// 内部仍用 role 决定「谁能看到哪条」（相当于后端按时间段重叠算出的结果），发出去之前由 scrub() 抹成真实形状。
// 控制：POST /__ctl {me, supervisor, fail401, failGet, now, inactive（停用的用户名，加任务指定他会 400）, reset}；GET /__log。
const http = require("http");

const ctl = { me: "lizzie", supervisor: false, fail401: false, failGet: false, notReady: false, notices: false, now: null, inactive: [] };
const log = [];

const DATE = "2026-10-16";
const NEXT_DATE = "2026-10-17"; // Closer 晚上核对的是明天的 manifest，不是今天的
const DEFAULT_NOW = `${DATE}T22:30:00.000Z`; // 3:30 PM 洛杉矶（PDT，UTC-7）

const SHIFTS = [
  { username: "veronica", display_name: "Veronica", role: "opening", shift_start: "2:00 AM", shift_end: "10:00 AM", next_username: "lizzie", next_display_name: "Lizzie" },
  { username: "jing", display_name: "Jing", role: "opening", shift_start: "6:00 AM", shift_end: "2:00 PM", next_username: "lizzie", next_display_name: "Lizzie" },
  { username: "lizzie", display_name: "Lizzie", role: "pre_closer", shift_start: "9:30 AM", shift_end: "5:30 PM", next_username: "nadia", next_display_name: "Nadia" },
  { username: "nadia", display_name: "Nadia", role: "closer", shift_start: "1:30 PM", shift_end: "9:30 PM", next_username: null, next_display_name: "tomorrow’s Opening" },
  { username: "anita", display_name: "Anita", role: null, shift_start: "8:00 AM", shift_end: "4:00 PM", next_username: null, next_display_name: null },
];

// 后端 G160 起 shifts[] 每项带 admin_user_id。
SHIFTS.forEach((s, i) => { s.admin_user_id = 11 + i; });
const USERS = Object.fromEntries(SHIFTS.map((s) => [s.username, s]));
USERS.annie = { username: "annie", display_name: "Annie", role: null, shift_start: null, shift_end: null, next_username: null, next_display_name: null };

// 本周排班小表（D5，只读；Dashboard 上挨着任务框显示）。⚠️ 占位数据：阶段二（在线排班）的
// 数据结构由另一条分支定，这里只是照着设计参考的样子造一周假数据，字段名没有和阶段二核过。
// 今天（DATE，周五）这一行要和上面 SHIFTS 对得上。
const WEEK_START = "2026-10-11"; // 周日
const WEEK_DAY_DATES = ["10/11", "10/12", "10/13", "10/14", "10/15", "10/16", "10/17"];
const TODAY_INDEX = 5; // 周五
const off = { shift: "off", time: null };
const WEEK_SCHEDULE = {
  week_label: "week of Oct 11 – 17",
  day_dates: WEEK_DAY_DATES,
  today_index: TODAY_INDEX,
  rows: [
    {
      username: "veronica",
      display_name: "Veronica",
      days: [off, { shift: "open", time: "2:00 AM–10:00 AM" }, { shift: "open", time: "2:00 AM–10:00 AM" }, { shift: "open", time: "2:00 AM–10:00 AM" }, { shift: "open", time: "2:00 AM–10:00 AM" }, { shift: "open", time: "2:00 AM–10:00 AM" }, off],
    },
    {
      username: "jing",
      display_name: "Jing",
      days: [{ shift: "close", time: "12:00 PM–9:30 PM" }, { shift: "open", time: "6:00 AM–2:00 PM" }, { shift: "open", time: "6:00 AM–2:00 PM" }, off, { shift: "open", time: "6:00 AM–2:00 PM" }, { shift: "open", time: "6:00 AM–2:00 PM" }, { shift: "close", time: "1:30 PM–9:30 PM" }],
    },
    {
      username: "lizzie",
      display_name: "Lizzie",
      days: [off, off, { shift: "mid", time: "9:30 AM–5:30 PM" }, { shift: "mid", time: "9:30 AM–5:30 PM" }, { shift: "mid", time: "9:30 AM–5:30 PM" }, { shift: "mid", time: "9:30 AM–5:30 PM" }, { shift: "mid", time: "9:30 AM–5:30 PM" }],
    },
    {
      username: "nadia",
      display_name: "Nadia",
      days: [{ shift: "open", time: "2:00 AM–12:00 PM" }, { shift: "mid", time: "9:00 AM–5:00 PM" }, { shift: "close", time: "10:00 AM–9:30 PM" }, { shift: "close", time: "1:30 PM–9:30 PM" }, { shift: "close", time: "1:30 PM–9:30 PM" }, { shift: "close", time: "1:30 PM–9:30 PM" }, { shift: "open", time: "2:00 AM–11:00 PM" }],
    },
    {
      username: "anita",
      display_name: "Anita",
      days: [off, { shift: "mid", time: "8:00 AM–4:00 PM" }, off, off, off, { shift: "mid", time: "8:00 AM–4:00 PM" }, off],
    },
  ],
};

// 最新 Work Checklist（任务包「阶段三」种子数据，2026-10-14 定稿）：原表 Duty 照录在 duty 字段，
// role 是 ops 按「Pre Close / Closer 按第 16、17 条分；其余多岗位取第一个」这条判断规则算出来的
// —— 这条判断规则本身是 ops 的设计判断，不是任务包写明的，预览时要请 Annie 确认。
// ⚠️ Max 2026-10-16 更正并澄清一个跨天的边界情况：「Hoover Dam Dispatch」（9-10AM，duty 写
// "Dispatch / Morning Assist"）实际上是头一天晚上的 Closer 就开始准备、整夜 open 着，到早上
// 9-10AM 才收口——归属上是从 Closing team 开始的，不是单纯的 Opening 工作。这里仍然简化归到
// role: "opening"（今天单日排班的 mock 模型，9-10AM 这个窗口是 Veronica/Jing 在班、也是实际把它
// 收口的人），因为真要做「归到前一天的 Closer 名下、跨天 open 着」需要跨天任务归属模型，
// 这条留给 Annie / 后端定怎么处理，不在这版 mock 里展开。
const TEMPLATES = [
  { title: "Next 3 days confirmation", duty: "Morning Assist", role: "opening", due: "13:00" },
  { title: "Check in next day confirmation and follow up next day No-Show guest", duty: "Morning Assist", role: "opening", due: "14:00" },
  { title: "Check Flixbus Booking", duty: "Morning Assist", role: "opening", due: "15:00" },
  { title: "Hoover Dam Dispatch", duty: "Dispatch / Morning Assist", role: "opening", due: "17:00", link_href: "/dispatch", link_label: "Dispatch" },
  { title: "Check Shuttle and remind Tour Guide for Shuttle Pickup", duty: "Morning Assist / Pre Close", role: "opening", due: "18:00" },
  { title: "South Lunch", duty: "Pre Close", role: "pre_closer", due: "20:00" },
  { title: "Antelope Lunch putting on Excel", duty: "Pre Close", role: "pre_closer", due: "21:00" },
  { title: "Send Last mins Confirmation", duty: "Pre Close", role: "pre_closer", due: "21:00" },
  { title: "CCL - Bus Assignments on 7 Days", duty: "Pre Close / Closer", role: "pre_closer", due: "23:00" },
  { title: "Check which tour need to be capped", duty: "Closer", role: "closer", due: "23:00" },
  { title: "Manifest", duty: "Closer", role: "closer", due: "23:00", link_href: "/dispatch/manifest", link_label: "Dispatch" },
  { title: "BZ Lunch", duty: "Pre Close", role: "pre_closer", due: "23:00" },
  { title: "Driver manifests SCREENSHOTS", duty: "Pre Close / Closer", role: "pre_closer", due: "2026-10-17T00:00:00.000Z", link_href: "/dispatch/manifest", link_label: "Dispatch" },
  { title: "Call and Text Antelope Lunch", duty: "Pre Close / Closer", role: "closer", due: "2026-10-17T01:00:00.000Z" },
  { title: "Print Shuttle Manifest", duty: "Pre Close / Closer", role: "closer", due: "2026-10-17T03:00:00.000Z", link_href: "/dispatch/manifest", link_label: "Dispatch" },
  { title: "West Lunch", duty: "Pre Close / Closer", role: "closer", due: "2026-10-17T03:00:00.000Z" },
  { title: "Email Guest Bus Letter", duty: "Pre Close / Closer", role: "closer", due: "2026-10-17T03:00:00.000Z" },
  { title: "West & South Bus Tour Helicopter (Papillon)", duty: "Pre Close / Closer", role: "closer", due: "2026-10-17T03:00:00.000Z" },
  { title: "Check Flixbus Booking (evening)", duty: "Pre Close / Closer", role: "closer", due: "2026-10-17T03:00:00.000Z" },
  { title: "Prepare South Tour Book", duty: "Pre Close / Closer", role: "closer", due: "2026-10-17T03:00:00.000Z" },
  { title: "Re-do Relay Split", duty: "Closer", role: "closer", due: "2026-10-17T04:00:00.000Z", link_href: "/dispatch", link_label: "Dispatch" },
  { title: "Checking last mins and make sure they all on Manifest", duty: "Closer", role: "closer", due: "2026-10-17T04:00:00.000Z", link_href: `/manifests?date=${NEXT_DATE}`, link_label: "Manifests" },
  { title: "Scan Manifest", duty: "Closer", role: "closer", due: "2026-10-17T04:00:00.000Z" },
].map((t, i) => ({
  ...t,
  id: 100 + i,
  priority: "high",
  due_at: /^\d{2}:\d{2}$/.test(t.due) ? `${DATE}T${t.due}:00.000Z` : t.due,
}));

function freshTasks() {
  let id = 1;
  const mk = (tpl, overrides) => ({
    id: id++,
    template_id: tpl.id,
    title: tpl.title,
    role: tpl.role,
    assigned_to_username: null,
    assigned_to_display_name: null,
    priority: tpl.priority,
    due_at: tpl.due_at,
    frequency: "daily",
    due_note: "",
    done: false,
    done_by_username: null,
    done_by_display_name: null,
    done_at: null,
    link_href: tpl.link_href ?? null,
    link_label: tpl.link_label ?? null,
    pass_over: null,
    ...overrides,
  });

  const tasks = TEMPLATES.map((tpl) => mk(tpl));
  // 按标题找，不按下标——Work Checklist 改了顺序也不会错位。

  // Opening 的清单（D4「两人共用一张清单、记录谁勾的」）：开工班已经下班，前 4 条做完了。
  const openingDone = [
    ["Next 3 days confirmation", "veronica"],
    ["Check in next day confirmation and follow up next day No-Show guest", "jing"],
    ["Check Flixbus Booking", "veronica"],
    ["Hoover Dam Dispatch", "jing"],
  ];
  for (const [title, who] of openingDone) {
    const t = tasks.find((x) => x.title === title);
    t.done = true;
    t.done_by_username = who;
    t.done_by_display_name = who === "veronica" ? "Veronica" : "Jing";
    t.done_at = t.due_at;
  }

  // "Check Shuttle…" 示范交接：Veronica 下班前没做完，交给 Lizzie，还没 Accept。
  // 接受前任务仍在交出的人（Veronica）名下，见 TaskPassOver 的注释。
  const shuttle = tasks.find((t) => t.title === "Check Shuttle and remind Tour Guide for Shuttle Pickup");
  shuttle.assigned_to_username = "veronica";
  shuttle.assigned_to_display_name = "Veronica";
  shuttle.pass_over = {
    from_username: "veronica",
    from_display_name: "Veronica",
    from_role: "opening",
    to_username: "lizzie",
    to_display_name: "Lizzie",
    note: "Shuttle guide needs a text before the 2pm pickup — didn’t get to it before I left.",
    at: `${DATE}T16:50:00.000Z`,
    accepted_at: null,
    accepted_by_username: null,
    accepted_by_display_name: null,
  };

  // 其余 Pre-closer 任务示范岗位共用清单：assigned_to 留空，这两条已完成。
  for (const title of ["South Lunch", "Antelope Lunch putting on Excel"]) {
    const t = tasks.find((x) => x.title === title);
    t.done = true;
    t.done_by_username = "lizzie";
    t.done_by_display_name = "Lizzie";
    t.done_at = t.due_at;
  }

  // Max 2026-10-16：staff 的工作和时间点按 Work Checklist 原表走，mock 种子数据不再加原表没有的
  // 示例任务——主管临时指定任务（第 18 条）、Anita 这类无固定清单的人，这些能力本身还在
  // （Add a task 面板、"team" 角色），只是不在种子数据里编一条假任务出来演示。

  return tasks;
}

let tasks = freshTasks();
let nextId = Math.max(...tasks.map((t) => t.id)) + 1;

const NOTICES = [
  { id: 1, task_title: "Check Shuttle and remind Tour Guide for Shuttle Pickup", from_display_name: "Veronica", to_display_name: "Lizzie", at: `${DATE}T16:50:00.000Z`, accepted: false },
  { id: 2, task_title: "Check Flixbus Booking", from_display_name: "Jing", to_display_name: "Veronica", at: `${DATE}T14:05:00.000Z`, accepted: true },
];

function to24h(t) {
  const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(t);
  if (!m) return t;
  const h = (Number(m[1]) % 12) + (m[3] === "PM" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}
// 真实后端：role 恒为 null、班次是 24 小时 "HH:MM"。
function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "role" && ["opening", "pre_closer", "closer", "team"].includes(x)) o[k] = null;
      else if (k === "from_role") o[k] = null;
      else if (k === "shift_start" || k === "shift_end") o[k] = typeof x === "string" ? to24h(x) : x;
      else o[k] = scrub(x);
    }
    return o;
  }
  return v;
}
function send(res, status, body) {
  if (body && typeof body === "object" && ("tasks" in body || "title" in body)) body = scrub(body);
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

function meUser() {
  return USERS[ctl.me] ?? USERS.lizzie;
}

function buildToday() {
  const me = meUser();
  const supervisor = ctl.supervisor;
  const now = ctl.now ?? DEFAULT_NOW;
  if (supervisor) {
    return {
      date: DATE,
      now,
      is_supervisor_view: true,
      me: { username: me.username, display_name: me.display_name, role: me.role, shift_start: me.shift_start, shift_end: me.shift_end },
      shifts: SHIFTS,
      tasks,
      pending_pass_overs: [],
      pass_over_notices: NOTICES,
      week_schedule: WEEK_SCHEDULE,
    };
  }
  const belongsToMe = (t) =>
    t.assigned_to_username ? t.assigned_to_username === me.username : t.role === me.role;
  const pendingToMe = (t) =>
    !!t.pass_over && !t.pass_over.accepted_at && t.pass_over.to_username === me.username;
  const pending = tasks.filter(pendingToMe);
  const activeMine = tasks.filter((t) => belongsToMe(t) && !pendingToMe(t));
  return {
    date: DATE,
    now,
    is_supervisor_view: false,
    me: { username: me.username, display_name: me.display_name, role: me.role, shift_start: me.shift_start, shift_end: me.shift_end },
    shifts: SHIFTS,
    tasks: activeMine,
    pending_pass_overs: pending,
    week_schedule: WEEK_SCHEDULE,
  };
}

// 排班提醒：时间用「今天」之外的日子 + 今天，覆盖 "Thu 10:42 AM" 和 "12:05 PM" 两种写法。
function freshSchedNotices() {
  const now = new Date();
  const ago = (ms) => new Date(now.getTime() - ms).toISOString();
  const mk = (id, type, title, body, createdAt) => ({
    id, type, title, body, created_at: createdAt, is_read: false, read_at: null,
    ref: { kind: "week", week_start: "2026-10-18" }, link: "/schedule?week=2026-10-18", actions: [],
  });
  return [
    mk(1, "schedule_published", "Schedule for Oct 18 – Oct 24 is out", "", ago(3 * 24 * 3600 * 1000)),
    mk(2, "schedule_changed", "Your shift on Wed Oct 21 changed", "Wed 10/21 Open: time is now 09:00–17:00.", ago(3600 * 1000)),
    mk(3, "schedule_changed", "Your shift on Thu Oct 22 changed", "", ago(1800 * 1000)),
    mk(4, "schedule_changed", "Your shift on Fri Oct 23 changed", "Fri 10/23 Mid: you were added.\nFri 10/23 Open: you were removed.", ago(900 * 1000)),
  ];
}
let schedNotices = freshSchedNotices();

// 后端 G138 实际发的两类通知（字符串以 npe-confirmation-service schedule_confirm.py / schedule.py 为准）。
// 2026-10-22 后端核实：/api/notices 压根不下发 actions 字段（任何 category 都没有），这里故意不带，
// 用来测前端缺字段时的兜底（lib/notices-api.ts fetchNotices 里补 ?? []）。
function confirmNotices() {
  const now = Date.now();
  const mk = (id, type, title, body, ago) => ({
    id, type, title, body, created_at: new Date(now - ago).toISOString(), is_read: false, read_at: null,
    ref: { kind: "week", week_start: "2026-10-25" }, link: "/schedule?week=2026-10-25",
  });
  return [
    mk(5, "schedule_confirm_request", "Please confirm your schedule for Oct 25 – Oct 31", "Open the schedule and tap Accept or Change.", 600 * 1000),
    mk(6, "schedule_confirm_declined", "Your requested shift on Mon Oct 26 was declined", "Mon 10/26 Mid was not approved.", 300 * 1000),
  ];
}

function findTask(id) {
  return tasks.find((t) => t.id === id);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      const b = (await readBody(req)) || {};
      if (b.reset) {
        tasks = freshTasks();
        schedNotices = freshSchedNotices();
        nextId = Math.max(...tasks.map((t) => t.id)) + 1;
        delete b.reset;
      }
      // edge：加几条边界任务（AM / PM 分界 12:00 洛杉矶、每小时重复、没有截止时间），测 AM / PM 两张卡和 Anytime 条。
      if (b.edge) {
        const base = { template_id: null, role: "pre_closer", assigned_to_username: null, assigned_to_display_name: null, priority: "moderate", frequency: "daily", due_note: "", done: false, done_by_username: null, done_by_display_name: null, done_at: null, link_href: null, link_label: null, pass_over: null };
        tasks.push(
          { ...base, id: 900, title: "ZZ Edge 11:59 AM", due_at: `${DATE}T18:59:00.000Z` },
          { ...base, id: 901, title: "ZZ Edge 12:00 PM", due_at: `${DATE}T19:00:00.000Z` },
          { ...base, id: 902, title: "ZZ Hourly check", due_at: `${DATE}T17:30:00.000Z`, frequency: "hourly" },
          { ...base, id: 903, title: "ZZ Free task", due_at: null, due_note: "When free" },
        );
        nextId = Math.max(...tasks.map((t) => t.id)) + 1;
        delete b.edge;
      }
      Object.assign(ctl, b);
      return send(res, 200, { ctl });
    }
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }

    const entry = { method: req.method, path: p };
    log.push(entry);
    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });

    if (p === "/api/me") {
      const me = meUser();
      return send(res, 200, {
        id: 1,
        username: me.username,
        display_name: me.display_name,
        initials: me.display_name.slice(0, 2).toUpperCase(),
        role: ctl.supervisor ? "supervisor" : "staff",
        is_admin: false,
        is_superadmin: false,
        is_supervisor: ctl.supervisor,
      });
    }

    // 排班类提醒（Notice 面板）。ctl.notices 开着才有这个接口；关着返回 404，模拟「后端还没上线」。
    if (p === "/api/notices" && req.method === "GET") {
      if (!ctl.notices) return send(res, 404, { detail: "mock: not found" });
      // confirmNotices：再带上后端 G138 实际发的两类（schedule_confirm_request / schedule_confirm_declined）。
      const items = ctl.confirmNotices ? [...schedNotices, ...confirmNotices()] : schedNotices;
      return send(res, 200, { unread_count: items.filter((x) => !x.read && !x.is_read).length, items });
    }
    const readMatch = p.match(/^\/api\/notices\/(\d+)\/read$/);
    if (readMatch && req.method === "POST") {
      const n = schedNotices.find((x) => x.id === Number(readMatch[1]));
      if (n) { n.is_read = true; n.read_at = new Date().toISOString(); }
      return send(res, 200, { ok: true, unread_count: schedNotices.filter((x) => !x.is_read).length });
    }
    if (p === "/api/notices/read-all" && req.method === "POST") {
      schedNotices.forEach((n) => { n.is_read = true; });
      return send(res, 200, { ok: true, unread_count: 0 });
    }

    if (p === "/api/tasks/today" && req.method === "GET") {
      // notReady：模拟现在真实的情况——后端还没有这个接口，页面要安静收起这一块，不挡其余 Dashboard。
      if (ctl.notReady) return send(res, 404, { detail: "mock: not found" });
      if (ctl.failGet) return send(res, 500, { detail: "Internal Server Error" });
      return send(res, 200, buildToday());
    }

    const doneMatch = p.match(/^\/api\/tasks\/today\/(\d+)\/done$/);
    if (doneMatch && req.method === "PUT") {
      const task = findTask(Number(doneMatch[1]));
      if (!task) return send(res, 404, { detail: "Task not found" });
      const b = await readBody(req);
      entry.body = b;
      task.done = !!b.done;
      const me = meUser();
      task.done_by_username = task.done ? me.username : null;
      task.done_by_display_name = task.done ? me.display_name : null;
      task.done_at = task.done ? (ctl.now ?? DEFAULT_NOW) : null;
      return send(res, 200, task);
    }

    const dueMatch = p.match(/^\/api\/tasks\/today\/(\d+)\/due$/);
    if (dueMatch && req.method === "PUT") {
      const task = findTask(Number(dueMatch[1]));
      if (!task) return send(res, 404, { detail: "Task not found" });
      const b = await readBody(req);
      entry.body = b;
      task.due_at = b.due_at ?? null;
      return send(res, 200, task);
    }

    const passMatch = p.match(/^\/api\/tasks\/today\/(\d+)\/pass-over$/);
    if (passMatch && req.method === "POST") {
      const task = findTask(Number(passMatch[1]));
      if (!task) return send(res, 404, { detail: "Task not found" });
      const b = await readBody(req);
      entry.body = b;
      const me = meUser();
      const next = SHIFTS.find((s) => s.username === me.username);
      const nextUser = next?.next_username ? USERS[next.next_username] : null;
      // 任务仍在我名下，直到对方 Accept（任务包第 21 条「仍在 A 名下并显示等待接受」）。
      task.assigned_to_username = me.username;
      task.assigned_to_display_name = me.display_name;
      task.pass_over = {
        from_username: me.username,
        from_display_name: me.display_name,
        from_role: me.role,
        to_username: nextUser ? nextUser.username : me.username,
        to_display_name: nextUser ? nextUser.display_name : me.display_name,
        note: b.note || "",
        at: ctl.now ?? DEFAULT_NOW,
        accepted_at: null,
        accepted_by_username: null,
        accepted_by_display_name: null,
      };
      NOTICES.unshift({
        id: NOTICES.length + 1,
        task_title: task.title,
        from_display_name: me.display_name,
        to_display_name: task.pass_over.to_display_name,
        at: ctl.now ?? DEFAULT_NOW,
        accepted: false,
      });
      return send(res, 200, task);
    }

    const acceptMatch = p.match(/^\/api\/tasks\/today\/(\d+)\/accept$/);
    if (acceptMatch && req.method === "POST") {
      const task = findTask(Number(acceptMatch[1]));
      if (!task) return send(res, 404, { detail: "Task not found" });
      if (!task.pass_over || task.pass_over.accepted_at) {
        return send(res, 409, { detail: "This task is not waiting for you to accept." });
      }
      const me = meUser();
      task.pass_over.accepted_at = ctl.now ?? DEFAULT_NOW;
      task.pass_over.accepted_by_username = me.username;
      task.pass_over.accepted_by_display_name = me.display_name;
      // 接受后任务才转到接受人名下。
      task.assigned_to_username = me.username;
      task.assigned_to_display_name = me.display_name;
      const notice = NOTICES.find((n) => n.task_title === task.title && !n.accepted);
      if (notice) notice.accepted = true;
      return send(res, 200, task);
    }

    if (p === "/api/tasks/today" && req.method === "POST") {
      const b = await readBody(req);
      entry.body = b;
      if (!b.title || !b.title.trim()) return send(res, 400, { detail: "Title is required." });
      // 后端 G160：assigned_to_username（按 shifts[].username 精确匹配）或 assigned_admin_user_id，指向同一个人才行；
      // 不存在 / 停用 → 400；都不传 = 全班共用。
      if (b.assigned_to_username !== undefined && typeof b.assigned_to_username !== "string") return send(res, 400, { detail: "assigned_to_username must be a string." });
      const byName = b.assigned_to_username !== undefined ? SHIFTS.find((s) => s.username === b.assigned_to_username.trim() && !ctl.inactive.includes(s.username)) : null;
      if (b.assigned_to_username !== undefined && !byName) return send(res, 400, { detail: `No active staff account with username '${b.assigned_to_username}'` });
      const byId = b.assigned_admin_user_id ? SHIFTS.find((s) => s.admin_user_id === b.assigned_admin_user_id) : null;
      if (b.assigned_admin_user_id && !byId) return send(res, 404, { detail: "User not found" });
      if (byName && byId && byName !== byId) return send(res, 400, { detail: "assigned_to_username and assigned_admin_user_id point at different people." });
      const assignee = byName || byId || null;
      const task = {
        id: nextId++,
        template_id: null,
        title: b.title.trim(),
        role: "team",
        assigned_to_username: assignee ? assignee.username : null,
        assigned_to_display_name: assignee ? assignee.display_name : null,
        priority: "moderate",
        due_at: b.due_at ?? null,
        frequency: "daily",
        due_note: b.due_at ? "" : "When free",
        done: false,
        done_by_username: null,
        done_by_display_name: null,
        done_at: null,
        link_href: null,
        link_label: null,
        pass_over: null,
      };
      tasks.push(task);
      return send(res, 200, task);
    }

    send(res, 404, { detail: "mock: not found" });
  })
  .listen(Number(process.env.MOCK_PORT) || 8799, () => console.log("tasks mock on", process.env.MOCK_PORT || 8799));
