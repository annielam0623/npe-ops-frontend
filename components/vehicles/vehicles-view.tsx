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
  bulkErrorsOf,
  createVehicle,
  CUSTOM_VALUE_MAX,
  fetchVehicles,
  NOTES_MAX,
  normalizeVanNo,
  SAMSARA_PREFIX,
  setVehicleActive,
  updateVehicle,
  updateVehicles,
  VAN_NO_MAX,
} from "@/lib/vehicles-api";
import type { Vehicle, VehicleColumn, VehicleInput } from "@/types";

import { ExtraColumns } from "./extra-columns";
import { VehicleLog } from "./vehicle-log";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; vehicles: Vehicle[]; columns: VehicleColumn[] };

interface Draft {
  van_no: string;
  samsara_url: string;
  seats: string;
  notes: string;
  /** 只放显示着的自加列（隐藏列不送：服务端「没送的列原样留着」）。 */
  custom: Record<string, string>;
}

interface EditState {
  draft: Draft;
  saving: boolean;
  error: string | null;
}

type Banner = { tone: "ok" | "error"; text: string } | null;

const EMPTY_DRAFT: Draft = {
  van_no: "",
  samsara_url: "",
  seats: "",
  notes: "",
  custom: {},
};

function draftOf(v: Vehicle, cols: VehicleColumn[]): Draft {
  const custom: Record<string, string> = {};
  for (const c of cols) custom[c.id] = v.custom[c.id] ?? "";
  return {
    van_no: v.van_no,
    samsara_url: v.samsara_url,
    seats: v.seats == null ? "" : String(v.seats),
    notes: v.notes,
    custom,
  };
}

const norm = (s: string | null | undefined) => String(s ?? "").trim();

/** 这一行改没改过（Save all 只送改过的；同旧页面）。 */
function changed(v: Vehicle, d: Draft): boolean {
  if (
    normalizeVanNo(d.van_no) !== v.van_no ||
    norm(d.samsara_url) !== v.samsara_url ||
    norm(d.seats) !== (v.seats == null ? "" : String(v.seats)) ||
    norm(d.notes) !== v.notes
  )
    return true;
  return Object.keys(d.custom).some(
    (k) => norm(d.custom[k]) !== (v.custom[k] ?? ""),
  );
}

