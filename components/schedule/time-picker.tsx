"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { formatClock } from "@/lib/schedule-time";
import { cn } from "@/lib/utils";

/**
 * 排班页自己画的时间选择器（Annie 2026-10-20「排班时间选择器 - 动手」，preview：
 * https://claude.ai/artifact/EJUjz7ZBNLPTYpvtkMKM9f ）。取代浏览器自带的 <input type="time">：
 * 自带的数字滚轮页面改不了大小，滚动也不跟手、选完会滑走。
 *
 * - 输入框可以直接打字（9:15、9:15 am、0915、21:30），也可以点下拉里的小时 / 分钟 / AM-PM。
 * - 选中后固定高亮，列表只在打开的那一下把选中项放到可见处，之后不会自己滚。
 * - 点外面 / Tab / 回车 = 保留；Esc = 放弃这次打开之后的改动。
 * - value 是 "HH:MM"（24 小时），和原来的 <input type="time"> 一样。
 */

const MINUTE_STEP = 5;
const ROW = 40; // 下拉里每一行的高度（px）
const POP_W = 224;
const POP_H = 288;

/** 把打出来的字读成 "HH:MM"；读不懂 → null。无 am/pm 按 24 小时读，所以 11:30 = 上午 11:30。 */
export function parseClock(raw: string): string | null {
  let s = raw.trim().toLowerCase().replace(/\./g, "");
  if (!s) return null;
  let period: "am" | "pm" | null = null;
  const m = /\s*([ap])m?$/.exec(s);
  if (m) {
    period = m[1] === "p" ? "pm" : "am";
    s = s.slice(0, m.index).trim();
  }
  let h: number;
  let min: number;
  if (s.includes(":")) {
    const [a, b = "0"] = s.split(":");
    if (!/^\d{1,2}$/.test(a) || !/^\d{1,2}$/.test(b)) return null;
    h = Number(a);
    min = Number(b);
  } else if (/^\d{3,4}$/.test(s)) {
    min = Number(s.slice(-2));
    h = Number(s.slice(0, -2));
  } else if (/^\d{1,2}$/.test(s)) {
    h = Number(s);
    min = 0;
  } else {
    return null;
  }
  if (period) {
    if (h < 1 || h > 12) return null;
    if (period === "pm" && h < 12) h += 12;
    if (period === "am" && h === 12) h = 0;
  }
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function show(value: string): string {
  return value ? formatClock(value) : "";
}

function split(value: string): { h24: number; min: number } | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  return m ? { h24: Number(m[1]), min: Number(m[2]) } : null;
}

