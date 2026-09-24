import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { MtlvTicketStatus, PromotionConfirmation } from "@/types";

type BadgeTone = "green" | "yellow" | "blue" | "red";

const TONE_CLASSES: Record<BadgeTone, string> = {
  green: "bg-[#EAF3DE] text-[#3B6D11] ring-[#3B6D11]/20",
  yellow: "bg-[#FAEEDA] text-[#BA7517] ring-[#BA7517]/20",
  blue: "bg-[#E6F1FB] text-[#185FA5] ring-[#185FA5]/20",
  red: "bg-[#FCEBEB] text-[#A32D2D] ring-[#A32D2D]/20",
};

function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
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
  return <Badge tone="blue">Pending</Badge>;
}

const TICKET_STATUS_TONES: Partial<Record<string, BadgeTone>> = {
  sent: "green",
  cancel: "red",
  pending_send: "blue",
};

export function TicketStatusBadge({ value }: { value: MtlvTicketStatus }) {
  const tone = TICKET_STATUS_TONES[value];
  if (!tone) {
    return <span className="text-sm text-stone-400">{value || "—"}</span>;
  }
  return <Badge tone={tone}>{value}</Badge>;
}
