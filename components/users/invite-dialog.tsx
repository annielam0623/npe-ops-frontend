"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { ActionFailure } from "@/components/ui/action-result";
import { Modal } from "@/components/ui/modal";
import { copyText } from "@/lib/clipboard";

import { ModalCloseButton } from "./modal-close-button";

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
    <Modal
      titleId={titleId}
      onDismiss={generating ? undefined : onClose}
      panelClassName="relative max-w-[480px] !rounded-[14px] px-8 py-9 !shadow-[0_20px_60px_rgba(0,0,0,.2)]"
    >
      {/* 版式照旧页面 settings_users.html 的 #inviteModal：生成前只有大绿按钮（关闭靠 ✕），生成后是链接框 + 整行 Done。 */}
      <ModalCloseButton onClick={onClose} disabled={generating} />
      <h2 id={titleId} className="mb-1.5 text-[18px] font-bold text-[#1a1a2e]">
        {existingUrl ? "Invite Link" : "Invite Staff Member"}
      </h2>
      <p className="mb-6 text-[13px] text-[#6b7280]">
        A one-time registration link. It does not expire — delete the pending
        invite or deactivate the user to revoke access.
      </p>

      {url ? (
        <>
          <InviteLinkField url={url} />
          <button
            type="button"
            onClick={onClose}
            className="mt-4 w-full cursor-pointer rounded-[8px] border-0 bg-[#f3f4f6] p-2.5 text-[14px] font-semibold text-[#374151]"
          >
            Done
          </button>
        </>
      ) : (
        <button
          type="button"
          autoFocus
          onClick={handleGenerate}
          disabled={generating}
          className="w-full cursor-pointer rounded-[8px] border-0 bg-[linear-gradient(135deg,#1a6b3c,#27ae60)] p-3 text-[15px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {generating ? "Generating…" : "Generate Invite Link"}
        </button>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-[#c0392b]">
          {error}
        </p>
      ) : null}
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
    <div>
      <label
        htmlFor={inputId}
        className="mb-2 block text-[13px] font-semibold text-[#374151]"
      >
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
          className="min-w-0 flex-1 rounded-[8px] border border-[#d1d5db] bg-[#f9fafb] px-3 py-2.5 text-[13px] text-[#374151]"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="cursor-pointer rounded-[8px] border-0 bg-[#1a6b3c] px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap text-white"
        >
          {copyState === "copied" ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <p
        className={
          copyState === "failed"
            ? "mt-2.5 text-[12px] text-[#c0392b]"
            : "mt-2.5 text-[12px] text-[#9ca3af]"
        }
      >
        {copyState === "failed"
          ? "Couldn't copy automatically — select the link and copy it manually."
          : "The staff member will set their own username and password when they open the link."}
      </p>
    </div>
  );
}
