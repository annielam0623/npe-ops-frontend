"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BTN_ADD_CLASS,
  BTN_DELETE_CLASS,
  BTN_EDIT_CLASS,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_TITLE_CLASS,
  FORM_INPUT_CLASS,
  INLINE_INPUT_CLASS,
  LegacyHowTo,
  LegacyPageHeader,
  resultClass,
  TBODY_CLASS,
  TD_CLASS,
  TH_CLASS,
  TR_CLASS,
  TR_HOVER,
} from "@/components/pickup-locations/legacy-ui";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  applyFarmOutTimetable,
  createFarmOutSpot,
  deleteFarmOutSpot,
  fetchFarmOutTimetable,
  saveFarmOutDeparture,
  saveFarmOutSpot,
  saveFarmOutTourMeta,
  uploadFarmOutTimetable,
} from "@/lib/farm-out-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type {
  FarmOutPickupSpot,
  FarmOutTimetable,
  FarmOutTimetableUploadDiff,
} from "@/types/farm-out";

import { buildTimetableCsv, computeCheckin, downloadTextFile, safeFileSegment } from "./config";
import { TimetableDiffBanner } from "./timetable-diff";
import { TimetableTourMetaGrid } from "./timetable-tour-meta";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; timetable: FarmOutTimetable };

/** spotId → manifestId → 草稿值（没保存的编辑）。 */
type Drafts = Record<number, Record<number, string>>;
type CellResult = "saved" | "failed" | undefined;

type DiffState = {
  diff: FarmOutTimetableUploadDiff;
  applying: boolean;
  error: string | null;
} | null;

/**
 * Settings → Farm out Timetable（任务包第 7 / 9 / 14 / 14a 条）：每家公司自己的一套上车点 × 团 →
 * 发车时间；集合时间 = 发车时间 − 10 分钟，只在页面上算出来给人看，不存（真正给 Dispatch 用的
 * 由后端算，见 types/farm-out.ts FarmOutOrderDetail 的注释）。上传 CSV / xlsx 先出 diff 再 Apply。
 */
