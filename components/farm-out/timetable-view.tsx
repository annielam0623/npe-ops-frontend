"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_TITLE_CLASS,
  FORM_INPUT_CLASS,
  LegacyHowTo,
  LegacyPageHeader,
  TBODY_CLASS,
  TD_CLASS,
  TH_CLASS,
  TR_CLASS,
} from "@/components/pickup-locations/legacy-ui";
import { byTick } from "@/lib/by-tick";
import { usePermissions } from "@/lib/staff-permissions";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  applyPartnerTimetable,
  fetchPartners,
  fetchPartnerTimetable,
  fetchTourMeta,
  parsePartnerTimetable,
  partnerTimetableCsvUrl,
  savePartnerTimetable,
  saveTourMeta,
} from "@/lib/farm-out-api";
import { cn } from "@/lib/utils";
import type {
  FarmOutPartner,
  FarmOutTimetable,
  FarmOutTimetableDiff,
  FarmOutTourMeta,
} from "@/types/farm-out";

import {
  formatTime,
  gateFromError,
  type LoadGate,
  parseTimeInput,
} from "./config";
import {
  BTN_BLUE,
  BTN_PLAIN,
  CELL_INPUT,
  GateNotice,
  ResultLine,
  useRedirectToLogin,
} from "./ui";

type Result = { tone: "ok" | "error"; text: string } | null;
interface Upload {
  fileName: string;
  diff: FarmOutTimetableDiff;
  parsed: FarmOutTimetable;
}
interface MetaDraft {
  estimated_return_time: string;
  please_note: string;
}

const cellKey = (hotelId: number, manifestId: number) =>
  `${hotelId}_${manifestId}`;

function draftFrom(table: FarmOutTimetable): Record<string, string> {
  return Object.fromEntries(
    Object.entries(table.cells).map(([k, v]) => [k, formatTime(v)]),
  );
}

/**
 * 每家合作公司一张发车时间表 + 按团共用的返回时间 / 注意事项。
 * G199（Annie 2026-10-27「每个 partner 都有自己的专属 timetable」）：从 Partners 页进，`partnerId` 定死这一家，没有下拉。
 */
