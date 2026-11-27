"use client";

import { cn } from "@/lib/utils";
import type {
  MorningTrackingRow,
  TrackingMark,
  TrackingMarkCol,
  TrackingMarkValue,
} from "@/types";

import { formatMarkTime, isStaffMark, markHover, markLabel } from "./config";

/** 一格的保存结果：Saving… / Saved（绿）/ 红字照后端原话。 */
export type MarkSaveStatus =
  | { kind: "saving" }
  | {
      kind: "saved";
      /** G361：后端建 / 挂 / 关了哪份 No show 登记（没跑就没有）。 */
      report?: import("@/lib/morning-tracking-api").TrackingNoShowReport;
    }
  | { kind: "error"; message: string };

/**
 * Tracking 表 Bus 列的 No show（No show 第 3 版，Annie 2026-11-19「no show那个同意推荐，动手」，N1 A / N2 A）。
 * 改的东西先暂存在页面上（staged），按每格旁边的 Save 才存；有没存的离开页面要拦（页面那边管）。
 */
export interface MarkEditing {
  canEdit: boolean;
  /** `${row.id}:${col}` → 要存的值；null = 回到导游原来标的（原来的 Reset）。没有这个键 = 没改。 */
  staged: ReadonlyMap<string, TrackingMarkValue | null>;
  status: ReadonlyMap<string, MarkSaveStatus>;
  /** value = undefined ⇒ 撤掉暂存（又点回了原来的样子）。 */
  onStage: (
    row: MorningTrackingRow,
    col: TrackingMarkCol,
    value: TrackingMarkValue | null | undefined,
  ) => void;
  onSave: (row: MorningTrackingRow, col: TrackingMarkCol) => void;
}

export function markKey(rowId: number, col: TrackingMarkCol): string {
  return `${rowId}:${col}`;
}

/** 这一行的 No show 在哪一格（⚠️ Take action / ✓ 谁 放在那一格底下）：导游的 Bus 为准，其次 Relay。 */
export function noShowCol(row: MorningTrackingRow): TrackingMarkCol | null {
  if (row.bus_mark?.value === "no_show") return "bus";
  if (row.relay_mark?.value === "no_show") return "relay";
  return null;
}

/** 红字 No show：照这页 SMS / Email「✗ Failed」（tracking-table.tsx TONE_CLASS.bad），#e74c3c、11px 半粗、没有底色。 */
const RED_TEXT = "text-[11px] font-semibold whitespace-nowrap text-[#e74c3c]";
/** 淡灰 No show：同原来「Not marked」的淡灰虚线字。 */
const FAINT_TEXT = "text-[#5a7a9a] underline decoration-dotted";

/**
 * 取消一个已存的 No show 要存什么（N1 ③ A）：staff 自己标的 ⇒ null（回到导游原来的标记）；
 * 导游标的 No show（或 staff 标之前导游也是 No show）⇒ 存成 staff 标的 Boarded。
 */
function cancelValue(
  mark: TrackingMark,
  original: TrackingMark | null | undefined,
): TrackingMarkValue | null {
  if (!isStaffMark(mark)) return "boarded";
  return original?.value === "no_show" ? "boarded" : null;
}

