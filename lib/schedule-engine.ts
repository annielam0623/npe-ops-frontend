/**
 * 自动排班引擎（纯函数，不碰网络、不依赖页面；Annie 2026-10-18 要「默认排好 + 规则」）。
 * 输入：一周的起点（周日）、在职的人、规则清单、前几周已经排好的班；输出：这一周每个人每天的班 + 排不下的问题。
 * 规则只来自传进来的清单（`Rule[]`），代码里没有写死的人名 / 班次 / 钟点。
 * 刻意不 import 任何别的文件（连 `@/…` 都没有），这样可以直接用 node 跑检查：checks/schedule-engine-test.mjs。
 */

/** 0 = 周日 … 6 = 周六（和排班页的列顺序一致）。 */
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface EngineEmployee {
  id: number;
  name: string;
}

export interface TimeRange {
  start: string; // "HH:MM"
  end: string;
}

export type RuleType =
  | "shift_times"
  | "fixed_shift"
  | "weekend_rotation"
  | "cannot_work"
  | "days_per_week"
  | "min_days_on_shift"
  | "min_rest"
  | "after_shift"
  | "coverage"
  | "exclude_from_rotation";

/** 规则清单里的一条；`enabled: false` 的引擎不看。params 的形状看下面各 *Params。 */
export interface Rule {
  id?: number;
  type: RuleType;
  enabled: boolean;
  params: Record<string, unknown>;
}

/** 每种班次的上下班时间（排出来的班用）。{shift_type, start, end} */
export interface ShiftTimesParams {
  shift_type: string;
  start: string;
  end: string;
}
/** 某人固定在某几天上某个班（时间可单独写，不写就用 shift_times）。 */
export interface FixedShiftParams {
  employee_id: number;
  days: DayIndex[];
  shift_type: string;
  start?: string;
  end?: string;
}
/**
 * 周末轮值：slots 里每一项是「哪天 + 哪种班」，每周轮着分给 employee_ids 里的人（不写 = 所有人）。
 * exclusive（不写 = true）：这些天只由轮值排班，补满每周天数时不再往这些天加别的班（固定班不受影响）。
 */
export interface WeekendRotationParams {
  slots: { day: DayIndex; shift_type: string }[];
  employee_ids?: number[];
  exclusive?: boolean;
}
/** 某人（不写 = 所有人）不上某几天（不写 = 每天）/ 某种班（不写 = 任何班）。days 和 shift_type 至少写一个。 */
export interface CannotWorkParams {
  employee_id?: number;
  days?: DayIndex[];
  shift_type?: string;
}
/** 每人每周刚好 / 最多 n 天（employee_ids 不写 = 所有人）。 */
export interface DaysPerWeekParams {
  mode: "exactly" | "max";
  n: number;
  employee_ids?: number[];
}
/** 某人（不写 = 所有人）某种班每周 / 每 4 周至少 n 天。 */
export interface MinDaysOnShiftParams {
  employee_id?: number;
  shift_type: string;
  n: number;
  per: "week" | "4weeks";
}
/** 两个班之间至少隔 hours 小时（下班到下一个班的上班，跨周也算）。 */
export interface MinRestParams {
  hours: number;
}
/** 前一天上了 if_worked 这种班，第二天不能上 then_cannot 这种班。 */
export interface AfterShiftParams {
  if_worked: string;
  then_cannot: string;
}
/** 每天（days 不写 = 每天）某种班至少 min 个人。 */
export interface CoverageParams {
  shift_type: string;
  min: number;
  days?: DayIndex[];
}
/** 不参加轮换的人：周末轮值、以及排满天数时多出来的班都不排他（只排固定班）。 */
export interface ExcludeFromRotationParams {
  employee_id: number;
}

/** 一个人一周 7 天的班：下标 0..6，休息 = null。 */
export type DayShift = { type: string; start: string; end: string } | null;
export interface WeekPlan {
  weekStart: string; // 周日 "YYYY-MM-DD"
  byEmployee: Record<number, DayShift[]>;
}

export interface PlannedShift {
  employeeId: number;
  date: string;
  type: string;
  start: string;
  end: string;
}

