// 自动排班引擎（lib/schedule-engine.ts，纯函数）的检查：node checks/schedule-engine-test.mjs
// 需要 Node 24（直接跑 .ts，不用 build）。规则全部来自传进去的清单；这里用 Annie 2026-10-17/18 说过的那套。
import assert from "node:assert/strict";
import {
  addDays,
  findViolations,
  generateWeek,
  exceptionsOn,
  generateWeeks,
  maxPeopleOn,
  overCapacity,
  overHours,
  restHours,
  shiftHours,
} from "../lib/schedule-engine.ts";

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

const V = 1, L = 2, N = 3, J = 4, A = 5;
const employees = [
  { id: V, name: "Veronica" },
  { id: L, name: "Lizzie" },
  { id: N, name: "Nadia" },
  { id: J, name: "Jing" },
  { id: A, name: "Anita" },
];
const r = (id, type, params, enabled = true) => ({ id, type, enabled, params });
const baseRules = () => [
  r("t1", "shift_times", { shift_type: "open", start: "02:00", end: "10:00" }),
  r("t2", "shift_times", { shift_type: "mid", start: "08:00", end: "17:00" }),
  r("t3", "shift_times", { shift_type: "close", start: "13:30", end: "21:30" }),
  r("f1", "fixed_shift", { employee_id: V, days: [1, 2, 3, 4, 5], shift_type: "open" }),
  r("w1", "weekend_rotation", {
    slots: [
      { day: 6, shift_type: "open" },
      { day: 6, shift_type: "close" },
      { day: 0, shift_type: "open" },
      { day: 0, shift_type: "close" },
    ],
    employee_ids: [L, N, J, A],
  }),
  r("d1", "days_per_week", { mode: "exactly", n: 5 }),
  r("g1", "min_rest", { hours: 12 }),
  r("c1", "coverage", { shift_type: "open", min: 1 }),
  r("c2", "coverage", { shift_type: "close", min: 1 }),
];
const FALLBACK = { start: "02:00", end: "21:30" };
const START = "2026-10-18"; // 周日

function run(rules, weeks = 4, extra = {}) {
  return generateWeeks({
    weekStart: START,
    weeks,
    employees,
    rules,
    previous: null,
    history: [],
    fallbackTimes: FALLBACK,
    seed: 7,
    ...extra,
  });
}

function allShifts(results) {
  return results.flatMap((x) => x.shifts);
}

check("restHours：Close 21:30 → 第二天 Open 02:00 只隔 4.5 小时；→ Mid 08:00 隔 10.5；→ Close 13:30 隔 16", () => {
  assert.equal(restHours("21:30", "02:00"), 4.5);
  assert.equal(restHours("21:30", "08:00"), 10.5);
  assert.equal(restHours("21:30", "13:30"), 16);
});

check("addDays 跨月", () => {
  assert.equal(addDays("2026-10-25", 7), "2026-11-01");
});

check("4 周：所有硬规则都满足（没有违规）", () => {
  const rules = baseRules();
  const res = run(rules);
  let prev = null;
  for (const wk of res) {
    assert.deepEqual(findViolations(rules, wk.plan, prev, employees), []);
    prev = wk.plan;
  }
  assert.deepEqual(res.flatMap((x) => x.problems), []);
});

check("Veronica 周一到周五固定 Open，周末不排，每周刚好 5 天", () => {
  const res = run(baseRules());
  for (const wk of res) {
    const days = wk.plan.byEmployee[V];
    for (let d = 1; d <= 5; d++) assert.equal(days[d]?.type, "open");
    assert.equal(days[0], null);
    assert.equal(days[6], null);
  }
});

check("每个人每周刚好 5 天", () => {
  for (const wk of run(baseRules())) {
    for (const e of employees) {
      assert.equal(wk.plan.byEmployee[e.id].filter(Boolean).length, 5, e.name);
    }
  }
});

check("周末轮值：4 周下来 4 个人 Sat Open / Sat Close / Sun Open / Sun Close 各一次", () => {
  const res = run(baseRules());
  const counts = {};
  for (const wk of res) {
    for (const e of [L, N, J, A]) {
      for (const d of [0, 6]) {
        const s = wk.plan.byEmployee[e][d];
        if (s) counts[`${e}|${d}|${s.type}`] = (counts[`${e}|${d}|${s.type}`] ?? 0) + 1;
      }
    }
  }
  for (const e of [L, N, J, A]) {
    for (const key of [`${e}|6|open`, `${e}|6|close`, `${e}|0|open`, `${e}|0|close`]) {
      assert.equal(counts[key], 1, key);
    }
  }
});

