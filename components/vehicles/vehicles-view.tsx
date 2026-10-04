"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import {
  createVehicle,
  fetchVehicles,
  NOTES_MAX,
  normalizeVanNo,
  SAMSARA_PREFIX,
  setVehicleActive,
  updateVehicle,
  VAN_NO_MAX,
} from "@/lib/vehicles-api";
import type { Vehicle, VehicleInput } from "@/types";

import { VehicleLog } from "./vehicle-log";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; vehicles: Vehicle[] };

interface Draft {
  van_no: string;
  samsara_url: string;
  seats: string;
  notes: string;
}

interface EditState {
  draft: Draft;
  saving: boolean;
  error: string | null;
}

const EMPTY_DRAFT: Draft = {
  van_no: "",
  samsara_url: "",
  seats: "",
  notes: "",
};

function draftOf(v: Vehicle): Draft {
  return {
    van_no: v.van_no,
    samsara_url: v.samsara_url,
    seats: v.seats == null ? "" : String(v.seats),
    notes: v.notes,
  };
}

const INPUT_CLASS =
  "w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none disabled:bg-stone-50";

export function VehiclesView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [edits, setEdits] = useState<Record<number, EditState>>({});
  const [rename, setRename] = useState<{
    vehicle: Vehicle;
    newNo: string;
  } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logVersion, setLogVersion] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

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
        const vehicles = await fetchVehicles(signal);
        if (!signal.aborted) setView({ kind: "ready", vehicles });
      } catch (error) {
        if (signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setView({ kind: "forbidden" });
        else setView({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  async function refresh() {
    setLogVersion((v) => v + 1);
    try {
      const vehicles = await fetchVehicles();
      setView({ kind: "ready", vehicles });
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setActionError(`Could not reload the list: ${describeError(error)}`);
    }
  }

  function messageOf(error: unknown): string {
    return error instanceof TypeError
      ? "Could not reach the server. Check your connection and try again - nothing was changed."
      : describeError(error);
  }

  async function addVehicle() {
    if (adding) return;
    setAdding(true);
    setAddResult(null);
    try {
      const v = await createVehicle(addDraft);
      setAddDraft(EMPTY_DRAFT);
      setAddResult({
        tone: "ok",
        text: `✓ Added vehicle ${v.van_no}. It is now in the Dispatch vehicle list.`,
      });
      void refresh();
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setAddResult({ tone: "error", text: messageOf(error) });
    } finally {
      setAdding(false);
    }
  }

  function setEdit(id: number, patch: Partial<EditState> | null) {
    setEdits((all) => {
      const next = { ...all };
      if (patch === null) delete next[id];
      else if (next[id]) next[id] = { ...next[id], ...patch };
      return next;
    });
  }

  async function doSave(
    v: Vehicle,
    confirmRename: boolean,
  ): Promise<ActionResult> {
    const edit = edits[v.id];
    if (!edit) return { status: "ok" };
    setEdit(v.id, { saving: true, error: null });
    const input: VehicleInput = { ...edit.draft };
    if (confirmRename) input.confirm_rename = true;
    try {
      await updateVehicle(v.id, input);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      const message = messageOf(error);
      setEdit(v.id, { saving: false, error: message });
      // 改号确认框里也显示一样的原因。
      return { status: "error", message };
    }
    setEdit(v.id, null);
    setRename(null);
    void refresh();
    return { status: "ok" };
  }

  function save(v: Vehicle) {
    const edit = edits[v.id];
    if (!edit || edit.saving) return;
    const newNo = normalizeVanNo(edit.draft.van_no);
    // 改车号先提醒（Annie 2026-10-01：「让改，弹提醒」）；后端也要求带 confirm_rename。
    if (newNo && newNo !== v.van_no) {
      setRename({ vehicle: v, newNo });
      return;
    }
    void doSave(v, false);
  }

  async function toggleActive(v: Vehicle) {
    setBusyId(v.id);
    setActionError(null);
    try {
      await setVehicleActive(v.id, !v.is_active);
      await refresh();
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setActionError(
        `Could not ${v.is_active ? "deactivate" : "reactivate"} ${v.van_no}: ${messageOf(error)}`,
      );
    } finally {
      setBusyId(null);
    }
  }

  const vehicles = view.kind === "ready" ? view.vehicles : [];
  const q = search.trim().toLowerCase();
  // 正在编辑的行不被搜索藏掉（同旧页面）。
  const visible = vehicles.filter(
    (v) =>
      edits[v.id] || !q || `${v.van_no} ${v.notes}`.toLowerCase().includes(q),
  );
  const activeCount = vehicles.filter((v) => v.is_active).length;

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1300px] flex-col gap-5 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
              Settings
            </span>
            <h1 className="text-2xl font-semibold text-stone-900">
              🚐 Vehicles
            </h1>
          </div>
          {view.kind === "ready" ? (
            <span className="text-sm text-stone-500">
              {vehicles.length} vehicles · {activeCount} active
            </span>
          ) : null}
        </header>

        {view.kind === "forbidden" ? (
          <Panel>
            <p className="font-medium text-stone-800">Admin access required</p>
            <p className="mt-1">Only admins can change the vehicle list.</p>
          </Panel>
        ) : view.kind === "error" ? (
          <ErrorBanner
            actionLabel="Retry"
            onAction={() => setReloadKey((k) => k + 1)}
          >
            Could not load vehicles: {view.message}
          </ErrorBanner>
        ) : (
          <>
            <HowToUse />

            <section className="rounded-lg border border-stone-200 bg-white px-4 py-4">
              <h2 className="mb-3 text-sm font-semibold text-stone-900">
                + Add Vehicle
              </h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void addVehicle();
                }}
                className="flex flex-wrap items-start gap-3"
              >
                <Field label="Vehicle number *" className="w-40">
                  <input
                    value={addDraft.van_no}
                    maxLength={VAN_NO_MAX}
                    placeholder="e.g. 2657"
                    autoComplete="off"
                    disabled={adding}
                    onChange={(e) =>
                      setAddDraft({ ...addDraft, van_no: e.target.value })
                    }
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field
                  label="Samsara live-location link"
                  hint={`Starts with ${SAMSARA_PREFIX} — leave empty if this vehicle has no GPS.`}
                  className="min-w-[260px] flex-1"
                >
                  <input
                    value={addDraft.samsara_url}
                    placeholder={`${SAMSARA_PREFIX}o/...`}
                    autoComplete="off"
                    disabled={adding}
                    onChange={(e) =>
                      setAddDraft({ ...addDraft, samsara_url: e.target.value })
                    }
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field
                  label="Seats"
                  hint="Printed at the bottom of the bus manifest."
                  className="w-28"
                >
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={addDraft.seats}
                    placeholder="e.g. 54"
                    disabled={adding}
                    onChange={(e) =>
                      setAddDraft({ ...addDraft, seats: e.target.value })
                    }
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field label="Note" className="min-w-[200px] flex-1">
                  <input
                    value={addDraft.notes}
                    maxLength={NOTES_MAX}
                    placeholder="Optional"
                    autoComplete="off"
                    disabled={adding}
                    onChange={(e) =>
                      setAddDraft({ ...addDraft, notes: e.target.value })
                    }
                    className={INPUT_CLASS}
                  />
                </Field>
                <button
                  type="submit"
                  disabled={adding || view.kind !== "ready"}
                  className={cn(PRIMARY_BUTTON_CLASS, "mt-6")}
                >
                  {adding ? "Adding…" : "Add"}
                </button>
              </form>
              {addResult ? (
                <p
                  role={addResult.tone === "error" ? "alert" : "status"}
                  className={cn(
                    "mt-2 text-sm",
                    addResult.tone === "ok"
                      ? "font-semibold text-emerald-700"
                      : "text-red-700",
                  )}
                >
                  {addResult.text}
                </p>
              ) : null}
            </section>

            {actionError ? (
              <ErrorBanner
                actionLabel="Dismiss"
                onAction={() => setActionError(null)}
              >
                {actionError}
              </ErrorBanner>
            ) : null}

            <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-stone-900">
                  All Vehicles
                </h2>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  aria-label="Search vehicles"
                  className="w-48 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50 text-left text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
                      <th className="w-[13%] px-3 py-2.5">Vehicle</th>
                      <th className="w-[28%] px-3 py-2.5">Live GPS</th>
                      <th
                        className="w-[7%] px-3 py-2.5"
                        title="Printed at the bottom of the bus manifest"
                      >
                        Seats
                      </th>
                      <th className="w-[20%] px-3 py-2.5">Note</th>
                      <th
                        className="w-[10%] px-3 py-2.5"
                        title="How many days this vehicle has been scheduled in Dispatch"
                      >
                        In Dispatch
                      </th>
                      <th className="w-[8%] px-3 py-2.5">Status</th>
                      <th className="w-[14%] px-3 py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.kind === "loading" ? (
                      <EmptyRow text="Loading…" />
                    ) : visible.length === 0 ? (
                      <EmptyRow
                        text={
                          vehicles.length === 0
                            ? "No vehicles yet."
                            : "No vehicle matches the search."
                        }
                      />
                    ) : (
                      visible.map((v) => (
                        <VehicleRow
                          key={v.id}
                          vehicle={v}
                          edit={edits[v.id]}
                          busy={busyId === v.id}
                          onEdit={() =>
                            setEdits((all) => ({
                              ...all,
                              [v.id]: {
                                draft: draftOf(v),
                                saving: false,
                                error: null,
                              },
                            }))
                          }
                          onDraft={(draft) => setEdit(v.id, { draft })}
                          onSave={() => save(v)}
                          onCancel={() => setEdit(v.id, null)}
                          onToggle={() => void toggleActive(v)}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {view.kind === "ready" ? (
              <VehicleLog
                version={logVersion}
                onUnauthorized={redirectToLogin}
              />
            ) : null}
          </>
        )}
      </div>

      {rename ? (
        <ConfirmDialog
          title={`Change vehicle ${rename.vehicle.van_no} to ${rename.newNo}?`}
          confirmLabel="Change number"
          busyLabel="Saving…"
          onConfirm={() => doSave(rename.vehicle, true)}
          onClose={() => setRename(null)}
        >
          <p>
            Tracking links already sent to guests with {rename.vehicle.van_no}{" "}
            will no longer show the map. Use the new number in the morning list
            from now on.
          </p>
        </ConfirmDialog>
      ) : null}
    </main>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs font-medium text-stone-600">{label}</span>
      {children}
      {hint ? <span className="text-xs text-stone-500">{hint}</span> : null}
    </label>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <tr>
      <td colSpan={7} className="px-4 py-10 text-center text-stone-500">
        {text}
      </td>
    </tr>
  );
}

function VehicleRow({
  vehicle: v,
  edit,
  busy,
  onEdit,
  onDraft,
  onSave,
  onCancel,
  onToggle,
}: {
  vehicle: Vehicle;
  edit: EditState | undefined;
  busy: boolean;
  onEdit: () => void;
  onDraft: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  onToggle: () => void;
}) {
  const days = v.scheduled_days ? (
    `${v.scheduled_days} ${v.scheduled_days === 1 ? "day" : "days"}`
  ) : (
    <span className="text-stone-400">-</span>
  );
  const status = v.is_active ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
      Active
    </span>
  ) : (
    <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-600">
      Inactive
    </span>
  );
  const rowClass = cn(
    "border-b border-stone-100 align-top last:border-b-0",
    !v.is_active && "bg-stone-50 text-stone-500",
  );
  const small =
    "rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50";

  if (edit) {
    const d = edit.draft;
    return (
      <tr data-id={v.id} className={rowClass}>
        <td className="px-3 py-2">
          <input
            aria-label="Vehicle number"
            value={d.van_no}
            maxLength={VAN_NO_MAX}
            disabled={edit.saving}
            onChange={(e) => onDraft({ ...d, van_no: e.target.value })}
            className={INPUT_CLASS}
          />
        </td>
        <td className="px-3 py-2">
          <input
            aria-label="Samsara link"
            value={d.samsara_url}
            placeholder="Empty = no GPS"
            disabled={edit.saving}
            onChange={(e) => onDraft({ ...d, samsara_url: e.target.value })}
            className={INPUT_CLASS}
          />
        </td>
        <td className="px-3 py-2">
          <input
            aria-label="Seats"
            type="number"
            min={1}
            max={99}
            value={d.seats}
            disabled={edit.saving}
            onChange={(e) => onDraft({ ...d, seats: e.target.value })}
            className={INPUT_CLASS}
          />
        </td>
        <td className="px-3 py-2">
          <input
            aria-label="Note"
            value={d.notes}
            maxLength={NOTES_MAX}
            disabled={edit.saving}
            onChange={(e) => onDraft({ ...d, notes: e.target.value })}
            className={INPUT_CLASS}
          />
          {edit.error ? (
            <p role="alert" className="mt-1 text-xs text-red-700">
              {edit.error}
            </p>
          ) : null}
        </td>
        <td className="px-3 py-2.5">{days}</td>
        <td className="px-3 py-2.5">{status}</td>
        <td className="px-3 py-2">
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={edit.saving}
              onClick={onSave}
              className={cn(
                small,
                "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800",
              )}
            >
              {edit.saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={edit.saving}
              onClick={onCancel}
              className={cn(small, "border-stone-300 hover:bg-stone-50")}
            >
              Cancel
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr data-id={v.id} className={rowClass}>
      <td className="px-3 py-2.5 font-semibold text-stone-900">{v.van_no}</td>
      <td className="px-3 py-2.5">
        {v.samsara_url ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
              Live GPS
            </span>
            {/* 只有真正的 Samsara https 链接才做成可点的（后端也只收这种）。 */}
            {v.samsara_url.startsWith(SAMSARA_PREFIX) ? (
              <a
                href={v.samsara_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-sky-700 underline"
              >
                Open map
              </a>
            ) : null}
          </span>
        ) : (
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
            No GPS
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">
        {v.seats ?? <span className="text-stone-400">-</span>}
      </td>
      <td className="px-3 py-2.5 [overflow-wrap:anywhere]">
        {v.notes || <span className="text-stone-400">-</span>}
      </td>
      <td className="px-3 py-2.5">{days}</td>
      <td className="px-3 py-2.5">{status}</td>
      <td className="px-3 py-2">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className={cn(small, "border-stone-300 hover:bg-stone-50")}
          >
            Edit
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onToggle}
            className={cn(
              small,
              v.is_active
                ? "border-[#A32D2D] text-[#A32D2D] hover:bg-red-50"
                : "border-emerald-700 text-emerald-700 hover:bg-emerald-50",
            )}
          >
            {v.is_active ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      </td>
    </tr>
  );
}

function HowToUse() {
  return (
    <details className="rounded-lg border border-sky-200 bg-sky-50 px-5 py-4 text-sm leading-relaxed text-stone-700">
      <summary className="cursor-pointer font-semibold text-sky-900">
        📖 How to use — Vehicles
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Add a vehicle: type its number (the only box you must fill), paste its
          Samsara live-location link if it has GPS, then click Add. It appears
          in the list below and in the vehicle dropdown in Dispatch.
        </li>
        <li>
          The Samsara link is what guests see when they open their tracking
          link. Leave it empty for a vehicle with no GPS: guests then see the
          pickup details without a live map.
        </li>
        <li>
          Seats: the number of seats. It is printed as TOTAL # OF PAX at the
          bottom of the bus manifest, and the manifest works out the seats left
          from it. Leave it empty and those boxes show a dash.
        </li>
        <li>
          Change a vehicle: click Edit, change the boxes, then Save. Cancel
          closes that row without saving. Changing the number asks you to
          confirm first, because tracking links already sent with the old number
          will stop showing the map.
        </li>
        <li>
          Deactivate: the vehicle stops appearing in Dispatch. Days already
          scheduled with it stay as they are, and guests who already have its
          tracking link can still open the map. Reactivate brings it back.
          Vehicles are never deleted.
        </li>
        <li>
          If the list is wider than the window, scroll it sideways to see the
          columns on the right.
        </li>
      </ol>
      <p className="mt-3 border-t border-sky-200 pt-3">
        If a save does not work, a message says why (for example the number is
        already in the list, or the link is not a Samsara link). Nothing is
        changed.
      </p>
    </details>
  );
}
