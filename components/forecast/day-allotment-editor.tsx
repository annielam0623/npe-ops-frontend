"use client";

import { useState } from "react";

import { describeError } from "@/lib/api-errors";
import type { ForecastAllotment } from "@/types";

import { describeMeta } from "./config";
import { DAY_INPUT_CLASS, DayDialog } from "./day-dialog";

/** 一档要存的东西；max null = 撤掉这天的手改。 */
export interface AllotmentChange {
  rowLabel: string;
  maxPax: number | null;
  timeLabel: string;
}

interface Draft {
  max: string;
  time: string;
  /** 点了 Back to usual：存的时候撤掉这天的手改。 */
  revert: boolean;
}

/** 时间最多几个字（后端同样拦，≤20）。 */
const TIME_MAX_LENGTH = 20;

/**
 * Max allotments 格点开：改这一天每档的上限 / 时间（G81，所有 staff）。
 * 手改会同时替换上限和时间，所以时间一起传回（后端：不传 = 这天时间变空）。
 * 只存改过的档；有手改的档有 Back to usual。
 */
export function DayAllotmentEditor({
  title,
  subtitle,
  allotments,
  dayIndex,
  abbreviations,
  onSave,
  onClose,
}: {
  title: string;
  subtitle: string;
  allotments: ForecastAllotment[];
  dayIndex: number;
  abbreviations: Map<string, string>;
  onSave: (changes: AllotmentChange[]) => Promise<void>;
  onClose: () => void;
}) {
  const initial = (a: ForecastAllotment): Draft => ({
    max: String(a.max[dayIndex] ?? ""),
    time: a.time[dayIndex] ?? "",
    revert: false,
  });
  const [drafts, setDrafts] = useState<Draft[]>(() => allotments.map(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(i: number, change: Partial<Draft>) {
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...change } : d)));
  }

  /** 这一档有没有要存的：撤销；或上限 / 时间和现在显示的不同（上限空且本来没有 = 没动）。 */
  function changeFor(i: number): AllotmentChange | null | "invalid" {
    const a = allotments[i];
    const d = drafts[i];
    if (d.revert) return { rowLabel: a.label, maxPax: null, timeLabel: "" };
    const max = d.max.trim();
    const before = initial(a);
    if (max === before.max && d.time.trim() === before.time) return null;
    if (!/^\d+$/.test(max)) return "invalid";
    const n = Number(max);
    if (n < 1 || n > 9999) return "invalid";
    return { rowLabel: a.label, maxPax: n, timeLabel: d.time.trim() };
  }

  const results = allotments.map((_, i) => changeFor(i));
  const invalid = results.some((r) => r === "invalid");
  const changes = results.filter(
    (r): r is AllotmentChange => r !== null && r !== "invalid",
  );

  async function handleSave() {
    if (saving || invalid || !changes.length) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(changes);
      onClose();
    } catch (e) {
      setError(describeError(e));
      setSaving(false);
    }
  }

  return (
    <DayDialog
      title={title}
      subtitle={subtitle}
      error={error}
      saving={saving}
      canSave={!invalid && changes.length > 0}
      onSave={() => void handleSave()}
      onClose={onClose}
    >
      <div className="mt-3 space-y-3">
        {allotments.map((a, i) => {
          const meta = a.day_meta?.[dayIndex] ?? null;
          const d = drafts[i];
          return (
            <div key={a.label} data-allot-edit={a.label}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-white/80">
                  {abbreviations.get(a.label) === a.label
                    ? a.label
                    : `${abbreviations.get(a.label)} · ${a.label}`}
                </span>
                {meta && !d.revert ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => patch(i, { revert: true })}
                    className="text-[11px] text-sky-300 hover:underline"
                  >
                    Back to usual
                  </button>
                ) : null}
              </div>
              {d.revert ? (
                <p className="mt-1 text-[11px] text-white/55">
                  This day goes back to the usual limit
                  {a.normal_max !== null
                    ? ` (${a.normal_max}${a.normal_time ? ` · ${a.normal_time}` : ""})`
                    : ""}{" "}
                  when you Save.{" "}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => patch(i, { ...initial(a) })}
                    className="text-sky-300 hover:underline"
                  >
                    Undo
                  </button>
                </p>
              ) : (
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label={`${a.label} max`}
                    value={d.max}
                    disabled={saving}
                    placeholder="Max"
                    onChange={(event) => patch(i, { max: event.target.value })}
                    className={`${DAY_INPUT_CLASS} w-20 shrink-0`}
                  />
                  <input
                    type="text"
                    aria-label={`${a.label} time`}
                    value={d.time}
                    maxLength={TIME_MAX_LENGTH}
                    disabled={saving}
                    placeholder="Time, e.g. 1p"
                    onChange={(event) => patch(i, { time: event.target.value })}
                    className={DAY_INPUT_CLASS}
                  />
                </div>
              )}
              {meta ? (
                <p className="mt-1 text-[11px] text-white/40">
                  Changed here {describeMeta(meta)}
                </p>
              ) : a.normal_max !== null ? (
                <p className="mt-1 text-[11px] text-white/40">
                  Usual: {a.normal_max}
                  {a.normal_time ? ` · ${a.normal_time}` : ""}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {invalid ? (
        <p className="mt-2 text-[11px] text-red-300">
          Max must be a whole number from 1 to 9999.
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-white/45">
          Applies to this day only. The usual limits stay in Settings →
          Products.
        </p>
      )}
    </DayDialog>
  );
}
