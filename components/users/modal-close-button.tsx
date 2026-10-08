/** 旧页面 settings_users.html 弹窗右上角的 ✕。 */
export function ModalCloseButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClick}
      disabled={disabled}
      className="absolute top-3.5 right-4 cursor-pointer border-0 bg-transparent text-[20px] leading-none text-[#9ca3af] disabled:cursor-not-allowed disabled:opacity-60"
    >
      ✕
    </button>
  );
}
