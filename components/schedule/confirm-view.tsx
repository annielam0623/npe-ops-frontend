"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { CenteredPage } from "@/components/ui/centered-page";
import { Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { shiftYmd } from "@/lib/la-date";
import {
  acceptMyConfirmation,
  answerPeerRequest,
  type ChangeRequestBody,
  type ConfirmRequest,
  type ConfirmSlot,
  fetchMyConfirmation,
  isUnavailable,
  type MyConfirmation,
  type RequestSlot,
  submitMyChanges,
} from "@/lib/schedule-confirm-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { formatRange } from "@/lib/schedule-time";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";

import {
  CARD,
  CARD_HEADER,
  DAY_LABELS,
  MUTED,
  personDotColor,
  shiftCardClass,
  TIME_OFF_LABEL,
} from "./config";

type State =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "expired" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: MyConfirmation };

/** 这一页上攒着、还没发的改动（按 Send my changes 才发）。 */
type Draft =
  | { kind: "swap"; mySlotId: number; theirSlotId: number }
  | { kind: "move"; mySlotId: number; date: string }
  | { kind: "add"; date: string; shiftType: string };

/** 请求在格子里多出来的亮黄卡片。 */
interface CellCard {
  key: string;
  shiftType: string;
  start: string;
  end: string;
  note: string;
}
/** 已有的卡片被请求牵涉：原来那张变淡（ghost），或一分为二（split）。 */
interface SlotMark {
  ghost?: string;
  split?: { left: string; right: string; actions?: ReactNode };
}

interface View {
  dates: string[];
  dayOf: (ymd: string) => string;
  slotById: Map<number, ConfirmSlot>;
  nameOf: (id: number | null) => string;
  typeLabel: (k: string) => string;
  marks: Map<number, SlotMark>;
  extras: Map<string, CellCard[]>;
  busySlots: Set<number>;
  rows: { employee_id: number; name: string }[];
}

/** 同线上排班页周表（week-grid.tsx）：130px 人名列 + 7 天。 */
const COLS = "grid-cols-[130px_repeat(7,minmax(118px,1fr))]";
const REQ_CARD =
  "border-[rgba(250,204,21,.5)] bg-[rgba(253,224,71,.28)] text-[#fde68a]";
const SMALL_BTN =
  "cursor-pointer rounded-[5px] border px-2 py-px text-[10.5px] font-semibold disabled:opacity-50";
const ACCEPT_BTN = cn(SMALL_BTN, "border-[#3b82f6] bg-[#3b82f6] text-white");
const DECLINE_BTN = cn(SMALL_BTN, "border-white/40 text-white");

const DEADLINE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
});
const SENT_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
});

function weekFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const w = new URLSearchParams(window.location.search).get("week");
  return w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : undefined;
}