export interface Problem {
  date?: string;
  message: string;
}

export interface GenerateInput {
  weekStart: string;
  employees: EngineEmployee[];
  rules: Rule[];
  /** 上一周（跨周的休息间隔、周末轮值接着往下排用）；没有 = null。 */
  previous: WeekPlan | null;
  /** 更早的几周（公平：每种班次、周末班大家排得一样多），越新越靠后；可以空。 */
  history?: WeekPlan[];
  /** 没有 shift_times 规则的班次类型用这个时间（例如工作时段起止）。 */
  fallbackTimes: TimeRange;
  seed?: number;
}

export interface GenerateResult {
  plan: WeekPlan;
  shifts: PlannedShift[];
  problems: Problem[];
}

// ───────────────────────── 小工具 ─────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hours(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h + m / 60;
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 前一个班下班到后一个班（第二天）上班隔了几个小时；下班不晚于上班（跨午夜 / 填错）按不超过 24 点算。 */
export function restHours(prevEnd: string, nextStart: string): number {
  return 24 - hours(prevEnd) + hours(nextStart);
}

function enabled<T>(rules: Rule[], type: RuleType): T[] {
  return rules
    .filter((r) => r.enabled && r.type === type)
    .map((r) => r.params as unknown as T);
}

// ───────────────────────── 规则解释 ─────────────────────────

interface Compiled {
  times: Map<string, TimeRange>;
  fixed: FixedShiftParams[];
  rotation: WeekendRotationParams[];
  cannot: CannotWorkParams[];
  perWeek: DaysPerWeekParams[];
  minDays: MinDaysOnShiftParams[];
  minRest: number | null;
  after: AfterShiftParams[];
  coverage: CoverageParams[];
  excluded: Set<number>;
}

function compile(rules: Rule[]): Compiled {
  const times = new Map<string, TimeRange>();
  for (const t of enabled<ShiftTimesParams>(rules, "shift_times")) {
    times.set(t.shift_type, { start: t.start, end: t.end });
  }
  const rests = enabled<MinRestParams>(rules, "min_rest").map((r) => r.hours);
  return {
    times,
    fixed: enabled<FixedShiftParams>(rules, "fixed_shift"),
    rotation: enabled<WeekendRotationParams>(rules, "weekend_rotation"),
    cannot: enabled<CannotWorkParams>(rules, "cannot_work"),
    perWeek: enabled<DaysPerWeekParams>(rules, "days_per_week"),
    minDays: enabled<MinDaysOnShiftParams>(rules, "min_days_on_shift"),
    minRest: rests.length ? Math.max(...rests) : null,
    after: enabled<AfterShiftParams>(rules, "after_shift"),
    coverage: enabled<CoverageParams>(rules, "coverage"),
    excluded: new Set(
      enabled<ExcludeFromRotationParams>(rules, "exclude_from_rotation").map(
        (r) => r.employee_id,
      ),
    ),
  };
}

function timesFor(
  c: Compiled,
  type: string,
  fallback: TimeRange,
): TimeRange {
  return c.times.get(type) ?? fallback;
}

function canWork(
  c: Compiled,
  employeeId: number,
  day: DayIndex,
  type: string,
): boolean {
  for (const r of c.cannot) {
    if (r.employee_id != null && r.employee_id !== employeeId) continue;
    const dayHit = !r.days || r.days.length === 0 || r.days.includes(day);
    const typeHit = !r.shift_type || r.shift_type === type;
    if (dayHit && typeHit) return false;
  }
  return true;
}

/** 这个人每周要上几天：exactly / max 都当目标天数；没有规则 = null（只排被规则点名的班）。 */
function targetDays(c: Compiled, employeeId: number): number | null {
  let target: number | null = null;
  for (const r of c.perWeek) {
    if (r.employee_ids && !r.employee_ids.includes(employeeId)) continue;
    target = target == null ? r.n : Math.min(target, r.n);
  }
  return target;
}

