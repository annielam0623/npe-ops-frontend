// G382 请假框纯逻辑（lib/schedule-leave.ts）的检查：node checks/schedule-leave-test.mjs（Node 24 直接跑 .ts）。
// 用例照 preview v2 第 2 节的模拟数据（Anita / Nadia / Jing / Lizzie / Veronica）。
import assert from "node:assert/strict";
import {
  clockRange,
  coverCandidates,
  coverNote,
  coverShiftType,
  datesBetween,
  dayLabel,
  deleteSlotGaps,
  hourlyError,
  hourlyLeaveGaps,
  leaveLine,
  merge,
  onDuty,
  subtract,
} from "../lib/schedule-leave.ts";

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

const V = 1, L = 2, N = 3, J = 4, A = 5, T = 9;
const people = [
  { id: V, name: "Veronica" },
  { id: L, name: "Lizzie" },
  { id: N, name: "Nadia" },
  { id: J, name: "Jing" },
  { id: A, name: "Anita" },
  { id: T, name: "ZZ Test", is_test: true },
];
const D = "2026-12-02";
let sid = 100;
const slot = (emp, type, s, e, date = D) => ({
  id: ++sid, date, shift_type: type, start_time: s, end_time: e, employee_id: emp,
});
const slots = [
  slot(V, "open", "02:00", "12:00"),
  slot(A, "mid", "08:00", "17:00"),
  slot(L, "close", "16:00", "21:30"),
];

check("time helpers", () => {
  assert.equal(clockRange("14:00", "16:00"), "2:00–4:00 PM");
  assert.equal(clockRange("11:00", "13:00"), "11:00 AM–1:00 PM");
  assert.equal(dayLabel("2026-11-27"), "Fri 11/27");
  assert.deepEqual(datesBetween("2026-12-07", "2026-12-08"), ["2026-12-07", "2026-12-08"]);
  assert.deepEqual(datesBetween("2026-12-08", "2026-12-07"), []);
  assert.equal(hourlyError("14:00", "16:00"), null);
  assert.equal(hourlyError("14:15", "16:00"), 'Times must be on the half hour ("HH:MM").');
  assert.equal(hourlyError("16:00", "14:00"), "The end time must be after the start time.");
});

check("merge / subtract", () => {
  assert.deepEqual(merge([{ start: 5, end: 10 }, { start: 0, end: 6 }]), [{ start: 0, end: 10 }]);
  assert.deepEqual(subtract([{ start: 0, end: 10 }], [{ start: 3, end: 5 }]), [
    { start: 0, end: 3 }, { start: 5, end: 10 },
  ]);
});

check("onDuty removes hourly leave, all-day leave = nothing", () => {
  const off = [{ employee_id: A, date: D, kind: "pto", start_time: "14:00", end_time: "16:00" }];
  assert.deepEqual(onDuty(A, D, slots, off), [
    { start: 480, end: 840 }, { start: 960, end: 1020 },
  ]);
  assert.deepEqual(onDuty(A, D, slots, [{ employee_id: A, date: D, kind: "sick" }]), []);
});

check("Anita leave 2–4 PM leaves 2–4 PM uncovered (Lizzie starts 4)", () => {
  const g = hourlyLeaveGaps(A, D, "14:00", "16:00", people, slots, []);
  assert.deepEqual(g, [{ start: 840, end: 960 }]);
});

check("hourly leave fully covered by someone else = no gap", () => {
  const more = [...slots, slot(N, "mid", "12:00", "18:00")];
  assert.deepEqual(hourlyLeaveGaps(A, D, "14:00", "16:00", people, more, []), []);
});

check("hourly leave outside own shift = no gap", () => {
  assert.deepEqual(hourlyLeaveGaps(A, D, "18:00", "20:00", people, slots, []), []);
});

check("test people don't count as coverage", () => {
  const more = [...slots, slot(T, "mid", "12:00", "18:00")];
  assert.deepEqual(hourlyLeaveGaps(A, D, "14:00", "16:00", people, more, []), [{ start: 840, end: 960 }]);
});

check("deleteSlotGaps: Anita's Mid minus Veronica and Lizzie", () => {
  assert.deepEqual(deleteSlotGaps(slots[1], people, slots, []), [{ start: 720, end: 960 }]);
});

check("coverCandidates: free first, busy / on leave greyed with reason, test + self excluded", () => {
  const off = [{ employee_id: J, date: D, kind: "sick" }];
  const c = coverCandidates(D, "14:00", "16:00", A, people, slots, off, (k) => k[0].toUpperCase() + k.slice(1));
  assert.deepEqual(c.map((x) => x.name), ["Lizzie", "Nadia", "Veronica", "Jing"]);
  assert.equal(c[0].blocked, null, "Lizzie starts at 4 PM — 2–4 PM doesn't overlap");
  assert.equal(c[0].thatDay, "Close 4:00 PM – 9:30 PM");
  assert.equal(c[1].thatDay, "Off that day");
  assert.equal(c[2].blocked, null, "Veronica's Open ends 12 PM, free after");
  assert.equal(c[3].blocked, "On leave that day");
  const c2 = coverCandidates(D, "15:00", "17:00", A, people, slots, off, (k) => k);
  assert.equal(c2.find((x) => x.name === "Lizzie").blocked, "Already on close 4:00–9:30 PM");
  const off2 = [{ employee_id: N, date: D, kind: "pto", start_time: "15:00", end_time: "16:00" }];
  const c3 = coverCandidates(D, "14:00", "16:00", A, people, slots, off2);
  assert.equal(c3.find((x) => x.name === "Nadia").blocked, "On leave 3:00–4:00 PM");
});

check("cover shift type follows the leaver's shift (Q12 A) + note", () => {
  assert.equal(coverShiftType(A, D, "14:00", "16:00", slots, "x"), "mid");
  assert.equal(coverShiftType(N, D, "14:00", "16:00", slots, "x"), "x");
  // 一天两个班：同后端，取最早开始的那一班（不是重叠最多的）
  const two = [...slots, slot(A, "close", "17:00", "21:30")];
  assert.equal(coverShiftType(A, D, "18:00", "20:00", two, "x"), "mid");
  assert.equal(coverNote("Anita"), "Cover for Anita");
});

check("leaveLine", () => {
  assert.equal(leaveLine({ kind: "pto", kind_label: "PTO", start_time: "14:00", end_time: "16:00" }), "Leave 2–4 PM (PTO)");
  assert.equal(leaveLine({ kind: "personal", kind_label: "Leave" }), "Leave");
  assert.equal(leaveLine({ kind: "sick" }), "sick");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