check("排出来的班用 shift_times 里的时间", () => {
  const res = run(baseRules());
  for (const s of allShifts(res)) {
    const want = { open: ["02:00", "10:00"], mid: ["08:00", "17:00"], close: ["13:30", "21:30"] }[s.type];
    assert.deepEqual([s.start, s.end], want, `${s.date} ${s.type}`);
  }
});

check("每天至少 1 个 Open 和 1 个 Close", () => {
  for (const wk of run(baseRules())) {
    for (let d = 0; d < 7; d++) {
      for (const type of ["open", "close"]) {
        assert.ok(employees.some((e) => wk.plan.byEmployee[e.id][d]?.type === type), `day ${d} ${type}`);
      }
    }
  }
});

check("Cannot work：Anita 周六不上、Jing 不上 Open，4 周都遵守，仍然排得出来", () => {
  const rules = [
    ...baseRules(),
    r("x1", "cannot_work", { employee_id: A, days: [6] }),
    r("x2", "cannot_work", { employee_id: J, shift_type: "open" }),
  ];
  const res = run(rules);
  let prev = null;
  for (const wk of res) {
    assert.deepEqual(findViolations(rules, wk.plan, prev, employees), []);
    assert.equal(wk.plan.byEmployee[A][6], null);
    assert.ok(!wk.plan.byEmployee[J].some((s) => s?.type === "open"));
    prev = wk.plan;
  }
  assert.deepEqual(res.flatMap((x) => x.problems), []);
});

check("规则没打开（enabled=false）就当没有：Cannot work 关掉后 Anita 周六可以上", () => {
  const rules = [...baseRules(), r("x1", "cannot_work", { employee_id: A, days: [6] }, false)];
  const res = run(rules);
  assert.ok(res.some((wk) => wk.plan.byEmployee[A][6]));
});

check("After a Close, no Open next day：开着时没有 Close 后第二天接 Open（含跨周）", () => {
  const rules = [
    ...baseRules().filter((x) => x.type !== "min_rest"),
    r("a1", "after_shift", { if_worked: "close", then_cannot: "open" }),
  ];
  const res = run(rules);
  let prev = null;
  for (const wk of res) {
    assert.deepEqual(findViolations(rules, wk.plan, prev, employees), []);
    prev = wk.plan;
  }
});

check("Minimum days on a shift：每周 Lizzie 至少 2 天 Close", () => {
  const rules = [...baseRules(), r("m1", "min_days_on_shift", { employee_id: L, shift_type: "close", n: 2, per: "week" })];
  const res = run(rules);
  for (const wk of res) {
    assert.ok(wk.plan.byEmployee[L].filter((s) => s?.type === "close").length >= 2);
  }
});

check("公平：4 周下来其他 4 个人的 Open / Mid / Close 数量相差不超过 2", () => {
  const res = run(baseRules());
  for (const type of ["open", "mid", "close"]) {
    const counts = [L, N, J, A].map((e) => res.reduce((n, wk) => n + wk.plan.byEmployee[e].filter((s) => s?.type === type).length, 0));
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 2, `${type}: ${counts}`);
  }
});

check("排不下的情况：人不够时不硬排，写出原因（只有 Veronica 一个人，每周 5 天，要求 Close 每天 1 人）", () => {
  const rules = [
    r("t3", "shift_times", { shift_type: "close", start: "13:30", end: "21:30" }),
    r("t1", "shift_times", { shift_type: "open", start: "02:00", end: "10:00" }),
    r("d1", "days_per_week", { mode: "exactly", n: 5 }),
    r("c2", "coverage", { shift_type: "close", min: 1 }),
  ];
  const res = generateWeek({
    weekStart: START,
    employees: [{ id: V, name: "Veronica" }],
    rules,
    previous: null,
    fallbackTimes: FALLBACK,
  });
  assert.ok(res.problems.length >= 2, JSON.stringify(res.problems));
  assert.ok(res.problems.every((p) => p.message.length > 10));
});

