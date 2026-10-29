"use client";

import { useId, useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import {
  DANGER_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { Modal } from "@/components/ui/modal";

/**
 * 彻底删除账号的小确认框（Annie 2026-10-28：「点击以后要求确认要删除此人吗，点yes就删除了」）。
 * 不用输用户名。删不掉（后端外键 RESTRICT：还有任务交接 / Dispatch 名单完成记录）时，框不关、
 * 原样显示后端的话，Yes 灰掉，左边多一个「Deactivate instead」（preview v2 Q10 推荐）。
 */
export function DeletePersonDialog({
  name,
  meta,
  canDeactivate,
  onDelete,
  onDeactivate,
  onClose,
}: {
  name: string;
  /** 名字下面一行小字，例如「@erin.w」。 */
  meta: string;
  /** 还是 Active 的账号才给「Deactivate instead」。 */
  canDeactivate: boolean;
  onDelete: () => Promise<ActionResult>;
  onDeactivate: () => Promise<ActionResult>;
  onClose: () => void;
}) {
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<ActionResult>) {
    if (busy) {
      return;
    }
    setBusy(true);
    const result = await action();
    // ok 时父组件会卸载本弹窗；redirecting 时保持进行中直到跳走。
    if (result.status === "error") {
      setError(result.message);
      setBusy(false);
    }
  }

  return (
    <Modal titleId={titleId} onDismiss={busy ? undefined : onClose} night>
      <div data-delete-person-confirm className="flex flex-col gap-4">
        <div>
          <h2
            id={titleId}
            className="text-lg font-semibold text-stone-900 night:text-white/90"
          >
            Delete this person?
          </h2>
          <p className="mt-0.5 text-[12.5px] break-words text-[#4b5563] night:text-white/55">
            {name} · {meta}
          </p>
        </div>
        <p className="text-sm text-[#1a1a1a] night:text-white/75">
          This can&apos;t be undone.
        </p>

        {error ? (
          <p
            role="alert"
            className="rounded-[8px] border border-[#fca5a5] px-3 py-2 text-[12.5px] break-words text-[#b91c1c] night:border-red-400/40 night:text-red-300"
          >
            <b>Could not delete.</b> {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {error && canDeactivate ? (
            <button
              type="button"
              onClick={() => void run(onDeactivate)}
              disabled={busy}
              className="mr-auto cursor-pointer rounded-[8px] border border-[#fed7aa] bg-[#fff4e5] px-3.5 py-2 text-[13px] font-semibold text-[#c2410c] disabled:cursor-not-allowed disabled:opacity-60 night:border-amber-400/30 night:bg-amber-400/10 night:text-amber-200"
            >
              Deactivate instead
            </button>
          ) : null}
          <button
            type="button"
            autoFocus
            onClick={onClose}
            disabled={busy}
            className={SECONDARY_BUTTON_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void run(onDelete)}
            disabled={busy || error !== null}
            className={DANGER_BUTTON_CLASS}
          >
            {busy ? "Working…" : "Yes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