export function TimetableView({ partnerId: fixedId }: { partnerId: number }) {
  const [gate, setGate] = useState<LoadGate>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [partners, setPartners] = useState<FarmOutPartner[]>([]);
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [table, setTable] = useState<FarmOutTimetable | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [tableError, setTableError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<Result>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [metaRows, setMetaRows] = useState<FarmOutTourMeta[]>([]);
  const [metaDraft, setMetaDraft] = useState<Record<number, MetaDraft>>({});
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaResult, setMetaResult] = useState<Result>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const redirectToLogin = useRedirectToLogin();

  function loadMeta(rows: FarmOutTourMeta[]) {
    setMetaRows(rows);
    setMetaDraft(
      Object.fromEntries(
        rows.map((r) => [
          r.manifest_id,
          {
            estimated_return_time: r.estimated_return_time,
            please_note: r.please_note,
          },
        ]),
      ),
    );
  }

  // 全部按照勾选（Annie 2026-10-30 置顶 10c）：开关开着按勾（settings.farm_out，同后端接口），关着照旧；Super Admin 全过。
  const tickPerms = usePermissions();
  const tickPermsRef = useRef(tickPerms);
  tickPermsRef.current = tickPerms;
  useEffect(() => {
    // 权限读完再判断（开关开着时要按勾）。
    if (!tickPerms.ready) return;
    const controller = new AbortController();
    setGate({ kind: "loading" });
    (async () => {
      try {
        const me = await fetchCurrentUser(controller.signal);
        if (controller.signal.aborted) return;
        if (
          !byTick(tickPermsRef.current, "settings.farm_out", {
            legacy: me.is_admin,
            superAdmin: !!me.is_superadmin,
          })
        ) {
          setGate({ kind: "forbidden" });
          return;
        }
        const [list, meta] = await Promise.all([
          fetchPartners(),
          fetchTourMeta(),
        ]);
        if (controller.signal.aborted) return;
        setPartners(list);
        loadMeta(meta);
        const found = list.some((p) => p.id === fixedId);
        setNotFound(!found);
        setPartnerId(found ? fixedId : null);
        setGate({ kind: "ready" });
      } catch (error) {
        if (controller.signal.aborted) return;
        const next = gateFromError(error);
        if (next) setGate(next);
        else redirectToLogin();
      }
    })();
    return () => controller.abort();
  }, [reloadKey, redirectToLogin, fixedId, tickPerms.ready, tickPerms.active]);

  // 拉这家的表（换页 = 换公司时，没存的改动和没 Apply 的上传都丢掉）。
  useEffect(() => {
    if (partnerId == null) {
      setTable(null);
      return;
    }
    const controller = new AbortController();
    setTable(null);
    setTableError(null);
    setUpload(null);
    setUploadError(null);
    setSaveResult(null);
    (async () => {
      try {
        const t = await fetchPartnerTimetable(partnerId);
        if (controller.signal.aborted) return;
        setTable(t);
        setDraft(draftFrom(t));
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else setTableError(describeError(error));
      }
    })();
    return () => controller.abort();
  }, [partnerId, redirectToLogin]);

  const saveTable = useCallback(async () => {
    if (!table || partnerId == null || saving) return;
    const cells: Record<string, string> = {};
    for (const h of table.hotels) {
      if (h.id == null) continue; // 已存的时刻表里都有 id
      for (const t of table.tours) {
        const key = cellKey(h.id, t.manifest_id);
        const parsed = parseTimeInput(draft[key] ?? "");
        if (parsed === null) {
          setSaveResult({
            tone: "error",
            text: `${h.hotel_name} / ${t.tour_name}: "${draft[key]}" is not a time. Use something like 6:50 AM.`,
          });
          return;
        }
        if (parsed) cells[key] = parsed;
      }
    }
    setSaving(true);
    setSaveResult(null);
    try {
      const saved = await savePartnerTimetable(partnerId, { ...table, cells });
      setTable(saved);
      setDraft(draftFrom(saved));
      setSaveResult({ tone: "ok", text: "✓ Saved" });
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setSaveResult({ tone: "error", text: describeError(error) });
    } finally {
      setSaving(false);
    }
  }, [table, partnerId, saving, draft, redirectToLogin]);

  async function onFile(file: File | undefined) {
    if (!file || partnerId == null) return;
    setUploading(true);
    setUploadError(null);
    setUpload(null);
    try {
      const res = await parsePartnerTimetable(partnerId, file);
      setUpload({ fileName: file.name, diff: res.diff, parsed: res.parsed });
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setUploadError(describeError(error));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function applyUpload() {
    if (!upload || partnerId == null || applying) return;
    setApplying(true);
    setUploadError(null);
    try {
      const saved = await applyPartnerTimetable(partnerId, upload.parsed);
      setTable(saved);
      setDraft(draftFrom(saved));
      setUpload(null);
      setSaveResult({ tone: "ok", text: "✓ Applied" });
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setUploadError(describeError(error));
    } finally {
      setApplying(false);
    }
  }

  async function saveMeta() {
    if (metaSaving) return;
    setMetaSaving(true);
    setMetaResult(null);
    try {
      const saved = await saveTourMeta(
        metaRows.map((r) => ({
          ...r,
          estimated_return_time: (
            metaDraft[r.manifest_id]?.estimated_return_time ?? ""
          ).trim(),
          please_note: (metaDraft[r.manifest_id]?.please_note ?? "").trim(),
        })),
      );
      loadMeta(saved);
      setMetaResult({ tone: "ok", text: "✓ Saved" });
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setMetaResult({ tone: "error", text: describeError(error) });
    } finally {
      setMetaSaving(false);
    }
  }

  const ready = gate.kind === "ready";
  const partner = partners.find((p) => p.id === partnerId);

  return (
    <main className="text-stone-800 night:text-white/90">
      <LegacyPageHeader
        title={`🕖 ${partner ? `${partner.name} · ` : ""}Farm out Timetable`}
      />
      <nav aria-label="Back" className="mb-3.5">
        <Link
          href="/settings/farm-out-partners"
          className="inline-flex h-7 items-center rounded-lg border border-[rgba(147,197,253,.35)] px-[11px] text-[13px] text-[#93c5fd] no-underline hover:bg-white/[.07]"
        >
          ‹ Partners
        </Link>
      </nav>

      {ready && notFound ? (
        <p role="alert" className="text-[13px] text-white/70">
          This partner was not found. Go back to Partners and click Timetable on
          a partner.
        </p>
      ) : null}

      {!ready && gate.kind !== "loading" ? (
        <GateNotice gate={gate} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : null}
      {gate.kind === "loading" ? (
        <p className="text-[12px] text-white/60">Loading…</p>
      ) : null}

      {ready && !notFound ? (
        <>
          <HowToUse />

          <section className={CARD_CLASS}>
            <div className={CARD_HEADER_CLASS}>
              <span className="flex flex-wrap items-center gap-3">
                <h2 data-partner-title className={CARD_TITLE_CLASS}>
                  {partner?.name}
                  {partner && !partner.is_active ? " (inactive)" : ""}
                </h2>
                <span className="text-[12px] text-[#1a1a1a] night:text-white/60">
                  Departure times · check-in = 10 min earlier
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <ResultLine result={saveResult} />
                {partnerId != null ? (
                  <a
                    href={partnerTimetableCsvUrl(partnerId)}
                    download
                    className={BTN_PLAIN}
                  >
                    ⬇ Download as CSV
                  </a>
                ) : null}
                <button
                  type="button"
                  className={BTN_PLAIN}
                  disabled={partnerId == null || uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? "Reading…" : "⬆ Upload CSV / xlsx"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,text/csv"
                  aria-label="Timetable file"
                  className="hidden"
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
                <button
                  type="button"
                  className={BTN_BLUE}
                  disabled={!table || saving}
                  onClick={() => void saveTable()}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </span>
            </div>

            {uploadError ? (
              <div
                role="alert"
                className="border-b border-[#f3c4c4] bg-[#fdecec] px-4 py-2 text-[12px] text-[#A32D2D]"
              >
                {uploadError}
              </div>
            ) : null}

            {upload && partner ? (
              <UploadBox
                upload={upload}
                partnerName={partner.name}
                applying={applying}
                onApply={() => void applyUpload()}
                onDiscard={() => {
                  setUpload(null);
                  setUploadError(null);
                }}
              />
            ) : null}

            {partners.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-[#1a1a1a] night:text-white/60">
                No partners yet. Add one in Supplier → Partners.
              </p>
            ) : tableError ? (
              <p role="alert" className="px-4 py-6 text-[12px] text-[#A32D2D]">
                Could not load this timetable: {tableError}
              </p>
            ) : !table ? (
              <p className="px-4 py-6 text-center text-[12px] text-[#1a1a1a] night:text-white/60">
                Loading…
              </p>
            ) : table.hotels.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-[#1a1a1a] night:text-white/60">
                This partner has no pick-up locations yet. Add them in Supplier
                → Partners (Locations), or upload a file.
              </p>
            ) : (
              <div className="overflow-x-auto px-2 pb-3">
                <table
                  className="w-full min-w-[760px] border-collapse text-[12px] tabular-nums"
                  data-timetable
                >
                  <thead>
                    <tr>
                      <th className={TH_CLASS}>Hotel</th>
                      {table.tours.map((t) => (
                        <th key={t.manifest_id} className={TH_CLASS}>
                          {t.tour_name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className={TBODY_CLASS}>
                    {table.hotels.map((h) => (
                      <tr key={h.id} className={TR_CLASS}>
                        <td className={cn(TD_CLASS, "py-[7px]")}>
                          <b>{h.hotel_name}</b>
                        </td>
                        {table.tours.map((t) => {
                          const key = cellKey(h.id as number, t.manifest_id);
                          return (
                            <td key={t.manifest_id} className="px-2 py-[7px]">
                              <input
                                type="text"
                                aria-label={`${h.hotel_name} ${t.tour_name} departure`}
                                value={draft[key] ?? ""}
                                onChange={(e) =>
                                  setDraft((d) => ({
                                    ...d,
                                    [key]: e.target.value,
                                  }))
                                }
                                onBlur={() => {
                                  const p = parseTimeInput(draft[key] ?? "");
                                  if (p)
                                    setDraft((d) => ({
                                      ...d,
                                      [key]: formatTime(p),
                                    }));
                                }}
                                className={cn(CELL_INPUT, "w-[84px]")}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={CARD_CLASS}>
            <div className={CARD_HEADER_CLASS}>
              <h2 className={CARD_TITLE_CLASS}>
                Return time &amp; notes (the same for every partner)
              </h2>
              <span className="flex items-center gap-3">
                <ResultLine result={metaResult} />
                <button
                  type="button"
                  className={BTN_BLUE}
                  disabled={metaSaving || metaRows.length === 0}
                  onClick={() => void saveMeta()}
                >
                  {metaSaving ? "Saving…" : "Save"}
                </button>
              </span>
            </div>
            {metaRows.length === 0 ? (
              <p className="px-4 py-6 text-center text-[12px] text-[#1a1a1a] night:text-white/60">
                No tours yet.
              </p>
            ) : (
              <div className="grid gap-3 p-4 min-[800px]:grid-cols-2">
                {metaRows.map((r) => {
                  const d = metaDraft[r.manifest_id] ?? {
                    estimated_return_time: "",
                    please_note: "",
                  };
                  const patch = (p: Partial<MetaDraft>) =>
                    setMetaDraft((all) => ({
                      ...all,
                      [r.manifest_id]: { ...d, ...p },
                    }));
                  return (
                    <div
                      key={r.manifest_id}
                      data-tour-meta={r.tour_name}
                      className="rounded-[12px] border-[0.5px] border-black/10 p-4 night:border-white/10"
                    >
                      <div className="mb-2 text-[13px] font-semibold text-[#1a1a1a] night:text-white/90">
                        {r.tour_name}
                      </div>
                      <label
                        htmlFor={`rt-${r.manifest_id}`}
                        className="mb-1 block text-[11px] font-semibold text-[#1a1a1a] night:text-white/75"
                      >
                        Estimated return time
                      </label>
                      <input
                        id={`rt-${r.manifest_id}`}
                        type="text"
                        value={d.estimated_return_time}
                        placeholder="Not set — left blank in the notice"
                        onChange={(e) =>
                          patch({ estimated_return_time: e.target.value })
                        }
                        className={cn(FORM_INPUT_CLASS, "mb-3 w-full")}
                      />
                      <label
                        htmlFor={`pn-${r.manifest_id}`}
                        className="mb-1 block text-[11px] font-semibold text-[#1a1a1a] night:text-white/75"
                      >
                        PLEASE NOTE (leave empty to hide)
                      </label>
                      <textarea
                        id={`pn-${r.manifest_id}`}
                        rows={3}
                        value={d.please_note}
                        placeholder="Empty — the notice has no PLEASE NOTE part"
                        onChange={(e) => patch({ please_note: e.target.value })}
                        className={cn(FORM_INPUT_CLASS, "w-full")}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

/** 上传解析出来、还没存的结果：黄框，列出跟现在比的变化，点 Apply 才替换这家公司的整张表。 */
function UploadBox({
  upload,
  partnerName,
  applying,
  onApply,
  onDiscard,
}: {
  upload: Upload;
  partnerName: string;
  applying: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const { diff, parsed } = upload;
  const changedFor = (hotel: { hotel_name: string }, tour: string) =>
    diff.changed.find((c) => c.tour === tour && c.hotel === hotel.hotel_name);
  const isNew = (hotelName: string) => diff.new_hotels.includes(hotelName);

  return (
    <div
      data-upload-box
      className="border-b border-[#f0d080] bg-[#fff8e1] px-4 py-3 text-[#7C4A00]"
    >
      <div className="text-[13px] font-bold">
        Uploaded “{upload.fileName}” — not saved yet
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
        <table className="w-full min-w-[640px] border-collapse text-[12px] tabular-nums">
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
                  const now = formatTime(
                    parsed.cells[
                      h.id != null
                        ? cellKey(h.id, t.manifest_id)
                        : `new${hi}_${t.manifest_id}`
                    ],
                  );
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

/** 页面说明（同其它 Settings 页的蓝色 How to use 条）。 */
function HowToUse() {
  return (
    <LegacyHowTo
      title="How to use — Farm out Timetable"
      padY="py-2.5"
      footer="A tour with no departure time anywhere in a partner's table cannot be farmed out to that partner yet — set at least one hotel's time for it first."
    >
      <li>
        This is one partner&apos;s timetable. Each partner has its own pick-up
        locations and its own set of times. To open another partner, go back to
        Partners and click Timetable on that partner (add locations there too).
      </li>
      <li>
        Type a departure time straight into a cell (for example 6:20 or 6:20
        AM). Check-in is worked out as 10 minutes earlier. Click Save to store
        the whole table; a cell that is not a time is reported and nothing is
        saved until you fix it.
      </li>
      <li>
        Download as CSV saves the table shown, which is also a blank template
        for a new partner. Upload CSV / xlsx reads a file and shows what would
        change before anything is saved. Review it, then Apply to replace this
        partner&apos;s whole table, or Discard to drop the file.
      </li>
      <li>
        Return time &amp; notes below apply to a tour for every partner. Leave
        PLEASE NOTE empty to hide that whole line from the guest notice.
      </li>
    </LegacyHowTo>
  );
}
