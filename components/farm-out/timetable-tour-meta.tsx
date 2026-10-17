"use client";

import { useEffect, useState } from "react";

import {
  BTN_ADD_SMALL_CLASS,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_TITLE_CLASS,
  FORM_INPUT_CLASS,
} from "@/components/pickup-locations/legacy-ui";
import { cn } from "@/lib/utils";
import type { FarmOutTourMeta } from "@/types/farm-out";

type SaveState = "saving" | "saved" | "failed" | undefined;

type SaveResult =
  | { status: "ok" }
  | { status: "error"; message: string }
  | { status: "redirecting" };

type SaveMeta = (
  manifestId: number,
  patch: { return_time: string | null; please_note: string },
) => Promise<SaveResult>;

/**
 * 表格下面按团的卡片：预计返回时间 + PLEASE NOTE（任务包第 14 / 14a 条）。所有公司共用一份，
 * 不分公司。每张卡自己的 Save（同 Vehicles / Products 逐行自己 Save 的惯例）。
 */
export function TimetableTourMetaGrid({
  tours,
  tourMeta,
  onSave,
  onUnauthorized,
}: {
  tours: { manifest_id: number; tour_name: string }[];
  tourMeta: FarmOutTourMeta[];
  onSave: SaveMeta;
  onUnauthorized: () => void;
}) {
  return (
    <section className="mb-5">
      <h3 className="mb-2.5 text-[13px] font-semibold text-[#f8fafc]">
        Return time &amp; notices
      </h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {tours.map((t) => (
          <TourMetaCard
            key={t.manifest_id}
            tour={t}
            meta={tourMeta.find((m) => m.manifest_id === t.manifest_id) ?? null}
            onSave={onSave}
            onUnauthorized={onUnauthorized}
          />
        ))}
      </div>
    </section>
  );
}

function TourMetaCard({
  tour,
  meta,
  onSave,
  onUnauthorized,
}: {
  tour: { manifest_id: number; tour_name: string };
  meta: FarmOutTourMeta | null;
  onSave: SaveMeta;
  onUnauthorized: () => void;
}) {
  const [returnTime, setReturnTime] = useState(meta?.return_time ?? "");
  const [note, setNote] = useState(meta?.please_note ?? "");
  const [state, setState] = useState<SaveState>(undefined);
  const [error, setError] = useState<string | null>(null);

  // 别家保存成功重拉以后，这张卡没改过就跟着服务端的新值走；改过的保留草稿（同 Products 惯例）。
  useEffect(() => {
    setReturnTime((prev) => (prev === "" ? meta?.return_time ?? "" : prev));
  }, [meta?.return_time]);
  useEffect(() => {
    setNote((prev) => (prev === "" ? meta?.please_note ?? "" : prev));
  }, [meta?.please_note]);

  async function save() {
    setState("saving");
    setError(null);
    const result = await onSave(tour.manifest_id, {
      return_time: returnTime.trim() === "" ? null : returnTime.trim(),
      please_note: note,
    });
    if (result.status === "ok") {
      setState("saved");
      setTimeout(() => setState(undefined), 1400);
    } else if (result.status === "redirecting") {
      onUnauthorized();
    } else {
      setState("failed");
      setError(result.message);
    }
  }

  return (
    <div className={CARD_CLASS}>
      <div className={CARD_HEADER_CLASS}>
        <span className={CARD_TITLE_CLASS}>{tour.tour_name}</span>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3.5">
        <label className="flex flex-col gap-[5px]">
          <span className="text-[12px] font-medium text-[#1a1a1a] night:text-white/55">
            Estimated return time
          </span>
          <input
            type="text"
            aria-label={`Estimated return time — ${tour.tour_name}`}
            value={returnTime}
            placeholder="Not set — left blank in the notice"
            onChange={(e) => setReturnTime(e.target.value)}
            className={cn(FORM_INPUT_CLASS, "w-full")}
          />
        </label>
        <label className="flex flex-col gap-[5px]">
          <span className="text-[12px] font-medium text-[#1a1a1a] night:text-white/55">
            PLEASE NOTE (leave empty to hide)
          </span>
          <textarea
            aria-label={`Please note — ${tour.tour_name}`}
            value={note}
            rows={3}
            placeholder="Leave empty — the whole PLEASE NOTE section is hidden in the notice."
            onChange={(e) => setNote(e.target.value)}
            className={cn(FORM_INPUT_CLASS, "w-full resize-y")}
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={`Save — ${tour.tour_name}`}
            disabled={state === "saving"}
            onClick={() => void save()}
            className={BTN_ADD_SMALL_CLASS}
          >
            {state === "saving" ? "Saving…" : state === "saved" ? "✓ Saved" : "Save"}
          </button>
          {error ? (
            <span role="alert" className="text-[11px] text-[#A32D2D] night:text-red-300">
              {error}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
