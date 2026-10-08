/** 旧页面卡头 / 团卡上的巴士图标（dispatch_assignments.html、_tour_manifests_panel.html 的 `ICON_BUS`）。 */
export function BusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="4.5" y="3" width="15" height="15" rx="2.5" />
      <path d="M4.5 11h15M8 18v2.5M16 18v2.5" />
      <circle cx="8.3" cy="14.5" r=".7" fill="currentColor" />
      <circle cx="15.7" cy="14.5" r=".7" fill="currentColor" />
    </svg>
  );
}
