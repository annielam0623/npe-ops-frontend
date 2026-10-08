"use client";

import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * 三个 tracking 页的弹窗外壳：遮罩 + 面板，面板的底色 / 圆角 / 宽度全由调用方给
 * （三个旧页面的弹窗各有各的样子：早班深色、门票 / Tour 白底，群发弹窗又各不相同）。
 * 行为同 components/ui/modal.tsx：Esc / 点遮罩关闭，进行中传 onDismiss=undefined 禁止关闭。
 */
export function ModalShell({
  titleId,
  onDismiss,
  overlayClassName = "bg-black/45",
  panelClassName,
  children,
}: {
  titleId: string;
  onDismiss?: () => void;
  overlayClassName?: string;
  panelClassName: string;
  children: ReactNode;
}) {
  // 只有在遮罩上按下并松开才算「点遮罩」，在输入框里拖选文字时松手落到遮罩上不关。
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
      className={cn(
        "fixed inset-0 z-[1000] flex items-center justify-center p-4",
        overlayClassName,
      )}
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
        className={panelClassName}
      >
        {children}
      </div>
    </div>
  );
}
