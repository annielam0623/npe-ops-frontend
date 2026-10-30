"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { cn } from "@/lib/utils";
import type {
  ScheduleEmployee,
  ScheduleEmployeeInput,
  ScheduleEmployeeUpdate,
} from "@/types";

import { INPUT, personDotColor } from "./config";

interface EmployeesDialogProps {
  employees: ScheduleEmployee[];
  onAdd: (input: ScheduleEmployeeInput) => Promise<ActionResult>;
  onUpdate: (
    id: number,
    input: ScheduleEmployeeUpdate,
  ) => Promise<ActionResult>;
  onClose: () => void;
}

/**
 * 排班名单：补邮箱 / 改名字 / 停用 / 加人（Annie 2026-10-18 看预览说「动手」）。
 * 邮箱要和登录 ops 的邮箱一样，后端按邮箱自动对上账号（发布时才有站内提醒）；没有邮箱的人发布时收不到邮件。
 * 不走共用 Modal（理由同 add-employee-dialog.tsx：这页永久深色）。
 */
export function EmployeesDialog({
  employees,
  onAdd,
  onUpdate,
  onClose,
}: EmployeesDialogProps) {
  const titleId = useId();
  const pressedOnBackdropRef = useRef(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function run(action: () => Promise<ActionResult>): Promise<boolean> {
    setError(null);
    const result = await action();
    if (result.status === "error") {
      setError(result.message);
      return false;
    }
    return true;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        pressedOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (
          pressedOnBackdropRef.current &&
          event.target === event.currentTarget
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
        className="flex max-h-[90vh] w-full max-w-[720px] flex-col gap-2 overflow-y-auto rounded-xl border border-white/10 bg-[#0d1b2e] p-5 text-white/90 shadow-[0_8px_40px_rgba(0,0,0,.45)]"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-[16px] font-semibold text-white">
            Employees
          </h2>
          <button
            type="button"
            onClick={onClose}
            className={DARK_SECONDARY_BUTTON_CLASS}
          >
            Close
          </button>
        </div>
        <p className="text-[12px] text-white/80">
          Use the same email they sign in to ops with, so they also get the
          in-app notice when a week is published. People without an email
          don&apos;t get the publish email. Deactivated people disappear from
          the schedule; past shifts stay.
        </p>

        {error ? (
          <p role="alert" className="text-[12.5px] text-red-300">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col">
          {employees.map((e) =>
            editingId === e.id ? (
              <EditRow
                key={e.id}
                employee={e}
                onSave={async (input) => {
                  const ok = await run(() => onUpdate(e.id, input));
                  if (ok) setEditingId(null);
                }}
                onCancel={() => {
                  setError(null);
                  setEditingId(null);
                }}
              />
            ) : (
              <div
                key={e.id}
                data-employee-row={e.id}
                className="grid grid-cols-[150px_1fr_auto] items-center gap-2.5 border-t border-white/10 py-1.5 max-sm:grid-cols-1"
              >
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-[13.5px] font-bold",
                    e.is_active ? "text-white" : "text-white/50",
                  )}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: personDotColor(e.id) }}
                  />
                  {e.name}
                  {e.is_test ? <TestTag /> : null}
                  {e.is_active ? null : (
                    <span className="text-[11px] font-normal">
                      (deactivated)
                    </span>
                  )}
                </span>
                {e.email ? (
                  <span className="text-[13px] text-slate-200">{e.email}</span>
                ) : (
                  <span data-no-email className="text-[13px] text-[#fde68a]">
                    No email — gets no publish email
                  </span>
                )}
                <span className="flex flex-wrap items-center gap-1.5">
                  {/* 测试用的人（Annie 2026-10-30 选 A）：点一下就存（同 Deactivate），不出现在 Dashboard、不算空档。 */}
                  <label className="mr-1 flex cursor-pointer items-center gap-1.5 text-[12px] text-white/75">
                    <input
                      type="checkbox"
                      data-test-person={e.id}
                      checked={!!e.is_test}
                      onChange={(ev) =>
                        void run(() =>
                          onUpdate(e.id, { is_test: ev.target.checked }),
                        )
                      }
                    />
                    Test person — hidden from Dashboard
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setEditingId(e.id);
                    }}
                    className={DARK_SECONDARY_BUTTON_CLASS}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void run(() =>
                        onUpdate(e.id, { is_active: !e.is_active }),
                      )
                    }
                    className={DARK_SECONDARY_BUTTON_CLASS}
                  >
                    {e.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                </span>
              </div>
            ),
          )}
          <AddRow onAdd={async (input) => run(() => onAdd(input))} />
        </div>
      </div>
    </div>
  );
}

function EditRow({
  employee,
  onSave,
  onCancel,
}: {
  employee: ScheduleEmployee;
  onSave: (input: ScheduleEmployeeUpdate) => Promise<void>;
  onCancel: () => void;
}) {
  const nameId = useId();
  const emailId = useId();
  const [name, setName] = useState(employee.name);
  const [email, setEmail] = useState(employee.email ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    await onSave({ name: name.trim(), email: email.trim() });
    setSaving(false);
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      data-employee-edit={employee.id}
      className="grid grid-cols-[150px_1fr_auto] items-center gap-2.5 border-t border-white/10 py-1.5 max-sm:grid-cols-1"
    >
      <input
        id={nameId}
        aria-label="Name"
        autoComplete="off"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className={cn(INPUT, "w-full")}
      />
      <input
        id={emailId}
        aria-label="Email"
        type="email"
        autoComplete="off"
        placeholder="Email (optional)"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className={cn(INPUT, "w-full")}
      />
      <span className="flex gap-1.5">
        <button
          type="submit"
          disabled={saving}
          className={DARK_PRIMARY_BUTTON_CLASS}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className={DARK_SECONDARY_BUTTON_CLASS}
        >
          Cancel
        </button>
      </span>
    </form>
  );
}

function AddRow({
  onAdd,
}: {
  onAdd: (input: ScheduleEmployeeInput) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    const ok = await onAdd({ name: name.trim(), email: email.trim() });
    setSaving(false);
    if (ok) {
      setName("");
      setEmail("");
    }
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      data-employee-add
      className="grid grid-cols-[150px_1fr_auto] items-center gap-2.5 border-t border-white/10 py-1.5 max-sm:grid-cols-1"
    >
      <input
        aria-label="New employee name"
        autoComplete="off"
        placeholder="+ Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className={cn(INPUT, "w-full")}
      />
      <input
        aria-label="New employee email"
        type="email"
        autoComplete="off"
        placeholder="Email (optional)"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className={cn(INPUT, "w-full")}
      />
      <button
        type="submit"
        disabled={saving || !name.trim()}
        className={DARK_PRIMARY_BUTTON_CLASS}
      >
        {saving ? "Adding…" : "Add"}
      </button>
    </form>
  );
}

/** 测试用的人旁边的小标签：灰色（不用蓝，蓝色只给提交键）。排班表和 Employees 框共用。 */
export function TestTag() {
  return (
    <span
      data-test-tag
      className="rounded bg-white/10 px-1 text-[10px] font-semibold text-white/60"
    >
      Test
    </span>
  );
}
