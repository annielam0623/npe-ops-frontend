"use client";

import {
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";
import type { HRProfile } from "@/types";

import {
  cellValue,
  columnLabel,
  displayValue,
  EXPIRY_KEY,
  EXPIRY_STYLE,
  EXPIRY_SUFFIX,
  FIELD_BY_KEY,
  type HRField,
  type ListLayout,
  LOGIN_COLUMN,
  MIN_COL_WIDTH,
  toggleMulti,
} from "./fields";
import { HR_BTN_CLASS, HR_EMPTY_CLASS, HR_PILL_CLASS } from "./legacy-ui";

/** Edit list 的草稿：id → 列 → 输入框里的原样文字（多选是逗号串）。 */
export type ListEdits = Record<number, Record<string, string>>;

/** 改过的格子：文字去掉首尾空格后和原值不同才算（同旧页面）。 */
export function isCellChanged(
  profile: HRProfile,
  key: string,
  draft: string,
): boolean {
  return draft.trim() !== cellValue(profile, key);
}

interface PeopleTableProps {
  profiles: HRProfile[];
  layout: ListLayout;
  onLayoutChange: (layout: ListLayout) => void;
  editing: boolean;
  edits: ListEdits;
  locked: boolean;
  onCellChange: (id: number, key: string, value: string) => void;
  onEdit: (profile: HRProfile) => void;
  placeholder: string | null;
  /** 窗口底部还有别的固定条（Edit list 的保存条）时，滚动条放在它上面。 */
  bottomOffset?: number;
}

/** table.hr th */
const TH =
  "relative border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-3 py-[9px] text-[11px] font-semibold tracking-[.04em] whitespace-nowrap text-[#888] uppercase";
/** table.hr td */
const TD =
  "border-b-[0.5px] border-black/[.06] px-3 py-[9px] align-middle whitespace-nowrap text-[#1a1a1a]";
/** td.num：电话、驾照号、日期、Samsara ID。 */
const NUM_COLUMNS = new Set(["phone", "license_number", "samsara_driver_id"]);

export function PeopleTable({
  profiles,
  layout,
  onLayoutChange,
  editing,
  edits,
  locked,
  onCellChange,
  onEdit,
  placeholder,
  bottomOffset = 0,
}: PeopleTableProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(
    null,
  );
  /** 正在拖的列宽（松手才存）。 */
  const [liveWidth, setLiveWidth] = useState<{
    key: string;
    px: number;
  } | null>(null);
  const resizingRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  function finishDrop() {
    if (dragging && drop && drop.key !== dragging) {
      const order = layout.order.filter((k) => k !== dragging);
      const at = order.indexOf(drop.key) + (drop.after ? 1 : 0);
      order.splice(at, 0, dragging);
      onLayoutChange({ ...layout, order });
    }
    setDragging(null);
    setDrop(null);
  }

  function startResize(event: ReactMouseEvent, key: string) {
    event.preventDefault();
    event.stopPropagation();
    const th = (event.currentTarget as HTMLElement).parentElement;
    if (!th) return;
    const startX = event.clientX;
    const startW = th.getBoundingClientRect().width;
    resizingRef.current = true;
    let px = startW;
    function move(e: MouseEvent) {
      px = Math.max(MIN_COL_WIDTH, Math.round(startW + e.clientX - startX));
      setLiveWidth({ key, px });
    }
    function up() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      resizingRef.current = false;
      setLiveWidth(null);
      // 存量到的实际宽度（内容比设的宽时，表格会撑开，不截断）。
      const measured = th
        ? Math.round(th.getBoundingClientRect().width)
        : Math.round(px);
      onLayoutChange({
        ...layout,
        widths: { ...layout.widths, [key]: Math.max(MIN_COL_WIDTH, measured) },
      });
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function widthOf(key: string): number | undefined {
    if (liveWidth?.key === key) return liveWidth.px;
    return layout.widths[key];
  }

  return (
    <>
      <div ref={wrapRef} className="overflow-x-auto">
        <table
          ref={tableRef}
          className="w-max min-w-full border-collapse text-[13px] text-[#1a1a1a]"
        >
          <colgroup>
            {layout.order.map((key) => (
              <col
                key={key}
                style={widthOf(key) ? { width: widthOf(key) } : undefined}
              />
            ))}
            <col />
          </colgroup>
          <thead>
            <tr>
              {layout.order.map((key) => (
                <th
                  key={key}
                  scope="col"
                  draggable
                  onDragStart={(event: DragEvent) => {
                    if (resizingRef.current) {
                      event.preventDefault();
                      return;
                    }
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", key);
                    setDragging(key);
                  }}
                  onDragOver={(event: DragEvent) => {
                    if (!dragging) return;
                    event.preventDefault();
                    const rect = (
                      event.currentTarget as HTMLElement
                    ).getBoundingClientRect();
                    setDrop({
                      key,
                      after: event.clientX > rect.left + rect.width / 2,
                    });
                  }}
                  onDrop={(event: DragEvent) => {
                    event.preventDefault();
                    finishDrop();
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDrop(null);
                  }}
                  className={cn(
                    TH,
                    "cursor-grab text-left select-none",
                    dragging === key && "opacity-45",
                    drop?.key === key &&
                      dragging !== key &&
                      (drop.after
                        ? "shadow-[inset_-3px_0_0_#3b82f6]"
                        : "shadow-[inset_3px_0_0_#3b82f6]"),
                  )}
                >
                  {columnLabel(key)}
                  <span
                    aria-hidden
                    data-resizer={key}
                    onMouseDown={(e) => startResize(e, key)}
                    className="absolute top-0 right-0 h-full w-[7px] cursor-col-resize hover:bg-[rgba(59,130,246,.35)]"
                  />
                </th>
              ))}
              <th scope="col" className={cn(TH, "text-right")}>
                <span className="sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {placeholder ? (
              <tr>
                <td
                  colSpan={layout.order.length + 1}
                  className={HR_EMPTY_CLASS}
                >
                  {placeholder}
                </td>
              </tr>
            ) : (
              profiles.map((p) => (
                <tr
                  key={p.id}
                  data-id={p.id}
                  className={cn(
                    // 只有驾照过期整行标红（同旧页面；医疗卡过期只标那一格）。
                    p.license_expiry_state === "expired"
                      ? "bg-[#fdeceb]"
                      : !editing && "hover:bg-[#fafaf8]",
                  )}
                >
                  {layout.order.map((key) => (
                    <td key={key} className={TD}>
                      {editing && key !== LOGIN_COLUMN ? (
                        <EditCell
                          field={FIELD_BY_KEY[key]}
                          profile={p}
                          draft={edits[p.id]?.[key]}
                          disabled={locked}
                          onChange={(v) => onCellChange(p.id, key, v)}
                        />
                      ) : (
                        <ViewCell profile={p} columnKey={key} />
                      )}
                    </td>
                  ))}
                  <td className={cn(TD, "text-right")}>
                    <button
                      type="button"
                      disabled={editing}
                      onClick={() => onEdit(p)}
                      className={HR_BTN_CLASS}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <FloatingScrollbar
        wrapRef={wrapRef}
        tableRef={tableRef}
        bottomOffset={bottomOffset}
      />
    </>
  );
}

function ViewCell({
  profile,
  columnKey,
}: {
  profile: HRProfile;
  columnKey: string;
}) {
  if (columnKey === LOGIN_COLUMN) {
    return profile.user_id != null ? (
      <span className={cn(HR_PILL_CLASS, "bg-[#e8eefc] text-[#1a4fa0]")}>
        linked
      </span>
    ) : (
      <span className={cn(HR_PILL_CLASS, "bg-[#f0f0ee] text-[#888]")}>
        no account
      </span>
    );
  }
  const expiry = EXPIRY_KEY[columnKey];
  if (expiry) {
    const state = profile[expiry];
    const date = (profile as unknown as Record<string, string>)[columnKey];
    return (
      <span className={cn(HR_PILL_CLASS, "tabular-nums", EXPIRY_STYLE[state])}>
        {date || "—"}
        {EXPIRY_SUFFIX[state]}
      </span>
    );
  }
  const text = displayValue(profile, columnKey);
  return (
    <span
      className={cn(
        columnKey === "legal_name" && "font-bold",
        NUM_COLUMNS.has(columnKey) && "tabular-nums",
      )}
    >
      {text}
    </span>
  );
}

function EditCell({
  field,
  profile,
  draft,
  disabled,
  onChange,
}: {
  field: HRField;
  profile: HRProfile;
  draft: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const value = draft ?? cellValue(profile, field.key);
  const changed =
    draft !== undefined && isCellChanged(profile, field.key, draft);
  const changedClass = changed && "border-[#8a5a00] bg-[#fffdf5]";
  const label = `${field.label} — ${profile.legal_name}`;

  if (field.kind === "multi") {
    const selected = value ? value.split(",") : [];
    return (
      <div
        role="group"
        aria-label={label}
        className={cn(
          "flex min-w-[170px] flex-wrap gap-x-2.5 gap-y-[3px] rounded-[6px] border border-transparent px-1.5 py-[3px] whitespace-nowrap",
          changedClass,
        )}
      >
        {field.choices?.map(([v, text]) => (
          <label
            key={v}
            className="inline-flex cursor-pointer items-center gap-[5px] text-[12px] whitespace-nowrap text-[#1a1a1a] select-none"
          >
            <input
              type="checkbox"
              checked={selected.includes(v)}
              disabled={disabled}
              onChange={(e) =>
                onChange(toggleMulti(field, value, v, e.target.checked))
              }
            />
            {text}
          </label>
        ))}
      </div>
    );
  }
  const inputClass = cn(
    "box-border min-w-full rounded-[6px] border border-[#d7d7d2] bg-white px-[7px] py-1 text-[#1a1a1a] focus:border-[#1a4fa0] focus:shadow-[0_0_0_2px_rgba(26,79,160,.14)] focus:outline-none disabled:opacity-60",
    changedClass,
  );
  if (field.kind === "choice") {
    const known = field.choices?.some(([v]) => v === value);
    return (
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      >
        {!known && value ? <option value={value}>{value}</option> : null}
        {/* 按选项原顺序（旧页面这里的顺序是乱的）。 */}
        {field.choices?.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={label}
      type={field.kind === "date" ? "date" : "text"}
      value={value}
      maxLength={field.maxlen}
      // 按内容撑宽，不截断。
      size={field.kind === "date" ? undefined : Math.max(value.length + 2, 8)}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    />
  );
}

/**
 * 表格比窗口宽、表格底边又在窗口下面时，在窗口底部放一条横向滚动条，和表格自己的滚动条同步
 * （Annie 2026-09-30 定，同旧页面分支 task/hr-list-columns）。
 */
function FloatingScrollbar({
  wrapRef,
  tableRef,
  bottomOffset,
}: {
  wrapRef: RefObject<HTMLDivElement | null>;
  tableRef: RefObject<HTMLTableElement | null>;
  bottomOffset: number;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<{
    show: boolean;
    left: number;
    width: number;
    inner: number;
  }>({ show: false, left: 0, width: 0, inner: 0 });

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const table = tableRef.current;
    if (!wrap || !table) return;
    function update() {
      if (!wrap || !table) return;
      const rect = wrap.getBoundingClientRect();
      const overflow = table.scrollWidth > wrap.clientWidth + 1;
      const visibleBottom = window.innerHeight - bottomOffset;
      const bottomHidden =
        rect.bottom > visibleBottom && rect.top < visibleBottom;
      setGeo((g) => {
        const next = {
          show: overflow && bottomHidden,
          left: rect.left,
          width: wrap.clientWidth,
          inner: table.scrollWidth,
        };
        return g.show === next.show &&
          g.left === next.left &&
          g.width === next.width &&
          g.inner === next.inner
          ? g
          : next;
      });
    }
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    observer.observe(table);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [wrapRef, tableRef, bottomOffset]);

  // 双向同步滚动位置。
  useEffect(() => {
    const wrap = wrapRef.current;
    const bar = barRef.current;
    if (!wrap || !bar || !geo.show) return;
    bar.scrollLeft = wrap.scrollLeft;
    let syncing = false;
    function from(src: HTMLElement, dst: HTMLElement) {
      return () => {
        if (syncing) return;
        syncing = true;
        dst.scrollLeft = src.scrollLeft;
        requestAnimationFrame(() => (syncing = false));
      };
    }
    const a = from(wrap, bar);
    const b = from(bar, wrap);
    wrap.addEventListener("scroll", a, { passive: true });
    bar.addEventListener("scroll", b, { passive: true });
    return () => {
      wrap.removeEventListener("scroll", a);
      bar.removeEventListener("scroll", b);
    };
  }, [wrapRef, geo.show]);

  if (!geo.show) return null;
  return (
    <div
      ref={barRef}
      data-floating-scrollbar
      className="fixed z-30 overflow-x-auto overflow-y-hidden border-t border-stone-200 bg-white/90"
      style={{ left: geo.left, width: geo.width, bottom: bottomOffset }}
    >
      <div style={{ width: geo.inner, height: 1 }} />
    </div>
  );
}
