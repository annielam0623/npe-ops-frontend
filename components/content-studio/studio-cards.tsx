"use client";

import { type ReactNode, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SMS_CHAR_LIMIT, smsCheck, smsLength } from "@/lib/sms-limit";
import type { TemplateSetting } from "@/lib/template-settings-api";
import { cn } from "@/lib/utils";

import {
  BC_BUILTIN,
  BC_VARS,
  type BroadcastSet,
  bcBodyKey,
  bcTitleKey,
  fillSample,
  isWebLink,
  PREP_STEPS,
  prepKey,
  PU_DEFAULT_ORDER,
  PU_ORDER_KEY,
  PU_STEP_LABELS,
  SAMPLE,
  smsSegments,
  type TextField,
  unknownVars,
  VAR_WARN,
} from "./fields";

/** 页面给每张卡片的读写接口：草稿按键共用一份（同一个键出现在两个标签页时自动同步）。 */
export interface Studio {
  saved: Record<string, TemplateSetting>;
  draft: (key: string) => string;
  savedValue: (key: string) => string;
  setDraft: (key: string, value: string) => void;
  /** 依次保存这些键（值取草稿）；返回成功和失败的键。 */
  save: (
    keys: string[],
  ) => Promise<{ ok: string[]; failed: { key: string; message: string }[] }>;
  setActive: (key: string | null) => void;
}

export type SaveState = "idle" | "saving" | "saved" | "error";

// 旧模板 settings_templates.html 的卡片样式照抄（Annie 2026-10-07：和旧版一模一样）。
// ⚠️ cn 只拼字符串、不做 Tailwind 合并：边框色、底色不能在两处都写。
const TEXTAREA_BASE =
  "box-border min-h-[60px] w-full resize-y rounded-[7px] border px-2.5 py-2 text-[12px] leading-[1.6] text-[#1a1a1a] night:text-white/90 transition-colors focus:bg-paper night:focus:bg-white/[.04] focus:outline-none";
/** .field-textarea（Global 卡片是 .global-card-ta：红边、淡红底） */
function textareaClass(global: boolean): string {
  return cn(
    TEXTAREA_BASE,
    global
      ? "border-[#fca5a5] night:border-red-500/30 bg-[#fff8f8] night:bg-red-500/10 focus:border-[#dc2626] night:focus:border-red-500/30"
      : "border-[#e5e7eb] night:border-white/10 bg-paper night:bg-white/[.03] focus:border-[#1a1a1a] night:focus:border-white/40",
  );
}
/** .dyn-step-group .dyn-input */
const INPUT =
  "mb-[5px] box-border block w-full rounded-[5px] border border-[#e5e7eb] night:border-white/10 bg-paper night:bg-white/[.04] px-2 py-[5px] text-[12px] text-[#1a1a1a] night:text-white/90 focus:border-[#1a1a1a] night:focus:border-white/40 focus:outline-none";
/** .var-hint */
const HINT = "text-[10px] text-[#1a1a1a] night:text-white/50";
/** .global-warning / .var-warning */
const WARN_BAR =
  "border-t border-[#fecaca] night:border-red-500/30 bg-[#fef2f2] night:bg-red-500/10 px-3.5 py-[5px] text-[11px] text-[#dc2626] night:text-red-300";
/** .dyn-add-btn */
const ADD_BTN =
  "cursor-pointer rounded-[6px] border border-dashed border-[#aaa] bg-paper night:bg-white/[.04] px-3 py-1 text-[11px] text-[#1a1a1a] night:text-white/90 hover:border-[#1a1a1a] night:hover:border-white/40";
/** .dyn-step-group */
const STEP_GROUP =
  "mb-2 rounded-[8px] border border-[#e5e7eb] night:border-white/10 bg-paper night:bg-white/[.03] px-3 py-2.5 hover:border-[#ccc] night:hover:border-white/10";
/** .dyn-handle */
const HANDLE =
  "shrink-0 cursor-grab text-[14px] text-[#1a1a1a] night:text-white/35 select-none";

const LA_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
  timeZoneName: "short",
});

/** 后端给的 updated_at 不带时区（UTC）：补上 Z 再按洛杉矶显示。 */
export function editedLine(s: TemplateSetting | undefined): ReactNode {
  if (!s?.updated_by) return <span>Original</span>;
  const iso =
    s.updated_at && !/[zZ]|[+-]\d\d:?\d\d$/.test(s.updated_at)
      ? `${s.updated_at}Z`
      : s.updated_at;
  const t = iso ? new Date(iso).getTime() : NaN;
  return (
    <span>
      Last edited by <strong>{s.updated_by}</strong>
      {Number.isNaN(t) ? "" : ` · ${LA_TIME.format(t)}`}
    </span>
  );
}

