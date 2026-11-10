/**
 * 置顶 114 Q7 A：编辑卡组标题、页头 Save / Print / Excel / ⚙ 前的小线条图标（自己画的，不加图标库）。
 * 照 preview https://claude.ai/artifact/TopyompWt81k2rZL8uqoES 第 3 版的 SVG；颜色跟文字（currentColor）。
 */
const PATHS = {
  apply: (
    <path
      d="M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"
      strokeLinejoin="round"
    />
  ),
  size: (
    <path
      d="M3 19 8 5l5 14M4.8 14h6.4M15 19l3-8 3 8M15.9 16.5h4.2"
      strokeLinecap="round"
    />
  ),
  bold: (
    <path
      d="M7 4h6a4 4 0 0 1 0 8H7zm0 8h7a4 4 0 0 1 0 8H7z"
      strokeWidth={2.2}
      strokeLinejoin="round"
    />
  ),
  space: <path d="M4 6h16M4 12h11M4 18h16" strokeLinecap="round" />,
  reset: (
    <path
      d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  save: (
    <path d="M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7" strokeLinejoin="round" />
  ),
  print: (
    <path
      d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"
      strokeLinejoin="round"
    />
  ),
  download: (
    <path
      d="M12 3v12m-5-5 5 5 5-5M4 20h16"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"
        strokeLinecap="round"
      />
    </>
  ),
  check: (
    <path
      d="m5 12 5 5 9-10"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
} as const;

export type LineIconName = keyof typeof PATHS;

export function LineIcon({
  name,
  className = "h-[15px] w-[15px]",
}: {
  name: LineIconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      data-line-icon={name}
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}
