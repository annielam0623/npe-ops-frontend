// 模拟后端：G382 HR 排班总览（Settings › HR › Schedule）。照后端契约
// npe-confirmation-service origin/task/g382-hr-schedule 的 docs/g382-hr-schedule/interface.md 和后端代码 @ d9a78076（2026-11-25，7d）。
// ⚠️ 后端 d9a78076 还没做（mock 先照契约做着，等后端有了再对）：gap 的 reason、GET weeks/{w} 的 violations、PUT /api/schedule/time-off/{id}。
// 违规行照后端 schedule_rule_check._v 多 rule_id / blocking；只有 blocking 的「新」违规让 range/changes 回 409 rule_violation。
//   后端 _v 没有 employee_name（契约有）——mock 照契约留着，页面别依赖它，用 employee_id 对 employees。
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
// 后端 86（11-26）：version = schedule_weeks.updated_at 的 ISO 文本（schedule.py:926 _version()）；还没建的周 null。
let verN = 0;
const bumpVer = () => new Date(Date.UTC(2026, 10, 26, 12, 0, ++verN)).toISOString().replace(".000Z", "+00:00");
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
      "2026-11-15": { status: "published", version: "2026-11-20T12:00:07+00:00" },
      "2026-11-22": { status: "published", version: "2026-11-21T12:00:04+00:00" },
      "2026-11-29": { status: "draft", version: "2026-11-22T12:00:02+00:00" },
      "2026-12-06": { status: "draft", version: "2026-11-23T12:00:01+00:00" },
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
    // 改班 / 换班请求（平铺存，GET range 时按周包成 confirmations 的形状，见 changeRequestsOut）。
    // 行的形状照 sch-mock 的 GET weeks/{w}/confirmations requests[]（G138）。
    change_requests: [
      {
        week_start: "2026-11-29",
        id: 81,
        kind: "swap",
        status: "pending",
        from: { employee_id: EMP.J, name: NAMES[EMP.J] },
        my_slot: { date: "2026-12-04", shift_type: "close" },
        their_slot: null,
        peer: { employee_id: EMP.A, name: NAMES[EMP.A] },
        date: "2026-12-04",
        shift_type: "close",
        peer_timed_out: false,
        created_at: "2026-11-24T18:00:00+00:00",
        decided_at: null,
      },
    ],
  };
}

// 契约 d9a78076：change_requests = 每周一项 {week_start, …同 GET /api/schedule/weeks/{w}/confirmations}；还没建的周不出。
function changeRequestsOut(wkList) {
  return wkList
    .filter((w) => state.weeks[w])
    .map((w) => ({
      week_start: w,
      sent_at: weekStatus(w) === "published" ? "2026-11-20T16:00:00+00:00" : null,
      deadline: null,
      past_deadline: false,
      empty_draft: false,
      people: [],
      requests: state.change_requests.filter((r) => r.week_start === w).map(({ week_start, ...r }) => r),
    }));
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
// 还没建的周 status = null（interface.md §2.1，后端 86 bf80cd51）。
const weekStatus = (w) => ctl.weekStatus[w] || state.weeks[w]?.status || null;

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
          rule_id: 1,
          blocking: true,
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
          rule_id: 2,
          blocking: false,
          week: w,
          employee_id: emp,
          employee_name: NAMES[emp],
          dates: [...new Set(v.dates)],
          slot_ids: v.ids,
          message: `${NAMES[emp]}: ${v.m / 60} h in the week of ${dayLabel(w)} (alert above ${WEEKLY_ALERT_H}).`,
        });
  }
  return out;
}
// 后端 c336d008 CR-5（schedule_rule_check._key / new_blocking）：按周的规则（带 week）身份 = (rule, rule_id, employee_id, week)，
// 同人同周本来就超了，只有 dates 数变多才算新；其余规则身份带 dates。
const vKey = (v) => (v.week ? `${v.rule}|${v.rule_id}|${v.employee_id}|w${v.week}` : `${v.rule}|${v.employee_id}|${v.dates.join(",")}`);
function newBlocking(before, after) {
  const old = new Map(before.map((v) => [vKey(v), v]));
  return after.filter((v) => v.blocking && (!old.has(vKey(v)) || (v.week && v.dates.length > old.get(vKey(v)).dates.length)));
}

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
      version: state.weeks[w]?.version ?? null,
      published_with_gaps: false,
    })),
    employees: Object.values(EMP).map((id, i) => ({ id, name: NAMES[id], is_active: true })),
    slots: state.slots.filter((s) => inRange(s.date)),
    time_off: state.time_off.filter((t) => inRange(t.date)).map(timeOffOut),
    gaps: gapsFor(state.slots, state.time_off, dates),
    violations: violationsFor(state.slots.filter((s) => around(s.date)), state.time_off).filter((v) => v.dates.some(inRange)),
    leave_requests: state.leave_requests
      .filter((r) => r.status === "pending")
      // 只能批假的人（approver）：只回自己能批的那条（Nadia 的）。can_decide 给页面判断按钮。
      .filter((r) => ctl.viewer !== "approver" || r.employee_id === EMP.N)
      .map((r) => ({ ...r, kind_label: catLabel(r.kind), can_decide: ctl.viewer !== "hrview", shifts: shiftsOf(r), would_gap: r.start_time ? wouldGap(r, r.date_from, r.start_time, r.end_time) : null })),
    change_requests: canEdit() ? changeRequestsOut(wkList) : [],
  };
}

