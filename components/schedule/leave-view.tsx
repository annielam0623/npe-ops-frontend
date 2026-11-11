"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { HowToUse } from "@/components/ui/how-to-use";
import { usePhoneCollapse, usePhoneInfo } from "@/components/ui/phone";
import { describeError, isStatus } from "@/lib/api-errors";
import { laToday } from "@/lib/la-date";
import {
  approveLeaveRequest,
  createLeaveRequest,
  fetchLeaveQueue,
  fetchMyLeaveRequests,
  LEAVE_KINDS,
  LEAVE_MAX_DAYS,
  LEAVE_NOTE_MAX,
  leaveDayCount,
  leaveKindLabel,
  leaveRangeLabel,
  leaveTimeLabel,
  rejectLeaveRequest,
  withdrawLeaveRequest,
  type LeaveKind,
  type LeaveQueue,
  type LeaveQueueItem,
  type LeaveRequest,
  type LeaveShift,
  type MyLeave,
} from "@/lib/leave-api";
import { cn } from "@/lib/utils";
import { ApiError } from "@/types";

import { CARD, CARD_HEADER, INPUT, MUTED } from "./config";

/*
 * Staff Schedule › Leave 标签（G282，Annie 2026-11-11「同意全部推荐。动手」，preview v3 Q1–Q10 全 A）。
 *   - 人人都有：Request leave（只给自己；不在排班名单上的只显示一句提示）+ My leave requests（pending 可 Withdraw，Q3 A）。
 *   - 批复人（后端 is_approver，或 Super Admin）多两块：Waiting for approval（Approve 蓝 / Reject 理由可空）+ Handled（最近 30 天）。
 * Send request / Approve / Reject / Withdraw 都是点了就存（直接提交），不走页面 Save。
 * 接口形状照后端 21 的定稿草案（lib/leave-api.ts）。
 */

/**
 * Q7「申请那天已排班」：A = 照样能批、黄框提示；B = 有班的天不让批、红框、Approve 灰。
 * Annie 2026-11-11 在后端 21 窗口定 B（「改成 B (Recommended)」）：后端同样挡（approve ⇒ 400 原话照显示），
 * 队列每条带 blocked（那几天有班 = true）。留着开关，以后要改回 A 只改这一处。
 */
export const SHIFT_BLOCKS_APPROVE = true;

type Load<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "missing" }
  | { kind: "ready"; data: T };

const SMALL_PRIMARY = cn(
  DARK_PRIMARY_BUTTON_CLASS,
  "px-3 py-1 text-[12.5px] max-sm:px-2.5",
);
const SMALL_SECONDARY = cn(
  DARK_SECONDARY_BUTTON_CLASS,
  "px-3 py-1 text-[12.5px] max-sm:px-2.5",
);
const STATUS_CLASS: Record<string, string> = {
  pending: "text-amber-300",
  approved: "text-emerald-400",
  rejected: "text-red-400",
  withdrawn: "text-white/45",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

function daysText(r: Pick<LeaveRequest, "date_from" | "date_to" | "days">) {
  const n = r.days ?? leaveDayCount(r.date_from, r.date_to);
  return `${n} day${n === 1 ? "" : "s"}`;
}

/** 409 already_decided（已被批 / 驳回 / 撤回）：后端带原话 + 最新的那条。 */
function isAlreadyDecided(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status === 409 &&
    (e.body as { code?: unknown } | null)?.code === "already_decided"
  );
}

function StatusLines({ r }: { r: LeaveRequest }) {
  return (
    <>
      <span data-leave-status={r.status} className={STATUS_CLASS[r.status]}>
        {STATUS_LABEL[r.status] ?? r.status}
      </span>
      {r.status === "pending" ? (
        <div className={cn("text-[12px]", MUTED)}>
          Sent {leaveTimeLabel(r.created_at)}
        </div>
      ) : r.decided_by_name || r.decided_at ? (
        <div className={cn("text-[12px]", MUTED)}>
          {r.status === "withdrawn" || !r.decided_by_name
            ? ""
            : `by ${r.decided_by_name} · `}
          {leaveTimeLabel(r.decided_at)}
        </div>
      ) : null}
      {r.decision_note ? (
        <div className={cn("text-[12px] break-words", MUTED)}>
          “{r.decision_note}”
        </div>
      ) : null}
    </>
  );
}

