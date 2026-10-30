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
 * 后端 G220（76de8f3）：每行带 errors / before，没通过检查的行 status "error"、提交时跳过，其余照存；
 * 提交出错时不保证一行没写（不是整份回滚），所以失败时不说「nothing was changed」（atomic=false）。
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
    case "error":
      return "error";
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
    // 后端给的单选是存的值（例如 full_time），这里换成标签；改前的值（before）也一样。
    const shown = (k: string, raw: string) => {
      const field = FIELD_BY_KEY[k];
      return field?.kind === "choice" ? (raw ? choiceText(field, raw) : "") : raw;
    };
    const values: Record<string, string> = {};
    for (const k of p.headers) values[k] = shown(k, row[k] ?? "");
    const before = row.before
      ? Object.fromEntries(
          Object.entries(row.before).map(([k, v]) => [k, shown(k, v ?? "")]),
        )
      : undefined;
    // 文件里重复的行：后端在 errors 里写「Repeated above — skipped.」（G220），万一没写再补一句。
    const errors = [...(row.errors ?? [])];
    if (row.status === "duplicate_in_file" && !errors.length) {
      errors.push({ field: null, message: "Repeated above — skipped." });
    }
    return {
      status: statusOf(row),
      values,
      before,
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
  // 文件里重复的（skipped）和没通过检查的（errors）预览里都是 Error 行，Save 后面那句「N rows with errors were not saved.」
  // 由通用块按预览写，这里不再重复。
  if (r.vanished) {
    parts.push(`${r.vanished} deleted by someone else and skipped`);
  }
  return `${parts.join(", ") || "nothing to change"}.`;
}
