"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { DispatchRow } from "@/types";

import {
  alsoDriving as alsoBy,
  alsoOnVans as alsoOn,
  canRun,
  isDriverGuide,
  isRelay,
  META,
  hasDriver,
  type Lookup,
  NAME_MAX,
  secOf,
  TOUR_NAME_MAX,
} from "./config";

const TYPE_NEW = "__type";
const TYPED_KEEP = "__typed";
const DRIVER_GUIDE = "__dg";

/** 弹框要一个名字；取消或空 ⇒ null。空格规整、超长说出来让人改短（不悄悄截断）。 */
function askText(
  question: string,
  current: string | null,
  limit: number,
): string | null {
  let v = window.prompt(question, current || "");
  while (v !== null) {
    v = v.split(/\s+/).filter(Boolean).join(" ");
    if (!v) return null;
    if (v.length <= limit) return v;
    v = window.prompt(
      `That is longer than ${limit} characters - please shorten it.\n${question}`,
      v,
    );
  }
  return null;
}

function askName(role: "driver" | "guide", current: string | null) {
  return askText(
    `Type the ${role}'s name. This person is not in Human Resource yet - Annie will get an email to add them.`,
    current,
    NAME_MAX,
  );
}

/**
 * 改一个框之后的新行；取消（手填弹框点了取消）⇒ null。规则同旧页面的 change 处理。
 */
export function applyField(
  r: DispatchRow,
  field: "driver" | "vehicle" | "tour" | "guide" | "bus",
  value: string,
  L: Lookup,
): DispatchRow | null {
  if (value === TYPED_KEEP) return null;
  const n: DispatchRow = { ...r, location_ids: [...r.location_ids] };
  if (field === "driver") {
    // 原来是 Driver Guide ⇒ 导游跟着换：新司机也是 Driver + Guide 就跟过去，不是就清空。
    const wasDG =
      isDriverGuide(r) ||
      (!!r.driver_typed_name && r.guide_typed_name === r.driver_typed_name) ||
      (!!r.ccl &&
        r.ccl.is_driver_guide &&
        !r.guide_hr_id &&
        !r.guide_typed_name &&
        !isRelay(r.shift));
    let typed: string | null = null;
    if (value === TYPE_NEW) {
      typed = askName("driver", r.driver_typed_name);
      if (!typed) return null;
    }
    n.driver_hr_id = typed || !value ? null : Number(value);
    n.driver_typed_name = typed;
    n.driver_name = null;
    if (wasDG) {
      const d = L.driver(n.driver_hr_id);
      n.guide_hr_id =
        !typed &&
        n.driver_hr_id &&
        (d?.position === "both" || (r.ccl && r.ccl.is_driver_guide))
          ? n.driver_hr_id
          : null;
      n.guide_typed_name = typed && !isRelay(r.shift) ? typed : null;
      n.guide_name = null;
    }
  } else if (field === "vehicle") {
    n.vehicle_id = value ? Number(value) : null;
  } else if (field === "tour") {
    if (value === TYPE_NEW) {
      const name = askText(
        "Type the tour name for this Private Tour vehicle:",
        r.custom_tour_name,
        TOUR_NAME_MAX,
      );
      if (!name) return null;
      n.custom_tour_name = name;
      n.manifest_id = null;
    } else {
      n.manifest_id = value ? Number(value) : null;
      n.custom_tour_name = null;
    }
  } else if (field === "guide") {
    let gtyped: string | null = null;
    if (value === TYPE_NEW) {
      gtyped = askName("guide", r.guide_typed_name);
      if (!gtyped) return null;
    }
    n.guide_hr_id = gtyped
      ? null
      : value === DRIVER_GUIDE
        ? r.driver_hr_id
        : value
          ? Number(value)
          : null;
    n.guide_typed_name = gtyped;
    n.guide_name = null;
  } else if (field === "bus") {
    n.bus_label = value || null;
  }
  return n;
}

// ── 下拉 ──

