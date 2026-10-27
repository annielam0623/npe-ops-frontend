"use client";

import { useEffect, useState } from "react";

import { useViewOnly } from "@/components/ui/view-only";
import { describeError, isStatus } from "@/lib/api-errors";
import { LA_TIME_ZONE, laToday } from "@/lib/la-date";
import { saveManifestSectionCfm } from "@/lib/manifests-api";
import { cn } from "@/lib/utils";
import type { ManifestListSection } from "@/types";

const CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});
const DAY_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: LA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 今天存的只写钟点（「9:12 AM」），更早的带日期（「Oct 26, 9:12 AM」）。 */
function savedWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return YMD.format(d) === laToday() ? CLOCK.format(d) : DAY_CLOCK.format(d);
}

/**
 * Main Manifest Bus tour 节标题行里的「Cfm #」一格 + Save（G198 preview ③，Annie：「总表上填一次」）：
 * 按「日期 + 团 + 节」存一个号，Bus Manifest 上每辆车那一节的标题都带这个号。靠左，紧跟在「N orders · N pax · Tour time」后面。
 * 所有 staff 都能存；只做记录，不发送。partner（只看）只显示号，没有输入框和 Save。
 */
export function SectionCfm({
  section,
  date,
  manifestId,
  onUnauthorized,
}: {
  section: ManifestListSection;
  date: string;
  manifestId: number;
  onUnauthorized: () => void;
}) {
  const viewOnly = useViewOnly();
  const fromServer = section.cfm_no ?? "";
  const [saved, setSaved] = useState(fromServer);
  const [text, setText] = useState(fromServer);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setSaved(fromServer);
    setText(fromServer);
  }, [fromServer]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const d = await saveManifestSectionCfm({
        tour_date: date,
        manifest_id: manifestId,
        section: section.title,
        cfm_no: text.trim(),
      });
      setSaved(d.cfm_no ?? "");
      setText(d.cfm_no ?? "");
      setFlash(true);
      setTimeout(() => setFlash(false), 1400);
    } catch (e) {
      if (isStatus(e, 401)) onUnauthorized();
      else setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  // 「谁存的」只在号还是后端给的那个时写（刚在这里改过的，刷新后才有新的名字和时间）。
  const by =
    saved && saved === fromServer && section.cfm_updated_by
      ? `Saved by ${section.cfm_updated_by}${
          section.cfm_updated_at
            ? ` · ${savedWhen(section.cfm_updated_at)}`
            : ""
        }`
      : null;

  if (viewOnly) {
    return (
      <span data-section-cfm className="ml-2.5 font-semibold">
        Cfm # {saved || "—"}
      </span>
    );
  }

  return (
    <span
      data-section-cfm
      className="ml-2.5 inline-flex flex-wrap items-center gap-1.5 font-semibold"
    >
      <label className="inline-flex items-center gap-1.5">
        Cfm #
        <input
          type="text"
          aria-label={`Cfm # for ${section.title}`}
          value={text}
          maxLength={100}
          placeholder="Not filled"
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim() !== saved) void save();
            if (e.key === "Escape") {
              setText(saved);
              setError("");
            }
          }}
          className="h-[26px] w-[120px] rounded-md border border-black/30 bg-white px-2 font-normal text-[#111] placeholder:text-[#999] focus:border-[#3b82f6] focus:outline-none disabled:opacity-60"
        />
      </label>
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy || text.trim() === saved}
        className="cursor-pointer rounded-md border border-[#3b82f6] bg-[#3b82f6] px-2.5 py-[3px] text-[11.5px] font-bold text-white disabled:cursor-default disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <small
        className={cn(
          "font-normal",
          error ? "text-[#b3261e]" : flash ? "text-[#047857]" : "text-[#555]",
        )}
        role={error ? "alert" : undefined}
      >
        {error ||
          (flash ? "Saved" : (by ?? "Shows on every bus with this section"))}
      </small>
    </span>
  );
}
