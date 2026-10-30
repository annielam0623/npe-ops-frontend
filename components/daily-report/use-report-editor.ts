"use client";

import { byTick } from "@/lib/by-tick";
import { usePermissions } from "@/lib/staff-permissions";
import type { CurrentUser, OperationReport } from "@/types";

/**
 * Daily Operation Report 谁能改状态 / 跟进人（Annie 2026-10-26 G187；10-30 原话「如果是edit的话，应该是都可以，
 * 如果去改另外一个人发布的，那staff就不可以，只能本人改」）。照后端 operation_reports.py `_can_edit`：
 * - Super Admin：所有报告；
 * - 有 report.edit：所有报告；
 * - 其余：只有自己登记的那条，而且要有 report.view；
 * - partner 一律不能（Annie 10-27「合作方只能看」）。
 * 员工权限总开关关着时照旧规矩（byTick 的 legacy）：supervisor / admin 能改所有的；本人改自己的是 10-26 定的规则，开关关着也照样生效。
 */
export interface ReportEditor {
  partner: boolean;
  /** 能改任何一条。 */
  all: boolean;
  /** 能改自己登记的。 */
  own: boolean;
  username: string;
}

export function useReportEditor(me: CurrentUser | null): ReportEditor {
  const perms = usePermissions();
  const superAdmin = !!me?.is_superadmin;
  return {
    partner: perms.partnerView,
    all: byTick(perms, "report.edit", {
      legacy: !!(me?.is_supervisor || me?.is_admin),
      superAdmin,
    }),
    own: byTick(perms, "report.view", { legacy: true, superAdmin }),
    username: me?.username ?? "",
  };
}

/**
 * 这一条我能不能改。按登记人的 username 对：列表接口的 created_by 只给 {username, display_name}、不给 id
 * （后端按 created_by_user_id 判，username 在系统里唯一，效果一样；后端存的时候还会再判一次）。
 * 已写进 PROGRESS「需要后端」：created_by 加 id，以后改成按 id 对。
 */
export function canEditReport(r: OperationReport, who: ReportEditor): boolean {
  if (who.partner) return false;
  if (who.all) return true;
  return who.own && !!who.username && r.created_by.username === who.username;
}
