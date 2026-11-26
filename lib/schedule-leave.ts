/*
 * G382 请假框的纯逻辑（不连接口、不碰 React），node 直接跑：checks/schedule-leave-test.mjs。
 * 规则来源：后端 docs/g382-hr-schedule/design.md 第 2.3 节 + interface.md（task/g382-hr-schedule @ bb5c06de），
 * Annie 2026-11-25 答案：Q1 A（按天请假挪走的班算空档）、Q2 A（已发布周按小时请假要指定顶班）、Q10 A（一人一天一条）、
 * Q12 A（顶班沿用请假人那一班的班次类型 + 备注「Cover for …」）。
 * 这里只做「页面上先挡一下 / 列出来」；最后以后端为准（409 coverage_gap / rule_violation、400 原话）。
 * 不 import "@/…"：node 直接跑 .ts 不认路径别名。
 */

export interface LeaveSlot {
  id: number;
  date: string;
  shift_type: string;
  start_time: string;
  end_time: string;
  employee_id: number | null;
}

export interface LeaveOff {
  id?: number;
  employee_id: number;
  date: string;
  kind: string;
  start_time?: string | null;
  end_time?: string | null;
}

export interface LeavePerson {
  id: number;
  name: string;
  is_active?: boolean;
  is_test?: boolean;
  counts_for_coverage?: boolean;
}

export interface Span {
  start: number;
  end: number;
}

/** "HH:MM" → 第几分钟；不合法 null。 */
export function mins(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 24 || mm > 59 || (h === 24 && mm > 0)) return null;
  return h * 60 + mm;
}

