"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { previewTcGuestPage } from "@/lib/template-settings-api";
import { cn } from "@/lib/utils";

import {
  PU_DEFAULT_ORDER,
  PU_ORDER_KEY,
  TC_GLOBAL_FIELDS,
  TC_TOURS,
  tcGuestFields,
} from "./fields";
import type { Studio } from "./studio-cards";

/**
 * 128 / G299：Content Studio › Tour Confirmation › Guest Page 整页就地编辑。
 * Annie 2026-11-12：「把整个guest page画出来在里头改，这样staff也知道自己在改哪里，怎样改」；11-13「动手」。
 *
 * - 整页由后端真渲染（POST /api/template-settings/preview，module tc / tab guest_page），放进
 *   sandbox="allow-same-origin" 的 iframe（srcdoc）。⚠️ 安全要求 SA-1：不加 allow-scripts / allow-popups / allow-forms，
 *   iframe 里的 HTML、任何 tmpl__ 值都不当 HTML 放进父页面（编辑框只用 value / textContent）。
 *   父页面直接操作 iframe 的 DOM：注入编辑用的样式、在 document 上抓点击、插 + Add line / ↑↓（textContent 建的元素）。
 * - 默认「看的状态」= 客人真样子；Edit 进编辑状态（虚线框 + ✎，琥珀 = 所有团共用，蓝 = 只这个团）；
 *   点字弹小框（Apply 只改在页面上），蓝 Save 一次存完（只存改过的），Discard 放弃。
 * - 草稿就是 Content Studio 的 studio 草稿（同一份，List view、Global 标签看到的都一样）。
 */

const GLOBAL_PREFIX = "tmpl__global__tc_guest_";
const isGlobalKey = (k: string) => k.startsWith("tmpl__global__");
const isAddKey = (k: string) =>
  /(?:^tmpl__global__tc_guest_add_|__add_)[a-z]+_\d$/.test(k);
const isLinesKey = (k: string) => /__(?:extra_)?reminders$/.test(k);

/** 这个团的客人页会读的键（全局 tc_guest_*，和这个团的非邮件键）。 */
export function isTcGuestPageKey(k: string, tour: string): boolean {
  if (k.startsWith(GLOBAL_PREFIX)) return !k.includes("_mtlv_");
  const p = `tmpl__tc__${tour}__`;
  return k.startsWith(p) && !k.slice(p.length).startsWith("email_");
}

export const ADD_SLOT_NAMES: Record<string, string> = {
  pickup: "Pickup box",
  fee: "National Park Entry Fee box",
  lunch: "Lunch section",
  notes: "Notes section",
  submit: "Submit section",
};
const addKeys = (tour: string, slot: string) => [
  `tmpl__global__tc_guest_add_${slot}_1`,
  `tmpl__global__tc_guest_add_${slot}_2`,
  `tmpl__tc__${tour}__add_${slot}_1`,
  `tmpl__tc__${tour}__add_${slot}_2`,
];

const KNOWN_LABELS: Record<string, string> = {
  [`${GLOBAL_PREFIX}lunch_warn_title`]:
    "Lunch Selection Incomplete popup — title",
  [`${GLOBAL_PREFIX}lunch_warn_body`]:
    "Lunch Selection Incomplete popup — text",
  [`${GLOBAL_PREFIX}lunch_warn_back`]:
    "Lunch Selection Incomplete popup — back button",
  [`${GLOBAL_PREFIX}lunch_warn_continue`]:
    "Lunch Selection Incomplete popup — continue button",
};