export function TimetableSettingsView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(
    null,
  );
  const [drafts, setDrafts] = useState<Drafts>({});
  const [cellResults, setCellResults] = useState<
    Record<string, CellResult>
  >({});
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [diffState, setDiffState] = useState<DiffState>(null);
  const [addSpotName, setAddSpotName] = useState("");
  const [addSpotBusy, setAddSpotBusy] = useState(false);
  const [addSpotError, setAddSpotError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FarmOutPickupSpot | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  const applyLoadError = useCallback(
    (error: unknown) => {
      if (isStatus(error, 401)) redirectToLogin();
      else if (isStatus(error, 403)) setView({ kind: "forbidden" });
      else setView({ kind: "error", message: describeError(error) });
    },
    [redirectToLogin],
  );

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setView({ kind: "loading" });
    (async () => {
      try {
        const me = await fetchCurrentUser(signal);
        if (signal.aborted) return;
        if (!me.is_admin) {
          setView({ kind: "forbidden" });
          return;
        }
        const timetable = await fetchFarmOutTimetable(signal);
        if (signal.aborted) return;
        setView({ kind: "ready", timetable });
        setSelectedPartnerId((prev) =>
          prev && timetable.partners.some((p) => p.id === prev)
            ? prev
            : timetable.partners[0]?.id ?? null,
        );
      } catch (error) {
        if (!signal.aborted) applyLoadError(error);
      }
    })();
    return () => controller.abort();
  }, [reloadKey, applyLoadError]);

  const timetable = view.kind === "ready" ? view.timetable : null;

  const spotsForPartner = useMemo(
    () =>
      timetable
        ? timetable.spots.filter((s) => s.partner_id === selectedPartnerId)
        : [],
    [timetable, selectedPartnerId],
  );

  /** 只在明确的时刻重建草稿（切公司 / 加删点 / Apply 成功），不要在逐格保存后整页重建（会把还没存成功的格子冲掉）。 */
  const resetDrafts = useCallback(
    (table: FarmOutTimetable, partnerId: number | null) => {
      const spots = table.spots.filter((s) => s.partner_id === partnerId);
      const next: Drafts = {};
      for (const s of spots) {
        const row: Record<number, string> = {};
        for (const t of table.tours) row[t.manifest_id] = s.departures[t.manifest_id] ?? "";
        next[s.id] = row;
      }
      setDrafts(next);
      setCellResults({});
      setCellErrors({});
    },
    [],
  );

  // 初次加载 / 切换公司：按新公司的数据重建草稿。
  useEffect(() => {
    if (timetable && selectedPartnerId !== null) {
      resetDrafts(timetable, selectedPartnerId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在切公司或初次拿到数据时重建，逐格保存不应该触发
  }, [selectedPartnerId, timetable === null]);

  async function refresh(): Promise<FarmOutTimetable | null> {
    try {
      const t = await fetchFarmOutTimetable();
      setView({ kind: "ready", timetable: t });
      return t;
    } catch (error) {
      applyLoadError(error);
      return null;
    }
  }

  function patchSpots(updater: (spots: FarmOutPickupSpot[]) => FarmOutPickupSpot[]) {
    setView((prev) =>
      prev.kind === "ready"
        ? { ...prev, timetable: { ...prev.timetable, spots: updater(prev.timetable.spots) } }
        : prev,
    );
  }

  function patchTourMeta(manifestId: number, patch: { return_time: string | null; please_note: string }) {
    setView((prev) => {
      if (prev.kind !== "ready") return prev;
      const existing = prev.timetable.tour_meta.find((m) => m.manifest_id === manifestId);
      const tourName =
        existing?.tour_name ??
        prev.timetable.tours.find((t) => t.manifest_id === manifestId)?.tour_name ??
        "";
      const rest = prev.timetable.tour_meta.filter((m) => m.manifest_id !== manifestId);
      return {
        ...prev,
        timetable: {
          ...prev.timetable,
          tour_meta: [
            ...rest,
            { manifest_id: manifestId, tour_name: tourName, ...patch },
          ],
        },
      };
    });
  }

  function dirtyCount(): number {
    if (!timetable) return 0;
    let n = 0;
    for (const spot of spotsForPartner) {
      const row = drafts[spot.id];
      if (!row) continue;
      for (const t of timetable.tours) {
        if ((row[t.manifest_id] ?? "") !== (spot.departures[t.manifest_id] ?? "")) n++;
      }
    }
    return n;
  }

  async function saveAll() {
    if (!timetable || saving) return;
    setSaving(true);
    setSaveMessage(null);
    let okCount = 0;
    let failCount = 0;
    for (const spot of spotsForPartner) {
      const row = drafts[spot.id];
      if (!row) continue;
      for (const t of timetable.tours) {
        const value = row[t.manifest_id] ?? "";
        const before = spot.departures[t.manifest_id] ?? "";
        if (value === before) continue;
        const key = `${spot.id}:${t.manifest_id}`;
        try {
          await saveFarmOutDeparture(spot.id, t.manifest_id, value);
          patchSpots((spots) =>
            spots.map((s) => {
              if (s.id !== spot.id) return s;
              const departures = { ...s.departures };
              if (value === "") delete departures[t.manifest_id];
              else departures[t.manifest_id] = value;
              return { ...s, departures };
            }),
          );
          setCellResults((r) => ({ ...r, [key]: "saved" }));
          okCount++;
        } catch (error) {
          if (isStatus(error, 401)) {
            redirectToLogin();
            return;
          }
          setCellResults((r) => ({ ...r, [key]: "failed" }));
          setCellErrors((e) => ({ ...e, [key]: describeError(error) }));
          failCount++;
        }
      }
    }
    setSaving(false);
    setSaveMessage(
      failCount
        ? `Saved ${okCount}, ${failCount} failed — see the red cells below.`
        : okCount
          ? `✓ Saved ${okCount} ${okCount === 1 ? "time" : "times"}.`
          : "Nothing to save.",
    );
  }

  async function addSpot() {
    if (!timetable || selectedPartnerId === null || addSpotBusy) return;
    const name = addSpotName.trim();
    if (!name) {
      setAddSpotError("Hotel · Spot name is required.");
      return;
    }
    setAddSpotBusy(true);
    setAddSpotError(null);
    try {
      await createFarmOutSpot(selectedPartnerId, name);
      setAddSpotName("");
      const t = await refresh();
      if (t) resetDrafts(t, selectedPartnerId);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setAddSpotError(describeError(error));
    } finally {
      setAddSpotBusy(false);
    }
  }

  async function confirmDeleteSpot(spot: FarmOutPickupSpot) {
    try {
      await deleteFarmOutSpot(spot.id);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" as const };
      }
      return { status: "error" as const, message: describeError(error) };
    }
    setDeleteTarget(null);
    const t = await refresh();
    if (t) resetDrafts(t, selectedPartnerId);
    return { status: "ok" as const };
  }

  async function saveSpotName(spot: FarmOutPickupSpot, name: string) {
    await saveFarmOutSpot(spot.id, {
      name,
      address: spot.address,
      map_link: spot.map_link,
    });
    patchSpots((spots) => spots.map((s) => (s.id === spot.id ? { ...s, name } : s)));
  }

  async function onFile(file: File) {
    if (selectedPartnerId === null) return;
    setSaveMessage("Reading the uploaded file…");
    try {
      const diff = await uploadFarmOutTimetable(selectedPartnerId, file);
      setDiffState({ diff, applying: false, error: null });
      setSaveMessage(null);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setDiffState(null);
      setSaveMessage(`Upload failed: ${describeError(error)}`);
    }
  }

  async function applyDiff() {
    if (!diffState?.diff || selectedPartnerId === null) return;
    setDiffState({ ...diffState, applying: true, error: null });
    try {
      await applyFarmOutTimetable(selectedPartnerId, diffState.diff.parsed);
      setDiffState(null);
      const t = await refresh();
      if (t) resetDrafts(t, selectedPartnerId);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setDiffState((prev) => (prev ? { ...prev, applying: false, error: describeError(error) } : prev));
    }
  }

  function discardDiff() {
    setDiffState(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function downloadCsv() {
    if (!timetable) return;
    const partner = timetable.partners.find((p) => p.id === selectedPartnerId);
    const csv = buildTimetableCsv(timetable.tours, spotsForPartner);
    downloadTextFile(
      `farm-out-timetable-${safeFileSegment(partner?.name ?? "partner")}.csv`,
      csv,
    );
  }

  const partners = timetable?.partners ?? [];
  const tours = timetable?.tours ?? [];
  const selectedPartner = partners.find((p) => p.id === selectedPartnerId) ?? null;
  const dirty = dirtyCount();

  return (
    <main className="text-stone-800 night:text-white/90">
      <LegacyPageHeader
        title="🕖 Farm out Timetable"
        count={
          view.kind === "ready" && selectedPartner
            ? `${partners.length} ${partners.length === 1 ? "partner" : "partners"} · ${selectedPartner.name}: ${spotsForPartner.length} ${spotsForPartner.length === 1 ? "hotel" : "hotels"} × ${tours.length} ${tours.length === 1 ? "tour" : "tours"}`
            : null
        }
      />

      {view.kind === "forbidden" ? (
        <Panel>
          <p className="font-medium text-stone-800 night:text-white/90">
            Admin access required
          </p>
          <p className="mt-1">Only admins can change the Farm out timetable.</p>
        </Panel>
      ) : view.kind === "error" ? (
        <ErrorBanner
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Could not load the Farm out timetable: {view.message}
        </ErrorBanner>
      ) : view.kind === "loading" || !timetable ? (
        <Panel>Loading…</Panel>
      ) : partners.length === 0 ? (
        <Panel>
          No Farm out partners yet. Add one on the Farm out Partners settings
          page first.
        </Panel>
      ) : (
        <>
          <HowToUse />

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#f8fafc]">
              <span className="font-medium">Partner</span>
              <select
                aria-label="Partner"
                value={selectedPartnerId ?? ""}
                onChange={(e) => setSelectedPartnerId(Number(e.target.value))}
                className="rounded-[6px] border-[0.5px] border-white/20 bg-[#0c1b2e] px-2.5 py-1.5 text-[12px] text-[#f8fafc] focus:outline-none"
              >
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="text-[#aaa] night:text-white/35">
                Departure times · check-in = 10 min earlier
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={downloadCsv} className={BTN_EDIT_CLASS}>
                ⬇ Download as CSV
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={BTN_EDIT_CLASS}
              >
                ⬆ Upload CSV / xlsx
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx"
                aria-label="Timetable file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFile(file);
                }}
              />
              <button
                type="button"
                aria-label="Save timetable changes"
                disabled={saving || dirty === 0}
                onClick={() => void saveAll()}
                className={BTN_ADD_CLASS}
              >
                {saving ? "Saving…" : dirty ? `Save (${dirty})` : "Save"}
              </button>
            </div>
          </div>

          {saveMessage ? (
            <p className={cn(resultClass(dirty || saving ? null : "ok"), "mb-3")}>
              {saveMessage}
            </p>
          ) : null}

          {diffState?.diff && selectedPartner ? (
            <TimetableDiffBanner
              diff={diffState.diff}
              tours={tours}
              partnerName={selectedPartner.name}
              applying={diffState.applying}
              error={diffState.error}
              onApply={() => void applyDiff()}
              onDiscard={discardDiff}
            />
          ) : null}

          <section className={CARD_CLASS}>
            <div className={CARD_HEADER_CLASS}>
              <span className={CARD_TITLE_CLASS}>
                {selectedPartner?.name ?? "Partner"}&rsquo;s pickup spots
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th className={cn(TH_CLASS, "min-w-[180px]")}>Hotel · Spot</th>
                    {tours.map((t) => (
                      <th key={t.manifest_id} className={cn(TH_CLASS, "min-w-[110px]")}>
                        {t.tour_name}
                      </th>
                    ))}
                    <th className={cn(TH_CLASS, "w-[80px]")}>Actions</th>
                  </tr>
                </thead>
                <tbody className={TBODY_CLASS}>
                  {spotsForPartner.length === 0 ? (
                    <tr>
                      <td
                        colSpan={tours.length + 2}
                        className="p-5 text-center text-[#1a1a1a] night:text-white/35"
                      >
                        No pickup spots yet for this partner.
                      </td>
                    </tr>
                  ) : (
                    spotsForPartner.map((spot) => (
                      <SpotRow
                        key={spot.id}
                        spot={spot}
                        tours={tours}
                        draft={drafts[spot.id] ?? {}}
                        cellResults={cellResults}
                        cellErrors={cellErrors}
                        onDraftChange={(manifestId, value) =>
                          setDrafts((d) => ({
                            ...d,
                            [spot.id]: { ...(d[spot.id] ?? {}), [manifestId]: value },
                          }))
                        }
                        onRename={(name) => void saveSpotName(spot, name)}
                        onDelete={() => setDeleteTarget(spot)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void addSpot();
              }}
              className="flex flex-wrap items-end gap-3 border-t-[0.5px] border-black/[.08] px-4 py-3 night:border-white/10"
            >
              <label className="flex min-w-0 flex-col gap-[5px]">
                <span className="text-[12px] font-medium text-[#1a1a1a] night:text-white/55">
                  Add pickup spot
                </span>
                <input
                  aria-label="New Hotel · Spot name"
                  value={addSpotName}
                  maxLength={120}
                  placeholder="e.g. Plaza Hotel · Ride Share Area"
                  disabled={addSpotBusy}
                  onChange={(e) => setAddSpotName(e.target.value)}
                  className={cn(FORM_INPUT_CLASS, "w-[280px]")}
                />
              </label>
              <button type="submit" disabled={addSpotBusy} className={BTN_ADD_CLASS}>
                {addSpotBusy ? "Adding…" : "+ Add"}
              </button>
              {addSpotError ? (
                <span role="alert" className={resultClass("error")}>
                  {addSpotError}
                </span>
              ) : null}
            </form>
          </section>

          <TimetableTourMetaGrid
            tours={tours}
            tourMeta={timetable.tour_meta}
            onUnauthorized={redirectToLogin}
            onSave={async (manifestId, patch) => {
              try {
                await saveFarmOutTourMeta(manifestId, patch);
                patchTourMeta(manifestId, patch);
                return { status: "ok" };
              } catch (error) {
                if (isStatus(error, 401)) return { status: "redirecting" };
                return { status: "error", message: describeError(error) };
              }
            }}
          />
        </>
      )}

      {deleteTarget ? (
        <ConfirmDialog
          title={`Delete "${deleteTarget.name}"?`}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          danger
          onConfirm={() => confirmDeleteSpot(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        >
          <p>
            This removes the pickup spot and every departure time set for it,
            for this partner only.
          </p>
        </ConfirmDialog>
      ) : null}
    </main>
  );
}

function SpotRow({
  spot,
  tours,
  draft,
  cellResults,
  cellErrors,
  onDraftChange,
  onRename,
  onDelete,
}: {
  spot: FarmOutPickupSpot;
  tours: { manifest_id: number; tour_name: string }[];
  draft: Record<number, string>;
  cellResults: Record<string, CellResult>;
  cellErrors: Record<string, string>;
  onDraftChange: (manifestId: number, value: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(spot.name);
  useEffect(() => setName(spot.name), [spot.name]);

  return (
    <tr className={cn(TR_CLASS, TR_HOVER)}>
      <td className={TD_CLASS}>
        <input
          aria-label="Hotel · Spot name"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== spot.name) onRename(name.trim());
          }}
          className={cn(INLINE_INPUT_CLASS, "w-full")}
        />
      </td>
      {tours.map((t) => {
        const key = `${spot.id}:${t.manifest_id}`;
        const value = draft[t.manifest_id] ?? "";
        const result = cellResults[key];
        const checkin = value ? computeCheckin(value) : null;
        return (
          <td key={t.manifest_id} className={TD_CLASS}>
            <input
              aria-label={`${spot.name} — ${t.tour_name} departure`}
              value={value}
              placeholder="—"
              onChange={(e) => onDraftChange(t.manifest_id, e.target.value)}
              className={cn(
                INLINE_INPUT_CLASS,
                "w-[90px]",
                result === "failed" && "border-[#A32D2D] night:border-red-400/50",
                result === "saved" && "border-[#bbf7d0] night:border-emerald-400/30",
              )}
            />
            {checkin ? (
              <div className="mt-0.5 text-[10px] whitespace-nowrap text-[#1a1a1a] night:text-white/35">
                CI {checkin}
              </div>
            ) : null}
            {cellErrors[key] ? (
              <div role="alert" className="mt-0.5 text-[10px] text-[#A32D2D] night:text-red-300">
                {cellErrors[key]}
              </div>
            ) : null}
          </td>
        );
      })}
      <td className={TD_CLASS}>
        <button type="button" onClick={onDelete} className={BTN_DELETE_CLASS}>
          Delete
        </button>
      </td>
    </tr>
  );
}

function HowToUse() {
  return (
    <LegacyHowTo
      title="How to use — Farm out Timetable"
      padY="py-2.5"
      footer="A tour with no departure time set anywhere in this table cannot be farmed out yet (task packet #9) — set at least one hotel's time for it first."
    >
      <li>
        Pick a partner from the dropdown. Each partner has its own pickup
        spots and its own set of times.
      </li>
      <li>
        Type a time straight into a cell (for example 6:20 or 6:20 AM). CI
        under it is the check-in time shown to guests — departure minus 10
        minutes, worked out on this page for preview only. Click Save to
        store every changed cell; cells that fail to save turn red and keep
        your typed value so you can fix and retry.
      </li>
      <li>
        Add pickup spot: type a name at the bottom of the table and click +
        Add. Rename a spot by editing its name and clicking out of the box.
        Delete removes it and every time set for it, after you confirm.
      </li>
      <li>
        Download as CSV saves the table shown. Upload CSV / xlsx reads a file
        and shows what would change before anything is saved — review it,
        then Apply to replace this partner&rsquo;s whole table, or Discard to
        drop the file.
      </li>
      <li>
        Return time &amp; notices below apply to a tour across every partner.
        Leave PLEASE NOTE empty to hide that whole section from the guest
        notice.
      </li>
    </LegacyHowTo>
  );
}