function join(h24: number, min: number): string {
  return `${String(h24).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

export function TimePicker({
  value,
  onChange,
  ariaLabel,
  id,
  allowEmpty = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  id?: string;
  /** 默认时间那几格可以留空（= 没设）。 */
  allowEmpty?: boolean;
  /** 加在输入框上（主要用来定宽度）。 */
  className?: string;
}) {
  const popId = useId();
  const [text, setText] = useState(() => show(value));
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hourCol = useRef<HTMLDivElement>(null);
  const minCol = useRef<HTMLDivElement>(null);
  const editing = useRef(false);
  const valueAtOpen = useRef(value);
  // 回调里要拿最新的 value / onChange：用 ref 跟着，监听器就不用跟着重挂。
  const latest = useRef({ value, onChange, allowEmpty });
  latest.current = { value, onChange, allowEmpty };

  // 外面改了 value（选班次自动填、Recent 点一下……）且这格没在打字 → 跟着变。
  useEffect(() => {
    if (!editing.current) setText(show(value));
  }, [value]);

  const place = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8));
    const below = r.bottom + 4;
    const top =
      below + POP_H > window.innerHeight && r.top - 4 - POP_H > 0
        ? r.top - 4 - POP_H
        : below;
    setPos({ left, top });
  }, []);

  function openList() {
    if (open) return;
    valueAtOpen.current = latest.current.value;
    editing.current = true;
    place();
    setOpen(true);
  }

  /** 收起并把输入框整理成标准写法：读得懂就用，读不懂（或清空且不让清空）就退回当前值。 */
  const finish = useCallback(() => {
    const { value: cur, onChange: change, allowEmpty: empty } = latest.current;
    const raw = inputRef.current?.value ?? "";
    const parsed = parseClock(raw);
    if (parsed) {
      if (parsed !== cur) change(parsed);
      setText(show(parsed));
    } else if (!raw.trim() && empty) {
      if (cur !== "") change("");
      setText("");
    } else {
      setText(show(cur));
    }
    editing.current = false;
    setOpen(false);
  }, []);

  // 打开时：把选中的小时 / 分钟放到可见处，只这一次，之后不再自己滚。
  useLayoutEffect(() => {
    if (!open) return;
    for (const col of [hourCol.current, minCol.current]) {
      const sel = col?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (col && sel) {
        col.scrollTop = Math.max(0, sel.offsetTop - col.clientHeight / 2 + ROW / 2);
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (inputRef.current?.contains(t) || popRef.current?.contains(t)) return;
      finish();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, finish, place]);

  const cur = split(value);
  const h12 = cur ? cur.h24 % 12 || 12 : null;
  const pm = cur ? cur.h24 >= 12 : null;
  // 不在 5 分钟格子上的时间（如 9:07）：列表里补一行当前值，选中状态才看得见。
  const minutes =
    cur && cur.min % MINUTE_STEP !== 0
      ? [...MINUTES, cur.min].sort((a, b) => a - b)
      : MINUTES;

  function pick(next: { h12?: number; min?: number; pm?: boolean }) {
    const base = cur ?? { h24: 9, min: 0 };
    const hour12 = next.h12 ?? (base.h24 % 12 || 12);
    const isPm = next.pm ?? base.h24 >= 12;
    const min = next.min ?? base.min;
    const v = join((hour12 % 12) + (isPm ? 12 : 0), min);
    editing.current = true;
    setText(show(v));
    if (v !== value) onChange(v);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (!open) return; // 没开着：交给外面（时段卡的 Esc = 取消、弹窗的 Esc = 关窗口）
      e.preventDefault();
      e.stopPropagation();
      const orig = valueAtOpen.current;
      if (latest.current.value !== orig) onChange(orig);
      setText(show(orig));
      editing.current = false;
      setOpen(false);
    } else if (e.key === "Enter") {
      if (open) e.preventDefault(); // 开着：这下只负责收起；已经收起：照常提交所在的表单
      finish();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      openList();
      const base = cur ?? { h24: 9, min: 0 };
      const total = base.h24 * 60 + base.min + (e.key === "ArrowUp" ? 1 : -1) * MINUTE_STEP;
      const wrapped = ((total % 1440) + 1440) % 1440;
      const v = join(Math.floor(wrapped / 60), wrapped % 60);
      setText(show(v));
      onChange(v);
    }
  }

  const item = (selected: boolean) =>
    cn(
      "h-10 w-full shrink-0 cursor-pointer rounded-[6px] font-mono text-[15px] text-white/85 hover:bg-white/10",
      selected && "bg-sky-400 font-bold text-[#06101c] hover:bg-sky-400",
    );

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        data-time-input
        data-value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={popId}
        aria-label={ariaLabel}
        value={text}
        placeholder="--:-- --"
        onFocus={(e) => {
          openList();
          e.currentTarget.select();
        }}
        onClick={openList}
        onChange={(e) => {
          editing.current = true;
          setText(e.target.value);
          // 读得懂就立刻生效（弹窗里的 Add 键、Save 键拿到的永远是最新的）；读不懂 / 清空先不动，等离开时再整理。
          const parsed = parseClock(e.target.value);
          if (parsed && parsed !== value) onChange(parsed);
        }}
        onBlur={() => {
          // 点下拉里的按钮不会让输入框失焦（下面 onMouseDown 拦了）；这里只剩 Tab 走开等情况。
          if (editing.current) finish();
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "h-9 w-[112px] rounded-[6px] border border-white/25 bg-[#070f1a] px-2.5 font-mono text-[14px] font-semibold text-white [color-scheme:dark] placeholder:font-normal placeholder:text-white/35 focus:border-sky-400/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60",
          className,
        )}
      />
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popRef}
              id={popId}
              data-time-pop
              role="dialog"
              aria-label="Pick a time"
              style={{ left: pos.left, top: pos.top, width: POP_W }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => e.stopPropagation()}
              className="fixed z-[80] flex gap-1.5 rounded-lg border border-white/25 bg-[#0b1727] p-2 text-white shadow-[0_10px_30px_rgba(0,0,0,.55)]"
            >
              <div className="flex flex-col">
                <div className="mb-0.5 text-center text-[10.5px] tracking-[.06em] text-white/60 uppercase">
                  Hour
                </div>
                <div
                  ref={hourCol}
                  role="listbox"
                  aria-label="Hour"
                  className="relative flex max-h-[240px] w-[64px] flex-col gap-0.5 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
                >
                  {HOURS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      role="option"
                      data-hour={h}
                      aria-selected={h12 === h}
                      onClick={() => pick({ h12: h })}
                      className={item(h12 === h)}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col">
                <div className="mb-0.5 text-center text-[10.5px] tracking-[.06em] text-white/60 uppercase">
                  Min
                </div>
                <div
                  ref={minCol}
                  role="listbox"
                  aria-label="Minute"
                  className="relative flex max-h-[240px] w-[64px] flex-col gap-0.5 overflow-y-auto overscroll-contain [scrollbar-width:thin]"
                >
                  {minutes.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="option"
                      data-min={m}
                      aria-selected={cur?.min === m}
                      onClick={() => pick({ min: m })}
                      className={item(cur?.min === m)}
                    >
                      {String(m).padStart(2, "0")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col">
                <div className="mb-0.5 text-[10.5px]">&nbsp;</div>
                <div role="listbox" aria-label="AM or PM" className="flex w-[56px] flex-col gap-0.5">
                  {(["AM", "PM"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="option"
                      data-period={p}
                      aria-selected={pm === (p === "PM")}
                      onClick={() => pick({ pm: p === "PM" })}
                      className={item(pm === (p === "PM"))}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