/** 前一天的班 → 第二天这个班能不能接（间隔 + after_shift）。 */
function followOk(
  c: Compiled,
  prev: DayShift,
  next: { type: string; start: string },
): boolean {
  if (!prev) return true;
  if (c.minRest != null && restHours(prev.end, next.start) < c.minRest) {
    return false;
  }
  for (const r of c.after) {
    if (prev.type === r.if_worked && next.type === r.then_cannot) return false;
  }
  return true;
}

// ───────────────────────── 检查（也是测试用的「判官」）─────────────────────────

/** 返回这一周违反的硬规则（不看公平 / 最少天数这类软的）。 */
export function findViolations(
  rules: Rule[],
  plan: WeekPlan,
  previous: WeekPlan | null,
  employees: EngineEmployee[],
): string[] {
  const c = compile(rules);
  const out: string[] = [];
  const name = (id: number) =>
    employees.find((e) => e.id === id)?.name ?? String(id);
  for (const e of employees) {
    const days = plan.byEmployee[e.id] ?? new Array(7).fill(null);
    const prevLast = previous?.byEmployee[e.id]?.[6] ?? null;
    for (let d = 0; d < 7; d++) {
      const s = days[d];
      if (!s) continue;
      if (!canWork(c, e.id, d as DayIndex, s.type)) {
        out.push(`${name(e.id)} works ${s.type} on day ${d} but a rule forbids it`);
      }
      const before: DayShift = d === 0 ? prevLast : days[d - 1];
      if (!followOk(c, before, s)) {
        out.push(`${name(e.id)} day ${d}: not enough rest after the previous shift`);
      }
    }
    const t = targetDays(c, e.id);
    const worked = days.filter(Boolean).length;
    const rule = c.perWeek.find(
      (r) => !r.employee_ids || r.employee_ids.includes(e.id),
    );
    if (rule && rule.mode === "exactly" && worked !== rule.n) {
      out.push(`${name(e.id)} works ${worked} days, rule says exactly ${rule.n}`);
    }
    if (rule && rule.mode === "max" && t != null && worked > t) {
      out.push(`${name(e.id)} works ${worked} days, rule says at most ${t}`);
    }
  }
  for (const f of c.fixed) {
    for (const d of f.days) {
      const s = plan.byEmployee[f.employee_id]?.[d];
      if (!s || s.type !== f.shift_type) {
        out.push(
          `${name(f.employee_id)} should be fixed on ${f.shift_type} day ${d}`,
        );
      }
    }
  }
  for (const cov of c.coverage) {
    for (let d = 0; d < 7; d++) {
      if (cov.days && cov.days.length && !cov.days.includes(d as DayIndex)) continue;
      const n = employees.filter(
        (e) => plan.byEmployee[e.id]?.[d]?.type === cov.shift_type,
      ).length;
      if (n < cov.min) {
        out.push(`day ${d}: ${cov.shift_type} has ${n}, needs ${cov.min}`);
      }
    }
  }
  return out;
}

// ───────────────────────── 排一周 ─────────────────────────

const WEEKDAYS: DayIndex[] = [0, 1, 2, 3, 4, 5, 6];

function emptyDays(): DayShift[] {
  return new Array(7).fill(null);
}

function countType(plans: WeekPlan[], employeeId: number, type: string): number {
  let n = 0;
  for (const p of plans) {
    for (const s of p.byEmployee[employeeId] ?? []) {
      if (s && s.type === type) n++;
    }
  }
  return n;
}

function countWeekendSlot(
  plans: WeekPlan[],
  employeeId: number,
  day: DayIndex,
  type: string,
): number {
  let n = 0;
  for (const p of plans) {
    const s = p.byEmployee[employeeId]?.[day];
    if (s && s.type === type) n++;
  }
  return n;
}