function md(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

/**
 * 周三确认下周排班（员工这一边）。G138 改版（Annie 2026-10-30「动手」，preview
 * https://claude.ai/artifact/X2bdxVr42yXA6CS8FEEiCc ）：就是线上那张排好的周表，所有人的班都看得到，
 * 只能拖自己的卡片——拖到别人有班的格子 = 换班（先问对方）；拖到自己没班的那天 = 改天上；
 * 自己 off 的格子点「+ Work this day」= 提加班（只能选已有班次）。改动先攒在页面上，按 Send my changes 才发。
 * 点一下自己的卡片再点目标格子也行（手机上拖不动）。周四中午 12 点（deadline）以后只读。
 * 成对的键同意在前（Annie：「一般是accept之前，decline在后」）。
 * 两种进法：登录后（站内提醒里的链接）、邮件里的一人一条链接（token，不用登录）。
 */
export function ConfirmView({ token }: { token?: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [armed, setArmed] = useState<number | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchMyConfirmation({ week: weekFromUrl(), token });
      setState({ kind: "ready", data });
    } catch (e) {
      if (isUnavailable(e)) setState({ kind: "unavailable" });
      else if (isStatus(e, 401) || isStatus(e, 403) || isStatus(e, 410)) {
        if (token) setState({ kind: "expired" });
        else
          window.location.href = buildLegacyLoginRedirectUrl(
            window.location.href,
          );
      } else setState({ kind: "error", message: describeError(e) });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useLeaveGuard(
    drafts.length > 0,
    "Your changes haven't been sent. Leave this page anyway?",
  );

  const data = state.kind === "ready" ? state.data : null;
  const me = data?.person.employee_id ?? -1;
  const editable = !!data?.open && !busy;

  const run = useCallback(
    async (action: () => Promise<MyConfirmation>, sent?: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const fresh = await action();
        setDrafts([]);
        setPicking(null);
        setArmed(null);
        if (fresh && typeof fresh === "object" && "week_start" in fresh)
          setState({ kind: "ready", data: fresh });
        else await load();
        if (sent) setSentAt(SENT_FMT.format(new Date()));
      } catch (e) {
        if (isStatus(e, 401) && !token) {
          window.location.href = buildLegacyLoginRedirectUrl(
            window.location.href,
          );
          return;
        }
        setError(describeError(e));
      } finally {
        setBusy(false);
      }
    },
    [load, token],
  );

  const answer = useCallback(
    (id: number, a: "accept" | "decline") =>
      void run(() => answerPeerRequest({ id, answer: a, token })),
    [run, token],
  );

  const view = useMemo((): View | null => {
    if (!data) return null;
    const dates = DAY_LABELS.map((_, i) => shiftYmd(data.week_start, i));
    const dayOf = (ymd: string) => DAY_LABELS[dates.indexOf(ymd)] ?? md(ymd);
    const slotById = new Map(data.slots.map((s) => [s.id, s]));
    const nameOf = (id: number | null) =>
      id === me
        ? data.person.name
        : (data.employees.find((e) => e.employee_id === id)?.name ?? "");
    const typeLabel = (k: string) =>
      data.shift_types.find((t) => t.key === k)?.label ?? k;

    const marks = new Map<number, SlotMark>();
    const extras = new Map<string, CellCard[]>();
    const busySlots = new Set<number>();
    const pushCard = (emp: number, date: string, c: CellCard) => {
      const k = `${emp}|${date}`;
      extras.set(k, [...(extras.get(k) ?? []), c]);
    };
    const fromSlot = (s: RequestSlot) => ({
      shiftType: s.shift_type,
      start: s.start_time,
      end: s.end_time,
    });

    // 自己的请求：没发的（draft）+ 已发、还在走的（awaiting_peer / pending）
    type Item = {
      key: string;
      kind: Draft["kind"];
      mySlot: RequestSlot | null;
      theirSlot: RequestSlot | null;
      theirEmp: number | null;
      date: string | null;
      shiftType: string | null;
      tag: string;
    };
    const items: Item[] = [];
    for (const r of data.my_requests) {
      if (r.status !== "awaiting_peer" && r.status !== "pending") continue;
      items.push({
        key: `r${r.id}`,
        kind: r.kind,
        mySlot: r.my_slot,
        theirSlot: r.their_slot,
        theirEmp: r.peer?.employee_id ?? null,
        date: r.date,
        shiftType: r.shift_type,
        tag: r.status === "awaiting_peer" ? "asked" : "waiting for approval",
      });
    }
    drafts.forEach((d, i) => {
      const mine = d.kind === "add" ? null : (slotById.get(d.mySlotId) ?? null);
      const theirs =
        d.kind === "swap" ? (slotById.get(d.theirSlotId) ?? null) : null;
      items.push({
        key: `d${i}`,
        kind: d.kind,
        mySlot: mine,
        theirSlot: theirs,
        theirEmp: theirs?.employee_id ?? null,
        date: d.kind === "swap" ? null : d.date,
        shiftType: d.kind === "add" ? d.shiftType : null,
        tag: "not sent",
      });
    });
    for (const it of items) {
      if (it.kind === "swap" && it.mySlot && it.theirSlot && it.theirEmp) {
        const peer = nameOf(it.theirEmp);
        busySlots.add(it.mySlot.id).add(it.theirSlot.id);
        marks.set(it.mySlot.id, { ghost: `↔ to ${peer} if they agree` });
        marks.set(it.theirSlot.id, {
          split: {
            left: `${data.person.name} request`,
            right: `${peer} original`,
          },
        });
        pushCard(me, it.theirSlot.date, {
          key: it.key,
          ...fromSlot(it.theirSlot),
          note: `↔ from ${peer} · ${it.tag}`,
        });
        pushCard(it.theirEmp, it.mySlot.date, {
          key: it.key,
          ...fromSlot(it.mySlot),
          note: `↔ from ${data.person.name} · ${it.tag}`,
        });
      } else if (it.kind === "move" && it.mySlot && it.date) {
        busySlots.add(it.mySlot.id);
        marks.set(it.mySlot.id, { ghost: `moving to ${dayOf(it.date)}` });
        pushCard(me, it.date, {
          key: it.key,
          ...fromSlot(it.mySlot),
          note: `moved here · ${it.tag}`,
        });
      } else if (it.kind === "add" && it.date && it.shiftType) {
        const t = data.shift_types.find((x) => x.key === it.shiftType);
        pushCard(me, it.date, {
          key: it.key,
          shiftType: it.shiftType,
          start: t?.default_start_time ?? "",
          end: t?.default_end_time ?? "",
          note: `+ extra shift · ${it.tag}`,
        });
      }
    }

    // 别人找我换班（awaiting_peer）：我的那格一分为二，格子上 Accept / Decline
    for (const r of data.requests_for_me) {
      if (r.status !== "awaiting_peer" || !r.my_slot || !r.their_slot) continue;
      const from = r.from.name;
      busySlots.add(r.my_slot.id).add(r.their_slot.id);
      marks.set(r.their_slot.id, {
        split: {
          left: `${from} request`,
          right: `${data.person.name} original`,
          actions: (
            <PeerButtons requestId={r.id} busy={busy} onAnswer={answer} />
          ),
        },
      });
      marks.set(r.my_slot.id, { ghost: "↔ to you if you accept" });
      pushCard(me, r.my_slot.date, {
        key: `p${r.id}`,
        ...fromSlot(r.my_slot),
        note: `↔ from ${from} · if you accept`,
      });
      pushCard(r.from.employee_id, r.their_slot.date, {
        key: `p${r.id}`,
        ...fromSlot(r.their_slot),
        note: `↔ from ${data.person.name} · if you accept`,
      });
    }

    const rows = [...data.employees];
    if (!rows.some((e) => e.employee_id === me))
      rows.unshift({ employee_id: me, name: data.person.name });
    return {
      dates,
      dayOf,
      slotById,
      nameOf,
      typeLabel,
      marks,
      extras,
      busySlots,
      rows,
    };
  }, [data, drafts, busy, me, answer]);

  function canDrag(s: ConfirmSlot): boolean {
    return editable && s.employee_id === me && !view?.busySlots.has(s.id);
  }

  /** 把自己的卡片放到一个格子上：别人有班的卡片 = 换班；自己没班的那天 = 改天上。 */
  function dropOn(
    slotId: number,
    target: { slot?: ConfirmSlot; date?: string },
  ) {
    if (!view) return;
    const mine = view.slotById.get(slotId);
    if (!mine || mine.employee_id !== me || view.busySlots.has(slotId)) return;
    setArmed(null);
    setError(null);
    const t = target.slot;
    if (t) {
      if (t.employee_id === null || t.employee_id === me) return;
      if (view.busySlots.has(t.id)) return;
      setDrafts((cur) => [
        ...cur,
        { kind: "swap", mySlotId: slotId, theirSlotId: t.id },
      ]);
    } else if (target.date && target.date !== mine.date) {
      const date = target.date;
      setDrafts((cur) => [...cur, { kind: "move", mySlotId: slotId, date }]);
    }
  }

  function send() {
    if (!data) return;
    const requests: ChangeRequestBody[] = drafts.map((d) =>
      d.kind === "swap"
        ? { kind: "swap", my_slot_id: d.mySlotId, their_slot_id: d.theirSlotId }
        : d.kind === "move"
          ? { kind: "move", my_slot_id: d.mySlotId, date: d.date }
          : { kind: "add", date: d.date, shift_type: d.shiftType },
    );
    void run(
      () => submitMyChanges({ week: data.week_start, token, requests }),
      true,
    );
  }

  const body = (() => {
    if (state.kind === "loading") return <Panel dark>Loading…</Panel>;
    if (state.kind === "unavailable")
      return (
        <Panel dark>
          <p className="font-semibold">Nothing to confirm right now.</p>
        </Panel>
      );
    if (state.kind === "expired")
      return (
        <Panel dark>
          <p className="font-semibold">
            This link has expired. Ask the office to send you a new one.
          </p>
        </Panel>
      );
    if (state.kind === "error")
      return (
        <Panel dark>
          <p className="font-semibold text-red-200">
            Could not load your schedule: {state.message}
          </p>
        </Panel>
      );
    if (!data || !view) return null;
    const deadline = (() => {
      const t = Date.parse(data.deadline);
      return Number.isNaN(t) ? data.deadline : DEADLINE_FMT.format(t);
    })();
    const answered = data.my_response;
    const closedText =
      data.closed_reason === "past_deadline"
        ? `The deadline (${deadline}) has passed. If you didn't reply, this schedule counts as confirmed. Ask your supervisor for changes.`
        : data.closed_reason === "published"
          ? "This week is published, so requests are closed. Ask your supervisor."
          : !data.open
            ? "This week has started, so requests are closed."
            : null;
    const peerAsks = data.requests_for_me.filter(
      (r) => r.status === "awaiting_peer",
    );

    return (
      <section className={CARD} data-confirm>
        <div className={CARD_HEADER}>
          <h2 className="text-[15px] font-semibold text-white">
            Your schedule · {md(data.week_start)} –{" "}
            {md(shiftYmd(data.week_start, 6))}
            {data.week_status === "draft" ? " (draft)" : ""}
          </h2>
          {data.open ? (
            <span className={cn("text-[12.5px]", MUTED)}>
              Drag your own shift to the day you want. Other people&apos;s
              shifts can&apos;t be moved.
            </span>
          ) : null}
        </div>

        {closedText ? (
          <p
            data-confirm-closed
            className="mx-4 mt-3 rounded-[8px] border border-sky-400/35 bg-sky-400/10 px-3 py-2 text-[13px] text-sky-100"
          >
            {closedText}
          </p>
        ) : null}

        {peerAsks.map((r) => (
          <div
            key={r.id}
            data-peer-ask
            className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-[8px] border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-[13px] text-amber-100"
          >
            <span>
              {r.from.name} asked to swap with you: you take {r.from.name}
              &apos;s <b>{slotText(r.my_slot, view)}</b>, {r.from.name} takes
              your <b>{slotText(r.their_slot, view)}</b>.
            </span>
            <PeerButtons requestId={r.id} busy={busy} onAnswer={answer} />
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2.5 px-4 pt-3">
          {data.open ? (
            <span
              data-confirm-deadline
              className="text-[12.5px] font-semibold text-white"
            >
              Please confirm by {deadline}
            </span>
          ) : null}
          <span data-confirm-status className="text-[12.5px] text-white/70">
            {drafts.length
              ? `${drafts.length} change${drafts.length === 1 ? "" : "s"}, not sent yet`
              : answered
                ? answered.answer === "accepted"
                  ? "You said it looks good."
                  : "Your changes were sent."
                : data.open
                  ? "Waiting for your answer"
                  : ""}
          </span>
          {sentAt && !drafts.length ? (
            <span
              role="status"
              data-confirm-sent
              className="text-[12.5px] font-semibold text-emerald-300"
            >
              ✓ Sent · {sentAt}
            </span>
          ) : null}
          <span className="flex-1" />
          {data.open ? (
            <>
              {!answered ? (
                <button
                  type="button"
                  data-confirm-accept
                  disabled={busy || drafts.length > 0}
                  onClick={() =>
                    void run(() =>
                      acceptMyConfirmation({ week: data.week_start, token }),
                    )
                  }
                  className={DARK_SECONDARY_BUTTON_CLASS}
                >
                  Looks good
                </button>
              ) : null}
              <button
                type="button"
                data-confirm-send
                disabled={busy || drafts.length === 0}
                onClick={send}
                className={DARK_PRIMARY_BUTTON_CLASS}
              >
                {busy ? "Sending…" : "Send my changes"}
              </button>
            </>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="px-4 pt-2 text-[13px] text-red-300">
            {error}
          </p>
        ) : null}

        <div className="overflow-x-auto p-3" data-confirm-grid>
          <div className={cn("grid min-w-[960px] gap-[2px]", COLS)}>
            <div className="pb-1.5 pl-2 text-[11px] font-bold tracking-[.06em] text-white/90 uppercase">
              Staff
            </div>
            {view.dates.map((d, i) => (
              <div
                key={d}
                className="pb-1.5 text-center text-[11px] font-bold tracking-[.06em] text-white/90 uppercase"
              >
                {DAY_LABELS[i]}
                <small className="block font-mono text-[10px] tracking-normal text-white/80">
                  {md(d)}
                </small>
              </div>
            ))}
            {view.rows.map((p) => (
              <Row
                key={p.employee_id}
                person={p}
                meId={me}
                data={data}
                view={view}
                armed={armed}
                picking={picking}
                editable={editable}
                canDrag={canDrag}
                onArm={(id) => setArmed((a) => (a === id ? null : id))}
                onDrop={dropOn}
                onPick={setPicking}
                onAdd={(date, shiftType) => {
                  setDrafts((cur) => [
                    ...cur,
                    { kind: "add", date, shiftType },
                  ]);
                  setPicking(null);
                }}
              />
            ))}
          </div>
        </div>

        {drafts.length || data.my_requests.length ? (
          <div
            className="grid gap-1 px-4 pb-3 text-[13px]"
            data-confirm-changes
          >
            <b className="text-white">Your changes</b>
            {drafts.map((d, i) => (
              <div key={`d${i}`} className="flex items-center gap-2" data-draft>
                <span>{draftText(d, view)}</span>
                <span className="text-amber-200">Not sent yet</span>
                <button
                  type="button"
                  aria-label="Remove this change"
                  onClick={() =>
                    setDrafts((cur) => cur.filter((_, j) => j !== i))
                  }
                  className="ml-auto cursor-pointer text-white/60 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
            ))}
            {data.my_requests.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2"
                data-sent-request={r.status}
              >
                <span>{requestText(r, view)}</span>
                <span className={statusClass(r)}>{statusText(r)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    );
  })();

  if (token)
    return (
      <main className="min-h-screen bg-[#06101c] p-4 text-white/90 sm:p-7">
        <div className="mx-auto max-w-[1180px]">{body}</div>
      </main>
    );
  return (
    <main className="text-white/90">
      <CenteredPage className="flex flex-col gap-5">
        <h1 className="text-[29px] font-bold tracking-[-.02em] text-white">
          Staff Schedule
        </h1>
        {body}
      </CenteredPage>
    </main>
  );
}

function PeerButtons({
  requestId,
  busy,
  onAnswer,
}: {
  requestId: number;
  busy: boolean;
  onAnswer: (id: number, a: "accept" | "decline") => void;
}) {
  return (
    <span className="inline-flex gap-1">
      <button
        type="button"
        data-peer-accept
        disabled={busy}
        onClick={() => onAnswer(requestId, "accept")}
        className={ACCEPT_BTN}
      >
        Accept
      </button>
      <button
        type="button"
        data-peer-decline
        disabled={busy}
        onClick={() => onAnswer(requestId, "decline")}
        className={DECLINE_BTN}
      >
        Decline
      </button>
    </span>
  );
}

function Row({
  person,
  meId,
  data,
  view,
  armed,
  picking,
  editable,
  canDrag,
  onArm,
  onDrop,
  onPick,
  onAdd,
}: {
  person: { employee_id: number; name: string };
  meId: number;
  data: MyConfirmation;
  view: View;
  armed: number | null;
  picking: string | null;
  editable: boolean;
  canDrag: (s: ConfirmSlot) => boolean;
  onArm: (id: number) => void;
  onDrop: (
    slotId: number,
    target: { slot?: ConfirmSlot; date?: string },
  ) => void;
  onPick: (date: string | null) => void;
  onAdd: (date: string, shiftType: string) => void;
}) {
  const emp = person.employee_id;
  const isMe = emp === meId;
  return (
    <>
      <div
        className={cn(
          "flex items-center gap-[7px] rounded-[6px] bg-[#0b1727] p-2 text-[16px] font-bold text-white",
          isMe && "shadow-[inset_0_0_0_1.5px_rgba(255,255,255,.55)]",
        )}
        data-row-name={person.name}
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: personDotColor(emp) }}
        />
        {person.name}
        {isMe ? (
          <small className="text-[10.5px] font-medium text-white/60">
            (you)
          </small>
        ) : null}
      </div>
      {view.dates.map((date) => {
        const slots = data.slots.filter(
          (s) => s.employee_id === emp && s.date === date,
        );
        const off = data.time_off.find(
          (t) => t.employee_id === emp && t.date === date,
        );
        const extra = view.extras.get(`${emp}|${date}`) ?? [];
        const openDay = isMe && !off && slots.length === 0 && extra.length === 0;
        const moveTarget = openDay && armed !== null;
        return (
          <div
            key={date}
            data-cell={`${person.name}|${date}`}
            className={cn(
              "group flex min-h-16 flex-col gap-[3px] rounded-[6px] bg-white/[.03] p-[3px]",
              moveTarget &&
                "cursor-pointer outline-2 outline-amber-300/80 outline-dashed",
            )}
            onDragOver={(e) => {
              if (openDay && editable) e.preventDefault();
            }}
            onDrop={(e) => {
              const id = Number(e.dataTransfer.getData("text/x-slot"));
              if (openDay && editable && id) onDrop(id, { date });
            }}
            onClick={() => {
              if (moveTarget && armed !== null) onDrop(armed, { date });
            }}
          >
            {off ? (
              <div className="flex flex-1 items-center justify-center rounded-[6px] border border-dashed border-white/20 text-[11px] text-white/60">
                {off.kind ? (TIME_OFF_LABEL[off.kind] ?? "Off") : "Off"}
              </div>
            ) : null}
            {slots.map((s) => (
              <SlotCard
                key={s.id}
                slot={s}
                view={view}
                editable={editable}
                draggable={canDrag(s)}
                armedId={armed}
                onArm={onArm}
                onDrop={(id) => onDrop(id, { slot: s })}
              />
            ))}
            {extra.map((c) => (
              <div
                key={c.key}
                data-req-card
                className={cn(
                  "flex flex-1 flex-col justify-center gap-px rounded-[6px] border px-2 py-1",
                  REQ_CARD,
                )}
              >
                <b className="text-[12.5px]">{view.typeLabel(c.shiftType)}</b>
                <span className="font-mono text-[10.5px]">
                  {formatRange(c.start, c.end)}
                </span>
                <small className="text-[10px] font-bold">{c.note}</small>
              </div>
            ))}
            {openDay && editable && armed === null ? (
              picking === date ? (
                <div className="flex flex-col gap-[3px]" data-add-picker>
                  {data.shift_types.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      data-add-shift={t.key}
                      onClick={() => onAdd(date, t.key)}
                      className={cn(
                        "cursor-pointer rounded-[5px] border px-1.5 py-0.5 text-left font-mono text-[10.5px]",
                        shiftCardClass(t.key),
                      )}
                    >
                      {t.label}
                      {t.default_start_time
                        ? ` · ${formatRange(t.default_start_time, t.default_end_time ?? null)}`
                        : ""}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onPick(null)}
                    className="cursor-pointer text-[11px] text-white/60"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  data-add-day={date}
                  onClick={() => onPick(date)}
                  className="flex-1 cursor-pointer rounded-[6px] border border-dashed border-white/30 text-[11.5px] font-semibold text-white/80 opacity-0 group-hover:opacity-100 focus:opacity-100"
                >
                  + Work this day
                </button>
              )
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function SlotCard({
  slot,
  view,
  editable,
  draggable,
  armedId,
  onArm,
  onDrop,
}: {
  slot: ConfirmSlot;
  view: View;
  editable: boolean;
  draggable: boolean;
  armedId: number | null;
  onArm: (id: number) => void;
  onDrop: (mySlotId: number) => void;
}) {
  const mark = view.marks.get(slot.id);
  const label = view.typeLabel(slot.shift_type);
  if (mark?.split)
    return (
      <div className="flex flex-1 flex-col gap-[3px]" data-split={slot.id}>
        <div className="grid flex-1 grid-cols-2 gap-[3px]">
          <div
            className={cn(
              "flex flex-col justify-center rounded-[6px] border px-1.5 py-1",
              REQ_CARD,
            )}
          >
            <small className="text-[10px] font-bold">{mark.split.left}</small>
            <b className="text-[12px]">{label}</b>
          </div>
          <div
            className={cn(
              "flex flex-col justify-center rounded-[6px] border px-1.5 py-1",
              shiftCardClass(slot.shift_type),
            )}
          >
            <small className="text-[10px] font-bold">{mark.split.right}</small>
            <b className="text-[12px]">{label}</b>
          </div>
        </div>
        {mark.split.actions ? (
          <div className="flex justify-center">{mark.split.actions}</div>
        ) : null}
      </div>
    );
  // 别人的班能当换班的目标：有人、没被别的请求占着
  const swapTarget =
    editable &&
    !slot.mine &&
    slot.employee_id !== null &&
    !view.busySlots.has(slot.id);
  return (
    <div
      data-slot={slot.id}
      data-mine={slot.mine ? "1" : undefined}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-slot", String(slot.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (swapTarget) e.preventDefault();
      }}
      onDrop={(e) => {
        e.stopPropagation();
        const id = Number(e.dataTransfer.getData("text/x-slot"));
        if (swapTarget && id) onDrop(id);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (draggable) onArm(slot.id);
        else if (swapTarget && armedId !== null) onDrop(armedId);
      }}
      className={cn(
        "relative flex flex-1 flex-col justify-center gap-px rounded-[6px] border px-2 py-1",
        shiftCardClass(slot.shift_type),
        mark?.ghost && "border-dashed opacity-40",
        draggable &&
          "cursor-grab shadow-[inset_0_0_0_1px_rgba(255,255,255,.45)]",
        armedId === slot.id && "ring-2 ring-white",
        swapTarget &&
          armedId !== null &&
          "cursor-pointer outline-2 outline-amber-300/80 outline-dashed",
      )}
    >
      {draggable ? (
        <span
          aria-hidden
          className="absolute top-0.5 right-1.5 text-[12px] text-white/70"
        >
          ⠿
        </span>
      ) : null}
      <b className="text-[12.5px]">{label}</b>
      <span className="font-mono text-[10.5px]">
        {formatRange(slot.start_time, slot.end_time)}
      </span>
      {mark?.ghost ? (
        <small className="text-[10px] font-bold">{mark.ghost}</small>
      ) : null}
    </div>
  );
}

function slotText(s: RequestSlot | null, view: View): string {
  if (!s) return "";
  return `${view.dayOf(s.date)} ${view.typeLabel(s.shift_type)} ${formatRange(s.start_time, s.end_time)}`;
}

function draftText(d: Draft, view: View): string {
  if (d.kind === "add")
    return `+ Work ${view.dayOf(d.date)} ${md(d.date)} · ${view.typeLabel(d.shiftType)} (extra shift)`;
  const mine = view.slotById.get(d.mySlotId);
  const mineText = mine
    ? `${view.dayOf(mine.date)} ${view.typeLabel(mine.shift_type)}`
    : "";
  if (d.kind === "move") return `→ Move ${mineText} to ${view.dayOf(d.date)}`;
  const theirs = view.slotById.get(d.theirSlotId);
  const peer = view.nameOf(theirs?.employee_id ?? null);
  const theirText = theirs
    ? `${view.dayOf(theirs.date)} ${view.typeLabel(theirs.shift_type)}`
    : "";
  return `⇄ ${mineText} ↔ ${peer}'s ${theirText} — ${peer} is asked first`;
}

function requestText(r: ConfirmRequest, view: View): string {
  const s = (x: RequestSlot | null) =>
    x ? `${view.dayOf(x.date)} ${view.typeLabel(x.shift_type)}` : "";
  if (r.kind === "add")
    return `+ Work ${r.date ? `${view.dayOf(r.date)} ${md(r.date)}` : ""} · ${r.shift_type ? view.typeLabel(r.shift_type) : ""} (extra shift)`;
  if (r.kind === "move")
    return `→ Move ${s(r.my_slot)} to ${r.date ? view.dayOf(r.date) : ""}`;
  return `⇄ ${s(r.my_slot)} ↔ ${r.peer?.name ?? ""}'s ${s(r.their_slot)}`;
}

function statusText(r: ConfirmRequest): string {
  const peer = r.peer?.name ?? "";
  switch (r.status) {
    case "awaiting_peer":
      return `Waiting for ${peer}`;
    case "pending":
      if (r.kind !== "swap") return "Waiting for approval";
      return r.peer_timed_out
        ? `${peer} didn't reply — waiting for approval`
        : `${peer} agreed — waiting for approval`;
    case "approved":
      return "Approved";
    case "declined":
      return "Not approved";
    case "peer_declined":
      return `${peer} declined`;
    case "closed":
      return "Closed when published";
  }
}

function statusClass(r: ConfirmRequest): string {
  if (r.status === "approved") return "font-semibold text-emerald-300";
  if (r.status === "declined" || r.status === "peer_declined")
    return "font-semibold text-red-300";
  if (r.status === "closed") return "text-white/50";
  return "text-amber-200";
}
