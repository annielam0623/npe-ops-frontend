"use client";

import { useId, useState } from "react";

import {
  approveRequest,
  declineRequest,
  type ConfirmRequest,
  type RequestSlot,
} from "@/lib/schedule-confirm-api";
import { clock, dayLabel } from "@/lib/schedule-leave";
import { leaveErrorOf } from "@/lib/schedule-leave-api";
import { swapRestProblem } from "@/lib/schedule-swap-rest";

import {
  BTN_BLUE,
  BTN_PLAIN,
  ErrorBox,
  HINT,
  LeaveDialogShell,
  RED,
  shiftLabelOf,
  type LeaveDialogData,
} from "../schedule-leave/ui";

/*
 * 员工改班 / 换班请求的批复（N1 A：总览页顶第 4 条灰色栏「Shift change requests · N」点开）。
 * 逻辑照 Staff Schedule 现在的 Responses 卡（components/schedule/responses-card.tsx）：接口不变
 * POST /api/schedule/confirmation-requests/{id}/approve | decline；换班还在等对方（awaiting_peer）时不能批；
 * 发布后的换班批准前再挡一次「晚接早」（swapRestProblem，responses-card.tsx restFor）。
 * 样子照 preview v2 第 2 节 d-resp：Decline / Approve（蓝），点了就存（同批假）。
 */

function slotText(s: RequestSlot | null, label: (k: string) => string): string {
  return s
    ? `${dayLabel(s.date)} ${label(s.shift_type)} ${clock(s.start_time)} – ${clock(s.end_time)}`
    : "";
}

/** 栏里那一行、框里那一句（英文，staff 看）。 */
export function requestLine(
  r: ConfirmRequest,
  label: (k: string) => string,
): string {
  const short = (s: RequestSlot | null) =>
    s ? `${dayLabel(s.date)} ${label(s.shift_type)}` : "a shift";
  if (r.kind === "swap")
    return `${r.from.name} asks to swap ${short(r.my_slot)} with ${r.peer?.name ?? "someone"}`;
  if (r.kind === "move")
    return `${r.from.name} asks to move ${short(r.my_slot)} to ${r.date ? dayLabel(r.date) : "another day"}`;
  return `${r.from.name} asks to add ${r.shift_type ? `a ${label(r.shift_type)} shift` : "a shift"} on ${r.date ? dayLabel(r.date) : "a day"}`;
}

function peerState(r: ConfirmRequest): string | null {
  if (r.kind !== "swap" || !r.peer) return null;
  if (r.status === "awaiting_peer")
    return `Waiting for ${r.peer.name} to agree`;
  return r.peer_timed_out
    ? `${r.peer.name} didn't reply in time`
    : `${r.peer.name} has agreed`;
}

interface ShiftChangeRequestDialogProps {
  data: LeaveDialogData;
  request: ConfirmRequest;
  /** 批 / 拒成功：总览重新读 range。 */
  onDone: (result: "approved" | "declined") => void;
  onClose: () => void;
}

export function ShiftChangeRequestDialog({
  data,
  request: r,
  onDone,
  onClose,
}: ShiftChangeRequestDialogProps) {
  const titleId = useId();
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = (k: string) => shiftLabelOf(data.shiftTypes, k);
  const nameOf = (id: number) =>
    data.employees.find((e) => e.id === id)?.name ??
    (r.from.employee_id === id ? r.from.name : (r.peer?.name ?? ""));

  const rest =
    r.kind === "swap" && r.my_slot && r.their_slot
      ? swapRestProblem(data.slots, r.my_slot.id, r.their_slot.id, {
          typeLabel: label,
          dayText: dayLabel,
          nameOf,
        })?.replace(
          " Pick another day.",
          " Decline it, or change the schedule first.",
        )
      : null;
  const canDecide = r.status === "pending";

  async function act(what: "approve" | "decline") {
    if (busy) return;
    setBusy(what);
    setError(null);
    try {
      await (what === "approve" ? approveRequest : declineRequest)(r.id);
      onDone(what === "approve" ? "approved" : "declined");
    } catch (e) {
      setError(
        leaveErrorOf(e, `Couldn't ${what} the request. Try again.`).detail,
      );
    } finally {
      setBusy(null);
    }
  }

  const peer = peerState(r);
  return (
    <LeaveDialogShell
      titleId={titleId}
      title={`Shift change request · ${r.from.name}`}
      onClose={onClose}
      busy={!!busy}
      footer={
        canDecide ? (
          <>
            <button
              type="button"
              data-request-decline
              className={BTN_PLAIN}
              disabled={!!busy}
              onClick={() => act("decline")}
            >
              {busy === "decline" ? "Declining…" : "Decline"}
            </button>
            <button
              type="button"
              data-request-approve
              className={BTN_BLUE}
              disabled={!!busy || !!rest}
              title={rest ?? undefined}
              onClick={() => act("approve")}
            >
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>
          </>
        ) : (
          <button type="button" className={BTN_PLAIN} onClick={onClose}>
            Close
          </button>
        )
      }
    >
      <div className="text-[12.5px]">
        {requestLine(r, label)}
        {peer ? ` (${peer})` : ""}.
      </div>
      {r.kind === "swap" && r.my_slot && r.their_slot ? (
        <div className="text-[12.5px]" data-request-after>
          After the swap: {r.peer?.name} {slotText(r.my_slot, label)};{" "}
          {r.from.name} {slotText(r.their_slot, label)}.
        </div>
      ) : r.kind === "move" && r.my_slot ? (
        <div className="text-[12.5px]" data-request-after>
          Now: {slotText(r.my_slot, label)}. After: the same shift on{" "}
          {r.date ? dayLabel(r.date) : "the new day"}.
        </div>
      ) : null}
      {rest ? (
        <div className={RED} data-request-rest>
          {rest}
        </div>
      ) : null}
      {r.status === "awaiting_peer" ? (
        <div className={HINT}>
          You can decide after {r.peer?.name ?? "the other person"} agrees.
        </div>
      ) : null}
      {canDecide && !rest ? (
        <div className={HINT}>Approving changes the schedule right away.</div>
      ) : null}
      <ErrorBox text={error} />
    </LeaveDialogShell>
  );
}
