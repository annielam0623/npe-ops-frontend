// 模拟后端：Staff Schedule（阶段二，拖拽排班版）。控制：POST /__ctl {role}；GET /__log。
// role: "staff" | "supervisor" | "admin" | "superadmin"（默认 supervisor，方便直接测排班）。
const http = require("http");
const ctl = { fail401: false, role: "supervisor" };
const log = [];

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
    display_name: "ZZ Test",
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
    { key: "open", label: "Open", sort_order: 1, is_active: true, default_start_time: "02:00", default_end_time: "12:00" },
    { key: "mid", label: "Mid", sort_order: 2, is_active: true, default_start_time: "11:30", default_end_time: "17:00" },
    { key: "close", label: "Close", sort_order: 3, is_active: true, default_start_time: "11:30", default_end_time: "21:30" },
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
function slot(date, shiftType, startTime, endTime, employeeId) {
  return {
    id: nextSlotId++,
    date,
    shift_type: shiftType,
    start_time: startTime,
    end_time: endTime,
    employee_id: employeeId,
    updated_by: "Annie",
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
  { at: "2026-09-25T18:00:00+00:00", by: "Annie" },
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

function weekPayload(weekData) {
  return { ...weekData, gaps: gapsFor(weekData) };
}

function findSlot(weekData, slotId) {
  return weekData.slots.find((s) => s.id === slotId);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    if (p === "/__log") return send(res, 200, log);
    if (p === "/__ctl") {
      Object.assign(ctl, await readBody(req));
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

    if (p === "/api/settings/schedule" && req.method === "GET") {
      return send(res, 200, settings);
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
      return send(res, 200, employees);
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

    const weekMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})$/.exec(p);
    if (weekMatch && req.method === "GET") {
      const weekData = getOrCreateWeek(weekMatch[1]);
      if (ctl.role === "staff" && weekData.status !== "published") {
        return send(res, 403, { detail: "This week has not been published yet." });
      }
      return send(res, 200, weekPayload(weekData));
    }

    const slotsMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/slots$/.exec(p);
    if (slotsMatch && req.method === "POST") {
      if (ctl.role === "staff") {
        return send(res, 403, { detail: "Only a supervisor or above can edit the schedule." });
      }
      const b = await readBody(req);
      entry.body = b;
      const weekData = getOrCreateWeek(slotsMatch[1]);
      weekData.slots.push(
        slot(b.date, b.shift_type, b.start_time, b.end_time, null),
      );
      return send(res, 200, weekPayload(weekData));
    }

    const slotIdMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/slots\/(\d+)$/.exec(p);
    if (slotIdMatch && req.method === "DELETE") {
      if (ctl.role === "staff") {
        return send(res, 403, { detail: "Only a supervisor or above can edit the schedule." });
      }
      const weekData = getOrCreateWeek(slotIdMatch[1]);
      const id = Number(slotIdMatch[2]);
      weekData.slots = weekData.slots.filter((s) => s.id !== id);
      return send(res, 200, weekPayload(weekData));
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
      s.updated_by = meFor(ctl.role).display_name;
      s.updated_at = new Date().toISOString();
      return send(res, 200, weekPayload(weekData));
    }

    const slotAssignMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/slots\/(\d+)\/assign$/.exec(p);
    if (slotAssignMatch && req.method === "PUT") {
      if (ctl.role === "staff") {
        return send(res, 403, { detail: "Only a supervisor or above can edit the schedule." });
      }
      const b = await readBody(req);
      entry.body = b;
      const weekData = getOrCreateWeek(slotAssignMatch[1]);
      const s = findSlot(weekData, Number(slotAssignMatch[2]));
      if (!s) return send(res, 404, { detail: "That slot no longer exists." });
      s.employee_id = b.employee_id ?? null;
      s.updated_by = meFor(ctl.role).display_name;
      s.updated_at = new Date().toISOString();
      return send(res, 200, weekPayload(weekData));
    }

    const publishMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/publish$/.exec(p);
    if (publishMatch && req.method === "POST") {
      if (ctl.role === "staff") {
        return send(res, 403, { detail: "Only a supervisor or above can publish the schedule." });
      }
      const weekData = getOrCreateWeek(publishMatch[1]);
      const gaps = gapsFor(weekData);
      if (gaps.length > 0) {
        return send(res, 400, {
          detail: "This week has coverage gaps and can't be published.",
          gaps,
        });
      }
      weekData.status = "published";
      weekData.published_at = new Date().toISOString();
      weekData.published_by = meFor(ctl.role).display_name;
      const scheduledIds = new Set(weekData.slots.filter((s) => s.employee_id != null).map((s) => s.employee_id));
      const notified = employees
        .filter((e) => scheduledIds.has(e.id))
        .map((e) => ({ employee_id: e.id, name: e.name, channels: e.email ? ["in_app", "email"] : ["in_app"] }));
      return send(res, 200, {
        status: "published",
        published_at: weekData.published_at,
        published_by: weekData.published_by,
        notified,
      });
    }

    return send(res, 404, { detail: `No mock route for ${req.method} ${p}` });
  })
  .listen(8799, () => console.log("sch mock on 8799"));