// would_gap（后端 86 _new_gaps）：这条假批了以后多出来的空档 = 批后的空档里、批前没有的那几段。不写库；没建的周 ⇒ []；整天 ⇒ []。
function wouldGap(r, date, st, en) {
  if (!st || !en) return [];
  if (!state.weeks[weekOf(date)]) return [];
  const before = gapsFor(state.slots, state.time_off, [date]);
  const off = state.time_off
    .filter((t) => !(t.employee_id === r.employee_id && t.date === date))
    .concat([{ id: -1, employee_id: r.employee_id, date, kind: r.kind, start_time: st, end_time: en, note: null }]);
  return gapsFor(state.slots, off, [date]).filter((g) => !before.some((b) => b.start_time <= g.start_time && b.end_time >= g.end_time));
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
      for (const k of ["viewer", "canPublish", "canManageLeaveTypes", "weekStatus", "fail", "today", "selfEmp"]) if (k in b) ctl[k] = b[k];
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
      if (!body || typeof body !== "object" || Array.isArray(body)) return send(res, 400, { detail: "The body must be a JSON object." });
      const weeks = body.weeks;
      const ops = body.ops;
      if (!Array.isArray(weeks) || !weeks.length || weeks.length > 8) return send(res, 400, { detail: "weeks must list 1 to 8 weeks." });
      if (!Array.isArray(ops) || !ops.length) return send(res, 400, { detail: "ops must be a non-empty list." });
      const wkSet = new Set(weeks.map((w) => w.week_start));
      const work = state.slots.map((s) => ({ ...s }));
      const off = state.time_off.map((t) => ({ ...t }));
      const refs = {};
      const createdByWeek = {};
      const appliedByWeek = {};
      const offRows = [];
      const find = (ref) => work.find((s) => s.id === (typeof ref === "string" ? refs[ref] : ref));
      // 后端 d9a78076 的顺序（apply_range_changes）：先所有 time_off_delete，再班的 op（按周、周内照原顺序），最后所有 time_off_set；
      // 全部做完再整体查一次空档和规则。「Change i」的 i 是原来 ops 里的位置。
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (op.op === "time_off_delete") continue;
        if (op.op === "time_off_set" || op.op === "create") {
          if (op.date && !wkSet.has(weekOf(op.date))) return send(res, 400, { detail: `Change ${i} is on a week that isn't in this save.` });
        } else if (typeof op.slot === "number") {
          const s0 = state.slots.find((s) => s.id === op.slot);
          if (s0 && !wkSet.has(weekOf(s0.date))) return send(res, 400, { detail: `Change ${i} is on a week that isn't in this save.` });
        }
      }
      // 版本 / 锁在「周对不对」之后查（后端：先整理 ops 分到各周，apply_week_changes 里才查 stale）。
      // 后端 86（11-26）：只有带「班的 op」的周才查锁和版本；base_version 要非空字符串（服务层 schedule.py:1553，否则 400，原话未核）。
      const slotWeeks = new Set();
      for (const op of ops) {
        if (op.op === "time_off_set" || op.op === "time_off_delete") continue;
        if (op.op === "create") slotWeeks.add(weekOf(op.date));
        else { const s0 = state.slots.find((x) => x.id === op.slot); if (s0) slotWeeks.add(weekOf(s0.date)); }
      }
      for (const w of weeks) {
        if (!slotWeeks.has(w.week_start)) continue;
        if (typeof w.base_version !== "string" || !w.base_version) return send(res, 400, { detail: "base_version must be a non-empty string." });
        const cur = state.weeks[w.week_start];
        // 后端：没建过的周带班的 op → 404（range/changes 不建周，要先 GET weeks/{w}）。
        if (!cur) return send(res, 404, { detail: "This week doesn't exist yet. Reload the page." });
        if (w.base_version !== cur.version)
          return conflict(res, "Someone else changed this week. Reload to see the latest.", "stale", { week_start: w.week_start, version: cur.version });
      }
      const idx = ops.map((op, i) => [i, op]);
      const ordered = [
        ...idx.filter(([, op]) => op.op === "time_off_delete"),
        ...idx
          .filter(([, op]) => op.op !== "time_off_delete" && op.op !== "time_off_set")
          .map(([i, op]) => [i, op, weekOf(op.date || state.slots.find((s) => s.id === op.slot)?.date || find(op.slot)?.date || "")])
          .sort((a, b) => a[2].localeCompare(b[2]) || a[0] - b[0])
          .map(([i, op]) => [i, op]),
        ...idx.filter(([, op]) => op.op === "time_off_set"),
      ];
      for (const [i, op] of ordered) {
        if (op.op === "time_off_delete") {
          if (typeof op.id !== "number") return send(res, 400, { detail: `Change ${i}: id must be a number.` });
          const k = off.findIndex((t) => t.id === op.id);
          if (k < 0) return send(res, 404, { detail: "Time off not found." });
          off.splice(k, 1);
          continue;
        }
        if (op.op === "time_off_set") {
          const bad = (m) => send(res, 400, { detail: `Change ${i}: ${m}` });
          if (!state.categories.some((c) => c.key === op.kind && c.is_active)) return bad("Pick a leave type.");
          if ((op.start_time == null) !== (op.end_time == null)) return bad("Give both a start and an end time, or neither for the whole day.");
          if (op.start_time != null && (!isHalfHour(op.start_time) || !isHalfHour(op.end_time))) return bad('Times must be on the half hour ("HH:MM").');
          if (op.start_time != null && op.end_time <= op.start_time) return bad("The end time must be after the start time.");
          const ex = off.find((t) => t.employee_id === op.employee_id && t.date === op.date);
          const row = { employee_id: op.employee_id, date: op.date, kind: op.kind, start_time: op.start_time ?? null, end_time: op.end_time ?? null, note: op.note ?? null };
          if (ex) Object.assign(ex, row);
          else off.push({ id: nextId++, ...row });
          offRows.push(ex || off[off.length - 1]);
          continue;
        }
        const wk = weekOf(op.date || find(op.slot)?.date || "");
        appliedByWeek[wk] = (appliedByWeek[wk] || 0) + 1;
        if (op.op === "create") {
          if (!TYPES[op.shift_type]) return send(res, 400, { detail: "Unknown shift type." });
          const s = { id: nextId++, date: op.date, shift_type: op.shift_type, start_time: op.start_time, end_time: op.end_time, employee_id: op.employee_id ?? null, note: op.note ?? null, updated_by: 1, updated_at: new Date().toISOString() };
          work.push(s);
          if (op.ref) refs[op.ref] = (createdByWeek[wk] = createdByWeek[wk] || {})[op.ref] = s.id;
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
      // 只拦「这次新造成的、blocking 的」（后端 schedule_rule_check.new_blocking）；weekly_hours_alert 等只列不拦。
      const afterV = violationsFor(work, off);
      const freshV = newBlocking(violationsFor(state.slots, state.time_off), afterV);
      if (freshV.length) return conflict(res, "This change breaks a schedule rule, so it wasn't saved.", "rule_violation", { violations: freshV });
      state.slots = work;
      state.time_off = off;
      // 回包（后端 d9a78076）：{weeks: {week_start: 同整周 Save 的回包}, time_off: [这次 set 的假], violations}。
      // weeks 只有这次有班的 op 的周；整周 Save 的回包同 sch-mock：{week, created, applied, notified, lock_token}。
      const weeksOut = {};
      for (const w of Object.keys(appliedByWeek).sort()) {
        if (state.weeks[w]) state.weeks[w].version = bumpVer();
        const lock = weeks.find((x) => x.week_start === w)?.lock_token ?? null;
        weeksOut[w] = {
          week: { week_start: w, status: weekStatus(w), version: state.weeks[w]?.version ?? null, slots: state.slots.filter((s) => weekOf(s.date) === w) },
          created: createdByWeek[w] || {},
          applied: appliedByWeek[w],
          notified: [],
          lock_token: lock,
        };
      }
      return send(res, 200, { weeks: weeksOut, time_off: offRows.map(timeOffOut), violations: afterV });
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

    // GET leave-requests/{id}/would-gap?date=&start_time=&end_time=（后端 86）：权限同 approve；不能批 ⇒ 404、自己的 ⇒ 403；
    // 校验同 approve 的 adjust（一天、半点）；整天（两个时间都空）⇒ []；已处理 ⇒ 409 already_decided。
    const wgm = /^\/api\/schedule\/leave-requests\/(\d+)\/would-gap$/.exec(p);
    if (wgm && method === "GET") {
      if (ctl.viewer === "none") return send(res, 403, { detail: "You don't have permission: Schedule: View." });
      const r = state.leave_requests.find((x) => x.id === Number(wgm[1]));
      if (!r || (ctl.viewer === "approver" && r.employee_id !== EMP.N)) return send(res, 404, { detail: "Leave request not found." });
      if (ctl.selfEmp != null && r.employee_id === ctl.selfEmp) return send(res, 403, { detail: "You can't decide your own leave request." });
      if (r.status !== "pending") return conflict(res, "This request was already decided.", "already_decided", { request: r });
      const date = url.searchParams.get("date");
      const st = url.searchParams.get("start_time") || null;
      const en = url.searchParams.get("end_time") || null;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { detail: 'date must be "YYYY-MM-DD".' });
      if (!st && !en) return send(res, 200, { would_gap: [] });
      if (!st || !en) return send(res, 400, { detail: "Give both a start and an end time, or neither for a whole day." });
      if (!isHalfHour(st) || !isHalfHour(en)) return send(res, 400, { detail: 'Times must be on the half hour ("HH:MM").' });
      if (en <= st) return send(res, 400, { detail: "The end time must be after the start time." });
      return send(res, 200, { would_gap: wouldGap(r, date, st, en) });
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
      // approve 的 shifts / cover（后端 c336d008，e2 核）：slot 不在这条假上 / 给不在职的人 ⇒ 400；按天、那天有班没处理 ⇒ 400；
      // 已发布周按小时、没给 cover ⇒ 400。规则 / 空档这里不再查（总览 Save 那条路查）。
      const work = state.slots.map((x) => ({ ...x }));
      if (lm[2] === "approve") {
        const mine = work.filter((x) => x.employee_id === r.employee_id && x.date >= r.date_from && x.date <= r.date_to);
        const hourly = r.start_time != null;
        for (const sh of (body && body.shifts) || []) {
          const slot = mine.find((x) => x.id === sh.slot_id);
          if (!slot) return send(res, 400, { detail: "One of the shifts isn't on this leave. Reload and try again." });
          if (sh.action === "give") {
            if (!NAMES[sh.employee_id]) return send(res, 400, { detail: "Pick an active person to give the shift to." });
            slot.employee_id = sh.employee_id;
          } else if (sh.action === "delete") work.splice(work.indexOf(slot), 1);
          else return send(res, 400, { detail: 'action must be "give" or "delete".' });
        }
        if (!hourly) {
          const left = work.find((x) => x.employee_id === r.employee_id && x.date >= r.date_from && x.date <= r.date_to);
          if (left) return send(res, 400, { detail: `${NAMES[r.employee_id]} has a shift on ${left.date}. Choose what happens to it before approving.` });
        } else if (weekStatus(weekOf(r.date_from)) === "published") {
          const c = body && body.cover;
          if (!c || !NAMES[c.employee_id]) return send(res, 400, { detail: `Pick who covers ${r.start_time} – ${r.end_time} on ${dayLabel(r.date_from)}.` });
          const base = mine[0];
          work.push({ id: nextId++, date: r.date_from, shift_type: base ? base.shift_type : "mid", start_time: r.start_time, end_time: r.end_time, employee_id: c.employee_id, note: `Cover for ${NAMES[r.employee_id]}`, updated_by: 1, updated_at: new Date().toISOString() });
        }
        state.slots = work;
      }
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
      if (am[2] === "approve" && r.kind === "swap") {
        const s = state.slots.find((x) => x.date === r.my_slot.date && x.shift_type === r.my_slot.shift_type && x.employee_id === r.from.employee_id);
        if (s) s.employee_id = r.peer.employee_id;
      }
      return send(res, 200, { ok: true, id: r.id, decision: am[2] });
    }

    // ── 页面外壳和总览挂的老功能（ab 11-26 补）：me / 勾、HR 名单、设置、编辑占用、Publish、Send to confirm、Rules ──
    // viewer：editor = supervisor（schedule.edit / publish、settings.hr.view、settings.schedule 照 ctl）；
    //         approver = Team lead（只有 schedule.view，没有 settings.hr.view）；hrview = 只有 settings.hr.view；none = 都没有。
    if (p === "/api/me" && method === "GET") {
      const ed = ctl.viewer === "editor";
      return send(res, 200, { id: 1, username: "zztest", display_name: ctl.viewer === "approver" ? "ZZ Test Mia" : "ZZ Test", initials: "ZT", role: ed ? "supervisor" : "staff", is_admin: false, is_superadmin: false, is_supervisor: ed });
    }
    if (p === "/api/me/permissions" && method === "GET") {
      const codes = {
        editor: ["schedule.view", "schedule.edit", ...(ctl.canPublish ? ["schedule.publish"] : []), "settings.hr.view", ...(ctl.canManageLeaveTypes ? ["settings.schedule"] : [])],
        approver: ["schedule.view"],
        hrview: ["schedule.view", "settings.hr.view"],
        none: [],
      }[ctl.viewer] || [];
      return send(res, 200, { is_superadmin: false, permissions: codes.map((code) => ({ code, module: code.split(".")[0], wired: true })), default_home: "/dashboard" });
    }
    if (p === "/api/hr/profiles" && method === "GET") {
      if (!(ctl.viewer === "editor" || ctl.viewer === "hrview")) return send(res, 403, { detail: "You don't have permission: Settings: View HR profiles." });
      return send(res, 200, { profiles: [] });
    }
    if (p === "/api/settings/schedule" && method === "GET") {
      return send(res, 200, {
        work_window: { start_time: WINDOW.start, end_time: WINDOW.end },
        shift_types: Object.entries(TYPES).map(([key, t], i) => ({ key, label: t.label, sort_order: i + 1, is_active: true, default_start_time: t.start, default_end_time: t.end, color: key })),
      });
    }
    if (p === "/api/schedule/employees" && method === "GET") {
      return send(res, 200, { employees: Object.values(EMP).map((id, i) => ({ id, name: NAMES[id], email: `zztest${id}@example.com`, is_active: true, sort_order: i + 1 })) });
    }
    if (p === "/api/schedule/rules" && method === "GET") return send(res, 200, { version: 1, rules: [] });
    // 编辑占用（同 sch-mock 形状）：ctl.lockMode ""/"ok" = 占得到（token 按周），"busy" = 别人在改，"missing" = 接口没上线(404)。
    const lockM = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/edit-lock(\/heartbeat|\/release)?$/.exec(p);
    if (lockM && method === "POST") {
      if (ctl.lockMode === "missing") return send(res, 404, { detail: "Not Found" });
      if (!lockM[2]) {
        if (ctl.lockMode === "busy") return send(res, 409, { detail: "ZZ Test Sam is editing this schedule (since 3:05 PM). Please try again later." });
        return send(res, 200, { token: `lock-${lockM[1]}`, heartbeat_every_s: 60 });
      }
      if (lockM[2] === "/heartbeat") return send(res, 200, { ok: true });
      return send(res, 200, { released: true });
    }
    // GET weeks/{w}（后端 schedule.py:641-685 _get_or_create_week / get_week 880）：有 schedule.edit 的人第一次打开没建的周 →
    // 建成草稿，照上一周复制班（类型、时间、备注，不带人），记 copied_from；上一周没班就是空草稿。
    // 没 schedule.edit：不建，没发布 / 没建的周 403「This week hasn't been published yet.」。建周记进 /__log（op "build"）。
    const wm = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})$/.exec(p);
    if (wm && method === "GET") {
      const w = wm[1];
      if (!state.weeks[w]) {
        if (!canEdit()) return send(res, 403, { detail: "This week hasn't been published yet." });
        const prev = addDays(w, -7);
        for (const s0 of state.slots.filter((x) => weekOf(x.date) === prev))
          state.slots.push({ ...s0, id: nextId++, date: addDays(s0.date, 7), employee_id: null, updated_at: new Date().toISOString() });
        state.weeks[w] = { status: "draft", version: bumpVer(), copied_from: prev };
        log.push({ op: "build", method, path: p, body: null });
      } else if (!canEdit() && weekStatus(w) !== "published") return send(res, 403, { detail: "This week hasn't been published yet." });
      return send(res, 200, {
        week_start: w,
        status: weekStatus(w),
        version: state.weeks[w].version,
        copied_from: state.weeks[w].copied_from ?? null,
        published_with_gaps: false,
        slots: state.slots.filter((x) => weekOf(x.date) === w),
        time_off: state.time_off.filter((t) => weekOf(t.date) === w).map(timeOffOut),
        gaps: gapsFor(state.slots, state.time_off, rangeDates(w, 1)),
        violations: [],
      });
    }
    const pm = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/publish$/.exec(p);
    if (pm && method === "POST") {
      if (!(canEdit() && ctl.canPublish)) return send(res, 403, { detail: "You don't have permission to publish the schedule." });
      const w = pm[1];
      const gaps = gapsFor(state.slots, state.time_off, rangeDates(w, 1));
      if (gaps.length && !(body && body.allow_gaps === true)) return send(res, 400, { detail: { detail: "Can't publish — there's a gap in coverage.", gaps } });
      const republished = weekStatus(w) === "published";
      state.weeks[w] = { ...(state.weeks[w] || { version: null }), status: "published" };
      delete ctl.weekStatus[w];
      state.weeks[w].version = bumpVer();
      return send(res, 200, { week: { week_start: w, status: "published", version: state.weeks[w].version }, republished, notified: [], not_notified: [] });
    }
    const sm = /^\/api\/schedule\/weeks\/(\d{4}-\d{2}-\d{2})\/employees\/(\d+)\/send-changes$/.exec(p);
    if (sm && method === "POST") {
      if (!canEdit()) return send(res, 403, { detail: "Only a supervisor or above can send schedule changes." });
      return send(res, 200, { sent_at: new Date().toISOString(), sent_by: "ZZ Test", channels: ["email", "in_app"] });
    }

    return send(res, 404, { detail: `ZZ Test mock: no route for ${method} ${p}` });
  })
  .listen(PORT, () => console.log("g382ov mock up"));
