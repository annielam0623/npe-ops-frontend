import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { MtlvTicketStatus, PromotionConfirmation } from "@/types";

type BadgeTone = "green" | "yellow" | "purple" | "blue" | "red";

const TONE_CLASSES: Record<BadgeTone, string> = {
  green:
    "bg-[#EAF3DE] night:bg-emerald-400/10 text-[#3B6D11] night:text-emerald-300",
  yellow:
    "bg-[#FAEEDA] night:bg-amber-400/10 text-[#BA7517] night:text-amber-200",
  purple:
    "bg-[#E6E3F7] night:bg-violet-400/15 text-[#4C3DA8] night:text-violet-300",
  blue: "bg-[#E6F1FB] night:bg-sky-400/[.08] text-[#185FA5] night:text-sky-300",
  red: "bg-[#FCEBEB] night:bg-red-500/10 text-[#A32D2D] night:text-red-300",
};

function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-block rounded-[10px] px-2 py-0.5 text-[11px] whitespace-nowrap",
        TONE_CLASSES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function ConfirmationBadge({
  value,
}: {
  value: PromotionConfirmation | null;
}) {
  if (value === "yes") {
    return <Badge tone="green">YES</Badge>;
  }
  if (value === "modify_req") {
    return <Badge tone="yellow">Modify</Badge>;
  }
  // 后端 2026-10-10 `7c03bd3`：改期已处理完，客人其实回过，不能落进 Pending（同旧页面 badge-modified）。
  if (value === "modified") {
    return <Badge tone="purple">Modified</Badge>;
  }
  return <Badge tone="blue">Pending</Badge>;
}

/** 同旧页面 tsBadge：sent → Sent、cancel → Cancel、pending_send → Pending。 */
const TICKET_STATUS: Partial<
  Record<string, { tone: BadgeTone; label: string }>
> = {
  sent: { tone: "green", label: "Sent" },
  cancel: { tone: "red", label: "Cancel" },
  pending_send: { tone: "blue", label: "Pending" },
};

export function TicketStatusBadge({ value }: { value: MtlvTicketStatus }) {
  const status = TICKET_STATUS[value];
  if (!status) {
    return (
      <span className="text-[#aaa] night:text-white/35">{value || "—"}</span>
    );
  }
  return <Badge tone={status.tone}>{status.label}</Badge>;
}