function DriverSelect({
  row,
  L,
  bad,
  onPick,
}: {
  row: DispatchRow;
  L: Lookup;
  bad: boolean;
  onPick: (value: string) => void;
}) {
  const sel = row.driver_hr_id;
  const cands = new Set((row.ccl?.driver_candidates ?? []).map((c) => c.id));
  let shown = 0;
  let ticked = 0;
  let found = false;
  const top: React.ReactNode[] = [];
  const rest: React.ReactNode[] = [];
  for (const d of L.day.drivers) {
    const ok = canRun(d, row.shift);
    if (ok) ticked++;
    if ((!ok || d.license_blocked) && d.id !== sel) continue;
    if (d.id === sel) found = true;
    if (ok && !d.license_blocked) shown++;
    const opt = (
      <option key={d.id} value={d.id}>
        {d.name}
        {d.license_blocked ? " (license expired)" : ""}
        {ok ? "" : " (not marked for this section)"}
      </option>
    );
    (cands.has(d.id) ? top : rest).push(opt);
  }
  const section =
    META.assignment_labels[META.shift_assignment[row.shift]] || row.shift;
  const value = row.driver_typed_name ? TYPED_KEEP : sel ? String(sel) : "";
  return (
    <select
      data-f="driver"
      aria-label="Driver"
      value={value}
      onChange={(e) => onPick(e.target.value)}
      className={selCls(
        bad
          ? BAD
          : !hasDriver(row) &&
              (isRelay(row.shift)
                ? // CCL 写了司机、还没选上人：琥珀框（旧 `.vrow select.need`）。
                  !!row.ccl?.driver_text && NEED
                : TODO),
      )}
    >
      <option value="">Choose driver...</option>
      {top.length ? <optgroup label="Who CCL meant">{top}</optgroup> : null}
      {rest}
      {!shown ? (
        <option value="" disabled>
          {ticked
            ? `Every driver for ${section} has a license that will have expired by this day`
            : L.day.drivers.length
              ? `No driver for ${section} - every driver has other sections ticked under Assignment in Human Resource`
              : "No drivers yet - set Position to Driver in Human Resource"}
        </option>
      ) : null}
      {sel && !found ? (
        <option value={sel}>
          No longer on the driver list - pick someone else
        </option>
      ) : null}
      {row.driver_typed_name ? (
        <option value={TYPED_KEEP}>{row.driver_typed_name} (typed)</option>
      ) : null}
      <option value={TYPE_NEW}>Not in the list? Type a name...</option>
    </select>
  );
}

function GuideSelect({
  row,
  L,
  onPick,
}: {
  row: DispatchRow;
  L: Lookup;
  onPick: (v: string) => void;
}) {
  const dg = isDriverGuide(row);
  const sel = dg ? null : row.guide_hr_id;
  const can = L.driver(row.driver_hr_id)?.position === "both";
  const cands = new Set(
    row.ccl && !row.ccl.is_driver_guide
      ? row.ccl.guide_candidates.map((c) => c.id)
      : [],
  );
  const top: React.ReactNode[] = [];
  const rest: React.ReactNode[] = [];
  let found = false;
  for (const g of L.day.guides) {
    if (g.id === sel) found = true;
    const opt = (
      <option key={g.id} value={g.id}>
        {g.name}
      </option>
    );
    (cands.has(g.id) ? top : rest).push(opt);
  }
  const hasGuide = !!(row.guide_hr_id || row.guide_typed_name);
  const value = dg
    ? DRIVER_GUIDE
    : row.guide_typed_name
      ? TYPED_KEEP
      : sel
        ? String(sel)
        : "";
  return (
    <select
      data-f="guide"
      aria-label="Guide"
      value={value}
      onChange={(e) => onPick(e.target.value)}
      className={selCls(!hasGuide && TODO)}
    >
      <option value={DRIVER_GUIDE} disabled={!can && !dg}>
        Driver Guide
        {can || dg
          ? ""
          : row.driver_hr_id
            ? " (driver is not Driver + Guide)"
            : " (pick the driver first)"}
      </option>
      <option value="">Choose guide...</option>
      {top.length ? <optgroup label="Who CCL meant">{top}</optgroup> : null}
      {rest}
      {!L.day.guides.length ? (
        <option value="" disabled>
          No one is marked as Guide under Position in Human Resource
        </option>
      ) : null}
      {sel && !found ? (
        <option value={sel}>Guide no longer on the list</option>
      ) : null}
      {row.guide_typed_name ? (
        <option value={TYPED_KEEP}>{row.guide_typed_name} (typed)</option>
      ) : null}
      <option value={TYPE_NEW}>Not in the list? Type a name...</option>
    </select>
  );
}