function inputOf(d: Draft): VehicleInput {
  return {
    van_no: d.van_no,
    samsara_url: d.samsara_url,
    seats: d.seats,
    notes: d.notes,
    custom: d.custom,
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
  const [addResult, setAddResult] = useState<Banner>(null);
  const [edits, setEdits] = useState<Record<number, EditState>>({});
  /** Edit all：所有行都打开，存只有 Save all。 */
  const [bulk, setBulk] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkResult, setBulkResult] = useState<Banner>(null);
  const [rename, setRename] = useState<
    | { kind: "one"; vehicle: Vehicle; newNo: string }
    | { kind: "all"; list: string[]; rows: (VehicleInput & { id: number })[] }
    | null
  >(null);
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
        const data = await fetchVehicles(signal);
        if (!signal.aborted) setView({ kind: "ready", ...data });
      } catch (error) {
        if (signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setView({ kind: "forbidden" });
        else setView({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  const vehicles = view.kind === "ready" ? view.vehicles : [];
  const columns = view.kind === "ready" ? view.columns : [];
  const shownCols = columns.filter((c) => !c.is_hidden);

  async function refresh() {
    setLogVersion((v) => v + 1);
    try {
      const data = await fetchVehicles();
      setView({ kind: "ready", ...data });
      // 正在编辑的行补上新显示的列（加列 / Show 之后）。
      const shown = data.columns.filter((c) => !c.is_hidden);
      setEdits((all) => {
        const next: Record<number, EditState> = {};
        for (const [id, e] of Object.entries(all)) {
          const v = data.vehicles.find((x) => x.id === Number(id));
          if (!v) continue;
          const custom: Record<string, string> = {};
          for (const c of shown)
            custom[c.id] = e.draft.custom[c.id] ?? v.custom[c.id] ?? "";
          next[Number(id)] = { ...e, draft: { ...e.draft, custom } };
        }
        return next;
      });
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
      const v = await createVehicle({
        van_no: addDraft.van_no,
        samsara_url: addDraft.samsara_url,
        seats: addDraft.seats,
        notes: addDraft.notes,
      });
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
    const input = inputOf(edit.draft);
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
    // 改车号先提醒；后端也要求带 confirm_rename。
    if (newNo && newNo !== v.van_no) {
      setRename({ kind: "one", vehicle: v, newNo });
      return;
    }
    void doSave(v, false);
  }

  function startBulk() {
    setEdits((all) => {
      const next = { ...all };
      for (const v of vehicles) {
        if (!next[v.id])
          next[v.id] = {
            draft: draftOf(v, shownCols),
            saving: false,
            error: null,
          };
      }
      return next;
    });
    setBulk(true);
    setBulkResult(null);
  }

  function cancelBulk() {
    setEdits({});
    setBulk(false);
    setBulkResult(null);
  }

  function saveAll() {
    if (bulkSaving) return;
    const rows: (VehicleInput & { id: number })[] = [];
    const renames: string[] = [];
    setEdits((all) => {
      const next = { ...all };
      for (const id of Object.keys(next))
        next[Number(id)] = { ...next[Number(id)], error: null };
      return next;
    });
    for (const v of vehicles) {
      const e = edits[v.id];
      if (!e || !changed(v, e.draft)) continue;
      const row: VehicleInput & { id: number } = {
        ...inputOf(e.draft),
        id: v.id,
      };
      const newNo = normalizeVanNo(e.draft.van_no);
      if (newNo && newNo !== v.van_no) {
        renames.push(`${v.van_no} to ${newNo}`);
        row.confirm_rename = true;
      }
      rows.push(row);
    }
    if (!rows.length) {
      setEdits({});
      setBulk(false);
      setBulkResult({ tone: "ok", text: "Nothing was changed." });
      return;
    }
    if (renames.length) {
      setRename({ kind: "all", list: renames, rows });
      return;
    }
    void doSaveAll(rows);
  }

  async function doSaveAll(
    rows: (VehicleInput & { id: number })[],
  ): Promise<ActionResult> {
    setBulkSaving(true);
    setBulkResult(null);
    try {
      const saved = await updateVehicles(rows);
      setEdits({});
      setBulk(false);
      setRename(null);
      setBulkResult({
        tone: "ok",
        text: `✓ Saved ${saved} ${saved === 1 ? "vehicle" : "vehicles"}.`,
      });
      void refresh();
      return { status: "ok" };
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      setRename(null);
      const bulkErr = bulkErrorsOf(error);
      if (bulkErr) {
        // 出错的行标红、原因写在行里；搜索清掉，免得出错的行被藏起来。
        setEdits((all) => {
          const next = { ...all };
          for (const [id, msg] of Object.entries(bulkErr.errors)) {
            if (next[Number(id)])
              next[Number(id)] = { ...next[Number(id)], error: msg };
          }
          return next;
        });
        if (Object.keys(bulkErr.errors).length) setSearch("");
        setBulkResult({ tone: "error", text: bulkErr.message });
      } else {
        setBulkResult({
          tone: "error",
          text: `${messageOf(error)} Nothing was saved.`,
        });
      }
      return { status: "ok" };
    } finally {
      setBulkSaving(false);
    }
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

  const q = search.trim().toLowerCase();
  // 单台在编辑的行不被搜索藏掉（Edit all 时照常按搜索过滤，同旧页面）；搜索也搜自加列的内容。
  const visible = vehicles.filter((v) => {
    if (edits[v.id] && !bulk) return true;
    if (!q) return true;
    const hay = `${v.van_no} ${v.notes} ${Object.values(v.custom).join(" ")}`;
    return hay.toLowerCase().includes(q);
  });
  const activeCount = vehicles.filter((v) => v.is_active).length;
  const colCount = 7 + shownCols.length;

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-8 sm:px-6">
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

            {view.kind === "ready" ? (
              <ExtraColumns
                columns={columns}
                onChanged={() => refresh()}
                onUnauthorized={redirectToLogin}
              />
            ) : null}

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
                <div className="flex flex-wrap items-center gap-2">
                  {bulkResult ? (
                    <span
                      role={bulkResult.tone === "error" ? "alert" : "status"}
                      className={cn(
                        "text-xs font-medium",
                        bulkResult.tone === "ok"
                          ? "text-emerald-700"
                          : "text-[#A32D2D]",
                      )}
                    >
                      {bulkResult.text}
                    </span>
                  ) : null}
                  {bulk ? (
                    <>
                      <button
                        type="button"
                        disabled={bulkSaving}
                        onClick={saveAll}
                        className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                      >
                        {bulkSaving ? "Saving…" : "Save all"}
                      </button>
                      <button
                        type="button"
                        disabled={bulkSaving}
                        onClick={cancelBulk}
                        className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-medium hover:bg-stone-50"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={view.kind !== "ready" || !vehicles.length}
                      onClick={startBulk}
                      className="rounded-md border border-stone-300 px-3 py-1.5 text-xs font-medium hover:bg-stone-50 disabled:opacity-50"
                    >
                      Edit all
                    </button>
                  )}
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search…"
                    aria-label="Search vehicles"
                    className="w-48 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-50 text-left text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
                      <th className="w-[13%] px-3 py-2.5">Vehicle</th>
                      <th className="w-[24%] px-3 py-2.5">Live GPS</th>
                      <th
                        className="w-[7%] px-3 py-2.5"
                        title="Printed at the bottom of the bus manifest"
                      >
                        Seats
                      </th>
                      {shownCols.map((c) => (
                        <th key={c.id} className="min-w-[110px] px-3 py-2.5">
                          {c.label}
                        </th>
                      ))}
                      <th className="w-[18%] px-3 py-2.5">Note</th>
                      <th
                        className="w-[9%] px-3 py-2.5"
                        title="How many days this vehicle has been scheduled in Dispatch"
                      >
                        In Dispatch
                      </th>
                      <th className="w-[7%] px-3 py-2.5">Status</th>
                      <th className="w-[14%] px-3 py-2.5">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.kind === "loading" ? (
                      <EmptyRow cols={colCount} text="Loading…" />
                    ) : visible.length === 0 ? (
                      <EmptyRow
                        cols={colCount}
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
                          cols={shownCols}
                          edit={edits[v.id]}
                          bulk={bulk}
                          locked={bulkSaving}
                          busy={busyId === v.id}
                          onEdit={() =>
                            setEdits((all) => ({
                              ...all,
                              [v.id]: {
                                draft: draftOf(v, shownCols),
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
                columns={columns}
                onUnauthorized={redirectToLogin}
              />
            ) : null}
          </>
        )}
      </div>

      {rename?.kind === "one" ? (
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
      ) : rename?.kind === "all" ? (
        <ConfirmDialog
          title={`Change vehicle ${rename.list.join(", ")}?`}
          confirmLabel="Save all"
          busyLabel="Saving…"
          onConfirm={() => doSaveAll(rename.rows)}
          onClose={() => setRename(null)}
        >
          <p>
            Tracking links already sent to guests with the old numbers will no
            longer show the map. Use the new numbers in the morning list from
            now on.
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

function EmptyRow({ text, cols }: { text: string; cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-10 text-center text-stone-500">
        {text}
      </td>
    </tr>
  );
}

function VehicleRow({
  vehicle: v,
  cols,
  edit,
  bulk,
  locked,
  busy,
  onEdit,
  onDraft,
  onSave,
  onCancel,
  onToggle,
}: {
  vehicle: Vehicle;
  cols: VehicleColumn[];
  edit: EditState | undefined;
  bulk: boolean;
  locked: boolean;
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
    edit?.error && "bg-[#fdecec]",
  );
  const small =
    "rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50";

  if (edit) {
    const d = edit.draft;
    const dis = edit.saving || locked;
    return (
      <tr data-id={v.id} className={rowClass}>
        <td className="px-3 py-2">
          <input
            aria-label="Vehicle number"
            value={d.van_no}
            maxLength={VAN_NO_MAX}
            disabled={dis}
            onChange={(e) => onDraft({ ...d, van_no: e.target.value })}
            className={INPUT_CLASS}
          />
        </td>
        <td className="px-3 py-2">
          <input
            aria-label="Samsara link"
            value={d.samsara_url}
            placeholder="Empty = no GPS"
            disabled={dis}
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
            disabled={dis}
            onChange={(e) => onDraft({ ...d, seats: e.target.value })}
            className={INPUT_CLASS}
          />
        </td>
        {cols.map((c) => (
          <td key={c.id} className="px-3 py-2">
            <input
              aria-label={c.label}
              data-c={c.id}
              value={d.custom[c.id] ?? ""}
              maxLength={CUSTOM_VALUE_MAX}
              disabled={dis}
              onChange={(e) =>
                onDraft({
                  ...d,
                  custom: { ...d.custom, [c.id]: e.target.value },
                })
              }
              className={INPUT_CLASS}
            />
          </td>
        ))}
        <td className="px-3 py-2">
          <input
            aria-label="Note"
            value={d.notes}
            maxLength={NOTES_MAX}
            disabled={dis}
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
          {bulk ? (
            <span className="text-xs text-stone-400">Save all above</span>
          ) : (
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={dis}
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
                disabled={dis}
                onClick={onCancel}
                className={cn(small, "border-stone-300 hover:bg-stone-50")}
              >
                Cancel
              </button>
            </div>
          )}
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
      {cols.map((c) => (
        <td key={c.id} className="px-3 py-2.5 [overflow-wrap:anywhere]">
          {v.custom[c.id] || <span className="text-stone-400">-</span>}
        </td>
      ))}
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
          Change many vehicles at once: click Edit all above the list. Every row
          opens. Change what you need, then click Save all. If one row has a
          problem, nothing is saved: that row turns red with the reason. Fix it
          and click Save all again. Cancel closes all rows without saving.
        </li>
        <li>
          Add your own column: under Extra columns, type a name (for example
          Plate) and click Add column. It appears in the list. Fill it in with
          Edit or Edit all. These columns are only for reading on this page.
        </li>
        <li>
          Rename changes a column&rsquo;s name; what was filled in stays. Hide
          takes the column off the list but keeps what was filled in; Show
          brings it back. Columns are never deleted.
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
