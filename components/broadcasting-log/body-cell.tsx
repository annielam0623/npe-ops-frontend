"use client";

import { useEffect, useState } from "react";

import { GROUP_TAG, MODULE_TAG } from "./config";

const MESSAGE_PREVIEW = 60;

export type BodyCellEntry = {
  product_label: string | null;
  tour_date: string | null;
  module: string;
  group_filter: string;
  template_name: string | null;
  message_body: string;
  recipient_count?: number;
  sent_by: string;
};

/**
 * Message 格：模板名 + 前 60 字，点击弹出完整内容（Annie 2026-10-22「对，点击要看到全文」「动手」）。
 * 超过 60 字尾部有绿色 View all（用 CSS 伪元素画，不进文本）；短于 60 字也能点开。
 * 总表和单订单历史表共用。
 */
export function BodyCell({
  entry,
  showTemplate,
}: {
  entry: BodyCellEntry;
  showTemplate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const body = entry.message_body || "";
  const long = body.length > MESSAGE_PREVIEW;
  const templateName = entry.template_name || "Custom message";
  return (
    <>
      {showTemplate && (
        <div className="text-[#1a1a1a] night:text-white/55">{templateName}</div>
      )}
      {body ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="View full message"
          data-body-open
          className={`block max-w-full cursor-pointer text-left underline decoration-dotted decoration-[#9ca3af] underline-offset-[3px] hover:bg-black/5 night:hover:bg-white/10 ${
            long
              ? "after:ml-1 after:font-semibold after:whitespace-nowrap after:text-[#2F7851] after:no-underline after:content-['View_all'] night:after:text-emerald-300"
              : ""
          }`}
        >
          {long ? `${body.slice(0, MESSAGE_PREVIEW)}…` : body}
        </button>
      ) : (
        "—"
      )}
      {open && (
        <BodyDialog
          entry={entry}
          title={templateName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function BodyDialog({
  entry,
  title,
  onClose,
}: {
  entry: BodyCellEntry;
  title: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const meta = [
    entry.product_label,
    entry.tour_date,
    MODULE_TAG[entry.module]?.label ?? entry.module,
    GROUP_TAG[entry.group_filter]?.label ?? entry.group_filter,
    entry.recipient_count != null ? `${entry.recipient_count} recipients` : null,
    entry.sent_by ? `sent by ${entry.sent_by}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#06101c]/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="blog-body-title"
        data-body-dialog
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-[560px] flex-col rounded-[10px] bg-white text-[13px] font-normal text-[#1a1a1a] shadow-2xl"
      >
        <header className="border-b border-[#e5e7eb] px-4 pt-3.5 pb-2">
          <h2 id="blog-body-title" className="text-[15px] font-semibold">
            {title}
          </h2>
          <div className="mt-0.5 text-[12px] text-[#6b7280]">{meta}</div>
        </header>
        <div
          data-body-full
          className="overflow-y-auto px-4 py-3.5 whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          {entry.message_body}
        </div>
        <footer className="flex justify-end border-t border-[#e5e7eb] px-4 py-2.5">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="cursor-pointer rounded-md bg-[#e5e7eb] px-3.5 py-1.5 text-[13px] font-semibold text-[#1a1a1a] hover:bg-[#d1d5db]"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