function VehicleSelect({
  row,
  L,
  todo,
  onPick,
}: {
  row: DispatchRow;
  L: Lookup;
  todo: boolean;
  onPick: (v: string) => void;
}) {
  const sel = row.vehicle_id;
  const found = !!sel && L.day.vehicles.some((v) => v.id === sel);
  return (
    <select
      data-f="vehicle"
      aria-label="Vehicle"
      value={sel ? String(sel) : ""}
      onChange={(e) => onPick(e.target.value)}
      className={selCls(todo && !sel && TODO)}
    >
      <option value="">No vehicle yet</option>
      {L.day.vehicles.map((v) => (
        <option key={v.id} value={v.id}>
          {v.van_no}
        </option>
      ))}
      {sel && !found ? (
        <option value={sel}>Vehicle retired from the pool</option>
      ) : null}
    </select>
  );
}

function TourSelect({
  row,
  L,
  onPick,
}: {
  row: DispatchRow;
  L: Lookup;
  onPick: (v: string) => void;
}) {
  const sel = row.manifest_id;
  const found = !!sel && L.day.tours.some((t) => t.id === sel);
  return (
    <select
      data-f="tour"
      aria-label="Tour"
      value={row.custom_tour_name ? TYPED_KEEP : sel ? String(sel) : ""}
      onChange={(e) => onPick(e.target.value)}
      className={selCls(!sel && !row.custom_tour_name && TODO)}
    >
      <option value="">No tour yet</option>
      {L.day.tours.map((t) => (
        <option key={t.id} value={t.id}>
          {t.display_name}
          {t.is_active ? "" : " (inactive)"}
        </option>
      ))}
      {sel && !found ? (
        <option value={sel}>Tour no longer in the list</option>
      ) : null}
      {row.custom_tour_name ? (
        <option value={TYPED_KEEP}>Custom: {row.custom_tour_name}</option>
      ) : null}
      <option value={TYPE_NEW}>Custom - type a tour name...</option>
    </select>
  );
}

function BusSelect({
  row,
  onPick,
}: {
  row: DispatchRow;
  onPick: (v: string) => void;
}) {
  return (
    <select
      data-f="bus"
      aria-label="Bus letter"
      value={row.bus_label ?? ""}
      onChange={(e) => onPick(e.target.value)}
      className={selCls(null)}
    >
      <option value="">No bus letter</option>
      {META.bus_labels.map((b) => (
        <option key={b} value={b}>
          Bus {b}
        </option>
      ))}
    </select>
  );
}

/** 加酒店：停用的不列；Morning Relay 同一轮别人勾走的点不了；同一个团另一台车去了的注明。 */
function StopSelect({
  rows,
  idx,
  L,
  onAdd,
}: {
  rows: DispatchRow[];
  idx: number;
  L: Lookup;
  onAdd: (id: number) => void;
}) {
  const row = rows[idx];
  const taken = new Map<number, string>();
  const shared = new Map<number, string>();
  rows.forEach((r, i) => {
    if (i === idx || secOf(r) !== secOf(row)) return;
    for (const l of r.location_ids) {
      const who =
        L.driverName(r.driver_hr_id) ||
        r.driver_typed_name ||
        "another vehicle";
      if (isRelay(row.shift)) taken.set(l, who);
      else if (row.shift === META.bus_tour_shift) shared.set(l, who);
    }
  });
  return (
    <select
      data-f="addstop"
      aria-label="Add hotel"
      value=""
      onChange={(e) => e.target.value && onAdd(Number(e.target.value))}
      className={ADDSTOP}
      style={{ backgroundImage: ADDSTOP_CARET }}
    >
      <option value="">Add hotel</option>
      {L.day.locations
        .filter((l) => l.active !== false && !row.location_ids.includes(l.id))
        .map((l) => (
          <option key={l.id} value={l.id} disabled={taken.has(l.id)}>
            {l.name}
            {taken.has(l.id) ? ` - ${taken.get(l.id)}` : ""}
            {shared.has(l.id) ? ` (also ${shared.get(l.id)})` : ""}
          </option>
        ))}
    </select>
  );
}

// 照旧页面 `.vrow select` / `.todo` / `.bad` / `.need` / `.addstop`。
const SELECT_BASE =
  "min-h-[34px] w-full min-w-0 rounded-[7px] border px-[9px] py-1.5 text-[13.5px] focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-60";
const SELECT_OK =
  "border-[#cbd2dc] bg-white text-[#111827] focus-visible:outline-[#3b82f6]";
