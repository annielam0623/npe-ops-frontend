import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { MtlvTicketStatus, PromotionConfirmation } from "@/types";

type BadgeTone = "green" | "yellow" | "purple" | "blue" | "red";

const TONE_CLASSES: Record<BadgeTone, string> = {
  green: "bg-[#EAF3DE] text-[#3B6D11]",
  yellow: "bg-[#FAEEDA] text-[#BA7517]",
  purple: "bg-[#E6E3F7] text-[#4C3DA8]",
  blue: "bg-[#E6F1FB] text-[#185FA5]",
  red: "bg-[#FCEBEB] text-[#A32D2D]",
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
    return <span className="text-[#aaa]">{value || "—"}</span>;
  }
  return <Badge tone={status.tone}>{status.label}</Badge>;
}