check("规则冲突：Cannot work 优先于 Coverage（Close 只有 Anita 能上、但她不能上 Close ⇒ 留空并说明）", () => {
  const rules = [
    r("t3", "shift_times", { shift_type: "close", start: "13:30", end: "21:30" }),
    r("d1", "days_per_week", { mode: "exactly", n: 5 }),
    r("c2", "coverage", { shift_type: "close", min: 1 }),
    r("x1", "cannot_work", { shift_type: "close" }),
  ];
  const res = generateWeek({
    weekStart: START,
    employees: [{ id: A, name: "Anita" }],
    rules,
    previous: null,
    fallbackTimes: FALLBACK,
  });
  assert.ok(!res.plan.byEmployee[A].some((s) => s?.type === "close"));
  assert.ok(res.problems.some((p) => p.message.includes("close")));
});

check("跨周：上一周周六上了 Close，这周周日不会被排 Open（12 小时间隔）", () => {
  const rules = baseRules();
  const prev = { weekStart: addDays(START, -7), byEmployee: {} };
  for (const e of employees) prev.byEmployee[e.id] = new Array(7).fill(null);
  prev.byEmployee[L][6] = { type: "close", start: "13:30", end: "21:30" };
  const res = generateWeek({ weekStart: START, employees, rules, previous: prev, history: [], fallbackTimes: FALLBACK, seed: 3 });
  const s = res.plan.byEmployee[L][0];
  assert.ok(!s || s.type !== "open");
  assert.deepEqual(findViolations(rules, res.plan, prev, employees), []);
});

check("exclude_from_rotation：被排除的人不进周末轮值", () => {
  const rules = [...baseRules(), r("e1", "exclude_from_rotation", { employee_id: A })];
  const res = run(rules);
  for (const wk of res) {
    assert.equal(wk.plan.byEmployee[A][0], null);
    assert.equal(wk.plan.byEmployee[A][6], null);
  }
});

check("shifts 输出：日期从周日开始、employeeId / 时间齐全", () => {
  const res = generateWeek({ weekStart: START, employees, rules: baseRules(), previous: null, fallbackTimes: FALLBACK, seed: 1 });
  for (const s of res.shifts) {
    assert.match(s.date, /^2026-10-(18|19|20|21|22|23|24)$/);
    assert.ok(s.employeeId && s.type && /^\d\d:\d\d$/.test(s.start) && /^\d\d:\d\d$/.test(s.end));
  }
  assert.equal(res.shifts.length, 25); // 5 人 × 5 天
});

check("locked：已经排好的班原样保留，其余的补满（Add to them）", () => {
  const rules = baseRules();
  const locked = { weekStart: START, byEmployee: {} };
  for (const e of employees) locked.byEmployee[e.id] = new Array(7).fill(null);
  locked.byEmployee[A][2] = { type: "mid", start: "09:00", end: "18:00" };
  locked.byEmployee[J][3] = { type: "close", start: "13:30", end: "21:30" };
  const res = generateWeek({ weekStart: START, employees, rules, previous: null, history: [], fallbackTimes: FALLBACK, seed: 5, locked });
  assert.deepEqual(res.plan.byEmployee[A][2], { type: "mid", start: "09:00", end: "18:00" });
  assert.equal(res.plan.byEmployee[J][3].type, "close");
  for (const e of employees) assert.equal(res.plan.byEmployee[e.id].filter(Boolean).length, 5, e.name);
});

check("同样的输入同样的 seed ⇒ 结果一样（可重复）", () => {
  const a = JSON.stringify(run(baseRules()).map((x) => x.shifts));
  const b = JSON.stringify(run(baseRules()).map((x) => x.shifts));
  assert.equal(a, b);
});

// ───────── 置顶 110（Annie 2026-11-09「110动手」，题 1–8 全 A）─────────

check("110 ①：每个班一天最多 1 人（不写班次 = 每种班）⇒ 4 周里没有哪天哪种班超过 1 人；排不下的写进预览", () => {
  const rules = [...baseRules(), r("m1", "max_per_shift_day", { max: 1 })];
  const res = run(rules);
  for (const w of res) {
    assert.deepEqual(overCapacity(rules, w.plan, employees), [], w.plan.weekStart);
    assert.deepEqual(findViolations(rules, w.plan, null, employees).filter((v) => v.includes("at most")), []);
  }
  // 5 人 × 5 天 = 25 班，三种班 × 7 天 = 21 个位置：一定有排不下的
  assert.ok(res.some((w) => w.problems.length > 0));
});

check("110 ①：只管某种班、某几天（Close 周六最多 1 人），别的照旧", () => {
  const rules = [...baseRules(), r("m1", "max_per_shift_day", { shift_type: "close", max: 1, days: [6] })];
  for (const w of run(rules)) {
    const sat = employees.filter((e) => w.plan.byEmployee[e.id][6]?.type === "close").length;
    assert.ok(sat <= 1, `${w.plan.weekStart} Sat close ${sat}`);
  }
});

