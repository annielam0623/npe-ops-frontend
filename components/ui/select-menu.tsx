"use client";

import {
  Children,
  type CSSProperties,
  Fragment,
  isValidElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * 全站统一的下拉（Annie 2026-11-21「全站一起改。我要求的下拉菜单排列整齐，字体统一，颜色统一」；
 * preview https://claude.ai/artifact/NBeBrZJELNg1Y8vJcb5pxa v2，题 1 A / 题 2 她改的 / 题 3 A / 题 4 A，「动手」）。
 * 取代原生 <select>：原生的列表是浏览器 / 系统画的（系统字体、蓝底选中、跟着选中项弹出、盖住按钮），样式管不到。
 *
 * - 合起来的按钮：保留各页原来的 className（形状、大小、状态颜色），字体字号由 globals.css 的 [data-select-menu] 统一（题 1 A）。
 * - 点开的菜单：从按钮正下方 4px 展开、左对齐、至少跟按钮一样宽；宽度跟着最长的选项撑开，不截断、不加「…」，
 *   只受屏幕限制（离边 16px，靠右往左挪）；比屏幕还长的那一项才在菜单里换行（题 2）。每行一样高、左对齐。
 * - 选中项只加粗，不打 ✓、没有蓝底、不另留一列（Annie 2026-11-21「我不要打勾，我就要点击那个选项就好了」）：
 *   每项就是它自己的文字，和别的项左边对齐；停留 / 键盘移到的那项浅灰底。night 主题深底白字。
 * - 键盘：Enter / 空格 / ↑ / ↓ 打开，↑ ↓ 移动，Enter 选，Esc 关（不连带关弹窗），Tab 关，打字跳到那个字开头的项。
 * - 选项超过 searchThreshold（默认 15）个：菜单顶上出搜索框（题 4 A）。
 * - 手机上也用这个菜单（题 3 A）。行距收紧（Annie「然后行间距别做那么宽」「A，下拉菜单」）：电脑每行 28px、手机 32px。
 * - 菜单挂在 document.body（fixed），表格的 overflow、弹窗都挡不住它。
 *
 * 只换样子：value / onChange 的意思跟原来的 <select> 一样（字符串值），选了以后做什么由页面决定。
 */

export interface SelectMenuOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
  /** 这一项文字的额外样子（只用来保留 Annie 指定过的样子，例如 Dispatch Add hotel 里蓝色的「~~~~~ Shuttle Pick up ~~~~~」）。 */
  className?: string;
}

export interface SelectMenuGroup<V extends string = string> {
  /** 分组标题（同原来的 <optgroup label>）。 */
  group: string;
  options: SelectMenuOption<V>[];
}

export type SelectMenuItem<V extends string = string> =
  SelectMenuOption<V> | SelectMenuGroup<V>;

type DataAttrs = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

export type SelectMenuProps<V extends string = string> = {
  value: V;
  onChange: (next: V) => void;
  options: readonly SelectMenuItem<V>[];
  /** 读屏名字（同原来 select 的 aria-label）。aria-label / aria-labelledby 至少给一个。 */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  id?: string;
  /** 表单里要提交时给 name：多一个隐藏 input 带当前值。 */
  name?: string;
  disabled?: boolean;
  /** 合起来那个按钮的 className（照原来 select 的样子：边框、圆角、高度、状态颜色）。 */
  className?: string;
  /** 按钮里显示什么；不给 = 选中项的文字。 */
  renderValue?: (selected: SelectMenuOption<V> | undefined) => ReactNode;
  /** 按钮后面的 ▾；页面自己画了箭头时传 false。 */
  caret?: boolean;
  /** 页面底色：light = 白卡片 / 浅色页（night 主题自动变深）；dark = 本来就是深底的页面。 */
  tone?: "light" | "dark";
  /** 超过这么多个选项出搜索框（题 4 A）。 */
  searchThreshold?: number;
  /** 选了这个值以后菜单不关（例如 Custom 要接着在 footer 里填日期）。 */
  stayOpenOn?: (value: V) => boolean;
  /** 菜单最下面的一块（例如 Custom 的两个日期 + Apply）；close() 关菜单。 */
  footer?: (close: () => void) => ReactNode;
  title?: string;
  /** 按钮的 style（例如原来 select 用背景图画的箭头）。 */
  style?: CSSProperties;
} & DataAttrs;

