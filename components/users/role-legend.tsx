import { cn } from "@/lib/utils";
import type { UserRole } from "@/types";

import { ROLE_STYLES } from "./config";

function RoleTag({ role }: { role: UserRole }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-semibold whitespace-nowrap",
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
    <section className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3.5 text-xs leading-6 text-stone-500">
      <p>
        <strong className="text-stone-700">Role permissions:</strong>{" "}
        <RoleTag role="superadmin" /> Full access + can change user roles.{" "}
        <RoleTag role="admin" /> Full access including Settings &amp; User
        management. <RoleTag role="staff" /> Send notifications, view logs &amp;
        manifests, all ops inputs &amp; exports. Cannot access Settings or
        Users.
      </p>
      <p className="mt-2 border-t border-stone-200 pt-2">
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
