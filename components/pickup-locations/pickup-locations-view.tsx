"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  createPickupLocation,
  deletePickupLocation,
  fetchPickupLocations,
  fetchShuttleRoutes,
  fetchShuttleSeasons,
  setPickupLocationActive,
  setPickupLocationTourDeparture,
  updatePickupLocation,
} from "@/lib/pickup-locations-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import type { PickupLocation, ShuttleRoute, ShuttleSeason } from "@/types";

import { ActionLog } from "./action-log";
import {
  draftOf,
  emptyDraft,
  inputOf,
  type LocationDraft,
  matchesSearch,
} from "./config";
import {
  BTN_ADD_CLASS,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_TITLE_CLASS,
  LegacyHowTo,
  LegacyPageHeader,
  resultClass,
} from "./legacy-ui";
import { LocationFields } from "./location-fields";
import { LocationSections, type SavedNote } from "./location-sections";
import { TypeChecks } from "./location-type";
import { type EditState } from "./locations-table";
import { currentSeasons, routeNames, timesError } from "./shuttle-times";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; locations: PickupLocation[] };

type DialogState =
  | { kind: "deactivate"; loc: PickupLocation }
  | { kind: "delete"; loc: PickupLocation }
  | null;

type AddResult = { tone: "ok" | "error"; text: string } | null;

