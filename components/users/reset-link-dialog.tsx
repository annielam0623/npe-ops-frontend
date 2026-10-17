"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { ActionFailure } from "@/components/ui/action-result";
import { Modal } from "@/components/ui/modal";
import {
  LEGACY_CANCEL_BUTTON_CLASS,
  LEGACY_SAVE_BUTTON_CLASS,
} from "@/components/teams/legacy-styles";
import { copyText } from "@/lib/clipboard";
import type { AdminUser } from "@/types";

import { displayNameOf } from "./config";
import { ModalCloseButton } from "./modal-close-button";

/** 生成重置链接的结果：成功时带上链接。 */
export type ResetOutcome = { status: "ok"; url: string } | ActionFailure;

interface ResetLinkDialogProps {
  user: AdminUser;
  onCreate: () => Promise<ResetOutcome>;
  onClose: () => void;
}

/** 先确认，再显示链接。链接只显示这一次，关掉就没有了，要重新 Create link（旧链接作废）。 */
export function ResetLinkDialog({
  user,
  onCreate,
  onClose,
}: ResetLinkDialogProps) {
  const titleId = useId();
  const [url, setUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (creating) {
      return;
    }
    setError(null);
    setCreating(true);
    const result = await onCreate();
    if (result.status === "ok") {
      setUrl(result.url);
      setCreating(false);
    } else if (result.status === "error") {
      setError(result.message);
      setCreating(false);
    }
  }

  const name = displayNameOf(user);

  return (
    <Modal
      titleId={titleId}
      onDismiss={creating ? undefined : onClose}
      panelClassName="relative max-w-[460px] !rounded-[14px] px-7 py-7 !shadow-[0_20px_60px_rgba(0,0,0,.2)]"
      night
    >
      <ModalCloseButton onClick={onClose} disabled={creating} />
      {url ? (
        <>
          <h2
            id={titleId}
            className="m-0 mb-3 text-[17px] font-bold text-[#1a1a2e] night:text-white/90"
          >
            Reset link for {name}
          </h2>
          <ResetLinkField url={url} />
          <div className="mt-3 rounded-[8px] bg-[#fdf1dd] px-3 py-2 text-[12.5px] text-[#8a5a00] night:bg-amber-400/10 night:text-amber-200">
            Copy it now. This link is shown only once and works once, for 24
            hours.
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className={LEGACY_CANCEL_BUTTON_CLASS}
            >
              Close
            </button>
          </div>
        </>
      ) : (
        <>
          <h2
            id={titleId}
            className="m-0 mb-1.5 text-[17px] font-bold text-[#1a1a2e] night:text-white/90"
          >
            Reset password for {name}?
          </h2>
          <p className="m-0 mb-4 text-[13px] text-[#1a1a1a] night:text-white/55">
            This creates a new reset link. You send it to them yourself. Any
            earlier link stops working.
          </p>
          {error ? (
            <p
              role="alert"
              className="mb-3 text-[13px] text-[#c0392b] night:text-red-300"
            >
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              className={LEGACY_CANCEL_BUTTON_CLASS}
            >
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              onClick={handleCreate}
              disabled={creating}
              className={LEGACY_SAVE_BUTTON_CLASS}
            >
              {creating ? "Creating…" : "Create link"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function ResetLinkField({ url }: { url: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  // 链接出现时自动全选，复制不了时用户可以直接 Ctrl+C。
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (copyState !== "copied") {
      return;
    }
    const timer = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function handleCopy() {
    inputRef.current?.select();
    setCopyState((await copyText(url)) ? "copied" : "failed");
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          readOnly
          aria-label="Reset link"
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-[8px] border border-[#d1d5db] bg-[#f9fafb] px-3 py-2.5 font-mono text-[12px] text-[#1a1a1a] night:border-white/10 night:bg-white/[.03] night:text-white/75"
        />
        <button
          type="button"
          onClick={handleCopy}
          className={`${LEGACY_SAVE_BUTTON_CLASS} whitespace-nowrap !px-4 !py-2.5 !text-[13px]`}
        >
          {copyState === "copied" ? "✓ Copied" : "Copy link"}
        </button>
      </div>
      {copyState === "failed" ? (
        <p className="mt-2 text-[12px] text-[#c0392b] night:text-red-300">
          Couldn&apos;t copy automatically — the link is selected, press Ctrl+C.
        </p>
      ) : null}
    </div>
  );
}
