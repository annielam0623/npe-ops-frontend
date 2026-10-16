// 模拟后端：Staff Schedule（阶段二）。控制：POST /__ctl {role}；GET /__log。
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

// ---- 设置：工作时段 + 班次类型（shift_types 是对象数组，不是写死的字符串——全局原则：除格式外什么都不写死）。
const settings = {
  work_window: { start_time: "02:00", end_time: "21:30" },
  shift_types: [
    { key: "open", label: "Open", sort_order: 1, is_active: true },
    { key: "mid", label: "Mid", sort_order: 2, is_active: true },
    { key: "close", label: "Close", sort_order: 3, is_active: true },
    { key: "off", label: "Off", sort_order: 4, is_active: true },
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

function cell(employee_id, date, shift_type, start_time, end_time, note = "") {
  return {
    employee_id,
    date,
    shift_type,
    start_time,
    end_time,
    note,
    updated_by: "Annie",
    updated_at: "2026-10-01T12:00:00+00:00",
  };
}

// ---- 两周种子数据：9/27 一周已发布（干净，没有空档）；10/4 一周草稿，周一 Jing 的时间打错（任务包验收第 4 条）。
const weeks = new Map();
weeks.set("2026-09-27", {
  week_start: "2026-09-27",
  status: "published",
  published_at: "2026-09-25T18:00:00+00:00",
  published_by: "Annie",
  cells: [
    cell(1, "2026-09-27", "open", "02:00", "12:00"),
    cell(3, "2026-09-27", "close", "11:30", "21:30"),
    cell(1, "2026-09-28", "open", "02:00", "11:30"),
    cell(2, "2026-09-28", "close", "11:30", "21:30"),
    cell(2, "2026-09-29", "open", "02:00", "12:00"),
    cell(4, "2026-09-29", "close", "11:30", "21:30"),
    cell(1, "2026-09-30", "open", "02:00", "10:00"),
    cell(2, "2026-09-30", "close", "09:30", "17:30"),
    cell(3, "2026-09-30", "close", "13:30", "21:30"),
    cell(3, "2026-10-01", "open", "02:00", "12:00"),
    cell(1, "2026-10-01", "close", "11:30", "21:30"),
    cell(4, "2026-10-02", "open", "02:00", "12:00"),
    cell(2, "2026-10-02", "close", "11:30", "21:30"),
    cell(5, "2026-10-03", "open", "02:00", "12:00"),
    cell(3, "2026-10-03", "close", "11:30", "21:30"),
  ],
});
weeks.set("2026-10-04", {
  week_start: "2026-10-04",
  status: "draft",
  published_at: null,
  published_by: null,
  cells: [
    cell(1, "2026-10-04", "open", "02:00", "12:00"),
    cell(3, "2026-10-04", "close", "11:30", "21:30"),
    cell(5, "2026-10-04", "off", null, null),
    // 周一：Jing 时间打成 11:30 PM（23:30）而不是 11:30 AM，9:30 PM 下班没变——
    // 23:30 在工作时段（02:00–21:30）之外，等于这一格没有任何覆盖，5–9:30PM 出现空档（验收第 4 条）。
    cell(1, "2026-10-05", "open", "02:00", "11:30"),
    cell(2, "2026-10-05", "mid", "11:30", "17:00"),
    cell(4, "2026-10-05", "close", "23:30", "21:30"),
    cell(2, "2026-10-06", "open", "02:00", "12:00"),
    cell(4, "2026-10-06", "close", "11:30", "21:30"),
    // 周三：Veronica + Lizzie 9:30–10:00AM 重叠，Lizzie + Nadia 1:30–5:30PM 重叠，没有空档（验收第 7 条）。
    cell(1, "2026-10-07", "open", "02:00", "10:00"),
    cell(2, "2026-10-07", "close", "09:30", "17:30"),
    cell(3, "2026-10-07", "close", "13:30", "21:30"),
    cell(5, "2026-10-07", "off", null, null),
    cell(3, "2026-10-08", "open", "02:00", "12:00"),
    cell(1, "2026-10-08", "close", "11:30", "21:30"),
    cell(4, "2026-10-09", "open", "02:00", "12:00"),
    cell(2, "2026-10-09", "close", "11:30", "21:30"),
    cell(5, "2026-10-10", "open", "02:00", "12:00"),
    cell(3, "2026-10-10", "close", "11:30", "21:30"),
  ],
});

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

/** 按工作时段算每天的空档（下班 <= 上班的格子不算覆盖，同前端 hasBadTimeRange 的判法）。 */
function gapsFor(weekData) {
  const winStart = minutesOf(settings.work_window.start_time);
  const winEnd = minutesOf(settings.work_window.end_time);
  const gaps = [];
  for (const date of datesOfWeek(weekData.week_start)) {
    const intervals = weekData.cells
      .filter((c) => c.date === date)
      .map((c) => [minutesOf(c.start_time), minutesOf(c.end_time)])
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

function getOrCreateWeek(weekStart) {
  if (!weeks.has(weekStart)) {
    weeks.set(weekStart, {
      week_start: weekStart,
      status: "draft",
      published_at: null,
      published_by: null,
      cells: [],
    });
  }
  return weeks.get(weekStart);
}

function weekPayload(weekData) {
  return { ...weekData, gaps: gapsFor(weekData) };
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

    const cellsMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/cells$/.exec(p);
    if (cellsMatch && req.method === "PUT") {
      if (ctl.role === "staff") {
        return send(res, 403, { detail: "Only a supervisor or above can edit the schedule." });
      }
      const b = await readBody(req);
      entry.body = b;
      const weekData = getOrCreateWeek(cellsMatch[1]);
      const existingIndex = weekData.cells.findIndex(
        (c) => c.employee_id === b.employee_id && c.date === b.date,
      );
      const updated = {
        employee_id: b.employee_id,
        date: b.date,
        shift_type: b.shift_type ?? null,
        start_time: b.start_time ?? null,
        end_time: b.end_time ?? null,
        note: b.note ?? "",
        updated_by: meFor(ctl.role).display_name,
        updated_at: new Date().toISOString(),
      };
      if (existingIndex >= 0) weekData.cells[existingIndex] = updated;
      else weekData.cells.push(updated);
      return send(res, 200, weekPayload(weekData));
    }

    const copyMatch = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/copy-from\/(\d{4}-\d{2}-\d{2})$/.exec(p);
    if (copyMatch && req.method === "POST") {
      if (ctl.role === "staff") {
        return send(res, 403, { detail: "Only a supervisor or above can copy a schedule." });
      }
      const [, targetStart, sourceStart] = copyMatch;
      const target = getOrCreateWeek(targetStart);
      if (target.status === "published") {
        return send(res, 400, { detail: "This week is already published and can't be overwritten." });
      }
      const source = getOrCreateWeek(sourceStart);
      const dayShift = (new Date(`${targetStart}T00:00:00Z`) - new Date(`${sourceStart}T00:00:00Z`)) / 86400000;
      target.cells = source.cells.map((c) => {
        const d = new Date(`${c.date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + dayShift);
        return { ...c, date: d.toISOString().slice(0, 10), updated_by: meFor(ctl.role).display_name, updated_at: new Date().toISOString() };
      });
      return send(res, 200, weekPayload(target));
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
      const scheduledIds = new Set(weekData.cells.filter((c) => c.shift_type && c.shift_type !== "off").map((c) => c.employee_id));
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
