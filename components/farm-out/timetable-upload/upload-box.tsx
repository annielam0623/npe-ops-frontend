"use client";

import { SelectMenu } from "@/components/ui/select-menu";
import { cn } from "@/lib/utils";
import type {
  FarmOutFormatMatch,
  FarmOutFormatName,
  FarmOutOrientation,
  FarmOutTimetable,
  FarmOutTimetableDiff,
  FarmOutTimetableGrid,
  FarmOutTimetableParse,
  FarmOutUploadFormat,
} from "@/types/farm-out";

import { formatTime } from "../config";
import { BTN_BLUE, BTN_PLAIN, CELL_INPUT } from "../ui";
import { uploadFileKind } from "./file-kind";
import { PhotoPane } from "./photo-pane";

/**
 * 146 Farm out 时刻表上传的黄框（Annie 2026-11-23「1同意推荐，动手」Q1–Q7 全 A；
 * preview https://claude.ai/artifact/7ur4WRKmH4ysd2cR9ocnc1 ①②③；后端合同 v1）。
 * - 要对名字（needs_match）⇒ 对照面板：方向 + 对方每个团名 / 酒店名对到我们的哪个（或 Skip / 新酒店）+ Remember；
 *   「Read with these matches」调 rematch（不重读照片）。
 * - 不用对 ⇒ 核对表（同原来的黄框），看不清的格子标橙、可以改，Apply 才存；「Change matches」回对照面板。
 * - 照片：左边显示原图（本地 blob，不存）。
 */

export interface UploadState {
  fileName: string;
  /** 只为显示照片（Q7 不存原件）。 */
  file: File;
  source: FarmOutTimetableParse["source"];
  grid: FarmOutTimetableGrid;
  /** 当前的对照（parse / rematch 返回的；面板里改的也写这里）。 */
  format: FarmOutUploadFormat;
  /** 对照面板开着（needs_match，或点了 Change matches）。 */
  matching: boolean;
  diff: FarmOutTimetableDiff | null;
  parsed: FarmOutTimetable | null;
  /** 橙色格子里 staff 改的字（原样，Apply 时才换成 HH:MM）。 */
  edits: Record<string, string>;
  remember: boolean;
  /** staff 在面板里按过 Read with these matches ⇒ Apply 时带 format + remember。 */
  rematched: boolean;
  /** 面板里的报错（还有没选的名字等）。 */
  matchError: string | null;
}

export function uploadFromParse(
  file: File,
  res: FarmOutTimetableParse,
): UploadState {
  return {
    fileName: file.name,
    file,
    source: res.source,
    grid: res.grid,
    format: res.format,
    matching: res.needs_match || !res.parsed,
    diff: res.diff,
    parsed: res.parsed,
    edits: {},
    remember: true,
    rematched: false,
    matchError: null,
  };
}

/** rematch 回来：照片和原表格不变（source 保留 parse 那次的）。 */
export function uploadFromRematch(
  prev: UploadState,
  res: FarmOutTimetableParse,
): UploadState {
  return {
    ...prev,
    format: res.format,
    matching: res.needs_match || !res.parsed,
    diff: res.diff,
    parsed: res.parsed,
    edits: {},
    rematched: true,
    matchError: null,
  };
}

export const MATCH_MISSING =
  "Choose a match for every tour and hotel name, or Skip it.";

