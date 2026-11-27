"use client";

import { useEffect, useId, useState } from "react";

import { SelectMenu } from "@/components/ui/select-menu";
import { describeError, isStatus } from "@/lib/api-errors";
import { addNoShowContact } from "@/lib/daily-report-api";
import { laToday, laWallClockToIso } from "@/lib/la-date";
import { fetchOrder } from "@/lib/orders-api";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import { searchVoiceCalls } from "@/lib/voice-calls-api";
import type {
  ContactMethod,
  NoShowContact,
  NoShowDecision,
  NoShowRescheduled,
  OperationReport,
  OperationReportPatch,
  OrderDetail,
  ReportAssignee,
} from "@/types";

import {
  CONTACT_METHODS,
  CONTACT_METHOD_LABEL,
  DECISION_LABEL,
  DECISION_OPTIONS,
  clientDetails,
  formatWhen,
  formatYmd,
} from "./config";

const FIELD =
  "w-full rounded-md border border-white/25 bg-[#0f2238] px-2 py-1 text-[12.5px] text-[#f8fafc] [color-scheme:dark] placeholder:text-white/35 disabled:opacity-60";
const LABEL = "text-[11.5px] font-bold text-white/62";
const BOX =
  "flex flex-col gap-2 rounded-[10px] border border-white/12 bg-black/15 px-3 py-2.5";
const HEAD = "text-[11px] font-bold tracking-[.06em] text-white/45 uppercase";
const SAVE =
  "rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-3.5 py-[5px] text-[12.5px] font-bold text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60";

function segClass(on: boolean) {
  return cn(
    "rounded-lg border px-1 py-1.5 text-[12.5px] font-semibold",
    on
      ? "border-[#f8fafc] bg-[#f8fafc] text-[#06101c]"
      : "border-white/25 text-[#f8fafc] hover:bg-white/[.08]",
  );
}

/** 「due Nov 28」那半句（Follow-up 文字后面）。 */
export function followUpDueText(report: OperationReport): string {
  const due = report.details.follow_up_due;
  return due ? ` · due ${formatYmd(due).replace(/, \d{4}$/, "")}` : "";
}

/**
 * G361 No show 登记展开后的四块（preview UAhRhQfyGQYt2D8hWjHqZz ②③，Annie 2026-11-27「T1 A，T2 A，T3 A」「动手」）：
 * 改期上车的绿条、Contact log（只加，蓝色 Save contact 直接存，同 Updates）、Guest decision（先选后存：决定 + 跟进人 + 期限 /
 * 新单号一个 Save，T2 A）、Evidence（只读，读订单页现成接口，T3 A；Phone AI 那行只 Super Admin）。
 */
export function NoShowPanel({
  report,
  contacts,
  rescheduled,
  readyToClose,
  canEdit,
  canAddContact,
  isSuperAdmin,
  assignees,
  onContactAdded,
  onPatch,
  onUnauthorized,
}: {
  report: OperationReport;
  contacts: NoShowContact[] | null;
  rescheduled: NoShowRescheduled | null;
  readyToClose: boolean;
  canEdit: boolean;
  canAddContact: boolean;
  isSuperAdmin: boolean;
  assignees: ReportAssignee[];
  onContactAdded: (c: NoShowContact) => void;
  onPatch: (id: number, patch: OperationReportPatch) => Promise<string | null>;
  onUnauthorized: () => void;
}) {
  return (
    <div data-no-show-panel className="flex flex-col gap-2.5">
      {readyToClose ? (
        <div
          data-ready-to-close
          className="rounded-[10px] border border-[#4ade80]/50 bg-[#4ade80]/[.08] px-3 py-2 text-[13px] font-semibold text-[#4ade80]"
        >
          ✓ Guest boarded the rescheduled tour - ready to close
        </div>
      ) : null}
      <ContactLog
        report={report}
        contacts={contacts}
        canAdd={canAddContact}
        onAdded={onContactAdded}
        onUnauthorized={onUnauthorized}
      />
      <GuestDecision
        report={report}
        rescheduled={rescheduled}
        canEdit={canEdit}
        assignees={assignees}
        onPatch={onPatch}
      />
      <Evidence
        orderNumber={report.order_number ?? ""}
        isSuperAdmin={isSuperAdmin}
        onUnauthorized={onUnauthorized}
      />
    </div>
  );
}

