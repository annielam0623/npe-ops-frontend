// 模拟后端：Staff Schedule（阶段二，拖拽排班版）。控制：POST /__ctl {role}；GET /__log。
// role: "staff" | "supervisor" | "admin" | "superadmin"（默认 supervisor，方便直接测排班）。
const http = require("http");
// phase2: true ⇒ 二期字段（备注 note / 休假 time_off / 班次默认时间）和接口都开（POST /__ctl {phase2:true}）。
const ctl = { fail401: false, role: "supervisor", meName: "", rulesMissing: false, phase2: false };
let timeOff = []; // {id, employee_id, date, kind, note}
let nextTimeOffId = 1;
const DEFAULT_TIMES = { open: ["02:00", "10:00"], mid: ["08:00", "17:00"], close: ["13:30", "21:30"] };
let rulesDoc = { version: 1, rules: [], updated_at: null, updated_by: null };
const log = [];
const publishLog = []; // 每次 POST publish 的 body（检查 allow_gaps 用），GET /__publishes 读
let confirmWeek = "";
// Jing（4）这周的回应：null = 不在名单里。ctl.jingAccepted 设成 Looks good；Send to confirm 发送成功后后端把 accepted 重置成 no_answer（G217 ef）。
let jingAnswer = null;
const confirmReqs = [
  { id: 901, employee_id: 2, shift_type: "mid", dayIdx: 3, status: "pending" },
  { id: 902, employee_id: 2, shift_type: "open", dayIdx: 5, status: "pending" },
];

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

function meFor(role) {
  const is_admin = role === "admin" || role === "superadmin";
  const is_superadmin = role === "superadmin";
  const is_supervisor = role !== "staff"; // supervisor 及以上
  return {
    id: 1,
    username: "zztest",
    display_name: ctl.meName || "ZZ Test",
    initials: "ZT",
    role,
    is_admin,
    is_superadmin,
    is_supervisor,
  };
}

// ---- 设置：工作时段 + 班次类型（总共就 3 种：Open / Mid / Close；对象数组，不写死字符串）。
const settings = {
  work_window: { start_time: "02:00", end_time: "21:30" },
  shift_types: [
    { key: "open", label: "Open", sort_order: 1, is_active: true },
    { key: "mid", label: "Mid", sort_order: 2, is_active: true },
    { key: "close", label: "Close", sort_order: 3, is_active: true },
  ],
};

// ---- 员工名单。
let nextEmployeeId = 6;
const employees = [
  { id: 1, name: "Veronica", email: "veronica@nationalparkexpress.com", is_active: true },
  { id: 2, name: "Lizzie", email: "lizzie@nationalparkexpress.com", is_active: true },
  { id: 3, name: "Nadia", email: "nadia@nationalparkexpress.com", is_active: true },
  { id: 4, name: "Jing", email: "jing@nationalparkexpress.com", is_active: true },
  { id: 5, name: "Anita", email: "anita@nationalparkexpress.com", is_active: true },
];

let nextSlotId = 100;
// 整周 Save（G218）：每周一个 version，时段一改就变；changesLog 记每次 POST …/changes 的 body（GET /__changes 读）。
let versionSeq = 0;
function bumpVersion(w) {
  w.version = `v${++versionSeq}`;
}
const changesLog = [];
function slot(date, shiftType, startTime, endTime, employeeId) {
  return {
    id: nextSlotId++,
    date,
    shift_type: shiftType,
    start_time: startTime,
    end_time: endTime,
    employee_id: employeeId,
    note: null,
    updated_by: 1,
    updated_at: "2026-10-01T12:00:00+00:00",
  };
}

// ---- 两周种子数据：9/27 一周已发布（干净，没有空档）；10/4 一周草稿，周一 Jing 的时间打错（任务包验收第 4 条）。
const weeks = new Map();
function setWeek(weekStart, status, slots, publishedMeta) {
  weeks.set(weekStart, {
    week_start: weekStart,
    status,
    published_at: publishedMeta ? publishedMeta.at : null,
    published_by: publishedMeta ? publishedMeta.by : null,
    copied_from: null,
    slots,
  });
}

setWeek(
  "2026-09-27",
  "published",
  [
    slot("2026-09-27", "open", "02:00", "12:00", 1),
    slot("2026-09-27", "close", "11:30", "21:30", 3),
    slot("2026-09-28", "open", "02:00", "11:30", 1),
    slot("2026-09-28", "close", "11:30", "21:30", 2),
    slot("2026-09-29", "open", "02:00", "12:00", 2),
    slot("2026-09-29", "close", "11:30", "21:30", 4),
    slot("2026-09-30", "open", "02:00", "10:00", 1),
    slot("2026-09-30", "close", "09:30", "17:30", 2),
    slot("2026-09-30", "close", "13:30", "21:30", 3),
    slot("2026-10-01", "open", "02:00", "12:00", 3),
    slot("2026-10-01", "close", "11:30", "21:30", 1),
    slot("2026-10-02", "open", "02:00", "12:00", 4),
    slot("2026-10-02", "close", "11:30", "21:30", 2),
    slot("2026-10-03", "open", "02:00", "12:00", 5),
    slot("2026-10-03", "close", "11:30", "21:30", 3),
  ],
  { at: "2026-09-25T18:00:00+00:00", by: 1 },
);

