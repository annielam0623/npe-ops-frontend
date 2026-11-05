"use client";

import { useEffect, useRef, useState } from "react";

import type { Rule } from "@/lib/schedule-engine";
import {
  defaultShiftColor,
  isShiftColor,
  SHIFT_COLOR_NAME,
  SHIFT_COLORS,
  SHIFT_SWATCH,
  type ShiftColor,
} from "@/lib/schedule-shift-colors";
import { cn } from "@/lib/utils";
import type { ScheduleShiftType } from "@/types";

import {
  describeRule,
  type DescribeContext,
  enabledRulesUsingShift,
  RULE_TYPES,
} from "./rules";
import { TimePicker } from "./time-picker";

/**
 * ⚙ Settings › Shift types（Annie 2026-11-04「排班这个全部同意推荐，动手吧」，置顶 85，preview v4
 * https://claude.ai/artifact/9LFRCau1uBg5sQ5aPbdSZt ①）：每种一行 ⋮⋮ 排序 / 色块 / 名字（可改名）/ 默认时间 / Active，
 * 底下灰绿「+ Add shift type」。全部先暂存在弹窗里，按弹窗底下的蓝色 Save 一起存（settings-dialog.tsx）。
 * 后端没有删除（已排的班还用着），停用 = 不要了。
 */
export interface ShiftTypeRow {
  /** 页面上的身份：已有的 = key，新加的 = new-N。 */
  id: string;
  /** null = 新加的、还没存。 */
  key: string | null;
  label: string;
  color: ShiftColor;
  start: string;
  end: string;
  active: boolean;
}

export function savedColorOf(t: ScheduleShiftType): ShiftColor {
  return isShiftColor(t.color) ? t.color : defaultShiftColor(t.key);
}

export function rowsOf(types: ScheduleShiftType[]): ShiftTypeRow[] {
  return types.map((t) => ({
    id: t.key,
    key: t.key,
    label: t.label,
    color: savedColorOf(t),
    start: t.default_start_time ?? "",
    end: t.default_end_time ?? "",
    active: t.is_active,
  }));
}

/** 顺序变了没有：已有的几种前后变了，或者新加的被拖到了已有的前面。 */
export function orderChanged(
  rows: ShiftTypeRow[],
  types: ScheduleShiftType[],
): boolean {
  const existing = rows.filter((r) => r.key).map((r) => r.key);
  if (JSON.stringify(existing) !== JSON.stringify(types.map((t) => t.key)))
    return true;
  const firstNew = rows.findIndex((r) => !r.key);
  return firstNew >= 0 && rows.slice(firstNew).some((r) => r.key);
}

/**
 * 每行要存的 sort_order：顺序变了就整份按 10、20、30… 重排；没变就已有的照旧、新加的接在最后。
 */
export function sortOrders(
  rows: ShiftTypeRow[],
  types: ScheduleShiftType[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (orderChanged(rows, types)) {
    rows.forEach((r, i) => out.set(r.id, (i + 1) * 10));
    return out;
  }
  const byKey = new Map(types.map((t) => [t.key, t]));
  let next = Math.max(0, ...types.map((t) => t.sort_order)) + 10;
  for (const r of rows) {
    const saved = r.key ? byKey.get(r.key) : undefined;
    if (saved) out.set(r.id, saved.sort_order);
    else {
      out.set(r.id, next);
      next += 10;
    }
  }
  return out;
}

/** 这一行跟库里比改了什么（新加的不算，单独写「added」）。 */
export function rowChanges(row: ShiftTypeRow, saved: ScheduleShiftType) {
  return {
    renamed: row.label.trim() !== saved.label,
    color: row.color !== savedColorOf(saved),
    times:
      row.start !== (saved.default_start_time ?? "") ||
      row.end !== (saved.default_end_time ?? ""),
    active: row.active !== saved.is_active,
  };
}

/** 页脚黄字「Not saved yet: …」里班次类型那几句。 */
export function unsavedShiftTypeParts(
  rows: ShiftTypeRow[],
  types: ScheduleShiftType[],
): string[] {
  const byKey = new Map(types.map((t) => [t.key, t]));
  const parts: string[] = [];
  const times: string[] = [];
  for (const r of rows) {
    const saved = r.key ? byKey.get(r.key) : undefined;
    if (!saved) {
      parts.push(
        r.label.trim()
          ? `new shift type ${r.label.trim()} added`
          : "new shift type added",
      );
      continue;
    }
    const c = rowChanges(r, saved);
    if (c.renamed) parts.push(`${saved.label} renamed`);
    if (c.color) parts.push(`colour for ${saved.label} changed`);
    if (c.active)
      parts.push(`${saved.label} turned ${r.active ? "on" : "off"}`);
    if (c.times) times.push(saved.label);
  }
  if (times.length) parts.push(`default times for ${times.join(", ")} changed`);
  if (orderChanged(rows, types)) parts.push("order of shift types changed");
  return parts;
}

/** 按 Save 前先在页面上查（preview Q3 的两句红字 + 默认时间只填一个）。返回 [行 id, 红字]。 */
export function validateShiftTypes(
  rows: ShiftTypeRow[],
  types: ScheduleShiftType[],
): [string, string][] {
  const byKey = new Map(types.map((t) => [t.key, t]));
  const errors: [string, string][] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const name = r.label.trim();
    if (!name) {
      const saved = r.key ? byKey.get(r.key) : undefined;
      errors.push([
        r.id,
        saved
          ? `Enter a name for the shift type that was “${saved.label}”.`
          : "Enter a name for the new shift type.",
      ]);
      continue;
    }
    const low = name.toLowerCase();
    if (seen.has(low))
      errors.push([r.id, `There is already a shift type called “${name}”.`]);
    seen.add(low);
    if (!!r.start !== !!r.end)
      errors.push([
        r.id,
        `Enter both default times for ${name}, or leave both empty.`,
      ]);
  }
  return errors;
}