/** 蓝色提交键，同 Products 的 SAVE_BUTTON（Annie 2026-10-30「Content Studio 同意全部推荐。动手」）：没改动时灰的、点不了。 */
const CARD_SAVE_BUTTON =
  "cursor-pointer rounded-[6px] border border-[#3b82f6] bg-[#3b82f6] px-3.5 py-1 text-[11px] font-semibold text-white transition-all hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:border-[#d3d1c7] disabled:bg-[#e9e9e6] disabled:text-[#6b7280] night:disabled:border-white/10 night:disabled:bg-white/[.06] night:disabled:text-white/40";

const SAVED_TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
});

/**
 * 卡片底部：Cancel（有改动才能点，先确认）+ 蓝色 Save（没改动灰的）。
 * 结果写在键旁边：Saving… 灰字、存好绿字「✓ Saved · 9:12 PM」一直留到再改；存不上下面红字写后端原话。
 */
export function CardFooter({
  dirty,
  state,
  savedAt,
  onSave,
  onCancel,
  meta,
  extraError,
}: {
  dirty: boolean;
  state: SaveState;
  savedAt?: string | null;
  onSave: () => void;
  onCancel: () => void;
  meta?: ReactNode;
  extraError?: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="mt-[7px]">
      {/* .field-footer：左边是谁改的，右边 Cancel + Save */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] text-[#1a1a1a] night:text-white/35">
          {meta}
        </span>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {state === "saving" ? (
            <span className="text-[11px] text-[#6b7280] night:text-white/50">
              Saving…
            </span>
          ) : state === "saved" && !dirty && savedAt ? (
            <span
              role="status"
              data-save-ok
              className="text-[11px] font-semibold whitespace-nowrap text-[#1e6b43] night:text-emerald-300"
            >
              ✓ Saved · {savedAt}
            </span>
          ) : null}
          <button
            type="button"
            disabled={!dirty || state === "saving"}
            title="Discard the unsaved changes on this card and restore the last saved version"
            onClick={() => setConfirming(true)}
            className="cursor-pointer rounded-[6px] border border-[#d3d1c7] bg-paper px-3 py-1 text-[11px] font-medium text-[#1a1a1a] transition-all hover:enabled:border-[#a8a49b] hover:enabled:bg-[#f1f0eb] hover:enabled:text-[#1a1a1a] disabled:cursor-default disabled:opacity-30 night:bg-white/[.04] night:text-white/65 night:hover:enabled:bg-white/[.03] night:hover:enabled:text-white/90"
          >
            Cancel
          </button>
          <button
            type="button"
            data-save-btn
            disabled={!dirty || state === "saving"}
            onClick={onSave}
            className={CARD_SAVE_BUTTON}
          >
            Save
          </button>
        </span>
      </div>
      {extraError ? (
        <p
          role="alert"
          className="mt-1.5 text-[11px] text-[#dc2626] night:text-red-300"
        >
          {extraError}
        </p>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title="Discard changes?"
          confirmLabel="Discard"
          busyLabel="…"
          onConfirm={async () => {
            onCancel();
            setConfirming(false);
            return { status: "ok" };
          }}
          onClose={() => setConfirming(false)}
        >
          <p>
            Discard the unsaved changes on this card? It will go back to the
            last saved version.
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/** 保存的通用流程：先校验，再存；存好记下时间（绿字一直留到再改）。 */
function useCardSave(studio: Studio) {
  const [state, setState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(keys: string[], validate?: () => string | null) {
    const problem = validate?.() ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setState("saving");
    const result = await studio.save(keys);
    if (result.failed.length) {
      setState("error");
      setError(
        result.ok.length
          ? `Partly saved: ${result.ok.length} went through, ${result.failed.length} did not (${result.failed[0].message}). Please save again.`
          : `Nothing was saved: ${result.failed[0].message}. Click Save again.`,
      );
    } else {
      setState("saved");
      setSavedAt(SAVED_TIME.format(new Date()));
    }
  }
  return { state, savedAt, error, run };
}

/** 文本框旁边的「Insert:」按钮：在光标处插入变量。 */
export function InsertBar({
  vars,
  onInsert,
}: {
  vars: string[];
  onInsert: (v: string) => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-[5px]">
      <span className="text-[10px] text-[#1a1a1a] night:text-white/50">
        Insert:
      </span>
      {vars.map((v) => (
        <button
          key={v}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(v)}
          className="cursor-pointer rounded-[5px] border border-[#cfe1f6] bg-paper px-[7px] py-0.5 font-mono text-[10px] text-[#1a3a5c] hover:border-[#1a3a5c] hover:bg-[#eef6ff] night:bg-white/[.04]"
        >
          + {v.slice(1, -1)}
        </button>
      ))}
    </div>
  );
}

/** 原来有、现在没了的变量：提醒（发出去会少一块真实数据）。 */
function missingVars(
  saved: string,
  now: string,
  vars: string[] | undefined,
): string[] {
  return (vars ?? []).filter((v) => saved.includes(v) && !now.includes(v));
}

export function TextFieldCard({
  field,
  studio,
  global = false,
}: {
  field: TextField;
  studio: Studio;
  global?: boolean;
}) {
  const value = studio.draft(field.key);
  const dirty = value !== studio.savedValue(field.key);
  const { state, savedAt, error, run } = useCardSave(studio);
  const ref = useRef<HTMLTextAreaElement>(null);
  const smsText = field.sms
    ? fillSample(value.trim(), { ...SAMPLE, ...field.smsSample })
    : "";
  const sms = field.sms ? templateSms(smsText, value.trim()) : null;
  const lost = missingVars(studio.savedValue(field.key), value, field.vars);
  const unknown =
    field.strictVars && field.vars ? unknownVars(value, field.vars) : [];
  const defaultText = field.resetKey ? studio.savedValue(field.resetKey) : null;

  function insert(v: string) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    studio.setDraft(field.key, value.slice(0, start) + v + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + v.length, start + v.length);
    });
  }

  return (
    <CardShell
      label={field.label}
      keyName={field.key}
      global={global}
      hint={field.hint}
      varWarn={!!field.vars?.length}
    >
      <textarea
        ref={ref}
        aria-label={field.label}
        value={value}
        rows={field.rows ?? 2}
        onFocus={() => studio.setActive(field.key)}
        onChange={(e) =>
          // 短信不能换行（旧页面同样把换行压成空格）。
          studio.setDraft(
            field.key,
            field.sms ? e.target.value.replace(/\r?\n/g, " ") : e.target.value,
          )
        }
        className={textareaClass(global)}
      />
      {field.vars?.length ? (
        <InsertBar vars={field.vars} onInsert={insert} />
      ) : null}
      {sms ? (
        <p
          className={cn(
            "mt-1 text-[10px] tabular-nums",
            sms.over
              ? "font-semibold text-[#c0392b] night:text-red-300"
              : "text-[#1a1a1a] night:text-white/50",
          )}
        >
          ≈ {sms.text}
        </p>
      ) : null}
      {sms && field.smsMeter ? <SmsMeter length={smsLength(smsText)} /> : null}
      {field.url && value.trim() && !isWebLink(value) ? (
        <p
          data-url-warn
          className="mt-1 text-[11px] font-semibold text-[#b36b00] night:text-amber-300"
        >
          Must start with https:// — guests won&apos;t see this link until it
          does.
        </p>
      ) : null}
      {lost.length ? (
        <p className="mt-1 text-[11px] font-semibold text-[#dc2626] night:text-red-300">
          Removed variable(s): {lost.join(", ")} — the guest will not see that
          data.
        </p>
      ) : null}
      {unknown.length ? (
        <p
          role="alert"
          data-unknown-vars
          className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#dc2626] night:text-red-300"
        >
          <span className="font-semibold">Unknown:</span>
          {unknown.map((v) => (
            <span
              key={v}
              className="rounded-[5px] border border-[#e3b4ae] bg-[#fdf0ee] px-[7px] py-0.5 font-mono text-[10px] night:border-red-500/30 night:bg-red-500/10"
            >
              {v}
            </span>
          ))}
          <span>Not a variable we know. Fix it before saving.</span>
        </p>
      ) : null}
      {defaultText !== null ? (
        <button
          type="button"
          disabled={value === defaultText}
          title="Put the Default text in this box (press Save to keep it)"
          onClick={() => studio.setDraft(field.key, defaultText)}
          className="mt-1.5 cursor-pointer rounded-[6px] border border-[#d3d1c7] bg-paper px-2.5 py-0.5 text-[11px] font-medium text-[#1a1a1a] hover:enabled:border-[#a8a49b] disabled:cursor-default disabled:opacity-40 night:bg-white/[.04] night:text-white/75"
        >
          Reset to Default
        </button>
      ) : null}
      <CardFooter
        dirty={dirty}
        state={state}
        savedAt={savedAt}
        meta={editedLine(studio.saved[field.key])}
        extraError={error}
        onCancel={() =>
          studio.setDraft(field.key, studio.savedValue(field.key))
        }
        onSave={() =>
          void run([field.key], () =>
            unknown.length
              ? `Unknown variable(s): ${unknown.join(", ")}. Fix or remove them before saving.`
              : sms?.over
                ? sms.problem("SMS template")
                : null,
          )
        }
      />
    </CardShell>
  );
}

/**
 * 一张卡片里几行单行输入框，一个 Save 存全部（Shuttle 的 Route section labels）。
 * placeholder = 空着时客人看到的默认文字。
 */
export function InputsCard({
  label,
  hint,
  rows,
  studio,
  global = false,
}: {
  label: string;
  hint?: ReactNode;
  rows: { key: string; label: string; placeholder?: string }[];
  studio: Studio;
  global?: boolean;
}) {
  const { state, savedAt, error, run } = useCardSave(studio);
  const keys = rows.map((r) => r.key);
  const dirty = keys.some((k) => studio.draft(k) !== studio.savedValue(k));
  const last = rows
    .map((r) => studio.saved[r.key])
    .filter((x) => x?.updated_by)
    .sort((a, b) =>
      (b?.updated_at ?? "").localeCompare(a?.updated_at ?? ""),
    )[0];
  return (
    <CardShell label={label} global={global} hint={hint}>
      <div className="grid grid-cols-1 items-center gap-x-2.5 gap-y-1.5 sm:grid-cols-[150px_minmax(0,1fr)]">
        {rows.map((r) => (
          <label key={r.key} className="contents">
            <span className="text-[11.5px] text-[#1a1a1a] night:text-white/75">
              {r.label}
            </span>
            <input
              value={studio.draft(r.key)}
              placeholder={r.placeholder}
              data-key={r.key}
              onFocus={() => studio.setActive(r.key)}
              onChange={(e) => studio.setDraft(r.key, e.target.value)}
              className={INPUT.replace("mb-[5px]", "")}
            />
          </label>
        ))}
      </div>
      <CardFooter
        dirty={dirty}
        state={state}
        savedAt={savedAt}
        meta={editedLine(last)}
        extraError={error}
        onCancel={() =>
          keys.forEach((k) => studio.setDraft(k, studio.savedValue(k)))
        }
        onSave={() => void run(keys)}
      />
    </CardShell>
  );
}

/** 短信字数条：250 起黄、超 300 红；超过 160 要拆成几条短信。 */
function SmsMeter({ length }: { length: number }) {
  const over = length > SMS_CHAR_LIMIT;
  const warn = !over && length >= 250;
  const segments = smsSegments(length);
  return (
    <div className="mt-1" data-sms-meter>
      <div className="h-[5px] overflow-hidden rounded-[3px] bg-[#eceae2] night:bg-white/10">
        <div
          className={cn(
            "h-full",
            over ? "bg-[#c0392b]" : warn ? "bg-[#d99a1c]" : "bg-[#1a7f4b]",
          )}
          style={{
            width: `${Math.min(100, (length / SMS_CHAR_LIMIT) * 100)}%`,
          }}
        />
      </div>
      {segments > 1 ? (
        <p className="mt-0.5 text-[10px] text-[#1a1a1a] night:text-white/50">
          Sends as {segments} text segments.
        </p>
      ) : null}
    </div>
  );
}

/**
 * 模板的短信字数（Annie 2026-10-15：全部短信 300 个字符以内、不能有特殊字符）：
 * 字数按示例展开后算，特殊字符只查模板原文（示例值不算）。超了或有特殊字符不让存；已经存好的不动。
 */
function templateSms(filled: string, typed: string) {
  const c = smsCheck(filled, "Email", typed);
  const head = `${c.length.toLocaleString("en-US")} / ${SMS_CHAR_LIMIT} chars (with the variables filled in)`;
  const bad = c.bad.join(" ");
  return {
    over: c.over,
    text: c.bad.length
      ? `${head} - SMS can't use these characters: ${bad}`
      : c.length > SMS_CHAR_LIMIT
        ? `${head} - over the ${SMS_CHAR_LIMIT}-character limit`
        : head,
    problem: (what: string) =>
      c.bad.length
        ? `This ${what} has characters SMS can't use: ${bad}. Remove them before saving.`
        : `This ${what} is too long (${c.length.toLocaleString("en-US")} / ${SMS_CHAR_LIMIT} characters once the variables are filled in). Shorten it before saving.`,
  };
}

/** .field-card：抬头（标签 + 键名，Global 的右边一个 ⚠ Global）、红色提醒条、正文。 */
export function CardShell({
  label,
  keyName,
  global,
  hint,
  varWarn,
  ariaLabel,
  header,
  children,
}: {
  label: string;
  keyName?: string;
  global?: boolean;
  hint?: ReactNode;
  /** 有变量的字段：抬头下面一条「别删变量」的红条（.var-warning）。 */
  varWarn?: boolean;
  /** 默认用 label。 */
  ariaLabel?: string;
  /** 换掉默认的抬头（群发模板的抬头是名字输入框）。 */
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={ariaLabel ?? label}
      className={cn(
        "mb-2.5 overflow-hidden rounded-[10px] bg-paper text-[#1a1a1a] night:bg-white/[.04] night:text-white/90",
        global
          ? "border-[1.5px] border-[#dc2626] night:border-red-500/30"
          : "border border-black/10 night:border-white/10",
      )}
    >
      {header ?? (
        <div className="flex items-start justify-between gap-2.5 px-3.5 pt-2.5 pb-2">
          <div>
            <h3 className="text-[12px] leading-[1.4] font-semibold text-[#1a1a1a] night:text-white/90">
              {label}
            </h3>
            {keyName ? (
              <div className="mt-px font-mono text-[10px] text-[#1a1a1a] night:text-white/35">
                {keyName}
              </div>
            ) : null}
          </div>
          {global ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border border-[#fecaca] bg-[#fef2f2] px-[7px] py-0.5 text-[10px] font-semibold whitespace-nowrap text-[#dc2626] night:border-red-500/30 night:bg-red-500/10 night:text-red-300">
              ⚠ Global
            </span>
          ) : null}
        </div>
      )}
      {global ? (
        <div className={WARN_BAR}>
          ⚠ This text appears everywhere. Edit carefully.
        </div>
      ) : null}
      {varWarn ? <div className={WARN_BAR}>{VAR_WARN}</div> : null}
      {hint ? (
        <div className="px-3.5 pt-0 pb-1">
          <span className={HINT}>{hint}</span>
        </div>
      ) : null}
      <div className="px-3.5 pb-3">{children}</div>
    </section>
  );
}

/** 每行一条（存成换行分隔，空行去掉）；可拖动排序。 */
export function LinesCard({
  field,
  studio,
  global = false,
}: {
  field: TextField;
  studio: Studio;
  global?: boolean;
}) {
  const toLines = (s: string) => (s ? s.split("\n") : [""]);
  const join = (lines: string[]) =>
    lines
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
  const value = studio.draft(field.key);
  const [lines, setLines] = useState<string[]>(() => toLines(value));
  const [drag, setDrag] = useState<number | null>(null);
  const { state, savedAt, error, run } = useCardSave(studio);
  // 外面的值变了（撤销 / 保存后），本地行跟着变；本地编辑中的空行不因此丢失。
  const lastJoined = useRef(join(lines));
  if (value !== lastJoined.current && value !== join(lines)) {
    lastJoined.current = value;
    setLines(toLines(value));
  }
  const update = (next: string[]) => {
    setLines(next);
    const j = join(next);
    lastJoined.current = j;
    studio.setDraft(field.key, j);
  };
  const max = field.max ?? 3;
  const dirty = join(lines) !== join(toLines(studio.savedValue(field.key)));

  return (
    <CardShell
      label={field.label}
      keyName={field.key}
      global={global}
      hint={field.hint}
    >
      <div className="mb-1.5">
        {lines.map((l, i) => (
          <div
            key={i}
            className="mb-1.5 flex items-center gap-1.5 rounded-[6px] border border-[#e5e7eb] bg-paper px-2 py-[5px] hover:border-[#ccc] night:border-white/10 night:bg-white/[.03] night:hover:border-white/10"
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag === null || drag === i) return;
              const next = [...lines];
              const [moved] = next.splice(drag, 1);
              next.splice(i, 0, moved);
              setDrag(null);
              update(next);
            }}
          >
            <span aria-hidden className={HANDLE}>
              ⠿
            </span>
            <input
              aria-label={`${field.label} line ${i + 1}`}
              value={l}
              onFocus={() => studio.setActive(field.key)}
              onChange={(e) =>
                update(lines.map((x, j) => (j === i ? e.target.value : x)))
              }
              className="flex-1 border-none bg-transparent py-0.5 text-[12px] text-[#1a1a1a] outline-none night:text-white/90"
            />
            <button
              type="button"
              aria-label="Remove line"
              onClick={() =>
                update(
                  lines.length > 1 ? lines.filter((_, j) => j !== i) : [""],
                )
              }
              className="shrink-0 cursor-pointer border-none bg-transparent px-0.5 text-[16px] leading-none text-[#1a1a1a] hover:text-[#dc2626] night:text-white/35 night:hover:text-red-300"
            >
              ×
            </button>
          </div>
        ))}
        {lines.length < max ? (
          <button
            type="button"
            onClick={() => update([...lines, ""])}
            className={ADD_BTN}
          >
            + Add line
          </button>
        ) : (
          <p className="text-[11px] text-[#1a1a1a] night:text-white/55">
            Max {max} lines reached. Contact admin to add more.
          </p>
        )}
      </div>
      <CardFooter
        dirty={dirty}
        state={state}
        savedAt={savedAt}
        meta={editedLine(studio.saved[field.key])}
        extraError={error}
        onCancel={() =>
          studio.setDraft(field.key, studio.savedValue(field.key))
        }
        onSave={() => void run([field.key])}
      />
    </CardShell>
  );
}

