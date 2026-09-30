"use client";

import { useEffect, useState } from "react";

import { describeError } from "@/lib/api-errors";
import { fetchTicketsMessagePreview } from "@/lib/tickets-send-api";
import { cn } from "@/lib/utils";
import type { TicketsMessagePreview } from "@/types";

type Tab = "sms" | "email" | "guest_page";

const TABS: readonly { value: Tab; label: string }[] = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "guest_page", label: "Guest Page" },
];

type PreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; preview: TicketsMessagePreview };

/**
 * 客人会收到什么：选好团型和日期就自动刷新，不依赖上传 Excel。
 * 邮件和确认页放进 sandbox="" 的 iframe（不跑脚本、不带 cookie）。
 */
export function MessagePreviewPanel({
  tourType,
  serviceDate,
}: {
  tourType: string;
  serviceDate: string;
}) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("sms");
  const [state, setState] = useState<PreviewState>({ kind: "idle" });

  useEffect(() => {
    if (!tourType || !serviceDate) {
      setState({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchTicketsMessagePreview(tourType, serviceDate, controller.signal)
      .then((preview) => {
        if (!controller.signal.aborted) setState({ kind: "ready", preview });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [tourType, serviceDate]);

  return (
    <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between bg-[#FAEEDA] px-4 py-3 text-left text-sm font-semibold text-[#8a5410]"
      >
        <span>Message Preview — what the guest will receive</span>
        <span className="text-xs">{open ? "▲ Hide" : "▼ Show"}</span>
      </button>
      {open ? (
        <div className="p-4">
          {state.kind === "idle" ? (
            <p className="text-sm text-stone-400">
              Select a tour type and service date above to preview the message
              content.
            </p>
          ) : (
            <>
              <div
                role="tablist"
                className="mb-3 flex border-b border-stone-200"
              >
                {TABS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.value}
                    onClick={() => setTab(t.value)}
                    className={cn(
                      "-mb-px border-b-2 px-4 py-2 text-sm",
                      tab === t.value
                        ? "border-[#BA7517] font-semibold text-[#8a5410]"
                        : "border-transparent text-stone-500 hover:text-stone-800",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {state.kind === "loading" ? (
                <p className="text-sm text-stone-400">Loading preview...</p>
              ) : state.kind === "error" ? (
                <p role="alert" className="text-sm text-[#A32D2D]">
                  Preview failed: {state.message}
                </p>
              ) : tab === "sms" ? (
                <pre className="rounded-md border border-stone-200 bg-stone-50 px-4 py-3 font-sans text-sm whitespace-pre-wrap text-stone-800">
                  {state.preview.sms}
                </pre>
              ) : (
                <iframe
                  key={tab}
                  title={
                    tab === "email" ? "Email preview" : "Guest page preview"
                  }
                  sandbox=""
                  srcDoc={
                    tab === "email"
                      ? state.preview.email
                      : state.preview.guest_page
                  }
                  className="h-[50vh] w-full rounded-md border border-stone-200"
                />
              )}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