/** cn 不合并类名：状态色（TODO / BAD / NEED）和默认色只给一个。 */
function selCls(state: string | false | null | undefined): string {
  return `${SELECT_BASE} ${state || SELECT_OK}`;
}
const TODO =
  "border-dashed border-[#e7b75a] bg-[#fdf6e7] text-[#8a5a00] focus-visible:outline-[#3b82f6]";
const BAD =
  "border-[#d13b30] bg-[#fffafa] text-[#111827] focus-visible:outline-[#d13b30]";
const NEED =
  "border-[#d97706] bg-white text-[#111827] shadow-[inset_0_0_0_1px_#d97706] focus-visible:outline-[#3b82f6]";
const ADDSTOP =
  "h-[34px] w-full max-w-[240px] cursor-pointer appearance-none rounded-[7px] border border-dashed border-[#9ca3af] bg-white bg-[right_11px_center] bg-no-repeat pr-7 pl-[11px] text-[13.5px] leading-none text-[#111827] hover:bg-[#f4f5f7] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#3b82f6] disabled:cursor-not-allowed disabled:opacity-60";
const ADDSTOP_CARET =
  "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='7'%3E%3Cpath d='M1 1l4.5 4.5L10 1' fill='none' stroke='%23374151' stroke-width='1.6'/%3E%3C/svg%3E\")";

// ── 小部件 ──

/** 旧 `.pill`：ok 绿 / warn = `.soon` 琥珀 / bad = `.expired`、`.nohr` 红；dot 是 GPS 那两个的小圆点。 */
function Pill({
  tone,
  dot = false,
  children,
}: {
  tone: "ok" | "warn" | "bad";
  dot?: boolean;
  children: React.ReactNode;
}) {
  const cls = {
    ok: "bg-[#e6f4ec] text-[#1e6b43]",
    warn: "bg-[#fdf1dd] text-[#8a5a00]",
    bad: "bg-[#fdeceb] text-[#b3261e]",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-[5px] rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        cls,
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 flex-none rounded-full",
            tone === "ok" ? "bg-[#22a35a]" : "bg-[#d13b30]",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

function GpsPill({ v }: { v: { has_tracking: boolean } | null }) {
  if (!v) return null;
  return v.has_tracking ? (
    <Pill tone="ok" dot>
      GPS
    </Pill>
  ) : (
    <Pill tone="bad" dot>
      No live GPS
    </Pill>
  );
}

/** 旧 `.gone`：跟橙色「待填」同一个色系。 */
function Gone({ name, role }: { name: string; role: "driver" | "guide" }) {
  return (
    <span className="text-[#8a5a00] [&_b]:text-[#8a5a00]">
      {role === "guide" ? "Guide " : "Driver "}
      <b>{name}</b> was removed from Human Resource
    </span>
  );
}

/** 框下面那一行：CCL 原来写的是什么；手填的人标 Not in HR。 */
function CclHint({
  row,
  field,
  L,
}: {
  row: DispatchRow;
  field: "driver" | "guide" | "vehicle";
  L: Lookup;
}) {
  const c = row.ccl;
  const typed =
    field === "driver"
      ? row.driver_typed_name
      : field === "guide"
        ? row.guide_typed_name
        : null;
  const nohr = typed ? <Pill tone="bad">Not in HR</Pill> : null;
  // 旧 `.ccltxt`（灰字，b 深色）/ `.ccltxt.miss`（三角警告 + 橙字）。
  const text = !c
    ? null
    : field === "driver"
      ? c.driver_text
      : field === "vehicle"
        ? c.vehicle_text
        : c.is_driver_guide
          ? null
          : c.guide_text;
  if (!text) return nohr ? <span className={CCLTXT}>{nohr}</span> : null;
  const picked =
    field === "driver"
      ? row.driver_hr_id || typed
      : field === "vehicle"
        ? row.vehicle_id
        : row.guide_hr_id || typed;
  if (picked) {
    return (
      <span className={CCLTXT} data-ccl={field}>
        CCL: <b>{text}</b>
        {nohr ? <> · {nohr}</> : null}
      </span>
    );
  }
  const cands = (
    (field === "driver"
      ? c!.driver_candidates
      : field === "guide"
        ? c!.guide_candidates
        : []) ?? []
  ).filter((n) => {
    if (field === "guide") return !!L.guide(n.id);
    const d = L.driver(n.id);
    return !!d && canRun(d, row.shift) && !d.license_blocked;
  });
  return (
    <span
      className="relative pl-[23px] text-[12.5px] leading-[1.4] font-semibold text-[#c2410c] [&_b]:font-[650] [&_b]:text-[#c2410c]"
      data-ccl={field}
    >
      <WarnIcon />
      CCL wrote <b>{text}</b> -{" "}
      {cands.length
        ? `pick ${cands.map((n) => n.name).join(" or ")}`
        : field === "vehicle"
          ? "not in Vehicles, pick the vehicle"
          : `no match, pick the ${field}`}
    </span>
  );
}

const CCLTXT =
  "text-[12.5px] leading-[1.4] text-[#6b7280] [&_b]:font-[650] [&_b]:text-[#111827]";

/** 旧 `.ccltxt.miss` 的背景图：橙色三角里一个白色感叹号。 */
function WarnIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="absolute top-px left-0 size-[17px]"
    >
      <path d="M12 3 2 20.5h20z" fill="#d97706" />
      <path d="M12 9.5v5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17.3" r="1.1" fill="#fff" />
    </svg>
  );
}

