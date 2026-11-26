"use client";

import { useId, useMemo, useState } from "react";

import { cleanNote } from "@/components/schedule/add-shift-dialog";
import { leaveTimeLabel, rejectLeaveRequest } from "@/lib/leave-api";
import {
  clock,
  clockRange,
  coverCandidates,
  coverNote,
  coverShiftType,
  datesBetween,
  dayLabel,
  deleteSlotGaps,
  hhmm,
  hourlyError,
  hourlyLeaveGaps,
  isHourly,
  mins,
  type Span,
} from "@/lib/schedule-leave";
import {
  approveLeaveWithChanges,
  leaveCategoryLabel,
  leaveErrorOf,
  type ApproveBody,
  type OverviewLeaveRequest,
} from "@/lib/schedule-leave-api";
import { cn } from "@/lib/utils";

import {
  BTN_BLUE,
  BTN_PLAIN,
  ErrorBox,
  HalfHourSelect,
  HINT,
  INP,
  LABEL,
  LeaveDialogShell,
  MINI_TABLE,
  MINI_TD,
  MINI_TH,
  RED,
  shiftLabelOf,
  YELLOW,
  type LeaveDialogData,
} from "./ui";

const ROUTE_TEXT: Record<string, string> = {
  manager: "You are their manager",
  team_lead: "You are their team lead",
  super_admin: "You are Super Admin",
};

function spansText(spans: Span[]): string {
  return spans.map((s) => clockRange(hhmm(s.start), hhmm(s.end))).join(", ");
}

