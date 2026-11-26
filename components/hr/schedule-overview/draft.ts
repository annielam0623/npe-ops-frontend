import { weekStartYmd } from "@/lib/la-date";
import type { ScheduleSlot, ScheduleTimeOff, ScheduleWeekOp } from "@/types";
import type { RangeOp } from "@/types/schedule-overview";

/*
 * G382 总览的页面草稿（先选后存，Annie 2026-10-29 / 11-19）：拖班、加删班、改时间备注、录假、Fill gap 都只改这份本地副本；
 * 按 Save 时跟读来的数据比一遍，算出 range/changes 的 ops（interface.md 2.2），一次存完。
 * 用「比差」而不是记每一步：改了又改回去就不算改动；跨周拖 = 原周 delete + 新周 create（同一个事务）。
 */

export type Key = number | string;

export interface DraftSlot {
  /** 读来的班 = slot id；草稿里新加的 = "n1"、"n2"…（就是 create op 的 ref）。 */
  key: Key;
  date: string;
  shift_type: string;
  start_time: string;
  end_time: string;
  employee_id: number | null;
  note: string | null;
}

export interface DraftOff {
  /** 读来的假 = time_off id；草稿里新录的 = "t1"…。 */
  key: Key;
  employee_id: number;
  date: string;
  kind: string;
  kind_label?: string | null;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
}

export interface Draft {
  slots: DraftSlot[];
  timeOff: DraftOff[];
}

/** 后端可能给 "HH:MM:SS"，页面一律 "HH:MM"。 */
export const hm = (t: string | null | undefined): string | null =>
  t == null ? null : t.slice(0, 5);

export function draftFrom(slots: ScheduleSlot[], off: ScheduleTimeOff[]): Draft {
  return {
    slots: slots.map((s) => ({
      key: s.id,
      date: s.date,
      shift_type: s.shift_type,
      start_time: hm(s.start_time) ?? "",
      end_time: hm(s.end_time) ?? "",
      employee_id: s.employee_id,
      note: s.note ?? null,
    })),
    timeOff: off.map((t) => ({
      key: t.id,
      employee_id: t.employee_id,
      date: t.date,
      kind: t.kind,
      kind_label: t.kind_label ?? null,
      start_time: hm(t.start_time),
      end_time: hm(t.end_time),
      note: t.note ?? null,
    })),
  };
}

let refN = 0;
export const newRef = (prefix: "n" | "t") => `${prefix}${++refN}`;

export interface DiffResult {
  ops: RangeOp[];
  /** 每个 op 落在哪一周（同 ops 的下标）。 */
  weeks: Set<string>;
  /** 有班 op 的周：要占编辑锁、带 base_version（只录 / 删假的周不查，后端 86 11-26）。 */
  slotWeeks: Set<string>;
}

