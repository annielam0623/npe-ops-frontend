export function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-[7px] border-[0.5px] border-black/15 bg-white px-3.5 py-1.5 text-[12px] text-[#444] hover:bg-[#f5f5f3] night:border-white/10 night:bg-white/[.04] night:text-white/75 night:hover:bg-white/[.03]"
    >
      Retry
    </button>
  );
}
