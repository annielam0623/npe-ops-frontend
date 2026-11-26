"use client";

import { useEffect, useId, useState } from "react";

import {
  createLeaveCategory,
  leaveErrorOf,
  updateLeaveCategory,
  type LeaveCategory,
} from "@/lib/schedule-leave-api";
import { cn } from "@/lib/utils";

import {
  BTN_BLUE,
  BTN_GREEN,
  BTN_PLAIN,
  ErrorBox,
  HINT,
  INP,
  LeaveDialogShell,
  MINI_TABLE,
  MINI_TD,
  MINI_TH,
} from "./ui";

interface Row {
  /** null = 这次新加的（Save 时 POST）。 */
  key: string | null;
  label: string;
  is_active: boolean;
  /** 原来的（判断改没改）。 */
  orig: LeaveCategory | null;
}

const LABEL_MAX = 30;

function rowsOf(categories: LeaveCategory[]): Row[] {
  return [...categories]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => ({
      key: c.key,
      label: c.label,
      is_active: c.is_active,
      orig: c,
    }));
}

interface LeaveTypesDialogProps {
  /** 全部类别（含停用的，GET /api/schedule/leave-categories 不带 active）。 */
  categories: LeaveCategory[];
  /** 存好以后的整份（总览换掉自己的 categories）。 */
  onSaved: (categories: LeaveCategory[]) => void;
  onClose: () => void;
}

/**
 * 请假类别（Q7 B：有 settings.schedule 勾的人才看得到这个键，由总览按 range.can_manage_leave_types 判断）。
 * 改名 / 停用 / 排序 / 新加都先放在框里，按 Save 一次存（先选后存，Annie 2026-11-19）。不能删（旧的假要显示名字）。
 */
export function LeaveTypesDialog({
  categories,
  onSaved,
  onClose,
}: LeaveTypesDialogProps) {
  const titleId = useId();
  const [rows, setRows] = useState<Row[]>(() => rowsOf(categories));
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "saved") return;
    const t = window.setTimeout(onClose, 900);
    return () => window.clearTimeout(t);
  }, [state, onClose]);

  const names = rows.map((r) => r.label.trim().toLowerCase());
  const dupe = names.find((n, i) => n && names.indexOf(n) !== i);
  const empty = rows.some((r) => !r.label.trim());
  const changed =
    rows.some(
      (r, i) =>
        !r.orig ||
        r.orig.label !== r.label.trim() ||
        r.orig.is_active !== r.is_active ||
        rowsOf(categories)[i]?.key !== r.key,
    ) || rows.length !== categories.length;
  const problem = empty
    ? "Name the leave type."
    : dupe
      ? `There is already a leave type called "${rows.find((r) => r.label.trim().toLowerCase() === dupe)?.label.trim()}".`
      : null;

  function addDraft() {
    const label = draft.trim();
    if (!label) return;
    setRows((r) => [...r, { key: null, label, is_active: true, orig: null }]);
    setDraft("");
    setState("idle");
  }

  function move(i: number, d: -1 | 1) {
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const next = [...r];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setState("idle");
  }

  function edit(i: number, patch: Partial<Row>) {
    setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
    setState("idle");
  }

  async function save() {
    if (problem || !changed || state === "saving") return;
    setState("saving");
    setError(null);
    const out: LeaveCategory[] = [];
    try {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const sort_order = i + 1;
        const label = r.label.trim();
        if (!r.orig) {
          let c = await createLeaveCategory(label);
          if (c.sort_order !== sort_order || !r.is_active)
            c = await updateLeaveCategory(c.key, {
              sort_order,
              is_active: r.is_active,
            });
          out.push(c);
          // 存进去了就当原来的，失败重按 Save 不会再建一次。
          rows[i] = { ...r, key: c.key, orig: c };
          continue;
        }
        const patch: Partial<LeaveCategory> = {};
        if (r.orig.label !== label) patch.label = label;
        if (r.orig.is_active !== r.is_active) patch.is_active = r.is_active;
        if (r.orig.sort_order !== sort_order) patch.sort_order = sort_order;
        const c = Object.keys(patch).length
          ? await updateLeaveCategory(r.orig.key, patch)
          : r.orig;
        out.push(c);
        rows[i] = { ...r, orig: c };
      }
      setRows([...rows]);
      setState("saved");
      onSaved(out);
    } catch (e) {
      setRows([...rows]);
      setState("idle");
      setError(leaveErrorOf(e, "Couldn't save the leave types.").detail);
    }
  }

  return (
    <LeaveDialogShell
      titleId={titleId}
      title="Leave types"
      onClose={onClose}
      busy={state === "saving"}
      footer={
        <>
          {state === "saved" ? (
            <span className="mr-auto self-center text-[12.5px] font-semibold text-[#15803d]">
              Saved
            </span>
          ) : null}
          <button type="button" className={BTN_PLAIN} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            data-types-save
            className={BTN_BLUE}
            disabled={!!problem || !changed || state === "saving"}
            onClick={save}
          >
            {state === "saving" ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <table className={MINI_TABLE}>
        <thead>
          <tr>
            <th className={MINI_TH}>Name</th>
            <th className={MINI_TH}>In use</th>
            <th className={MINI_TH} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key ?? `new-${i}`} data-type-row={r.key ?? "new"}>
              <td className={MINI_TD}>
                <input
                  aria-label="Name"
                  className={cn(INP, "w-full")}
                  maxLength={LABEL_MAX}
                  value={r.label}
                  onChange={(e) => edit(i, { label: e.target.value })}
                />
              </td>
              <td className={MINI_TD}>
                <input
                  type="checkbox"
                  aria-label={`${r.label} in use`}
                  checked={r.is_active}
                  onChange={(e) => edit(i, { is_active: e.target.checked })}
                />
              </td>
              <td className={cn(MINI_TD, "whitespace-nowrap")}>
                <button
                  type="button"
                  aria-label={`Move ${r.label} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="cursor-pointer px-1 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${r.label} down`}
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, 1)}
                  className="cursor-pointer px-1 disabled:opacity-30"
                >
                  ↓
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addDraft();
        }}
      >
        <input
          aria-label="New type"
          placeholder="New type, e.g. Bereavement"
          className={cn(INP, "min-w-[180px] flex-1")}
          maxLength={LABEL_MAX}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          data-type-add
          className={BTN_GREEN}
          disabled={!draft.trim()}
        >
          Add
        </button>
      </form>
      <div className={HINT}>
        Types can&apos;t be deleted. Turn one off and staff can&apos;t pick it
        any more; old leave keeps its name.
      </div>
      <ErrorBox text={problem ?? error} />
    </LeaveDialogShell>
  );
}
