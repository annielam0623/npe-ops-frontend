"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
  effectiveMargin,
  effectivePalette,
  effectivePaper,
  effectivePlus,
  effectiveRules,
  effectiveSheet,
  isHexColor,
  MARGIN_MAX,
  MARGIN_MIN,
  ownBox,
  resolveBox,
  setBox,
  setText,
  TEXT_D_MAX,
  TEXT_D_MIN,
  textOf,
  type Paper,
  type PrintLayoutDefaults,
  type PrintLayoutSettings,
  type TicketRule,
} from "@/lib/print-layout";
import type { Orientation } from "@/lib/relay-list-settings-api";
import { cn } from "@/lib/utils";

import type { BoxDef } from "./boxes";
import type { TextElement } from "./text-elements";

/**
 * 版式设置弹窗里共用的几块（置顶 92 preview v2 ②）：Colours 每格一行（开关 + 颜色 + Reset）、
 * Ticket colours 规则表、Colour choices 色盘、Page 页（纸张 / 竖横 / 边距）。全部只改暂存的那份，Save 在弹窗底下。
 */

/** 添加键（只加在弹窗里、还要按 Save 才存）：灰绿 #6b8e74（Annie 2026-10-30）。 */
export const ADD_BTN =
  "inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-[#6b8e74] px-3 text-[12px] font-bold text-white hover:bg-[#5d7f66] disabled:cursor-not-allowed disabled:opacity-50";
export const LINK_BTN =
  "cursor-pointer border-0 bg-transparent p-0 text-[12px] text-[#2563eb] underline disabled:cursor-default disabled:opacity-40";
/** 改过的行：左边橙线（同 Aa Text size）。 */
export const CHANGED = "shadow-[inset_3px_0_0_#f59e0b] pl-2";

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-3 mb-1 text-[13px] font-semibold tracking-[.03em] text-[#475569] uppercase first:mt-0">
      {children}
    </h3>
  );
}

/** 开关（Coloured）：按钮，aria-pressed。 */
export function Toggle({
  on,
  disabled,
  label,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-layout-toggle={on ? "on" : "off"}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-block h-4 w-[30px] shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-default disabled:opacity-60",
        on ? "bg-[#22c55e]" : "bg-[#c7ccd1]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 size-3 rounded-full bg-white transition-[left]",
          on ? "left-4" : "left-0.5",
        )}
      />
    </button>
  );
}

