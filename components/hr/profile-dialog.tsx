"use client";

import { useId, useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { Modal } from "@/components/ui/modal";
import type { HRProfileInput } from "@/lib/hr-api";
import { cn } from "@/lib/utils";
import type { HRLinkableUser, HRProfile } from "@/types";

import { FIELDS, GROUPS, type HRField } from "./fields";
import {
  HR_BTN_CLASS,
  HR_BTN_DANGER_CLASS,
  HR_BTN_PRIMARY_CLASS,
} from "./legacy-ui";

type FormValues = Record<string, string | string[]>;

function initialValues(profile: HRProfile | null): FormValues {
  const values: FormValues = {};
  for (const f of FIELDS) {
    const raw = profile
      ? (profile as unknown as Record<string, unknown>)[f.key]
      : undefined;
    values[f.key] =
      f.kind === "multi"
        ? Array.isArray(raw)
          ? [...(raw as string[])]
          : []
        : ((raw as string) ?? "");
  }
  return values;
}

function sameValues(a: FormValues, b: FormValues): boolean {
  return FIELDS.every((f) => {
    const x = a[f.key];
    const y = b[f.key];
    return Array.isArray(x) && Array.isArray(y)
      ? x.join(",") === y.join(",")
      : x === y;
  });
}

/** .form-group input / select / textarea */
const INPUT_CLASS =
  "w-full rounded-[7px] border-[0.5px] border-black/20 bg-white px-2.5 py-[7px] text-[13px] text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-none disabled:opacity-60";
/** .grp > h4 */
const GROUP_TITLE_CLASS =
  "mb-[9px] text-[11px] font-semibold tracking-[.06em] text-[#888] uppercase";
/** .grid */
const GRID_CLASS = "grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3";
/** .form-group label */
const LABEL_CLASS = "text-[12px] font-medium text-[#888]";
/** .form-group .hint */
const HINT_CLASS = "text-[11px] leading-[1.5] text-[#aaa]";

interface ProfileDialogProps {
  /** null = Add person。 */
  profile: HRProfile | null;
  linkableUsers: HRLinkableUser[];
  /** 可选账号没拉到时（不影响保存，只是下拉里只有当前关联的）。 */
  linkableError: string | null;
  onSave: (input: HRProfileInput) => Promise<ActionResult>;
  onDelete: () => void;
  onClose: () => void;
}

export function ProfileDialog({
  profile,
  linkableUsers,
  linkableError,
  onSave,
  onDelete,
  onClose,
}: ProfileDialogProps) {
  const titleId = useId();
  const idPrefix = useId();
  const [initial] = useState(() => initialValues(profile));
  const [values, setValues] = useState<FormValues>(initial);
  const initialUser = profile?.user_id != null ? String(profile.user_id) : "";
  const [userId, setUserId] = useState(initialUser);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);

  const dirty = !sameValues(values, initial) || userId !== initialUser;

  function dismiss() {
    if (saving) return;
    // 旧页面点背景直接关、填的全丢；这里有改动时先问。
    if (dirty) setAskDiscard(true);
    else onClose();
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setAskDiscard(false);
    const input: HRProfileInput = {
      ...values,
      user_id: userId ? Number(userId) : null,
    };
    const result = await onSave(input);
    if (result.status === "error") {
      setError(result.message);
      setSaving(false);
    }
  }

  function setValue(key: string, value: string | string[]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  const linkedMissing =
    profile?.user_id != null &&
    !linkableUsers.some((u) => u.id === profile.user_id);

  return (
    <Modal
      titleId={titleId}
      onDismiss={saving ? undefined : dismiss}
      panelClassName="flex max-h-[92vh] max-w-[720px] flex-col text-[#1a1a1a]"
    >
      <h2
        id={titleId}
        className="rounded-t-[12px] border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-[18px] py-3.5 text-[14px] font-semibold text-[#1a1a1a]"
      >
        {profile ? `Edit — ${profile.legal_name}` : "Add person"}
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="overflow-y-auto p-[18px]">
          <fieldset className="mb-[18px]">
            <legend className={GROUP_TITLE_CLASS}>Login Account</legend>
            <div className="flex flex-col gap-[5px]">
              <label htmlFor={`${idPrefix}-user`} className={LABEL_CLASS}>
                Linked account
              </label>
              <select
                id={`${idPrefix}-user`}
                value={userId}
                disabled={saving}
                onChange={(e) => setUserId(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">— not linked —</option>
                {linkedMissing ? (
                  <option value={String(profile.user_id)}>
                    (currently linked account)
                  </option>
                ) : null}
                {linkableUsers.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.label} ({u.role})
                  </option>
                ))}
              </select>
              <span className={HINT_CLASS}>
                Only driver and guide accounts appear here. Leave it empty if
                the account has not been created yet — the record works either
                way.
                {linkableUsers.length === 0 && !linkableError
                  ? " No driver or guide accounts exist yet. Create them under Settings → Users; you can link them later."
                  : null}
              </span>
              {linkableError ? (
                <p className="text-[11px] text-[#b3261e]">
                  Could not load the account list ({linkableError}). You can
                  still save the other fields.
                </p>
              ) : null}
            </div>
          </fieldset>

          {GROUPS.map(([group, label]) => (
            <fieldset key={group} className="mb-[18px]">
              <legend className={GROUP_TITLE_CLASS}>{label}</legend>
              <div className={GRID_CLASS}>
                {FIELDS.filter((f) => f.group === group).map((f) => (
                  <FieldInput
                    key={f.key}
                    field={f}
                    id={`${idPrefix}-${f.key}`}
                    value={values[f.key]}
                    disabled={saving}
                    onChange={(v) => setValue(f.key, v)}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        {error ? (
          <p
            role="alert"
            className="px-[18px] pb-3 text-[12.5px] whitespace-pre-wrap text-[#b3261e]"
          >
            {error}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 border-t-[0.5px] border-black/[.08] px-[18px] py-3">
          {askDiscard ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-[7px] bg-[#fdf1dd] px-3 py-2 text-[12.5px] text-[#8a5a00]"
            >
              <span className="mr-auto">
                Close without saving your changes?
              </span>
              <button
                type="button"
                onClick={() => setAskDiscard(false)}
                className={HR_BTN_CLASS}
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className={HR_BTN_DANGER_CLASS}
              >
                Discard
              </button>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2.5">
            {profile ? (
              <button
                type="button"
                disabled={saving}
                onClick={onDelete}
                className={HR_BTN_DANGER_CLASS}
              >
                Delete
              </button>
            ) : null}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={dismiss}
                className={HR_BTN_CLASS}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className={HR_BTN_PRIMARY_CLASS}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function FieldInput({
  field,
  id,
  value,
  disabled,
  onChange,
}: {
  field: HRField;
  id: string;
  value: string | string[];
  disabled: boolean;
  onChange: (value: string | string[]) => void;
}) {
  const wide = field.kind === "multi" || field.key === "notes";
  const label = (
    <span className={LABEL_CLASS}>
      {field.label}
      {field.key === "legal_name" ? " *" : ""}
    </span>
  );
  const hint = field.hint ? (
    <span className={HINT_CLASS}>{field.hint}</span>
  ) : null;

  if (field.kind === "multi") {
    const selected = value as string[];
    const unknown = selected.filter(
      (v) => !field.choices?.some(([c]) => c === v),
    );
    return (
      <div
        role="group"
        aria-label={field.label}
        className={cn("flex flex-col gap-[5px]", wide && "col-span-full")}
      >
        {label}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 py-1">
          {[
            ...(field.choices ?? []),
            ...unknown.map((v) => [v, v] as const),
          ].map(([v, text]) => (
            <label
              key={v}
              className="inline-flex cursor-pointer items-center gap-[5px] text-[12px] whitespace-nowrap text-[#1a1a1a] select-none"
            >
              <input
                type="checkbox"
                checked={selected.includes(v)}
                disabled={disabled}
                onChange={(e) => {
                  const set = new Set(selected);
                  if (e.target.checked) set.add(v);
                  else set.delete(v);
                  const order = (field.choices ?? []).map(([c]) => c);
                  onChange([
                    ...order.filter((c) => set.has(c)),
                    ...[...set].filter((c) => !order.includes(c)),
                  ]);
                }}
              />
              {text}
            </label>
          ))}
        </div>
        {hint}
      </div>
    );
  }

  const text = value as string;
  let control;
  if (field.kind === "choice") {
    const known = field.choices?.some(([v]) => v === text);
    control = (
      <select
        id={id}
        value={text}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLASS}
      >
        {/* 库里有不认识的值时照样列出来：旧页面会悄悄变成空、一保存就清掉。 */}
        {!known && text ? <option value={text}>{text}</option> : null}
        {field.choices?.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    );
  } else if (field.key === "notes") {
    control = (
      <textarea
        id={id}
        value={text}
        rows={3}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(INPUT_CLASS, "min-h-[70px] resize-y")}
      />
    );
  } else {
    control = (
      <input
        id={id}
        type={field.kind === "date" ? "date" : "text"}
        inputMode={field.kind === "phone" ? "tel" : undefined}
        value={text}
        maxLength={field.maxlen}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLASS}
      />
    );
  }
  return (
    <label
      htmlFor={id}
      className={cn("flex flex-col gap-[5px]", wide && "col-span-full")}
    >
      {label}
      {control}
      {hint}
    </label>
  );
}
