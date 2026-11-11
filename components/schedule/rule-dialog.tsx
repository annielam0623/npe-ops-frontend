"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
  DARK_ADD_BUTTON_CLASS,
} from "@/components/ui/buttons";
import type { DayIndex, Rule, RuleType } from "@/lib/schedule-engine";
import { cn } from "@/lib/utils";

import { DAY_LABELS, INPUT } from "./config";
import { TimePicker } from "./time-picker";
import {
  defaultParams,
  describeRule,
  minDaysWho,
  newRuleId,
  RULE_TYPES,
  ruleConflicts,
  type DescribeContext,
} from "./rules";

type Params = Record<string, unknown>;

interface RuleDialogProps {
  ctx: DescribeContext;
  /** 别的规则（算「互相打架」用，置顶 110 题 8）；不传 = 不提示。 */
  others?: Rule[];
  /** 有 = 改这一条；没有 = 加新的（先选类型）。 */
  initial?: Rule;
  onSave: (rule: Rule) => Promise<ActionResult>;
  onClose: () => void;
}

const SELECT = cn(INPUT, "w-full");

/** 加 / 改一条规则：选类型 → 填空（不用自由写字，系统才能照着排）。不走共用 Modal（这页永久深色）。 */
export function RuleDialog({
  ctx,
  initial,
  others = [],
  onSave,
  onClose,
}: RuleDialogProps) {
  const titleId = useId();
  const pressedOnBackdropRef = useRef(false);
  const [type, setType] = useState<RuleType>(
    initial?.type ?? "weekend_rotation",
  );
  const [params, setParams] = useState<Params>(() => {
    if (!initial) return defaultParams(type, ctx);
    const p = structuredClone(initial.params);
    // 置顶 110 题 7：旧规则的 employee_id 打开时当成 Only these people，存的时候写 employee_ids。
    if (initial.type === "min_days_on_shift" && p.employee_id != null) {
      p.employee_ids = [p.employee_id as number];
      delete p.employee_id;
    }
    return p;
  });
  /** min_days_on_shift 的 Who：Everyone / Only these people / Everyone except。 */
  const [whoMode, setWhoMode] = useState<"everyone" | "only" | "except">(() =>
    initial?.type === "min_days_on_shift" ||
    initial?.type === "max_days_on_shift"
      ? minDaysWho(initial.params as never).mode
      : // 置顶 118：新加的 Maximum days 默认只给一个人（同 defaultParams）。
        initial
        ? "everyone"
        : type === "max_days_on_shift"
          ? "only"
          : "everyone",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [saving, onClose]);

  const set = (patch: Params) => setParams((p) => ({ ...p, ...patch }));
  const clean = (): Params => {
    const out: Params = { ...params };
    for (const k of Object.keys(out)) {
      if (out[k] === undefined || out[k] === "" || out[k] === null)
        delete out[k];
      if (
        Array.isArray(out[k]) &&
        (out[k] as unknown[]).length === 0 &&
        k !== "slots" &&
        k !== "days"
      )
        delete out[k];
    }
    if (
      (type === "cannot_work" ||
        type === "coverage" ||
        type === "max_per_shift_day") &&
      Array.isArray(out.days) &&
      (out.days as unknown[]).length === 0
    )
      delete out.days;
    if (type === "max_per_shift_day" && Array.isArray(out.exceptions)) {
      // 例外：to 跟 from 同一天 / 空就不带；班次空 = 跟这条规则（不带键）。
      out.exceptions = (out.exceptions as Record<string, unknown>[]).map(
        (x) => {
          const y: Record<string, unknown> = { from: x.from, max: x.max };
          if (x.to && x.to !== x.from) y.to = x.to;
          if (x.shift_type) y.shift_type = x.shift_type;
          return y;
        },
      );
    }
    if (type === "min_days_on_shift" || type === "max_days_on_shift") {
      // 三选一只带一个键；Everyone 什么都不带（后端拒 employee_ids: []，40 核过）。
      delete out.employee_id;
      if (whoMode !== "only") delete out.employee_ids;
      if (whoMode !== "except") delete out.exclude_employee_ids;
    }
    return out;
  };

  function validate(p: Params): string | null {
    if (type === "fixed_shift") {
      if (p.employee_id == null) return "Pick who this is for.";
      if (!Array.isArray(p.days) || p.days.length === 0)
        return "Pick at least one day.";
      if ((p.start && !p.end) || (!p.start && p.end))
        return "Fill both start and end time, or leave both empty.";
    }
    if (
      type === "weekend_rotation" &&
      (!Array.isArray(p.slots) || p.slots.length === 0)
    ) {
      return "Add at least one weekend shift.";
    }
    if (
      type === "cannot_work" &&
      !p.shift_type &&
      !(Array.isArray(p.days) && p.days.length)
    ) {
      return "Pick at least one day or a shift.";
    }
    if (type === "exclude_from_rotation" && p.employee_id == null)
      return "Pick who this is for.";
    if (type === "shift_times" && (!p.start || !p.end))
      return "Fill start and end time.";
    if (
      (type === "min_days_on_shift" || type === "max_days_on_shift") &&
      whoMode !== "everyone" &&
      !(
        Array.isArray(
          whoMode === "only" ? p.employee_ids : p.exclude_employee_ids,
        ) &&
        (
          (whoMode === "only"
            ? p.employee_ids
            : p.exclude_employee_ids) as unknown[]
        ).length
      )
    )
      return "Pick at least one person.";
    if (type === "max_per_shift_day" && Array.isArray(p.exceptions)) {
      const list = p.exceptions as {
        from?: string;
        to?: string;
        max?: number;
      }[];
      for (let i = 0; i < list.length; i++) {
        const x = list[i];
        if (!x.from) return `Exception ${i + 1}: pick the date.`;
        if (x.to && x.to < x.from)
          return `Exception ${i + 1}: the end date is before the start date.`;
        if (
          typeof x.max !== "number" ||
          !Number.isInteger(x.max) ||
          x.max < 1 ||
          x.max > 20
        )
          return `Exception ${i + 1}: at most must be a whole number from 1 to 20.`;
      }
    }
    if (
      type === "max_per_shift_day" &&
      (typeof p.max !== "number" ||
        !Number.isInteger(p.max) ||
        p.max < 1 ||
        p.max > 20)
    )
      return "At most must be a whole number from 1 to 20.";
    if (
      type === "weekly_hours_alert" &&
      (typeof p.hours !== "number" || p.hours < 1 || p.hours > 80)
    )
      return "Hours must be a number from 1 to 80.";
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const p = clean();
    const problem = validate(p);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave({
      id: initial?.id ?? newRuleId(),
      type,
      enabled: initial?.enabled ?? true,
      params: p,
    });
    if (result.status === "error") {
      setError(result.message);
      setSaving(false);
    }
  }

  const preview = (() => {
    try {
      return describeRule({ type, enabled: true, params: clean() }, ctx);
    } catch {
      return "";
    }
  })();
  // 置顶 110 题 8 A：存之前就提示这条会跟哪条打架（不拦）。
  const conflictText = (() => {
    const id = initial?.id ?? "__new__";
    const list = [
      ...others.filter((r) => r.id !== initial?.id),
      { id, type, enabled: initial?.enabled ?? true, params: clean() },
    ];
    try {
      return ruleConflicts(list, ctx).get(id) ?? [];
    } catch {
      return [];
    }
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        pressedOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (
          pressedOnBackdropRef.current &&
          event.target === event.currentTarget &&
          !saving
        ) {
          onClose();
        }
        pressedOnBackdropRef.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-[520px] overflow-y-auto rounded-xl border border-white/10 bg-[#0d1b2e] p-5 text-white/90 shadow-[0_8px_40px_rgba(0,0,0,.45)]"
      >
        <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
          <h2 id={titleId} className="text-[16px] font-semibold text-white">
            {initial ? "Edit rule" : "Add rule"}
          </h2>

          {initial ? (
            <p className="text-[13px] font-semibold text-white">
              {RULE_TYPES.find((t) => t.type === type)?.label}
            </p>
          ) : (
            <Field label="Type">
              <select
                aria-label="Rule type"
                value={type}
                onChange={(e) => {
                  const next = e.target.value as RuleType;
                  setType(next);
                  setParams(defaultParams(next, ctx));
                  setError(null);
                }}
                className={SELECT}
              >
                {/* 班次时间现在在页面上方「Default shift times」里设（后端正式来源，superadmin 改），这里不再新增，避免两处各填一遍。 */}
                {RULE_TYPES.filter((t) => t.type !== "shift_times").map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.label} — {t.hint}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Fields
            type={type}
            params={params}
            set={set}
            ctx={ctx}
            whoMode={whoMode}
            setWhoMode={setWhoMode}
          />

          {preview ? (
            <p
              data-rule-preview
              className="rounded-[8px] border border-white/10 bg-white/[.04] px-3 py-2 text-[12.5px] text-white/90"
            >
              {preview}
            </p>
          ) : null}
          {conflictText.map((t) => (
            <p
              key={t}
              data-rule-dialog-conflict
              className="text-[12.5px] text-[#fcd34d]"
            >
              {t}
            </p>
          ))}
          {error ? (
            <p role="alert" className="text-[12.5px] text-red-300">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className={DARK_SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className={DARK_PRIMARY_BUTTON_CLASS}
            >
              {saving ? "Saving…" : "Save rule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-white/75">{label}</span>
      {children}
    </div>
  );
}

function Fields({
  type,
  params,
  set,
  ctx,
  whoMode,
  setWhoMode,
}: {
  type: RuleType;
  params: Params;
  set: (patch: Params) => void;
  ctx: DescribeContext;
  whoMode: "everyone" | "only" | "except";
  setWhoMode: (m: "everyone" | "only" | "except") => void;
}) {
  const active = ctx.employees.filter((e) => e.is_active);
  const shifts = ctx.shiftTypes.filter((t) => t.is_active);
  const EmployeeSelect = ({ anyLabel }: { anyLabel?: string }) => (
    <select
      aria-label="Employee"
      value={params.employee_id == null ? "" : String(params.employee_id)}
      onChange={(e) =>
        set({
          employee_id:
            e.target.value === "" ? undefined : Number(e.target.value),
        })
      }
      className={SELECT}
    >
      {anyLabel ? (
        <option value="">{anyLabel}</option>
      ) : (
        <option value="" disabled>
          Pick someone
        </option>
      )}
      {active.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
        </option>
      ))}
    </select>
  );
  const ShiftSelect = ({
    field,
    anyLabel,
  }: {
    field: string;
    anyLabel?: string;
  }) => (
    <select
      aria-label="Shift"
      value={(params[field] as string | undefined) ?? ""}
      onChange={(e) =>
        set({ [field]: e.target.value === "" ? undefined : e.target.value })
      }
      className={SELECT}
    >
      {anyLabel ? <option value="">{anyLabel}</option> : null}
      {shifts.map((t) => (
        <option key={t.key} value={t.key}>
          {t.label}
        </option>
      ))}
    </select>
  );
  const Days = ({ field }: { field: string }) => {
    const days = (params[field] as DayIndex[] | undefined) ?? [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {DAY_LABELS.map((d, i) => (
          <button
            key={d}
            type="button"
            aria-pressed={days.includes(i as DayIndex)}
            onClick={() =>
              set({
                [field]: days.includes(i as DayIndex)
                  ? days.filter((x) => x !== i)
                  : [...days, i].sort(),
              })
            }
            className={cn(
              "cursor-pointer rounded-[6px] border px-2.5 py-1 text-[12px] font-bold",
              days.includes(i as DayIndex)
                ? "border-sky-400/60 bg-sky-400/20 text-sky-200"
                : "border-white/20 text-white/70 hover:border-white/40",
            )}
          >
            {d}
          </button>
        ))}
      </div>
    );
  };
  const People = ({ field }: { field: string }) => {
    const ids = (params[field] as number[] | undefined) ?? [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {active.map((e) => (
          <button
            key={e.id}
            type="button"
            aria-pressed={ids.includes(e.id)}
            onClick={() =>
              set({
                [field]: ids.includes(e.id)
                  ? ids.filter((x) => x !== e.id)
                  : [...ids, e.id],
              })
            }
            className={cn(
              "cursor-pointer rounded-[6px] border px-2.5 py-1 text-[12px] font-bold",
              ids.includes(e.id)
                ? "border-sky-400/60 bg-sky-400/20 text-sky-200"
                : "border-white/20 text-white/70 hover:border-white/40",
            )}
          >
            {e.name}
          </button>
        ))}
      </div>
    );
  };
  const num = (field: string, min: number, max: number) => (
    <input
      aria-label={field}
      type="number"
      min={min}
      max={max}
      value={(params[field] as number | undefined) ?? ""}
      onChange={(e) =>
        set({
          [field]: e.target.value === "" ? undefined : Number(e.target.value),
        })
      }
      className={cn(INPUT, "w-[110px]")}
    />
  );
  const time = (field: string, label: string) => (
    <label className="flex flex-col gap-1 text-[12px] font-medium text-white/75">
      {label}
      <TimePicker
        ariaLabel={label}
        allowEmpty
        value={(params[field] as string | undefined) ?? ""}
        onChange={(v) => set({ [field]: v || undefined })}
        className="w-[132px]"
      />
    </label>
  );

  switch (type) {
    case "shift_times":
      return (
        <>
          <Field label="Shift">
            <ShiftSelect field="shift_type" />
          </Field>
          <div className="flex gap-2.5">
            {time("start", "Start")}
            {time("end", "End")}
          </div>
        </>
      );
    case "fixed_shift":
      return (
        <>
          <Field label="Who">
            <EmployeeSelect />
          </Field>
          <Field label="Days">
            <Days field="days" />
          </Field>
          <Field label="Shift">
            <ShiftSelect field="shift_type" />
          </Field>
          <div className="flex gap-2.5">
            {time("start", "Start (optional)")}
            {time("end", "End (optional)")}
          </div>
        </>
      );
    case "weekend_rotation": {
      const slots =
        (params.slots as { day: number; shift_type: string }[] | undefined) ??
        [];
      return (
        <>
          <Field label="Weekend shifts to hand out">
            <div className="flex flex-col gap-1.5">
              {slots.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2"
                  data-rotation-slot
                >
                  <select
                    aria-label="Day"
                    value={s.day}
                    onChange={(e) =>
                      set({
                        slots: slots.map((x, j) =>
                          j === i ? { ...x, day: Number(e.target.value) } : x,
                        ),
                      })
                    }
                    className={cn(INPUT, "w-[90px]")}
                  >
                    {DAY_LABELS.map((d, di) => (
                      <option key={d} value={di}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Shift"
                    value={s.shift_type}
                    onChange={(e) =>
                      set({
                        slots: slots.map((x, j) =>
                          j === i ? { ...x, shift_type: e.target.value } : x,
                        ),
                      })
                    }
                    className={cn(INPUT, "w-[120px]")}
                  >
                    {shifts.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label="Remove shift"
                    onClick={() =>
                      set({ slots: slots.filter((_, j) => j !== i) })
                    }
                    className="cursor-pointer rounded px-2 text-[15px] text-white/70 hover:bg-red-500/20 hover:text-red-200"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  set({
                    slots: [
                      ...slots,
                      { day: 6, shift_type: shifts[0]?.key ?? "open" },
                    ],
                  })
                }
                className={cn(DARK_ADD_BUTTON_CLASS, "w-fit")}
              >
                + Add shift
              </button>
            </div>
          </Field>
          <Field label="Who takes turns (none picked = everyone)">
            <People field="employee_ids" />
          </Field>
          <label className="flex items-center gap-2 text-[12.5px] text-white/85">
            <input
              type="checkbox"
              checked={params.exclusive !== false}
              onChange={(e) =>
                set({ exclusive: e.target.checked ? undefined : false })
              }
            />
            Nobody else is scheduled on those days
          </label>
        </>
      );
    }
    case "cannot_work":
      return (
        <>
          <Field label="Who">
            <EmployeeSelect anyLabel="Everyone" />
          </Field>
          <Field label="Days (none picked = any day)">
            <Days field="days" />
          </Field>
          <Field label="Shift">
            <ShiftSelect field="shift_type" anyLabel="Any shift" />
          </Field>
        </>
      );
    case "days_per_week":
      return (
        <>
          <Field label="Rule">
            <select
              aria-label="Mode"
              value={(params.mode as string) ?? "exactly"}
              onChange={(e) => set({ mode: e.target.value })}
              className={SELECT}
            >
              <option value="exactly">Exactly</option>
              <option value="max">At most</option>
            </select>
          </Field>
          <Field label="Days a week">{num("n", 1, 7)}</Field>
          <Field label="Who (none picked = everyone)">
            <People field="employee_ids" />
          </Field>
        </>
      );
    case "min_days_on_shift":
      return (
        <>
          <Field label="Who">
            <select
              aria-label="Who"
              value={whoMode}
              onChange={(e) =>
                setWhoMode(e.target.value as "everyone" | "only" | "except")
              }
              className={SELECT}
            >
              <option value="everyone">Everyone</option>
              <option value="only">Only these people</option>
              <option value="except">Everyone except</option>
            </select>
          </Field>
          {whoMode === "only" ? (
            <Field label="These people">
              <People field="employee_ids" />
            </Field>
          ) : whoMode === "except" ? (
            <Field label="Leave out">
              <People field="exclude_employee_ids" />
            </Field>
          ) : null}
          <Field label="Shift">
            <ShiftSelect field="shift_type" />
          </Field>
          <Field label="At least (days)">{num("n", 1, 28)}</Field>
          <Field label="Per">
            <select
              aria-label="Per"
              value={(params.per as string) ?? "week"}
              onChange={(e) => set({ per: e.target.value })}
              className={SELECT}
            >
              <option value="week">Week</option>
              <option value="4weeks">4 weeks</option>
            </select>
          </Field>
        </>
      );
    case "max_days_on_shift":
      return (
        <>
          <Field label="Who">
            <select
              aria-label="Who"
              value={whoMode}
              onChange={(e) =>
                setWhoMode(e.target.value as "everyone" | "only" | "except")
              }
              className={SELECT}
            >
              <option value="everyone">Everyone</option>
              <option value="only">Only these people</option>
              <option value="except">Everyone except</option>
            </select>
          </Field>
          {whoMode === "only" ? (
            <Field label="These people">
              <People field="employee_ids" />
            </Field>
          ) : whoMode === "except" ? (
            <Field label="Leave out">
              <People field="exclude_employee_ids" />
            </Field>
          ) : null}
          <Field label="Shift">
            <ShiftSelect field="shift_type" />
          </Field>
          <Field label="At most (days a week)">{num("n", 0, 7)}</Field>
        </>
      );
    case "min_rest":
      return (
        <Field label="Hours between two shifts">{num("hours", 0, 24)}</Field>
      );
    case "after_shift":
      return (
        <>
          <Field label="If someone worked">
            <ShiftSelect field="if_worked" />
          </Field>
          <Field label="Then the next day they cannot work">
            <ShiftSelect field="then_cannot" />
          </Field>
        </>
      );
    case "coverage":
      return (
        <>
          <Field label="Shift">
            <ShiftSelect field="shift_type" />
          </Field>
          <Field label="At least (people)">{num("min", 1, 20)}</Field>
          <Field label="Days (none picked = every day)">
            <Days field="days" />
          </Field>
        </>
      );
    case "exclude_from_rotation":
      return (
        <Field label="Who">
          <EmployeeSelect />
        </Field>
      );
    case "max_per_shift_day":
      return (
        <>
          <Field label="Shift">
            <ShiftSelect field="shift_type" anyLabel="Every shift" />
          </Field>
          <Field label="At most (people)">{num("max", 1, 20)}</Field>
          <Field label="Days (none picked = every day)">
            <Days field="days" />
          </Field>
          <Exceptions params={params} set={set} shifts={shifts} />
        </>
      );
    case "weekly_hours_alert":
      return (
        <Field label="Alert when someone is over (hours a week)">
          {num("hours", 1, 80)}
        </Field>
      );
  }
}

type ExceptionDraft = {
  from?: string;
  to?: string;
  max?: number;
  shift_type?: string;
};

/**
 * Max people 的例外（置顶 110 续，Annie「4C」：这里和 Schedule 标签点日期都能加，同一份数据）：
 * 班次（不选 = 跟这条规则）+ 起止日期（结束不填 = 同一天）+ 最多几人。按 Save rule 才存。
 */
function Exceptions({
  params,
  set,
  shifts,
}: {
  params: Params;
  set: (patch: Params) => void;
  shifts: { key: string; label: string }[];
}) {
  const list = (params.exceptions as ExceptionDraft[] | undefined) ?? [];
  const put = (i: number, patch: ExceptionDraft) =>
    set({
      exceptions: list.map((x, j) => (j === i ? { ...x, ...patch } : x)),
    });
  const same = params.shift_type
    ? (shifts.find((t) => t.key === params.shift_type)?.label ??
      String(params.shift_type))
    : "Every shift";
  return (
    <Field label="Exceptions (these dates use their own number)">
      <div className="flex flex-col gap-1.5">
        {list.map((x, i) => (
          <div
            key={i}
            data-exception-row={i}
            className="flex flex-wrap items-center gap-1.5"
          >
            <select
              aria-label="Exception shift"
              value={x.shift_type ?? ""}
              onChange={(e) =>
                put(i, { shift_type: e.target.value || undefined })
              }
              className={cn(INPUT, "w-[120px]")}
            >
              <option value="">{same}</option>
              {params.shift_type
                ? null
                : shifts.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
            </select>
            <input
              type="date"
              aria-label="Exception from"
              value={x.from ?? ""}
              onChange={(e) => put(i, { from: e.target.value || undefined })}
              className={cn(INPUT, "w-[140px]")}
            />
            <span className="text-[12px] text-white/60">to</span>
            <input
              type="date"
              aria-label="Exception to"
              value={x.to ?? ""}
              onChange={(e) => put(i, { to: e.target.value || undefined })}
              className={cn(INPUT, "w-[140px]")}
            />
            <span className="text-[12px] text-white/60">at most</span>
            <input
              type="number"
              aria-label="Exception max"
              min={1}
              max={20}
              value={x.max ?? ""}
              onChange={(e) =>
                put(i, {
                  max:
                    e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
              className={cn(INPUT, "w-[64px]")}
            />
            <button
              type="button"
              aria-label="Remove exception"
              onClick={() =>
                set({ exceptions: list.filter((_, j) => j !== i) })
              }
              className="cursor-pointer rounded px-2 text-[15px] text-white/70 hover:bg-red-500/20 hover:text-red-200"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => set({ exceptions: [...list, { max: 2 }] })}
          className={cn(DARK_ADD_BUTTON_CLASS, "w-fit")}
        >
          + Add exception
        </button>
        <span className="text-[11.5px] text-white/55">
          Leave the end date empty for one day.
        </span>
      </div>
    </Field>
  );
}
