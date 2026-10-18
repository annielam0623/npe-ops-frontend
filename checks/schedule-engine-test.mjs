// 自动排班引擎（lib/schedule-engine.ts，纯函数）的检查：node checks/schedule-engine-test.mjs
// 需要 Node 24（直接跑 .ts，不用 build）。规则全部来自传进去的清单；这里用 Annie 2026-10-17/18 说过的那套。
import assert from "node:assert/strict";
import {
  addDays,
  findViolations,
  generateWeek,
  generateWeeks,
  restHours,
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

check("同样的输入同样的 seed ⇒ 结果一样（可重复）", () => {
  const a = JSON.stringify(run(baseRules()).map((x) => x.shifts));
  const b = JSON.stringify(run(baseRules()).map((x) => x.shifts));
  assert.equal(a, b);
});

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
