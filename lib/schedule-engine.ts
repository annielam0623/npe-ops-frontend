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
  | "max_days_on_shift"
  | "min_rest"
  | "after_shift"
  | "coverage"
  | "exclude_from_rotation"
  | "max_per_shift_day"
  | "weekly_hours_alert";

/** 规则清单里的一条；`enabled: false` 的引擎不看。params 的形状看下面各 *Params。 */
export interface Rule {
  id?: string;
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
/**
 * 某种班每周 / 每 4 周至少 n 天。选人三选一（置顶 110 题 7）：employee_ids = 只算这几个人；
 * exclude_employee_ids = 除了这几个人；都不写 = 所有人（不含 exclude_from_rotation 的人）。
 * employee_id 是旧规则的写法（只读，存的时候前端换成 employee_ids）。
 */
export interface MinDaysOnShiftParams {
  employee_id?: number;
  employee_ids?: number[];
  exclude_employee_ids?: number[];
  shift_type: string;
  n: number;
  per: "week" | "4weeks";
}
/**
 * 置顶 118（Annie「Lizzie一周最多一次closing」）：某种班每周最多 n 天。选人同 min_days_on_shift
 * （employee_ids / exclude_employee_ids / 都不写 = 所有人）。Auto-fill 严格遵守。
 */
export interface MaxDaysOnShiftParams {
  employee_ids?: number[];
  exclude_employee_ids?: number[];
  shift_type: string;
  n: number;
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
/**
 * 每个班一天最多几人（置顶 110 ①）：shift_type 不写 = 每种班各自算；days 不写 = 每天。
 * Auto-fill 严格遵守（固定班 / 保留的班本身超了照排、写进预览，不再加人）；手动排班不拦，只标出来。
 */
export interface MaxPerShiftDayParams {
  shift_type?: string;
  max: number;
  days?: DayIndex[];
  /**
   * 例外（置顶 110 续，Annie 2026-11-09「1 A 2 B 3 A 4C 5A 6A 7 A。动手」）：这些日子用例外的人数，盖过这条规则
   * （可比一般的多，也可更少）。from 必填，to 不写 = 同一天；shift_type 不写 = 跟这条规则（规则也没写 = 每种班）。
   * 过期的照存，页面灰掉写 (past)。几条规则之间照旧取小的（题 2 B）。
   */
  exceptions?: MaxPerShiftException[];
}
export interface MaxPerShiftException {
  from: string;
  to?: string;
  max: number;
  shift_type?: string;
}
/** 每周超过 hours 小时提醒（置顶 110 ④）：只提醒、不拦，排班引擎不看它。 */
export interface WeeklyHoursAlertParams {
  hours: number;
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
  /** 这一周里已经排好、要原样保留的班（「Add to them」：在现有班的基础上补）；这些天不会再排别的班，也不会被改。 */
  locked?: WeekPlan | null;
  seed?: number;
  /**
   * 置顶 117：已经批了的 Leave（PTO / Sick / Personal，后端 time-off）：员工 id → 这一周哪几天（0 = 周日）。
   * 这些天这个人什么班都不排（固定班、轮值、补排都跳过）；后端同一人同一天既有班又有休假会拒。
   */
  leave?: Record<number, DayIndex[]>;
  /**
   * Leave 跟 Days per week 的关系：Annie 2026-11-10 定「leave另外加」⇒ 默认 false = Leave 另外算（目标天数 − Leave 天数，
   * 每周两天固定休息照给）；true = Leave 算进每周的休息天（目标天数最多 7 − Leave 天数）。
   */
  leaveCountsAsOff?: boolean;
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
  maxDays: MaxDaysOnShiftParams[];
  minRest: number | null;
  after: AfterShiftParams[];
  coverage: CoverageParams[];
  excluded: Set<number>;
  maxPer: MaxPerShiftDayParams[];
  /** 置顶 117：每人这一周 Leave 几天（generateWeek 填）。 */
  leaveDays: Map<number, number>;
  leaveCountsAsOff: boolean;
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
    maxDays: enabled<MaxDaysOnShiftParams>(rules, "max_days_on_shift"),
    minRest: rests.length ? Math.max(...rests) : null,
    after: enabled<AfterShiftParams>(rules, "after_shift"),
    coverage: enabled<CoverageParams>(rules, "coverage"),
    excluded: new Set(
      enabled<ExcludeFromRotationParams>(rules, "exclude_from_rotation").map(
        (r) => r.employee_id,
      ),
    ),
    maxPer: enabled<MaxPerShiftDayParams>(rules, "max_per_shift_day"),
    leaveDays: new Map(),
    leaveCountsAsOff: false,
  };
}

/** 这条规则的例外里，这一天这种班匹配到的（几条都匹配取小的）；没有 = null。 */
export function exceptionMax(
  r: MaxPerShiftDayParams,
  date: string,
  type: string,
): number | null {
  let cap: number | null = null;
  for (const x of r.exceptions ?? []) {
    const shift = x.shift_type ?? r.shift_type;
    if (shift && shift !== type) continue;
    if (date < x.from || date > (x.to || x.from)) continue;
    cap = cap == null ? x.max : Math.min(cap, x.max);
  }
  return cap;
}

/**
 * 这一天这种班最多几人；没有规则管 = null。每条规则：这一天有例外就用例外的人数（题 3 A，盖过这条规则），
 * 没有就看这条规则管不管这一天；几条规则之间取最小（题 2 B）。
 */
function capFor(
  c: Compiled,
  date: string,
  day: DayIndex,
  type: string,
): number | null {
  let cap: number | null = null;
  for (const r of c.maxPer) {
    const ex = exceptionMax(r, date, type);
    let v: number | null = ex;
    if (v == null) {
      if (r.shift_type && r.shift_type !== type) continue;
      if (r.days && r.days.length && !r.days.includes(day)) continue;
      v = r.max;
    }
    cap = cap == null ? v : Math.min(cap, v);
  }
  return cap;
}

function dayOfDate(date: string): DayIndex {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as DayIndex;
}

/** 开着的规则里，这一天这种班最多几人（没有规则管 = null）。手动排班标超人数用（置顶 110 题 6）。 */
export function maxPeopleOn(
  rules: Rule[],
  date: string,
  type: string,
): number | null {
  return capFor(compile(rules), date, dayOfDate(date), type);
}

/**
 * 这一天生效的例外（排班表日期下灰字「max 2 today」用，题 7 A）：每种班一条，班次 null = 每种班。
 * 只看开着的规则。
 */
export function exceptionsOn(
  rules: Rule[],
  date: string,
): { shift_type: string | null; max: number }[] {
  const out = new Map<string, number>();
  for (const r of enabled<MaxPerShiftDayParams>(rules, "max_per_shift_day")) {
    for (const x of r.exceptions ?? []) {
      if (date < x.from || date > (x.to || x.from)) continue;
      const k = x.shift_type ?? r.shift_type ?? "";
      out.set(k, Math.min(out.get(k) ?? Infinity, x.max));
    }
  }
  return [...out].map(([k, max]) => ({ shift_type: k || null, max }));
}

/** 某种班「至少几天」这条规则管哪些人（三选一，见 MinDaysOnShiftParams）。 */
function minDaysTargets(
  c: Compiled,
  r: MinDaysOnShiftParams,
  emps: EngineEmployee[],
): EngineEmployee[] {
  if (r.employee_ids && r.employee_ids.length)
    return emps.filter((e) => r.employee_ids!.includes(e.id));
  if (r.employee_id != null) return emps.filter((e) => e.id === r.employee_id);
  const out = new Set(r.exclude_employee_ids ?? []);
  return emps.filter((e) => !c.excluded.has(e.id) && !out.has(e.id));
}

/** 这一天这种班有几个人。 */
function headcount(
  byEmployee: Record<number, DayShift[]>,
  emps: EngineEmployee[],
  day: number,
  type: string,
): number {
  let n = 0;
  for (const e of emps) if (byEmployee[e.id]?.[day]?.type === type) n++;
  return n;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * 一周里超了「每个班最多几人」的格子（手动排班标出来用，置顶 110 题 6；也是 Auto-fill 的判官）。
 * 返回 day + 班次 + 现在几人 + 最多几人。
 */
export function overCapacity(
  rules: Rule[],
  plan: WeekPlan,
  employees: EngineEmployee[],
): { day: DayIndex; type: string; count: number; max: number }[] {
  const c = compile(rules);
  if (!c.maxPer.length) return [];
  const out: { day: DayIndex; type: string; count: number; max: number }[] = [];
  for (let d = 0; d < 7; d++) {
    const types = new Set<string>();
    for (const e of employees) {
      const s = plan.byEmployee[e.id]?.[d];
      if (s) types.add(s.type);
    }
    for (const type of types) {
      const max = capFor(c, addDays(plan.weekStart, d), d as DayIndex, type);
      if (max == null) continue;
      const count = headcount(plan.byEmployee, employees, d, type);
      if (count > max) out.push({ day: d as DayIndex, type, count, max });
    }
  }
  return out;
}

/** 一个班几个小时：上班到下班整段算、不扣休息；下班不晚于上班按跨午夜（置顶 110 题 5）。 */
export function shiftHours(start: string, end: string): number {
  const h = hours(end) - hours(start);
  return h > 0 ? h : h + 24;
}

/** 开着的「每周超几小时提醒」取最小的那条；没有 = null。 */
export function weeklyHoursLimit(rules: Rule[]): number | null {
  const list = enabled<WeeklyHoursAlertParams>(rules, "weekly_hours_alert");
  return list.length ? Math.min(...list.map((r) => r.hours)) : null;
}

/** 这一周超过提醒小时数的人（按小时从多到少）；没有提醒规则 = []。PTO / Sick / Personal 不在班里，不算。 */
export function overHours(
  rules: Rule[],
  plan: WeekPlan,
  employees: EngineEmployee[],
): { employeeId: number; name: string; hours: number }[] {
  const limit = weeklyHoursLimit(rules);
  if (limit == null) return [];
  const out: { employeeId: number; name: string; hours: number }[] = [];
  for (const e of employees) {
    let h = 0;
    for (const s of plan.byEmployee[e.id] ?? [])
      if (s) h += shiftHours(s.start, s.end);
    if (h > limit)
      out.push({ employeeId: e.id, name: e.name, hours: roundHours(h) });
  }
  return out.sort((a, b) => b.hours - a.hours);
}

/** 小时数写法：42.5、42（不写多余的 .0）。 */
export function roundHours(h: number): number {
  return Math.round(h * 100) / 100;
}

function timesFor(c: Compiled, type: string, fallback: TimeRange): TimeRange {
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
  // 置顶 117：有 Leave 的人，目标天数照 Annie 选的算法扣。
  const leave = c.leaveDays.get(employeeId) ?? 0;
  if (target != null && leave > 0)
    target = c.leaveCountsAsOff
      ? Math.min(target, 7 - leave)
      : Math.max(0, target - leave);
  return target;
}

/** 置顶 118：这个人这种班每周最多几天（没有规则 = null；几条取小的）。 */
function maxDaysOn(
  c: Compiled,
  employeeId: number,
  type: string,
): number | null {
  let max: number | null = null;
  for (const r of c.maxDays) {
    if (r.shift_type !== type) continue;
    if (r.employee_ids?.length && !r.employee_ids.includes(employeeId))
      continue;
    if (r.exclude_employee_ids?.includes(employeeId)) continue;
    max = max == null ? r.n : Math.min(max, r.n);
  }
  return max;
}

/** 置顶 118：一周的班里，有没有哪种班超过「每周最多几天」。 */
function withinMaxDays(
  c: Compiled,
  employeeId: number,
  week: DayShift[],
): boolean {
  if (!c.maxDays.length) return true;
  const n = new Map<string, number>();
  for (const s of week) if (s) n.set(s.type, (n.get(s.type) ?? 0) + 1);
  for (const [type, k] of n) {
    const max = maxDaysOn(c, employeeId, type);
    if (max != null && k > max) return false;
  }
  return true;
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
        out.push(
          `${name(e.id)} works ${s.type} on day ${d} but a rule forbids it`,
        );
      }
      const before: DayShift = d === 0 ? prevLast : days[d - 1];
      if (!followOk(c, before, s)) {
        out.push(
          `${name(e.id)} day ${d}: not enough rest after the previous shift`,
        );
      }
    }
    if (!withinMaxDays(c, e.id, days)) {
      out.push(
        `${name(e.id)} works a shift type more days than "at most" allows`,
      );
    }
    const t = targetDays(c, e.id);
    const worked = days.filter(Boolean).length;
    const rule = c.perWeek.find(
      (r) => !r.employee_ids || r.employee_ids.includes(e.id),
    );
    if (rule && rule.mode === "exactly" && worked !== rule.n) {
      out.push(
        `${name(e.id)} works ${worked} days, rule says exactly ${rule.n}`,
      );
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
      if (cov.days && cov.days.length && !cov.days.includes(d as DayIndex))
        continue;
      const n = employees.filter(
        (e) => plan.byEmployee[e.id]?.[d]?.type === cov.shift_type,
      ).length;
      if (n < cov.min) {
        out.push(`day ${d}: ${cov.shift_type} has ${n}, needs ${cov.min}`);
      }
    }
  }
  for (const o of overCapacity(rules, plan, employees)) {
    out.push(`day ${o.day}: ${o.type} has ${o.count}, at most ${o.max}`);
  }
  return out;
}