function Section({
  title,
  hint,
  children,
  testId,
  extra,
  bodyClassName,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  testId: string;
  extra?: ReactNode;
  /** 手机上收起时加在内容区上（usePhoneCollapse().hide），免得留一块空框。 */
  bodyClassName?: string;
}) {
  const info = usePhoneInfo();
  return (
    <section data-leave-section={testId} className={CARD}>
      <div className={CARD_HEADER}>
        <div className="min-w-0">
          <h2 className="m-0 flex items-center text-[15px] font-semibold text-white">
            {title}
            {hint ? info.button : null}
          </h2>
          {hint ? (
            <p className={cn("m-0 mt-0.5 text-[12.5px]", MUTED, info.hide)}>
              {hint}
            </p>
          ) : null}
        </div>
        {extra}
      </div>
      <div
        className={cn(
          "flex min-w-0 flex-col gap-3 px-4 py-3 max-sm:px-3",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

function Th({ children }: { children?: ReactNode }) {
  return (
    <th className="border-b border-white/10 px-2 py-1.5 font-semibold whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <td className={cn("px-2 py-2", className)}>{children}</td>;
}

/* ───────────── Request leave ───────────── */

function RequestForm({
  onSent,
  notOnSchedule,
}: {
  onSent: () => void;
  notOnSchedule: boolean;
}) {
  const today = laToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [kind, setKind] = useState<LeaveKind>("pto");
  const [note, setNote] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "sent" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const collapse = usePhoneCollapse();

  const days = leaveDayCount(from, to);
  const problem =
    !from || !to
      ? "Pick the first and last day."
      : days === 0
        ? "The last day is before the first day."
        : days > LEAVE_MAX_DAYS
          ? `A request can cover up to ${LEAVE_MAX_DAYS} days. Send two requests for longer leave.`
          : null;

  async function submit() {
    if (problem || state.kind === "sending") return;
    setState({ kind: "sending" });
    try {
      await createLeaveRequest({
        date_from: from,
        date_to: to,
        kind,
        note: note.trim() || null,
      });
      setNote("");
      setState({ kind: "sent" });
      onSent();
    } catch (e) {
      setState({ kind: "error", message: describeError(e) });
    }
  }

  const touch = () => {
    if (state.kind !== "sending") setState({ kind: "idle" });
  };

  return (
    <Section
      testId="request"
      title="Request leave"
      hint="Ask for days off. Your approver decides, and you get an email either way."
      bodyClassName={notOnSchedule ? undefined : collapse.hide}
      extra={
        notOnSchedule ? null : (
          <button
            type="button"
            data-leave-form-toggle
            aria-expanded={collapse.open}
            onClick={collapse.toggle}
            className={cn(SMALL_SECONDARY, "sm:hidden")}
          >
            {collapse.open ? "Hide form" : "+ Request leave"}
          </button>
        )
      }
    >
      {notOnSchedule ? (
        <p data-leave-not-on-schedule className={cn("m-0 text-[13px]", MUTED)}>
          You are not on the staff schedule, so you can&apos;t request leave
          here. Ask whoever makes the schedule to add you.
        </p>
      ) : (
        <form
          data-leave-form
          className={cn(
            "grid grid-cols-[repeat(3,minmax(0,max-content))_1fr] items-end gap-3 max-sm:grid-cols-2",
          )}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="flex min-w-0 flex-col gap-1 text-[12px] text-white/60">
            First day
            <input
              id="leave-from"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (e.target.value && (!to || to < e.target.value))
                  setTo(e.target.value);
                touch();
              }}
              className={INPUT}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[12px] text-white/60">
            Last day
            <input
              id="leave-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value);
                touch();
              }}
              className={INPUT}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[12px] text-white/60">
            Type
            <select
              id="leave-kind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as LeaveKind);
                touch();
              }}
              className={INPUT}
            >
              {LEAVE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <span
            data-leave-days
            className={cn("self-center pb-1 text-[12.5px]", MUTED)}
          >
            {days > 0 ? `${days} day${days === 1 ? "" : "s"}` : ""}
          </span>
          <label className="col-span-full flex min-w-0 flex-col gap-1 text-[12px] text-white/60">
            Note (optional, up to {LEAVE_NOTE_MAX} characters)
            <input
              id="leave-note"
              value={note}
              maxLength={LEAVE_NOTE_MAX}
              placeholder="e.g. Doctor appointment"
              onChange={(e) => {
                setNote(e.target.value);
                touch();
              }}
              className={cn(INPUT, "w-full")}
            />
          </label>
          <div className="col-span-full flex flex-wrap items-center gap-3">
            <button
              type="submit"
              data-leave-send
              disabled={!!problem || state.kind === "sending"}
              className={DARK_PRIMARY_BUTTON_CLASS}
            >
              {state.kind === "sending" ? "Sending…" : "Send request"}
            </button>
            {problem ? (
              <span data-leave-form-msg className="text-[13px] text-red-400">
                {problem}
              </span>
            ) : state.kind === "sent" ? (
              <span
                data-leave-form-msg
                className="text-[13px] text-emerald-400"
              >
                Sent. Your approver has been told.
              </span>
            ) : state.kind === "error" ? (
              <span
                data-leave-form-msg
                role="alert"
                className="text-[13px] text-red-400"
              >
                {state.message}
              </span>
            ) : null}
          </div>
        </form>
      )}
    </Section>
  );
}