function labelOf(studio: Studio, key: string, tour: string): string {
  const fromApi = studio.saved[key]?.label?.replace(
    /^\[TC Guest Page\]\s*/,
    "",
  );
  if (fromApi) return fromApi;
  if (KNOWN_LABELS[key]) return KNOWN_LABELS[key];
  const add = key.match(/add_([a-z]+)_(\d)$/);
  if (add && isAddKey(key)) {
    return `Added line — ${ADD_SLOT_NAMES[add[1]] ?? add[1]} (${add[2]}${isGlobalKey(key) ? "" : ", this tour only"})`;
  }
  const f = [...TC_GLOBAL_FIELDS, ...tcGuestFields(tour)].find(
    (x) => x.key === key,
  );
  return f?.label ?? key;
}

function hintOf(key: string): string | null {
  if (key === `${GLOBAL_PREFIX}lunch_hint`)
    return "{qty} is replaced with the party size.";
  if (key === `${GLOBAL_PREFIX}lunch_warn_body`)
    return "Keep {count} in the text — it is replaced with the number of guests. Can't be blank.";
  if (key.startsWith(`${GLOBAL_PREFIX}lunch_warn_`)) return "Can't be blank.";
  return null;
}

/** 块的小标签（编辑状态才出的三块，看的状态也出的两块：选餐区、Lunch 弹窗）。 */
const STATE_LABELS: Record<string, string> = {
  already_submitted: "Shown only if the guest already replied",
  date_modal: "Shown when the guest clicks Modify (date popup)",
  lunch: "Lunch selection — shown after the guest clicks YES",
  lunch_warn:
    "Popup — shown on Submit if fewer lunches are picked than the party size",
  last_update: "Shown after the guest sent a note",
};

/** 注入 iframe 的样式（常量，不含任何模板文字）。 */
const FRAME_CSS = `
[data-preview-state]{position:relative}
[data-preview-state]::before{display:block;width:max-content;max-width:calc(100% - 44px);margin:10px 22px 4px;padding:1px 6px;border-radius:4px;background:#e6ecf3;color:#5a6b80;font:600 10.5px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
${Object.entries(STATE_LABELS)
  .map(
    ([k, v]) =>
      `[data-preview-state=${k}]::before{content:${JSON.stringify(v)}}`,
  )
  .join("\n")}
html[data-cs-mode=view] [data-preview-state=already_submitted],
html[data-cs-mode=view] [data-preview-state=date_modal],
html[data-cs-mode=view] [data-preview-state=last_update]{display:none!important}
html[data-cs-mode=view] [data-empty]{display:none!important}
[data-empty][data-tmpl-key*="_add_"]{display:none!important}
html[data-cs-mode=edit] [data-tmpl-key]{outline:1.5px dashed rgba(96,165,250,.95);outline-offset:2px;border-radius:3px;cursor:pointer;position:relative}
html[data-cs-mode=edit] [data-tmpl-key^="tmpl__global__"]{outline-color:rgba(245,158,11,.8)}
html[data-cs-mode=edit] [data-tmpl-key]:hover{background:rgba(96,165,250,.12)}
html[data-cs-mode=edit] [data-tmpl-key^="tmpl__global__"]:hover{background:rgba(245,158,11,.14)}
html[data-cs-mode=edit] [data-tmpl-key]:hover::after{content:"\\270E";position:absolute;top:-9px;right:-9px;z-index:3;width:18px;height:18px;border-radius:50%;background:#1d4ed8;color:#fff;font:700 11px/18px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.3)}
html[data-cs-mode=edit] [data-tmpl-key^="tmpl__global__"]:hover::after{background:#b45309}
html[data-cs-mode=edit] [data-empty]{display:inline-block;min-width:150px;min-height:18px;color:#94a3b8;font:italic 12px/18px system-ui,sans-serif}
html[data-cs-mode=edit] [data-empty]::before{content:"Empty — click to add text"}
html[data-cs-mode=edit] [data-cs-sel]{outline-style:solid!important;outline-width:2px!important}
[data-cs-chg]{background:#fef3c7!important}
html[data-cs-mode=edit] [data-pickup-step]{position:relative;padding-right:52px}
.cs-mv{position:absolute;right:0;top:8px;display:flex;gap:3px}
.cs-mv span{width:22px;height:22px;border-radius:5px;border:1px solid #9db4cc;background:#fff;color:#1a3a5c;font:700 12px/20px system-ui,sans-serif;text-align:center;cursor:pointer}
.cs-mv span[aria-disabled=true]{opacity:.35;cursor:default}
.cs-add{display:inline-block;margin-top:8px;padding:3px 10px;border:1px solid #6b8e74;border-radius:6px;background:#6b8e74;color:#fff;font:600 12px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer}
.cs-add:hover{background:#5d7d66;border-color:#5d7d66}
.cs-full{margin-top:6px;color:#8a9bb0;font:11px/1.5 system-ui,sans-serif}
`;