/** 草稿跟读来的数据比，算出 ops。 */
export function diffDraft(base: Draft, cur: Draft): DiffResult {
  const ops: RangeOp[] = [];
  const weeks = new Set<string>();
  const slotWeeks = new Set<string>();
  const slotOp = (op: ScheduleWeekOp, date: string) => {
    ops.push(op);
    const w = weekStartYmd(date);
    weeks.add(w);
    slotWeeks.add(w);
  };
  const curById = new Map(cur.slots.map((s) => [s.key, s]));
  for (const b of base.slots) {
    const c = curById.get(b.key);
    if (!c) {
      slotOp({ op: "delete", slot: b.key }, b.date);
      continue;
    }
    if (c.date !== b.date || c.shift_type !== b.shift_type) {
      // 换了日子（可能跨周）或换了班次类型：删了重建。
      slotOp({ op: "delete", slot: b.key }, b.date);
      slotOp(createOp(c, `m${b.key}`), c.date);
      continue;
    }
    if (c.employee_id !== b.employee_id)
      slotOp({ op: "assign", slot: b.key, employee_id: c.employee_id }, b.date);
    if (c.start_time !== b.start_time || c.end_time !== b.end_time)
      slotOp(
        { op: "time", slot: b.key, start_time: c.start_time, end_time: c.end_time },
        b.date,
      );
    if ((c.note ?? null) !== (b.note ?? null))
      slotOp({ op: "note", slot: b.key, note: c.note }, b.date);
  }
  for (const c of cur.slots)
    if (typeof c.key === "string") slotOp(createOp(c, c.key), c.date);

  const offById = new Map(cur.timeOff.map((t) => [t.key, t]));
  for (const b of base.timeOff) {
    const c = offById.get(b.key);
    if (!c) {
      ops.push({ op: "time_off_delete", id: b.key as number });
      weeks.add(weekStartYmd(b.date));
    } else if (
      c.kind !== b.kind ||
      c.start_time !== b.start_time ||
      c.end_time !== b.end_time ||
      (c.note ?? null) !== (b.note ?? null)
    ) {
      // 同一人同一天已有假 ⇒ time_off_set 改成这一条（2.2）。
      ops.push(offSet(c));
      weeks.add(weekStartYmd(c.date));
    }
  }
  for (const c of cur.timeOff)
    if (typeof c.key === "string") {
      ops.push(offSet(c));
      weeks.add(weekStartYmd(c.date));
    }
  return { ops, weeks, slotWeeks };
}

function createOp(s: DraftSlot, ref: string): ScheduleWeekOp {
  return {
    op: "create",
    ref,
    date: s.date,
    shift_type: s.shift_type,
    start_time: s.start_time,
    end_time: s.end_time,
    employee_id: s.employee_id,
    note: s.note,
  };
}

function offSet(t: DraftOff): RangeOp {
  return {
    op: "time_off_set",
    employee_id: t.employee_id,
    date: t.date,
    kind: t.kind,
    start_time: t.start_time,
    end_time: t.end_time,
    note: t.note,
  };
}

// ---- 改草稿（都返回新的 Draft，不改原来的） ----

export function moveSlot(d: Draft, key: Key, employeeId: number | null, date: string): Draft {
  return {
    ...d,
    slots: d.slots.map((s) => (s.key === key ? { ...s, employee_id: employeeId, date } : s)),
  };
}

export function deleteSlot(d: Draft, key: Key): Draft {
  return { ...d, slots: d.slots.filter((s) => s.key !== key) };
}

export function editSlot(
  d: Draft,
  key: Key,
  patch: Partial<Pick<DraftSlot, "start_time" | "end_time" | "note" | "shift_type" | "employee_id">>,
): Draft {
  return { ...d, slots: d.slots.map((s) => (s.key === key ? { ...s, ...patch } : s)) };
}

export function addSlot(d: Draft, s: Omit<DraftSlot, "key">): Draft {
  return { ...d, slots: [...d.slots, { ...s, key: newRef("n") }] };
}

/** 录 / 改假：同一人同一天只有一条（Q10 A），已有就改那一条（留着原来的 key）。 */
export function setOff(d: Draft, t: Omit<DraftOff, "key">): Draft {
  const old = d.timeOff.find((x) => x.employee_id === t.employee_id && x.date === t.date);
  const row: DraftOff = { ...t, key: old ? old.key : newRef("t") };
  return {
    ...d,
    timeOff: old ? d.timeOff.map((x) => (x === old ? row : x)) : [...d.timeOff, row],
  };
}

export function deleteOff(d: Draft, key: Key): Draft {
  return { ...d, timeOff: d.timeOff.filter((t) => t.key !== key) };
}

/** 一个动作碰到的周（要占锁）：班原来的周和新的周。 */
export function weeksOfSlotChange(d: Draft, key: Key, newDate?: string): string[] {
  const s = d.slots.find((x) => x.key === key);
  const out = new Set<string>();
  if (s) out.add(weekStartYmd(s.date));
  if (newDate) out.add(weekStartYmd(newDate));
  return [...out];
}
