// 模拟后端：G382 HR 排班总览（Settings › HR › Schedule）。照后端契约
// npe-confirmation-service origin/task/g382-hr-schedule @ f77fbb57 的 docs/g382-hr-schedule/interface.md（2026-11-25，7d）。
// 控制：POST /__ctl {reset, viewer: "editor"|"approver"|"hrview"|"none", canPublish, canManageLeaveTypes,
//        weekStatus: {"YYYY-MM-DD": "published"|"draft"}, fail: {"<METHOD> <path 正则>": status}, today}
//       GET /__log（只记写请求：{op, method, path, body}）。
// 种子（preview v2 https://claude.ai/artifact/B2WxdSVvzdQATs53tkzp7B 的例子，名字都是 ZZ Test 开头）：
//   2026-11-15 起 4 周，前两周 published、后两周 draft；五人 Veronica / Lizzie / Nadia / Jing / Anita。
//   班：Open 02:00–08:00、Mid 08:00–16:30、Close 13:00–21:30（工作时间 02:00–21:30）。
//   请假：Nadia Fri 11/27 15:00–17:00 Leave 待批；Jing Thu 11/26 – Fri 11/27 Sick 待批（那两天 Mid、Close）；Anita Wed 12/2 14:00–16:00 PTO 已批。
//   空档：Wed 12/2 14:00–16:00（Anita leave）、Sat 12/12 02:00–11:30（nobody）。
//   违规：Lizzie Sat 11/28 Close → Sun 11/29 Mid 只休 10.5 h（min_rest）；Nadia 12/6 那周 51 h（weekly_hours_alert）。
//   换班请求：Jing Fri 12/4 Close 换给 Anita。
const http = require("http");

const PORT = Number(process.env.MOCK_PORT || 8799);
const FROM0 = "2026-11-15";
const TYPES = {
  open: { label: "Open", start: "02:00", end: "08:00" },
  mid: { label: "Mid", start: "08:00", end: "16:30" },
  close: { label: "Close", start: "13:00", end: "21:30" },
};
const WINDOW = { start: "02:00", end: "21:30" };
const MIN_REST_H = 12;
const WEEKLY_ALERT_H = 50;

const EMP = { V: 1, L: 2, N: 3, J: 4, A: 5 };
const NAMES = { 1: "ZZ Test Veronica", 2: "ZZ Test Lizzie", 3: "ZZ Test Nadia", 4: "ZZ Test Jing", 5: "ZZ Test Anita" };

// ---- 日期 / 时间小工具 ----
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const weekOf = (ymd) => addDays(ymd, -weekday(ymd));
const mins = (hm) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};
const hm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const isHalfHour = (s) => typeof s === "string" && /^([01]\d|2[0-3]):(00|30)$/.test(s);
// 「Sat 11/28」（同契约 message 的例子）
const dayLabel = (ymd) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
const typeLabel = (t) => (TYPES[t] ? TYPES[t].label : t);

let state;
let nextId;
const log = [];
const ctl = {};