/** 现在的洛杉矶钟点「HH:MM」（联系时间默认现在）。 */
function laNowTime(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function ContactLog({
  report,
  contacts,
  canAdd,
  onAdded,
  onUnauthorized,
}: {
  report: OperationReport;
  contacts: NoShowContact[] | null;
  canAdd: boolean;
  onAdded: (c: NoShowContact) => void;
  onUnauthorized: () => void;
}) {
  const id = useId();
  const [method, setMethod] = useState<ContactMethod>("phone");
  const [date, setDate] = useState(laToday);
  const [time, setTime] = useState(laNowTime);
  const [reached, setReached] = useState<boolean | null>(null);
  const [said, setSaid] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const dirty = reached !== null || said.trim() !== "";
  useLeaveGuard(
    dirty && state !== "saving",
    "A contact you typed is not saved yet. Leave without saving it?",
  );

  async function save() {
    if (state === "saving") return;
    const missing: string[] = [];
    if (!date || !time) missing.push("When");
    if (reached === null) missing.push("Reached?");
    if (reached && !said.trim()) missing.push("What the guest said");
    if (missing.length) {
      setError(`Please fill in: ${missing.join(", ")}.`);
      setState("error");
      return;
    }
    setState("saving");
    setError("");
    try {
      const added = await addNoShowContact(report.id, {
        method,
        contacted_at: laWallClockToIso(date, time),
        reached: !!reached,
        ...(reached ? { guest_said: said.trim() } : {}),
      });
      onAdded(added);
      setReached(null);
      setSaid("");
      setState("saved");
    } catch (err) {
      if (isStatus(err, 401)) {
        onUnauthorized();
        return;
      }
      setError(describeError(err));
      setState("error");
    }
  }

  return (
    <div
      data-contact-log
      className={cn(BOX, "border-dashed border-[#c4b5fd]/55")}
    >
      <div className={HEAD}>Contact log</div>
      {contacts === null ? (
        <p className="m-0">Loading…</p>
      ) : contacts.length ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {contacts.map((c) => (
            <li key={c.id} data-contact-id={c.id} className="text-[#f8fafc]">
              <span className="text-[11.5px] text-white/50">
                {formatWhen(c.contacted_at)} · {c.method_label} · by{" "}
                {c.created_by.display_name || c.created_by.username}
              </span>{" "}
              {c.reached ? (
                <span className="font-semibold text-[#4ade80]">Reached</span>
              ) : (
                <span className="font-semibold text-[#fbbf24]">
                  Not reached
                </span>
              )}
              {c.guest_said ? (
                <span className="break-words whitespace-pre-wrap">
                  {" "}
                  “{c.guest_said}”
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0">No contacts yet.</p>
      )}
      {canAdd && contacts !== null ? (
        <div className="flex flex-col gap-2 border-t border-white/10 pt-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_1fr]">
            <label className="flex min-w-0 flex-col gap-1">
              <span className={LABEL}>Method</span>
              <SelectMenu
                id={`${id}-m`}
                aria-label="Contact method"
                value={method}
                options={CONTACT_METHODS.map((m) => ({
                  value: String(m),
                  label: String(CONTACT_METHOD_LABEL[m]),
                }))}
                onChange={(next) => setMethod(next as ContactMethod)}
                className={FIELD}
              />
            </label>
            <div className="flex min-w-0 flex-col gap-1">
              <span className={LABEL}>When</span>
              <div className="flex gap-1.5">
                <input
                  type="date"
                  aria-label="Contact date"
                  max={laToday()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={FIELD}
                />
                <input
                  type="time"
                  aria-label="Contact time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={FIELD}
                />
              </div>
            </div>
            <div
              role="group"
              aria-label="Reached?"
              className="flex min-w-0 flex-col gap-1"
            >
              <span className={LABEL}>Reached?</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  aria-pressed={reached === true}
                  onClick={() => setReached(true)}
                  className={segClass(reached === true)}
                >
                  Yes
                </button>
                <button
                  type="button"
                  aria-pressed={reached === false}
                  onClick={() => setReached(false)}
                  className={segClass(reached === false)}
                >
                  No
                </button>
              </div>
            </div>
          </div>
          {reached ? (
            <label className="flex flex-col gap-1">
              <span className={LABEL}>
                What the guest said<span className="text-[#f87171]"> *</span>
              </span>
              <textarea
                aria-label="What the guest said"
                rows={2}
                maxLength={2000}
                value={said}
                onChange={(e) => setSaid(e.target.value)}
                className={cn(FIELD, "resize-y")}
              />
            </label>
          ) : null}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              data-contact-save
              onClick={() => void save()}
              disabled={state === "saving"}
              className={SAVE}
            >
              {state === "saving" ? "Saving…" : "Save contact"}
            </button>
            {state === "saved" ? (
              <span data-contact-saved className="text-xs text-[#4ade80]">
                Saved
              </span>
            ) : state === "error" ? (
              <span role="alert" className="text-xs text-[#f87171]">
                {error}
              </span>
            ) : null}
            <span className="text-[11px] text-white/40">
              Contacts can&rsquo;t be edited or deleted.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface DecisionDraft {
  decision: "" | NoShowDecision;
  followUpId: string;
  due: string;
  newOrder: string;
}

function draftOf(report: OperationReport): DecisionDraft {
  return {
    decision: report.details.decision ?? "",
    followUpId: report.follow_up?.id ? String(report.follow_up.id) : "",
    due: report.details.follow_up_due ?? "",
    newOrder: report.details.new_order_number ?? "",
  };
}

function GuestDecision({
  report,
  rescheduled,
  canEdit,
  assignees,
  onPatch,
}: {
  report: OperationReport;
  rescheduled: NoShowRescheduled | null;
  canEdit: boolean;
  assignees: ReportAssignee[];
  onPatch: (id: number, patch: OperationReportPatch) => Promise<string | null>;
}) {
  const id = useId();
  const stored = draftOf(report);
  const [draft, setDraft] = useState<DecisionDraft>(stored);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  // 别处改了这份登记（updated_at 变）⇒ 从存好的重来（自己刚存的也走这里）。
  const updatedAt = report.updated_at;
  useEffect(() => {
    setDraft(draftOf(report));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt]);

  const dirty =
    draft.decision !== stored.decision ||
    draft.followUpId !== stored.followUpId ||
    draft.due !== stored.due ||
    draft.newOrder.trim().toUpperCase() !== stored.newOrder;
  useLeaveGuard(
    dirty && canEdit,
    "The guest decision you changed is not saved yet. Leave without saving it?",
  );

  const needsFollowUp =
    draft.decision === "declined" || draft.decision === "no_reply";
  const needsOrder = draft.decision === "accepted";
  const followUpName = report.follow_up?.display_name;

  async function save() {
    if (state === "saving") return;
    const missing: string[] = [];
    if (needsOrder && !draft.newOrder.trim()) missing.push("New order #");
    if (needsFollowUp && !draft.followUpId) missing.push("Follow-up");
    if (needsFollowUp && !draft.due) missing.push("Follow up by");
    if (missing.length) {
      setError(`Please fill in: ${missing.join(", ")}.`);
      setState("error");
      return;
    }
    setState("saving");
    setError("");
    // details 要整份发 staff 那部分（后端整份替换）：别的格照旧，只换决定这几项；用不到的那项去掉。
    const base = clientDetails(report.details);
    delete base.decision;
    delete base.new_order_number;
    delete base.follow_up_due;
    const details = {
      ...base,
      ...(draft.decision ? { decision: draft.decision } : {}),
      ...(needsOrder
        ? { new_order_number: draft.newOrder.trim().toUpperCase() }
        : {}),
      ...(needsFollowUp ? { follow_up_due: draft.due } : {}),
    };
    const message = await onPatch(report.id, {
      details,
      follow_up_user_id: draft.followUpId ? Number(draft.followUpId) : null,
    });
    if (message) {
      setError(message);
      setState("error");
    } else {
      setState("saved");
    }
  }

  return (
    <div
      data-guest-decision
      className={cn(BOX, "border-dashed border-[#c4b5fd]/55")}
    >
      <div className={HEAD}>Guest decision</div>
      {canEdit ? (
        <>
          <div
            role="group"
            aria-label="Guest decision"
            className="grid grid-cols-1 gap-1.5 sm:grid-cols-3"
          >
            {DECISION_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                data-decision={d}
                aria-pressed={draft.decision === d}
                onClick={() => {
                  setDraft((cur) => ({ ...cur, decision: d }));
                  setState("idle");
                }}
                className={segClass(draft.decision === d)}
              >
                {DECISION_LABEL[d]}
              </button>
            ))}
          </div>
          {needsOrder ? (
            <label className="flex flex-col gap-1">
              <span className={LABEL}>
                New order #<span className="text-[#f87171]"> *</span>
              </span>
              <input
                type="text"
                aria-label="New order #"
                autoComplete="off"
                maxLength={50}
                placeholder="CHD…"
                value={draft.newOrder}
                onChange={(e) =>
                  setDraft((cur) => ({ ...cur, newOrder: e.target.value }))
                }
                className={cn(FIELD, "font-mono")}
              />
            </label>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1">
              <span className={LABEL}>
                Follow-up
                {needsFollowUp ? (
                  <span className="text-[#f87171]"> *</span>
                ) : null}
              </span>
              <SelectMenu
                id={`${id}-fu`}
                aria-label="Follow-up"
                value={draft.followUpId}
                options={[
                  { value: "", label: "Not assigned" },
                  ...(report.follow_up?.id &&
                  !assignees.some((u) => u.id === report.follow_up?.id)
                    ? [
                        {
                          value: String(report.follow_up.id),
                          label: String(report.follow_up.display_name),
                        },
                      ]
                    : []),
                  ...assignees.map((u) => ({
                    value: String(u.id),
                    label: String(u.display_name),
                  })),
                ]}
                onChange={(next) =>
                  setDraft((cur) => ({ ...cur, followUpId: next }))
                }
                className={FIELD}
              />
            </label>
            {needsFollowUp ? (
              <label className="flex min-w-0 flex-col gap-1">
                <span className={LABEL}>
                  Follow up by<span className="text-[#f87171]"> *</span>
                </span>
                <input
                  type="date"
                  aria-label="Follow up by"
                  min={laToday()}
                  value={draft.due}
                  onChange={(e) =>
                    setDraft((cur) => ({ ...cur, due: e.target.value }))
                  }
                  className={FIELD}
                />
              </label>
            ) : null}
          </div>
          {needsFollowUp ? (
            <p className="m-0 text-[11.5px] text-white/42">
              The follow-up person gets a task in My tasks on that day.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              data-decision-save
              onClick={() => void save()}
              disabled={state === "saving" || !dirty}
              className={SAVE}
            >
              {state === "saving" ? "Saving…" : "Save"}
            </button>
            {state === "saved" && !dirty ? (
              <span data-decision-saved className="text-xs text-[#4ade80]">
                Saved
              </span>
            ) : state === "error" ? (
              <span role="alert" className="text-xs text-[#f87171]">
                {error}
              </span>
            ) : dirty ? (
              <span className="text-xs text-white/60">Not saved yet</span>
            ) : null}
          </div>
        </>
      ) : (
        <p className="m-0 text-[#f8fafc]">
          {stored.decision
            ? DECISION_LABEL[stored.decision]
            : "No decision yet"}
          {stored.newOrder ? ` · new order ${stored.newOrder}` : ""}
          {followUpName ? ` · Follow-up: ${followUpName}` : ""}
          {followUpDueText(report)}
        </p>
      )}
      {rescheduled ? (
        <p data-rescheduled className="m-0 text-[11.5px] text-white/60">
          New order {rescheduled.order_number}
          {rescheduled.found
            ? `${rescheduled.tour_date ? ` · ${formatYmd(rescheduled.tour_date)}` : ""}${
                rescheduled.status ? ` · ${rescheduled.status}` : ""
              }${rescheduled.live ? "" : " · cancelled"}${
                rescheduled.boarded ? " · Boarded" : " · not boarded yet"
              }`
            : " · not found in the Order List"}
        </p>
      ) : null}
    </div>
  );
}

const DELIVERED = new Set(["delivered", "sent", "opened", "clicked"]);

/** 发送那几行的结果字：送达绿、失败红、其余照原文。 */
function sendLine(
  label: string,
  c: NonNullable<OrderDetail["confirmations"]>[number] | undefined,
) {
  if (!c || c.send_state !== "sent" || !c.sent_at)
    return { label, text: "Not sent", tone: "muted" as const };
  const statuses = [c.email_status, c.sms_status].filter(
    (s): s is string => !!s,
  );
  const failed = statuses.find((s) => /fail|bounce|invalid|undeliver/i.test(s));
  const ok = statuses.some((s) => DELIVERED.has(s.toLowerCase()));
  return {
    label,
    text: `${formatWhen(c.sent_at)}${statuses.length ? ` · ${statuses.join(" / ")}` : ""}`,
    tone: failed
      ? ("bad" as const)
      : ok
        ? ("good" as const)
        : ("muted" as const),
  };
}

const TONE = {
  good: "text-[#4ade80]",
  bad: "text-[#f87171]",
  muted: "text-[#f8fafc]",
};

/**
 * T3 A：紧凑的 Evidence，每样一行，最后「Open order page →」。数据全读订单页现成的 GET /api/operations/orders/{order}；
 * Phone AI 只 Super Admin（/voice/call-log/search，按客人电话；后端本来就只给 Super Admin）。读不到不挡登记，写一句。
 */
function Evidence({
  orderNumber,
  isSuperAdmin,
  onUnauthorized,
}: {
  orderNumber: string;
  isSuperAdmin: boolean;
  onUnauthorized: () => void;
}) {
  const [order, setOrder] = useState<OrderDetail | null | "missing">(null);
  const [error, setError] = useState("");
  const [calls, setCalls] = useState<number | null>(null);

  useEffect(() => {
    if (!orderNumber) {
      setOrder("missing");
      return;
    }
    const controller = new AbortController();
    fetchOrder(orderNumber, controller.signal)
      .then((o) => setOrder(o))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(err, 401)) onUnauthorized();
        else if (isStatus(err, 404)) setOrder("missing");
        else setError(describeError(err));
      });
    return () => controller.abort();
  }, [orderNumber, onUnauthorized]);

  const phone = order && order !== "missing" ? order.guest.phone : "";
  useEffect(() => {
    setCalls(null);
    if (!isSuperAdmin || !phone || phone.replace(/\D/g, "").length < 3) return;
    const controller = new AbortController();
    searchVoiceCalls({ phone, endpoint: "" }, controller.signal)
      .then((log) => setCalls(log.count))
      .catch(() => undefined);
    return () => controller.abort();
  }, [isSuperAdmin, phone]);

  let body;
  if (error) body = <p className="m-0">Could not load the order: {error}</p>;
  else if (order === null) body = <p className="m-0">Loading…</p>;
  else if (order === "missing")
    body = <p className="m-0">This order was not found.</p>;
  else {
    const conf = order.confirmations ?? [];
    const pick = (m: RegExp) => conf.find((c) => m.test(c.module));
    const reply = conf.find((c) => c.submitted_at);
    const lines = [
      sendLine("Confirmation sent", pick(/tour_confirmation|last_minute/)),
      sendLine("Pickup reminder", pick(/morning|pickup/)),
    ];
    const changes = order.rezdy_changes ?? [];
    const marks = (order.day_of_tour ?? []).flatMap((d) =>
      [
        d.bus_mark?.value === "no_show"
          ? { d, col: "Bus", m: d.bus_mark }
          : null,
        d.relay_mark?.value === "no_show"
          ? { d, col: "Relay", m: d.relay_mark }
          : null,
      ].filter((x) => x !== null),
    );
    body = (
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[#f8fafc]">
        {lines.map((l) => (
          <li key={l.label}>
            {l.label} · <span className={TONE[l.tone]}>{l.text}</span>
          </li>
        ))}
        <li>
          Guest reply ·{" "}
          {reply
            ? `${formatWhen(reply.submitted_at)} · ${reply.status}`
            : "none"}
        </li>
        <li>
          Rezdy changes · {changes.length}
          {changes[0]
            ? ` (latest ${formatWhen(changes[0].at)}: ${changes[0].changes
                .map((c) => c.field)
                .join(", ")})`
            : ""}
        </li>
        <li>
          Day of tour ·{" "}
          {marks.length
            ? marks
                .map(
                  (x) =>
                    `${formatYmd(x.d.tour_date)} ${x.col}: No show${
                      x.m.by ? ` by ${x.m.by}` : ""
                    }${x.m.at ? ` · ${formatWhen(x.m.at)}` : ""}`,
                )
                .join("; ")
            : "no No show mark"}
        </li>
        <li>★ Notes · {(order.staff_notes ?? []).length}</li>
        {isSuperAdmin ? (
          <li data-evidence-voice className="text-white/60">
            Phone AI calls · {calls ?? "…"}{" "}
            <span className="text-[11px] text-white/40">
              (Super Admin only)
            </span>
          </li>
        ) : null}
      </ul>
    );
  }

  return (
    <div data-evidence className={BOX}>
      <div className={HEAD}>Evidence (from the order page)</div>
      {body}
      {orderNumber && order !== "missing" ? (
        <a
          href={`/orders/${encodeURIComponent(orderNumber)}`}
          className="self-start text-[12.5px] text-[#38bdf8] hover:underline"
        >
          Open order page →
        </a>
      ) : null}
    </div>
  );
}
