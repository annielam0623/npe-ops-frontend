"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface ModalProps {
  titleId: string;
  /** 点灰色背景或按 Esc 时调用；进行中（保存 / 删除）时传 undefined 禁止关闭。 */
  onDismiss?: () => void;
  /** 默认是小确认框（max-w-md、带内边距）；对话框这类大弹窗自己给宽度和布局。 */
  panelClassName?: string;
  children: ReactNode;
}

export function Modal({
  titleId,
  onDismiss,
  panelClassName,
  children,
}: ModalProps) {
  // 只有在背景上按下并松开才算「点背景」，避免在输入框里拖选文字时松手落到背景上误关弹窗。
  const pressedOnBackdropRef = useRef(false);

  useEffect(() => {
    if (!onDismiss) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onDismiss?.();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => {
        pressedOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (
          pressedOnBackdropRef.current &&
          event.target === event.currentTarget
        ) {
          onDismiss?.();
        }
        pressedOnBackdropRef.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "w-full rounded-xl bg-white shadow-[0_8px_40px_rgba(0,0,0,0.2)]",
          panelClassName ?? "max-w-md p-6",
        )}
      >
        {children}
      </div>
    </div>
  );
}
