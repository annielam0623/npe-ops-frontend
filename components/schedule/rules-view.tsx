"use client";

import { useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { describeError } from "@/lib/api-errors";
import type { Rule } from "@/lib/schedule-engine";
import { cn } from "@/lib/utils";

import { CARD, CARD_HEADER, MUTED } from "./config";
import { RuleDialog } from "./rule-dialog";
import { describeRule, RULE_TYPES, type DescribeContext } from "./rules";

interface RulesViewProps {
  rules: Rule[];
  ctx: DescribeContext;
  /** supervisor 及以上能改；其他人只读。 */
  canEdit: boolean;
  /** 整份替换（返回保存后的规则）。 */
  onSave: (rules: Rule[]) => Promise<Rule[]>;
}

/** Rules 标签：规则清单（开关 / Edit / Delete / + Add rule）。规则只在前端解释（自动排班引擎），后端只存。 */
export function RulesView({ rules, ctx, canEdit, onSave }: RulesViewProps) {
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

  return (
    <section className={CARD} data-rules-view>
      <div className={CARD_HEADER}>
        <div>
          <h2 className="text-[14px] font-semibold text-white">Rules</h2>
          <p className={cn(MUTED, "text-[12px]")}>
            Auto-fill follows these rules when it schedules a week.
            {canEdit ? "" : " Only supervisors and admins can change them."}
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
        <p role="alert" className="px-4 pt-3 text-[12.5px] text-red-300">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col px-4 py-2">
        {ordered.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-white/70">
            No rules yet. {canEdit ? "Add the first rule to start." : ""}
          </p>
        ) : (
          ordered.map((rule) => (
            <div
              key={rule.id}
              data-rule-row={rule.id}
              className="grid grid-cols-[44px_1fr_auto] items-center gap-3 border-t border-white/10 py-2.5 first:border-t-0 max-sm:grid-cols-[44px_1fr]"
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
                  rule.enabled ? "bg-blue-500" : "bg-white/20",
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
                <b className="block text-[13.5px] text-white">
                  {RULE_TYPES.find((t) => t.type === rule.type)?.label ??
                    rule.type}
                </b>
                <span
                  className={cn(
                    "text-[12.5px]",
                    rule.enabled
                      ? "text-white/85"
                      : "text-white/45 line-through",
                  )}
                >
                  {describeRule(rule, ctx)}
                </span>
              </div>
              {canEdit ? (
                <div className="flex gap-1.5 max-sm:col-span-2 max-sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setEditing(rule)}
                    className={DARK_SECONDARY_BUTTON_CLASS}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(rule)}
                    className={DARK_SECONDARY_BUTTON_CLASS}
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