setWeek("2026-10-04", "draft", [
  slot("2026-10-04", "open", "02:00", "12:00", 1),
  slot("2026-10-04", "close", "11:30", "21:30", 3),
  // 周一：Jing 时间打成 11:30 PM（23:30）而不是 11:30 AM，9:30 PM 下班没变——
  // 23:30 在工作时段（02:00–21:30）之外，等于这一格没有任何覆盖，5–9:30PM 出现空档（验收第 4 条）。
  slot("2026-10-05", "open", "02:00", "11:30", 1),
  slot("2026-10-05", "mid", "11:30", "17:00", 2),
  slot("2026-10-05", "close", "23:30", "21:30", 4),
  slot("2026-10-06", "open", "02:00", "12:00", 2),
  slot("2026-10-06", "close", "11:30", "21:30", 4),
  // 周三：Veronica + Lizzie 9:30–10:00AM 重叠，Lizzie + Nadia 1:30–5:30PM 重叠，没有空档（验收第 7 条）。
  slot("2026-10-07", "open", "02:00", "10:00", 1),
  slot("2026-10-07", "close", "09:30", "17:30", 2),
  slot("2026-10-07", "close", "13:30", "21:30", 3),
  slot("2026-10-08", "open", "02:00", "12:00", 3),
  slot("2026-10-08", "close", "11:30", "21:30", 1),
  slot("2026-10-09", "open", "02:00", "12:00", 4),
  slot("2026-10-09", "close", "11:30", "21:30", 2),
  slot("2026-10-10", "open", "02:00", "12:00", 5),
  slot("2026-10-10", "close", "11:30", "21:30", 3),
]);

