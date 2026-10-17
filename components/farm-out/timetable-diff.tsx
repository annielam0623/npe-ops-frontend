"use client";

import { BTN_ADD_SMALL_CLASS, BTN_EDIT_CLASS } from "@/components/pickup-locations/legacy-ui";
import { cn } from "@/lib/utils";
import type { FarmOutTimetableUploadDiff } from "@/types/farm-out";

/**
 * 上传 CSV / xlsx 解析出的 diff，先看再 Apply（Annie 已批过的两轮样稿）。`unknown_tours` 只是一串
 * 列名（类型里没有带数据），所以画成下面单独一行的红字提示，不在表格里占一列——表格里没有数据可画。
 * `new_spots[].departures` 的键类型是 `Record<string, string>`，键大概率是团名（CSV 表头是团名），
 * 这里按团名先对，对不上再退回按 manifest_id 的字符串对一次，两边都对不上就显示原始键名。
 */
export function TimetableDiffBanner({
  diff,
  tours,
  partnerName,
  applying,
  error,
  onApply,
  onDiscard,
}: {
  diff: FarmOutTimetableUploadDiff;
  tours: { manifest_id: number; tour_name: string }[];
  partnerName: string;
  applying: boolean;
  error: string | null;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const rows = new Map<
    string,
    { isNew: boolean; cells: Map<number, { before: string | null; after: string } | string> }
  >();

  for (const c of diff.changed) {
    const row = rows.get(c.spot_name) ?? { isNew: false, cells: new Map() };
    row.cells.set(c.manifest_id, { before: c.before, after: c.after });
    rows.set(c.spot_name, row);
  }
  for (const s of diff.new_spots) {
    const row = rows.get(s.name) ?? { isNew: false, cells: new Map() };
    row.isNew = true;
    for (const t of tours) {
      const value = s.departures[t.tour_name] ?? s.departures[String(t.manifest_id)];
      if (value !== undefined) row.cells.set(t.manifest_id, value);
    }
    rows.set(s.name, row);
  }

  const rowNames = [...rows.keys()];

  return (
    <div className="mb-5 overflow-hidden rounded-[12px] border border-[#fed7aa] bg-[#fff4e5] night:border-amber-400/30 night:bg-amber-400/10">
      <div className="px-4 pt-3.5 text-[12px] text-[#7c4a1e] night:text-amber-200">
        <p className="font-semibold">
          Uploaded &ldquo;{diff.file_name}&rdquo; — not saved yet
        </p>
        <p className="mt-1">
          {diff.changed.length} {diff.changed.length === 1 ? "time" : "times"}{" "}
          change · {diff.new_spots.length} new{" "}
          {diff.new_spots.length === 1 ? "hotel" : "hotels"}
          {diff.unknown_tours.length
            ? ` · ${diff.unknown_tours.length} tour name${diff.unknown_tours.length === 1 ? "" : "s"} not found`
            : ""}
          . Check, then Apply to replace {partnerName}&rsquo;s whole table.
        </p>
        {diff.unknown_tours.length ? (
          <p role="alert" className="mt-1 font-medium text-[#A32D2D] night:text-red-300">
            ⚠ Unknown tour name(s) in the file, ignored: {diff.unknown_tours.join(", ")}
          </p>
        ) : null}
      </div>

      {rowNames.length ? (
        <div className="mt-2 overflow-x-auto px-4">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                <th className="px-2 py-1.5 text-left text-[11px] font-semibold text-[#7c4a1e] night:text-amber-200">
                  Hotel · Spot
                </th>
                {tours.map((t) => (
                  <th
                    key={t.manifest_id}
                    className="px-2 py-1.5 text-left text-[11px] font-semibold text-[#7c4a1e] night:text-amber-200"
                  >
                    {t.tour_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowNames.map((name) => {
                const row = rows.get(name)!;
                return (
                  <tr key={name} className="border-t border-[#fed7aa]/70 night:border-amber-400/20">
                    <td className="px-2 py-1.5 whitespace-nowrap text-[#7c4a1e] night:text-amber-100">
                      {name}{" "}
                      {row.isNew ? (
                        <span className="ml-1 inline-block rounded-full bg-[#dcfce7] px-[7px] py-px text-[10px] font-semibold text-[#166534] night:bg-emerald-400/10 night:text-emerald-300">
                          new hotel
                        </span>
                      ) : null}
                    </td>
                    {tours.map((t) => {
                      const cell = row.cells.get(t.manifest_id);
                      if (cell === undefined) {
                        return (
                          <td
                            key={t.manifest_id}
                            className="px-2 py-1.5 text-[#7c4a1e]/50 night:text-amber-200/40"
                          >
                            —
                          </td>
                        );
                      }
                      if (typeof cell === "string") {
                        return (
                          <td
                            key={t.manifest_id}
                            className="px-2 py-1.5 font-semibold text-[#166534] night:text-emerald-300"
                          >
                            {cell}
                          </td>
                        );
                      }
                      return (
                        <td key={t.manifest_id} className="px-2 py-1.5 whitespace-nowrap">
                          <span className="text-[#7c4a1e]/60 line-through night:text-amber-200/40">
                            {cell.before ?? "—"}
                          </span>{" "}
                          <span className="font-semibold text-[#1d5fbf] night:text-sky-300">
                            {cell.after}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="px-4 pt-2 text-[12px] text-[#A32D2D] night:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2 px-4 py-3">
        <button
          type="button"
          disabled={applying}
          onClick={onApply}
          className={cn(BTN_ADD_SMALL_CLASS, "h-auto px-3.5 py-[7px] text-[12px]")}
        >
          {applying ? "Applying…" : `Apply to ${partnerName}`}
        </button>
        <button
          type="button"
          disabled={applying}
          onClick={onDiscard}
          className={BTN_EDIT_CLASS}
        >
          Discard
        </button>
      </div>
    </div>
  );
}
