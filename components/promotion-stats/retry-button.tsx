export function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-[7px] border-[0.5px] border-black/15 bg-white px-3.5 py-1.5 text-[12px] text-[#444] hover:bg-[#f5f5f3]"
    >
      Retry
    </button>
  );
}