function minutesOf(hhmm) {
  if (!hhmm) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function datesOfWeek(weekStart) {
  const [y, mo, d] = weekStart.split("-").map(Number);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(Date.UTC(y, mo - 1, d + i));
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

/** 按工作时段算每天的空档（下班 <= 上班、或没排到人的时段不算覆盖）。 */
function gapsFor(weekData) {
  const winStart = minutesOf(settings.work_window.start_time);
  const winEnd = minutesOf(settings.work_window.end_time);
  const gaps = [];
  for (const date of datesOfWeek(weekData.week_start)) {
    const intervals = weekData.slots
      .filter((s) => s.date === date && s.employee_id != null)
      .map((s) => [minutesOf(s.start_time), minutesOf(s.end_time)])
      .filter(([s, e]) => s != null && e != null && e > s)
      .map(([s, e]) => [Math.max(s, winStart), Math.min(e, winEnd)])
      .filter(([s, e]) => s < e)
      .sort((a, b) => a[0] - b[0]);
    let cursor = winStart;
    for (const [s, e] of intervals) {
      if (s > cursor) gaps.push({ date, start_time: hhmm(cursor), end_time: hhmm(Math.min(s, winEnd)) });
      cursor = Math.max(cursor, e);
    }
    if (cursor < winEnd) gaps.push({ date, start_time: hhmm(cursor), end_time: hhmm(winEnd) });
  }
  return gaps;
}

function hhmm(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function shiftWeekStart(date, days) {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * 这一周第一次打开、还没存过任何时段时，直接照上一周复制一份当起点（任务包：直接在上周的基础上改，
 * 不用先点「复制上一周」）；上一周也不存在就是真的空周（例如离种子数据很远的日期）。
 */
function getOrCreateWeek(weekStart) {
  if (weeks.has(weekStart)) return weeks.get(weekStart);
  const prevStart = shiftWeekStart(weekStart, -7);
  const prev = weeks.get(prevStart);
  const created = {
    week_start: weekStart,
    status: "draft",
    published_at: null,
    published_by: null,
    copied_from: prev ? prevStart : null,
    slots: prev
      ? prev.slots.map((s) => ({ ...s, id: nextSlotId++, date: shiftWeekStart(s.date, 7) }))
      : [],
  };
  weeks.set(weekStart, created);
  return created;
}

// 发布前单独发给本人确认（Annie 10-29「员工确认」）：每个人和上次发布比改了哪几天（只算时段，mock 不算休息日）。
const clock = (hm) => { const [h, m] = hm.split(":").map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const shiftWord = (t) => t.charAt(0).toUpperCase() + t.slice(1);
function pendingChangesOf(weekData) {
  if (weekData.status !== "published" || !weekData.snapshot) return [];
  const desc = (rows) => (rows.length ? rows.map(([, t, a, b]) => `${shiftWord(t)} ${clock(a)} – ${clock(b)}`).join(", ") : null);
  const out = [];
  const ids = new Set([...Object.keys(weekData.snapshot).map(Number), ...weekData.slots.map((s) => s.employee_id).filter((x) => x != null)]);
  for (const id of ids) {
    const before = JSON.parse(weekData.snapshot[id] || "[]");
    const after = weekData.slots.filter((s) => s.employee_id === id).map((s) => [s.date, s.shift_type, s.start_time, s.end_time]);
    const dates = [...new Set([...before, ...after].map((r) => r[0]))].sort();
    const items = dates
      .map((d) => ({ date: d, before: desc(before.filter((r) => r[0] === d)), after: desc(after.filter((r) => r[0] === d)) }))
      .filter((i) => i.before !== i.after);
    if (!items.length) continue;
    const emp = employees.find((e) => e.id === id);
    const sent = (weekData.sent || {})[id];
    out.push({ employee_id: id, name: emp ? emp.name : `#${id}`, items, sent_at: sent ? sent.at : null, sent_by: sent ? sent.by : null,
      // 后端 G217：has_login = 有登录账号才收站内通知。ctl.noLogin = 这些员工 id 没有账号。
      has_login: !(ctl.noLogin || []).includes(id) });
  }
  return out;
}
const sendLog = [];

function weekPayload(weekData) {
  const g = gapsFor(weekData);
  const out = { ...weekData, gaps: g, published_with_gaps: weekData.status === "published" && g.length > 0, has_unsent_changes: weekData.status === "published" && !!weekData.unsent && ctl.role !== "staff", version: weekData.version || "v0" };
  delete out.unsent;
  delete out.sent;
  // 后端 G217：只给有 schedule.edit 的人，staff 永远 []。
  out.pending_changes = ctl.role === "staff" ? [] : pendingChangesOf(weekData);
  delete out.snapshot;
  if (ctl.phase2) {
    const dates = datesOfWeek(weekData.week_start);
    out.time_off = timeOff.filter((t) => dates.includes(t.date));
  } else {
    out.slots = weekData.slots.map(({ note, ...rest }) => rest);
  }
  return out;
}

function settingsPayload() {
  if (!ctl.phase2) return settings;
  return {
    ...settings,
    shift_types: settings.shift_types.map((t) => ({
      ...t,
      default_start_time: (DEFAULT_TIMES[t.key] || [null, null])[0],
      default_end_time: (DEFAULT_TIMES[t.key] || [null, null])[1],
    })),
  };
}

function normNote(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, detail: "note must be text or null." };
  const v = raw.trim();
  if (/[\u0000-\u001f\u007f]/.test(v)) return { ok: false, detail: "note can't contain line breaks or control characters." };
  if (v.length > 120) return { ok: false, detail: "note must be at most 120 characters." };
  return { ok: true, value: v === "" ? null : v };
}

function findSlot(weekData, slotId) {
  return weekData.slots.find((s) => s.id === slotId);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__publishes") return send(res, 200, publishLog);
    if (p === "/__changes") return send(res, 200, changesLog);
    if (p === "/__bump") {
      const w = weeks.get(url.searchParams.get("week"));
      if (w) bumpVersion(w);
      return send(res, 200, { version: w ? w.version : null });
    }
    if (p === "/__sends") return send(res, 200, sendLog);
    if (p === "/__ctl") {
      Object.assign(ctl, await readBody(req));
      if (ctl.confirmReset) {
        confirmReqs.forEach((r) => (r.status = "pending"));
        ctl.confirmReset = false;
      }
      if (ctl.jingAccepted !== undefined) {
        jingAnswer = ctl.jingAccepted ? "accepted" : null;
        delete ctl.jingAccepted;
      }
      // ctl.jingAnswer：直接设 Jing 的回应（"wants_changes" / "no_answer" / null = 不在名单）。
      if (ctl.jingAnswer !== undefined) {
        jingAnswer = ctl.jingAnswer;
        delete ctl.jingAnswer;
      }
      return send(res, 200, ctl);
    }
    if (p === "/auth/login") {
      res.setHeader("Content-Type", "text/html");
      return res.end("LOGIN");
    }
    const entry = { method: req.method, path: p };
    log.push(entry);
    if (ctl.fail401) return send(res, 401, { detail: "Authentication required" });
    if (p === "/api/me") return send(res, 200, meFor(ctl.role));

    // ── 排班按周编辑占用（Annie 2026-10-19「动手改才提示」；后端排班还没有这组接口，形状照 Dispatch 的 edit-lock）──
    // ctl.lockMode：""（默认）= 接口没上线(404)；"ok" = 占得到；"busy" = 别人在改(409，detail 写谁)。
    const lm = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/edit-lock(\/heartbeat|\/release)?$/.exec(p);
    if (lm && req.method === "POST") {
      if (!ctl.lockMode) return send(res, 404, { detail: "Not Found" });
      if (!lm[2]) {
        if (ctl.lockMode === "busy") return send(res, 409, { detail: "Sam is editing this schedule (since 3:05 PM). Please try again later." });
        return send(res, 200, { token: "lock-tok-1", heartbeat_every_s: 60 });
      }
      if (lm[2] === "/heartbeat") return ctl.lockEnded ? send(res, 409, { detail: "Your editing session ended." }) : send(res, 200, { ok: true });
      return send(res, 200, { released: true });
    }

    // ── 周三确认下周排班（后端 G138 已上线，`npe-confirmation-service` 4368567，接口说明
    // docs/interfaces/schedule-wed-confirm-2026-10-20.md）── ctl.confirm 没开 = 当没有这个功能（404）。
    // 想加的班：Lizzie 周三 Mid、周五 Open，等 Approve / Decline。
    const cm = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/confirmations$/.exec(p);
    if (cm) {
      if (!ctl.confirm) return send(res, 404, { detail: "Not Found" });
      confirmWeek = cm[1];
      const days = datesOfWeek(cm[1]);
      return send(res, 200, {
        sent_at: "2026-10-07T16:00:00+00:00",
        people: [
          { employee_id: 1, name: "Veronica", answer: "accepted", answered_at: "2026-10-07T16:41:00+00:00", requests: [] },
          { employee_id: 2, name: "Lizzie", answer: "wants_changes", answered_at: "2026-10-07T18:02:00+00:00",
            requests: confirmReqs.map((r) => ({ id: r.id, date: days[r.dayIdx], shift_type: r.shift_type, status: r.status })) },
          { employee_id: 3, name: "Nadia", answer: "no_answer", answered_at: null, requests: [] },
          ...(jingAnswer ? [{ employee_id: 4, name: "Jing", answer: jingAnswer, answered_at: jingAnswer === "no_answer" ? null : "2026-10-07T17:00:00+00:00", requests: [] }] : []),
        ],
      });
    }
    const am = /^\/api\/schedule\/confirmation-requests\/(\d+)\/(approve|decline)$/.exec(p);
    if (am && req.method === "POST") {
      if (!ctl.confirm) return send(res, 404, { detail: "Not Found" });
      const r = confirmReqs.find((x) => x.id === Number(am[1]));
      if (!r) return send(res, 404, { detail: "Request not found." });
      r.status = am[2] === "approve" ? "approved" : "declined";
      if (r.status === "approved" && confirmWeek) {
        const wk = getOrCreateWeek(confirmWeek);
        const [st, en] = DEFAULT_TIMES[r.shift_type];
        wk.slots.push(slot(datesOfWeek(confirmWeek)[r.dayIdx], r.shift_type, st, en, r.employee_id));
      }
      return send(res, 200, { ok: true });
    }

    if (p === "/api/settings/schedule" && req.method === "GET") {
      return send(res, 200, settingsPayload());
    }
    const stMatch = /^\/api\/settings\/schedule\/shift-types\/([a-z_]+)$/.exec(p);
    if (stMatch && req.method === "PUT" && ctl.phase2) {
      if (ctl.role !== "superadmin") return send(res, 403, { detail: "Only a superadmin can change shift types." });
      const b = await readBody(req);
      entry.body = b;
      const hasS = b.default_start_time !== undefined && b.default_start_time !== null;
      const hasE = b.default_end_time !== undefined && b.default_end_time !== null;
      if (hasS !== hasE) return send(res, 400, { detail: "Send both default_start_time and default_end_time, or neither." });
      DEFAULT_TIMES[stMatch[1]] = hasS ? [b.default_start_time, b.default_end_time] : [null, null];
      return send(res, 200, settingsPayload().shift_types.find((t) => t.key === stMatch[1]));
    }

    // ---- 二期：休假。
    if (ctl.phase2 && p === "/api/schedule/time-off" && req.method === "PUT") {
      if (ctl.role === "staff") return send(res, 403, { detail: "Only a supervisor or above can edit the schedule." });
      const b = await readBody(req);
      entry.body = b;
      if (!["pto", "sick", "personal"].includes(b.kind || "pto")) {
        return send(res, 400, { detail: "kind must be one of: pto, sick, personal." });
      }
      const emp = employees.find((e) => e.id === b.employee_id);
      if (!emp) return send(res, 400, { detail: "Employee not found." });
      const n = normNote(b.note);
      if (!n.ok) return send(res, 400, { detail: n.detail });
      for (const d of b.dates || []) {
        const clash = [...weeks.values()].some((w) =>
          w.slots.some((s) => s.date === d && s.employee_id === emp.id),
        );
        if (clash) {
          return send(res, 400, { detail: `${emp.name} already has a shift on ${d}, so time off can't be set for that day.` });
        }
      }
      const written = [];
      for (const d of [...new Set(b.dates || [])].sort()) {
        let row = timeOff.find((t) => t.employee_id === emp.id && t.date === d);
        if (!row) {
          row = { id: nextTimeOffId++, employee_id: emp.id, date: d, kind: "pto", note: null };
          timeOff.push(row);
        }
        row.kind = b.kind || "pto";
        row.note = n.value;
        written.push(row);
      }
      return send(res, 200, { time_off: written });
    }
    const toMatch = /^\/api\/schedule\/time-off\/(\d+)$/.exec(p);
    if (ctl.phase2 && toMatch && req.method === "DELETE") {
      if (ctl.role === "staff") return send(res, 403, { detail: "Only a supervisor or above can edit the schedule." });
      const id = Number(toMatch[1]);
      if (!timeOff.some((t) => t.id === id)) return send(res, 404, { detail: "Time off not found." });
      timeOff = timeOff.filter((t) => t.id !== id);
      return send(res, 200, { ok: true });
    }
    if (p === "/api/settings/schedule/work-window" && req.method === "PUT") {
      if (ctl.role !== "superadmin") {
        return send(res, 403, { detail: "Only a superadmin can change the work window." });
      }
      const b = await readBody(req);
      entry.body = b;
      settings.work_window = { start_time: b.start_time, end_time: b.end_time };
      return send(res, 200, settings);
    }

    if (p === "/api/schedule/employees" && req.method === "GET") {
      const all = url.searchParams.get("include_inactive") === "1" && ctl.role !== "staff";
      return send(res, 200, { employees: all ? employees : employees.filter((e) => e.is_active) });
    }
    if (p === "/api/schedule/employees" && req.method === "POST") {
      if (ctl.role === "staff") {
        return send(res, 403, { detail: "Only an admin or supervisor can add employees." });
      }
      const b = await readBody(req);
      entry.body = b;
      const name = String(b.name || "").trim();
      if (!name) return send(res, 400, { detail: "Name is required." });
      const created = { id: nextEmployeeId++, name, email: String(b.email || "").trim(), is_active: true };
      employees.push(created);
      return send(res, 200, created);
    }

    // ---- 规则（后端 GET / PUT /api/schedule/rules；只存、只校验）和整周批量建（slots/bulk）。
    if (p === "/api/schedule/rules") {
      if (ctl.rulesMissing) return send(res, 404, { detail: "Not Found" });
      if (req.method === "GET") return send(res, 200, rulesDoc);
      if (req.method === "PUT") {
        if (ctl.role === "staff") return send(res, 403, { detail: "Only a supervisor or above can change the rules." });
        const b = await readBody(req);
        entry.body = b;
        if (b.version !== 1) return send(res, 400, { detail: 'Only "version": 1 is supported.' });
        const known = ["shift_times", "fixed_shift", "weekend_rotation", "cannot_work", "days_per_week", "min_days_on_shift", "min_rest", "after_shift", "coverage", "exclude_from_rotation"];
        for (let i = 0; i < (b.rules || []).length; i++) {
          const r = b.rules[i];
          if (!known.includes(r.type)) return send(res, 400, { detail: `Rule ${i + 1}: unknown type ${r.type}.` });
        }
        rulesDoc = { version: 1, rules: b.rules || [], updated_at: new Date().toISOString().slice(0, 19), updated_by: 1 };
        return send(res, 200, rulesDoc);
      }
    }
    const bulkMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/slots\/bulk$/.exec(p);
    if (bulkMatch && req.method === "POST") {
      if (ctl.role === "staff") return send(res, 403, { detail: "Only a supervisor or above can edit the schedule." });
      const b = await readBody(req);
      entry.body = b;
      const ws = bulkMatch[1];
      const existing = weeks.get(ws);
      if (existing && existing.status === "published") {
        return send(res, 400, { detail: "This week has already been published, so slots can't be bulk-created for it." });
      }
      const list = b.slots || [];
      if (list.length > 300) return send(res, 400, { detail: "Too many slots in one request (max 300)." });
      const inWeek = datesOfWeek(ws);
      for (let i = 0; i < list.length; i++) {
        const sl = list[i];
        if (!inWeek.includes(sl.date)) return send(res, 400, { detail: `Slot ${i + 1}: date must fall within this week.` });
        if (sl.employee_id != null && !employees.some((e) => e.id === sl.employee_id && e.is_active)) {
          return send(res, 400, { detail: `Slot ${i + 1}: employee ${sl.employee_id} is not active.` });
        }
      }
      const weekData = existing || { week_start: ws, status: "draft", published_at: null, published_by: null, copied_from: null, slots: [] };
      weeks.set(ws, weekData);
      const deleted = b.replace ? weekData.slots.length : 0;
      if (b.replace) weekData.slots = [];
      const made = list.map((sl) => slot(sl.date, sl.shift_type, sl.start_time, sl.end_time, sl.employee_id ?? null));
      weekData.slots.push(...made);
      return send(res, 200, { week_start: ws, status: weekData.status, deleted, slots: made });
    }

    const empMatch = /^\/api\/schedule\/employees\/(\d+)$/.exec(p);
    if (empMatch && req.method === "PUT") {
      if (ctl.role === "staff") return send(res, 403, { detail: "Only an admin or supervisor can edit employees." });
      const b = await readBody(req);
      entry.body = b;
      const e = employees.find((x) => x.id === Number(empMatch[1]));
      if (!e) return send(res, 404, { detail: "Employee not found." });
      if (b.name !== undefined) {
        if (!String(b.name).trim()) return send(res, 400, { detail: "name cannot be blank." });
        e.name = String(b.name).trim();
      }
      if (b.email !== undefined) {
        const em = String(b.email).trim() || null;
        if (em && employees.some((x) => x.id !== e.id && x.email === em)) {
          return send(res, 400, { detail: `"${em}" is already on the schedule roster.` });
        }
        e.email = em;
      }
      if (b.is_active !== undefined) e.is_active = !!b.is_active;
      return send(res, 200, e);
    }

    // 已发布的周被改动（后端 8e「改完再发」）：记下有没发的改动，Publish again 时清掉。
    const editMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/slots/.exec(p);
    if (editMatch && req.method !== "GET" && ctl.role !== "staff") {
      const w = weeks.get(editMatch[1]);
      if (w && w.status === "published") w.unsent = true;
      // 单项接口改了时段：version 跟着变（后端 G218：version = schedule_weeks.updated_at）。
      if (w) bumpVersion(w);
    }

    const weekMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})$/.exec(p);
    if (weekMatch && req.method === "GET") {
      const weekData = getOrCreateWeek(weekMatch[1]);
      if (ctl.role === "staff" && weekData.status !== "published") {
        return send(res, 403, { detail: "This week hasn't been published yet." });
      }
      return send(res, 200, weekPayload(weekData));
    }

    // ── 整周一个 Save（后端 G218，ef task/g218-week-save 57f250e，docs/interfaces/schedule-week-changes-2026-10-30.md）──
    // 整批一个事务；409 locked / stale / coverage_gap、400 带 op_index（detail 句子从 1 数）。
    // ctl.changesLocked = 别人占着锁；ctl.inactiveEmployee = 这个员工 id 不在职（批量里指派会被拒）；
    // ctl.changesNewToken = 锁过期被重新占住时回的新 token。GET /__bump?week= 模拟别人存过（version 变）。
    const changesMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/changes$/.exec(p);
    if (changesMatch && req.method === "POST") {
      if (ctl.role === "staff") return send(res, 403, { detail: "Only a supervisor or above can edit the schedule." });
      const b = await readBody(req);
      entry.body = b;
      changesLog.push({ week: changesMatch[1], body: b });
      const token = ctl.changesNewToken || b.lock_token || "lock-tok-1";
      if (ctl.changesLocked) return send(res, 409, { detail: { detail: "Sam is editing this week (since 8:40 PM). Wait until Sam saves, then save again.", code: "locked" } });
      if (!b || !Array.isArray(b.ops) || !b.ops.length) return send(res, 400, { detail: "Send at least one change." });
      if (!b.base_version) return send(res, 400, { detail: "base_version is required." });
      const weekData = getOrCreateWeek(changesMatch[1]);
      const cur = weekData.version || "v0";
      if (b.base_version !== cur) {
        return send(res, 409, { detail: { detail: "This week was changed by someone else at 8:47 PM, after you opened it.", code: "stale", version: cur, lock_token: token } });
      }
      const work = weekData.slots.map((s) => ({ ...s }));
      const created = {};
      const refs = {};
      const fail = (i, msg, slotRef) => send(res, 400, { detail: { detail: `Change ${i + 1}: ${msg}`, op_index: i, slot: slotRef ?? null, lock_token: token } });
      const find = (ref) => (typeof ref === "string" ? work.find((s) => s.id === refs[ref]) : work.find((s) => s.id === ref));
      const canWork = (empId, date) => {
        if (empId == null) return null;
        const emp = employees.find((e) => e.id === empId);
        if (!emp) return "That employee doesn't exist.";
        if (!emp.is_active || ctl.inactiveEmployee === empId) return `${emp.name} is not an active employee, so they can't be scheduled.`;
        const off = timeOff.find((t) => t.employee_id === empId && t.date === date);
        if (ctl.phase2 && off) return `${emp.name} has time off on ${date}, so they can't be scheduled that day.`;
        return null;
      };
      for (let i = 0; i < b.ops.length; i++) {
        const op = b.ops[i];
        if (op.op === "create") {
          if (!settings.shift_types.some((t) => t.key === op.shift_type)) return fail(i, "Unknown shift type.", op.ref);
          const why = canWork(op.employee_id, op.date);
          if (why) return fail(i, why, op.ref);
          const s = slot(op.date, op.shift_type, op.start_time, op.end_time, op.employee_id ?? null);
          s.note = op.note ?? null;
          work.push(s);
          if (op.ref) {
            refs[op.ref] = s.id;
            created[op.ref] = s.id;
          }
          continue;
        }
        const s = find(op.slot);
        if (!s) return fail(i, "That shift no longer exists.", op.slot);
        if (op.op === "assign") {
          const why = canWork(op.employee_id, s.date);
          if (why) return fail(i, why, op.slot);
          s.employee_id = op.employee_id ?? null;
        } else if (op.op === "time") {
          s.start_time = op.start_time;
          s.end_time = op.end_time;
        } else if (op.op === "note") {
          const n = normNote(op.note ?? "");
          if (!n.ok) return fail(i, n.detail, op.slot);
          s.note = n.value;
        } else if (op.op === "delete") {
          work.splice(work.indexOf(s), 1);
        } else return fail(i, "Unknown change.", op.slot);
      }
      if (weekData.status === "published") {
        const before = gapsFor(weekData).length;
        const after = gapsFor({ ...weekData, slots: work });
        if (after.length > before) {
          return send(res, 409, { detail: { detail: "This would leave nobody on part of a published week. Nothing was saved.", code: "coverage_gap", gaps: after } });
        }
        weekData.unsent = true;
      }
      weekData.slots = work;
      bumpVersion(weekData);
      return send(res, 200, { week: weekPayload(weekData), created, applied: b.ops.length, notified: [], lock_token: token });
    }

    const slotsMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/slots$/.exec(p);
    if (slotsMatch && req.method === "POST") {
      if (ctl.role === "staff") {
        return send(res, 403, { detail: "Only a supervisor or above can edit the schedule." });
      }
      const b = await readBody(req);
      entry.body = b;
      const weekData = getOrCreateWeek(slotsMatch[1]);
      const created = slot(b.date, b.shift_type, b.start_time, b.end_time, null);
      if (ctl.phase2 && b.note !== undefined) {
        const n = normNote(b.note);
        if (!n.ok) return send(res, 400, { detail: n.detail });
        created.note = n.value;
      }
      weekData.slots.push(created);
      return send(res, 200, created);
    }

    const slotIdMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/slots\/(\d+)$/.exec(p);
    if (slotIdMatch && req.method === "DELETE") {
      if (ctl.role === "staff") {
        return send(res, 403, { detail: "Only a supervisor or above can edit the schedule." });
      }
      const weekData = getOrCreateWeek(slotIdMatch[1]);
      const id = Number(slotIdMatch[2]);
      weekData.slots = weekData.slots.filter((s) => s.id !== id);
      return send(res, 200, { ok: true });
    }

    const slotTimeMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/slots\/(\d+)\/time$/.exec(p);
    if (slotTimeMatch && req.method === "PUT") {
      if (ctl.role === "staff") {
        return send(res, 403, { detail: "Only a supervisor or above can edit the schedule." });
      }
      const b = await readBody(req);
      entry.body = b;
      const weekData = getOrCreateWeek(slotTimeMatch[1]);
      const s = findSlot(weekData, Number(slotTimeMatch[2]));
      if (!s) return send(res, 404, { detail: "That slot no longer exists." });
      s.start_time = b.start_time;
      s.end_time = b.end_time;
      s.updated_by = 1;
      s.updated_at = new Date().toISOString();
      return send(res, 200, s);
    }

    const slotNoteMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/slots\/(\d+)\/note$/.exec(p);
    if (ctl.phase2 && slotNoteMatch && req.method === "PUT") {
      if (ctl.role === "staff") return send(res, 403, { detail: "Only a supervisor or above can edit the schedule." });
      const b = await readBody(req);
      entry.body = b;
      const weekData = getOrCreateWeek(slotNoteMatch[1]);
      const s = findSlot(weekData, Number(slotNoteMatch[2]));
      if (!s) return send(res, 404, { detail: "That slot no longer exists." });
      const n = normNote(b.note);
      if (!n.ok) return send(res, 400, { detail: n.detail });
      s.note = n.value;
      return send(res, 200, s);
    }

    const slotAssignMatch =/^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/slots\/(\d+)\/assign$/.exec(p);
    if (slotAssignMatch && req.method === "PUT") {
      if (ctl.role === "staff") {
        return send(res, 403, { detail: "Only a supervisor or above can edit the schedule." });
      }
      const b = await readBody(req);
      entry.body = b;
      const weekData = getOrCreateWeek(slotAssignMatch[1]);
      const s = findSlot(weekData, Number(slotAssignMatch[2]));
      if (!s) return send(res, 404, { detail: "That slot no longer exists." });
      if (ctl.phase2 && b.employee_id != null) {
        const off = timeOff.find((t) => t.employee_id === b.employee_id && t.date === s.date);
        if (off) {
          const emp = employees.find((e) => e.id === b.employee_id);
          return send(res, 400, { detail: `${emp.name} has time off on ${s.date}, so they can't be scheduled that day.` });
        }
      }
      s.employee_id = b.employee_id ?? null;
      s.updated_by = 1;
      s.updated_at = new Date().toISOString();
      return send(res, 200, s);
    }

    const sendMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/employees\/(\d+)\/send-changes$/.exec(p);
    if (sendMatch && req.method === "POST") {
      if (ctl.role === "staff") return send(res, 403, { detail: "Only a supervisor or above can send schedule changes." });
      const emp = employees.find((e) => e.id === Number(sendMatch[2]));
      if (!emp) return send(res, 404, { detail: "No such employee." });
      // 错误原话照后端 G217（ef）：400 没邮箱 / 没变化 / 非生产；409 要先 Publish again；502 / 503。ctl.sendFailStatus 默认 400。
      if (!emp.email) return send(res, 400, { detail: `No email for ${emp.name}. Add it in Employees, then send.` });
      if (ctl.sendFail) return send(res, ctl.sendFailStatus || 400, { detail: ctl.sendFail });
      const weekData = getOrCreateWeek(sendMatch[1]);
      const at = new Date().toISOString();
      weekData.sent = { ...(weekData.sent || {}), [emp.id]: { at, by: "ZZ Test" } };
      sendLog.push({ week: sendMatch[1], employee_id: emp.id });
      // G217 ef（Annie 定「重置」）：发送成功后，原来点 Looks good 的人回到 No answer；wants_changes 不动。
      if (emp.id === 4 && jingAnswer === "accepted") jingAnswer = "no_answer";
      return send(res, 200, { sent_at: at, sent_by: "ZZ Test", channels: ctl.sendEmailOnly ? ["email"] : ["email", "in_app"] });
    }

    const publishMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/publish$/.exec(p);
    if (publishMatch && req.method === "POST") {
      if (ctl.role === "staff") {
        return send(res, 403, { detail: "Only a supervisor or above can publish the schedule." });
      }
      const weekData = getOrCreateWeek(publishMatch[1]);
      const gaps = gapsFor(weekData);
      // Publish anyway（preview 需要后端 B1）：body {allow_gaps: true}，只给 admin 及以上；supervisor 带了也 403。
      const pubBody = await readBody(req).catch(() => null);
      publishLog.push({ week: publishMatch[1], body: pubBody, role: ctl.role });
      const allowGaps = !!(pubBody && pubBody.allow_gaps === true);
      // 后端 d2bc2cf：不是 admin / superadmin 却带了 allow_gaps ⇒ 403，不管有没有空档。
      if (allowGaps && !(ctl.role === "admin" || ctl.role === "superadmin")) {
        return send(res, 403, { detail: "Only admins can publish with a gap. Fill the gap first." });
      }
      if (gaps.length > 0 && !allowGaps) {
        // 后端 HTTPException(400, {detail, gaps}) ⇒ 响应体 {detail: {detail, gaps}}。
        return send(res, 400, {
          detail: { detail: "Can't publish — there's a gap in coverage.", gaps },
        });
      }
      // 已发布的周再 Publish：不再 409，成功；republished = true。
      // 通知规则（Annie 10-29「同意」）：重新发布只发给班有变化的人（和他们的主管，mock 不算主管）。
      const republished = weekData.status === "published";
      const shiftsOf = (id) => JSON.stringify(weekData.slots.filter((s) => s.employee_id === id).map((s) => [s.date, s.shift_type, s.start_time, s.end_time]).sort());
      const before = weekData.snapshot || {};
      const ids = new Set([...Object.keys(before).map(Number), ...weekData.slots.map((s) => s.employee_id).filter((x) => x != null)]);
      const changed = new Set([...ids].filter((id) => (before[id] || "[]") !== shiftsOf(id)));
      weekData.snapshot = Object.fromEntries([...ids].map((id) => [id, shiftsOf(id)]));
      weekData.unsent = false;
      weekData.sent = {};
      weekData.status = "published";
      bumpVersion(weekData);
      weekData.published_at = new Date().toISOString();
      weekData.published_by = 1;
      const scheduledIds = new Set(weekData.slots.filter((s) => s.employee_id != null).map((s) => s.employee_id));
      const notified = employees
        .filter((e) => scheduledIds.has(e.id))
        .map((e) => ({ employee_id: e.id, name: e.name, channels: e.email ? ["in_app", "email"] : ["in_app"] }));
      return send(res, 200, {
        week_start: publishMatch[1],
        status: "published",
        published_at: weekData.published_at,
        published_by: weekData.published_by,
        republished,
        gaps,
        notified: republished ? employees.filter((e) => changed.has(e.id)).map((e) => ({ employee_id: e.id, name: e.name, channels: e.email ? ["in_app", "email"] : ["in_app"] })) : notified,
        // 后端 G217（ef，10-30）：有人变了才通知主管层（所有在用的 supervisor / admin / superadmin，去掉按的人）；首次发布 / 没人变 = []。
        // ctl.noSupervisors：除了按的人没有别的主管（测主管 0 人时不写后半句）。
        notified_supervisors: republished && changed.size && !ctl.noSupervisors ? [{ user_id: 91, name: "ZZ Test Sup A", channels: ["in_app", "email"] }, { user_id: 92, name: "ZZ Test Sup B", channels: ["in_app"] }] : [],
      });
    }

    return send(res, 404, { detail: `No mock route for ${req.method} ${p}` });
  })
  .listen(Number(process.env.MOCK_PORT||8799), () => console.log("sch mock up"));
