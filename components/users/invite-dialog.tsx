"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { ActionFailure } from "@/components/ui/action-result";
import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";
import { copyText } from "@/lib/clipboard";

/** 生成邀请的结果：成功时带上注册链接。 */
export type InviteOutcome = { status: "ok"; url: string } | ActionFailure;

interface InviteDialogProps {
  /** 已有的邀请链接（待注册行复制失败时用来手动复制）；不传则先显示「生成」按钮。 */
  existingUrl?: string;
  onGenerate: () => Promise<InviteOutcome>;
  onClose: () => void;
}

export function InviteDialog({
  existingUrl,
  onGenerate,
  onClose,
}: InviteDialogProps) {
  const titleId = useId();
  const [url, setUrl] = useState<string | null>(existingUrl ?? null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (generating) {
      return;
    }
    setError(null);
    setGenerating(true);
    const result = await onGenerate();
    if (result.status === "ok") {
      setUrl(result.url);
      setGenerating(false);
    } else if (result.status === "error") {
      setError(result.message);
      setGenerating(false);
    }
  }

  return (
    <Modal titleId={titleId} onDismiss={generating ? undefined : onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-lg font-semibold text-stone-900">
            {existingUrl ? "Invite Link" : "Invite Staff Member"}
          </h2>
          <p className="text-sm text-stone-500">
            A one-time registration link. It does not expire — delete the
            pending invite or deactivate the user to revoke access.
          </p>
        </div>

        {url ? (
          <InviteLinkField url={url} />
        ) : (
          <button
            type="button"
            autoFocus
            onClick={handleGenerate}
            disabled={generating}
            className={PRIMARY_BUTTON_CLASS}
          >
            {generating ? "Generating…" : "Generate Invite Link"}
          </button>
        )}

        {error ? (
          <p role="alert" className="text-sm text-[#A32D2D]">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={generating}
            className={SECONDARY_BUTTON_CLASS}
          >
            {url ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function InviteLinkField({ url }: { url: string }) {
  const inputId = useId();
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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-stone-700">
        Share this link with the new staff member:
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-stone-300 bg-stone-50 px-3 py-2 font-mono text-xs text-stone-700 focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleCopy}
          className={PRIMARY_BUTTON_CLASS}
        >
          {copyState === "copied" ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <p
        className={
          copyState === "failed"
            ? "text-xs text-[#A32D2D]"
            : "text-xs text-stone-400"
        }
      >
        {copyState === "failed"
          ? "Couldn't copy automatically — select the link and copy it manually."
          : "They will set their own username and password when they open the link."}
      </p>
    </div>
  );
}