function reset() {
  nextId = 500;
  Object.assign(ctl, {
    viewer: "editor",
    canPublish: true,
    canManageLeaveTypes: true,
    weekStatus: {},
    fail: {},
    today: "2026-11-25",
  });
  const slots = [];
  const add = (date, type, emp, start, end, note = null) =>
    slots.push({
      id: nextId++,
      date,
      shift_type: type,
      start_time: start || TYPES[type].start,
      end_time: end || TYPES[type].end,
      employee_id: emp,
      note,
      updated_by: 1,
      updated_at: "2026-11-20T12:00:00+00:00",
    });
  // 默认一天：Open Veronica；Mid 周日–周三 Anita、周四–周六 Jing；Close 周日–周三 Lizzie、周四–周六 Nadia。
  const override = {
    "2026-11-23": { close: [EMP.N] }, // Mon：Lizzie 那周少一班（不到 50 h）
    "2026-11-26": { close: [EMP.L] }, // Thu：Nadia 明天 Mid，今天不排 Close（不多出一条 min_rest）
    "2026-11-27": { mid: [EMP.N, "08:00", "17:30"], close: [EMP.J] }, // Fri：Nadia 待批 3–5 PM；Jing 的 Close
    "2026-11-28": { mid: [EMP.A], close: [EMP.L] }, // Sat：Lizzie Close → 明天 Mid（10.5 h）
    "2026-11-29": { mid: [EMP.L], close: [EMP.N] },
    "2026-12-02": { close: [EMP.L, "16:00", "21:30"] }, // Wed：Anita 2–4 PM PTO ⇒ 14:00–16:00 空档
    "2026-12-04": { mid: [EMP.A], close: [EMP.J] }, // Fri：Jing Close（换班请求）
    "2026-12-05": { mid: [EMP.A] },
    "2026-12-12": { open: null, mid: [EMP.J, "11:30", "20:00"], close: [EMP.L] }, // Sat：02:00–11:30 没人
  };
  for (let i = 0; i < 28; i++) {
    const date = addDays(FROM0, i);
    const wd = weekday(date);
    const inLastWeek = date >= "2026-12-06";
    const day = {
      open: [EMP.V],
      mid: [wd <= 3 ? EMP.A : EMP.J],
      close: [inLastWeek ? (wd <= 5 ? EMP.N : EMP.L) : wd <= 3 ? EMP.L : EMP.N],
      ...(override[date] || {}),
    };
    for (const t of ["open", "mid", "close"]) if (day[t]) add(date, t, day[t][0], day[t][1], day[t][2]);
  }
  state = {
    weeks: {
      "2026-11-15": { status: "published", version: 7 },
      "2026-11-22": { status: "published", version: 4 },
      "2026-11-29": { status: "draft", version: 2 },
      "2026-12-06": { status: "draft", version: 1 },
    },
    slots,
    time_off: [
      { id: 31, employee_id: EMP.A, date: "2026-12-02", kind: "pto", start_time: "14:00", end_time: "16:00", note: null },
    ],
    categories: [
      { key: "pto", label: "PTO", sort_order: 1, is_active: true },
      { key: "sick", label: "Sick", sort_order: 2, is_active: true },
      { key: "personal", label: "Leave", sort_order: 3, is_active: true },
    ],
    leave_requests: [
      leaveReq(71, EMP.N, "2026-11-27", "2026-11-27", "personal", "15:00", "17:00", "Doctor appointment"),
      leaveReq(72, EMP.J, "2026-11-26", "2026-11-27", "sick", null, null, "Flu"),
    ],
    change_requests: [
      {
        id: 81,
        at: "2026-11-24T18:00:00+00:00",
        kind: "swap_agreed",
        by: NAMES[EMP.A],
        by_kind: "employee",
        lines: [],
        channels: [],
        request_kind: "swap",
        from_slot: { date: "2026-12-04", shift_type: "close" },
        request: { date: "2026-12-04", shift_type: "close" },
        peer: NAMES[EMP.J],
      },
    ],
  };
}

function leaveReq(id, emp, from, to, kind, start, end, note) {
  return {
    id,
    employee_id: emp,
    user_id: 100 + emp,
    employee_name: NAMES[emp],
    date_from: from,
    date_to: to,
    kind,
    kind_label: catLabel(kind),
    start_time: start,
    end_time: end,
    note,
    status: "pending",
    created_at: "2026-11-24T16:00:00Z",
    decided_by: null,
    decided_by_name: null,
    decided_at: null,
    decision_note: null,
  };
}

function catLabel(key) {
  const c = state && state.categories.find((x) => x.key === key);
  return c ? c.label : { pto: "PTO", sick: "Sick", personal: "Leave" }[key] || key;
}

const timeOffOut = (t) => ({ ...t, kind_label: catLabel(t.kind) });
const weekStatus = (w) => ctl.weekStatus[w] || state.weeks[w]?.status || "draft";

