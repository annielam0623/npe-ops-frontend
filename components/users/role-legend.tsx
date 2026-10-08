import { cn } from "@/lib/utils";
import type { UserRole } from "@/types";

import { ROLE_STYLES } from "./config";

function RoleTag({ role }: { role: UserRole }) {
  return (
    <span
      className={cn(
        "rounded-[12px] px-2 py-0.5 font-semibold whitespace-nowrap",
        ROLE_STYLES[role].badgeClass,
      )}
    >
      {ROLE_STYLES[role].label}
    </span>
  );
}

/** 与旧页面 settings_users.html 底部的角色说明一致（文字、间距、配色）。 */
export function RoleLegend() {
  return (
    <section className="mt-5 rounded-[8px] border border-[#e5e7eb] bg-[#f9fafb] px-[18px] py-3.5 text-[12px] leading-[1.6] text-[#6b7280]">
      <p>
        <strong className="text-[#374151]">Role permissions:</strong>
        &nbsp; <RoleTag role="superadmin" /> — Full access + can change user
        roles. &nbsp;&nbsp; <RoleTag role="admin" /> — Full access including
        Settings &amp; User management. &nbsp;&nbsp; <RoleTag role="staff" /> —
        Send notifications, view logs &amp; manifests, all ops inputs &amp;
        exports. Cannot access Settings or Users.
      </p>
      <p className="mt-2.5 border-t border-[#e5e7eb] pt-2.5">
        <strong className="text-[#92400e]">
          Field roles — no back office at all:
        </strong>
        &nbsp; <RoleTag role="driver" /> — Sees only his own pickup list for
        today. No orders, guests, reports or settings. &nbsp;&nbsp;{" "}
        <RoleTag role="guide" /> — Placeholder page for now. Same: no back
        office.
      </p>
    </section>
  );
}