/** 停用了、但还有开着的规则用它（Auto-fill 照规则还会排）：黄字提醒。 */
function inactiveRuleNotes(
  rows: ShiftTypeRow[],
  rules: Rule[] | null,
  ctx: DescribeContext,
): { id: string; text: string }[] {
  if (!rules) return [];
  return rows
    .filter((r) => r.key && !r.active)
    .map((r) => {
      const used = enabledRulesUsingShift(rules, r.key!);
      if (!used.length) return null;
      const list = used
        .map(
          (rule) =>
            `${RULE_TYPES.find((t) => t.type === rule.type)?.label ?? rule.type}: ${describeRule(rule, ctx)}`,
        )
        .join("; ");
      const name = r.label.trim() || r.key!;
      return {
        id: r.id,
        text: `${name} is still used by ${used.length} rule${used.length === 1 ? "" : "s"} (${list}). Auto-fill keeps using it until you change ${used.length === 1 ? "that rule" : "those rules"} in Rules.`,
      };
    })
    .filter((x): x is { id: string; text: string } => x !== null);
}

/** 灰绿 Add（点了只是先加在弹窗里，按 Save 才存；全站规矩 #6b8e74）。 */
const ADD_CLASS =
  "mt-2 cursor-pointer rounded-[7px] border border-[#6b8e74] bg-[#6b8e74] px-3 py-[5px] text-[12.5px] font-semibold text-white hover:bg-[#5d7d66]";

