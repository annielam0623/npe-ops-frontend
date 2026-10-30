"use client";

import {
  BulkImport,
  type BulkImportPreview,
  type BulkImportRow,
  type BulkImportStatus,
} from "@/components/ui/bulk-import";
import { describeHrWriteError } from "@/lib/permissions";
import {
  commitHRImport,
  downloadHRExport,
  previewHRImport,
} from "@/lib/hr-api";
import type { HRImportPreview, HRImportResult, HRImportRow } from "@/types";

import { choiceText, FIELD_BY_KEY, fieldLabel } from "./fields";

interface ImportPanelProps {
  onClose: () => void;
  /** 存好了 / 下了模板（导出会记日志）：父组件重拉列表和日志。 */
  onImported: () => void;
  onUnauthorized: () => void;
}

/**
 * HR 的 Import，用全站通用的 `BulkImport`（Annie 2026-10-29 动手，Q7：去掉「Also update people already on the list」勾）：
 * 一律 overwrite=true —— 预览里 New / Update 分开写着，看过再按 Save；空格照旧不清空（后端规则）。
 * 模板就是 Export to Excel（带现有的人，列名同 HR 表），按 Legal Name 对上，没对上的新建。
 * ⚠️ 后端还没给每行出错原因、commit 还不是一个事务（已写进「需要后端」）：有了 `errors` 自动显示，
 * 现在失败时不说「nothing was changed」。
 */
export function ImportPanel({
  onClose,
  onImported,
  onUnauthorized,
}: ImportPanelProps) {
  return (
    <BulkImport
      title="Import drivers & guides"
      help={
        <>
          <b>Legal Name</b> finds the person; names not on the list are added as
          new people. A blank cell never clears what is stored — to empty a
          field, use <b>Edit list</b> or open that person.
        </>
      }
      template={async () => {
        const done = await downloadHRExport();
        onImported();
        return done;
      }}
      preview={async (file, signal) =>
        toPreview(await previewHRImport(file, true, signal))
      }
      commit={async (file) => resultText(await commitHRImport(file, true))}
      atomic={false}
      describe={describeHrWriteError}
      onClose={onClose}
      onSaved={onImported}
      onUnauthorized={onUnauthorized}
    />
  );
}

function statusOf(row: HRImportRow): BulkImportStatus {
  if (row.errors?.length) return "error";
  switch (row.status) {
    case "new":
      return "new";
    case "update":
      return "update";
    case "duplicate_in_file":
      return "error";
    default:
      // overwrite=true 时后端不回 exists；万一回了也是「不写」。
      return "unchanged";
  }
}

function toPreview(p: HRImportPreview): BulkImportPreview {
  const rows = p.rows.map((row): BulkImportRow => {
    const values: Record<string, string> = {};
    for (const k of p.headers) {
      const field = FIELD_BY_KEY[k];
      const raw = row[k] ?? "";
      // 后端给的单选是存的值（例如 full_time），这里换成标签。
      values[k] =
        field?.kind === "choice" ? (raw ? choiceText(field, raw) : "") : raw;
    }
    const errors = [...(row.errors ?? [])];
    if (row.status === "duplicate_in_file") {
      errors.push({ field: null, message: "Repeated above — skipped." });
    }
    return {
      status: statusOf(row),
      values,
      before: row.before,
      changed: row.changed,
      blanked: row.blanked,
      errors,
    };
  });
  return {
    columns: p.headers.map((k) => ({ key: k, label: fieldLabel(k) })),
    rows,
  };
}

function resultText(r: HRImportResult): string {
  const parts: string[] = [];
  if (r.imported) parts.push(`${r.imported} new`);
  if (r.updated) parts.push(`${r.updated} updated`);
  if (r.unchanged) parts.push(`${r.unchanged} already matched`);
  if (r.skipped) {
    parts.push(
      `${r.skipped} skipped${r.skipped_names.length ? ` (${r.skipped_names.join(", ")})` : ""}`,
    );
  }
  if (r.vanished) {
    parts.push(`${r.vanished} deleted by someone else and skipped`);
  }
  return `${parts.join(", ") || "nothing to change"}.`;
}