/* ───────────── My leave requests ───────────── */

function MyRequests({
  load,
  onChanged,
}: {
  load: Load<MyLeave>;
  onChanged: () => void;
}) {
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{
    id: number;
    ok: boolean;
    text: string;
  } | null>(null);

  async function withdraw(id: number) {
    setBusy(id);
    try {
      await withdrawLeaveRequest(id);
      setMsg({ id, ok: true, text: "Withdrawn." });
      setAsking(null);
      onChanged();
    } catch (e) {
      setMsg({ id, ok: false, text: describeError(e) });
      // 已经被批 / 驳回了 ⇒ 重拉，状态跟着变，原话留着。
      if (isAlreadyDecided(e)) {
        setAsking(null);
        onChanged();
      }
    } finally {
      setBusy(null);
    }
  }

  function action(r: LeaveRequest) {
    const m =
      msg?.id === r.id ? (
        <div
          data-leave-mine-msg={r.id}
          className={cn(
            "text-[12.5px] whitespace-normal",
            msg.ok ? "text-emerald-400" : "text-red-400",
          )}
        >
          {msg.text}
        </div>
      ) : null;
    if (r.status !== "pending") return m;
    if (asking === r.id)
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px]">Withdraw this request?</span>
          <button
            type="button"
            data-leave-withdraw-yes={r.id}
            disabled={busy === r.id}
            onClick={() => void withdraw(r.id)}
            className={SMALL_SECONDARY}
          >
            {busy === r.id ? "Withdrawing…" : "Withdraw"}
          </button>
          <button
            type="button"
            onClick={() => setAsking(null)}
            className={cn(SMALL_SECONDARY, "border-transparent bg-transparent")}
          >
            Keep
          </button>
          {m}
        </div>
      );
    return (
      <div>
        <button
          type="button"
          data-leave-withdraw={r.id}
          onClick={() => {
            setMsg(null);
            setAsking(r.id);
          }}
          className={SMALL_SECONDARY}
        >
          Withdraw
        </button>
        {m}
      </div>
    );
  }

  const list = load.kind === "ready" ? load.data.requests : [];
  return (
    <Section testId="mine" title="My leave requests">
      {load.kind === "loading" ? (
        <p className={cn("m-0 text-[13px]", MUTED)}>Loading…</p>
      ) : load.kind === "error" ? (
        <p role="alert" className="m-0 text-[13px] text-red-400">
          {load.message}
        </p>
      ) : list.length === 0 ? (
        <p className={cn("m-0 text-[13px] italic", MUTED)}>
          No leave requests yet.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto max-sm:hidden">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-white/55">
                  <Th>Days</Th>
                  <Th>Type</Th>
                  <Th>Note</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr
                    key={r.id}
                    data-leave-mine={r.id}
                    className={cn(
                      "border-t border-white/[.06] align-top",
                      r.status === "withdrawn" && "opacity-55",
                    )}
                  >
                    <Td className="whitespace-nowrap">
                      {leaveRangeLabel(r.date_from, r.date_to)}
                      <div className={cn("text-[12px]", MUTED)}>
                        {daysText(r)}
                      </div>
                    </Td>
                    <Td className="text-amber-200">{leaveKindLabel(r.kind)}</Td>
                    <Td className="break-words">
                      {r.note || <span className={MUTED}>—</span>}
                    </Td>
                    <Td>
                      <StatusLines r={r} />
                    </Td>
                    <Td className="max-w-[260px]">{action(r)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-2 sm:hidden">
            {list.map((r) => (
              <div
                key={r.id}
                data-leave-mine-card={r.id}
                className={cn(
                  "flex flex-col gap-1 rounded-[9px] border border-white/10 px-3 py-2 text-[13px]",
                  r.status === "withdrawn" && "opacity-55",
                )}
              >
                <div className="flex justify-between gap-2">
                  <b>{leaveRangeLabel(r.date_from, r.date_to)}</b>
                  <span className="text-amber-200">
                    {leaveKindLabel(r.kind)}
                  </span>
                </div>
                {r.note ? (
                  <div className={cn("text-[12px] break-words", MUTED)}>
                    {r.note}
                  </div>
                ) : null}
                <div>
                  <StatusLines r={r} />
                </div>
                {action(r)}
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

/* ───────────── Approver ───────────── */

function routeText(r: LeaveQueueItem): string | null {
  if (r.route === "manager") return "You are their manager";
  if (r.route === "team_lead")
    return r.team_names?.length
      ? `Team lead: ${r.team_names.join(", ")}`
      : "You are their team lead";
  if (r.route === "super_admin") return "No manager or team lead";
  return null;
}

function shiftsIn(r: LeaveQueueItem): LeaveShift[] {
  return (r.shifts ?? []).filter(
    (s) => s.date >= r.date_from && s.date <= r.date_to,
  );
}

/** 有班不让批：以后端的 blocked 为准，没带就看那几天有没有班。 */
function isBlocked(r: LeaveQueueItem): boolean {
  if (!SHIFT_BLOCKS_APPROVE) return false;
  return r.blocked ?? shiftsIn(r).length > 0;
}

/** 「Sat, Nov 15 (Day 10:00–18:00)」。 */
function shiftText(s: LeaveShift): string {
  const time =
    s.start_time && s.end_time
      ? `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`
      : "";
  const what = [s.label ?? s.shift_type ?? "", time].filter(Boolean).join(" ");
  return `${leaveRangeLabel(s.date, s.date)}${what ? ` (${what})` : ""}`;
}

function ShiftWarning({ r }: { r: LeaveQueueItem }) {
  const shifts = shiftsIn(r);
  if (!shifts.length && !isBlocked(r)) return null;
  const txt = shifts.length
    ? shifts.map(shiftText).join(", ")
    : leaveRangeLabel(r.date_from, r.date_to);
  return isBlocked(r) ? (
    <div
      data-leave-shift-warn="block"
      className="mt-1.5 rounded-[7px] border border-red-400/35 bg-red-400/10 px-2.5 py-1.5 text-[12.5px] text-red-100"
    >
      {r.employee_name} has a shift on {txt}. Move the shift on the Schedule tab
      before approving.
    </div>
  ) : (
    <div
      data-leave-shift-warn="warn"
      className="mt-1.5 rounded-[7px] border border-amber-400/35 bg-amber-400/10 px-2.5 py-1.5 text-[12.5px] text-amber-100"
    >
      {r.employee_name} has a shift on {txt}. Approving won&apos;t change the
      schedule. Move the shift on the Schedule tab.
    </div>
  );
}

function Decide({
  r,
  onDone,
}: {
  r: LeaveQueueItem;
  /** ok = 自己批成了（绿字）；否则是已被别人处理（红字原话）。 */
  onDone: (result: { ok: boolean; text: string }) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blocked = isBlocked(r);

  async function run(which: "approve" | "reject") {
    setBusy(which);
    setError(null);
    try {
      if (which === "approve") await approveLeaveRequest(r.id);
      else await rejectLeaveRequest(r.id, reason.trim() || null);
      onDone({
        ok: true,
        text: `${which === "approve" ? "Approved" : "Rejected"}. ${r.employee_name} has been emailed.`,
      });
    } catch (e) {
      // 别人先批了 / 员工撤了（谁先批算谁）⇒ 原话放到 Handled 那一行，列表重拉。
      if (isAlreadyDecided(e)) {
        onDone({ ok: false, text: describeError(e) });
        return;
      }
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-w-[150px] flex-col gap-1.5">
      {rejecting ? (
        <>
          <input
            id={`leave-reason-${r.id}`}
            data-leave-reason={r.id}
            value={reason}
            maxLength={LEAVE_NOTE_MAX}
            placeholder={`Reason (optional, sent to ${r.employee_name})`}
            onChange={(e) => setReason(e.target.value)}
            className={cn(INPUT, "w-full")}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-leave-reject-send={r.id}
              disabled={busy !== null}
              onClick={() => void run("reject")}
              className={SMALL_SECONDARY}
            >
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRejecting(false);
                setError(null);
              }}
              className={cn(
                SMALL_SECONDARY,
                "border-transparent bg-transparent",
              )}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-leave-approve={r.id}
            disabled={busy !== null || blocked}
            title={
              blocked
                ? "Move the shift on the Schedule tab before approving."
                : undefined
            }
            onClick={() => void run("approve")}
            className={SMALL_PRIMARY}
          >
            {busy === "approve" ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            data-leave-reject={r.id}
            disabled={busy !== null}
            onClick={() => setRejecting(true)}
            className={SMALL_SECONDARY}
          >
            Reject
          </button>
        </div>
      )}
      {error ? (
        <div
          role="alert"
          data-leave-decide-error={r.id}
          className="text-[12.5px] text-red-400"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

type DoneMsg = Record<number, { ok: boolean; text: string }>;

function QueueRows({
  items,
  decided,
  done,
  onDone,
}: {
  items: LeaveQueueItem[];
  decided: boolean;
  done: DoneMsg;
  onDone: (id: number, result: { ok: boolean; text: string }) => void;
}) {
  const result = (r: LeaveQueueItem) =>
    decided ? (
      <>
        <StatusLines r={r} />
        {done[r.id] ? (
          <div
            data-leave-done={r.id}
            className={cn(
              "text-[12.5px]",
              done[r.id].ok ? "text-emerald-400" : "text-red-400",
            )}
          >
            {done[r.id].text}
          </div>
        ) : null}
      </>
    ) : r.can_decide === false ? (
      <span className={cn("text-[12.5px]", MUTED)}>View only</span>
    ) : (
      <Decide r={r} onDone={(res) => onDone(r.id, res)} />
    );
  return (
    <>
      <div className="overflow-x-auto max-sm:hidden">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-white/55">
              <Th>Who</Th>
              <Th>Days</Th>
              <Th>Type</Th>
              <Th>Note</Th>
              <Th>{decided ? "Result" : ""}</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr
                key={r.id}
                data-leave-queue={r.id}
                className={cn(
                  "border-t border-white/[.06] align-top",
                  decided && "opacity-60",
                )}
              >
                <Td>
                  <b className="text-white">{r.employee_name}</b>
                  {routeText(r) ? (
                    <div className={cn("text-[12px]", MUTED)}>
                      {routeText(r)}
                    </div>
                  ) : null}
                </Td>
                <Td className="whitespace-nowrap">
                  {leaveRangeLabel(r.date_from, r.date_to)}
                  <div className={cn("text-[12px]", MUTED)}>
                    {daysText(r)} · sent {leaveTimeLabel(r.created_at)}
                  </div>
                </Td>
                <Td className="text-amber-200">{leaveKindLabel(r.kind)}</Td>
                <Td className="min-w-[160px] break-words">
                  {r.note || <span className={MUTED}>—</span>}
                  {decided ? null : <ShiftWarning r={r} />}
                </Td>
                <Td>{result(r)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 sm:hidden">
        {items.map((r) => (
          <div
            key={r.id}
            data-leave-queue-card={r.id}
            className={cn(
              "flex flex-col gap-1 rounded-[9px] border border-white/10 px-3 py-2 text-[13px]",
              decided && "opacity-60",
            )}
          >
            <div className="flex justify-between gap-2">
              <b className="text-white">{r.employee_name}</b>
              <span className="text-amber-200">{leaveKindLabel(r.kind)}</span>
            </div>
            <div>
              {leaveRangeLabel(r.date_from, r.date_to)}{" "}
              <span className={cn("text-[12px]", MUTED)}>· {daysText(r)}</span>
            </div>
            {r.note ? (
              <div className={cn("text-[12px] break-words", MUTED)}>
                {r.note}
              </div>
            ) : null}
            {decided ? null : <ShiftWarning r={r} />}
            {result(r)}
          </div>
        ))}
      </div>
    </>
  );
}

/* ───────────── 整块 ───────────── */

export function LeaveView({
  superAdmin,
  onUnauthorized,
  onPendingCount,
}: {
  superAdmin: boolean;
  onUnauthorized: () => void;
  /** 待我批的条数变了（标签上写「Leave · N waiting」）。 */
  onPendingCount?: (n: number) => void;
}) {
  const [mine, setMine] = useState<Load<MyLeave>>({ kind: "loading" });
  const [pending, setPending] = useState<Load<LeaveQueue>>({
    kind: "loading",
  });
  const [decided, setDecided] = useState<Load<LeaveQueue>>({
    kind: "loading",
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [doneMsg, setDoneMsg] = useState<DoneMsg>({});
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    const ctl = new AbortController();
    function wrap<T>(p: Promise<T>, set: (l: Load<T>) => void) {
      p.then(
        (data) => {
          if (!ctl.signal.aborted) set({ kind: "ready", data });
        },
        (e: unknown) => {
          if (ctl.signal.aborted) return;
          if (isStatus(e, 401)) {
            onUnauthorized();
            return;
          }
          if (isStatus(e, 404) || isStatus(e, 403)) set({ kind: "missing" });
          else set({ kind: "error", message: describeError(e) });
        },
      );
    }
    wrap(fetchMyLeaveRequests(ctl.signal), setMine);
    wrap(fetchLeaveQueue("pending", ctl.signal), setPending);
    wrap(fetchLeaveQueue("decided", ctl.signal), setDecided);
    return () => ctl.abort();
  }, [reloadKey, onUnauthorized]);

  useEffect(() => {
    if (pending.kind === "ready") onPendingCount?.(pending.data.pending_count);
  }, [pending, onPendingCount]);

  // 批复人：后端 is_approver（有人报给我）或者是 Super Admin。不是就只显示员工那两块。
  const isApprover =
    superAdmin ||
    (pending.kind === "ready" && pending.data.is_approver) ||
    (decided.kind === "ready" && decided.data.is_approver);
  const pendingList = pending.kind === "ready" ? pending.data.requests : [];
  const decidedList = decided.kind === "ready" ? decided.data.requests : [];

  return (
    <div data-leave-view className="flex flex-col gap-4 max-sm:gap-3">
      {isApprover ? (
        <>
          <Section
            testId="waiting"
            title="Waiting for approval"
            hint={
              superAdmin
                ? "Every leave request that hasn't been decided. As Super Admin you can approve any of them."
                : "Leave requests sent to you as their manager or team lead."
            }
          >
            {pending.kind === "loading" ? (
              <p className={cn("m-0 text-[13px]", MUTED)}>Loading…</p>
            ) : pending.kind === "error" ? (
              <p role="alert" className="m-0 text-[13px] text-red-400">
                {pending.message}
              </p>
            ) : pendingList.length === 0 ? (
              <p className={cn("m-0 text-[13px] italic", MUTED)}>
                Nothing waiting.
              </p>
            ) : (
              <QueueRows
                items={pendingList}
                decided={false}
                done={doneMsg}
                onDone={(id, res) => {
                  setDoneMsg((m) => ({ ...m, [id]: res }));
                  reload();
                }}
              />
            )}
          </Section>
          <Section testId="handled" title="Handled" hint="Last 30 days.">
            {decided.kind === "error" ? (
              <p role="alert" className="m-0 text-[13px] text-red-400">
                {decided.message}
              </p>
            ) : decidedList.length > 0 ? (
              <QueueRows
                items={decidedList}
                decided
                done={doneMsg}
                onDone={() => {}}
              />
            ) : (
              <p className={cn("m-0 text-[13px] italic", MUTED)}>
                {decided.kind === "loading" ? "Loading…" : "Nothing yet."}
              </p>
            )}
          </Section>
        </>
      ) : null}

      <RequestForm
        onSent={reload}
        notOnSchedule={mine.kind === "ready" && mine.data.employee === null}
      />
      <MyRequests load={mine} onChanged={reload} />

      <div className="px-1">
        <HowToUse
          dark
          title="How to use — Leave"
          items={[
            "Pick the first and last day, the type and an optional note, then click Send request. You can only request leave for yourself.",
            "Your request goes to your manager. If you don't have one, it goes to the team lead of each of your teams, and the first one to decide wins. If there is neither, it goes to Super Admin. They get a notice on the Dashboard and an email.",
            "My leave requests shows each request: Pending, Approved or Rejected, who decided and when. You get an email when it is decided.",
            "While a request is still Pending you can click Withdraw. If it is already approved and plans change, ask your approver to remove the leave on the Schedule tab.",
            "Approved leave shows on the Schedule as Leave.",
            ...(isApprover
              ? [
                  "Waiting for approval lists the requests sent to you. Click Approve, or click Reject, type a reason if you want, and click Reject again. The person gets an email either way.",
                  SHIFT_BLOCKS_APPROVE
                    ? "A red line means the person already has a shift that day. Move the shift on the Schedule tab first, then approve."
                    : "A yellow line means the person already has a shift that day. You can still approve. The schedule does not change by itself, so move the shift on the Schedule tab.",
                  "If someone else decided first, the request moves to Handled with who decided.",
                ]
              : []),
          ]}
        />
      </div>
    </div>
  );
}
