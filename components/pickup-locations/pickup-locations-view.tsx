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
  setPickupLocationActive,
  setPickupLocationTourDeparture,
  updatePickupLocation,
} from "@/lib/pickup-locations-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { PickupLocation } from "@/types";

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
  HEADER_SEARCH_CLASS,
  LegacyHowTo,
  LegacyPageHeader,
  resultClass,
} from "./legacy-ui";
import { LocationFields } from "./location-fields";
import { type EditState, LocationsTable } from "./locations-table";

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
    const input = inputOf(addDraft);
    if (!input.hotel_name) {
      setAddResult({ tone: "error", text: "Hotel name is required." });
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
      [loc.id]: { draft: draftOf(loc), saving: false, error: null },
    }));
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
    const input = inputOf(edit.draft);
    if (!input.hotel_name) {
      setEdits((all) => ({
        ...all,
        [id]: { ...edit, error: "Hotel name is required." },
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
              [id]: { ...all[id], saving: false, error: describeError(error) },
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

  const locations = view.kind === "ready" ? view.locations : [];
  const visible = locations.filter((loc) => matchesSearch(loc, search));
  const placeholder =
    view.kind === "loading"
      ? "Loading…"
      : visible.length === 0
        ? "No locations found."
        : null;

  return (
    <main className="text-stone-800">
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
          <p className="font-medium text-stone-800">Admin access required</p>
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

          <section className={CARD_CLASS}>
            <div className={CARD_HEADER_CLASS}>
              <h2 className={CARD_TITLE_CLASS}>All Locations</h2>
              <div className="flex items-center gap-2.5">
                {search.trim() && view.kind === "ready" ? (
                  <span className="text-[11px] whitespace-nowrap text-[#999] tabular-nums">
                    {visible.length} of {locations.length}
                  </span>
                ) : null}
                <input
                  type="text"
                  inputMode="search"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Search"
                  value={search}
                  placeholder="Search…"
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && search) setSearch("");
                  }}
                  className={HEADER_SEARCH_CLASS}
                />
              </div>
            </div>
            <LocationsTable
              locations={visible}
              edits={edits}
              busyId={busyId}
              placeholder={placeholder}
              onEdit={startEdit}
              onDraftChange={(id, draft) =>
                setEdits((all) =>
                  all[id] ? { ...all, [id]: { ...all[id], draft } } : all,
                )
              }
              onSave={(id) => void saveEdit(id)}
              onCancel={closeEdit}
              onToggleActive={(loc) => void toggleActive(loc)}
              onTourDeparture={(loc, on) => void toggleTourDeparture(loc, on)}
              onDelete={(loc) => setDialog({ kind: "delete", loc })}
            />
          </section>

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
        whatever else you have, then click Add. &ldquo;✓ Added&rdquo; shows
        under the form and the hotel appears in All Locations.
      </li>
      <li>
        Photo URL is a web page the guest clicks. Map image is the picture
        itself, shown in the email and on the guest page. Click ＋ to add a
        second picture.
      </li>
      <li>
        Short (for SMS) goes in text messages. Details goes in the email and on
        the guest page. They are separate, so fill in both.
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
        Tour bus departure: tick it for a place where guests board the tour bus
        directly (Treasure Island). Guests picked up there are left out when you
        click Pull from manifests in Dispatch. It saves as soon as you click.
      </li>
      <li>
        If the list is wider than the window, scroll it sideways to see the
        columns on the right.
      </li>
    </LegacyHowTo>
  );
}