// ───────────────────────── 排一周 ─────────────────────────

const WEEKDAYS: DayIndex[] = [0, 1, 2, 3, 4, 5, 6];

function emptyDays(): DayShift[] {
  return new Array(7).fill(null);
}

function countType(
  plans: WeekPlan[],
  employeeId: number,
  type: string,
): number {
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
  // 置顶 117：Leave 的天当作「这个人这天不能上任何班」，并记下天数给 Days per week 用。
  c.leaveCountsAsOff = input.leaveCountsAsOff ?? false;
  const onLeave = (id: number, d: number) =>
    !!input.leave?.[id]?.includes(d as DayIndex);
  for (const [id, ds] of Object.entries(input.leave ?? {})) {
    const uniq = [...new Set(ds)];
    if (!uniq.length) continue;
    c.cannot.push({ employee_id: Number(id), days: uniq });
    c.leaveDays.set(Number(id), uniq.length);
  }
  const rand = mulberry32(input.seed ?? 1);
  const problems: Problem[] = [];
  const history = [
    ...(input.history ?? []),
    ...(input.previous ? [input.previous] : []),
  ];
  const emps = input.employees;
  const byId = new Map(emps.map((e) => [e.id, e]));
  const typeOrder = collectTypes(c, input.rules);

  const days: Record<number, DayShift[]> = {};
  for (const e of emps) days[e.id] = emptyDays();
  const prevLast = (id: number): DayShift =>
    input.previous?.byEmployee[id]?.[6] ?? null;
  const dateOf = (d: number) => addDays(input.weekStart, d);
  const mk = (type: string, override?: Partial<TimeRange>): DayShift => {
    const t = timesFor(c, type, input.fallbackTimes);
    return {
      type,
      start: override?.start ?? t.start,
      end: override?.end ?? t.end,
    };
  };

  // 0) 已经排好、要保留的班
  if (input.locked) {
    for (const e of emps) {
      const lockedDays = input.locked.byEmployee[e.id];
      if (!lockedDays) continue;
      for (let d = 0; d < 7; d++) {
        const l = lockedDays[d];
        if (l) days[e.id][d] = { ...l };
      }
    }
  }

  // 1) 固定班（已经有保留的班的那天不动）
  for (const f of c.fixed) {
    if (!byId.has(f.employee_id)) continue;
    for (const d of f.days) {
      if (days[f.employee_id][d]) continue;
      // 置顶 117：固定班碰到 Leave 那天就不排（不算问题，结果里那格写 Leave）。
      if (onLeave(f.employee_id, d)) continue;
      days[f.employee_id][d] = mk(f.shift_type, { start: f.start, end: f.end });
    }
  }

  // 1b) 固定班 / 保留的班本身就超人数（置顶 110 题 2 A）：照排、写进预览，后面不再往这些格子加人。
  const baseOver = overCapacity(
    input.rules,
    { weekStart: input.weekStart, byEmployee: days },
    emps,
  );
  for (const o of baseOver) {
    problems.push({
      date: dateOf(o.day),
      message: `${DAY_SHORT[o.day]} ${o.type} has ${o.count}, at most ${o.max} (fixed or kept shifts).`,
    });
  }
  // 1c) 固定班 / 保留的班本身就超过每周天数（置顶 110 题 1）：固定班不动，写进预览。
  for (const e of emps) {
    const t = targetDays(c, e.id);
    const n = days[e.id].filter(Boolean).length;
    if (t != null && n > t) {
      problems.push({
        message: `${e.name}: fixed or kept shifts come to ${n} days, Days per week says at most ${t}.`,
      });
    }
  }
  /** 这一天这种班还能不能再加一个人（每个班最多几人）。 */
  const roomFor = (day: DayIndex, type: string) => {
    const cap = capFor(c, dateOf(day), day, type);
    return cap == null || headcount(days, emps, day, type) < cap;
  };

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
    const okFor = (
      e: EngineEmployee,
      slot: { day: DayIndex; shift_type: string },
    ) => {
      if (days[e.id][slot.day]) return false;
      if (!canWork(c, e.id, slot.day, slot.shift_type)) return false;
      // 置顶 118：这种班这周已经到「每周最多几天」。
      {
        const max = maxDaysOn(c, e.id, slot.shift_type);
        if (
          max != null &&
          days[e.id].filter((x) => x?.type === slot.shift_type).length >= max
        )
          return false;
      }
      // 置顶 110 ①：这个班这一天已经满了。
      if (!roomFor(slot.day, slot.shift_type)) return false;
      // 置顶 110 题 1 A：固定班 + 轮值超过每周天数 ⇒ 这周轮值跳过这个人，换下一位。
      const cap = targetDays(c, e.id);
      if (cap != null && days[e.id].filter(Boolean).length >= cap) return false;
      const t = timesFor(c, slot.shift_type, input.fallbackTimes);
      const before = slot.day === 0 ? prevLast(e.id) : days[e.id][slot.day - 1];
      if (!followOk(c, before, { type: slot.shift_type, start: t.start }))
        return false;
      const after = slot.day === 6 ? null : days[e.id][slot.day + 1];
      if (after && !followOk(c, mk(slot.shift_type), after)) return false;
      return true;
    };
    const weekendTotal = (e: EngineEmployee) =>
      slots.reduce(
        (n, sl) => n + countWeekendSlot(history, e.id, sl.day, sl.shift_type),
        0,
      );
    const cost = (
      e: EngineEmployee,
      idx: number,
      slot: { day: DayIndex; shift_type: string },
    ) => {
      const k = countWeekendSlot(history, e.id, slot.day, slot.shift_type);
      return (
        10 * k * k +
        weekendTotal(e) +
        ((idx + weekNo) % Math.max(1, pool.length)) * 0.001
      );
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
    const chosen: (EngineEmployee | null)[] =
      bestAssign ?? slots.map(() => null);
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
      for (let i = start; i < free.length; i++)
        choose(i + 1, [...picked, free[i]]);
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
    // 置顶 118：某种班每周最多几天。
    if (!withinMaxDays(c, id, p)) return false;
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
  // 固定班 / 保留的班本身已经超了的格子：罚分从那个人数算起（那是照排的，换不掉）。
  const baseCount = new Map<string, number>();
  for (const o of baseOver) baseCount.set(`${o.day}|${o.type}`, o.count);
  const score = (choice: Map<number, Pattern>): number => {
    let s = 0;
    // 每个班一天最多几人（硬，置顶 110 ①）
    if (c.maxPer.length) {
      for (const d of WEEKDAYS) {
        const per = new Map<string, number>();
        for (const e of emps) {
          const t = choice.get(e.id)?.[d]?.type;
          if (t) per.set(t, (per.get(t) ?? 0) + 1);
        }
        for (const [t, n] of per) {
          const cap = capFor(c, dateOf(d), d, t);
          if (cap == null) continue;
          const allowed = Math.max(cap, baseCount.get(`${d}|${t}`) ?? 0);
          if (n > allowed) s += 1000 * (n - allowed);
        }
      }
    }
    // 每天最少人数（硬）
    for (const cov of c.coverage) {
      for (const d of WEEKDAYS) {
        if (cov.days && cov.days.length && !cov.days.includes(d)) continue;
        let n = 0;
        for (const e of emps)
          if (choice.get(e.id)?.[d]?.type === cov.shift_type) n++;
        if (n < cov.min) s += 1000 * (cov.min - n);
      }
    }
    // 某种班至少几天（每周的当场算；每 4 周的按历史 + 这一周）
    for (const r of c.minDays) {
      const targets = minDaysTargets(c, r, emps);
      for (const e of targets) {
        const pat = choice.get(e.id)!;
        const thisWeek = pat.filter((x) => x && x.type === r.shift_type).length;
        const have =
          r.per === "week"
            ? thisWeek
            : thisWeek + countType(histWithPrev.slice(-3), e.id, r.shift_type);
        if (have < r.n) s += 200 * (r.n - have);
      }
    }
    // 公平：非固定的人，每种班次（含历史）排得一样多
    const flex = emps.filter(
      (e) => !c.excluded.has(e.id) && (need.get(e.id) ?? 0) > 0,
    );
    for (const type of types) {
      const counts = flex.map(
        (e) =>
          countType(histWithPrev, e.id, type) +
          choice.get(e.id)!.filter((x) => x && x.type === type).length,
      );
      if (counts.length) s += 5 * (Math.max(...counts) - Math.min(...counts));
    }
    // 每天人数别忽多忽少
    const heads = WEEKDAYS.map(
      (d) => emps.filter((e) => choice.get(e.id)?.[d]).length,
    );
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
  // 补排前每人已有的班（固定 / 保留 / 轮值）：严格遵守人数上限时只拿掉补排加的。
  const forcedDays = new Map(ids.map((id) => [id, days[id].slice()]));
  if (best) for (const id of ids) days[id] = best.get(id)!.slice();

  // 3b) 每个班最多几人：局部搜索还是超了（排不下）⇒ 拿掉补排加的那几个班，写进预览（Auto-fill 严格遵守，置顶 110 ①）。
  if (c.maxPer.length) {
    for (const d of WEEKDAYS) {
      const types = new Set<string>();
      for (const e of emps) {
        const t = days[e.id][d]?.type;
        if (t) types.add(t);
      }
      for (const t of types) {
        const cap = capFor(c, dateOf(d), d, t);
        if (cap == null) continue;
        const allowed = Math.max(cap, baseCount.get(`${d}|${t}`) ?? 0);
        let n = headcount(days, emps, d, t);
        for (const e of [...emps].reverse()) {
          if (n <= allowed) break;
          if (days[e.id][d]?.type !== t || forcedDays.get(e.id)?.[d]) continue;
          days[e.id][d] = null;
          n--;
          problems.push({
            date: dateOf(d),
            message: `${e.name}: no shift left on ${dateOf(d)}. Max people on a shift: ${t} allows ${cap} a day.`,
          });
        }
      }
    }
  }

  // 4) 剩下的问题：每天最少人数没排满
  for (const cov of c.coverage) {
    for (const d of WEEKDAYS) {
      if (cov.days && cov.days.length && !cov.days.includes(d)) continue;
      const n = emps.filter(
        (e) => days[e.id][d]?.type === cov.shift_type,
      ).length;
      if (n < cov.min) {
        problems.push({
          date: dateOf(d),
          message: `${dateOf(d)}: ${cov.shift_type} needs ${cov.min} but only ${n} can be placed without breaking a rule.`,
        });
      }
    }
  }
  for (const r of c.minDays) {
    const targets = minDaysTargets(c, r, emps);
    for (const e of targets) {
      const thisWeek = days[e.id].filter(
        (x) => x && x.type === r.shift_type,
      ).length;
      const have =
        r.per === "week"
          ? thisWeek
          : thisWeek + countType(histWithPrev.slice(-3), e.id, r.shift_type);
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
      if (s)
        shifts.push({
          employeeId: e.id,
          date: dateOf(d),
          type: s.type,
          start: s.start,
          end: s.end,
        });
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
  input: Omit<GenerateInput, "weekStart"> & {
    weekStart: string;
    weeks: number;
  },
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

// ───────────────────────── 按基础周排（Annie 2026-11-02「用上周的排班为基数，来自动排班，遵守定好的这些role」）─────────────────────────

/** 基础周里没照抄的一格和原因（预览里标「因为规则改了」）。 */
export interface BaseDrop {
  employeeId: number;
  day: DayIndex;
  reason: string;
}

/**
 * 拿基础周当底稿：每人每天照抄基础周的班，违反规则的那几格去掉，其余锁住（交给 `generateWeek` 的 `locked` 再按规则补排）。
 * - 这一周已经排好的班（`existing`，只填空格）原样保留、优先于基础周；
 * - 周末轮值管的那几个班不照抄（照抄就每周同一批人上周末），留给轮值排；
 * - 不照抄：不能上的日子 / 班（cannot_work）、跟固定班冲突（fixed_shift）、和前一天之间休息不够（min_rest / after_shift）、
 *   超出每周天数（days_per_week，从后往前去掉）。
 * 纯逻辑，不连接口。
 */
export function seedFromBase(input: {
  rules: Rule[];
  base: WeekPlan;
  weekStart: string;
  previous: WeekPlan | null;
  employees: EngineEmployee[];
  existing?: WeekPlan | null;
  /** 置顶 117：已批的 Leave（同 GenerateInput.leave）：这些天不照抄基础周。 */
  leave?: Record<number, DayIndex[]>;
  leaveCountsAsOff?: boolean;
}): { seed: WeekPlan; dropped: BaseDrop[] } {
  const c = compile(input.rules);
  c.leaveCountsAsOff = input.leaveCountsAsOff ?? false;
  for (const [id, ds] of Object.entries(input.leave ?? {}))
    if (ds.length) c.leaveDays.set(Number(id), new Set(ds).size);
  const onLeave = (id: number, d: number) =>
    !!input.leave?.[id]?.includes(d as DayIndex);
  const dropped: BaseDrop[] = [];
  const rotating = (d: number, type: string) =>
    c.rotation.some((r) =>
      r.slots.some((s) => s.day === d && s.shift_type === type),
    );
  const fixedOn = (id: number, d: number) =>
    c.fixed.find((f) => f.employee_id === id && f.days.includes(d as DayIndex));
  const byEmployee: Record<number, DayShift[]> = {};
  for (const e of input.employees) {
    const days = emptyDays();
    const have = input.existing?.byEmployee[e.id] ?? [];
    const base = input.base.byEmployee[e.id] ?? [];
    const copied: number[] = [];
    for (let d = 0; d < 7; d++) {
      if (have[d]) {
        days[d] = { ...have[d]! };
        continue;
      }
      const b = base[d];
      if (!b) continue;
      const day = d as DayIndex;
      const fixed = fixedOn(e.id, d);
      const before: DayShift =
        d === 0 ? (input.previous?.byEmployee[e.id]?.[6] ?? null) : days[d - 1];
      let reason = "";
      if (onLeave(e.id, d)) reason = "On leave";
      else if (rotating(d, b.type)) reason = "Weekend rotation";
      else if (!canWork(c, e.id, day, b.type)) reason = "Cannot work";
      else if (fixed && fixed.shift_type !== b.type) reason = "Fixed shift";
      else if (!followOk(c, before, b)) reason = "Rest between shifts";
      if (reason) {
        dropped.push({ employeeId: e.id, day, reason });
        continue;
      }
      days[d] = { ...b };
      copied.push(d);
    }
    const target = targetDays(c, e.id);
    if (target != null) {
      let over = days.filter(Boolean).length - target;
      for (let i = copied.length - 1; over > 0 && i >= 0; i--, over--) {
        days[copied[i]] = null;
        dropped.push({
          employeeId: e.id,
          day: copied[i] as DayIndex,
          reason: "Days per week",
        });
      }
    }
    byEmployee[e.id] = days;
  }
  return { seed: { weekStart: input.weekStart, byEmployee }, dropped };
}