export function MarkCell({
  row,
  col,
  edit,
  isNew,
  canTake,
  toggling,
  onToggleAction,
}: {
  row: MorningTrackingRow;
  col: TrackingMarkCol;
  edit: MarkEditing | undefined;
  isNew: boolean;
  canTake: boolean;
  toggling: boolean;
  onToggleAction: (row: MorningTrackingRow, want: "on" | "off") => void;
}) {
  // TI 上车 / 不在任何 relay round：后端标了才算（不靠 null 猜）。
  if (col === "relay" && row.relay_applicable === false) {
    return (
      <span
        data-mark-na
        title="This guest is not on a relay. They board the bus at Treasure Island."
        className="text-[#5a7a9a]"
      >
        —
      </span>
    );
  }

  const mark: TrackingMark | null | undefined =
    col === "relay" ? row.relay_mark : row.bus_mark;
  const original: TrackingMark | null | undefined =
    col === "relay" ? row.relay_original : row.bus_original;
  const key = markKey(row.id, col);
  const staged = edit?.staged.get(key);
  const dirty = edit?.staged.has(key) ?? false;
  const status = edit?.status.get(key);
  // N1 ① A：staff 只在 Bus 列标 No show；Relay 列只看司机标的。
  const canEdit = !!edit?.canEdit && col === "bus";
  const staff = isStaffMark(mark);
  const hover = markHover(mark, original, col);
  const empty = col === "relay" ? "—" : "Not marked";
  const nsHere = noShowCol(row) === col;
  const ns = mark?.value === "no_show";
  const at = formatMarkTime(mark?.at);
  const label = `No show for ${row.order_number}`;

  const newTag =
    isNew && nsHere ? (
      <span className="ml-1 rounded-[4px] bg-[#ef4444] px-1 text-[9.5px] font-extrabold text-white">
        NEW
      </span>
    ) : null;

  /** 导游 / 司机标的（或 staff 标的 Boarded）：胶囊照旧（N2 A）。 */
  const pill = mark ? (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[10px] px-2.5 py-[3px] text-[11px] font-semibold whitespace-nowrap",
        ns
          ? "bg-[rgba(239,68,68,.18)] text-[#fca5a5]"
          : "bg-[rgba(46,204,113,.15)] text-[#2ecc71]",
      )}
    >
      {ns ? "✗" : "✓"} {markLabel(mark)}
      {at ? ` ${at}` : ""}
      {newTag}
    </span>
  ) : null;

  /** 淡灰「No show」键：点了暂存 / 撤掉暂存。 */
  const faintButton = (onClick: () => void) => (
    <button
      type="button"
      data-ns-button="off"
      aria-label={label}
      title="Click to mark No show"
      onClick={onClick}
      className={cn("cursor-pointer p-0 text-[11px]", FAINT_TEXT)}
    >
      No show
    </button>
  );
  /** 红字「✗ No show」键（存好的带时间）。 */
  const redButton = (text: string, onClick: () => void, title?: string) => (
    <button
      type="button"
      data-ns-button="on"
      aria-label={label}
      title={title}
      onClick={onClick}
      className={cn("cursor-pointer p-0", RED_TEXT)}
    >
      {text}
      {newTag}
    </button>
  );

  let body;
  if (canEdit && dirty) {
    // 还没存：点了 No show ⇒ 红字；点了取消 ⇒ 淡灰。再点一下 = 撤掉暂存。
    const unstage = () => edit?.onStage(row, col, undefined);
    body =
      staged === "no_show" ? (
        <>
          {/* 导游标的 Boarded 照旧显示在前面（N1 ② A）。 */}
          {mark && !ns ? (
            <span data-mark-pill={col} title={hover}>
              {pill}
            </span>
          ) : null}
          {redButton("✗ No show", unstage)}
        </>
      ) : (
        faintButton(unstage)
      );
  } else if (canEdit && mark && ns) {
    // 已存的 No show：staff 标的红字、导游标的红胶囊（N2 A）；点了 ⇒ 变淡灰 + Save（取消）。
    const cancel = () => edit?.onStage(row, col, cancelValue(mark, original));
    body = staff ? (
      redButton(`✗ No show${at ? ` ${at}` : ""}`, cancel, hover)
    ) : (
      <button
        type="button"
        data-mark-pill={col}
        data-ns-button="on"
        aria-label={label}
        title={hover}
        onClick={cancel}
        className="cursor-pointer p-0"
      >
        {pill}
      </button>
    );
  } else if (canEdit) {
    // 没标 / 导游标了 Boarded（或别的状态）：淡灰「No show」，Boarded 照旧在前面（N1 ② A）。
    body = (
      <>
        {pill ? (
          <span data-mark-pill={col} title={hover}>
            {pill}
          </span>
        ) : null}
        {faintButton(() => edit?.onStage(row, col, "no_show"))}
      </>
    );
  } else if (mark && ns && staff) {
    // 只看：staff 标的 No show 照样是红字。
    body = (
      <span data-mark-pill={col} title={hover} className={RED_TEXT}>
        ✗ No show{at ? ` ${at}` : ""}
        {newTag}
      </span>
    );
  } else if (mark) {
    body = (
      <span data-mark-pill={col} title={hover}>
        {pill}
      </span>
    );
  } else {
    body = (
      <span data-mark-pill={col} className="text-[#5a7a9a]">
        {empty}
      </span>
    );
  }

  const who =
    mark && !staff ? [mark.vehicle, mark.by].filter(Boolean).join(" ") : "";

  return (
    <div
      data-mark-cell={col}
      data-mark-value={mark?.value ?? ""}
      className="flex flex-col items-start gap-1"
    >
      <span className="flex flex-wrap items-center gap-1.5">
        {body}
        {canEdit && dirty ? (
          <button
            type="button"
            data-mark-save={col}
            disabled={status?.kind === "saving"}
            onClick={() => edit?.onSave(row, col)}
            className="cursor-pointer rounded-[6px] border border-[#3b82f6] bg-[#3b82f6] px-2 py-px text-[11px] font-bold text-white disabled:opacity-60"
          >
            {status?.kind === "saving" ? "Saving…" : "Save"}
          </button>
        ) : null}
      </span>
      {canEdit && dirty ? (
        <span data-mark-unsaved className="text-[10.5px] text-white/65">
          Not saved yet
        </span>
      ) : mark && staff ? (
        <span data-mark-edited className="text-[10.5px] text-[#fbbf24]">
          ✎ Edited by {mark.by || "staff"}
          {at ? ` ${at}` : ""}
        </span>
      ) : who ? (
        <span className="text-[11px] text-[#7a9bbe]">{who}</span>
      ) : null}
      {status?.kind === "saved" && !dirty ? (
        <span
          data-mark-saved
          className="text-[11px] font-semibold text-[#2ecc71]"
        >
          Saved
        </span>
      ) : null}
      {status?.kind === "saved" && !dirty && status.report ? (
        <NoShowReportLine report={status.report} />
      ) : null}
      {status?.kind === "error" ? (
        <span
          data-mark-error
          className="max-w-[240px] text-[11px] whitespace-normal text-[#f87171]"
        >
          Not saved: {status.message}
        </span>
      ) : null}
      {nsHere && canTake ? (
        row.ns_unhandled ? (
          <button
            type="button"
            data-ns-take-action
            disabled={toggling}
            onClick={() => onToggleAction(row, "on")}
            className="cursor-pointer p-0 text-[11px] text-[#c47a12] disabled:opacity-50"
          >
            ⚠️ Take action
          </button>
        ) : row.action_taken_by ? (
          <span data-ns-handled className="text-[11px] text-[#2ecc71]">
            ✓ {row.action_taken_by}
          </span>
        ) : null
      ) : null}
    </div>
  );
}