check("110 题 1 A：固定周一到周五 + 每周最多 5 天 ⇒ 周末轮值跳过他、给下一位；没人接就空着、写进预览", () => {
  const rules = [
    r("t3", "shift_times", { shift_type: "close", start: "13:30", end: "21:30" }),
    r("f1", "fixed_shift", { employee_id: V, days: [1, 2, 3, 4, 5], shift_type: "close" }),
    r("w1", "weekend_rotation", { slots: [{ day: 6, shift_type: "close" }], employee_ids: [V, L] }),
    r("d1", "days_per_week", { mode: "max", n: 5 }),
  ];
  const res = run(rules, 4);
  for (const w of res) {
    assert.ok(w.plan.byEmployee[V].filter(Boolean).length <= 5, "Veronica <= 5 days");
    assert.equal(w.plan.byEmployee[L][6]?.type, "close", "Lizzie takes Sat close");
  }
  // 轮值里只有 Veronica ⇒ 没人接，空着、黄框写一条
  const solo = rules.map((x) => (x.id === "w1" ? r("w1", "weekend_rotation", { slots: [{ day: 6, shift_type: "close" }], employee_ids: [V] }) : x));
  const one = run(solo, 1)[0];
  assert.equal(one.plan.byEmployee[V][6], null);
  assert.ok(one.problems.some((p) => p.message.startsWith("Weekend rotation: nobody can take close")), JSON.stringify(one.problems));
});

check("110 题 2 A：两个人都固定周一 Close、最多 1 人 ⇒ 照排两个，预览写 Mon close has 2, at most 1，不再加人", () => {
  const rules = [
    r("t3", "shift_times", { shift_type: "close", start: "13:30", end: "21:30" }),
    r("f1", "fixed_shift", { employee_id: V, days: [1], shift_type: "close" }),
    r("f2", "fixed_shift", { employee_id: L, days: [1], shift_type: "close" }),
    r("d1", "days_per_week", { mode: "exactly", n: 3, employee_ids: [N] }),
    r("m1", "max_per_shift_day", { shift_type: "close", max: 1 }),
  ];
  const w = run(rules, 1)[0];
  assert.equal(w.plan.byEmployee[V][1]?.type, "close");
  assert.equal(w.plan.byEmployee[L][1]?.type, "close");
  assert.equal(w.plan.byEmployee[N][1], null, "nobody added on Mon close");
  assert.ok(w.problems.some((p) => p.message === "Mon close has 2, at most 1 (fixed or kept shifts)."), JSON.stringify(w.problems));
});

check("110 题 1：固定班本身超过每周天数 ⇒ 固定班不动，预览写一条", () => {
  const rules = [
    r("f1", "fixed_shift", { employee_id: V, days: [0, 1, 2, 3, 4, 5], shift_type: "open" }),
    r("d1", "days_per_week", { mode: "max", n: 5, employee_ids: [V] }),
  ];
  const w = run(rules, 1)[0];
  assert.equal(w.plan.byEmployee[V].filter(Boolean).length, 6);
  assert.ok(w.problems.some((p) => p.message === "Veronica: fixed or kept shifts come to 6 days, Days per week says at most 5."), JSON.stringify(w.problems));
});

check("110 ②：某种班至少几天——Everyone except Anita ⇒ 不报 Anita；Only these people ⇒ 只报名单里的", () => {
  const ex = [...baseRules(), r("k1", "min_days_on_shift", { shift_type: "mid", n: 3, per: "week", exclude_employee_ids: [A] })];
  const w1 = run(ex, 1)[0];
  assert.ok(!w1.problems.some((p) => p.message.startsWith("Anita:") && p.message.includes("mid")), JSON.stringify(w1.problems));
  const only = [...baseRules(), r("k1", "min_days_on_shift", { shift_type: "mid", n: 3, per: "week", employee_ids: [L, N] })];
  const w2 = run(only, 1)[0];
  const who = w2.problems.filter((p) => p.message.includes("mid day")).map((p) => p.message.split(":")[0]);
  assert.ok(who.every((n) => n === "Lizzie" || n === "Nadia"), JSON.stringify(who));
});