export function hasMissingMatch(format: FarmOutUploadFormat): boolean {
  return [...format.tours, ...format.hotels].some((n) => n.match == null);
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** 换方向：团和酒店换一条边，名字从原表格的另一边取；跟我们名字一样的先对上，别的要重选。 */
export function flipOrientation(
  format: FarmOutUploadFormat,
  grid: FarmOutTimetableGrid,
  orientation: FarmOutOrientation,
  ours: {
    tours: { manifest_id: number; tour_name: string }[];
    hotels: { id: number | null; hotel_name: string }[];
  },
): FarmOutUploadFormat {
  if (orientation === format.orientation) return format;
  const tourNames = orientation === "hotels_down" ? grid.cols : grid.rows;
  const hotelNames = orientation === "hotels_down" ? grid.rows : grid.cols;
  const tourName = (name: string): FarmOutFormatName => {
    const t = ours.tours.find((x) => norm(x.tour_name) === norm(name));
    return t
      ? { name, match: { manifest_id: t.manifest_id }, status: "exact" }
      : { name, match: null, status: "none" };
  };
  const hotelName = (name: string): FarmOutFormatName => {
    const h = ours.hotels.find(
      (x) => x.id != null && norm(x.hotel_name) === norm(name),
    );
    return h && h.id != null
      ? { name, match: { location_id: h.id }, status: "exact" }
      : { name, match: null, status: "none" };
  };
  return {
    orientation,
    orientation_status: "chosen",
    tours: tourNames.map(tourName),
    hotels: hotelNames.map(hotelName),
  };
}

const LAYOUT_OPTIONS: { value: FarmOutOrientation; label: string }[] = [
  {
    value: "hotels_down",
    label: "Hotels down the side, tours across the top",
  },
  {
    value: "tours_down",
    label: "Tours down the side, hotels across the top",
  },
];

function matchValue(m: FarmOutFormatMatch): string {
  if (m == null) return "";
  if ("skip" in m) return "skip";
  if ("new" in m) return "new";
  if ("manifest_id" in m) return `t${m.manifest_id}`;
  return `h${m.location_id}`;
}

function matchFrom(value: string): FarmOutFormatMatch {
  if (value === "") return null;
  if (value === "skip") return { skip: true };
  if (value === "new") return { new: true };
  if (value.startsWith("t")) return { manifest_id: Number(value.slice(1)) };
  return { location_id: Number(value.slice(1)) };
}

function StatusMark({ n }: { n: FarmOutFormatName }) {
  if (n.match == null)
    return <span className="font-semibold text-[#A32D2D]">Choose one</span>;
  if (n.status === "saved")
    return <span className="font-bold text-[#15803d]">✓ saved</span>;
  if (n.status === "exact")
    return <span className="font-bold text-[#15803d]">✓ same name</span>;
  if (n.status === "guess")
    return (
      <span className="font-semibold text-[#b45309]">closest name — check</span>
    );
  return null;
}

const SELECT_CLASS =
  "h-7 min-w-[200px] rounded-[5px] border border-[#c9b980] bg-white px-1.5 text-[12px] text-[#1a1a1a]";

export function UploadBox({
  upload,
  partnerName,
  ours,
  applying,
  rematching,
  onChange,
  onRematch,
  onApply,
  onDiscard,
}: {
  upload: UploadState;
  partnerName: string;
  /** 我们的团（Products 的 Bus 团）+ 这家已有的上车点：GET timetable 回来的那份。 */
  ours: FarmOutTimetable;
  applying: boolean;
  rematching: boolean;
  onChange: (next: UploadState) => void;
  onRematch: () => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const isPhoto = uploadFileKind(upload.file) === "photo";
  const fromImage = upload.source === "image" || isPhoto;
  const body = upload.matching ? (
    <MatchPanel
      upload={upload}
      partnerName={partnerName}
      ours={ours}
      rematching={rematching}
      onChange={onChange}
      onRematch={onRematch}
      onDiscard={onDiscard}
    />
  ) : upload.parsed && upload.diff ? (
    <CheckGrid
      upload={upload}
      parsed={upload.parsed}
      diff={upload.diff}
      partnerName={partnerName}
      applying={applying}
      onChange={onChange}
      onApply={onApply}
      onDiscard={onDiscard}
    />
  ) : null;

  return (
    <div
      data-upload-box
      data-upload-mode={upload.matching ? "match" : "check"}
      className="border-b border-[#f0d080] bg-[#fff8e1] px-4 py-3 text-[#7C4A00]"
    >
      <div className="text-[13px] font-bold">
        {upload.matching
          ? `Uploaded “${upload.fileName}” — match the columns first`
          : fromImage
            ? `Read from photo “${upload.fileName}” — not saved yet`
            : `Uploaded “${upload.fileName}” — not saved yet`}
      </div>
      {isPhoto ? (
        <div className="mt-2 grid gap-3 min-[640px]:grid-cols-2">
          <PhotoPane file={upload.file} />
          <div className="min-w-0">{body}</div>
        </div>
      ) : (
        body
      )}
    </div>
  );
}

function MatchPanel({
  upload,
  partnerName,
  ours,
  rematching,
  onChange,
  onRematch,
  onDiscard,
}: {
  upload: UploadState;
  partnerName: string;
  ours: FarmOutTimetable;
  rematching: boolean;
  onChange: (next: UploadState) => void;
  onRematch: () => void;
  onDiscard: () => void;
}) {
  const { format } = upload;
  const toursDown = format.orientation === "tours_down";
  const hasSaved = [...format.tours, ...format.hotels].some(
    (n) => n.status === "saved",
  );
  const pending = [...format.tours, ...format.hotels].filter(
    (n) => n.status === "guess" || n.status === "none" || n.match == null,
  );

  const setFormat = (next: FarmOutUploadFormat) =>
    onChange({ ...upload, format: next, matchError: null });
  const setName = (
    kind: "tours" | "hotels",
    index: number,
    match: FarmOutFormatMatch,
  ) =>
    setFormat({
      ...format,
      [kind]: format[kind].map((n, i) =>
        i === index ? { ...n, match, status: "chosen" as const } : n,
      ),
    });

  const tourOptions = [
    ...ours.tours.map((t) => ({
      value: `t${t.manifest_id}`,
      label: t.tour_name,
    })),
    { value: "skip", label: "— Skip (we don't farm this out)" },
  ];
  const hotelOptions = (name: string) => [
    ...ours.hotels
      .filter((h) => h.id != null)
      .map((h) => ({ value: `h${h.id}`, label: h.hotel_name })),
    { value: "new", label: `+ New hotel “${name}”` },
    { value: "skip", label: "— Skip" },
  ];
  const withChoose = (
    opts: { value: string; label: string }[],
    m: FarmOutFormatMatch,
  ) => (m == null ? [{ value: "", label: "Choose…" }, ...opts] : opts);

  const row = (kind: "tours" | "hotels", n: FarmOutFormatName, i: number) => {
    const isRow = kind === "tours" ? toursDown : !toursDown;
    const opts =
      kind === "tours"
        ? withChoose(tourOptions, n.match)
        : withChoose(hotelOptions(n.name), n.match);
    return (
      <tr key={`${kind}${i}`} data-match-row={`${kind}:${n.name}`}>
        <td className="border-b border-[#e5d9b5] px-2 py-1">
          {isRow ? "Row" : "Column"} “{n.name}”
        </td>
        <td className="border-b border-[#e5d9b5] px-2 py-1">
          <span className="flex flex-wrap items-center gap-2">
            <SelectMenu
              aria-label={`Match for ${kind === "tours" ? "tour" : "hotel"} ${n.name}`}
              value={matchValue(n.match)}
              options={opts}
              onChange={(v) => setName(kind, i, matchFrom(v))}
              className={cn(
                SELECT_CLASS,
                n.match == null && "border-[#A32D2D]",
              )}
            />
            <StatusMark n={n} />
          </span>
        </td>
      </tr>
    );
  };

  return (
    <div data-match-panel>
      <div className="mt-0.5 text-[12px]">
        {hasSaved
          ? `${pending.length} new ${pending.length === 1 ? "name" : "names"} in the file: ${pending.map((n) => `“${n.name}”`).join(", ")} — match ${pending.length === 1 ? "it" : "them"} below.`
          : `This file does not use our layout. Tell us what each part is once; next time ${partnerName}'s files are read the same way.`}
      </div>
      <div className="mt-2 rounded-[6px] bg-[#fffdf3] p-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px]">
          <b>Layout:</b>
          <SelectMenu
            aria-label="Layout"
            value={format.orientation}
            options={LAYOUT_OPTIONS}
            onChange={(v) =>
              setFormat(flipOrientation(format, upload.grid, v, ours))
            }
            className={SELECT_CLASS}
          />
          {format.orientation_status === "guess" ? (
            <span className="text-[11px] text-[#b45309]">
              our guess — check
            </span>
          ) : null}
          {toursDown ? (
            <span className="text-[11px]">
              (our table is the other way round; we turn it for you)
            </span>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-[12px]">
            <thead>
              <tr className="text-left">
                <th className="border-b border-[#e5d9b5] px-2 py-1">
                  In {partnerName}&apos;s file
                </th>
                <th className="border-b border-[#e5d9b5] px-2 py-1">Is our…</th>
              </tr>
            </thead>
            <tbody>
              {format.tours.map((n, i) => row("tours", n, i))}
              {format.hotels.map((n, i) => row("hotels", n, i))}
            </tbody>
          </table>
        </div>
        <label className="mt-1.5 flex items-center gap-1.5 text-[12px]">
          <input
            type="checkbox"
            checked={upload.remember}
            onChange={(e) =>
              onChange({ ...upload, remember: e.target.checked })
            }
          />
          Remember this for {partnerName}
        </label>
      </div>
      {upload.matchError ? (
        <div role="alert" className="mt-1.5 text-[12px] text-[#A32D2D]">
          {upload.matchError}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={BTN_PLAIN}
          disabled={rematching}
          onClick={onRematch}
        >
          {rematching ? "Reading…" : "Read with these matches"}
        </button>
        <button
          type="button"
          className={BTN_PLAIN}
          disabled={rematching}
          onClick={onDiscard}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

const cellKey = (hotelId: number, manifestId: number) =>
  `${hotelId}_${manifestId}`;

function CheckGrid({
  upload,
  parsed,
  diff,
  partnerName,
  applying,
  onChange,
  onApply,
  onDiscard,
}: {
  upload: UploadState;
  parsed: FarmOutTimetable;
  diff: FarmOutTimetableDiff;
  partnerName: string;
  applying: boolean;
  onChange: (next: UploadState) => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const { format } = upload;
  const unclear = new Set(parsed.unclear ?? []);
  const fromImage = upload.source === "image";
  const changedFor = (hotel: { hotel_name: string }, tour: string) =>
    diff.changed.find((c) => c.tour === tour && c.hotel === hotel.hotel_name);
  const isNew = (hotelName: string) => diff.new_hotels.includes(hotelName);
  const names = [...format.tours, ...format.hotels].filter(
    (n) => n.match != null && !("skip" in n.match),
  ).length;
  const all = [...format.tours, ...format.hotels];
  const formatLabel = all.some((n) => n.status === "saved")
    ? `Read with ${partnerName}'s saved format`
    : all.some((n) => n.status === "chosen")
      ? "Read with the matches you chose"
      : "Read with our own layout";
  const layout =
    format.orientation === "tours_down"
      ? "tours down the side"
      : "hotels down the side";

  return (
    <div data-check-grid>
      {fromImage ? (
        <div className="mt-0.5 text-[12px]">
          Times were read from a picture.{" "}
          <b>Check every orange cell against the photo</b> before you apply.
          Nothing is saved until Apply.
        </div>
      ) : null}
      <div className="mt-0.5 text-[12px]" data-format-line>
        {formatLabel} ({layout}, {names} {names === 1 ? "name" : "names"}{" "}
        matched) ·{" "}
        <button
          type="button"
          className="cursor-pointer border-none bg-transparent p-0 text-[12px] text-[#7C4A00] underline"
          onClick={() =>
            onChange({ ...upload, matching: true, matchError: null })
          }
        >
          Change matches
        </button>
      </div>
      <div className="mt-0.5 text-[12px]">
        {diff.changed.length}{" "}
        {diff.changed.length === 1 ? "time changes" : "times change"}
        {" · "}
        {diff.new_hotels.length} new{" "}
        {diff.new_hotels.length === 1 ? "hotel" : "hotels"}
        {" · "}
        {diff.unmatched_tours.length} tour{" "}
        {diff.unmatched_tours.length === 1 ? "name" : "names"} not found. Check,
        then Apply to replace {partnerName}&apos;s whole table.
      </div>
      {diff.unmatched_tours.length > 0 ? (
        <div className="mt-1 text-[12px] text-[#A32D2D]">
          Ignored (not a tour on Products):{" "}
          {diff.unmatched_tours.map((t) => `“${t}”`).join(", ")}
        </div>
      ) : null}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-[12px] tabular-nums">
          <thead>
            <tr className="text-left">
              <th className="border-b border-[#e5d9b5] px-2 py-1">Hotel</th>
              {parsed.tours.map((t) => (
                <th
                  key={t.manifest_id}
                  className="border-b border-[#e5d9b5] px-2 py-1"
                >
                  {t.tour_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parsed.hotels.map((h, hi) => (
              <tr key={h.id ?? `new${hi}`}>
                <td className="px-2 py-1">
                  <b>{h.hotel_name}</b>
                  {isNew(h.hotel_name) ? (
                    <span className="ml-1 font-bold text-[#15803d]">
                      new hotel
                    </span>
                  ) : null}
                </td>
                {parsed.tours.map((t) => {
                  // 新酒店（id 为 null）的格子 key 是 new<序号>_<团>。
                  const key =
                    h.id != null
                      ? cellKey(h.id, t.manifest_id)
                      : `new${hi}_${t.manifest_id}`;
                  const now = formatTime(parsed.cells[key]);
                  if (unclear.has(key)) {
                    return (
                      <td
                        key={t.manifest_id}
                        className="bg-[#ffe2b8] px-2 py-1"
                        data-unclear={key}
                      >
                        <input
                          type="text"
                          aria-label={`${h.hotel_name} ${t.tour_name} departure (hard to read)`}
                          value={upload.edits[key] ?? now}
                          onChange={(e) =>
                            onChange({
                              ...upload,
                              edits: { ...upload.edits, [key]: e.target.value },
                            })
                          }
                          className={cn(CELL_INPUT, "w-[84px]")}
                        />{" "}
                        ?
                      </td>
                    );
                  }
                  const ch = changedFor(h, t.tour_name);
                  return (
                    <td key={t.manifest_id} className="px-2 py-1">
                      {ch ? (
                        <>
                          {ch.from ? (
                            <s className="text-[#999]">{formatTime(ch.from)}</s>
                          ) : null}{" "}
                          <b className="text-[#1d4ed8]">
                            {formatTime(ch.to) || "—"}
                          </b>
                        </>
                      ) : isNew(h.hotel_name) ? (
                        <span className="text-[#15803d]">{now}</span>
                      ) : (
                        now
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unclear.size > 0 ? (
        <div className="mt-1 text-[11px]">
          Orange = hard to read in the photo. Click a cell to fix it before
          Apply.
        </div>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className={BTN_BLUE}
          disabled={applying}
          onClick={onApply}
        >
          {applying ? "Applying…" : `Apply to ${partnerName}`}
        </button>
        <button
          type="button"
          className={BTN_PLAIN}
          disabled={applying}
          onClick={onDiscard}
        >
          Discard
        </button>
      </div>
    </div>
  );
}