// ---- 空档：工作时间里没人在班的时段（按小时请假那段不算在班）；只算 today 起的将来 ----
function gapsFor(slots, timeOff, dates) {
  const out = [];
  for (const date of dates) {
    if (date < ctl.today) continue;
    const covered = [];
    for (const s of slots.filter((x) => x.date === date && x.employee_id != null)) {
      const offs = timeOff.filter((t) => t.employee_id === s.employee_id && t.date === date);
      if (offs.some((t) => t.start_time == null)) continue;
      let segs = [[mins(s.start_time), mins(s.end_time)]];
      for (const t of offs) {
        const a = mins(t.start_time);
        const b = mins(t.end_time);
        segs = segs.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [[x, a], [b, y]].filter(([p, q]) => q > p)));
      }
      covered.push(...segs);
    }
    covered.sort((p, q) => p[0] - q[0]);
    let cur = mins(WINDOW.start);
    const end = mins(WINDOW.end);
    const holes = [];
    for (const [a, b] of covered) {
      if (a > cur) holes.push([cur, Math.min(a, end)]);
      cur = Math.max(cur, b);
      if (cur >= end) break;
    }
    if (cur < end) holes.push([cur, end]);
    for (const [a, b] of holes.filter(([p, q]) => q > p)) {
      const leave = timeOff.find((t) => t.date === date && t.start_time != null && mins(t.start_time) < b && mins(t.end_time) > a);
      out.push({
        date,
        start_time: hm(a),
        end_time: hm(b),
        reason: leave
          ? { kind: "leave", employee_id: leave.employee_id, employee_name: NAMES[leave.employee_id], leave_kind_label: catLabel(leave.kind) }
          : { kind: "nobody", employee_id: null, employee_name: null, leave_kind_label: null },
      });
    }
  }
  return out;
}

// ---- 规则：min_rest（相邻两天两班之间 < 12 h）、weekly_hours_alert（一周 > 50 h，扣掉按小时请假） ----
function violationsFor(slots, timeOff) {
  const out = [];
  for (const emp of Object.values(EMP)) {
    const mine = slots.filter((s) => s.employee_id === emp).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
    for (let i = 1; i < mine.length; i++) {
      const p = mine[i - 1];
      const n = mine[i];
      if (addDays(p.date, 1) !== n.date) continue;
      const rest = (24 * 60 - mins(p.end_time) + mins(n.start_time)) / 60;
      if (rest < MIN_REST_H)
        out.push({
          rule: "min_rest",
          employee_id: emp,
          employee_name: NAMES[emp],
          dates: [p.date, n.date],
          slot_ids: [p.id, n.id],
          message: `${NAMES[emp]}: ${rest} h rest between ${dayLabel(p.date)} ${typeLabel(p.shift_type)} and ${dayLabel(n.date)} ${typeLabel(n.shift_type)} (needs ${MIN_REST_H}).`,
        });
    }
    const byWeek = {};
    for (const s of mine) {
      let m = mins(s.end_time) - mins(s.start_time);
      for (const t of timeOff.filter((x) => x.employee_id === emp && x.date === s.date && x.start_time != null))
        m -= Math.max(0, Math.min(mins(s.end_time), mins(t.end_time)) - Math.max(mins(s.start_time), mins(t.start_time)));
      const w = weekOf(s.date);
      (byWeek[w] = byWeek[w] || { m: 0, ids: [], dates: [] }).m += m;
      byWeek[w].ids.push(s.id);
      byWeek[w].dates.push(s.date);
    }
    for (const [w, v] of Object.entries(byWeek))
      if (v.m / 60 > WEEKLY_ALERT_H)
        out.push({
          rule: "weekly_hours_alert",
          employee_id: emp,
          employee_name: NAMES[emp],
          dates: [...new Set(v.dates)],
          slot_ids: v.ids,
          message: `${NAMES[emp]}: ${v.m / 60} h in the week of ${dayLabel(w)} (alert above ${WEEKLY_ALERT_H}).`,
        });
  }
  return out;
}
const vKey = (v) => `${v.rule}|${v.employee_id}|${v.dates.join(",")}`;

