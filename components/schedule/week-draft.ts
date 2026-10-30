import { minutesOf } from "@/lib/schedule-time";
import { shiftYmd } from "@/lib/la-date";
import type { ScheduleGap, ScheduleSlot, ScheduleWeekOp } from "@/types";

/**
 * 排班整周一个 Save（Annie 2026-10-29「你不会用缓存么」「所有的下拉，拖拽---除了shortcut，都是先缓存，然后等保存」，
 * 「4项全部动手」第 3 项：B9 Q1–Q7 照推荐，preview https://claude.ai/artifact/AY3vC6WaeLmTQgTx3BZi79 ）。
 *
 * 页面上的改动先记在这份暂存里：新建的班（临时负数 id）+ 对已有班的改动（换人 / 改时间 / 备注 / 删）。
 * 页面画「库里的 + 暂存」，按 Save 时一次送给后端（POST …/changes，整批一个事务）。纯函数，不碰 React。
 */

/** 页面上新加、还没存的班。tempId 是负数（和库里的 id 分开），ref 是送给后端的 "n1"…。 */
export interface DraftCreate {
  tempId: number;
  date: string;
  shift_type: string;
  start_time: string;
  end_time: string;
  employee_id: number | null;
  note: string | null;
}

/** 对库里一个班的改动；只记和库里不一样的字段。 */
export interface DraftEdit {
  employee_id?: number | null;
  start_time?: string;
  end_time?: string;
  note?: string | null;
  deleted?: true;
}

export interface WeekDraft {
  creates: DraftCreate[];
  edits: Record<number, DraftEdit>;
  /** 下一个临时 id（-1、-2…）。 */
  nextTemp: number;
}

export const EMPTY_DRAFT: WeekDraft = { creates: [], edits: {}, nextTemp: -1 };

/** 卡片上的琥珀色标记（preview ①：moved / time / new，删掉的灰掉划线 + Undo）。 */
export interface SlotMark {
  isNew?: boolean;
  moved?: boolean;
  time?: boolean;
  note?: boolean;
  deleted?: boolean;
}

export function isDirty(d: WeekDraft): boolean {
  return d.creates.length > 0 || Object.keys(d.edits).length > 0;
}

/** 页面上要画的班：库里的（叠上改动，删掉的也留着、带 deleted 标记）+ 新加的。 */
export function applyDraft(
  slots: readonly ScheduleSlot[],
  d: WeekDraft,
): {
  view: ScheduleSlot[];
  live: ScheduleSlot[];
  marks: Map<number, SlotMark>;
} {
  const marks = new Map<number, SlotMark>();
  const view: ScheduleSlot[] = [];
  for (const s of slots) {
    const e = d.edits[s.id];
    if (!e) {
      view.push(s);
      continue;
    }
    view.push({
      ...s,
      ...(e.employee_id !== undefined ? { employee_id: e.employee_id } : {}),
      ...(e.start_time !== undefined ? { start_time: e.start_time } : {}),
      ...(e.end_time !== undefined ? { end_time: e.end_time } : {}),
      ...(e.note !== undefined ? { note: e.note } : {}),
    });
    marks.set(s.id, {
      moved: e.employee_id !== undefined,
      time: e.start_time !== undefined || e.end_time !== undefined,
      note: e.note !== undefined,
      deleted: e.deleted === true,
    });
  }
  for (const c of d.creates) {
    view.push({
      id: c.tempId,
      date: c.date,
      shift_type: c.shift_type,
      start_time: c.start_time,
      end_time: c.end_time,
      employee_id: c.employee_id,
      note: c.note,
      updated_by: null,
      updated_at: null,
    });
    marks.set(c.tempId, { isNew: true });
  }
  const live = view.filter((s) => !marks.get(s.id)?.deleted);
  return { view, live, marks };
}

/** 改一个班的某几样（换人 / 改时间 / 备注）。新加的班直接改那一条；库里的班只记和库里不一样的。 */
export function editSlot(
  d: WeekDraft,
  slots: readonly ScheduleSlot[],
  id: number,
  patch: {
    employee_id?: number | null;
    start_time?: string;
    end_time?: string;
    note?: string | null;
  },
): WeekDraft {
  if (id < 0) {
    return {
      ...d,
      creates: d.creates.map((c) => (c.tempId === id ? { ...c, ...patch } : c)),
    };
  }
  const orig = slots.find((s) => s.id === id);
  if (!orig) return d;
  const next: DraftEdit = { ...d.edits[id] };
  for (const key of [
    "employee_id",
    "start_time",
    "end_time",
    "note",
  ] as const) {
    if (!(key in patch)) continue;
    const v = patch[key];
    const was = key === "note" ? (orig.note ?? null) : orig[key];
    if (v === was) delete next[key];
    else (next as Record<string, unknown>)[key] = v;
  }
  // 时间成对送：改了其中一个，另一个也带上（后端 time 要两个都有）。
  if ((next.start_time !== undefined) !== (next.end_time !== undefined)) {
    next.start_time ??= orig.start_time;
    next.end_time ??= orig.end_time;
  }
  const edits = { ...d.edits };
  if (Object.keys(next).length) edits[id] = next;
  else delete edits[id];
  return { ...d, edits };
}

/** 删一个班：新加的直接拿掉；库里的标 deleted（灰掉划线，按 Save 才真删，没存之前可以 Undo）。 */
export function removeSlot(d: WeekDraft, id: number): WeekDraft {
  if (id < 0)
    return { ...d, creates: d.creates.filter((c) => c.tempId !== id) };
  return {
    ...d,
    edits: { ...d.edits, [id]: { ...d.edits[id], deleted: true } },
  };
}