function describe(
  kindLabel: string,
  from: string,
  to: string,
  start: string | null,
  end: string | null,
): string {
  const days =
    from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`;
  return start && end
    ? `${days} ${clockRange(start, end)} (${kindLabel})`
    : `${days} (${kindLabel})`;
}

interface LeaveRequestDialogProps {
  data: LeaveDialogData;
  request: OverviewLeaveRequest;
  /** 批 / 驳回成功：总览重新读 range。 */
  onDone: (result: "approved" | "rejected") => void;
  onClose: () => void;
}

/**
 * 批 / 驳回 / 调整请假（总览页顶「Leave requests」点开；只能批假的人看到的也是这个框，N3 A）。点了就存（同现在 leave-view）。
 * - Q11 A：批之前可以改类别、日期、时段，改了出黄框，员工收到的通知写改过的内容（approve.adjust）。
 * - 按天（Q1 A）：那几天的班逐个「Give to」别人或删掉（approve.shifts），每个都处理了才能批；已发布的周不能删（Q2 A）。
 * - 按小时（Q2 A）：已发布的周里会空出时段 ⇒ 必须选谁顶上（approve.cover），没选 Approve 是灰的；草稿周不用选，空档进 Gaps。
 * 后端是同一个事务，任一不成整条不批；400 / 409 原话放红框。
 */
export function LeaveRequestDialog({
  data,
  request: req,
  onDone,
  onClose,
}: LeaveRequestDialogProps) {
  const titleId = useId();
  const name = req.employee_name;
  const emp = req.employee_id ?? -1;
  const origHourly = isHourly(req);
  const [kind, setKind] = useState(req.kind);
  const [hours, setHours] = useState(origHourly);
  const [from, setFrom] = useState(req.date_from);
  const [to, setTo] = useState(req.date_to);
  const [start, setStart] = useState(req.start_time ?? "09:00");
  const [end, setEnd] = useState(req.end_time ?? "11:00");
  const [give, setGive] = useState<Record<number, string>>({});
  const [cover, setCover] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = (k: string) => shiftLabelOf(data.shiftTypes, k);
  const kindLabel = (k: string) =>
    k === req.kind && req.kind_label
      ? req.kind_label
      : leaveCategoryLabel(data.categories, k);

  const effTo = hours ? from : to;
  const adjusted =
    kind !== req.kind ||
    from !== req.date_from ||
    effTo !== req.date_to ||
    hours !== origHourly ||
    (hours && (start !== req.start_time || end !== req.end_time));
  const dates = datesBetween(from, effTo);
  const published = dates.some((d) => data.weekStatusOf(d) === "published");
  // 这条假自己还没批，不在 timeOff 里；算空档时把这个人这几天别的假也排除（一人一天一条）。
  const otherOff = data.timeOff;

  /* ── 按天：那几天的班 ── */
  const daySlots = useMemo(
    () =>
      hours
        ? []
        : data.slots
            .filter((s) => s.employee_id === emp && dates.includes(s.date))
            .sort(
              (a, b) =>
                a.date.localeCompare(b.date) ||
                a.start_time.localeCompare(b.start_time),
            ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hours, data.slots, emp, from, effTo],
  );

  /* ── 按小时：会空出来的时段 ── */
  const hourErr = hours ? hourlyError(start, end) : null;
  const gaps: Span[] = useMemo(() => {
    if (!hours || hourErr) return [];
    if (!adjusted && req.would_gap)
      return req.would_gap
        .map((g) => ({
          start: mins(g.start_time) ?? 0,
          end: mins(g.end_time) ?? 0,
        }))
        .filter((g) => g.end > g.start);
    return hourlyLeaveGaps(
      emp,
      from,
      start,
      end,
      data.employees,
      data.slots,
      otherOff,
    );
  }, [
    hours,
    hourErr,
    adjusted,
    req.would_gap,
    emp,
    from,
    start,
    end,
    data,
    otherOff,
  ]);
  const needCover = hours && published && gaps.length > 0;
  const coverList = useMemo(
    () =>
      needCover
        ? coverCandidates(
            from,
            start,
            end,
            emp,
            data.employees,
            data.slots,
            otherOff,
            label,
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needCover, from, start, end, emp, data],
  );
  const coverType = coverShiftType(emp, from, start, end, data.slots, "mid");
  const hourShifts = hours
    ? data.slots.filter((s) => s.employee_id === emp && s.date === from)
    : [];

  /* ── 能不能批 ── */
  const multiDayHours = hours && to !== from && to !== req.date_to;
  const unhandled = daySlots.filter((s) => !give[s.id]);
  const coverOk =
    !needCover || coverList.some((c) => String(c.id) === cover && !c.blocked);
  const rangeErr =
    !hours && (to < from || dates.length === 0)
      ? "Pick an end date on or after the start date (at most 31 days)."
      : null;
  const blockText = hourErr ?? rangeErr;
  const canApprove =
    req.can_decide !== false &&
    !busy &&
    !blockText &&
    !multiDayHours &&
    unhandled.length === 0 &&
    coverOk;

  async function approve() {
    if (!canApprove) return;
    const body: ApproveBody = {};
    if (adjusted)
      body.adjust = {
        date_from: from,
        date_to: effTo,
        kind,
        start_time: hours ? start : null,
        end_time: hours ? end : null,
      };
    if (daySlots.length)
      body.shifts = daySlots.map((s) =>
        give[s.id] === "delete"
          ? { slot_id: s.id, action: "delete" as const }
          : {
              slot_id: s.id,
              action: "give" as const,
              employee_id: Number(give[s.id]),
            },
      );
    if (needCover && cover) body.cover = { employee_id: Number(cover) };
    if (note.trim()) body.note = note.trim();
    setBusy("approve");
    setError(null);
    try {
      await approveLeaveWithChanges(req.id, body);
      onDone("approved");
    } catch (e) {
      setError(
        leaveErrorOf(e, "Couldn't approve. Nothing was changed.").detail,
      );
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (busy || req.can_decide === false) return;
    setBusy("reject");
    setError(null);
    try {
      await rejectLeaveRequest(req.id, note.trim() || null);
      onDone("rejected");
    } catch (e) {
      setError(leaveErrorOf(e, "Couldn't reject. Try again.").detail);
    } finally {
      setBusy(null);
    }
  }

  const activeCats = data.categories.filter(
    (c) => c.is_active || c.key === req.kind,
  );
  const approveText = daySlots.length ? "Move shifts and approve" : "Approve";
  const askedBits = [
    `Asked ${leaveTimeLabel(req.created_at).replace(/,? \d+:\d+ [AP]M$/, "")}`,
    req.route ? ROUTE_TEXT[req.route] : null,
    req.note ? `“${req.note}”` : null,
  ].filter(Boolean);

  return (
    <LeaveDialogShell
      titleId={titleId}
      title={`Leave request · ${name}`}
      onClose={onClose}
      busy={!!busy}
      footer={
        req.can_decide === false ? (
          <button type="button" className={BTN_PLAIN} onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button
              type="button"
              data-leave-reject
              className={BTN_PLAIN}
              disabled={!!busy}
              onClick={reject}
            >
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
            <button
              type="button"
              data-leave-approve
              className={BTN_BLUE}
              disabled={!canApprove}
              title={
                needCover && !coverOk
                  ? `Pick who covers ${spansText(gaps)} first`
                  : unhandled.length
                    ? "Choose what happens to each shift first"
                    : undefined
              }
              onClick={approve}
            >
              {busy === "approve" ? "Approving…" : approveText}
            </button>
          </>
        )
      }
    >
      <div className="text-[12.5px] text-[#475569]">
        {askedBits.join(" · ")}
        {published ? (
          <>
            {" · "}
            <b>This week is published</b>
          </>
        ) : null}
      </div>
      {req.can_decide === false ? (
        <div className={HINT}>
          You can see this request but can&apos;t decide it
          {req.approver_names?.length
            ? ` — it went to ${req.approver_names.join(", ")}`
            : ""}
          .
        </div>
      ) : null}

      <div className="grid gap-[3px]">
        <label className={LABEL} htmlFor={`${titleId}-type`}>
          Type
        </label>
        <select
          id={`${titleId}-type`}
          className={INP}
          value={kind}
          disabled={req.can_decide === false}
          onChange={(e) => setKind(e.target.value)}
        >
          {activeCats.map((c) => (
            <option key={c.key} value={c.key}>
              {kindLabel(c.key)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[12.5px]">
          <input
            type="radio"
            name={`${titleId}-dur`}
            checked={!hours}
            disabled={req.can_decide === false}
            onChange={() => setHours(false)}
          />{" "}
          All day
        </label>
        <label className="flex items-center gap-1 text-[12.5px]">
          <input
            type="radio"
            name={`${titleId}-dur`}
            checked={hours}
            disabled={req.can_decide === false}
            onChange={() => {
              setHours(true);
              setTo(from);
            }}
          />{" "}
          Hours
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          aria-label={hours ? "Date" : "From"}
          className={cn(INP, "w-[150px]")}
          value={from}
          disabled={req.can_decide === false}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            setFrom(v);
            if (hours || to < v) setTo(v);
          }}
        />
        {hours ? (
          <>
            <HalfHourSelect
              value={start}
              onChange={setStart}
              ariaLabel="From"
            />
            –
            <HalfHourSelect
              value={end}
              onChange={setEnd}
              ariaLabel="To"
              min={start}
            />
          </>
        ) : (
          <>
            –
            <input
              type="date"
              aria-label="To"
              className={cn(INP, "w-[150px]")}
              value={to}
              min={from}
              disabled={req.can_decide === false}
              onChange={(e) => e.target.value && setTo(e.target.value)}
            />
          </>
        )}
      </div>
      {adjusted ? (
        <div className={YELLOW} data-adjusted>
          Changed from{" "}
          {describe(
            kindLabel(req.kind),
            req.date_from,
            req.date_to,
            req.start_time ?? null,
            req.end_time ?? null,
          )}
          . {name} will be told the leave was approved as{" "}
          <b>
            {describe(
              kindLabel(kind),
              from,
              effTo,
              hours ? start : null,
              hours ? end : null,
            )}
          </b>
          .
        </div>
      ) : null}

      {/* ── 按天：逐个班处理（Q1 A） ── */}
      {!hours && daySlots.length ? (
        <>
          <div className={YELLOW}>
            {name} has {daySlots.length} shift{daySlots.length === 1 ? "" : "s"}{" "}
            on {daySlots.length === 1 ? "this day" : "these days"}.{" "}
            {published
              ? "Give each one to someone, then approve."
              : "Give each one to someone or delete it, then approve."}
          </div>
          <table className={MINI_TABLE}>
            <thead>
              <tr>
                <th className={MINI_TH}>Day</th>
                <th className={MINI_TH}>Shift</th>
                <th className={MINI_TH}>Give to</th>
              </tr>
            </thead>
            <tbody>
              {daySlots.map((s) => {
                const pub = data.weekStatusOf(s.date) === "published";
                const opts = coverCandidates(
                  s.date,
                  s.start_time,
                  s.end_time,
                  emp,
                  data.employees,
                  data.slots,
                  otherOff,
                  label,
                );
                return (
                  <tr key={s.id} data-move-slot={s.id}>
                    <td className={MINI_TD}>{dayLabel(s.date)}</td>
                    <td className={MINI_TD}>
                      {label(s.shift_type)} {clock(s.start_time)} –{" "}
                      {clock(s.end_time)}
                    </td>
                    <td className={MINI_TD}>
                      <select
                        aria-label={`Give ${dayLabel(s.date)} ${label(s.shift_type)} to`}
                        className={cn(INP, "w-full")}
                        value={give[s.id] ?? ""}
                        disabled={req.can_decide === false}
                        onChange={(e) =>
                          setGive((g) => ({ ...g, [s.id]: e.target.value }))
                        }
                      >
                        <option value="">Choose…</option>
                        {opts.map((c) => (
                          <option
                            key={c.id}
                            value={String(c.id)}
                            disabled={!!c.blocked}
                          >
                            {c.blocked ? `${c.name} — ${c.blocked}` : c.name}
                          </option>
                        ))}
                        {pub ? null : (
                          <option value="delete">Nobody (delete)</option>
                        )}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {daySlots
            .filter((s) => give[s.id] === "delete")
            .map((s) => {
              const left = deleteSlotGaps(
                s,
                data.employees,
                data.slots,
                otherOff,
              );
              return left.length ? (
                <div key={s.id} className={RED} data-delete-gap={s.id}>
                  {dayLabel(s.date)}: deleting the {label(s.shift_type)} leaves{" "}
                  {spansText(left)} with nobody on. It shows under Gaps after
                  you approve.
                </div>
              ) : null;
            })}
        </>
      ) : null}

      {/* ── 按小时：那天的班 + 顶班（Q2 A） ── */}
      {hours && !hourErr ? (
        <>
          {hourShifts.length ? (
            <div className="text-[12.5px]">
              That day:{" "}
              <b>
                {hourShifts
                  .map(
                    (s) =>
                      `${label(s.shift_type)} ${clock(s.start_time)} – ${clock(s.end_time)}`,
                  )
                  .join(", ")}
              </b>
              . The shift stays; {clockRange(start, end)} shows as leave under
              it.
            </div>
          ) : (
            <div className="text-[12.5px]">
              No shift that day. Nobody needs to cover.
            </div>
          )}
          {gaps.length && needCover ? (
            <>
              <div className={RED} data-need-cover>
                This week is published. Nobody else is on {spansText(gaps)}, so
                pick who covers it before you approve.
              </div>
              <div className="grid gap-[3px]">
                <label className={LABEL} htmlFor={`${titleId}-cover`}>
                  Who covers {clockRange(start, end)}
                </label>
                <select
                  id={`${titleId}-cover`}
                  data-cover-select
                  className={INP}
                  value={cover}
                  disabled={req.can_decide === false}
                  onChange={(e) => setCover(e.target.value)}
                >
                  <option value="">Pick someone</option>
                  {coverList.map((c) => (
                    <option
                      key={c.id}
                      value={String(c.id)}
                      disabled={!!c.blocked}
                    >
                      {c.blocked
                        ? `${c.name} — ${c.blocked}`
                        : `${c.name} · ${c.thatDay}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className={HINT}>
                Adds{" "}
                <b>
                  {label(coverType)} {clockRange(start, end)}
                </b>{" "}
                for the person you pick, note <b>“{coverNote(name)}”</b>, in the
                same step. Then use Send to confirm on the week bar so they get
                the change.
              </div>
            </>
          ) : gaps.length ? (
            <div className={YELLOW} data-draft-gap>
              This leaves {spansText(gaps)} with nobody on. The week is a draft,
              so you can approve now; the gap shows under Gaps until someone
              fills it.
            </div>
          ) : null}
        </>
      ) : null}

      {req.can_decide === false ? null : (
        <div className="grid gap-[3px]">
          <label className={LABEL} htmlFor={`${titleId}-note`}>
            Note to {name} (optional)
          </label>
          <input
            id={`${titleId}-note`}
            className={INP}
            maxLength={120}
            value={note}
            onChange={(e) => setNote(cleanNote(e.target.value))}
          />
        </div>
      )}
      <ErrorBox
        text={
          blockText ??
          (multiDayHours ? "Leave by the hour is for one day only." : null) ??
          error
        }
      />
    </LeaveDialogShell>
  );
}