type PopupTarget =
  { kind: "edit"; key: string } | { kind: "add"; slot: string };
type Popup = PopupTarget & { top: number; left: number };

type Status =
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; items: { label: string; message: string }[] };

const POPUP_W = 340;
const BTN =
  "h-7 cursor-pointer rounded-[8px] border border-white/15 bg-white/[.04] px-[11px] text-[12.5px] font-semibold whitespace-nowrap text-white hover:bg-white/10 disabled:cursor-default disabled:opacity-45";
const BTN_ON = "border-white/45 bg-white/[.16] font-bold";
const BTN_SAVE =
  "h-7 cursor-pointer rounded-[8px] border border-[#3b82f6] bg-[#3b82f6] px-[11px] text-[12.5px] font-semibold text-white hover:bg-[#2563eb] disabled:cursor-default disabled:opacity-45";

export function TcGuestEditor({
  studio,
  tour,
  onTourChange,
  onUnauthorized,
}: {
  studio: Studio;
  tour: string;
  onTourChange: (t: string) => void;
  onUnauthorized: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [list, setList] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [pendingTour, setPendingTour] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  /** 页面上出现过、但不在 GET 清单里的键（没种）：也算进改动里，存的时候后端会说清楚。 */
  const [touched, setTouched] = useState<string[]>([]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const docRef = useRef<Document | null>(null);

  const pageKeys = useMemo(() => {
    const s = new Set(
      [...Object.keys(studio.saved), ...touched].filter((k) =>
        isTcGuestPageKey(k, tour),
      ),
    );
    return [...s];
  }, [studio.saved, touched, tour]);
  const dirty = pageKeys.filter(
    (k) => studio.draft(k) !== studio.savedValue(k),
  );
  const overrides = Object.fromEntries(dirty.map((k) => [k, studio.draft(k)]));
  const overridesJson = JSON.stringify(overrides);

  const setDraft = useCallback(
    (key: string, value: string) => {
      studio.setDraft(key, value);
      if (!(key in studio.saved))
        setTouched((t) => (t.includes(key) ? t : [...t, key]));
      setStatus(null);
    },
    [studio],
  );

  // 最新的值给 iframe 里的点击用（监听挂在 iframe 的 document 上，不随渲染重挂）。
  const live = useRef({ editing, studio, tour, setDraft });
  live.current = { editing, studio, tour, setDraft };

  // ── 拉整页（防抖、取消旧请求；草稿变了带全部改动重拉）──
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      previewTcGuestPage({
        tourType: tour,
        overrides: JSON.parse(overridesJson) as Record<string, string>,
        signal: controller.signal,
      })
        .then((h) => {
          setHtml(h);
          setLoadError(null);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          if (isStatus(e, 401)) onUnauthorizedRef.current();
          else setLoadError(describeError(e));
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [tour, overridesJson, retry]);

  // 换团：旧团的页先拿掉（不显示别的团的字）。
  useEffect(() => {
    setHtml(null);
    setPopup(null);
  }, [tour]);

  const fitHeight = useCallback(() => {
    const f = frameRef.current;
    const d = docRef.current;
    if (!f || !d?.documentElement) return;
    f.style.height = `${d.documentElement.scrollHeight}px`;
  }, []);

  /** 按当前状态给 iframe 打标记：模式、改过的、↑↓、+ Add line。每次都先清掉上一次插的。 */
  const decorate = useCallback(() => {
    const d = docRef.current;
    if (!d?.documentElement) return;
    const { editing: ed, studio: st, tour: t } = live.current;
    d.documentElement.setAttribute("data-cs-mode", ed ? "edit" : "view");
    d.querySelectorAll("[data-cs-ui]").forEach((n) => n.remove());
    d.querySelectorAll("[data-cs-chg]").forEach((n) =>
      n.removeAttribute("data-cs-chg"),
    );
    d.querySelectorAll("[data-tmpl-key]").forEach((n) => {
      const k = n.getAttribute("data-tmpl-key") ?? "";
      if (st.draft(k) !== st.savedValue(k)) n.setAttribute("data-cs-chg", "1");
    });
    const orderChanged = st.draft(PU_ORDER_KEY) !== st.savedValue(PU_ORDER_KEY);
    const steps = [...d.querySelectorAll("[data-pickup-step]")];
    steps.forEach((n) => {
      if (orderChanged) n.setAttribute("data-cs-chg", "1");
    });
    if (ed) {
      steps.forEach((n, i) => {
        const id = n.getAttribute("data-pickup-step") ?? "";
        const box = d.createElement("span");
        box.className = "cs-mv";
        box.setAttribute("data-cs-ui", "");
        for (const [dir, txt, title] of [
          [-1, "↑", "Move up"],
          [1, "↓", "Move down"],
        ] as const) {
          const b = d.createElement("span");
          b.textContent = txt;
          b.title = title;
          b.setAttribute("role", "button");
          b.setAttribute("aria-label", title);
          b.setAttribute("data-cs-mv", `${id}|${dir}`);
          if ((dir < 0 && i === 0) || (dir > 0 && i === steps.length - 1))
            b.setAttribute("aria-disabled", "true");
          box.appendChild(b);
        }
        n.appendChild(box);
      });
      d.querySelectorAll("[data-add-slot]").forEach((anchor) => {
        const slot = anchor.getAttribute("data-add-slot") ?? "";
        const filled = addKeys(t, slot).filter((k) =>
          st.draft(k).trim(),
        ).length;
        const el = d.createElement(filled < 2 ? "span" : "div");
        el.setAttribute("data-cs-ui", "");
        if (filled < 2) {
          el.className = "cs-add";
          el.textContent = "+ Add line";
          el.setAttribute("role", "button");
          el.setAttribute("data-cs-add-slot", slot);
        } else {
          el.className = "cs-full";
          el.textContent = "2 lines added — the most for this part.";
        }
        anchor.appendChild(el);
      });
    }
    fitHeight();
  }, [fitHeight]);

  const openFor = useCallback((el: Element, p: PopupTarget) => {
    const wrap = frameRef.current?.parentElement;
    const r = el.getBoundingClientRect();
    const w = wrap?.clientWidth ?? 600;
    const width = Math.min(POPUP_W, w);
    docRef.current
      ?.querySelectorAll("[data-cs-sel]")
      .forEach((n) => n.removeAttribute("data-cs-sel"));
    if (p.kind === "edit") el.setAttribute("data-cs-sel", "1");
    setPopup({
      ...p,
      top: r.bottom + 8,
      left: Math.max(0, Math.min(r.left, w - width)),
    });
  }, []);

  const onDocClick = useCallback(
    (e: MouseEvent) => {
      // 客人页上的链接、按钮、表单在这里都不起作用。
      e.preventDefault();
      const { editing: ed, studio: st, setDraft: sd } = live.current;
      if (!ed) return;
      const t = e.target as Element | null;
      if (!t?.closest) return;
      const mv = t.closest("[data-cs-mv]");
      if (mv) {
        if (mv.getAttribute("aria-disabled") === "true") return;
        const [id, dir] = (mv.getAttribute("data-cs-mv") ?? "").split("|");
        const raw = st.draft(PU_ORDER_KEY) || PU_DEFAULT_ORDER.join(",");
        const order = raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const s of PU_DEFAULT_ORDER) if (!order.includes(s)) order.push(s);
        const i = order.indexOf(id);
        const j = i + Number(dir);
        if (i < 0 || j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j], order[i]];
        sd(PU_ORDER_KEY, order.join(","));
        setPopup(null);
        return;
      }
      const add = t.closest("[data-cs-add-slot]");
      if (add) {
        openFor(add, {
          kind: "add",
          slot: add.getAttribute("data-cs-add-slot") ?? "",
        });
        return;
      }
      const el = t.closest("[data-tmpl-key]");
      if (el) {
        openFor(el, {
          kind: "edit",
          key: el.getAttribute("data-tmpl-key") ?? "",
        });
        return;
      }
      setPopup(null);
    },
    [openFor],
  );

  const onFrameLoad = useCallback(() => {
    const d = frameRef.current?.contentDocument ?? null;
    docRef.current = d;
    if (!d?.head) return;
    const style = d.createElement("style");
    style.textContent = FRAME_CSS;
    d.head.appendChild(style);
    d.addEventListener("click", onDocClick);
    decorate();
  }, [decorate, onDocClick]);

  // 状态变了（Edit / 草稿 / 换团）也重新打标记；草稿变了还会重拉整页，拉回来 onLoad 再打一次。
  useEffect(() => {
    decorate();
  }, [decorate, editing, overridesJson, tour, html]);

  useEffect(() => {
    window.addEventListener("resize", fitHeight);
    return () => window.removeEventListener("resize", fitHeight);
  }, [fitHeight]);

  useEffect(() => {
    if (!popup) {
      docRef.current
        ?.querySelectorAll("[data-cs-sel]")
        .forEach((n) => n.removeAttribute("data-cs-sel"));
    }
  }, [popup]);

  const save = async (): Promise<boolean> => {
    if (!dirty.length) return true;
    setPopup(null);
    setStatus({ kind: "saving" });
    const keys = [...dirty];
    const r = await studio.save(keys);
    if (r.failed.length) {
      setStatus({
        kind: "error",
        items: r.failed.map((f) => ({
          label: labelOf(studio, f.key, tour),
          message: f.message,
        })),
      });
      return false;
    }
    setStatus({ kind: "saved" });
    setEditing(false);
    return true;
  };
  const discard = () => {
    for (const k of dirty) studio.setDraft(k, studio.savedValue(k));
    setPopup(null);
    setStatus(null);
    setEditing(false);
  };
  const askTour = (t: string) => {
    if (t === tour) return;
    if (dirty.length) {
      setPendingTour(t);
      return;
    }
    setStatus(null);
    onTourChange(t);
  };

  const n = dirty.length;
  return (
    <div data-tc-guest-editor>
      <div
        role="group"
        aria-label="Tour"
        className="mb-3 flex flex-wrap items-start gap-1.5"
      >
        {TC_TOURS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tour === t.key}
            onClick={() => askTour(t.key)}
            className={cn(
              "cursor-pointer rounded-[20px] border px-[11px] py-1 text-[11px] font-medium transition-all",
              tour === t.key
                ? "border-[#3a8c45] bg-[#3a8c45] text-white"
                : "border-white/10 bg-white/[.04] text-white/75 hover:border-white/40 hover:text-white/90",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5"
        data-guest-toolbar
      >
        <button
          type="button"
          aria-pressed={!list}
          className={cn(BTN, !list && BTN_ON)}
          onClick={() => {
            setList(false);
            setPopup(null);
          }}
        >
          Page view
        </button>
        <button
          type="button"
          aria-pressed={list}
          className={cn(BTN, list && BTN_ON)}
          onClick={() => {
            setList(true);
            setPopup(null);
          }}
        >
          List view
        </button>
        <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
        <span
          data-guest-mode
          className={cn(
            "rounded-full px-[9px] py-0.5 text-[11.5px] font-bold",
            editing
              ? "bg-amber-500/15 text-[#fde68a]"
              : "bg-white/[.08] text-[#cbd5e1]",
          )}
        >
          {editing ? "Editing" : "Viewing — this is what guests see"}
        </span>
        {editing ? (
          <>
            <button
              type="button"
              className={BTN}
              onClick={discard}
              disabled={status?.kind === "saving"}
            >
              Discard
            </button>
            <button
              type="button"
              data-guest-save
              className={BTN_SAVE}
              disabled={!n || status?.kind === "saving"}
              onClick={() => void save()}
            >
              Save
            </button>
          </>
        ) : (
          <button
            type="button"
            className={BTN}
            onClick={() => {
              setEditing(true);
              setStatus(null);
            }}
          >
            Edit
          </button>
        )}
        <span
          role="status"
          data-guest-status
          className="text-[12.5px] font-semibold"
        >
          {status?.kind === "saving" ? (
            <span className="text-[#cbd5e1]">Saving…</span>
          ) : n ? (
            <span className="text-[#f87171]">
              Not saved yet · {n} change{n > 1 ? "s" : ""}
            </span>
          ) : status?.kind === "saved" ? (
            <span className="text-[#22c55e]">Saved</span>
          ) : null}
        </span>
      </div>

      {status?.kind === "error" ? (
        <div
          role="alert"
          data-guest-error
          className="mb-2.5 rounded-[8px] border border-[#7f1d1d] bg-[#3a1418] px-2.5 py-2 text-[12.5px] text-[#fecaca]"
        >
          <b className="text-[#f87171]">Not saved:</b>
          <ul className="mt-1 list-disc pl-5">
            {status.items.map((it) => (
              <li key={it.label + it.message}>
                {it.label} — {it.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pendingTour ? (
        <div
          role="alert"
          data-guest-guard
          className="mb-2.5 flex flex-wrap items-center gap-2 rounded-[8px] border border-[#7f1d1d] bg-[#3a1418] px-2.5 py-2 text-[12.5px] text-[#fecaca]"
        >
          <span>You have unsaved changes on this page.</span>
          <button
            type="button"
            className={BTN_SAVE}
            onClick={async () => {
              const t = pendingTour;
              if (await save()) {
                setPendingTour(null);
                onTourChange(t);
              } else setPendingTour(null);
            }}
          >
            Save
          </button>
          <button
            type="button"
            className={BTN}
            onClick={() => {
              const t = pendingTour;
              discard();
              setPendingTour(null);
              onTourChange(t);
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className={BTN}
            onClick={() => setPendingTour(null)}
          >
            Stay
          </button>
        </div>
      ) : null}

      {editing && !list ? (
        <div
          data-guest-legend
          className="mb-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[12px] text-[#8fa3bb]"
        >
          <span>
            <i className="mr-1.5 inline-block h-[11px] w-[18px] rounded-[3px] border-[1.5px] border-dashed border-[#60a5fa] align-[-1px]" />
            Editable (this tour)
          </span>
          <span>
            <i className="mr-1.5 inline-block h-[11px] w-[18px] rounded-[3px] border-[1.5px] border-dashed border-[#f59e0b] align-[-1px]" />
            Shared by all tours
          </span>
          <span>
            <i className="mr-1.5 inline-block h-[11px] w-[18px] rounded-[3px] bg-[#fde68a] align-[-1px]" />
            Changed, not saved yet
          </span>
          <span className="max-sm:hidden">
            Click any outlined text to edit it. Nothing is saved until you click
            Save.
          </span>
        </div>
      ) : null}

      {list ? (
        <ListView
          studio={studio}
          tour={tour}
          keys={pageKeys}
          editing={editing}
          setDraft={setDraft}
        />
      ) : (
        <div className="relative" data-guest-stage>
          {loadError ? (
            <div
              role="alert"
              className="mb-2 rounded-[8px] border border-[#7f1d1d] bg-[#3a1418] px-2.5 py-2 text-[12.5px] text-[#fecaca]"
            >
              Could not draw the guest page: {loadError}{" "}
              <button
                type="button"
                className={cn(BTN, "ml-1")}
                onClick={() => setRetry((r) => r + 1)}
              >
                Retry
              </button>
            </div>
          ) : null}
          {html === null && !loadError ? (
            <div className="py-6 text-[13px] text-white/55">
              Loading the guest page…
            </div>
          ) : null}
          {html !== null ? (
            <div className="relative rounded-[10px] bg-[#f0f4f8]">
              {/* ⚠️ SA-1：只能 allow-same-origin。不要加 allow-scripts / allow-popups / allow-forms。 */}
              <iframe
                ref={frameRef}
                title="Guest page"
                sandbox="allow-same-origin"
                srcDoc={html}
                onLoad={onFrameLoad}
                className="block min-h-[400px] w-full rounded-[10px] border-0"
              />
              {popup ? (
                <EditPopup
                  key={popup.kind === "edit" ? popup.key : `add-${popup.slot}`}
                  popup={popup}
                  studio={studio}
                  tour={tour}
                  onClose={() => setPopup(null)}
                  setDraft={setDraft}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function EditPopup({
  popup,
  studio,
  tour,
  onClose,
  setDraft,
}: {
  popup: Popup;
  studio: Studio;
  tour: string;
  onClose: () => void;
  setDraft: (k: string, v: string) => void;
}) {
  const [text, setText] = useState(
    popup.kind === "edit" ? studio.draft(popup.key) : "",
  );
  const [scope, setScope] = useState<"tour" | "global">("tour");
  const [err, setErr] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    taRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shared =
    popup.kind === "edit" ? isGlobalKey(popup.key) : scope === "global";
  const apply = () => {
    if (popup.kind === "edit") {
      setDraft(popup.key, text);
      onClose();
      return;
    }
    const v = text.trim();
    if (!v) {
      onClose();
      return;
    }
    const ks = addKeys(tour, popup.slot);
    const free = (scope === "global" ? ks.slice(0, 2) : ks.slice(2)).find(
      (k) => !studio.draft(k).trim(),
    );
    if (!free) {
      setErr("This part already has 2 lines.");
      return;
    }
    setDraft(free, v);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label={popup.kind === "edit" ? "Edit text" : "Add a line"}
      data-guest-popup={popup.kind}
      style={{
        top: popup.top,
        left: popup.left,
        width: `min(${POPUP_W}px, 100%)`,
      }}
      className="absolute z-20 flex flex-col gap-2 rounded-[10px] border border-[#2c4a68] bg-[#0f1d2e] p-2.5 text-[13px] text-[#e6edf6] shadow-[0_10px_30px_rgba(0,0,0,.45)]"
    >
      {shared ? (
        <div
          data-shared-warn
          className="rounded-[6px] border border-amber-500/45 bg-amber-500/15 px-2 py-[5px] text-[12px] font-semibold text-[#fde68a]"
        >
          {popup.kind === "edit"
            ? "Shared by all tours — changing it here changes every tour's page."
            : "Shared by all tours — this line shows on every tour's page."}
        </div>
      ) : null}
      <div className="text-[11.5px] text-[#8fa3bb]">
        {popup.kind === "edit"
          ? `${labelOf(studio, popup.key, tour)}${isLinesKey(popup.key) ? " — one per line" : ""}`
          : `Add a line — ${ADD_SLOT_NAMES[popup.slot] ?? popup.slot}`}
      </div>
      {popup.kind === "add" ? (
        <div
          role="radiogroup"
          aria-label="Who sees it"
          className="flex gap-3 text-[12.5px]"
        >
          {(
            [
              ["tour", "This tour only"],
              ["global", "All tours"],
            ] as const
          ).map(([v, l]) => (
            <label key={v} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="cs-add-scope"
                value={v}
                checked={scope === v}
                onChange={() => setScope(v)}
              />
              {l}
            </label>
          ))}
        </div>
      ) : null}
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setErr(null);
        }}
        aria-label={
          popup.kind === "edit" ? labelOf(studio, popup.key, tour) : "New line"
        }
        className="min-h-[74px] w-full resize-y rounded-[7px] border border-[#2c4a68] bg-[#081321] p-2 text-[13px] leading-[1.5] text-white focus:outline-none"
      />
      {popup.kind === "edit" && hintOf(popup.key) ? (
        <div className="text-[11.5px] text-[#8fa3bb]">{hintOf(popup.key)}</div>
      ) : null}
      <div className="text-[11.5px] text-[#8fa3bb]">
        {popup.kind === "add"
          ? "Looks the same as the text around it. Nothing is saved until you click Save."
          : "Nothing is saved until you click Save."}
      </div>
      {err ? <div className="text-[12px] text-[#f87171]">{err}</div> : null}
      <div className="flex justify-end gap-1.5">
        {popup.kind === "edit" && isAddKey(popup.key) ? (
          <button
            type="button"
            className={cn(BTN, "mr-auto border-red-400/50 text-[#fca5a5]")}
            onClick={() => {
              setDraft(popup.key, "");
              onClose();
            }}
          >
            Remove line
          </button>
        ) : null}
        <button type="button" className={BTN} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={cn(BTN, BTN_ON)} onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  );
}

/** Q4 A：原来那样一条一条的表单，同一份草稿、同一个 Edit / Save；不在编辑状态时只读。只列有字的键。 */
function ListView({
  studio,
  tour,
  keys,
  editing,
  setDraft,
}: {
  studio: Studio;
  tour: string;
  keys: string[];
  editing: boolean;
  setDraft: (k: string, v: string) => void;
}) {
  const shown = keys.filter(
    (k) =>
      k !== PU_ORDER_KEY &&
      (studio.draft(k).trim() || studio.savedValue(k).trim()),
  );
  // 只管这个团的在前，共用的在后（同 Page view 的颜色：琥珀 = 共用）。
  shown.sort((a, b) => Number(isGlobalKey(a)) - Number(isGlobalKey(b)));
  return (
    <div
      data-guest-list
      className="flex flex-col gap-2.5 rounded-[10px] bg-white p-3.5 text-[13px] text-[#111827]"
    >
      <div className="text-[12px] text-[#6b7280]">
        List view — same text as the page.{" "}
        {editing
          ? "Changes here show on the page too; same Save."
          : "Click Edit to change it; same Save."}
      </div>
      {shown.map((k) => {
        const changed = studio.draft(k) !== studio.savedValue(k);
        return (
          <div key={k} data-list-key={k}>
            <label
              htmlFor={`gl-${k}`}
              className="text-[12px] font-semibold text-[#374151]"
            >
              {labelOf(studio, k, tour)}{" "}
              {isGlobalKey(k) ? (
                <span className="font-semibold text-[#b45309]">
                  Shared by all tours
                </span>
              ) : null}
            </label>
            <textarea
              id={`gl-${k}`}
              readOnly={!editing}
              value={studio.draft(k)}
              onChange={(e) => setDraft(k, e.target.value)}
              rows={isLinesKey(k) ? 4 : 2}
              className={cn(
                "mt-1 block w-full resize-y rounded-[7px] border border-[#cbd2dc] px-2 py-1.5 text-[13px] text-[#111827] focus:outline-none",
                changed ? "bg-[#fef3c7]" : "bg-white",
                !editing && "cursor-default text-[#374151]",
              )}
            />
          </div>
        );
      })}
    </div>
  );
}
