"use client";

import { useId, useState, type ReactNode } from "react";

import type { ActionResult } from "./action-result";
import {
  DANGER_BUTTON_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "./buttons";
import { Modal } from "./modal";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** 进行中按钮上的文字，例如 "Deleting…"。 */
  busyLabel: string;
  /** 不可逆 / 收权限的操作用红色按钮。 */
  danger?: boolean;
  /** 里面有逐单名单表格时用：弹窗放宽、太高就在框里滚动。 */
  wide?: boolean;
  onConfirm: () => Promise<ActionResult>;
  onClose: () => void;
}

/** 代替 window.confirm：出错时留在弹窗里显示原因，可重试。 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  danger = false,
  wide = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    if (busy) {
      return;
    }
    setError(null);
    setBusy(true);
    const result = await onConfirm();
    // ok 时父组件会卸载本弹窗；redirecting 时保持进行中直到跳走。
    if (result.status === "error") {
      setError(result.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      titleId={titleId}
      onDismiss={busy ? undefined : onClose}
      night
      panelClassName={
        wide ? "max-h-[90vh] max-w-3xl overflow-y-auto p-6" : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <h2
          id={titleId}
          className="text-lg font-semibold text-stone-900 night:text-white/90"
        >
          {title}
        </h2>
        <div className="flex flex-col gap-3 text-sm break-words text-[#1a1a1a] night:text-white/75">
          {children}
        </div>

        {error ? (
          <p role="alert" className="text-sm text-[#A32D2D] night:text-red-300">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
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
            onClick={handleConfirm}
            disabled={busy}
            className={danger ? DANGER_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
