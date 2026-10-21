"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import type { DayIndex, Rule, RuleType } from "@/lib/schedule-engine";
import { cn } from "@/lib/utils";

import { DAY_LABELS, INPUT } from "./config";
import { TimePicker } from "./time-picker";
import {
  defaultParams,
  describeRule,
  newRuleId,
  RULE_TYPES,
  type DescribeContext,
} from "./rules";

type Params = Record<string, unknown>;

interface RuleDialogProps {
  ctx: DescribeContext;
  /** 有 = 改这一条；没有 = 加新的（先选类型）。 */
  initial?: Rule;
  onSave: (rule: Rule) => Promise<ActionResult>;
  onClose: () => void;
}

const SELECT = cn(INPUT, "w-full");

/** 加 / 改一条规则：选类型 → 填空（不用自由写字，系统才能照着排）。不走共用 Modal（这页永久深色）。 */
export function RuleDialog({ ctx, initial, onSave, onClose }: RuleDialogProps) {
  const titleId = useId();
  const pressedOnBackdropRef = useRef(false);
  const [type, setType] = useState<RuleType>(
    initial?.type ?? "weekend_rotation",
  );
  const [params, setParams] = useState<Params>(
    initial ? structuredClone(initial.params) : defaultParams(type, ctx),
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
      (type === "cannot_work" || type === "coverage") &&
      Array.isArray(out.days) &&
      (out.days as unknown[]).length === 0
    )
      delete out.days;
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

          <Fields type={type} params={params} set={set} ctx={ctx} />

          {preview ? (
            <p
              data-rule-preview
              className="rounded-[8px] border border-white/10 bg-white/[.04] px-3 py-2 text-[12.5px] text-white/90"
            >
              {preview}
            </p>
          ) : null}
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
}: {
  type: RuleType;
  params: Params;
  set: (patch: Params) => void;
  ctx: DescribeContext;
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
                className={cn(DARK_SECONDARY_BUTTON_CLASS, "w-fit")}
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
            <EmployeeSelect anyLabel="Everyone" />
          </Field>
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
  }
}