/** 旧 `.cclnote`。 */
const CCLNOTE =
  "mt-1 inline-block w-fit max-w-full rounded-md bg-[#fdf6e7] px-2 py-[3px] text-[11.5px] [overflow-wrap:anywhere] text-[#8a5a00]";

function CclExtras({ row }: { row: DispatchRow }) {
  const c = row.ccl;
  if (!c) return null;
  return (
    <>
      {c.route_label ? (
        <span className={CCLNOTE}>CCL: {c.route_label}</span>
      ) : null}
      {c.ccl_note ? <span className={CCLNOTE}>CCL: {c.ccl_note}</span> : null}
    </>
  );
}

function EditMenu({
  onClear,
  onRemove,
}: {
  onClear: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    // 旧 `.menuwrap` / `.rowmenu` / `.menu`：带字的 Edit 按钮（不是光秃秃的 ⋯）。
    <div ref={ref} className="relative flex justify-end">
      <button
        type="button"
        aria-label="Edit this vehicle"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-[34px] items-center gap-2.5 rounded-[7px] border border-[#cbd2dc] bg-white px-3 text-[13px] leading-none font-medium text-[#111827] hover:bg-[#f4f5f7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b82f6]"
      >
        Edit
        <span aria-hidden className="text-[9px] text-[#6b7280]">
          ▼
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute top-[38px] right-0 z-20 flex min-w-[152px] flex-col overflow-hidden rounded-[9px] border-[0.5px] border-black/[.14] bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,.16)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onClear();
            }}
            className="block w-full rounded-md px-2.5 py-[7px] text-left text-[12.5px] text-[#1a1a1a] hover:bg-[#f4f4f2]"
          >
            Clear hotels
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
            className="block w-full rounded-md px-2.5 py-[7px] text-left text-[12.5px] text-[#b3261e] hover:bg-[#fdeceb]"
          >
            Remove vehicle
          </button>
        </div>
      ) : null}
    </div>
  );
}

const AVBG = [
  "#2f6f4f",
  "#334e68",
  "#7a3b46",
  "#4a3b6b",
  "#1f5f6b",
  "#5b4636",
  "#8a5a00",
  "#3f5d8a",
  "#6b3f5b",
  "#2f5f3f",
  "#7a4a2f",
  "#3d4a6b",
];

function Avatar({
  d,
  ring,
}: {
  d: { id: number; name: string; initials: string } | null;
  ring: string;
}) {
  const label = d
    ? (
        String(d.initials || "").trim() ||
        String(d.name || "?")
          .trim()
          .charAt(0)
      ).slice(0, 4)
    : "?";
  // 旧 `.av`：44px 圆，字号按长度给（FLEE / LYON 是四个字符）。
  const size =
    label.length >= 4 ? "11px" : label.length === 3 ? "13px" : "15px";
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-11 flex-none items-center justify-center rounded-full leading-none font-bold tracking-[.02em]",
        d ? "text-white" : "text-[#6b7280]",
      )}
      style={{
        background: d ? AVBG[Math.abs(d.id) % AVBG.length] : "#e4e8ec",
        fontSize: size,
        boxShadow: `0 0 0 2px #fff, 0 0 0 3.5px ${ring}`,
      }}
    >
      {label}
    </span>
  );
}

// ── 一台车 ──

