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
        {d.languages ? ` · ${d.languages}` : ""}
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
      className={cn(
        SELECT,
        bad ? BAD : !hasDriver(row) && !isRelay(row.shift) && TODO,
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
      className={cn(SELECT, !hasGuide && TODO)}
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
      className={cn(SELECT, todo && !sel && TODO)}
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
      className={cn(SELECT, !sel && !row.custom_tour_name && TODO)}
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
      className={SELECT}
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
      className="rounded-md border border-dashed border-stone-300 bg-white px-2 py-1 text-xs text-stone-600"
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

const SELECT =
  "w-full min-w-0 rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60";
const TODO = "border-dashed border-amber-500 bg-amber-50/40";
const BAD = "border-[#A32D2D] ring-1 ring-[#A32D2D]";

// ── 小部件 ──

function Pill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "info";
  children: React.ReactNode;
}) {
  const cls = {
    ok: "bg-emerald-100 text-emerald-800",
    warn: "bg-amber-100 text-amber-900",
    bad: "bg-red-100 text-red-700",
    info: "bg-sky-100 text-sky-800",
  }[tone];
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        cls,
      )}
    >
      {children}
    </span>
  );
}

function GpsPill({ v }: { v: { has_tracking: boolean } | null }) {
  if (!v) return null;
  return v.has_tracking ? (
    <Pill tone="ok">GPS</Pill>
  ) : (
    <Pill tone="bad">No live GPS</Pill>
  );
}