function rangeDates(from, weeks) {
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(from, i));
}

function canSee() {
  return ctl.viewer !== "none";
}
const canEdit = () => ctl.viewer === "editor";

function rangeBody(from, weeks) {
  const dates = rangeDates(from, weeks);
  const last = dates[dates.length - 1];
  const inRange = (d) => d >= from && d <= last;
  const around = (d) => d >= addDays(from, -1) && d <= addDays(last, 1);
  const wkList = Array.from({ length: weeks }, (_, i) => addDays(from, 7 * i));
  return {
    from,
    weeks,
    can_edit: canEdit(),
    can_publish: canEdit() && !!ctl.canPublish,
    can_manage_leave_types: !!ctl.canManageLeaveTypes,
    weeks_info: wkList.map((w) => ({
      week_start: w,
      status: weekStatus(w),
      version: state.weeks[w]?.version ?? 0,
      published_with_gaps: false,
      pending_changes: false,
    })),
    employees: Object.values(EMP).map((id, i) => ({ id, name: NAMES[id], sort_order: i + 1, is_active: true })),
    slots: state.slots.filter((s) => inRange(s.date)),
    time_off: state.time_off.filter((t) => inRange(t.date)).map(timeOffOut),
    gaps: gapsFor(state.slots, state.time_off, dates),
    violations: violationsFor(state.slots.filter((s) => around(s.date)), state.time_off).filter((v) => v.dates.some(inRange)),
    leave_requests: state.leave_requests
      .filter((r) => r.status === "pending")
      // 只能批假的人（approver）：只回自己能批的那条（Nadia 的）。can_decide 给页面判断按钮。
      .filter((r) => ctl.viewer !== "approver" || r.employee_id === EMP.N)
      .map((r) => ({ ...r, kind_label: catLabel(r.kind), can_decide: ctl.viewer !== "hrview", shifts: shiftsOf(r) })),
    change_requests: canEdit() ? state.change_requests : [],
  };
}

function shiftsOf(r) {
  return state.slots
    .filter((s) => s.employee_id === r.employee_id && s.date >= r.date_from && s.date <= r.date_to)
    .map((s) => ({ slot_id: s.id, date: s.date, shift_type: s.shift_type, label: typeLabel(s.shift_type), start_time: `${s.start_time}:00`, end_time: `${s.end_time}:00` }));
}

// ---- HTTP ----
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
    req.on("end", () => {
      try {
        resolve(d ? JSON.parse(d) : null);
      } catch {
        resolve(undefined);
      }
    });
  });
}
// FastAPI 的 HTTPException(dict) 形状：{detail: {detail, code, …}}，同现有 sch-mock 的 coverage_gap。
const conflict = (res, detail, code, extra) => send(res, 409, { detail: { detail, code, ...extra } });