check("110 ④ 题 5：小时数上班到下班整段算、跨午夜 +24；超过提醒小时数的人列出来；规则关着不提醒", () => {
  assert.equal(shiftHours("08:30", "17:00"), 8.5);
  assert.equal(shiftHours("22:00", "06:00"), 8);
  const mid = { type: "mid", start: "08:30", end: "17:00" };
  const plan = { weekStart: START, byEmployee: { [V]: [null, mid, mid, mid, mid, mid, null], [L]: [null, { type: "mid", start: "08:00", end: "16:00" }, null, null, null, null, null] } };
  const rules = [r("h1", "weekly_hours_alert", { hours: 40 })];
  assert.deepEqual(overHours(rules, plan, employees), [{ employeeId: V, name: "Veronica", hours: 42.5 }]);
  assert.deepEqual(overHours([{ ...rules[0], enabled: false }], plan, employees), []);
});

// ───────── 置顶 110 续：Max people 的例外（Annie「1 A 2 B 3 A 4C 5A 6A 7 A。动手」）─────────

const closeOn = (ids, dayIdx) => {
  const by = {};
  for (const e of employees) by[e.id] = Array(7).fill(null);
  for (const id of ids) by[id][dayIdx] = { type: "close", start: "13:30", end: "21:30" };
  return { weekStart: START, byEmployee: by };
};

check("110 续 题 3 A：Every shift 最多 1 + 例外 Close 10/20 最多 2 ⇒ 那天 Close 2 人不算超；别的日子照旧超", () => {
  const rules = [r("m1", "max_per_shift_day", { max: 1, exceptions: [{ from: "2026-10-20", max: 2, shift_type: "close" }] })];
  assert.deepEqual(overCapacity(rules, closeOn([V, L], 2), employees), []);
  assert.deepEqual(overCapacity(rules, closeOn([V, L], 3), employees), [{ day: 3, type: "close", count: 2, max: 1 }]);
  assert.equal(maxPeopleOn(rules, "2026-10-20", "close"), 2);
  assert.equal(maxPeopleOn(rules, "2026-10-20", "open"), 1, "exception only for Close");
});

check("110 续 题 3 A：例外也可以收紧（规则最多 2，例外那天最多 1）；日期段 from–to 都算", () => {
  const rules = [r("m1", "max_per_shift_day", { max: 2, exceptions: [{ from: "2026-10-19", to: "2026-10-21", max: 1 }] })];
  assert.equal(maxPeopleOn(rules, "2026-10-19", "close"), 1);
  assert.equal(maxPeopleOn(rules, "2026-10-21", "mid"), 1);
  assert.equal(maxPeopleOn(rules, "2026-10-22", "close"), 2);
  assert.deepEqual(overCapacity(rules, closeOn([V, L], 2), employees), [{ day: 2, type: "close", count: 2, max: 1 }]);
});

check("110 续 题 2 B：两条 Max people 照旧取小的（Every shift 1 + Close 周六 2 ⇒ 周六 Close 还是 1）", () => {
  const rules = [r("m1", "max_per_shift_day", { max: 1 }), r("m2", "max_per_shift_day", { shift_type: "close", max: 2, days: [6] })];
  assert.equal(maxPeopleOn(rules, "2026-10-24", "close"), 1);
});

check("110 续 题 6 A：Auto-fill 只是允许——例外那天不超过 2，别的日子不超过 1", () => {
  const rules = [...baseRules(), r("m1", "max_per_shift_day", { max: 1, exceptions: [{ from: "2026-10-20", max: 2, shift_type: "close" }] })];
  const w = run(rules, 1)[0];
  assert.deepEqual(overCapacity(rules, w.plan, employees), []);
  const tue = employees.filter((e) => w.plan.byEmployee[e.id][2]?.type === "close").length;
  assert.ok(tue <= 2, `Tue close ${tue}`);
});

check("110 续 题 7：exceptionsOn 给出那天生效的例外（班次 null = 每种班）；规则关着就没有", () => {
  const rules = [r("m1", "max_per_shift_day", { max: 1, exceptions: [{ from: "2026-10-20", max: 2, shift_type: "close" }, { from: "2026-12-20", to: "2027-01-05", max: 2 }] })];
  assert.deepEqual(exceptionsOn(rules, "2026-10-20"), [{ shift_type: "close", max: 2 }]);
  assert.deepEqual(exceptionsOn(rules, "2027-01-01"), [{ shift_type: null, max: 2 }]);
  assert.deepEqual(exceptionsOn(rules, "2026-10-21"), []);
  assert.deepEqual(exceptionsOn([{ ...rules[0], enabled: false }], "2026-10-20"), []);
});

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