export function hhmm(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" → "3:00 PM"。 */
export function clock(t: string | null | undefined): string {
  const v = mins(t ?? null);
  if (v == null) return "—";
  const h24 = Math.floor(v / 60) % 24;
  const m = v % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** 「3:00–5:00 PM」；跨上下午写全「11:00 AM–1:00 PM」。 */
export function clockRange(start: string, end: string): string {
  const a = clock(start);
  const b = clock(end);
  const [ah, ap] = a.split(" ");
  const [bh, bp] = b.split(" ");
  return ap === bp ? `${ah}–${bh} ${bp}` : `${a}–${b}`;
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-11-27" → "Fri 11/27"。 */
export function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WD[wd]} ${m}/${d}`;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** from..to 含头尾；倒过来 / 超过 31 天返回 []。 */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let d = from;
  while (d <= to && out.length <= 31) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out.length > 31 ? [] : out;
}

/** 按小时的假：两个时间都有。 */
export function isHourly(o: {
  start_time?: string | null;
  end_time?: string | null;
}): boolean {
  return !!o.start_time && !!o.end_time;
}

/** 半小时为单位、结束晚于开始、不跨午夜（interface.md 400 原话）。返回错误原话或 null。 */
export function hourlyError(start: string, end: string): string | null {
  const s = mins(start);
  const e = mins(end);
  if (s == null || e == null || s % 30 !== 0 || e % 30 !== 0)
    return 'Times must be on the half hour ("HH:MM").';
  if (e <= s) return "The end time must be after the start time.";
  return null;
}

function spanOf(start: string, end: string): Span | null {
  const s = mins(start);
  const e = mins(end);
  return s == null || e == null || e <= s ? null : { start: s, end: e };
}

/** 一串区间合并、排好。 */
export function merge(spans: Span[]): Span[] {
  const sorted = spans
    .filter((x) => x.end > x.start)
    .sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

/** a 减去 b。 */
export function subtract(a: Span[], b: Span[]): Span[] {
  let rest = merge(a);
  for (const cut of merge(b)) {
    const next: Span[] = [];
    for (const x of rest) {
      if (cut.end <= x.start || cut.start >= x.end) next.push(x);
      else {
        if (cut.start > x.start) next.push({ start: x.start, end: cut.start });
        if (cut.end < x.end) next.push({ start: cut.end, end: x.end });
      }
    }
    rest = next;
  }
  return rest;
}

export function intersect(a: Span[], b: Span[]): Span[] {
  const out: Span[] = [];
  for (const x of merge(a))
    for (const y of merge(b)) {
      const s = Math.max(x.start, y.start);
      const e = Math.min(x.end, y.end);
      if (e > s) out.push({ start: s, end: e });
    }
  return merge(out);
}

/** 某人某天真正在班的时间（班减去他按小时请假那段；整天假 = 没有）。 */
export function onDuty(
  employeeId: number,
  date: string,
  slots: LeaveSlot[],
  timeOff: LeaveOff[],
  skipSlotIds: ReadonlySet<number> = new Set(),
): Span[] {
  const off = timeOff.find(
    (t) => t.employee_id === employeeId && t.date === date,
  );
  if (off && !isHourly(off)) return [];
  const shifts = slots
    .filter(
      (s) =>
        s.employee_id === employeeId &&
        s.date === date &&
        !skipSlotIds.has(s.id),
    )
    .map((s) => spanOf(s.start_time, s.end_time))
    .filter((x): x is Span => !!x);
  const leave =
    off && isHourly(off) ? spanOf(off.start_time!, off.end_time!) : null;
  return leave ? subtract(shifts, [leave]) : merge(shifts);
}

/** 这一天其他人（不算 exclude、不算 is_test / counts_for_coverage=false 的人）覆盖到的时间。 */
export function othersCoverage(
  date: string,
  exclude: number,
  people: LeavePerson[],
  slots: LeaveSlot[],
  timeOff: LeaveOff[],
  skipSlotIds: ReadonlySet<number> = new Set(),
): Span[] {
  const counted = new Set(
    people
      .filter((p) => !p.is_test && p.counts_for_coverage !== false)
      .map((p) => p.id),
  );
  const all: Span[] = [];
  for (const id of counted) {
    if (id === exclude) continue;
    all.push(...onDuty(id, date, slots, timeOff, skipSlotIds));
  }
  return merge(all);
}

/**
 * 按小时请假会空出来的时段：请假时段 ∩ 他那天的班，再减去别人那段时间的覆盖。
 * 后端会在请求行上带 `would_gap`（interface.md 第 3 节）；有就用后端的，没有才用这个（mock / 旧后端）。
 */
export function hourlyLeaveGaps(
  employeeId: number,
  date: string,
  start: string,
  end: string,
  people: LeavePerson[],
  slots: LeaveSlot[],
  timeOff: LeaveOff[],
): Span[] {
  const leave = spanOf(start, end);
  if (!leave) return [];
  const own = slots
    .filter((s) => s.employee_id === employeeId && s.date === date)
    .map((s) => spanOf(s.start_time, s.end_time))
    .filter((x): x is Span => !!x);
  const lost = intersect([leave], own);
  const others = othersCoverage(
    date,
    employeeId,
    people,
    slots,
    timeOff.filter((t) => !(t.employee_id === employeeId && t.date === date)),
  );
  return subtract(lost, others);
}

/** 删掉这个班会空出来的时段（Q1 A：拿走的班算空档）。 */
export function deleteSlotGaps(
  slot: LeaveSlot,
  people: LeavePerson[],
  slots: LeaveSlot[],
  timeOff: LeaveOff[],
): Span[] {
  const own = spanOf(slot.start_time, slot.end_time);
  if (!own || slot.employee_id == null) return own ? [own] : [];
  const others = othersCoverage(
    slot.date,
    slot.employee_id,
    people,
    slots,
    timeOff,
    new Set([slot.id]),
  );
  return subtract([own], others);
}

export interface Candidate {
  id: number;
  name: string;
  /** null = 可以选；有字 = 灰掉，写原因（英文，页面原样显示）。 */
  blocked: string | null;
  /** 「Off that day」「Open 2:00 AM – 12:00 PM」之类，给人看那天在干嘛。 */
  thatDay: string;
}

/**
 * 能顶 date 那天 start–end 的人：在用、不是测试的人；那段时间没在班、没请假。
 * 规则（min_rest 之类）前端不算——存 / 批的时候后端 409 rule_violation 原样显示（Q4 A），这里不重复一份规则。
 * exclude = 请假的本人。
 */
export function coverCandidates(
  date: string,
  start: string,
  end: string,
  exclude: number,
  people: LeavePerson[],
  slots: LeaveSlot[],
  timeOff: LeaveOff[],
  shiftLabel: (key: string) => string = (k) => k,
  skipSlotIds: ReadonlySet<number> = new Set(),
): Candidate[] {
  const want = spanOf(start, end);
  const out: Candidate[] = [];
  for (const p of people) {
    if (p.id === exclude || p.is_active === false || p.is_test) continue;
    const off = timeOff.find((t) => t.employee_id === p.id && t.date === date);
    const mine = slots
      .filter(
        (s) =>
          s.employee_id === p.id && s.date === date && !skipSlotIds.has(s.id),
      )
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    const thatDay = mine.length
      ? mine
          .map(
            (s) =>
              `${shiftLabel(s.shift_type)} ${clock(s.start_time)} – ${clock(s.end_time)}`,
          )
          .join(", ")
      : "Off that day";
    let blocked: string | null = null;
    if (off && !isHourly(off)) blocked = "On leave that day";
    else if (off && want) {
      const ls = spanOf(off.start_time!, off.end_time!);
      if (ls && intersect([ls], [want]).length)
        blocked = `On leave ${clockRange(off.start_time!, off.end_time!)}`;
    }
    if (!blocked && want) {
      const busy = mine.find((s) => {
        const sp = spanOf(s.start_time, s.end_time);
        return sp && intersect([sp], [want]).length;
      });
      if (busy)
        blocked = `Already on ${shiftLabel(busy.shift_type)} ${clockRange(busy.start_time, busy.end_time)}`;
    }
    out.push({ id: p.id, name: p.name, blocked, thatDay });
  }
  return out.sort(
    (a, b) =>
      Number(!!a.blocked) - Number(!!b.blocked) || a.name.localeCompare(b.name),
  );
}

/**
 * 顶班用哪种班次（Q12 A）：请假那人当天和这段重叠最多的那一班的类型；他那天没班（mock / 数据不齐）就用 fallback。
 */
export function coverShiftType(
  employeeId: number,
  date: string,
  start: string,
  end: string,
  slots: LeaveSlot[],
  fallback: string,
): string {
  const want = spanOf(start, end);
  let best: { key: string; overlap: number } | null = null;
  for (const s of slots) {
    if (s.employee_id !== employeeId || s.date !== date) continue;
    const sp = spanOf(s.start_time, s.end_time);
    const ov =
      sp && want
        ? intersect([sp], [want]).reduce((n, x) => n + x.end - x.start, 0)
        : 0;
    if (!best || ov > best.overlap) best = { key: s.shift_type, overlap: ov };
  }
  return best?.key ?? fallback;
}

/** 顶班 / 填空档的备注（Q12 A）。后端限 120 字。 */
export function coverNote(name: string): string {
  return `Cover for ${name}`.slice(0, 120);
}

/** 「Leave 2–4 PM (PTO)」：格子下面那一行 / 通知里那一段（design 2.1）。整天的只写类别名。 */
export function leaveLine(o: {
  kind_label?: string | null;
  kind: string;
  start_time?: string | null;
  end_time?: string | null;
}): string {
  const label = o.kind_label || o.kind;
  if (!isHourly(o)) return label;
  return `Leave ${clockRange(o.start_time!, o.end_time!).replace(/:00/g, "")} (${label})`;
}

/** 半小时一格的时间选项 00:00 … 24:00（结束可以到 24:00 不行：不跨午夜 ⇒ 到 23:30）。 */
export function halfHourOptions(): string[] {
  const out: string[] = [];
  for (let t = 0; t < 24 * 60; t += 30) out.push(hhmm(t));
  return out;
}