function Gone({ name, role }: { name: string; role: "driver" | "guide" }) {
  return (
    <span className="text-xs text-[#A32D2D]">
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
  const text = !c
    ? null
    : field === "driver"
      ? c.driver_text
      : field === "vehicle"
        ? c.vehicle_text
        : c.is_driver_guide
          ? null
          : c.guide_text;
  if (!text) return nohr ? <div className="mt-1">{nohr}</div> : null;
  const picked =
    field === "driver"
      ? row.driver_hr_id || typed
      : field === "vehicle"
        ? row.vehicle_id
        : row.guide_hr_id || typed;
  if (picked) {
    return (
      <div
        className="mt-1 flex flex-wrap items-center gap-1 text-xs text-stone-500"
        data-ccl={field}
      >
        CCL: <b>{text}</b>
        {nohr}
      </div>
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
    <div className="mt-1 text-xs text-[#A32D2D]" data-ccl={field}>
      CCL wrote <b>{text}</b> -{" "}
      {cands.length
        ? `pick ${cands.map((n) => n.name).join(" or ")}`
        : field === "vehicle"
          ? "not in Vehicles, pick the vehicle"
          : `no match, pick the ${field}`}
    </div>
  );
}

function CclExtras({ row }: { row: DispatchRow }) {
  const c = row.ccl;
  if (!c) return null;
  return (
    <>
      {c.route_label ? (
        <span className="text-xs text-[#8a5a00]">CCL: {c.route_label}</span>
      ) : null}
      {c.ccl_note ? (
        <span className="text-xs text-[#8a5a00]">CCL: {c.ccl_note}</span>
      ) : null}
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
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Edit this vehicle"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50"
      >
        Edit ▾
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 flex w-40 flex-col rounded-md border border-stone-200 bg-white py-1 text-sm shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onClear();
            }}
            className="px-3 py-1.5 text-left hover:bg-stone-50"
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
            className="px-3 py-1.5 text-left text-[#A32D2D] hover:bg-red-50"
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
  const size =
    label.length >= 4 ? "8.5px" : label.length === 3 ? "10px" : "11.5px";
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full font-bold text-white",
        !d && "text-stone-400",
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
    <div className="mt-1 text-xs text-[#A32D2D]">
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
  return (
    <>
      {row.location_ids.map((l, n) => (
        <button
          key={l}
          type="button"
          data-drop={l}
          onClick={() => onDrop(l)}
          title="Remove this hotel"
          className="flex items-center gap-1 rounded-full border border-stone-300 bg-stone-50 px-2 py-0.5 text-xs hover:border-red-300 hover:bg-red-50"
        >
          {numbered ? (
            <span className="rounded-full bg-stone-700 px-1 text-[10px] text-white">
              {n + 1}
            </span>
          ) : null}
          {L.locName(l)}{" "}
          <span aria-hidden className="text-stone-400">
            ✕
          </span>
        </button>
      ))}
    </>
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
      aria-label="Note"
      maxLength={200}
      value={row.note}
      placeholder="Note for yourself (not sent to anyone)"
      onChange={(e) => onChange({ ...row, note: e.target.value })}
      className="w-full rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-xs"
    />
  );
}

/** Morning Relay：一排一行（司机 | 车 | 酒店 | 菜单）。不带团、导游、Bus 字母。 */
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
        "vrow grid grid-cols-1 gap-2 border-b border-stone-100 px-3 py-3 last:border-b-0 md:grid-cols-[minmax(200px,1.1fr)_minmax(140px,0.8fr)_2fr_auto]",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Avatar d={drv} ring={ring} />
          <DriverSelect row={row} L={L} bad={flagged} onPick={pick("driver")} />
        </div>
        <CclHint row={row} field="driver" L={L} />
        {flagged ? <FieldMsg /> : null}
        {!hasDriver(row) && row.driver_name ? (
          <div className="mt-1">
            <Gone name={row.driver_name} role="driver" />
          </div>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-1">
          {isDup ? <Pill tone="warn">Duplicate row</Pill> : null}
          {also.length ? (
            <Pill tone="warn">Also on vehicle {also.join(", ")}</Pill>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <VehicleSelect row={row} L={L} todo={false} onPick={pick("vehicle")} />
        <CclHint row={row} field="vehicle" L={L} />
        <CclExtras row={row} />
        <div className="flex flex-wrap gap-1">
          <GpsPill v={veh} />
          {alsoDrv.length ? (
            <Pill tone="warn">Also driven by {alsoDrv.join(", ")}</Pill>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
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
        <StopSelect
          rows={rows}
          idx={idx}
          L={L}
          onAdd={(id) =>
            onChange({ ...row, location_ids: [...row.location_ids, id] })
          }
        />
      </div>
      <div className="flex items-start justify-end">
        <EditMenu
          onClear={() => onChange({ ...row, location_ids: [] })}
          onRemove={onRemove}
        />
      </div>
      <div className="md:col-span-4">
        <NoteInput row={row} onChange={onChange} />
      </div>
    </fieldset>
  );
}

/** 团块 / Private Tour：一台车一块。 */
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
        "vrow flex border-b border-stone-100 last:border-b-0",
      )}
    >
      <div className="flex w-20 shrink-0 flex-col items-center gap-1 border-r border-stone-100 bg-stone-50 px-2 py-3 text-center">
        <span className="text-[10px] font-semibold text-stone-400 uppercase">
          Bus
        </span>
        <span
          className={cn(
            "text-2xl font-extrabold",
            !row.bus_label && "text-stone-300",
          )}
        >
          {row.bus_label || "-"}
        </span>
        <span
          className={cn(
            "text-xs font-semibold",
            !veh && "font-normal text-stone-400",
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
      <div className="flex min-w-0 flex-1 flex-col gap-2 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="mr-auto">
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
            <Pill tone="warn">Needs {missing.join(", ")}</Pill>
          ) : (
            <Pill tone="ok">Ready</Pill>
          )}
          {isDup ? <Pill tone="warn">Duplicate row</Pill> : null}
          {also.length ? (
            <Pill tone="warn">Also on vehicle {also.join(", ")}</Pill>
          ) : null}
          {alsoDrv.length ? (
            <Pill tone="warn">Also driven by {alsoDrv.join(", ")}</Pill>
          ) : null}
          <EditMenu
            onClear={() => onChange({ ...row, location_ids: [] })}
            onRemove={onRemove}
          />
        </div>
        {row.shift !== META.bus_tour_shift ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-500">
              Private Tour
            </span>
            <div className="max-w-sm flex-1">
              <TourSelect row={row} L={L} onPick={pick("tour")} />
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <DriverSelect
              row={row}
              L={L}
              bad={flagged}
              onPick={pick("driver")}
            />
            <CclHint row={row} field="driver" L={L} />
            {flagged ? <FieldMsg /> : null}
          </div>
          <div className="min-w-0">
            <GuideSelect row={row} L={L} onPick={pick("guide")} />
            <CclHint row={row} field="guide" L={L} />
          </div>
          <div className="min-w-0">
            <VehicleSelect row={row} L={L} todo onPick={pick("vehicle")} />
            <CclHint row={row} field="vehicle" L={L} />
          </div>
          <div className="min-w-0">
            <BusSelect row={row} onPick={pick("bus")} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {hasDefaults ? (
            <span className="text-xs text-stone-500">
              Usual stops filled in
            </span>
          ) : null}
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
          <StopSelect
            rows={rows}
            idx={idx}
            L={L}
            onAdd={(id) =>
              onChange({ ...row, location_ids: [...row.location_ids, id] })
            }
          />
          <CclExtras row={row} />
        </div>
        <NoteInput row={row} onChange={onChange} />
      </div>
    </fieldset>
  );
}
