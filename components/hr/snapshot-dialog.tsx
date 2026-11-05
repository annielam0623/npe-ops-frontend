"use client";

import { useEffect, useId, useState } from "react";

import { Modal } from "@/components/ui/modal";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchFieldSnapshot } from "@/lib/hr-working-record-api";
import { cn } from "@/lib/utils";
import type {
  FieldGuestStatus,
  FieldHours,
  FieldSnapshot,
} from "@/types/hr-working-record";

import {
  clock,
  dayHeader,
  hasText,
  hoursLine,
  hoursNeedCheck,
  hoursNote,
  roundLabel,
} from "./working-record-utils";

/** 点 📷 要开的那一天（Q6 A：只有也能看 Live drivers 的人有 📷）。 */
export interface SnapshotTarget {
  hrId: number;
  name: string;
  date: string;
  kind: "driver" | "guide";
  /** 那天又开车又带团：弹窗里能切到另一种。 */
  other: "driver" | "guide" | null;
  hours: FieldHours | null;
}

type Load =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "ready"; snap: FieldSnapshot };

const TRIGGER_LABEL: Record<string, string> = {
  relay_10am: "Relay ended (10:00 AM)",
  checked_out: "Checked out",
  not_checked_out: "Not checked out (11:00 PM)",
  guide_time: "Guide snapshot time",
  after_completion: "Changed after completion",
};

const STATUS_LABEL: Record<NonNullable<FieldGuestStatus>, string> = {
  picked_up: "Picked up",
  boarded: "Boarded",
  no_show: "No show",
};

/**
 * Q3 A：弹窗。上面那天做了哪几段、车、上下班；每站到 / 离；人数、Picked up / No show、每张单收进
 * 「Show guest counts and orders」，默认不展开；卡头下拉选版本（存了以后又改过会多一版）。
 */