export function generateWeek(input: GenerateInput): GenerateResult {
  const c = compile(input.rules);
  const rand = mulberry32(input.seed ?? 1);
  const problems: Problem[] = [];
  const history = [...(input.history ?? []), ...(input.previous ? [input.previous] : [])];
  const emps = input.employees;
  const byId = new Map(emps.map((e) => [e.id, e]));
  const typeOrder = collectTypes(c, input.rules);

  const days: Record<number, DayShift[]> = {};
  for (const e of emps) days[e.id] = emptyDays();
  const prevLast = (id: number): DayShift => input.previous?.byEmployee[id]?.[6] ?? null;
  const dateOf = (d: number) => addDays(input.weekStart, d);
  const mk = (type: string, override?: Partial<TimeRange>): DayShift => {
    const t = timesFor(c, type, input.fallbackTimes);
    return { type, start: override?.start ?? t.start, end: override?.end ?? t.end };
  };

  // 1) 固定班
  for (const f of c.fixed) {
    if (!byId.has(f.employee_id)) continue;
    for (const d of f.days) {
      days[f.employee_id][d] = mk(f.shift_type, { start: f.start, end: f.end });
    }
  }

  // 2) 周末轮值：这一周所有位置一起找「历史上排得最均匀」的分法（位置少，直接穷举 + 剪枝），
  //    不是一个位置一个位置贪心——贪心到最后一个位置常常只剩下一个已经排过的人，几周后就不公平了。
  for (const rot of c.rotation) {
    const pool = emps.filter(
      (e) =>
        !c.excluded.has(e.id) &&
        (!rot.employee_ids || rot.employee_ids.includes(e.id)),
    );
    const slots = rot.slots;
    const weekNo = history.length;
    const okFor = (e: EngineEmployee, slot: { day: DayIndex; shift_type: string }) => {
      if (days[e.id][slot.day]) return false;
      if (!canWork(c, e.id, slot.day, slot.shift_type)) return false;
      const t = timesFor(c, slot.shift_type, input.fallbackTimes);
      const before = slot.day === 0 ? prevLast(e.id) : days[e.id][slot.day - 1];
      if (!followOk(c, before, { type: slot.shift_type, start: t.start })) return false;
      const after = slot.day === 6 ? null : days[e.id][slot.day + 1];
      if (after && !followOk(c, mk(slot.shift_type), after)) return false;
      return true;
    };
    const weekendTotal = (e: EngineEmployee) =>
      slots.reduce((n, sl) => n + countWeekendSlot(history, e.id, sl.day, sl.shift_type), 0);
    const cost = (e: EngineEmployee, idx: number, slot: { day: DayIndex; shift_type: string }) => {
      const k = countWeekendSlot(history, e.id, slot.day, slot.shift_type);
      return 10 * k * k + weekendTotal(e) + ((idx + weekNo) % Math.max(1, pool.length)) * 0.001;
    };
    const distinct = pool.length >= slots.length;
    let bestAssign: (EngineEmployee | null)[] | null = null;
    let bestCost = Infinity;
    let nodes = 0;
    const cur: (EngineEmployee | null)[] = [];
    const used = new Set<number>();
    const dfs = (i: number, total: number) => {
      if (nodes++ > 200000 || total >= bestCost) return;
      if (i === slots.length) {
        bestCost = total;
        bestAssign = cur.slice();
        return;
      }
      const slot = slots[i];
      const options = pool
        .map((e, idx) => ({ e, c: cost(e, idx, slot) }))
        .filter(({ e }) => okFor(e, slot) && !(distinct && used.has(e.id)))
        .sort((x, y) => x.c - y.c);
      for (const { e, c: oc } of options) {
        cur[i] = e;
        used.add(e.id);
        // 同一个人在同一个周末被两个位置占了：先写进去让后面的 okFor 看得见
        days[e.id][slot.day] = mk(slot.shift_type);
        dfs(i + 1, total + oc);
        days[e.id][slot.day] = null;
        used.delete(e.id);
      }
      if (options.length === 0) {
        cur[i] = null;
        dfs(i + 1, total + 1000);
      }
    };
    dfs(0, 0);
    const chosen: (EngineEmployee | null)[] = bestAssign ?? slots.map(() => null);
    chosen.forEach((e, i) => {
      const slot = slots[i];
      if (!e) {
        problems.push({
          date: dateOf(slot.day),
          message: `Weekend rotation: nobody can take ${slot.shift_type} on ${dateOf(slot.day)} without breaking a rule.`,
        });
        return;
      }
      days[e.id][slot.day] = mk(slot.shift_type);
    });
  }

  // 3) 补满每人每周的天数 + 每天的最少人数（随机起点 + 逐个换，评分最低的留下）
  const flexEmps = emps.filter((e) => !c.excluded.has(e.id) || false);
  const forcedCount = (id: number) => days[id].filter(Boolean).length;
  const need = new Map<number, number>(); // 还要补几天
  for (const e of flexEmps) {
    const t = targetDays(c, e.id);
    if (t != null) need.set(e.id, Math.max(0, t - forcedCount(e.id)));
  }
  for (const e of emps) {
    if (c.excluded.has(e.id)) need.delete(e.id);
  }
  const types = typeOrder.filter((t) => t);
  // 周末轮值（exclusive）占住的天：补满天数时不往这些天加班。
  const rotationDays = new Set<DayIndex>();
  for (const rot of c.rotation) {
    if (rot.exclusive === false) continue;
    for (const sl of rot.slots) rotationDays.add(sl.day);
  }

  type Pattern = DayShift[];
  const patternsFor = (e: EngineEmployee): Pattern[] => {
    const n = need.get(e.id) ?? 0;
    const base = days[e.id];
    if (n === 0) return [base.slice()];
    const free = WEEKDAYS.filter((d) => !base[d] && !rotationDays.has(d));
    const out: Pattern[] = [];
    const choose = (start: number, picked: DayIndex[]) => {
      if (picked.length === n) {
        assign(0, picked, base.slice());
        return;
      }
      for (let i = start; i < free.length; i++) choose(i + 1, [...picked, free[i]]);
    };
    const assign = (i: number, picked: DayIndex[], cur: Pattern) => {
      if (i === picked.length) {
        if (patternOk(e.id, cur)) out.push(cur.slice());
        return;
      }
      const d = picked[i];
      for (const type of types) {
        if (!canWork(c, e.id, d, type)) continue;
        cur[d] = mk(type);
        assign(i + 1, picked, cur);
        cur[d] = null;
      }
    };
    choose(0, []);
    return out;
  };
  const patternOk = (id: number, p: Pattern): boolean => {
    for (let d = 0; d < 7; d++) {
      const s = p[d];
      if (!s) continue;
      const before: DayShift = d === 0 ? prevLast(id) : p[d - 1];
      if (!followOk(c, before, s)) return false;
    }
    return true;
  };

  const candidates = new Map<number, Pattern[]>();
  for (const e of emps) {
    const list = patternsFor(e);
    if (list.length === 0) {
      problems.push({
        message: `${e.name}: no way to fill ${need.get(e.id) ?? 0} more day(s) without breaking a rule.`,
      });
      candidates.set(e.id, [days[e.id].slice()]);
    } else {
      candidates.set(e.id, list);
    }
  }

  const histWithPrev = history;
  const score = (choice: Map<number, Pattern>): number => {
    let s = 0;
    // 每天最少人数（硬）
    for (const cov of c.coverage) {
      for (const d of WEEKDAYS) {
        if (cov.days && cov.days.length && !cov.days.includes(d)) continue;
        let n = 0;
        for (const e of emps) if (choice.get(e.id)?.[d]?.type === cov.shift_type) n++;
        if (n < cov.min) s += 1000 * (cov.min - n);
      }
    }
    // 某种班至少几天（每周的当场算；每 4 周的按历史 + 这一周）
    for (const r of c.minDays) {
      const targets = r.employee_id != null ? emps.filter((e) => e.id === r.employee_id) : emps.filter((e) => !c.excluded.has(e.id));
      for (const e of targets) {
        const pat = choice.get(e.id)!;
        const thisWeek = pat.filter((x) => x && x.type === r.shift_type).length;
        const have = r.per === "week" ? thisWeek : thisWeek + countType(histWithPrev.slice(-3), e.id, r.shift_type);
        if (have < r.n) s += 200 * (r.n - have);
      }
    }
    // 公平：非固定的人，每种班次（含历史）排得一样多
    const flex = emps.filter((e) => !c.excluded.has(e.id) && (need.get(e.id) ?? 0) > 0);
    for (const type of types) {
      const counts = flex.map((e) => countType(histWithPrev, e.id, type) + choice.get(e.id)!.filter((x) => x && x.type === type).length);
      if (counts.length) s += 5 * (Math.max(...counts) - Math.min(...counts));
    }
    // 每天人数别忽多忽少
    const heads = WEEKDAYS.map((d) => emps.filter((e) => choice.get(e.id)?.[d]).length);
    const mean = heads.reduce((a, b) => a + b, 0) / 7;
    for (const h of heads) s += 0.5 * Math.abs(h - mean);
    return s;
  };

  let best: Map<number, Pattern> | null = null;
  let bestScore = Infinity;
  const ids = emps.map((e) => e.id);
  for (let restart = 0; restart < 30 && bestScore > 0.0001; restart++) {
    const cur = new Map<number, Pattern>();
    for (const id of ids) {
      const list = candidates.get(id)!;
      cur.set(id, list[Math.floor(rand() * list.length)]);
    }
    let curScore = score(cur);
    for (let it = 0; it < 4000; it++) {
      const id = ids[Math.floor(rand() * ids.length)];
      const list = candidates.get(id)!;
      if (list.length < 2) continue;
      const old = cur.get(id)!;
      cur.set(id, list[Math.floor(rand() * list.length)]);
      const ns = score(cur);
      if (ns <= curScore) curScore = ns;
      else cur.set(id, old);
    }
    if (curScore < bestScore) {
      bestScore = curScore;
      best = new Map(cur);
    }
  }
  if (best) for (const id of ids) days[id] = best.get(id)!.slice();

  // 4) 剩下的问题：每天最少人数没排满
  for (const cov of c.coverage) {
    for (const d of WEEKDAYS) {
      if (cov.days && cov.days.length && !cov.days.includes(d)) continue;
      const n = emps.filter((e) => days[e.id][d]?.type === cov.shift_type).length;
      if (n < cov.min) {
        problems.push({
          date: dateOf(d),
          message: `${dateOf(d)}: ${cov.shift_type} needs ${cov.min} but only ${n} can be placed without breaking a rule.`,
        });
      }
    }
  }
  for (const r of c.minDays) {
    const targets = r.employee_id != null ? emps.filter((e) => e.id === r.employee_id) : emps.filter((e) => !c.excluded.has(e.id));
    for (const e of targets) {
      const thisWeek = days[e.id].filter((x) => x && x.type === r.shift_type).length;
      const have = r.per === "week" ? thisWeek : thisWeek + countType(histWithPrev.slice(-3), e.id, r.shift_type);
      if (have < r.n) {
        problems.push({
          message: `${e.name}: only ${have} ${r.shift_type} day(s), the rule wants at least ${r.n} per ${r.per === "week" ? "week" : "4 weeks"}.`,
        });
      }
    }
  }

  const plan: WeekPlan = { weekStart: input.weekStart, byEmployee: days };
  const shifts: PlannedShift[] = [];
  for (const e of emps) {
    for (let d = 0; d < 7; d++) {
      const s = days[e.id][d];
      if (s) shifts.push({ employeeId: e.id, date: dateOf(d), type: s.type, start: s.start, end: s.end });
    }
  }
  return { plan, shifts, problems };
}

function collectTypes(c: Compiled, rules: Rule[]): string[] {
  const set = new Set<string>(c.times.keys());
  for (const r of rules) {
    if (!r.enabled) continue;
    const t = (r.params as { shift_type?: string }).shift_type;
    if (t) set.add(t);
  }
  return [...set];
}

/** 一次排连续几周（每一周接着上一周往下排）。 */
export function generateWeeks(
  input: Omit<GenerateInput, "weekStart"> & { weekStart: string; weeks: number },
): GenerateResult[] {
  const results: GenerateResult[] = [];
  let previous = input.previous;
  const history = [...(input.history ?? [])];
  for (let i = 0; i < input.weeks; i++) {
    const r = generateWeek({
      ...input,
      weekStart: addDays(input.weekStart, i * 7),
      previous,
      history,
      seed: (input.seed ?? 1) + i,
    });
    results.push(r);
    if (previous) history.push(previous);
    previous = r.plan;
  }
  return results;
}
