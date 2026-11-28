import type { DispatchRow, DispatchSeating } from "@/types";
import { META, secOf, type Lookup, type RailIssue } from "./config";

/**
 * ⑦ Not enough seats (Annie 2026-11-27「QS1选A，动手」, preview J1z29Ssgx412iBfzsToeyC v3): a Bus car with more
 * guests than seats gets an amber line on the card + an amber Schedule check item. Warn only, sending is not blocked.
 * - Seats: the vehicle picked on the page now (Vehicles seat count) + this day's seat adjustment, min 1
 *   (same as bus-windows.ts assignedCapacities / backend tour_manifest.py:2177). No seat count = no line.
 * - Guests: the saved seating (GET /api/dispatch/seating, bus `pax`), matched by the saved row's Bus letter.
 * - Bus cars only (no Morning Relay), not Farm out cars (no seat limit).
 */
export interface SeatShort {
  seats: number;
  guests: number;
  short: number;
  /** Another Bus of the same tour with room for all of them (the one with most free seats); null = none. */
  to: { label: string; free: number } | null;
}

const s = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function seatShortByIdx(
  rows: DispatchRow[],
  base: DispatchRow[],
  seating: DispatchSeating | null,
  L: Lookup,
): Map<number, SeatShort> {
  const out = new Map<number, SeatShort>();
  if (!seating || seating.run_date !== L.day.run_date) return out;
  // Each Bus car: seats now + guests in the saved seating.
  const info = rows.map((r) => {
    if (r.shift !== META.bus_tour_shift || r.farm_out || r.id == null)
      return null;
    const t = seating.tours.find((x) => x.manifest_id === r.manifest_id);
    if (!t?.uploaded || (t.mode !== "single" && t.mode !== "lettered"))
      return null;
    const saved = base.find((b) => b.id === r.id);
    if (!saved) return null;
    const bus =
      t.mode === "single"
        ? t.buses.length === 1
          ? t.buses[0]
          : undefined
        : t.buses.find((b) => b.label != null && b.label === saved.bus_label);
    if (!bus || bus.farm_out) return null;
    const v = L.vehicle(r.vehicle_id)?.seats;
    if (v == null) return null;
    const seats = Math.max(1, v + (r.seat_adjustment ?? 0));
    return { sec: secOf(r), label: bus.label, seats, guests: bus.pax };
  });
  info.forEach((a, i) => {
    if (!a || a.guests <= a.seats) return;
    const short = a.guests - a.seats;
    let to: SeatShort["to"] = null;
    info.forEach((b, j) => {
      if (!b || j === i || b.sec !== a.sec || b.label == null) return;
      const free = b.seats - b.guests;
      if (free >= short && (!to || free > to.free))
        to = { label: b.label, free };
    });
    out.set(i, { seats: a.seats, guests: a.guests, short, to });
  });
  return out;
}

/** Card line, first sentence (bold). */
export function seatShortTitle(x: SeatShort): string {
  return `Not enough seats: ${s(x.seats, "seat")}, ${s(x.guests, "guest")} — ${x.short} short.`;
}

/** Card line, the suggestion. */
export function seatShortHint(x: SeatShort): string {
  return x.to
    ? `Move ${s(x.short, "guest")} to Bus ${x.to.label} (${s(x.to.free, "seat")} free) in Arrange seats, or change to a vehicle with at least ${x.guests} seats.`
    : `Change to a vehicle with at least ${x.guests} seats, or add a bus.`;
}

/** Schedule check items (amber), Fix › goes to the card. */
export function seatShortIssues(
  short: Map<number, SeatShort>,
  rows: DispatchRow[],
  L: Lookup,
): RailIssue[] {
  return [...short.entries()].map(([i, x]) => {
    const r = rows[i];
    const sec = L.day.sections.find((z) => secOf(z) === secOf(r));
    const van = L.vehicle(r.vehicle_id)?.van_no;
    const bus = r.bus_label ? `Bus ${r.bus_label}` : `Bus #${van ?? "?"}`;
    return {
      title: `${sec?.title ?? "Bus tour"}: ${bus} is ${s(x.short, "seat")} short`,
      detail: `${s(x.guests, "guest")}, ${s(x.seats, "seat")}. ${
        x.to
          ? `Move ${s(x.short, "guest")} to Bus ${x.to.label} or change to a bigger vehicle.`
          : "Change to a bigger vehicle or add a bus."
      }`,
      idx: i,
    };
  });
}