/**
 * 门票「Prepare for Your Tour」：最多 3 步，每步标签 / 链接 / 说明。没写标签的步骤客人看不到，但内容保留
 * （旧页面没标签的步骤不显示，一保存就被清空；「+ Add step」有时点了没反应）。
 */
export function PrepStepsCard({
  tour,
  studio,
}: {
  tour: string;
  studio: Studio;
}) {
  const keys = Array.from({ length: PREP_STEPS }, (_, i) =>
    (["label", "url", "note"] as const).map((p) => prepKey(tour, i + 1, p)),
  );
  const hasAny = (n: number) =>
    keys[n].some((k) => studio.draft(k) || studio.savedValue(k));
  const initialShown = Math.max(
    1,
    ...Array.from({ length: PREP_STEPS }, (_, i) => (hasAny(i) ? i + 1 : 0)),
  );
  const [shown, setShown] = useState(initialShown);
  const { state, savedAt, error, run } = useCardSave(studio);
  const all = keys.flat();
  const dirty = all.some((k) => studio.draft(k) !== studio.savedValue(k));

  function move(from: number, to: number) {
    const values = keys.map((ks) => ks.map((k) => studio.draft(k)));
    const [m] = values.splice(from, 1);
    values.splice(to, 0, m);
    values.forEach((vals, i) =>
      vals.forEach((v, j) => studio.setDraft(keys[i][j], v)),
    );
  }

  return (
    <CardShell
      label="Prepare for Your Tour"
      keyName="prep steps (label / URL / note)"
    >
      {Array.from({ length: shown }, (_, i) => (
        <div key={i} className={STEP_GROUP}>
          <div className="mb-[5px] flex items-center justify-between gap-1.5">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={HANDLE}>
                ⠿
              </span>
              <span className="text-[11px] font-semibold text-[#1a1a1a] night:text-white/65">
                Step {i + 1}
              </span>
            </span>
            <span className="flex gap-2 text-[11px] text-[#1a1a1a] night:text-white/65">
              {i > 0 ? (
                <button
                  type="button"
                  onClick={() => move(i, i - 1)}
                  className="cursor-pointer hover:text-[#1a1a1a] night:hover:text-white/90"
                >
                  ↑
                </button>
              ) : null}
              {i < shown - 1 ? (
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  className="cursor-pointer hover:text-[#1a1a1a] night:hover:text-white/90"
                >
                  ↓
                </button>
              ) : null}
            </span>
          </div>
          {(
            [
              ["label", "Label (required — leave blank to hide)"],
              ["url", "Link URL (optional)"],
              ["note", "Note (optional)"],
            ] as const
          ).map(([part, placeholder], j) => (
            <input
              key={part}
              aria-label={`Step ${i + 1} ${part}`}
              value={studio.draft(keys[i][j])}
              placeholder={placeholder}
              onFocus={() => studio.setActive(keys[i][j])}
              onChange={(e) => studio.setDraft(keys[i][j], e.target.value)}
              className={INPUT}
            />
          ))}
        </div>
      ))}
      {shown < PREP_STEPS ? (
        <button
          type="button"
          onClick={() => setShown((n) => n + 1)}
          className={ADD_BTN}
        >
          + Add step
        </button>
      ) : (
        <p className="text-[11px] text-[#1a1a1a] night:text-white/55">
          Max {PREP_STEPS} steps. Contact admin to add more.
        </p>
      )}
      <CardFooter
        dirty={dirty}
        state={state}
        savedAt={savedAt}
        extraError={error}
        onCancel={() =>
          all.forEach((k) => studio.setDraft(k, studio.savedValue(k)))
        }
        onSave={() =>
          void run(all.filter((k) => studio.draft(k) !== studio.savedValue(k)))
        }
      />
    </CardShell>
  );
}