/** 色块 + #rrggbb + 色盘里的几个快选（点一下就用那个色）。 */
export function ColorField({
  value,
  palette,
  disabled,
  label,
  onChange,
}: {
  value: string;
  palette: string[];
  disabled: boolean;
  label: string;
  onChange: (c: string) => void;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  useEffect(() => setText(value), [value]);
  return (
    <span className="relative inline-flex items-center gap-1.5">
      <input
        type="color"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        className="h-6 w-[34px] cursor-pointer rounded-[5px] border border-black/25 bg-transparent p-0 disabled:cursor-default"
      />
      <input
        type="text"
        aria-label={`${label} code`}
        value={text}
        disabled={disabled}
        maxLength={7}
        onChange={(e) => {
          const v = e.target.value.trim();
          setText(v);
          if (isHexColor(v)) onChange(v.toLowerCase());
        }}
        onBlur={() => setText(value)}
        className="h-[26px] w-[84px] rounded-[6px] border border-[#cbd5e1] px-1.5 font-mono text-[12.5px] disabled:bg-[#f8fafc]"
      />
      {palette.length && !disabled ? (
        <button
          type="button"
          aria-label={`${label}: colour choices`}
          aria-expanded={open}
          data-layout-palette-open
          onClick={() => setOpen((v) => !v)}
          className="h-[26px] cursor-pointer rounded-[6px] border border-[#cbd5e1] bg-white px-1.5 text-[11px] text-[#334155]"
        >
          ▾
        </button>
      ) : null}
      {open ? (
        <span
          data-layout-palette-pop
          className="absolute top-full left-0 z-20 mt-1 flex w-max max-w-[260px] flex-wrap gap-1.5 rounded-[8px] border border-black/15 bg-white p-2 shadow-[0_8px_24px_rgba(0,0,0,.15)]"
        >
          {palette.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Use ${c}`}
              data-layout-pick={c}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className={cn(
                "size-6 cursor-pointer rounded-[4px] border",
                c === value
                  ? "border-[#1d4ed8] ring-2 ring-[#93c5fd]"
                  : "border-black/30",
              )}
              style={{ background: c }}
            />
          ))}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Colours 页的格子清单。tourId = null 是 All tours 那一层；选了团就是那个团自己的一层（盖过 All tours）。
 * dataColor(key) = 页面数据里这一格现在的颜色（默认没有固定色的那几种，例如 Shuttle 节）。
 * renderSpecial(def) = bus_header / section 这两行后面另画的东西（按字母 / 按节）。
 */
export function BoxRows({
  boxes,
  settings,
  defaults,
  tourId,
  canEdit,
  dataColor,
  renderSpecial,
  onChange,
}: {
  boxes: BoxDef[];
  settings: PrintLayoutSettings;
  defaults: PrintLayoutDefaults;
  tourId: string | null;
  canEdit: boolean;
  dataColor?: (key: string) => string | null;
  renderSpecial?: (def: BoxDef, on: boolean) => ReactNode;
  onChange: (next: PrintLayoutSettings) => void;
}) {
  const palette = effectivePalette(settings, defaults);
  const main = boxes.filter((b) => !b.extra);
  const extra = boxes.filter((b) => b.extra);
  const row = (def: BoxDef) => {
    const r = resolveBox(settings, defaults, def.key, tourId);
    const own = ownBox(settings, def.key, tourId);
    const color =
      r.color ??
      dataColor?.(def.key) ??
      defaults.boxes[def.key]?.color ??
      "#ffffff";
    return (
      <div
        key={def.key}
        data-layout-box={def.key}
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#eef0f2] py-1.5 text-[12.5px]",
          own && CHANGED,
        )}
      >
        <span className="w-[230px] font-medium max-sm:w-full">{def.label}</span>
        <Toggle
          on={r.on}
          disabled={!canEdit}
          label={`${def.label}: coloured`}
          onChange={(on) =>
            onChange(setBox(settings, def.key, tourId, { ...own, on }))
          }
        />
        {def.kind === "colour" ? (
          <ColorField
            value={color}
            palette={palette}
            disabled={!canEdit || !r.on}
            label={`${def.label} colour`}
            onChange={(c) =>
              onChange(setBox(settings, def.key, tourId, { ...own, color: c }))
            }
          />
        ) : def.kind === "toggle" ? (
          <span className="text-[12px] text-[#64748b]">{def.note}</span>
        ) : def.kind === "colour_or_own" ? (
          r.color ? (
            <ColorField
              value={r.color}
              palette={palette}
              disabled={!canEdit || !r.on}
              label={`${def.label} colour`}
              onChange={(c) =>
                onChange(setBox(settings, def.key, tourId, { ...own, color: c }))
              }
            />
          ) : (
            <span className="flex items-center gap-2 text-[12px] text-[#64748b]">
              <span data-layout-own-colour={def.key}>{def.note}</span>
              {canEdit && r.on ? (
                <button
                  type="button"
                  className={LINK_BTN}
                  data-layout-pick-colour={def.key}
                  onClick={() =>
                    onChange(
                      setBox(settings, def.key, tourId, {
                        ...own,
                        color: palette[0] ?? "#fff200",
                      }),
                    )
                  }
                >
                  Choose a colour
                </button>
              ) : null}
            </span>
          )
        ) : (
          renderSpecial?.(def, r.on)
        )}
        <span className="flex-1" />
        {own && canEdit ? (
          <button
            type="button"
            className={LINK_BTN}
            data-layout-reset={def.key}
            onClick={() => onChange(setBox(settings, def.key, tourId, null))}
          >
            Reset
          </button>
        ) : null}
      </div>
    );
  };
  return (
    <>
      {main.map(row)}
      {extra.length ? (
        <>
          <p className="mt-2 text-[12px] text-[#64748b]">
            Whole columns (off until you turn one on):
          </p>
          {extra.map(row)}
        </>
      ) : null}
    </>
  );
}

/** Ticket colours：规则表（Text contains … → colour），+ Add / Remove，最后一行「Any other ticket with +」。 */
export function TicketRules({
  settings,
  defaults,
  canEdit,
  onChange,
}: {
  settings: PrintLayoutSettings;
  defaults: PrintLayoutDefaults;
  canEdit: boolean;
  onChange: (next: PrintLayoutSettings) => void;
}) {
  const rules = effectiveRules(settings, defaults);
  const plus = effectivePlus(settings, defaults);
  const palette = effectivePalette(settings, defaults);
  const changed = settings.ticket_rules !== null;
  const set = (next: TicketRule[]) =>
    onChange({ ...settings, ticket_rules: next });
  return (
    <div data-layout-ticket-rules className={cn(changed && CHANGED)}>
      <p className="mb-1 text-[12px] text-[#64748b]">
        The first rule that matches the Quantities text wins.
      </p>
      {rules.map((r, i) => (
        <div
          key={i}
          data-layout-rule={i}
          className="flex flex-wrap items-center gap-2 py-1 text-[12.5px]"
        >
          <span>Text contains</span>
          <input
            type="text"
            aria-label={`Rule ${i + 1} text`}
            value={r.contains}
            disabled={!canEdit}
            maxLength={60}
            onChange={(e) =>
              set(
                rules.map((x, j) =>
                  j === i ? { ...x, contains: e.target.value } : x,
                ),
              )
            }
            className="h-[26px] w-[160px] rounded-[6px] border border-[#cbd5e1] px-1.5 disabled:bg-[#f8fafc]"
          />
          <Toggle
            on={r.color !== null}
            disabled={!canEdit}
            label={`Rule ${i + 1}: coloured`}
            onChange={(on) =>
              set(
                rules.map((x, j) =>
                  j === i
                    ? { ...x, color: on ? (palette[0] ?? "#fff200") : null }
                    : x,
                ),
              )
            }
          />
          {r.color !== null ? (
            <ColorField
              value={r.color}
              palette={palette}
              disabled={!canEdit}
              label={`Rule ${i + 1} colour`}
              onChange={(c) =>
                set(rules.map((x, j) => (j === i ? { ...x, color: c } : x)))
              }
            />
          ) : (
            <span className="text-[12px] text-[#64748b]">No colour</span>
          )}
          <span className="flex-1" />
          {canEdit ? (
            <button
              type="button"
              className={LINK_BTN}
              data-layout-rule-remove={i}
              onClick={() => set(rules.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 py-1 text-[12.5px]">
        <span>Any other ticket with “+”</span>
        <Toggle
          on={plus !== null}
          disabled={!canEdit}
          label="Other tickets with +: coloured"
          onChange={(on) =>
            onChange(
              setBox(settings, "ticket_plus", null, {
                ...ownBox(settings, "ticket_plus", null),
                on,
              }),
            )
          }
        />
        {plus !== null ? (
          <ColorField
            value={plus}
            palette={palette}
            disabled={!canEdit}
            label="Other tickets with + colour"
            onChange={(c) =>
              onChange(
                setBox(settings, "ticket_plus", null, {
                  ...ownBox(settings, "ticket_plus", null),
                  color: c,
                }),
              )
            }
          />
        ) : null}
      </div>
      {canEdit ? (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={ADD_BTN}
            data-layout-rule-add
            onClick={() =>
              set([...rules, { contains: "", color: palette[0] ?? "#fff200" }])
            }
          >
            + Add ticket colour
          </button>
          {changed || ownBox(settings, "ticket_plus", null) ? (
            <button
              type="button"
              className={LINK_BTN}
              data-layout-rules-reset
              onClick={() =>
                onChange({
                  ...setBox(settings, "ticket_plus", null, null),
                  ticket_rules: null,
                })
              }
            >
              Reset ticket colours
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Colour choices：色盘，+ Add colour（加当前色块里的颜色）/ × 删掉。 */
export function PaletteEditor({
  settings,
  defaults,
  canEdit,
  onChange,
}: {
  settings: PrintLayoutSettings;
  defaults: PrintLayoutDefaults;
  canEdit: boolean;
  onChange: (next: PrintLayoutSettings) => void;
}) {
  const palette = effectivePalette(settings, defaults);
  const [pick, setPick] = useState("#dbeafe");
  const set = (next: string[]) => onChange({ ...settings, palette: next });
  return (
    <div
      data-layout-palette
      className={cn(settings.palette !== null && CHANGED)}
    >
      <div className="flex flex-wrap items-center gap-2">
        {palette.map((c) => (
          <span key={c} className="relative inline-block">
            <span
              data-layout-palette-colour={c}
              title={c}
              className="block size-6 rounded-[4px] border border-black/30"
              style={{ background: c }}
            />
            {canEdit ? (
              <button
                type="button"
                aria-label={`Remove ${c}`}
                onClick={() => set(palette.filter((x) => x !== c))}
                className="absolute -top-[7px] -right-[7px] size-3.5 cursor-pointer rounded-full bg-[#555] text-[10px] leading-[14px] text-white"
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
        {canEdit ? (
          <>
            <input
              type="color"
              aria-label="New colour"
              value={pick}
              onChange={(e) => setPick(e.target.value.toLowerCase())}
              className="ml-2 h-6 w-[34px] cursor-pointer rounded-[5px] border border-black/25 bg-transparent p-0"
            />
            <button
              type="button"
              className={ADD_BTN}
              data-layout-palette-add
              disabled={palette.includes(pick)}
              onClick={() => set([...palette, pick])}
            >
              + Add colour
            </button>
            {settings.palette !== null ? (
              <button
                type="button"
                className={LINK_BTN}
                onClick={() => onChange({ ...settings, palette: null })}
              >
                Reset
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      <p className="mt-1 text-[12px] text-[#64748b]">
        The colours offered in every colour picker on this page. You can also
        type any colour as #rrggbb.
      </p>
    </div>
  );
}

const SEG = "inline-flex overflow-hidden rounded-[7px] border border-[#9aa]";
const SEG_BTN =
  "cursor-pointer border-r border-[#9aa] bg-white px-2.5 py-1 text-[12px] font-bold text-[#222] last:border-r-0 disabled:cursor-default disabled:opacity-60 aria-pressed:bg-[#1f2937] aria-pressed:text-white";

/** Page 页：纸张、每种单竖 / 横（sheets 给了才出）、四边一个边距。 */
export function PagePanel({
  settings,
  defaults,
  canEdit,
  sheets,
  note,
  marginNote,
  children,
  onChange,
}: {
  /** 没设边距时现在的边距（例「12 × 11 mm」）。 */
  marginNote: string;
  settings: PrintLayoutSettings;
  defaults: PrintLayoutDefaults;
  canEdit: boolean;
  sheets: { key: string; label: string }[];
  note: string;
  /** Relay list：每张单的方向照旧在 relay_list 设置里，放在这里一起画。 */
  children?: ReactNode;
  onChange: (next: PrintLayoutSettings) => void;
}) {
  const paper = effectivePaper(settings, defaults);
  const margin = effectiveMargin(settings, defaults);
  const [text, setText] = useState(margin === null ? "" : String(margin));
  useEffect(() => setText(margin === null ? "" : String(margin)), [margin]);
  const setPage = (p: Partial<PrintLayoutSettings["page"]>) =>
    onChange({ ...settings, page: { ...settings.page, ...p } });
  const bad =
    text.trim() !== "" &&
    !(
      /^\d+$/.test(text.trim()) &&
      Number(text) >= MARGIN_MIN &&
      Number(text) <= MARGIN_MAX
    );
  return (
    <div data-layout-page className="flex flex-col">
      <PageRow label="Paper" changed={settings.page.paper !== null}>
        <span className={SEG}>
          {(["a4", "letter"] as Paper[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={paper === p}
              data-layout-paper={p}
              disabled={!canEdit}
              onClick={() =>
                setPage({ paper: p === defaults.page.paper ? null : p })
              }
              className={SEG_BTN}
            >
              {p === "a4" ? "A4" : "Letter"}
            </button>
          ))}
        </span>
      </PageRow>
      {sheets.map((s) => {
        const o = effectiveSheet(settings, defaults, s.key);
        return (
          <PageRow
            key={s.key}
            label={s.label}
            changed={!!settings.page.sheets[s.key]}
          >
            <span className={SEG} data-layout-sheet={s.key}>
              {(["portrait", "landscape"] as Orientation[]).map((x) => (
                <button
                  key={x}
                  type="button"
                  aria-pressed={o === x}
                  disabled={!canEdit}
                  onClick={() =>
                    setPage({
                      sheets: {
                        ...settings.page.sheets,
                        [s.key]: x === defaults.page.sheets[s.key] ? null : x,
                      },
                    })
                  }
                  className={SEG_BTN}
                >
                  {x === "portrait" ? "Portrait" : "Landscape"}
                </button>
              ))}
            </span>
          </PageRow>
        );
      })}
      {children}
      <PageRow label="Margins" changed={settings.page.margin_mm !== null}>
        <input
          type="text"
          inputMode="numeric"
          aria-label="Margins in mm"
          data-layout-margin
          value={text}
          disabled={!canEdit}
          placeholder={defaults.page.margin_mm === null ? "Default" : undefined}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            const n = Number(v);
            if (v.trim() === "") setPage({ margin_mm: null });
            else if (
              /^\d+$/.test(v.trim()) &&
              n >= MARGIN_MIN &&
              n <= MARGIN_MAX
            )
              setPage({
                margin_mm: n === defaults.page.margin_mm ? null : n,
              });
          }}
          className="h-[26px] w-[64px] rounded-[6px] border border-[#cbd5e1] px-1.5 text-[12.5px] disabled:bg-[#f8fafc]"
        />
        <span className="text-[12px] text-[#64748b]">
          mm on every side (default{" "}
          {defaults.page.margin_mm !== null
            ? `${defaults.page.margin_mm} mm`
            : marginNote}
          )
        </span>
        {bad ? (
          <span role="alert" className="basis-full text-[12px] text-[#dc2626]">
            Enter a whole number from {MARGIN_MIN} to {MARGIN_MAX}.
          </span>
        ) : null}
      </PageRow>
      <p className="mt-2 text-[12px] text-[#64748b]">{note}</p>
    </div>
  );
}

export function PageRow({
  label,
  changed,
  children,
}: {
  label: string;
  changed?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2.5 border-b border-[#eef0f2] py-2 text-[12.5px]",
        changed && CHANGED,
      )}
    >
      <span className="w-[120px] font-medium">{label}</span>
      {children}
    </div>
  );
}

export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1.5 px-[18px] pt-2.5">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          data-layout-tab={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "cursor-pointer rounded-t-[7px] border border-b-0 px-3.5 py-1 text-[12.5px] font-semibold",
            value === t.key
              ? "border-[#1a1a1a] bg-[#1a1a1a] text-white"
              : "border-[#c9ced4] bg-[#f4f4f2] text-[#1a1a1a]",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Text 页（置顶 92 第 2 批）：选一种版式，每种字一行「− 16.5 px +」+ Regular / Bold + Reset。
 * 存的是加减（07：−4..+12 px），显示的是加好的大小。
 */
export function TextPanel({
  settings,
  canEdit,
  layouts,
  layout,
  onLayout,
  elements,
  note,
  onChange,
}: {
  settings: PrintLayoutSettings;
  canEdit: boolean;
  layouts: readonly { key: string; label: string }[];
  layout: string;
  onLayout: (l: string) => void;
  elements: TextElement[];
  note: string;
  onChange: (next: PrintLayoutSettings) => void;
}) {
  return (
    <div data-layout-text className="flex flex-col">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[12.5px]">
        <span>{layouts.length > 2 ? "Layout" : "Sheet"}</span>
        <span className={SEG}>
          {layouts.map((l) => (
            <button
              key={l.key}
              type="button"
              aria-pressed={layout === l.key}
              data-layout-text-layout={l.key}
              onClick={() => onLayout(l.key)}
              className={SEG_BTN}
            >
              {l.label}
            </button>
          ))}
        </span>
      </div>
      {elements.map((el) => {
        const t = textOf(settings, layout, el.key);
        const own = settings.text[layout]?.[el.key];
        const bold = t.bold ?? el.bold;
        const px = Math.round((el.px + t.d) * 10) / 10;
        return (
          <PageRow key={el.key} label={el.label} changed={!!own}>
            <span className={SEG} data-layout-text-el={el.key}>
              <button
                type="button"
                aria-label={`${el.label} smaller`}
                disabled={!canEdit || t.d <= TEXT_D_MIN}
                onClick={() =>
                  onChange(setText(settings, layout, el.key, { ...t, d: t.d - 1 }))
                }
                className={SEG_BTN}
              >
                −
              </button>
              <span
                data-layout-text-px
                className="inline-block min-w-[64px] border-r border-[#9aa] bg-white px-2 py-1 text-center text-[12px] font-bold tabular-nums"
              >
                {px} px
              </span>
              <button
                type="button"
                aria-label={`${el.label} bigger`}
                disabled={!canEdit || t.d >= TEXT_D_MAX}
                onClick={() =>
                  onChange(setText(settings, layout, el.key, { ...t, d: t.d + 1 }))
                }
                className={SEG_BTN}
              >
                +
              </button>
            </span>
            <span className={SEG}>
              {([false, true] as const).map((b) => (
                <button
                  key={String(b)}
                  type="button"
                  aria-pressed={bold === b}
                  disabled={!canEdit}
                  onClick={() =>
                    onChange(
                      setText(settings, layout, el.key, {
                        d: t.d,
                        ...(b === el.bold ? {} : { bold: b }),
                      }),
                    )
                  }
                  className={SEG_BTN}
                >
                  {b ? "Bold" : "Regular"}
                </button>
              ))}
            </span>
            {own && canEdit ? (
              <button
                type="button"
                className={LINK_BTN}
                data-layout-text-reset={el.key}
                onClick={() => onChange(setText(settings, layout, el.key, null))}
              >
                Reset
              </button>
            ) : null}
          </PageRow>
        );
      })}
      <p className="mt-2 text-[12px] text-[#64748b]">{note}</p>
    </div>
  );
}
