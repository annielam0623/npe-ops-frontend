"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import type { DispatchPrefill, DispatchRow } from "@/types";

import { isRelay, type Lookup, secOf, unmatchedNames } from "./config";

/**
 * CCL 的蓝条（没存过的一天，已经把车填进来了）/ 琥珀条（存过的一天，CCL 发了改版，点 Apply 才改到页面）。
 */
export function CclBanner({
  kind,
  prefill: p,
  rows,
  L,
  onApply,
  onLater,
}: {
  kind: "prefill" | "revision";
  prefill: DispatchPrefill;
  rows: DispatchRow[];
  L: Lookup;
  onApply: () => void;
  onLater: () => void;
}) {
  const [raw, setRaw] = useState(false);
  const unread = p.unread?.length ?? 0;
  const unreadNote = unread
    ? ` ${unread} ${unread === 1 ? "line" : "lines"} of CCL's message could not be read - see View CCL's message.`
    : "";

  let title: string;
  let text: string;
  let items: { label: string; where: string; what: string }[] = [];
  if (kind === "prefill") {
    const miss = unmatchedNames(p.rows);
    title = `Filled in from CCL's schedule “${p.title}”`;
    text =
      "Check each vehicle, pick the hotels for Morning Relay, then Save. Nothing is saved yet." +
      (miss
        ? ` ${miss} ${miss === 1 ? "name does" : "names do"} not match anyone in Human Resource - pick them below; next time they match on their own.`
        : "") +
      unreadNote;
  } else {
    const n = p.changes?.length ?? 0;
    title = `CCL posted a change “${p.title}” · ${n} ${n === 1 ? "change" : "changes"}`;
    text =
      "Nothing on this day changes until you press Apply changes. Hotels you already picked stay. After Apply, press Save schedule." +
      unreadNote;
    const byId = new Map(rows.map((r) => [r.id, r]));
    items = (p.changes ?? []).flatMap((c) => {
      const n2 = "ccl_row" in c ? p.rows[c.ccl_row] : null;
      const o = "row_id" in c ? (byId.get(c.row_id) ?? null) : null;
      if (c.kind === "changed") {
        if (!o || !n2) return [];
        return [
          {
            label: "Changed",
            where:
              blockName(o, L) + (o.bus_label ? ` · Bus ${o.bus_label}` : ""),
            what: c.fields
              .map(
                (f) =>
                  `${f === "bus_label" ? "bus letter" : f} ${fieldText(o, f, L)} → ${fieldText(n2, f, L)}`,
              )
              .join("; "),
          },
        ];
      }
      if (c.kind === "added")
        return n2
          ? [{ label: "Added", where: blockName(n2, L), what: vanText(n2, L) }]
          : [];
      return o
        ? [{ label: "Removed", where: blockName(o, L), what: vanText(o, L) }]
        : [];
    });
  }

  return (
    <section
      aria-label="CCL"
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm",
        kind === "prefill"
          ? "border-[#3b82f6]/40 bg-[#3b82f6]/10 text-[#dbeafe]"
          : "border-amber-400/40 bg-amber-400/10 text-[#fde68a]",
      )}
    >
      <p className="font-semibold text-white">{title}</p>
      <p>{text}</p>
      {items.length ? (
        <ul className="flex flex-col gap-1">
          {items.map((it, i) => (
            <li key={i}>
              <span className="font-semibold">{it.label}</span>{" "}
              <span className="font-medium">{it.where}</span>: {it.what}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {kind === "revision" ? (
          <>
            <button
              type="button"
              onClick={onApply}
              className="rounded-md border border-[#3b82f6] bg-[#3b82f6] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2f76e8]"
            >
              Apply changes
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => setRaw((r) => !r)}
          className="rounded-md border border-current/30 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
        >
          {raw ? "Hide CCL’s message" : "View CCL’s message"}
        </button>
        {kind === "revision" ? (
          <button
            type="button"
            onClick={onLater}
            className="rounded-md px-3 py-1.5 text-xs font-medium underline"
          >
            Not now
          </button>
        ) : null}
      </div>
      {raw ? (
        <pre className="max-h-80 overflow-auto rounded-md bg-black/30 p-3 text-xs whitespace-pre-wrap text-[#e2e8f0]">
          {p.raw_content}
        </pre>
      ) : null}
    </section>
  );
}

function blockName(r: DispatchRow, L: Lookup): string {
  if (isRelay(r.shift)) return "Morning Relay";
  return L.day.sections.find((s) => secOf(s) === secOf(r))?.title ?? "Bus Tour";
}

function personText(
  r: DispatchRow,
  role: "driver" | "guide",
  L: Lookup,
): string {
  const hid = role === "driver" ? r.driver_hr_id : r.guide_hr_id;
  const typed = role === "driver" ? r.driver_typed_name : r.guide_typed_name;
  if (typed) return `${typed} (typed)`;
  if (hid) {
    if (role === "driver")
      return L.driverName(hid) || "a driver no longer on the list";
    return (
      L.guide(hid)?.name ??
      (L.driverName(hid) || "a guide no longer on the list")
    );
  }
  const text = r.ccl
    ? role === "driver"
      ? r.ccl.driver_text
      : r.ccl.guide_text
    : null;
  return text ? `CCL wrote ${text} (no match)` : `no ${role}`;
}

function vehicleText(r: DispatchRow, L: Lookup): string {
  const v = L.vehicle(r.vehicle_id);
  if (v) return v.van_no;
  return r.ccl?.vehicle_text
    ? `${r.ccl.vehicle_text} (not in Vehicles)`
    : "no vehicle";
}

function fieldText(r: DispatchRow, f: string, L: Lookup): string {
  if (f === "driver" || f === "guide") return personText(r, f, L);
  if (f === "vehicle") return vehicleText(r, L);
  return r.bus_label ? `Bus ${r.bus_label}` : "no bus letter";
}

function vanText(r: DispatchRow, L: Lookup): string {
  const dg = r.ccl?.is_driver_guide;
  return (
    `${personText(r, "driver", L)}, vehicle ${vehicleText(r, L)}` +
    (r.bus_label ? `, Bus ${r.bus_label}` : "") +
    (dg
      ? ", Driver Guide"
      : r.guide_hr_id || r.guide_typed_name
        ? `, guide ${personText(r, "guide", L)}`
        : "")
  );
}