/** Undo 删除：只去掉 deleted，别的改动照旧留着。 */
export function undoRemove(d: WeekDraft, id: number): WeekDraft {
  const e = d.edits[id];
  if (!e?.deleted) return d;
  const rest: DraftEdit = { ...e };
  delete rest.deleted;
  const edits = { ...d.edits };
  if (Object.keys(rest).length) edits[id] = rest;
  else delete edits[id];
  return { ...d, edits };
}

/** 加几个新班（＋ 加班、Auto-fill 当前这一周）。 */
export function addCreates(
  d: WeekDraft,
  list: Omit<DraftCreate, "tempId">[],
): WeekDraft {
  let next = d.nextTemp;
  const made = list.map((c) => ({ ...c, tempId: next-- }));
  return { ...d, creates: [...d.creates, ...made], nextTemp: next };
}

export interface DraftCounts {
  total: number;
  added: number;
  moved: number;
  time: number;
  note: number;
  removed: number;
}

export function countChanges(d: WeekDraft): DraftCounts {
  const c: DraftCounts = {
    total: 0,
    added: d.creates.length,
    moved: 0,
    time: 0,
    note: 0,
    removed: 0,
  };
  for (const e of Object.values(d.edits)) {
    if (e.deleted) {
      c.removed++;
      continue;
    }
    if (e.employee_id !== undefined) c.moved++;
    if (e.start_time !== undefined) c.time++;
    if (e.note !== undefined) c.note++;
  }
  c.total = c.added + c.moved + c.time + c.note + c.removed;
  return c;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** 「Not saved yet: 3 changes (1 shift moved · 1 time changed · 1 shift removed)」（preview ①）。 */
export function summaryOf(c: DraftCounts): string {
  const parts = [
    c.added ? plural(c.added, "shift added", "shifts added") : "",
    c.moved ? plural(c.moved, "shift moved", "shifts moved") : "",
    c.time ? plural(c.time, "time changed", "times changed") : "",
    c.note ? plural(c.note, "note changed", "notes changed") : "",
    c.removed ? plural(c.removed, "shift removed", "shifts removed") : "",
  ].filter(Boolean);
  return `${plural(c.total, "change", "changes")} (${parts.join(" · ")})`;
}

/**
 * 暂存 → 送给后端的 ops，外加每一条对应页面上哪个班（id；新加的是 tempId），后端回 400 op_index 时用来标红那一格。
 * 顺序：先建新班（带人和备注），再换人、改时间、备注，最后删。删掉的班别的改动不送。
 */
export function opsOf(d: WeekDraft): {
  ops: ScheduleWeekOp[];
  slotOf: number[];
} {
  const ops: ScheduleWeekOp[] = [];
  const slotOf: number[] = [];
  d.creates.forEach((c, i) => {
    ops.push({
      op: "create",
      ref: `n${i + 1}`,
      date: c.date,
      shift_type: c.shift_type,
      start_time: c.start_time,
      end_time: c.end_time,
      employee_id: c.employee_id,
      note: c.note,
    });
    slotOf.push(c.tempId);
  });
  const ids = Object.keys(d.edits)
    .map(Number)
    .sort((a, b) => a - b);
  const push = (op: ScheduleWeekOp, id: number) => {
    ops.push(op);
    slotOf.push(id);
  };
  for (const id of ids) {
    const e = d.edits[id];
    if (e.deleted) continue;
    if (e.employee_id !== undefined)
      push({ op: "assign", slot: id, employee_id: e.employee_id }, id);
  }
  for (const id of ids) {
    const e = d.edits[id];
    if (e.deleted) continue;
    if (e.start_time !== undefined && e.end_time !== undefined)
      push(
        {
          op: "time",
          slot: id,
          start_time: e.start_time,
          end_time: e.end_time,
        },
        id,
      );
  }
  for (const id of ids) {
    const e = d.edits[id];
    if (e.deleted) continue;
    if (e.note !== undefined) push({ op: "note", slot: id, note: e.note }, id);
  }
  for (const id of ids)
    if (d.edits[id].deleted) push({ op: "delete", slot: id }, id);
  return { ops, slotOf };
}

/**
 * 照页面上的班算空档（preview Q3「照页面上的改动算，存的时候以后端为准」）：工作时段内、有人的班都没盖到的时间，
 * 算法同后端 / mock（只看排到人的班，跨夜不算）。
 */
export function localGaps(
  weekStart: string,
  slots: readonly ScheduleSlot[],
  work: { start_time: string; end_time: string },
): ScheduleGap[] {
  const winStart = minutesOf(work.start_time);
  const winEnd = minutesOf(work.end_time);
  if (winStart == null || winEnd == null || winEnd <= winStart) return [];
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const gaps: ScheduleGap[] = [];
  for (let i = 0; i < 7; i++) {
    const date = shiftYmd(weekStart, i);
    const covered = slots
      .filter((s) => s.date === date && s.employee_id != null)
      .map((s) => [minutesOf(s.start_time), minutesOf(s.end_time)] as const)
      .filter(
        (p): p is readonly [number, number] =>
          p[0] != null && p[1] != null && p[1] > p[0],
      )
      .map(([s, e]) => [Math.max(s, winStart), Math.min(e, winEnd)] as const)
      .filter(([s, e]) => s < e)
      .sort((a, b) => a[0] - b[0]);
    let cursor = winStart;
    for (const [s, e] of covered) {
      if (s > cursor)
        gaps.push({
          date,
          start_time: hhmm(cursor),
          end_time: hhmm(Math.min(s, winEnd)),
        });
      cursor = Math.max(cursor, e);
    }
    if (cursor < winEnd)
      gaps.push({ date, start_time: hhmm(cursor), end_time: hhmm(winEnd) });
  }
  return gaps;
}