export function ShiftTypesEditor({
  rows,
  setRows,
  types,
  showTimes,
  canPickColor,
  rules,
  ruleCtx,
  errorIds,
}: {
  rows: ShiftTypeRow[];
  setRows: (update: (rows: ShiftTypeRow[]) => ShiftTypeRow[]) => void;
  types: ScheduleShiftType[];
  /** 后端带默认时间（二期）才出时间那两格。 */
  showTimes: boolean;
  /** 后端 settings 的 shift_types 带 color 键（= 能存颜色）才出 8 色小窗；没带只显示默认色。 */
  canPickColor: boolean;
  rules: Rule[] | null;
  ruleCtx: DescribeContext;
  /** 按 Save 时没过页面检查的行：名字框标红。 */
  errorIds: Set<string>;
}) {
  const byKey = new Map(types.map((t) => [t.key, t]));
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(
    null,
  );
  const nextNewRef = useRef(1);
  const focusRef = useRef<string | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // 选色小窗：点外面收起。
  useEffect(() => {
    if (!colorFor) return;
    const close = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node))
        setColorFor(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [colorFor]);

  // 刚加的那一行：名字框拿焦点。
  useEffect(() => {
    if (!focusRef.current) return;
    const el = document.querySelector<HTMLInputElement>(
      `[data-shift-type-row="${focusRef.current}"] input[data-shift-type-name]`,
    );
    focusRef.current = null;
    el?.focus();
  });

  const patch = (id: string, p: Partial<ShiftTypeRow>) =>
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const move = (id: string, toId: string, after: boolean) =>
    setRows((cur) => {
      if (id === toId) return cur;
      const moving = cur.find((r) => r.id === id);
      if (!moving) return cur;
      const rest = cur.filter((r) => r.id !== id);
      const at = rest.findIndex((r) => r.id === toId);
      if (at < 0) return cur;
      rest.splice(after ? at + 1 : at, 0, moving);
      return rest;
    });

  const step = (id: string, delta: -1 | 1) =>
    setRows((cur) => {
      const i = cur.findIndex((r) => r.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const out = [...cur];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });

  function add() {
    const id = `new-${nextNewRef.current++}`;
    // 新的一行先给一个还没人用的颜色（灰白留到最后）。
    // 后端还不存颜色时一律灰白（存不住就不先给一种颜色，免得看着像选好了）。
    const used = new Set(rows.map((r) => r.color));
    const color = canPickColor
      ? (SHIFT_COLORS.find((c) => c !== "grey" && !used.has(c)) ?? "grey")
      : "grey";
    focusRef.current = id;
    setRows((cur) => [
      ...cur,
      { id, key: null, label: "", color, start: "", end: "", active: true },
    ]);
  }

  const notes = inactiveRuleNotes(rows, rules, ruleCtx);

  return (
    <div data-shift-types>
      <div
        className="flex items-center gap-2 text-[11px] text-white/50"
        aria-hidden
      >
        <span className="w-[18px]" />
        <span className="w-[22px]" />
        <span className="min-w-[90px] flex-1">Name</span>
        {showTimes ? (
          <span className="w-[198px] max-sm:hidden">Default time</span>
        ) : null}
        <span className="w-[44px] text-center">Active</span>
      </div>
      <div className="mt-1 flex flex-col gap-1.5">
        {rows.map((r) => {
          const saved = r.key ? byKey.get(r.key) : undefined;
          const renamed = !!saved && r.label.trim() !== saved.label;
          const nameFor = saved?.label ?? (r.label.trim() || "New shift type");
          return (
            <div
              key={r.id}
              data-shift-type-row={r.id}
              data-new={!saved || undefined}
              data-inactive={!r.active || undefined}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                const box = e.currentTarget.getBoundingClientRect();
                setDropAt({
                  id: r.id,
                  after: e.clientY > box.top + box.height / 2,
                });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dropAt) move(dragId, dropAt.id, dropAt.after);
                setDragId(null);
                setDropAt(null);
              }}
              className={cn(
                "relative flex flex-wrap items-center gap-2 rounded-[6px] text-[13px]",
                dragId === r.id && "opacity-40",
                dropAt?.id === r.id &&
                  dragId !== r.id &&
                  (dropAt.after
                    ? "shadow-[0_2px_0_0_#38bdf8]"
                    : "shadow-[0_-2px_0_0_#38bdf8]"),
              )}
            >
              <span
                role="button"
                tabIndex={0}
                draggable
                data-shift-type-grip
                aria-label={`Move ${nameFor}. Use the up and down arrow keys.`}
                title="Drag to change the order"
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/x-shift-type", r.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragId(r.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDropAt(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    step(r.id, e.key === "ArrowUp" ? -1 : 1);
                  }
                }}
                className={cn(
                  "w-[18px] cursor-grab text-center text-[13px] text-white/35 select-none hover:text-white/70",
                  !r.active && "opacity-50",
                )}
              >
                ⋮⋮
              </span>
              <span className="relative">
                {canPickColor ? null : (
                  // 后端还没存颜色（settings 没带 color 键，2c 2026-11-04）：只显示按 key 的默认色，不给挑。
                  <span
                    data-shift-type-color={r.color}
                    data-color-fixed
                    style={{ background: SHIFT_SWATCH[r.color] }}
                    className={cn(
                      "block h-[20px] w-[20px] rounded-[6px] border border-white/30",
                      !r.active && "opacity-50",
                    )}
                  />
                )}
                {canPickColor ? (
                  <button
                    type="button"
                    data-shift-type-color={r.color}
                    aria-label={`Colour for ${nameFor}: ${SHIFT_COLOR_NAME[r.color]}`}
                    aria-expanded={colorFor === r.id}
                    onClick={() =>
                      setColorFor((cur) => (cur === r.id ? null : r.id))
                    }
                    style={{ background: SHIFT_SWATCH[r.color] }}
                    className={cn(
                      "block h-[20px] w-[20px] cursor-pointer rounded-[6px] border border-white/30",
                      saved &&
                        r.color !== savedColorOf(saved) &&
                        "ring-2 ring-amber-400",
                      !r.active && "opacity-50",
                    )}
                  />
                ) : null}
                {canPickColor && colorFor === r.id ? (
                  <div
                    ref={popRef}
                    data-shift-color-pop
                    className="absolute top-[26px] left-0 z-10 grid grid-cols-[repeat(4,22px)] gap-1.5 rounded-[8px] border border-white/25 bg-[#0b1727] p-2 shadow-[0_6px_20px_rgba(0,0,0,.5)]"
                  >
                    <span className="col-span-4 text-[10.5px] whitespace-nowrap text-white/60">
                      Colour for {r.label.trim() || "the new shift type"}
                    </span>
                    {SHIFT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        data-pick-color={c}
                        aria-label={SHIFT_COLOR_NAME[c]}
                        title={SHIFT_COLOR_NAME[c]}
                        aria-pressed={c === r.color}
                        onClick={() => {
                          patch(r.id, { color: c });
                          setColorFor(null);
                        }}
                        style={{ background: SHIFT_SWATCH[c] }}
                        className={cn(
                          "h-[22px] w-[22px] cursor-pointer rounded-[6px] border border-white/30",
                          c === r.color &&
                            "outline-2 outline-offset-1 outline-white",
                        )}
                      />
                    ))}
                  </div>
                ) : null}
              </span>
              <span className="flex min-w-[90px] flex-1 flex-col gap-px">
                <input
                  data-shift-type-name
                  aria-label={
                    saved
                      ? `Name of ${saved.label}`
                      : "Name of the new shift type"
                  }
                  value={r.label}
                  maxLength={40}
                  placeholder="Name"
                  onChange={(e) => patch(r.id, { label: e.target.value })}
                  className={cn(
                    "w-full rounded-[6px] border border-white/20 bg-[#0b1727] px-2 py-[3px] text-[13px] text-white placeholder:text-white/35 focus:border-sky-400/60 focus:outline-none",
                    renamed && "border-amber-400",
                    errorIds.has(r.id) && "border-red-400",
                    !r.active && "opacity-50",
                  )}
                />
                {renamed ? (
                  <span
                    data-shift-type-was
                    className="text-[10.5px] text-[#fcd34d]"
                  >
                    Was “{saved!.label}” — not saved yet
                  </span>
                ) : null}
              </span>
              {showTimes ? (
                <span
                  className={cn(
                    "flex items-center gap-1.5",
                    !r.active && "opacity-50",
                  )}
                >
                  <TimePicker
                    ariaLabel={`${nameFor} start`}
                    allowEmpty
                    value={r.start}
                    onChange={(v) => patch(r.id, { start: v })}
                  />
                  <span className="text-white/60">–</span>
                  <TimePicker
                    ariaLabel={`${nameFor} end`}
                    allowEmpty
                    value={r.end}
                    onChange={(v) => patch(r.id, { end: v })}
                  />
                </span>
              ) : null}
              <label className="flex w-[44px] cursor-pointer items-center justify-center">
                <input
                  type="checkbox"
                  data-shift-type-active
                  aria-label={`${nameFor} active`}
                  checked={r.active}
                  onChange={(e) => patch(r.id, { active: e.target.checked })}
                />
              </label>
              {!saved ? (
                <button
                  type="button"
                  data-remove-new-type
                  aria-label="Remove this new shift type"
                  title="Remove this new shift type"
                  onClick={() =>
                    setRows((cur) => cur.filter((x) => x.id !== r.id))
                  }
                  className="absolute -right-5 cursor-pointer px-1 text-[14px] leading-none text-white/55 hover:text-white max-sm:static"
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {notes.map((n) => (
        <p
          key={n.id}
          data-inactive-rule-note={n.id}
          className="mt-1.5 text-[12px] text-[#fcd34d]"
        >
          {n.text}
        </p>
      ))}
      <button
        type="button"
        data-add-shift-type
        onClick={add}
        className={ADD_CLASS}
      >
        + Add shift type
      </button>
    </div>
  );
}