export interface RowProps {
  rows: DispatchRow[];
  idx: number;
  L: Lookup;
  ring: string;
  /** 点过 Save 时缺司机的那几行：标红、框下面写要填什么。 */
  flagged: boolean;
  isDup: boolean;
  /**
   * 存 / 换天 / 重读失败时整行关掉（同页头按钮的 disabled）：这时改的东西会被重读盖掉，等于白改。
   * 用 <fieldset disabled> 包住，下拉、酒店小块、备注、Edit 菜单一起关。
   */
  disabled?: boolean;
  onChange: (next: DispatchRow) => void;
  onRemove: () => void;
}

/** fieldset 去掉浏览器默认的边框、内边距和 min-width（不然窄屏会撑破格子）。 */
const ROW_RESET = "m-0 min-w-0 p-0";

function FieldMsg() {
  return (
    <div className="text-[12px] leading-[1.35] font-semibold text-[#b3261e]">
      Pick a driver - this vehicle cannot be saved without one.
    </div>
  );
}

function Chips({
  row,
  L,
  numbered,
  onDrop,
}: {
  row: DispatchRow;
  L: Lookup;
  numbered: boolean;
  onDrop: (id: number) => void;
}) {
  if (!row.location_ids.length) return null;
  // 旧 `.chips`：Add hotel 在上、已选的酒店在下。
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {row.location_ids.map((l, n) => (
        <button
          key={l}
          type="button"
          data-drop={l}
          onClick={() => onDrop(l)}
          title="Remove this hotel"
          className="inline-flex items-center gap-[7px] rounded-[7px] border-[0.5px] border-black/[.09] bg-[#eef2f7] px-[9px] py-[5px] text-[12.5px] text-[#1a1a1a] hover:bg-[#e2e8f0]"
        >
          {numbered ? (
            <span className="text-[10.5px] font-bold text-[#888]">{n + 1}</span>
          ) : null}
          {L.locName(l)}{" "}
          <span aria-hidden className="text-[11px] text-[#999]">
            ✕
          </span>
        </button>
      ))}
    </div>
  );
}

function NoteInput({
  row,
  onChange,
}: {
  row: DispatchRow;
  onChange: (r: DispatchRow) => void;
}) {
  return (
    <input
      type="text"
      data-f="note"
      aria-label="Private note"
      maxLength={200}
      value={row.note}
      placeholder="Note for yourself (not sent to anyone)"
      onChange={(e) => onChange({ ...row, note: e.target.value })}
      className="h-8 w-full rounded-[7px] border border-[#cbd2dc] bg-white px-[11px] text-[13px] text-[#111827] placeholder:text-[#9ca3af]"
    />
  );
}

/**
 * Morning Relay：一排一行（司机 | 车 | 酒店 | 菜单）。不带团、导游、Bus 字母。
 * 照旧页面 `.vrow`（2026-10-06 晚样稿）：头像在左；右边一竖排 = 司机框、CCL / 提示、私人备注。
 */
export function RelayRow({
  rows,
  idx,
  L,
  ring,
  flagged,
  isDup,
  disabled = false,
  onChange,
  onRemove,
}: RowProps) {
  const row = rows[idx];
  const drv = L.driver(row.driver_hr_id);
  const veh = L.vehicle(row.vehicle_id);
  const also = alsoOn(rows, idx, L);
  const alsoDrv = alsoBy(rows, idx, L);
  const pick = (f: "driver" | "vehicle") => (v: string) => {
    const n = applyField(row, f, v, L);
    if (n) onChange(n);
  };
  return (
    <fieldset
      data-idx={idx}
      disabled={disabled}
      className={cn(
        ROW_RESET,
        "vrow grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.85fr)_minmax(0,1.35fr)_84px] items-start gap-[18px] border-b border-[#e5e7eb] py-3.5 last-of-type:border-b-0 max-[860px]:grid-cols-1 max-[860px]:items-stretch max-[860px]:gap-[9px]",
      )}
    >
      <div className={CELL}>
        <div className="flex min-w-0 items-start gap-3.5">
          <Avatar d={drv} ring={ring} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <DriverSelect
              row={row}
              L={L}
              bad={flagged}
              onPick={pick("driver")}
            />
            <CclHint row={row} field="driver" L={L} />
            {flagged ? <FieldMsg /> : null}
            {!hasDriver(row) && row.driver_name ? (
              <div className="text-[12px] leading-[1.35]">
                <Gone name={row.driver_name} role="driver" />
              </div>
            ) : null}
            {isDup ? <Pill tone="warn">Duplicate row</Pill> : null}
            {also.length ? (
              <Pill tone="warn">Also on vehicle {also.join(", ")}</Pill>
            ) : null}
            <NoteInput row={row} onChange={onChange} />
          </div>
        </div>
      </div>
      <div className={CELL}>
        <VehicleSelect row={row} L={L} todo={false} onPick={pick("vehicle")} />
        <CclHint row={row} field="vehicle" L={L} />
        <CclExtras row={row} />
        <GpsPill v={veh} />
        {alsoDrv.length ? (
          <Pill tone="warn">Also driven by {alsoDrv.join(", ")}</Pill>
        ) : null}
      </div>
      <div className={CELL}>
        <StopSelect
          rows={rows}
          idx={idx}
          L={L}
          onAdd={(id) =>
            onChange({ ...row, location_ids: [...row.location_ids, id] })
          }
        />
        <Chips
          row={row}
          L={L}
          numbered={false}
          onDrop={(id) =>
            onChange({
              ...row,
              location_ids: row.location_ids.filter((l) => l !== id),
            })
          }
        />
      </div>
      <EditMenu
        onClear={() => onChange({ ...row, location_ids: [] })}
        onRemove={onRemove}
      />
    </fieldset>
  );
}