export function PickupLocationsView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [addDraft, setAddDraft] = useState<LocationDraft>(emptyDraft);
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<AddResult>(null);
  const [edits, setEdits] = useState<Record<number, EditState>>({});
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** 有改动成功就 +1：Action Log 据此重拉。 */
  const [logVersion, setLogVersion] = useState(0);
  // Shuttle 站的时间（preview v3）：全站共用的季节、线路下拉；后端还没有这组接口时是空的。
  const [seasons, setSeasons] = useState<ShuttleSeason[]>([]);
  const [routes, setRoutes] = useState<ShuttleRoute[]>([]);
  const [seasonsDirty, setSeasonsDirty] = useState(false);
  const [savedNote, setSavedNote] = useState<SavedNote>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirectingRef = useRef(false);
  const addOkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  const applyLoadError = useCallback(
    (error: unknown) => {
      if (isStatus(error, 401)) {
        redirectToLogin();
      } else if (isStatus(error, 403)) {
        setView({ kind: "forbidden" });
      } else {
        setView({ kind: "error", message: describeError(error) });
      }
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
        // 只有 admin 能管接客点（后端也会 403）。
        if (!me.is_admin) {
          setView({ kind: "forbidden" });
          return;
        }
        const locations = await fetchPickupLocations(signal);
        if (!signal.aborted) {
          setView({ kind: "ready", locations });
        }
        // 后端有类别了才去读季节、线路；读不到（还没上线 / 出错）就当没有，页面照样能用。
        if (locations.some((l) => l.is_tour_bus !== undefined)) {
          const [s, r] = await Promise.all([
            fetchShuttleSeasons(signal).catch(() => [] as ShuttleSeason[]),
            fetchShuttleRoutes(signal).catch(() => [] as ShuttleRoute[]),
          ]);
          if (!signal.aborted) {
            setSeasons(s);
            setRoutes(r);
          }
        }
      } catch (error) {
        if (!signal.aborted) {
          applyLoadError(error);
        }
      }
    })();
    return () => controller.abort();
  }, [reloadKey, applyLoadError]);

  useEffect(
    () => () => {
      if (addOkTimerRef.current) clearTimeout(addOkTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    },
    [],
  );

  /** 改动成功后重拉列表（不闪整页 Loading），Action Log 作废。 */
  async function refresh() {
    setLogVersion((v) => v + 1);
    try {
      const locations = await fetchPickupLocations();
      setView({ kind: "ready", locations });
    } catch (error) {
      applyLoadError(error);
    }
  }

  async function addLocation() {
    if (adding) return;
    const input = inputOf(addDraft, typesSupported);
    if (!input.hotel_name) {
      setAddResult({ tone: "error", text: "Hotel name is required." });
      return;
    }
    if (typesSupported && !addDraft.is_tour_bus && !addDraft.is_shuttle) {
      setAddResult({
        tone: "error",
        text: "Tick Tour bus pick-up, Shuttle stop, or both.",
      });
      return;
    }
    setAdding(true);
    setAddResult(null);
    try {
      await createPickupLocation(input);
      setAddDraft(emptyDraft());
      setAddResult({ tone: "ok", text: "✓ Added" });
      if (addOkTimerRef.current) clearTimeout(addOkTimerRef.current);
      addOkTimerRef.current = setTimeout(() => setAddResult(null), 3000);
      void refresh();
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setAddResult({ tone: "error", text: describeError(error) });
    } finally {
      setAdding(false);
    }
  }

  function startEdit(loc: PickupLocation) {
    setEdits((all) => ({
      ...all,
      [loc.id]: {
        draft: draftOf(loc),
        original: draftOf(loc),
        saving: false,
        error: null,
      },
    }));
  }

  /** 存好的一句绿字，几秒后收起。 */
  function showSaved(id: number, text: string) {
    setSavedNote({ id, text });
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedNote(null), 6000);
  }

  function closeEdit(id: number) {
    setEdits((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
  }

  async function saveEdit(id: number) {
    const edit = edits[id];
    if (!edit || edit.saving) return;
    const input = inputOf(edit.draft, typesSupported);
    // 页面上就看得出来的错：红字，不发请求，改动留着。
    const localError = !input.hotel_name
      ? "Hotel name is required."
      : typesSupported && !edit.draft.is_tour_bus && !edit.draft.is_shuttle
        ? "Tick Tour bus pick-up, Shuttle stop, or both."
        : typesSupported && edit.draft.is_shuttle
          ? timesError(
              edit.draft.times,
              currentSeasons(seasons),
              routeNames(routes, locations),
            )
          : null;
    if (localError) {
      setEdits((all) => ({
        ...all,
        [id]: { ...edit, error: `Could not save: ${localError}` },
      }));
      return;
    }
    setEdits((all) => ({
      ...all,
      [id]: { ...edit, saving: true, error: null },
    }));
    try {
      await updatePickupLocation(id, input);
      closeEdit(id);
      const n = input.times?.length ?? 0;
      showSaved(
        id,
        `✓ Saved ${input.hotel_name}${typesSupported && edit.draft.is_shuttle ? ` · ${n} ${n === 1 ? "time" : "times"}` : ""}`,
      );
      void refresh();
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setEdits((all) =>
        all[id]
          ? {
              ...all,
              [id]: {
                ...all[id],
                saving: false,
                // 一样都不存（后端整份一个事务），改动留着。
                error: `Could not save: ${describeError(error)} Nothing was saved.`,
              },
            }
          : all,
      );
    }
  }

  function toActionError(error: unknown): ActionResult {
    if (isStatus(error, 401)) {
      redirectToLogin();
      return { status: "redirecting" };
    }
    return { status: "error", message: describeError(error) };
  }

  async function setActive(
    loc: PickupLocation,
    active: boolean,
  ): Promise<ActionResult> {
    try {
      await setPickupLocationActive(loc.id, active);
    } catch (error) {
      return toActionError(error);
    }
    void refresh();
    return { status: "ok" };
  }

  /** 「Tour bus departure」：点了就存（同旧页面），失败写原因、勾还原（重拉后以服务端为准）。 */
  async function toggleTourDeparture(loc: PickupLocation, on: boolean) {
    setBusyId(loc.id);
    setActionError(null);
    try {
      await setPickupLocationTourDeparture(loc.id, on);
      // 存好了就先在页面上勾上（同旧页面），不等列表重拉。
      setView((v) =>
        v.kind === "ready"
          ? {
              kind: "ready",
              locations: v.locations.map((l) =>
                l.id === loc.id ? { ...l, is_tour_departure: on } : l,
              ),
            }
          : v,
      );
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setActionError(
        `Could not change Tour bus departure for ${loc.hotel_name}: ${describeError(error)}`,
      );
    } finally {
      setBusyId(null);
    }
    void refresh();
  }

  /** 恢复没有确认框（同旧页面）；停用要确认。 */
  async function toggleActive(loc: PickupLocation) {
    if (loc.is_active) {
      setDialog({ kind: "deactivate", loc });
      return;
    }
    setBusyId(loc.id);
    setActionError(null);
    const result = await setActive(loc, true);
    if (result.status === "error") {
      setActionError(
        `Could not reactivate ${loc.hotel_name}: ${result.message}`,
      );
    }
    setBusyId(null);
  }

  async function confirmDelete(loc: PickupLocation): Promise<ActionResult> {
    try {
      await deletePickupLocation(loc.id);
    } catch (error) {
      return toActionError(error);
    }
    setDialog(null);
    closeEdit(loc.id);
    void refresh();
    return { status: "ok" };
  }

  /** Needs a type 黄条：勾好按 Save（其余字段原样送，PUT 要传全）。 */
  async function classify(
    loc: PickupLocation,
    types: { is_tour_bus: boolean; is_shuttle: boolean },
  ): Promise<string | null> {
    try {
      await updatePickupLocation(
        loc.id,
        inputOf({ ...draftOf(loc), ...types }, true),
      );
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return null;
      }
      return `Could not save: ${describeError(error)}`;
    }
    showSaved(loc.id, `✓ Saved ${loc.hotel_name}`);
    void refresh();
    return null;
  }

  const locations = view.kind === "ready" ? view.locations : [];
  const visible = locations.filter((loc) => matchesSearch(loc, search));
  /** 后端已经有类别（GET 带 is_tour_bus）：分块、两个勾、时间。没有就照旧一张 All Locations。 */
  const typesSupported = locations.some((l) => l.is_tour_bus !== undefined);
  // 有没存的改动（打开的编辑行改过、季节改过）时离开页面先问（全站规矩）。
  const dirty =
    seasonsDirty ||
    Object.values(edits).some(
      (e) =>
        !!e.original && JSON.stringify(e.draft) !== JSON.stringify(e.original),
    );
  useLeaveGuard(
    dirty,
    "You have unsaved changes on this page. Leave without saving?",
  );

  return (
    <main className="text-stone-800 night:text-white/90">
      <LegacyPageHeader
        title="📍 Pickup Locations"
        count={
          view.kind === "ready"
            ? `${locations.length} ${locations.length === 1 ? "location" : "locations"}`
            : null
        }
      />

      {view.kind === "forbidden" ? (
        <Panel>
          <p className="font-medium text-stone-800 night:text-white/90">
            Admin access required
          </p>
          <p className="mt-1">Only admins can change pickup locations.</p>
        </Panel>
      ) : view.kind === "error" ? (
        <ErrorBanner
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Could not load pickup locations: {view.message}
        </ErrorBanner>
      ) : (
        <>
          <HowToUse />

          <section className={CARD_CLASS}>
            <div className={CARD_HEADER_CLASS}>
              <h2 className={CARD_TITLE_CLASS}>+ Add New Location</h2>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void addLocation();
              }}
            >
              {/* .add-form：4 列（最后一列 auto），6 个格子 + Add 键依次排。 */}
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-3 px-5 py-[18px]">
                <LocationFields
                  draft={addDraft}
                  disabled={adding || view.kind !== "ready"}
                  onChange={setAddDraft}
                  idPrefix="new"
                />
                {typesSupported ? (
                  // 类别：至少勾一个（v3 ④）。Shuttle 站的时间加好以后用 Edit 填。
                  <div
                    data-add-type
                    className="col-span-3 flex flex-wrap items-center gap-x-3 gap-y-1"
                  >
                    <span className="text-[13px] font-medium text-[#1a1a1a] night:text-white/80">
                      Type *
                    </span>
                    <TypeChecks
                      idPrefix="new"
                      tourBus={addDraft.is_tour_bus}
                      shuttle={addDraft.is_shuttle}
                      disabled={adding}
                      onChange={(t) => setAddDraft((d) => ({ ...d, ...t }))}
                    />
                    {addDraft.is_shuttle ? (
                      <span className="text-[12px] text-[#6b7280] night:text-white/45">
                        Shuttle stop: add its times with Edit after you add it.
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <button
                  type="submit"
                  disabled={adding || view.kind !== "ready"}
                  className={BTN_ADD_CLASS}
                >
                  {adding ? "Adding…" : "Add"}
                </button>
              </div>
              <div className="px-5 pb-3">
                {addResult ? (
                  <span
                    role={addResult.tone === "error" ? "alert" : "status"}
                    className={cn(resultClass(addResult.tone), "ml-2.5")}
                  >
                    {addResult.text}
                  </span>
                ) : null}
              </div>
            </form>
          </section>

          {actionError ? (
            <div className="mb-5">
              <ErrorBanner
                actionLabel="Dismiss"
                onAction={() => setActionError(null)}
              >
                {actionError}
              </ErrorBanner>
            </div>
          ) : null}

          <LocationSections
            locations={locations}
            visible={visible}
            search={search}
            onSearch={setSearch}
            loading={view.kind === "loading"}
            edits={edits}
            busyId={busyId}
            onEdit={startEdit}
            onDraftChange={(id, draft: LocationDraft) =>
              setEdits((all) =>
                all[id] ? { ...all, [id]: { ...all[id], draft } } : all,
              )
            }
            onSave={(id) => void saveEdit(id)}
            onCancel={closeEdit}
            onToggleActive={(loc) => void toggleActive(loc)}
            onTourDeparture={(loc, on) => void toggleTourDeparture(loc, on)}
            onDelete={(loc) => setDialog({ kind: "delete", loc })}
            typesSupported={typesSupported}
            seasons={seasons}
            routes={routes}
            onSeasonsSaved={(s) => {
              setSeasons(s);
              setLogVersion((v) => v + 1);
            }}
            onSeasonsDirty={setSeasonsDirty}
            onClassify={classify}
            savedNote={savedNote}
            onUnauthorized={redirectToLogin}
          />

          {view.kind === "ready" ? (
            <ActionLog version={logVersion} onUnauthorized={redirectToLogin} />
          ) : null}
        </>
      )}

      {dialog?.kind === "deactivate" ? (
        <ConfirmDialog
          title={`Deactivate "${dialog.loc.hotel_name}"?`}
          confirmLabel="Deactivate"
          busyLabel="Deactivating…"
          onConfirm={async () => {
            const result = await setActive(dialog.loc, false);
            if (result.status === "ok") setDialog(null);
            return result;
          }}
          onClose={() => setDialog(null)}
        >
          <p>
            It stops appearing when you add hotels in Dispatch. Days already
            scheduled keep it, and guests who already have it keep their pickup
            details. You can reactivate it here at any time.
          </p>
        </ConfirmDialog>
      ) : null}

      {dialog?.kind === "delete" ? (
        <ConfirmDialog
          title={`Delete "${dialog.loc.hotel_name}"?`}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          danger
          onConfirm={() => confirmDelete(dialog.loc)}
          onClose={() => setDialog(null)}
        >
          <p>
            This removes it for good. Guests whose order uses this hotel will no
            longer get its pickup details, and it is taken out of tour default
            stops in Dispatch.
          </p>
          <p>
            If you only want to stop using it, close this and click{" "}
            <b>Deactivate</b> instead.
          </p>
        </ConfirmDialog>
      ) : null}
    </main>
  );
}

function HowToUse() {
  return (
    <LegacyHowTo
      title="How to use — Pickup Locations"
      padY="py-2.5"
      footer="If a save does not work, a message says why (for example Short is too long, or an alias already belongs to another hotel). Nothing is changed."
    >
      <li>
        Add a hotel: fill in Hotel Name (the only box you must fill) and
        whatever else you have, tick Tour bus pick-up, Shuttle stop, or both,
        then click Add. &ldquo;✓ Added&rdquo; shows under the form and the hotel
        appears in the list.
      </li>
      <li>
        The list has two blocks: Tour bus and Shuttle. A place that is both
        shows in both blocks, marked &ldquo;also Shuttle&rdquo; or &ldquo;also
        Tour bus&rdquo;. One search box covers both.
      </li>
      <li>
        Needs a type: a yellow bar lists places with neither box ticked. Tick
        Tour bus, Shuttle, or both on each one, then Save.
      </li>
      <li>
        Shuttle block: pick a season with the season buttons (today&rsquo;s
        season is picked first and marked today). The Times column shows that
        season&rsquo;s times, &ldquo;no service&rdquo;, or &ldquo;no time
        yet&rdquo;. A yellow tag means another season is still missing a time.
      </li>
      <li>
        Shuttle times: click ✏ Edit on a stop. Under the name, each route has
        one box per season: a time, No service, or empty. Click + Add time for
        another route or run. Changes say &ldquo;Not saved yet&rdquo; until you
        click Save on that row.
      </li>
      <li>
        Edit seasons: name each season with its From and To dates. Seasons
        can&rsquo;t overlap. A gap after the last season is shown in yellow but
        you can still save. Copy to next year adds next year&rsquo;s seasons
        with the same dates. A season that a stop still uses can&rsquo;t be
        deleted.
      </li>
      <li>
        If you leave the page with unsaved changes (a row or the seasons), you
        are asked first.
      </li>
      <li>
        Photo URL is a web page the guest clicks. Map image is the picture
        itself, shown in the email and on the guest page. Click ＋ to add a
        second picture.
      </li>
      <li>
        Short (for SMS) goes in text messages. Details goes in the email, on the
        guest page, and to the AI Agent. They are separate, so fill in both.
      </li>
      <li>
        Change a hotel: click ✏ Edit, change the boxes, then Save. Cancel closes
        that row without saving. You can have several rows open and search while
        you edit; what you typed stays until you save or cancel.
      </li>
      <li>
        Deactivate: the hotel stops appearing when you add hotels in Dispatch.
        Days already scheduled and guests who already have it are not affected.
        Reactivate brings it back. Delete removes it for good, and is refused
        while the hotel is still used in Dispatch.
      </li>
      <li>
        Tour bus departure (only in the Tour bus block): tick it for a place
        where guests board the tour bus directly (Treasure Island). Guests
        picked up there are left out when you click Pull from manifests in
        Dispatch. It saves as soon as you click.
      </li>
      <li>
        If the list is wider than the window, scroll it sideways to see the
        columns on the right.
      </li>
      <li>
        Click ⬇ Export to download the active hotels as a CSV, all fields
        included (opens in Excel).
      </li>
    </LegacyHowTo>
  );
}
