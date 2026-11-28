"use client";

import { useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { describeError } from "@/lib/api-errors";
import type { Rule } from "@/lib/schedule-engine";
import { cn } from "@/lib/utils";

import { CARD, CARD_HEADER, MUTED } from "./config";
import { RuleDialog } from "./rule-dialog";
import { laToday } from "@/lib/la-date";
import type { MaxPerShiftDayParams } from "@/lib/schedule-engine";

import {
  describeExceptions,
  describeRule,
  RULE_TYPES,
  ruleConflicts,
  type DescribeContext,
} from "./rules";

interface RulesViewProps {
  rules: Rule[];
  ctx: DescribeContext;
  /** supervisor 及以上能改；其他人只读。 */
  canEdit: boolean;
  /** 整份替换（返回保存后的规则）。 */
  onSave: (rules: Rule[]) => Promise<Rule[]>;
  /**
   * 放在浅色底板（Modal 的 bg-paper）里：Staff Schedule 总览 › Settings › Rules。
   * 默认（不传）照旧是深色外框上的样子（Schedule 页的 Rules 标签）。
   * Annie 2026-11-27「检查所有浅色底板，这个是staff schedule的rules」：以前在浅色弹窗里也用白字，几乎看不见。
   * 浅色时照其他白卡片弹窗的字色（深字 #1a1a1a、次要灰 #475569、SECONDARY_BUTTON_CLASS），night: 照旧深色。
   */
  onPaper?: boolean;
}

/** 深色外框（默认）/ 浅色底板（onPaper）两套字色；浅色那套带 night:，全深色主题下跟深色一样。 */
const TONE = {
  dark: {
    card: CARD,
    header: CARD_HEADER,
    title: "text-white",
    muted: MUTED,
    error: "text-red-300",
    empty: "text-white/70",
    row: "border-white/10",
    off: "bg-white/20",
    name: "text-white",
    on: "text-white/85",
    disabled: "text-white/45",
    exceptions: "text-sky-200",
    past: "text-white/40",
    conflict: "text-[#fcd34d]",
    button: DARK_SECONDARY_BUTTON_CLASS,
  },
  paper: {
    card: "rounded-[14px] border border-black/[.08] night:border-white/10 night:bg-white/[.04]",
    header:
      "flex flex-wrap items-center justify-between gap-3 border-b border-black/[.08] px-4 py-3 night:border-white/10",
    title: "text-[#1a1a1a] night:text-white",
    muted: "text-[#475569] night:text-white/55",
    error: "text-[#b91c1c] night:text-red-300",
    empty: "text-[#475569] night:text-white/70",
    row: "border-black/[.08] night:border-white/10",
    off: "bg-[#cbd5e1] night:bg-white/20",
    name: "text-[#1a1a1a] night:text-white",
    on: "text-[#1a1a1a] night:text-white/85",
    disabled: "text-[#475569] night:text-white/45",
    exceptions: "text-[#1d4ed8] night:text-sky-200",
    past: "text-[#475569] night:text-white/40",
    conflict: "text-[#92400e] night:text-[#fcd34d]",
    button: SECONDARY_BUTTON_CLASS,
  },
} as const;

/** Rules 标签：规则清单（开关 / Edit / Delete / + Add rule）。规则只在前端解释（自动排班引擎），后端只存。 */
export function RulesView({
  rules,
  ctx,
  canEdit,
  onSave,
  onPaper,
}: RulesViewProps) {
  const tone = TONE[onPaper ? "paper" : "dark"];
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function replaceAll(next: Rule[]): Promise<ActionResult> {
    setError(null);
    try {
      await onSave(next);
      return { status: "ok" };
    } catch (e) {
      return { status: "error", message: describeError(e) };
    }
  }

  async function toggle(rule: Rule) {
    const result = await replaceAll(
      rules.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)),
    );
    if (result.status === "error") setError(result.message);
  }

  const groups = [
    ...RULE_TYPES.filter((t) => t.type !== "shift_times"),
    RULE_TYPES.find((t) => t.type === "shift_times")!,
  ];
  const ordered = groups.flatMap((g) => rules.filter((r) => r.type === g.type));
  // 置顶 110 题 8 A：互相打架的规则下面各一行琥珀字（不拦）。
  const conflicts = ruleConflicts(rules, ctx);
  const today = laToday();

  return (
    <section className={tone.card} data-rules-view>
      <div className={tone.header}>
        <div>
          <h2 className={cn("text-[14px] font-semibold", tone.title)}>Rules</h2>
          <p className={cn(tone.muted, "text-[12px]")}>
            Auto-fill follows these rules when it schedules a week.
            {canEdit ? "" : " Only supervisors and admins can change them."}
            {/* 置顶 85 Q5（Annie「全部同意推荐」；2c 定放这里，不另加 How to use 框）。 */}
            <span data-rules-shift-types-note>
              {" "}
              New shift types show up in the Shift list of every rule. Auto-fill
              uses the times from the Shift times rule, so add one for a new
              shift type; without it, Auto-fill uses the whole working hours.
            </span>
          </p>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className={DARK_PRIMARY_BUTTON_CLASS}
          >
            + Add rule
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className={cn("px-4 pt-3 text-[12.5px]", tone.error)}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-col px-4 py-2">
        {ordered.length === 0 ? (
          <p className={cn("py-6 text-center text-[13px]", tone.empty)}>
            No rules yet. {canEdit ? "Add the first rule to start." : ""}
          </p>
        ) : (
          ordered.map((rule) => (
            <div
              key={rule.id}
              data-rule-row={rule.id}
              className={cn(
                "grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t py-2.5 first:border-t-0 max-sm:grid-cols-[44px_1fr]",
                tone.row,
              )}
            >
              <button
                type="button"
                role="switch"
                aria-checked={rule.enabled}
                aria-label={rule.enabled ? "Turn rule off" : "Turn rule on"}
                disabled={!canEdit}
                onClick={() => void toggle(rule)}
                className={cn(
                  "relative h-5 w-9 rounded-full transition-colors",
                  rule.enabled ? "bg-blue-500" : tone.off,
                  canEdit ? "cursor-pointer" : "cursor-default opacity-80",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                    rule.enabled ? "left-[18px]" : "left-0.5",
                  )}
                />
              </button>
              <div className="min-w-0">
                <b className={cn("block text-[13.5px]", tone.name)}>
                  {RULE_TYPES.find((t) => t.type === rule.type)?.label ??
                    rule.type}
                </b>
                <span
                  className={cn(
                    "text-[12.5px]",
                    rule.enabled ? tone.on : cn(tone.disabled, "line-through"),
                  )}
                >
                  {describeRule(rule, ctx)}
                </span>
                {rule.type === "max_per_shift_day" &&
                (rule.params as unknown as MaxPerShiftDayParams).exceptions
                  ?.length ? (
                  // 置顶 110 续：例外另起一行；过期的灰掉写 (past)（题 5 A）。
                  <span
                    data-rule-exceptions={rule.id}
                    className={cn("block text-[12.5px]", tone.exceptions)}
                  >
                    Exceptions:{" "}
                    {describeExceptions(
                      rule.params as unknown as MaxPerShiftDayParams,
                      ctx,
                      today,
                    ).map((x, i) => (
                      <span
                        key={i}
                        data-exception-past={x.past || undefined}
                        className={x.past ? tone.past : undefined}
                      >
                        {i ? " · " : ""}
                        {x.text}
                        {x.past ? " (past)" : ""}
                      </span>
                    ))}
                  </span>
                ) : null}
                {(rule.id ? (conflicts.get(rule.id) ?? []) : []).map((t) => (
                  <span
                    key={t}
                    data-rule-conflict={rule.id}
                    className={cn("block text-[12px]", tone.conflict)}
                  >
                    {t}
                  </span>
                ))}
              </div>
              {canEdit ? (
                <div className="flex gap-1.5 max-sm:col-span-2 max-sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setEditing(rule)}
                    className={tone.button}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(rule)}
                    className={tone.button}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      {editing ? (
        <RuleDialog
          ctx={ctx}
          initial={editing === "new" ? undefined : editing}
          others={rules}
          onClose={() => setEditing(null)}
          onSave={async (rule) => {
            const next =
              editing === "new"
                ? [...rules, rule]
                : rules.map((r) => (r.id === rule.id ? rule : r));
            const result = await replaceAll(next);
            if (result.status === "ok") setEditing(null);
            return result;
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete this rule?"
          confirmLabel="Delete"
          busyLabel="Deleting…"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const result = await replaceAll(
              rules.filter((r) => r.id !== deleting.id),
            );
            if (result.status === "ok") setDeleting(null);
            return result;
          }}
        >
          <p>{describeRule(deleting, ctx)}</p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