function puOrder(raw: string): string[] {
  const order = (raw || PU_DEFAULT_ORDER.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter((id) => (PU_DEFAULT_ORDER as readonly string[]).includes(id));
  for (const id of PU_DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
  return [...new Set(order)];
}

/** 客人页接客步骤的顺序。 */
export function PickupOrderCard({ studio }: { studio: Studio }) {
  const order = puOrder(studio.draft(PU_ORDER_KEY));
  const [drag, setDrag] = useState<number | null>(null);
  const { state, savedAt, error, run } = useCardSave(studio);
  const dirty =
    order.join(",") !== puOrder(studio.savedValue(PU_ORDER_KEY)).join(",");
  const set = (next: string[]) => studio.setDraft(PU_ORDER_KEY, next.join(","));
  return (
    <CardShell
      label="Pick-up steps — order on the guest page"
      keyName={PU_ORDER_KEY}
      global
    >
      <p className={cn(HINT, "mb-1.5")}>
        Drag steps up/down to change the order guests see them in. A step only
        shows for guests it actually applies to (e.g. &ldquo;Not sure where to
        go?&rdquo; only shows when that hotel has a Photo URL) — dragging it
        just changes where it lands when it does show.
      </p>
      {order.map((id, i) => (
        <div
          key={id}
          draggable
          onDragStart={() => setDrag(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (drag === null || drag === i) return;
            const next = [...order];
            const [m] = next.splice(drag, 1);
            next.splice(i, 0, m);
            setDrag(null);
            set(next);
          }}
          className={cn(STEP_GROUP, "flex items-center gap-1.5")}
        >
          <span aria-hidden className={HANDLE}>
            ⠿
          </span>
          <span className="flex-1 text-[12px]">{PU_STEP_LABELS[id] ?? id}</span>
          <span className="flex gap-1 text-[11px] text-[#1a1a1a] night:text-white/65">
            {i > 0 ? (
              <button
                type="button"
                aria-label="Move up"
                onClick={() =>
                  set(
                    order.map((x, j) =>
                      j === i - 1 ? id : j === i ? order[i - 1] : x,
                    ),
                  )
                }
              >
                ↑
              </button>
            ) : null}
            {i < order.length - 1 ? (
              <button
                type="button"
                aria-label="Move down"
                onClick={() =>
                  set(
                    order.map((x, j) =>
                      j === i + 1 ? id : j === i ? order[i + 1] : x,
                    ),
                  )
                }
              >
                ↓
              </button>
            ) : null}
          </span>
        </div>
      ))}
      <CardFooter
        dirty={dirty}
        state={state}
        savedAt={savedAt}
        meta={editedLine(studio.saved[PU_ORDER_KEY])}
        extraError={error}
        onCancel={() =>
          studio.setDraft(PU_ORDER_KEY, studio.savedValue(PU_ORDER_KEY))
        }
        onSave={() => {
          studio.setDraft(PU_ORDER_KEY, order.join(","));
          void run([PU_ORDER_KEY]);
        }}
      />
    </CardShell>
  );
}

/** 群发模板一个槽位：标题 + 正文（短信，按展开后算字数）。5–8 号能删。 */
export function BroadcastSlotCard({
  set,
  index,
  studio,
}: {
  set: BroadcastSet;
  index: number;
  studio: Studio;
}) {
  const tKey = bcTitleKey(set, index);
  const bKey = bcBodyKey(set, index);
  const title = studio.draft(tKey);
  const body = studio.draft(bKey);
  const builtin = index <= BC_BUILTIN;
  const dirty =
    title !== studio.savedValue(tKey) || body !== studio.savedValue(bKey);
  const { state, savedAt, error, run } = useCardSave(studio);
  const [deleting, setDeleting] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const smsText = fillSample(body.trim());
  const sms = templateSms(smsText, body.trim());
  const setName = set === "tour" ? "Tour" : "Tickets";

  function insert(v: string) {
    const el = ref.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    studio.setDraft(bKey, body.slice(0, start) + v + body.slice(end));
  }

  return (
    <CardShell
      label={`${setName} template ${index}`}
      varWarn
      header={
        <div className="flex items-start gap-2 px-3.5 pt-2.5 pb-2">
          <div className="flex-1">
            <input
              aria-label={`Template ${index} name`}
              value={title}
              placeholder="Template name"
              onFocus={() => studio.setActive(bKey)}
              onChange={(e) => studio.setDraft(tKey, e.target.value)}
              className="w-full rounded-[7px] border border-[#e5e7eb] bg-paper px-2.5 py-1.5 text-[13px] font-semibold text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-none night:border-white/10 night:bg-white/[.04] night:text-white/90 night:focus:border-white/40"
            />
            <div className="mt-px font-mono text-[10px] text-[#1a1a1a] night:text-white/35">
              {setName} · template {index}
              {builtin ? " (built-in)" : ""}
            </div>
          </div>
          {builtin ? (
            <span
              title="Built-in template — you can rename it and edit the text, but it cannot be deleted."
              className="cursor-default px-1 text-[13px] opacity-45"
            >
              🔒
            </span>
          ) : (
            <button
              type="button"
              aria-label="Delete template"
              title="Delete this template"
              onClick={() => setDeleting(true)}
              className="cursor-pointer rounded-[7px] border border-[#f3c0c0] bg-[#fff5f5] px-[9px] py-1 text-[13px] text-[#c0392b] hover:bg-[#fde8e8] night:bg-red-500/10 night:text-red-300"
            >
              🗑
            </button>
          )}
        </div>
      }
    >
      <textarea
        ref={ref}
        aria-label={`Template ${index} body`}
        value={body}
        rows={3}
        onFocus={() => studio.setActive(bKey)}
        onChange={(e) =>
          studio.setDraft(bKey, e.target.value.replace(/\r?\n/g, " "))
        }
        className={textareaClass(false)}
      />
      <InsertBar vars={BC_VARS} onInsert={insert} />
      <p
        className={cn(
          "mt-1 text-[10px] tabular-nums",
          sms.over
            ? "font-semibold text-[#c0392b] night:text-red-300"
            : "text-[#1a1a1a] night:text-white/50",
        )}
      >
        ≈ {sms.text}
      </p>
      <CardFooter
        dirty={dirty}
        state={state}
        savedAt={savedAt}
        extraError={error}
        onCancel={() => {
          studio.setDraft(tKey, studio.savedValue(tKey));
          studio.setDraft(bKey, studio.savedValue(bKey));
        }}
        onSave={() =>
          void run([tKey, bKey], () => {
            if (builtin && !title.trim()) {
              return "Built-in templates must keep a name. Clearing it would remove the template from the broadcast list, which is the same as deleting it.";
            }
            if (!title.trim() && body.trim()) {
              return "Give this template a name, or delete it with the trash icon. A template without a name is saved but never shows up in the broadcast list.";
            }
            if (sms.over) return sms.problem("broadcast template");
            return null;
          })
        }
      />
      {deleting ? (
        <ConfirmDialog
          title="Delete this template?"
          confirmLabel="Delete"
          busyLabel="Deleting…"
          danger
          onConfirm={async () => {
            studio.setDraft(tKey, "");
            studio.setDraft(bKey, "");
            const r = await studio.save([tKey, bKey]);
            setDeleting(false);
            return r.failed.length
              ? { status: "error", message: r.failed[0].message }
              : { status: "ok" };
          }}
          onClose={() => setDeleting(false)}
        >
          <p>This takes effect immediately.</p>
        </ConfirmDialog>
      ) : null}
    </CardShell>
  );
}