export function SnapshotDialog({
  target,
  onClose,
  onUnauthorized,
}: {
  target: SnapshotTarget;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const titleId = useId();
  const [kind, setKind] = useState(target.kind);
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [showGuests, setShowGuests] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: "loading" });
    fetchFieldSnapshot(
      target.hrId,
      target.date,
      kind,
      version,
      controller.signal,
    )
      .then((snap) => {
        if (!controller.signal.aborted) setLoad({ kind: "ready", snap });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else if (isStatus(error, 404)) setLoad({ kind: "none" });
        else setLoad({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [target.hrId, target.date, kind, version, onUnauthorized]);

  const snap = load.kind === "ready" ? load.snap : null;
  const h = target.hours;
  const line = h ? hoursLine(h) : null;
  const note = h ? hoursNote(h) : null;

  return (
    <Modal
      titleId={titleId}
      onDismiss={onClose}
      panelClassName="max-w-[460px] overflow-hidden !rounded-[16px] border border-white/25 !bg-[#06101c] !text-[#f8fafc] !shadow-[0_10px_40px_rgba(0,0,0,.6)]"
    >
      <div data-wr-snapshot>
        <header className="border-b border-sky-400/40 bg-[#0f2744] px-3.5 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <h3 id={titleId} className="text-[15px] font-bold">
              {target.name}
            </h3>
            <span className="text-[9.5px] font-bold tracking-[.09em] text-[#7ab3e0] uppercase">
              {kind === "driver" ? "Driver" : "Guide"} ·{" "}
              {dayHeader(target.date)}
            </span>
          </div>
          {target.other ? (
            <div
              role="group"
              aria-label="Driver or guide"
              className="mt-1.5 flex gap-1.5"
            >
              {([target.kind, target.other] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  data-wr-kind={k}
                  aria-pressed={kind === k}
                  onClick={() => {
                    setKind(k);
                    setVersion(undefined);
                  }}
                  className={cn(
                    "cursor-pointer rounded-[6px] border px-2 py-px text-[12px]",
                    kind === k
                      ? "border-white/60 bg-white/15 text-white"
                      : "border-white/25 text-white/70",
                  )}
                >
                  As {k}
                </button>
              ))}
            </div>
          ) : null}
          {snap ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
              <select
                aria-label="Version"
                data-wr-version
                value={snap.version}
                onChange={(e) => setVersion(Number(e.target.value))}
                className="rounded-[6px] border border-white/25 bg-[#0b1727] px-2 py-0.5 text-[12px] text-white"
              >
                {[...snap.versions]
                  .sort((a, b) => b.version - a.version)
                  .map((v) => (
                    <option key={v.version} value={v.version}>
                      {TRIGGER_LABEL[v.trigger] ?? v.trigger} ·{" "}
                      {clock(v.created_at) ?? ""}
                    </option>
                  ))}
              </select>
              <span className="text-white/60">
                Version {snap.version} of {snap.versions.length}
              </span>
            </div>
          ) : null}
        </header>

        <div className="flex max-h-[70vh] flex-col gap-2.5 overflow-y-auto px-3.5 py-2.5 text-[12px]">
          {load.kind === "loading" ? (
            <p className="text-white/60">Loading…</p>
          ) : load.kind === "none" ? (
            <p data-wr-snapshot-none className="text-white/60">
              No snapshot for that day.
            </p>
          ) : load.kind === "error" ? (
            <p role="alert" className="text-[#fca5a5]">
              Could not load the snapshot: {load.message}
            </p>
          ) : snap ? (
            <>
              <div>
                <Sub>Work</Sub>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <Th>Shift</Th>
                      <Th>Van</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.data.shifts.map((s, i) => {
                      const round = roundLabel(s);
                      return (
                        <tr key={i}>
                          <Td>
                            {hasText(s.title) ? s.title : "No tour name"}
                            {round ? ` · ${round}` : ""}
                          </Td>
                          <Td>{hasText(s.van) ? s.van : "No van"}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p data-wr-snapshot-hours className="mt-1.5">
                  <span className="text-white/60">Hours: </span>
                  {line ?? <span className="text-white/60">—</span>}
                  {h?.source === "schedule" ? (
                    <span className="text-white/60"> (tour times)</span>
                  ) : null}
                </p>
                {hoursNeedCheck(h) && note ? (
                  <p className="mt-1 rounded-[6px] border border-amber-300/40 bg-amber-300/10 px-2 py-1 font-semibold text-[#fde68a]">
                    ⚠ {note} — check before payroll.
                  </p>
                ) : null}
              </div>

              <div>
                <Sub>Stops</Sub>
                {snap.data.stops.length ? (
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <Th>Stop</Th>
                        <Th>Arrived</Th>
                        <Th>Left</Th>
                        <Th>Stayed</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {snap.data.stops.map((s, i) => (
                        <tr key={i}>
                          <Td>{s.hotel}</Td>
                          <Td>{clock(s.arrived_at) ?? "—"}</Td>
                          <Td>{clock(s.left_at) ?? "—"}</Td>
                          <Td>
                            {s.dwell_minutes !== null
                              ? `${s.dwell_minutes} min`
                              : "—"}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-white/60">No stop times recorded.</p>
                )}
              </div>

              {kind === "driver" ? (
                <p className="text-white/60">
                  SMS sent from the driver page: {snap.data.sms.sent}
                </p>
              ) : null}

              <button
                type="button"
                data-wr-guests-toggle
                aria-expanded={showGuests}
                onClick={() => setShowGuests((v) => !v)}
                className="cursor-pointer self-start text-[#7dd3fc]"
              >
                {showGuests ? "▾" : "▸"} Show guest counts and orders
              </button>
              {showGuests ? (
                <div data-wr-guests className="flex flex-col gap-2">
                  <p>
                    Pax {snap.data.guests.pax} ·{" "}
                    {kind === "guide"
                      ? `Boarded ${snap.data.guests.boarded}`
                      : `Picked up ${snap.data.guests.picked_up}`}{" "}
                    · No show {snap.data.guests.no_show} · Not marked{" "}
                    {snap.data.guests.not_marked}
                  </p>
                  {snap.data.roster.length ? (
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <Th>Order</Th>
                          <Th>Pax</Th>
                          <Th>Status</Th>
                          <Th>When</Th>
                          <Th>By</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {snap.data.roster.map((r) => (
                          <tr key={r.order_number}>
                            <Td>{r.order_number}</Td>
                            <Td>{r.pax}</Td>
                            <Td>
                              {r.status ? STATUS_LABEL[r.status] : "Not marked"}
                            </Td>
                            <Td>{clock(r.at) ?? "—"}</Td>
                            <Td>{r.by ?? "—"}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-[7px] border border-white/25 px-3 py-1 text-[12.5px] text-white/90 hover:bg-white/10"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-[3px] text-[10.5px] font-bold tracking-[.08em] text-[#7ab3e0] uppercase">
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="border-b border-white/[.12] px-1 py-[3px] text-left text-[11px] font-semibold text-white/60">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="border-b border-white/[.06] px-1 py-[3px]">{children}</td>
  );
}