function isGroup<V extends string>(
  item: SelectMenuItem<V>,
): item is SelectMenuGroup<V> {
  return "group" in item;
}

/** 把选项摊平（分组标题不算选项）。 */
export function flattenSelectOptions<V extends string>(
  items: readonly SelectMenuItem<V>[],
): SelectMenuOption<V>[] {
  return items.flatMap((i) => (isGroup(i) ? i.options : [i]));
}

/** 字（React 子节点里的文字、数字）拼起来。 */
function textOfNode(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOfNode).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return textOfNode(node.props.children);
  return "";
}

/**
 * 共用小件（LegacySelect、导入弹窗等）由外面传进 <option> / <optgroup>：照原样读成 SelectMenu 的选项，调用的页面不用改。
 * 文字照 JSX 拼起来（多个空白并成一个、去掉头尾空白）。
 */
export function optionsFromChildren(children: ReactNode): SelectMenuItem[] {
  const out: SelectMenuItem[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return;
    const p = child.props as {
      value?: string | number;
      disabled?: boolean;
      label?: string;
      className?: string;
      children?: ReactNode;
    };
    if (child.type === Fragment) {
      out.push(...optionsFromChildren(p.children));
    } else if (child.type === "optgroup") {
      out.push({
        group: String(p.label ?? ""),
        options: flattenSelectOptions(optionsFromChildren(p.children)),
      });
    } else if (child.type === "option") {
      const label = textOfNode(p.children).replace(/\s+/g, " ").trim();
      out.push({
        value: String(p.value ?? label),
        label,
        ...(p.disabled ? { disabled: true } : {}),
      });
    }
  });
  return out;
}

const EDGE = 16;
const GAP = 4;
const MAX_HEIGHT = 360;