reset();

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const method = req.method;
    if (p === "/__ctl" && method === "POST") {
      const b = (await readBody(req)) || {};
      if (b.reset) reset();
      for (const k of ["viewer", "canPublish", "canManageLeaveTypes", "weekStatus", "fail", "today"]) if (k in b) ctl[k] = b[k];
      return send(res, 200, { ok: true, ctl });
    }
    if (p === "/__log") return send(res, 200, log);
    const body = method === "GET" ? null : await readBody(req);
    if (method !== "GET") log.push({ op: p.split("/").slice(3).join("/"), method, path: p, body });
    for (const [pat, status] of Object.entries(ctl.fail || {})) {
      const [m, re] = pat.split(" ");
      if (m === method && new RegExp(re).test(p)) return send(res, status, { detail: "ZZ Test: the server had a problem." });
    }
    if (body === undefined) return send(res, 422, { detail: [{ type: "json_invalid", loc: ["body"], msg: "JSON decode error" }] });

    // 2.1 总览
    if (p === "/api/schedule/range" && method === "GET") {
      if (!canSee()) return send(res, 403, { detail: "You don't have access to the schedule overview." });
      const from = url.searchParams.get("from") || "";
      const weeks = Number(url.searchParams.get("weeks") || 4);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || weekday(from) !== 0) return send(res, 400, { detail: 'from must be a Sunday ("YYYY-MM-DD").' });
      if (!Number.isInteger(weeks) || weeks < 1 || weeks > 8) return send(res, 400, { detail: "weeks must be a number from 1 to 8." });
      return send(res, 200, rangeBody(from, weeks));
    }

    // 2.2 跨周一次保存
    if (p === "/api/schedule/range/changes" && method === "POST") {
      if (!canEdit()) return send(res, 403, { detail: "You don't have permission to edit the schedule." });
      const weeks = (body && body.weeks) || [];
      const wkSet = new Set(weeks.map((w) => w.week_start));
      for (const w of weeks) {
        const cur = state.weeks[w.week_start];
        if (cur && w.base_version != null && w.base_version !== cur.version)
          return conflict(res, "Someone else changed this week. Reload to see the latest.", "stale", { week_start: w.week_start });
      }
      const work = state.slots.map((s) => ({ ...s }));
      const off = state.time_off.map((t) => ({ ...t }));
      const refs = {};
      const created = {};
      const ops = (body && body.ops) || [];
      const find = (ref) => work.find((s) => s.id === (typeof ref === "string" ? refs[ref] : ref));
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const date = op.date || (op.slot != null && find(op.slot)?.date) || (op.op === "time_off_delete" && off.find((t) => t.id === op.id)?.date);
        if (date && !wkSet.has(weekOf(date))) return send(res, 400, { detail: `Change ${i} is on a week that isn't in this save.` });
        if (op.op === "create") {
          if (!TYPES[op.shift_type]) return send(res, 400, { detail: "Unknown shift type." });
          const s = { id: nextId++, date: op.date, shift_type: op.shift_type, start_time: op.start_time, end_time: op.end_time, employee_id: op.employee_id ?? null, note: op.note ?? null, updated_by: 1, updated_at: new Date().toISOString() };
          work.push(s);
          if (op.ref) refs[op.ref] = created[op.ref] = s.id;
        } else if (op.op === "time_off_set") {
          if (!state.categories.some((c) => c.key === op.kind && c.is_active)) return send(res, 400, { detail: "Pick a leave type." });
          if ((op.start_time == null) !== (op.end_time == null)) return send(res, 400, { detail: "Give both a start and an end time, or neither for the whole day." });
          if (op.start_time != null && (!isHalfHour(op.start_time) || !isHalfHour(op.end_time))) return send(res, 400, { detail: 'Times must be on the half hour ("HH:MM").' });
          if (op.start_time != null && op.end_time <= op.start_time) return send(res, 400, { detail: "The end time must be after the start time." });
          const ex = off.find((t) => t.employee_id === op.employee_id && t.date === op.date);
          const row = { employee_id: op.employee_id, date: op.date, kind: op.kind, start_time: op.start_time ?? null, end_time: op.end_time ?? null, note: op.note ?? null };
          if (ex) Object.assign(ex, row);
          else off.push({ id: nextId++, ...row });
        } else if (op.op === "time_off_delete") {
          const k = off.findIndex((t) => t.id === op.id);
          if (k < 0) return send(res, 404, { detail: "Time off not found." });
          off.splice(k, 1);
        } else {
          const s = find(op.slot);
          if (!s) return send(res, 400, { detail: `Change ${i}: that shift no longer exists.` });
          if (op.op === "assign") s.employee_id = op.employee_id ?? null;
          else if (op.op === "time") Object.assign(s, { start_time: op.start_time, end_time: op.end_time });
          else if (op.op === "note") s.note = op.note ?? null;
          else if (op.op === "delete") work.splice(work.indexOf(s), 1);
          else return send(res, 400, { detail: `Change ${i}: unknown change.` });
        }
      }
      // 同一天既有班又有整天假 ⇒ 400（同 PUT /api/schedule/time-off 那句）
      for (const t of off.filter((x) => x.start_time == null)) {
        if (work.some((s) => s.employee_id === t.employee_id && s.date === t.date))
          return send(res, 400, { detail: `${NAMES[t.employee_id]} has a shift on ${t.date}. Move the shift before adding a whole day off.` });
      }
      const dates = [...wkSet].flatMap((w) => rangeDates(w, 1));
      const beforeGaps = gapsFor(state.slots, state.time_off, dates);
      const afterGaps = gapsFor(work, off, dates);
      const freshGaps = afterGaps.filter((g) => weekStatus(weekOf(g.date)) === "published" && !beforeGaps.some((b) => b.date === g.date && b.start_time <= g.start_time && g.end_time <= b.end_time));
      if (freshGaps.length) return conflict(res, "This change would leave a gap in coverage, so it wasn't saved.", "coverage_gap", { gaps: freshGaps });
      const beforeV = new Set(violationsFor(state.slots, state.time_off).map(vKey));
      const afterV = violationsFor(work, off);
      const freshV = afterV.filter((v) => !beforeV.has(vKey(v)));
      if (freshV.length) return conflict(res, "This change breaks a schedule rule, so it wasn't saved.", "rule_violation", { violations: freshV });
      state.slots = work;
      state.time_off = off;
      for (const w of wkSet) if (state.weeks[w]) state.weeks[w].version += 1;
      const wkList = [...wkSet].sort();
      return send(res, 200, {
        weeks_info: wkList.map((w) => ({ week_start: w, status: weekStatus(w), version: state.weeks[w]?.version ?? 0, published_with_gaps: false, pending_changes: weekStatus(w) === "published" })),
        created,
        applied: ops.length,
        gaps: afterGaps,
        violations: afterV,
      });
    }

    // 2.3 请假类别
    if (p === "/api/schedule/leave-categories") {
      if (method === "GET") {
        const active = url.searchParams.get("active") === "1";
        return send(res, 200, { categories: [...state.categories].filter((c) => !active || c.is_active).sort((a, b) => a.sort_order - b.sort_order) });
      }
      if (method === "POST") {
        if (!ctl.canManageLeaveTypes) return send(res, 403, { detail: "You don't have permission to change leave types." });
        const label = String((body && body.label) || "").trim();
        if (!label) return send(res, 400, { detail: "Name the leave type." });
        if (label.length > 30) return send(res, 400, { detail: "Leave type name must be at most 30 characters." });
        if (state.categories.some((c) => c.label.toLowerCase() === label.toLowerCase())) return send(res, 400, { detail: `There is already a leave type called "${label}".` });
        const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `type_${nextId++}`;
        const category = { key, label, sort_order: state.categories.length + 1, is_active: true };
        state.categories.push(category);
        return send(res, 201, { category });
      }
    }
    const cm = /^\/api\/schedule\/leave-categories\/([^/]+)$/.exec(p);
    if (cm && method === "PUT") {
      if (!ctl.canManageLeaveTypes) return send(res, 403, { detail: "You don't have permission to change leave types." });
      const c = state.categories.find((x) => x.key === decodeURIComponent(cm[1]));
      if (!c) return send(res, 404, { detail: "Leave type not found." });
      const b = body || {};
      if ("label" in b) {
        const label = String(b.label || "").trim();
        if (!label) return send(res, 400, { detail: "Name the leave type." });
        if (label.length > 30) return send(res, 400, { detail: "Leave type name must be at most 30 characters." });
        if (state.categories.some((x) => x !== c && x.label.toLowerCase() === label.toLowerCase())) return send(res, 400, { detail: `There is already a leave type called "${label}".` });
        c.label = label;
      }
      if ("is_active" in b) {
        if (typeof b.is_active !== "boolean") return send(res, 400, { detail: "is_active must be true or false." });
        c.is_active = b.is_active;
      }
      if ("sort_order" in b) {
        if (typeof b.sort_order !== "number") return send(res, 400, { detail: "sort_order must be a number." });
        c.sort_order = b.sort_order;
      }
      return send(res, 200, { category: c });
    }

    // 2.4 改一条已有的假
    const tm = /^\/api\/schedule\/time-off\/(\d+)$/.exec(p);
    if (tm && method === "PUT") {
      if (!canEdit()) return send(res, 403, { detail: "You don't have permission to edit the schedule." });
      const t = state.time_off.find((x) => x.id === Number(tm[1]));
      if (!t) return send(res, 404, { detail: "Time off not found." });
      const b = body || {};
      const next = { ...t, ...("kind" in b ? { kind: b.kind } : {}), ...("start_time" in b ? { start_time: b.start_time } : {}), ...("end_time" in b ? { end_time: b.end_time } : {}), ...("note" in b ? { note: b.note } : {}) };
      if (next.start_time == null && state.slots.some((s) => s.employee_id === t.employee_id && s.date === t.date))
        return send(res, 400, { detail: `${NAMES[t.employee_id]} has a shift on ${t.date}. Move the shift before adding a whole day off.` });
      Object.assign(t, next);
      return send(res, 200, { time_off: timeOffOut(t) });
    }

    // 请假批 / 拒（approve 的 body 可选：adjust / shifts / cover / note，这里只做最简单的：note 长度、批了生成 time_off）
    const lm = /^\/api\/schedule\/leave-requests\/(\d+)\/(approve|reject)$/.exec(p);
    if (lm && method === "POST") {
      const r = state.leave_requests.find((x) => x.id === Number(lm[1]));
      if (!r) return send(res, 404, { detail: "Leave request not found." });
      if (ctl.viewer === "approver" && r.employee_id !== EMP.N) return send(res, 403, { detail: "You can't decide this leave request." });
      if (r.status !== "pending") return conflict(res, "This request was already decided.", "already_decided", { request: r });
      const note = body && body.note;
      if (note && String(note).length > 120) return send(res, 400, { detail: "Note must be at most 120 characters." });
      r.status = lm[2] === "approve" ? "approved" : "rejected";
      r.decided_by = 1;
      r.decided_by_name = "ZZ Test Approver";
      r.decided_at = new Date().toISOString();
      r.decision_note = note || null;
      if (r.status === "approved") {
        for (let d = r.date_from; d <= r.date_to; d = addDays(d, 1)) {
          state.time_off = state.time_off.filter((t) => !(t.employee_id === r.employee_id && t.date === d));
          state.time_off.push({ id: nextId++, employee_id: r.employee_id, date: d, kind: r.kind, start_time: r.start_time, end_time: r.end_time, note: null });
        }
      }
      return send(res, 200, { request: { ...r, kind_label: catLabel(r.kind) } });
    }

    // 改班 / 换班请求批 / 拒（批改班要 schedule.edit）
    const am = /^\/api\/schedule\/confirmation-requests\/(\d+)\/(approve|decline)$/.exec(p);
    if (am && method === "POST") {
      if (!canEdit()) return send(res, 403, { detail: "You don't have permission to edit the schedule." });
      const k = state.change_requests.findIndex((x) => x.id === Number(am[1]));
      if (k < 0) return send(res, 404, { detail: "That request is no longer waiting." });
      const [r] = state.change_requests.splice(k, 1);
      if (am[2] === "approve" && r.request_kind === "swap") {
        const s = state.slots.find((x) => x.date === r.from_slot.date && x.shift_type === r.from_slot.shift_type && x.employee_id === EMP.J);
        if (s) s.employee_id = EMP.A;
      }
      return send(res, 200, { ok: true, id: r.id, decision: am[2] });
    }

    return send(res, 404, { detail: `ZZ Test mock: no route for ${method} ${p}` });
  })
  .listen(PORT, () => console.log("g382ov mock up"));
