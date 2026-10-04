"use client";

import { type ReactNode, useRef, useState } from "react";

import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { describeSmsLength, SMS_MAX } from "@/lib/sms-limit";
import type { TemplateSetting } from "@/lib/template-settings-api";
import { cn } from "@/lib/utils";

import {
  BC_BUILTIN,
  BC_VARS,
  type BroadcastSet,
  bcBodyKey,
  bcTitleKey,
  fillSample,
  PREP_STEPS,
  prepKey,
  PU_DEFAULT_ORDER,
  PU_ORDER_KEY,
  PU_STEP_LABELS,
  type TextField,
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

type SaveState = "idle" | "saving" | "saved" | "error";

const INPUT =
  "w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none";

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
function editedLine(s: TemplateSetting | undefined): ReactNode {
  if (!s?.updated_by) return <span className="text-stone-400">Original</span>;
  const iso =
    s.updated_at && !/[zZ]|[+-]\d\d:?\d\d$/.test(s.updated_at)
      ? `${s.updated_at}Z`
      : s.updated_at;
  const t = iso ? new Date(iso).getTime() : NaN;
  return (
    <span className="text-stone-500">
      Last edited by <b>{s.updated_by}</b>
      {Number.isNaN(t) ? "" : ` · ${LA_TIME.format(t)}`}
    </span>
  );
}

/** 卡片底部：Cancel（有改动才能点，先确认）+ Save（Saving… → Saved ✓ / Error）。 */
function CardFooter({
  dirty,
  state,
  onSave,
  onCancel,
  meta,
  extraError,
}: {
  dirty: boolean;
  state: SaveState;
  onSave: () => void;
  onCancel: () => void;
  meta?: ReactNode;
  extraError?: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>{meta}</span>
        <span className="flex gap-2">
          <button
            type="button"
            disabled={!dirty || state === "saving"}
            title="Discard the unsaved changes on this card and restore the last saved version"
            onClick={() => setConfirming(true)}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={state === "saving"}
            onClick={onSave}
            className={cn(
              PRIMARY_BUTTON_CLASS,
              state === "saved" && "bg-emerald-600 hover:bg-emerald-600",
              state === "error" && "bg-red-600 hover:bg-red-600",
            )}
          >
            {state === "saving"
              ? "Saving…"
              : state === "saved"
                ? "Saved ✓"
                : state === "error"
                  ? "Error"
                  : "Save"}
          </button>
        </span>
      </div>
      {extraError ? (
        <p role="alert" className="text-xs text-red-700">
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

/** 保存的通用流程：先校验，再存，按钮状态 2 秒后复原。 */
function useCardSave(studio: Studio) {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setState("idle"),
      result.failed.length ? 2500 : 2000,
    );
  }
  return { state, error, run };
}

/** 文本框旁边的「Insert:」按钮：在光标处插入变量。 */
function InsertBar({
  vars,
  onInsert,
}: {
  vars: string[];
  onInsert: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-stone-500">
      Insert:
      {vars.map((v) => (
        <button
          key={v}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(v)}
          className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-sky-800 hover:bg-sky-100"
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
  const { state, error, run } = useCardSave(studio);
  const ref = useRef<HTMLTextAreaElement>(null);
  const smsText = field.sms ? fillSample(value.trim()) : "";
  const sms = field.sms ? describeSmsLength(smsText) : null;
  const lost = missingVars(studio.savedValue(field.key), value, field.vars);

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
    >
      {field.vars?.length ? (
        <p className="mb-1 text-xs text-red-700">{VAR_WARN}</p>
      ) : null}
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
        className={cn(INPUT, "resize-y font-normal")}
      />
      {field.vars?.length ? (
        <InsertBar vars={field.vars} onInsert={insert} />
      ) : null}
      {sms ? (
        <p
          className={cn(
            "text-xs",
            sms.over ? "font-semibold text-red-600" : "text-stone-500",
          )}
        >
          ≈ {sms.text} (with the variables filled in)
        </p>
      ) : null}
      {lost.length ? (
        <p className="text-xs font-semibold text-amber-700">
          Removed variable(s): {lost.join(", ")} — the guest will not see that
          data.
        </p>
      ) : null}
      <CardFooter
        dirty={dirty}
        state={state}
        meta={editedLine(studio.saved[field.key])}
        extraError={error}
        onCancel={() =>
          studio.setDraft(field.key, studio.savedValue(field.key))
        }
        onSave={() =>
          void run([field.key], () =>
            field.sms && smsText.length > SMS_MAX
              ? `This SMS template is too long (${smsText.length.toLocaleString("en-US")} / ${SMS_MAX.toLocaleString("en-US")} characters once the variables are filled in). Twilio rejects anything over the limit, so the SMS would not go out at all. Shorten it before saving.`
              : null,
          )
        }
      />
    </CardShell>
  );
}

function CardShell({
  label,
  keyName,
  global,
  hint,
  children,
}: {
  label: string;
  keyName?: string;
  global?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border bg-white px-4 py-3",
        global ? "border-red-300" : "border-stone-200",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-stone-900">{label}</h3>
        {global ? (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
            ⚠ Global
          </span>
        ) : null}
      </div>
      {global ? (
        <p className="text-xs text-red-700">
          ⚠ This text appears everywhere. Edit carefully.
        </p>
      ) : null}
      {hint ? <p className="text-xs text-stone-500">{hint}</p> : null}
      {keyName ? (
        <code className="text-[10.5px] text-stone-400">{keyName}</code>
      ) : null}
      {children}
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
  const { state, error, run } = useCardSave(studio);
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
      <div className="flex flex-col gap-1.5">
        {lines.map((l, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5"
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
            <span aria-hidden className="cursor-grab text-stone-300">
              ⠿
            </span>
            <input
              aria-label={`${field.label} line ${i + 1}`}
              value={l}
              onFocus={() => studio.setActive(field.key)}
              onChange={(e) =>
                update(lines.map((x, j) => (j === i ? e.target.value : x)))
              }
              className={INPUT}
            />
            <button
              type="button"
              aria-label="Remove line"
              onClick={() =>
                update(
                  lines.length > 1 ? lines.filter((_, j) => j !== i) : [""],
                )
              }
              className="px-1 text-stone-400 hover:text-red-600"
            >
              ×
            </button>
          </div>
        ))}
        {lines.length < max ? (
          <button
            type="button"
            onClick={() => update([...lines, ""])}
            className="self-start text-xs font-semibold text-sky-700"
          >
            + Add line
          </button>
        ) : (
          <p className="text-xs text-stone-500">
            Max {max} lines reached. Contact admin to add more.
          </p>
        )}
      </div>
      <CardFooter
        dirty={dirty}
        state={state}
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
  const { state, error, run } = useCardSave(studio);
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
      keyName={`tmpl__tix__${tour}__prep_{1..3}_*`}
    >
      {Array.from({ length: shown }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-1 rounded-md border border-stone-200 bg-stone-50 p-2"
        >
          <div className="flex items-center justify-between text-xs text-stone-500">
            <span>Step {i + 1}</span>
            <span className="flex gap-2">
              {i > 0 ? (
                <button
                  type="button"
                  onClick={() => move(i, i - 1)}
                  className="hover:text-stone-800"
                >
                  ↑
                </button>
              ) : null}
              {i < shown - 1 ? (
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  className="hover:text-stone-800"
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
          className="self-start text-xs font-semibold text-sky-700"
        >
          + Add step
        </button>
      ) : (
        <p className="text-xs text-stone-500">
          Max {PREP_STEPS} steps. Contact admin to add more.
        </p>
      )}
      <CardFooter
        dirty={dirty}
        state={state}
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
  const { state, error, run } = useCardSave(studio);
  const dirty =
    order.join(",") !== puOrder(studio.savedValue(PU_ORDER_KEY)).join(",");
  const set = (next: string[]) => studio.setDraft(PU_ORDER_KEY, next.join(","));
  return (
    <CardShell
      label="Pick-up steps — order on the guest page"
      keyName={PU_ORDER_KEY}
      global
    >
      <p className="text-xs text-stone-500">
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
          className="flex items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm"
        >
          <span aria-hidden className="cursor-grab text-stone-300">
            ⠿
          </span>
          <span className="flex-1">{PU_STEP_LABELS[id] ?? id}</span>
          <span className="flex gap-1 text-xs text-stone-500">
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
  const { state, error, run } = useCardSave(studio);
  const [deleting, setDeleting] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const smsText = fillSample(body.trim());
  const sms = describeSmsLength(smsText);
  const setName = set === "tour" ? "Tour" : "Tickets";

  function insert(v: string) {
    const el = ref.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    studio.setDraft(bKey, body.slice(0, start) + v + body.slice(end));
  }

  return (
    <section
      aria-label={`${setName} template ${index}`}
      className="flex flex-col gap-1.5 rounded-lg border border-stone-200 bg-white px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <input
          aria-label={`Template ${index} name`}
          value={title}
          placeholder="Template name"
          onFocus={() => studio.setActive(bKey)}
          onChange={(e) => studio.setDraft(tKey, e.target.value)}
          className={cn(INPUT, "font-semibold")}
        />
        {builtin ? (
          <span title="Built-in template — you can rename it and edit the text, but it cannot be deleted.">
            🔒
          </span>
        ) : (
          <button
            type="button"
            aria-label="Delete template"
            onClick={() => setDeleting(true)}
            className="text-stone-400 hover:text-red-600"
          >
            🗑
          </button>
        )}
      </div>
      <p className="text-xs text-stone-500">
        {setName} · template {index}
        {builtin ? " (built-in)" : ""}
      </p>
      <p className="text-xs text-red-700">{VAR_WARN}</p>
      <textarea
        ref={ref}
        aria-label={`Template ${index} body`}
        value={body}
        rows={3}
        onFocus={() => studio.setActive(bKey)}
        onChange={(e) =>
          studio.setDraft(bKey, e.target.value.replace(/\r?\n/g, " "))
        }
        className={INPUT}
      />
      <InsertBar vars={BC_VARS} onInsert={insert} />
      <p
        className={cn(
          "text-xs",
          sms.over ? "font-semibold text-red-600" : "text-stone-500",
        )}
      >
        ≈ {sms.text}
      </p>
      <CardFooter
        dirty={dirty}
        state={state}
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
            if (smsText.length > SMS_MAX) {
              return `This broadcast template is too long (${smsText.length.toLocaleString("en-US")} / ${SMS_MAX.toLocaleString("en-US")} characters once the variables are filled in). Twilio rejects anything over the limit, so the SMS half would not go out at all. Shorten it before saving.`;
            }
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
    </section>
  );
}