export function SelectMenu<V extends string = string>(
  props: SelectMenuProps<V>,
) {
  const {
    value,
    onChange,
    options,
    id,
    name,
    disabled,
    className,
    renderValue,
    caret = true,
    tone = "light",
    searchThreshold = 15,
    stayOpenOn,
    footer,
    title,
    style,
  } = props;
  const dataAttrs: DataAttrs = {};
  for (const [k, v] of Object.entries(props))
    if (k.startsWith("data-")) dataAttrs[k as `data-${string}`] = v as string;

  const autoId = useId();
  const listId = `${autoId}-list`;
  const optId = (i: number) => `${autoId}-opt-${i}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const typeRef = useRef({ text: "", at: 0 });

  const flat = useMemo(() => flattenSelectOptions(options), [options]);
  const selected = flat.find((o) => o.value === value);
  const searchable = flat.length > searchThreshold;
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      flat
        .map((o, i) => ({ o, i }))
        .filter(({ o }) => !q || o.label.toLowerCase().includes(q)),
    [flat, q],
  );
  const pickable = visible.filter(({ o }) => !o.disabled);

  const close = useCallback((focusButton = true) => {
    setOpen(false);
    setQuery("");
    setPos(null);
    if (focusButton) buttonRef.current?.focus();
  }, []);

  function openMenu() {
    if (disabled) return;
    const at = flat.findIndex((o) => o.value === value && !o.disabled);
    setActive(at >= 0 ? at : flat.findIndex((o) => !o.disabled));
    setQuery("");
    setOpen(true);
  }

  // 放位置：先放在按钮正下方左对齐，量出菜单大小后夹在屏幕里（离边 16px）；下面放不下而上面更宽 ⇒ 往上开。
  const place = useCallback(() => {
    const b = buttonRef.current;
    const m = menuRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const maxW = Math.max(0, vw - EDGE * 2);
    const w = m ? Math.min(m.scrollWidth, maxW) : r.width;
    const width = Math.max(w, Math.min(r.width, maxW));
    const left = Math.min(Math.max(EDGE, r.left), vw - EDGE - width);
    const below = vh - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    const natural = m ? m.scrollHeight : MAX_HEIGHT;
    const up = below < Math.min(natural, 200) && above > below;
    const maxHeight = Math.max(120, Math.min(MAX_HEIGHT, up ? above : below));
    setPos({
      position: "fixed",
      left,
      minWidth: Math.min(r.width, maxW),
      maxWidth: maxW,
      maxHeight,
      ...(up ? { bottom: vh - r.top + GAP } : { top: r.bottom + GAP }),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place, q]);

  // 菜单里的东西变了大小（例如 Custom 的日期框出来）⇒ 重新放。
  useEffect(() => {
    const m = menuRef.current;
    if (!open || !m || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place());
    ro.observe(m);
    return () => ro.disconnect();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || menuRef.current?.contains(t))
        return;
      close(false);
    };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, close, place]);

  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  // 键盘移到的那项滚进可见范围。
  useEffect(() => {
    if (!open || active < 0) return;
    document
      .getElementById(optId(active))
      ?.scrollIntoView({ block: "nearest" });
    // optId 只依赖 autoId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  function choose(i: number) {
    const o = flat[i];
    if (!o || o.disabled) return;
    if (o.value !== value) onChange(o.value);
    if (stayOpenOn?.(o.value)) {
      setActive(i);
      return;
    }
    close();
  }

  function move(dir: 1 | -1) {
    if (!pickable.length) return;
    const at = pickable.findIndex((p) => p.i === active);
    const next =
      at < 0
        ? dir > 0
          ? 0
          : pickable.length - 1
        : Math.min(pickable.length - 1, Math.max(0, at + dir));
    setActive(pickable[next].i);
  }

  function onKey(e: ReactKeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      // 只关菜单，不让弹窗（Modal 在 document 上听 Esc）跟着关。
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      if (pickable.length)
        setActive(pickable[e.key === "Home" ? 0 : pickable.length - 1].i);
    } else if (e.key === "Enter" || (e.key === " " && !searchable)) {
      e.preventDefault();
      if (active >= 0) choose(active);
    } else if (
      !searchable &&
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      // 打字跳：1 秒内连着打的字拼起来找开头。
      const now = Date.now();
      const t = typeRef.current;
      t.text =
        now - t.at < 1000 ? t.text + e.key.toLowerCase() : e.key.toLowerCase();
      t.at = now;
      const hit = pickable.find(({ o }) =>
        o.label
          .replace(/^[^\p{L}\p{N}]+/u, "")
          .toLowerCase()
          .startsWith(t.text),
      );
      if (hit) setActive(hit.i);
    }
  }

  const label = renderValue ? renderValue(selected) : (selected?.label ?? "");

  // 带分组的显示：按原顺序走，遇到组就先出组标题。
  const rows: ReactNode[] = [];
  let flatIndex = 0;
  const shown = new Set(visible.map((v) => v.i));
  let afterGroup = false;
  for (const item of options) {
    const group = isGroup(item) ? item : null;
    if (!group && afterGroup && !q && shown.has(flatIndex))
      rows.push(
        <div
          key={`sep-${flatIndex}`}
          role="presentation"
          className={cn(
            "mx-2 my-[3px] h-px",
            tone === "dark" ? "bg-white/15" : "bg-black/[.1] night:bg-white/15",
          )}
        />,
      );
    afterGroup = !!group;
    const list = group ? group.options : [item as SelectMenuOption<V>];
    const start = flatIndex;
    flatIndex += list.length;
    const anyShown = list.some((_, k) => shown.has(start + k));
    if (group && anyShown && !q)
      rows.push(
        <div
          key={`g-${start}`}
          role="presentation"
          data-select-group
          className={cn(
            "px-3 pt-1.5 pb-0.5 text-[11px] font-semibold tracking-[.04em] uppercase",
            tone === "dark"
              ? "text-white/50"
              : "text-[#6b7280] night:text-white/50",
          )}
        >
          {group.group}
        </div>,
      );
    list.forEach((o, k) => {
      const i = start + k;
      if (!shown.has(i)) return;
      const on = o.value === value;
      rows.push(
        <div
          key={`o-${i}`}
          id={optId(i)}
          role="option"
          aria-selected={on}
          aria-disabled={o.disabled || undefined}
          data-value={o.value}
          data-active={i === active ? "" : undefined}
          onMouseEnter={() => !o.disabled && setActive(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => choose(i)}
          className={cn(
            "flex min-h-[28px] cursor-pointer items-center rounded-[5px] py-1 pr-[18px] pl-3 text-left max-sm:min-h-[32px]",
            on && "font-semibold",
            o.disabled && "cursor-default opacity-45",
            o.className,
            i === active &&
              !o.disabled &&
              (tone === "dark"
                ? "bg-white/[.08]"
                : "bg-[#f1f2f4] night:bg-white/[.08]"),
          )}
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span>
        </div>,
      );
    });
  }

  const menu =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            data-select-menu-list
            style={pos ?? { position: "fixed", left: -9999, top: 0 }}
            className={cn(
              "z-[1100] box-border w-max overflow-y-auto rounded-lg border p-[3px] text-[13px] leading-[1.35] whitespace-normal",
              tone === "dark"
                ? "border-white/15 bg-[#0f1c2d] text-white/90 shadow-[0_10px_28px_rgba(0,0,0,.55)]"
                : "border-black/[.14] bg-white text-[#1a1a1a] shadow-[0_8px_24px_rgba(15,23,42,.16)] night:border-white/15 night:bg-[#0f1c2d] night:text-white/90 night:shadow-[0_10px_28px_rgba(0,0,0,.55)]",
            )}
          >
            {searchable ? (
              <input
                ref={searchRef}
                type="search"
                aria-label="Search options"
                aria-controls={listId}
                aria-activedescendant={active >= 0 ? optId(active) : undefined}
                value={query}
                placeholder="Search…"
                onChange={(e) => {
                  setQuery(e.target.value);
                  const ql = e.target.value.trim().toLowerCase();
                  const first = flat.findIndex(
                    (o) =>
                      !o.disabled &&
                      (!ql || o.label.toLowerCase().includes(ql)),
                  );
                  setActive(first);
                }}
                onKeyDown={onKey}
                className={cn(
                  "mb-[3px] box-border h-7 w-full rounded-[5px] border px-2.5 text-[13px] outline-none",
                  tone === "dark"
                    ? "border-white/15 bg-transparent text-white placeholder:text-white/40"
                    : "border-black/15 bg-transparent text-[#1a1a1a] placeholder:text-[#9ca3af] night:border-white/15 night:text-white night:placeholder:text-white/40",
                )}
              />
            ) : null}
            <div
              id={listId}
              role="listbox"
              aria-label={props["aria-label"]}
              aria-labelledby={
                props["aria-label"] ? undefined : props["aria-labelledby"]
              }
            >
              {rows.length ? (
                rows
              ) : (
                <div className="px-2.5 py-2 text-[12.5px] opacity-60">
                  No matches
                </div>
              )}
            </div>
            {footer ? (
              <div
                data-select-footer
                className={cn(
                  "mt-[3px] border-t p-1.5",
                  tone === "dark"
                    ? "border-white/15"
                    : "border-black/[.14] night:border-white/15",
                )}
              >
                {footer(() => close())}
              </div>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && !searchable && active >= 0 ? optId(active) : undefined
        }
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        disabled={disabled}
        title={title ?? selected?.label}
        data-select-menu=""
        value={value}
        data-value={value}
        data-label={selected?.label ?? ""}
        data-options={JSON.stringify(
          flat.map((o) => [o.value, o.label, o.disabled ? 1 : 0]),
        )}
        {...dataAttrs}
        style={style}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onKey}
        className={cn(
          "inline-flex min-w-0 cursor-pointer items-center justify-between gap-1.5 text-left disabled:cursor-not-allowed",
          className,
        )}
      >
        <span className="min-w-0 truncate leading-[1.35]">{label}</span>
        {caret ? (
          <span aria-hidden className="flex-none text-[10px] opacity-70">
            ▾
          </span>
        ) : null}
      </button>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {menu}
    </>
  );
}