/**
 * G361 / G372：存好后那份 No show 登记的一行（存：「No show report #N →」；撤回：关了还是留着，N2）。
 * 备注 / 登记那部分没成（note_error / report_error）红字照原话写，标记本身已存。
 */
function NoShowReportLine({
  report,
}: {
  report: import("@/lib/morning-tracking-api").TrackingNoShowReport;
}) {
  const link = report.report_id ? (
    <a
      href={`/daily-report?id=${report.report_id}`}
      data-ns-report-link={report.report_id}
      className="text-[11px] text-[#38bdf8] hover:underline"
    >
      No show report #{report.report_id} →
    </a>
  ) : null;
  const errors = [
    "note_error" in report && report.note_error
      ? `Note not saved: ${report.note_error}`
      : "",
    report.report_error
      ? `No show report not saved: ${report.report_error}`
      : "",
  ].filter(Boolean);
  return (
    <span
      data-ns-report
      className="flex max-w-[260px] flex-col gap-0.5 whitespace-normal"
    >
      {"closed" in report ? (
        <span className="text-[11px] text-[#2ecc71]">
          {report.closed
            ? `No show report #${report.report_id} closed.`
            : `No show report #${report.report_id} stays open: someone is already working on it.`}
        </span>
      ) : (
        link
      )}
      {errors.map((e) => (
        <span
          key={e}
          data-ns-report-error
          className="text-[11px] text-[#f87171]"
        >
          {e}
        </span>
      ))}
    </span>
  );
}