/** 旧 `.cell`。 */
const CELL = "flex min-w-0 flex-col gap-1";

/**
 * 团块 / Private Tour：一台车一块（旧 `.vrow.vblock`，Scope Version 4）。
 * 左边一条：大字 Bus 字母、车号、GPS；右边：一句大白话 + Ready / Needs，第一排四个框，第二排酒店。
 */
export function VanBlock({
  rows,
  idx,
  L,
  flagged,
  isDup,
  disabled = false,
  onChange,
  onRemove,
}: RowProps) {
  const row = rows[idx];
  const veh = L.vehicle(row.vehicle_id);
  const dg = isDriverGuide(row);
  const guide = dg ? null : L.guide(row.guide_hr_id);
  const nHotels = row.location_ids.length;
  const hasDefaults = L.defaultStops(row.shift, row.manifest_id).length > 0;
  const hasDrv = hasDriver(row);
  const hasGuide = !!(row.guide_hr_id || row.guide_typed_name);
  const also = alsoOn(rows, idx, L);
  const alsoDrv = alsoBy(rows, idx, L);
  const missing = [
    !hasDrv && "driver",
    !hasGuide && "guide",
    !row.vehicle_id && "vehicle",
    !nHotels && "hotel",
  ].filter(Boolean) as string[];
  const pick =
    (f: "driver" | "vehicle" | "tour" | "guide" | "bus") => (v: string) => {
      const n = applyField(row, f, v, L);
      if (n) onChange(n);
    };
  return (
    <fieldset
      data-idx={idx}
      disabled={disabled}
      className={cn(
        ROW_RESET,
        // ⚠️ 不能 overflow:hidden：Edit 菜单是绝对定位的弹层（同旧页面）。
        "vrow mt-3 grid grid-cols-[92px_minmax(0,1fr)] items-stretch rounded-[10px] border border-[#dfe3e8] max-[860px]:grid-cols-1",
      )}
    >
      <div className="flex flex-col items-center gap-1.5 rounded-l-[10px] border-r border-[#dfe3e8] bg-[#f3f5f8] px-2 py-3 text-center max-[860px]:flex-row max-[860px]:justify-start max-[860px]:rounded-t-[10px] max-[860px]:rounded-bl-none max-[860px]:border-r-0 max-[860px]:border-b">
        <span className="text-[11px] font-bold tracking-[.06em] text-[#888] uppercase">
          Bus
        </span>
        <span
          className={cn(
            "leading-none tracking-[-.02em]",
            row.bus_label
              ? "text-[30px] font-[750] text-[#1a1a1a]"
              : "text-[15px] font-semibold text-[#888]",
          )}
        >
          {row.bus_label || "-"}
        </span>
        <span
          className={cn(
            "[overflow-wrap:anywhere] tabular-nums",
            veh
              ? "text-[13px] font-[650] text-[#4a5568]"
              : "text-[12px] font-semibold text-[#8a5a00]",
          )}
        >
          {veh
            ? `#${veh.van_no}`
            : row.vehicle_id
              ? "Retired vehicle"
              : "No vehicle"}
        </span>
        <GpsPill v={veh} />
      </div>
      <div className="flex min-w-0 flex-col px-3.5 pt-2.5 pb-3">
        <div className="mb-1 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b-[0.5px] border-black/[.07] pb-[9px]">
          <span className="min-w-0 text-[13px] text-[#4a5568] [&_b]:font-[650] [&_b]:text-[#1a1a1a]">
            {!hasDrv ? (
              row.driver_name ? (
                <Gone name={row.driver_name} role="driver" />
              ) : (
                "No driver yet"
              )
            ) : (
              <>
                <b>
                  {row.driver_typed_name ||
                    L.driverName(row.driver_hr_id) ||
                    "A driver no longer on the list"}
                </b>
                {dg ? " drives and guides" : " drives"}
                {!dg && hasGuide ? (
                  <>
                    {" "}
                    ·{" "}
                    <b>
                      {row.guide_typed_name ||
                        guide?.name ||
                        "a guide no longer on the list"}
                    </b>{" "}
                    guides
                  </>
                ) : null}
              </>
            )}
            {!hasGuide && row.guide_name ? (
              <>
                {" "}
                · <Gone name={row.guide_name} role="guide" />
              </>
            ) : null}
            {` · ${nHotels} hotel${nHotels === 1 ? "" : "s"}`}
          </span>
          {missing.length ? (
            <span className="rounded-full border border-[#e7b75a] bg-[#fdf6e7] px-[9px] py-[3px] text-[11px] font-bold whitespace-nowrap text-[#8a5a00]">
              Needs {missing.join(", ")}
            </span>
          ) : (
            <span className="rounded-full bg-[#e6f4ec] px-[9px] py-[3px] text-[11px] font-bold whitespace-nowrap text-[#1e6b43]">
              Ready
            </span>
          )}
          {isDup ? <Pill tone="warn">Duplicate row</Pill> : null}
          {also.length ? (
            <Pill tone="warn">Also on vehicle {also.join(", ")}</Pill>
          ) : null}
          {alsoDrv.length ? (
            <Pill tone="warn">Also driven by {alsoDrv.join(", ")}</Pill>
          ) : null}
          <div className="ml-auto">
            <EditMenu
              onClear={() => onChange({ ...row, location_ids: [] })}
              onRemove={onRemove}
            />
          </div>
        </div>
        {row.shift !== META.bus_tour_shift ? (
          <div className="flex flex-wrap items-center gap-2 pt-[9px]">
            <span className="text-[12px] font-bold whitespace-nowrap text-[#4a5568]">
              Private Tour
            </span>
            <div className="w-auto max-w-full min-w-[220px] max-[860px]:w-full max-[860px]:min-w-0">
              <TourSelect row={row} L={L} onPick={pick("tour")} />
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-4 items-start gap-2.5 pt-[9px] pb-[7px] max-[860px]:grid-cols-1">
          <div className={VF}>
            <DriverSelect
              row={row}
              L={L}
              bad={flagged}
              onPick={pick("driver")}
            />
            <CclHint row={row} field="driver" L={L} />
            {flagged ? <FieldMsg /> : null}
          </div>
          <div className={VF}>
            <GuideSelect row={row} L={L} onPick={pick("guide")} />
            <CclHint row={row} field="guide" L={L} />
          </div>
          <div className={VF}>
            <VehicleSelect row={row} L={L} todo onPick={pick("vehicle")} />
            <CclHint row={row} field="vehicle" L={L} />
          </div>
          <div className={VF}>
            <BusSelect row={row} onPick={pick("bus")} />
          </div>
        </div>
        <div className="border-t-[0.5px] border-dashed border-black/[.08] pt-[7px] pb-0.5">
          <div className={VF}>
            {hasDefaults ? (
              <span className="text-[11px] font-medium text-[#1d4ed8]">
                Usual stops filled in
              </span>
            ) : null}
            <StopSelect
              rows={rows}
              idx={idx}
              L={L}
              onAdd={(id) =>
                onChange({ ...row, location_ids: [...row.location_ids, id] })
              }
            />
            <Chips
              row={row}
              L={L}
              numbered={hasDefaults}
              onDrop={(id) =>
                onChange({
                  ...row,
                  location_ids: row.location_ids.filter((l) => l !== id),
                })
              }
            />
            <CclExtras row={row} />
          </div>
        </div>
        <div className="mt-1.5">
          <NoteInput row={row} onChange={onChange} />
        </div>
      </div>
    </fieldset>
  );
}

/** 旧 `.vf`。 */
const VF = "flex min-w-0 flex-col gap-[3px]";
