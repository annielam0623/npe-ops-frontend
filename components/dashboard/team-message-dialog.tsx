"use client";

import { useId, useState } from "react";

import { DARK_PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  MESSAGE_MAX,
  personName,
  sendTeamMessage,
  type TeamPerson,
} from "@/lib/team-messages-api";

/**
 * 点 Today's team 里的名字发站内消息（preview 的「Message <name>」小框）：对方在自己 Dashboard 的 Notice 里看到，
 * 同时收到一封带全文的邮件；对方没登记 Email 时写黄字，照样能发（Annie「Q3 A」）。蓝色 Send = 提交。
 */
export function TeamMessageDialog({
  person,
  onClose,
  onUnauthorized,
}: {
  person: TeamPerson;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const titleId = useId();
  const [body, setBody] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "sent"; emailed: boolean }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const name = personName(person);
  const sending = state.kind === "sending";
  const text = body.trim();

  async function send() {
    if (!text || sending) return;
    setState({ kind: "sending" });
    try {
      const r = await sendTeamMessage(person.id, text);
      setState({ kind: "sent", emailed: r.emailed ?? person.has_email });
      setBody("");
    } catch (err) {
      if (isStatus(err, 401)) onUnauthorized();
      else setState({ kind: "error", message: describeError(err) });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !sending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-team-message-dialog
        className="w-full max-w-md rounded-xl border border-white/10 bg-[#0e1b2e] p-5 text-white shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
      >
        <h2 id={titleId} className="text-[15px] font-bold">
          Message {name}
        </h2>
        <p className="mt-1 text-[12.5px] text-white/55">
          {person.has_email
            ? `${name} sees it in their Notice and gets it by email.`
            : `${name} sees it in their Notice.`}
        </p>
        {!person.has_email ? (
          <p
            data-no-email
            className="mt-2 text-[12px] font-semibold text-[#fbbf24]"
          >
            No email on file — they&apos;ll only see it in their Notice.
          </p>
        ) : null}
        <label className="mt-3.5 block text-[12px] font-semibold text-white/70">
          Message
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value.slice(0, MESSAGE_MAX));
              if (state.kind !== "sending") setState({ kind: "idle" });
            }}
            rows={4}
            disabled={sending}
            placeholder={`Write to ${name}…`}
            className="mt-1 block w-full resize-none rounded-lg border border-white/15 bg-white/[.04] px-3 py-2 text-[13px] text-white outline-none focus:border-[#185FA5]"
          />
        </label>
        {state.kind === "sent" ? (
          <p
            role="status"
            className="mt-2 text-[12.5px] font-semibold text-[#4ade80]"
          >
            ✓ Sent{state.emailed ? " — also emailed" : ""}.
          </p>
        ) : state.kind === "error" ? (
          <p role="alert" className="mt-2 text-[12.5px] text-[#f87171]">
            Not sent — {state.message}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded-lg border border-white/15 px-3.5 py-1.5 text-[13px] font-semibold text-white/75 hover:border-white/30 disabled:opacity-60"
          >
            {state.kind === "sent" ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!text || sending}
            className={DARK_PRIMARY_BUTTON_CLASS}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
