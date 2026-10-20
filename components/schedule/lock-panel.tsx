"use client";

/**
 * 别人正在编辑这张周表时，动手改的那一下弹出来（Annie 2026-10-19「动手改才提示」，样子见 preview 第④块）：
 * 深色面板写谁在改，一个 Back；刚才那一下没有生效。打开周表本身不会弹。
 */
export function ScheduleLockedPanel({
  by,
  onBack,
}: {
  by: string | null;
  onBack: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={onBack}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-locked-title"
        data-schedule-locked
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[440px] flex-col gap-1.5 rounded-[14px] border border-amber-300/40 bg-[#1a1608] px-[18px] py-4 text-white shadow-xl"
      >
        <div
          id="schedule-locked-title"
          className="text-[15px] font-semibold text-amber-200"
        >
          🔒 {by ?? "Someone"} is editing this schedule.
        </div>
        <div className="text-[13px] text-white/80">Please try again later.</div>
        <div className="mt-2">
          <button
            type="button"
            autoFocus
            onClick={onBack}
            className="cursor-pointer rounded-[8px] border border-white/20 px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-white/10"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
