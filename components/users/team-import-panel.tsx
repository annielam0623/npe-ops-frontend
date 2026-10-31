"use client";

import { StandardImport } from "@/components/ui/bulk-import";
import { csvBlob } from "@/lib/csv";
import type { TeamMember } from "@/types";

/** 模板的栏，顺序同 preview ③-1：Username 用来对上人，Name 只用来认人（不改）。 */
export const TEAM_IMPORT_FIELDS = [
  { key: "username", label: "Username" },
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Mobile" },
] as const;

const LABEL: Record<string, string> = Object.fromEntries(
  TEAM_IMPORT_FIELDS.map((f) => [f.key, f.label]),
);

/** 模板 = 现有的人（不含待接受的邀请、部门邮箱）；有 HR 档案的司机 / 导游 Mobile 填 HR 的号。 */
export function buildTeamImportTemplate(members: readonly TeamMember[]): {
  headers: string[];
  rows: string[][];
} {
  const rows = members
    .filter((m) => m.kind === "user" && !m.pending_invite)
    .map((m) =>
      m.kind === "user"
        ? [
            m.username,
            m.display_name ?? "",
            m.email ?? "",
            m.hr_phone ?? m.phone ?? "",
          ]
        : [],
    )
    .sort((a, b) => a[0].localeCompare(b[0]));
  return { headers: TEAM_IMPORT_FIELDS.map((f) => f.label), rows };
}

function templateFilename(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `team_contacts_template_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.csv`;
}

/**
 * Team 的 ⬆ Import（全站通用导入，Annie 2026-10-29「批量导游同意推荐。动手」，preview ③-1）：
 * 按 Username 对上人，只改 Email、Mobile；不建账号（Q6），对不上的算 Error；空格不改（Q3）；
 * 有错的行不存，其余一个事务写进去（Q2）；只给 Super Admin（Q4，同 Edit）。
 * 接口 `/api/team/contacts/import/preview|commit`（⚠️ 后端还没有，先用 mock；形状同 types/bulk-import.ts）。
 */
export function TeamImportPanel({
  members,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  members: readonly TeamMember[];
  onClose: () => void;
  onSaved: () => void;
  onUnauthorized: () => void;
}) {
  return (
    <StandardImport
      title="Import contact details"
      help={
        <>
          <b>Username</b> finds the person; only Email and Mobile are changed
          (Name is there to help you find people). Usernames not on the list are
          errors: add new people with Add person. A blank cell never clears what
          is stored — to empty a box, use Edit. Drivers and guides with an HR
          file keep the phone from Human Resource.
        </>
      }
      endpoint="/api/team/contacts/import"
      // 不建账号（Q6）：后端 status 只有 update / unchanged / error，数字里不写 New（同 preview ③-1）。
      canCreate={false}
      labelOf={(k) => LABEL[k] ?? k}
      template={() => {
        const t = buildTeamImportTemplate(members);
        return {
          blob: csvBlob(t.headers, t.rows),
          filename: templateFilename(),
        };
      }}
      onClose={onClose}
      onSaved={onSaved}
      onUnauthorized={onUnauthorized}
    />
  );
}
