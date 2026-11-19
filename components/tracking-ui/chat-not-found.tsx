import { cn } from "@/lib/utils";

/**
 * Tracking 三页 `?chat=单号` 找不到这单时的黄字（订单生命周期 Open chat →，Annie「全部同意推荐。动手」）。
 * 搜索框照旧预填了单号；Dismiss 收起。dark = 早班页（深色）。
 */
export function ChatNotFound({
  text,
  dark = false,
  onDismiss,
}: {
  text: string;
  dark?: boolean;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      data-chat-not-found
      className={cn(
        "mb-3.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2 text-[13px]",
        dark
          ? "border-[rgba(251,191,36,.40)] bg-[rgba(251,191,36,.12)] text-[#fbbf24]"
          : "border-[#f0c040] bg-[#fff8e1] text-[#856404]",
      )}
    >
      <span className="min-w-0 break-words">{text}</span>
      <button
        type="button"
        onClick={onDismiss}
        className={cn(
          "cursor-pointer rounded-[7px] border px-3 py-1 text-[12px]",
          dark
            ? "border-white/15 bg-[#1a2f4a] text-[#a0c0e0] hover:text-white"
            : "border-[#dee2e6] bg-paper text-[#1a1a1a] hover:bg-[#f8f9fa]",
        )}
      >
        Dismiss
      </button>
    </div>
  );
}
