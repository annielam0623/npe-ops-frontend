import { cn } from "@/lib/utils";
import type { UserRole } from "@/types";

import { ROLE_STYLES } from "./config";

function RoleTag({ role }: { role: UserRole }) {
  return (
    <span
      className={cn(
        "rounded-xl px-2 py-0.5 font-semibold whitespace-nowrap",
        ROLE_STYLES[role].badgeClass,
      )}
    >
      {ROLE_STYLES[role].label}
    </span>
  );
}

/** 与旧页面底部的角色说明一致。 */
export function RoleLegend() {
  return (
    // 同旧页面：浅灰卡片（落在深色底上）。
    <section className="rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-[18px] py-3.5 text-xs leading-6 text-[#6b7280]">
      <p>
        <strong className="text-[#374151]">Role permissions:</strong>{" "}
        <RoleTag role="superadmin" /> Full access + can change user roles.{" "}
        <RoleTag role="admin" /> Full access including Settings &amp; User
        management. <RoleTag role="staff" /> Send notifications, view logs &amp;
        manifests, all ops inputs &amp; exports. Cannot access Settings or
        Users.
      </p>
      <p className="mt-2.5 border-t border-[#e5e7eb] pt-2.5">
        <strong className="text-[#92400e]">
          Field roles — no back office at all:
        </strong>{" "}
        <RoleTag role="driver" /> Sees only their own pickup list for today. No
        orders, guests, reports or settings. <RoleTag role="guide" />{" "}
        Placeholder page for now. Same: no back office.
      </p>
    </section>
  );
}
