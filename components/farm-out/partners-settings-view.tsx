"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  BTN_ADD_CLASS,
  BTN_ADD_SMALL_CLASS,
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
  createFarmOutPartner,
  deleteFarmOutPartner,
  fetchFarmOutPartners,
  fetchFarmOutTours,
  saveFarmOutPartnerRate,
} from "@/lib/farm-out-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { FarmOutPartner, FarmOutPartnerRate } from "@/types/farm-out";

import { formatMoney, parseRateField } from "./config";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      partners: FarmOutPartner[];
      tours: { manifest_id: number; tour_name: string }[];
    };

type Banner = { tone: "ok" | "error"; text: string } | null;

type RateDraft = { adult: string; child: string };
type RateCellState = "saving" | "saved" | "failed" | undefined;

/**
 * Settings → Farm out Partners（任务包 docs/farm-out/任务包_farm-out.md 第 21 条）：合作公司名单 +
 * 按团结算价（成人 / 儿童，婴儿不计）。两轮预览 Annie 都看过 HTML 样稿，这里用项目的 legacy-ui 工具
 * 重搭，不照抄样稿的内联 Tailwind。接口都在 lib/farm-out-api.ts，mock-first，没有真后端。
 */
export function PartnersSettingsView() {
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addResult, setAddResult] = useState<Banner>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, RateDraft>>({});
  const [cellStates, setCellStates] = useState<Record<number, RateCellState>>(
    {},
  );
  const [cellErrors, setCellErrors] = useState<Record<number, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<FarmOutPartner | null>(
    null,
  );
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
        const [partners, tours] = await Promise.all([
          fetchFarmOutPartners(signal),
          fetchFarmOutTours(signal),
        ]);
        if (!signal.aborted) setView({ kind: "ready", partners, tours });
      } catch (error) {
        if (!signal.aborted) applyLoadError(error);
      }
    })();
    return () => controller.abort();
  }, [reloadKey, applyLoadError]);

  async function refresh() {
    try {
      const [partners, tours] = await Promise.all([
        fetchFarmOutPartners(),
        fetchFarmOutTours(),
      ]);
      setView({ kind: "ready", partners, tours });
    } catch (error) {
      applyLoadError(error);
    }
  }

  function patchPartner(id: number, patch: Partial<FarmOutPartner>) {
    setView((prev) =>
      prev.kind === "ready"
        ? {
            ...prev,
            partners: prev.partners.map((p) =>
              p.id === id ? { ...p, ...patch } : p,
            ),
          }
        : prev,
    );
  }

  /** 存好一行价（删了 / 改了）以后，本地直接改这家公司的 rates，不用整页重拉。 */
  function patchRate(partner: FarmOutPartner, saved: FarmOutPartnerRate) {
    const cleared = saved.adult_rate === null && saved.child_rate === null;
    const rest = partner.rates.filter(
      (r) => r.manifest_id !== saved.manifest_id,
    );
    patchPartner(partner.id, { rates: cleared ? rest : [...rest, saved] });
  }

  async function addPartner() {
    if (addBusy) return;
    const name = addName.trim();
    if (!name) {
      setAddResult({ tone: "error", text: "Partner name is required." });
      return;
    }
    setAddBusy(true);
    setAddResult(null);
    try {
      await createFarmOutPartner(name);
      setAddName("");
      setAdding(false);
      setAddResult({ tone: "ok", text: `✓ Added "${name}".` });
      await refresh();
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setAddResult({ tone: "error", text: describeError(error) });
    } finally {
      setAddBusy(false);
    }
  }

  function startEdit(
    partner: FarmOutPartner,
    tours: { manifest_id: number; tour_name: string }[],
  ) {
    const next: Record<number, RateDraft> = {};
    for (const t of tours) {
      const rate = partner.rates.find((r) => r.manifest_id === t.manifest_id);
      next[t.manifest_id] = {
        adult: rate?.adult_rate == null ? "" : String(rate.adult_rate),
        child: rate?.child_rate == null ? "" : String(rate.child_rate),
      };
    }
    setDrafts(next);
    setCellStates({});
    setCellErrors({});
    setEditingId(partner.id);
  }

  async function saveRate(
    partner: FarmOutPartner,
    manifestId: number,
    draft: RateDraft,
  ) {
    setCellStates((s) => ({ ...s, [manifestId]: "saving" }));
    setCellErrors((e) => {
      const next = { ...e };
      delete next[manifestId];
      return next;
    });
    try {
      const saved = await saveFarmOutPartnerRate(partner.id, manifestId, {
        adult_rate: parseRateField(draft.adult),
        child_rate: parseRateField(draft.child),
      });
      patchRate(partner, saved);
      setCellStates((s) => ({ ...s, [manifestId]: "saved" }));
      setTimeout(
        () => setCellStates((s) => ({ ...s, [manifestId]: undefined })),
        1400,
      );
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setCellStates((s) => ({ ...s, [manifestId]: "failed" }));
      setCellErrors((e) => ({ ...e, [manifestId]: describeError(error) }));
    }
  }

  async function confirmDelete(partner: FarmOutPartner) {
    try {
      await deleteFarmOutPartner(partner.id);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" as const };
      }
      return { status: "error" as const, message: describeError(error) };
    }
    setDeleteTarget(null);
    if (editingId === partner.id) setEditingId(null);
    await refresh();
    return { status: "ok" as const };
  }

  const partners = view.kind === "ready" ? view.partners : [];
  const tours = view.kind === "ready" ? view.tours : [];

  return (
    <main className="text-stone-800 night:text-white/90">
      <LegacyPageHeader
        title="🚐 Farm out Partners"
        count={
          view.kind === "ready"
            ? `${partners.length} ${partners.length === 1 ? "partner" : "partners"}`
            : null
        }
      />

      {view.kind === "forbidden" ? (
        <Panel>
          <p className="font-medium text-stone-800 night:text-white/90">
            Admin access required
          </p>
          <p className="mt-1">Only admins can change Farm out partners.</p>
        </Panel>
      ) : view.kind === "error" ? (
        <ErrorBanner
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Could not load Farm out partners: {view.message}
        </ErrorBanner>
      ) : (
        <>
          <HowToUse />

          <section className={CARD_CLASS}>
            <div className={CARD_HEADER_CLASS}>
              <h2 className={CARD_TITLE_CLASS}>Partners &amp; rates</h2>
              {!adding ? (
                <button
                  type="button"
                  onClick={() => {
                    setAdding(true);
                    setAddResult(null);
                  }}
                  disabled={view.kind !== "ready"}
                  className={BTN_ADD_CLASS}
                >
                  + Add partner
                </button>
              ) : null}
            </div>

            {adding ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void addPartner();
                }}
                className="flex flex-wrap items-end gap-3 border-b-[0.5px] border-black/[.08] px-4 py-3 night:border-white/10"
              >
                <label className="flex min-w-0 flex-col gap-[5px]">
                  <span className="text-[12px] font-medium text-[#1a1a1a] night:text-white/55">
                    Partner name
                  </span>
                  <input
                    autoFocus
                    aria-label="Partner name"
                    value={addName}
                    maxLength={120}
                    disabled={addBusy}
                    onChange={(e) => setAddName(e.target.value)}
                    className={cn(FORM_INPUT_CLASS, "w-[240px]")}
                  />
                </label>
                <button
                  type="submit"
                  disabled={addBusy}
                  className={BTN_ADD_CLASS}
                >
                  {addBusy ? "Adding…" : "Add"}
                </button>
                <button
                  type="button"
                  disabled={addBusy}
                  onClick={() => {
                    setAdding(false);
                    setAddName("");
                    setAddResult(null);
                  }}
                  className={BTN_EDIT_CLASS}
                >
                  Cancel
                </button>
                {addResult ? (
                  <span
                    role={addResult.tone === "error" ? "alert" : "status"}
                    className={resultClass(addResult.tone)}
                  >
                    {addResult.text}
                  </span>
                ) : null}
              </form>
            ) : addResult ? (
              <div className="border-b-[0.5px] border-black/[.08] px-4 py-2.5 night:border-white/10">
                <span
                  role={addResult.tone === "error" ? "alert" : "status"}
                  className={resultClass(addResult.tone)}
                >
                  {addResult.text}
                </span>
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th className={cn(TH_CLASS, "w-[20%]")}>Partner</th>
                    <th className={cn(TH_CLASS, "w-[30%]")}>Tour</th>
                    <th className={cn(TH_CLASS, "w-[18%]")}>Adult</th>
                    <th className={cn(TH_CLASS, "w-[18%]")}>Child</th>
                    <th className={cn(TH_CLASS, "w-[14%]")}>Actions</th>
                  </tr>
                </thead>
                <tbody className={TBODY_CLASS}>
                  {partners.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-5 text-center text-[#1a1a1a] night:text-white/35"
                      >
                        No partners yet.
                      </td>
                    </tr>
                  ) : (
                    partners.map((partner) => (
                      <PartnerRows
                        key={partner.id}
                        partner={partner}
                        tours={tours}
                        editing={editingId === partner.id}
                        drafts={drafts}
                        cellStates={cellStates}
                        cellErrors={cellErrors}
                        onEdit={() => startEdit(partner, tours)}
                        onClose={() => setEditingId(null)}
                        onDraft={(manifestId, draft) =>
                          setDrafts((d) => ({ ...d, [manifestId]: draft }))
                        }
                        onSave={(manifestId) =>
                          void saveRate(
                            partner,
                            manifestId,
                            drafts[manifestId] ?? { adult: "", child: "" },
                          )
                        }
                        onDelete={() => setDeleteTarget(partner)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {deleteTarget ? (
        <ConfirmDialog
          title={`Delete "${deleteTarget.name}"?`}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          danger
          onConfirm={() => confirmDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        >
          <p>
            This removes the partner and every rate set for it. Tours already
            farmed out to them keep their own record; this only stops new
            ones.
          </p>
        </ConfirmDialog>
      ) : null}
    </main>
  );
}

function PartnerRows({
  partner,
  tours,
  editing,
  drafts,
  cellStates,
  cellErrors,
  onEdit,
  onClose,
  onDraft,
  onSave,
  onDelete,
}: {
  partner: FarmOutPartner;
  tours: { manifest_id: number; tour_name: string }[];
  editing: boolean;
  drafts: Record<number, RateDraft>;
  cellStates: Record<number, RateCellState>;
  cellErrors: Record<number, string>;
  onEdit: () => void;
  onClose: () => void;
  onDraft: (manifestId: number, draft: RateDraft) => void;
  onSave: (manifestId: number) => void;
  onDelete: () => void;
}) {
  const rows = editing ? tours : null;
  const viewRows = partner.rates;
  const rowCount = editing
    ? Math.max(rows?.length ?? 0, 1)
    : Math.max(viewRows.length, 1);

  const actionsCell = (
    <td className={TD_CLASS} rowSpan={rowCount}>
      <div className="flex flex-wrap gap-1.5">
        {editing ? (
          <button type="button" onClick={onClose} className={BTN_EDIT_CLASS}>
            Done
          </button>
        ) : (
          <button type="button" onClick={onEdit} className={BTN_EDIT_CLASS}>
            Edit
          </button>
        )}
        <button type="button" onClick={onDelete} className={BTN_DELETE_CLASS}>
          Delete
        </button>
      </div>
    </td>
  );

  const nameCell = (
    <td className={cn(TD_CLASS, "align-top font-semibold")} rowSpan={rowCount}>
      {partner.name}
    </td>
  );

  if (editing) {
    if (!tours.length) {
      return (
        <tr data-partner-id={partner.id} className={cn(TR_CLASS, TR_HOVER)}>
          {nameCell}
          <td colSpan={3} className="p-3 text-center text-[#1a1a1a] night:text-white/35">
            No tours configured yet.
          </td>
          {actionsCell}
        </tr>
      );
    }
    return (
      <>
        {tours.map((t, i) => {
          const draft = drafts[t.manifest_id] ?? { adult: "", child: "" };
          const state = cellStates[t.manifest_id];
          const error = cellErrors[t.manifest_id];
          return (
            <tr
              key={t.manifest_id}
              data-partner-id={partner.id}
              className={cn(TR_CLASS, TR_HOVER)}
            >
              {i === 0 ? nameCell : null}
              <td className={TD_CLASS}>{t.tour_name}</td>
              <td className={TD_CLASS}>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  aria-label={`Adult rate — ${partner.name} — ${t.tour_name}`}
                  placeholder="not set"
                  value={draft.adult}
                  disabled={state === "saving"}
                  onChange={(e) =>
                    onDraft(t.manifest_id, { ...draft, adult: e.target.value })
                  }
                  className={cn(INLINE_INPUT_CLASS, "w-[90px]")}
                />
              </td>
              <td className={TD_CLASS}>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label={`Child rate — ${partner.name} — ${t.tour_name}`}
                    placeholder="not set"
                    value={draft.child}
                    disabled={state === "saving"}
                    onChange={(e) =>
                      onDraft(t.manifest_id, {
                        ...draft,
                        child: e.target.value,
                      })
                    }
                    className={cn(INLINE_INPUT_CLASS, "w-[90px]")}
                  />
                  <button
                    type="button"
                    disabled={state === "saving"}
                    onClick={() => onSave(t.manifest_id)}
                    className={BTN_ADD_SMALL_CLASS}
                  >
                    {state === "saving"
                      ? "Saving…"
                      : state === "saved"
                        ? "✓ Saved"
                        : "Save"}
                  </button>
                </div>
                {error ? (
                  <p
                    role="alert"
                    className="mt-1 text-[11px] text-[#A32D2D] night:text-red-300"
                  >
                    {error}
                  </p>
                ) : null}
              </td>
              {i === 0 ? actionsCell : null}
            </tr>
          );
        })}
      </>
    );
  }

  if (!viewRows.length) {
    return (
      <tr data-partner-id={partner.id} className={cn(TR_CLASS, TR_HOVER)}>
        {nameCell}
        <td
          colSpan={3}
          className="p-3 text-[#1a1a1a] night:text-white/35"
        >
          No rates set yet — click Edit to add.
        </td>
        {actionsCell}
      </tr>
    );
  }

  return (
    <>
      {viewRows.map((r, i) => (
        <tr
          key={r.manifest_id}
          data-partner-id={partner.id}
          className={cn(TR_CLASS, TR_HOVER)}
        >
          {i === 0 ? nameCell : null}
          <td className={TD_CLASS}>{r.tour_name}</td>
          <td className={TD_CLASS}>
            {r.adult_rate == null ? (
              <span className="text-[#1a1a1a] night:text-white/35">
                not set
              </span>
            ) : (
              formatMoney(r.adult_rate)
            )}
          </td>
          <td className={TD_CLASS}>
            {r.child_rate == null ? (
              <span className="text-[#1a1a1a] night:text-white/35">
                not set
              </span>
            ) : (
              formatMoney(r.child_rate)
            )}
          </td>
          {i === 0 ? actionsCell : null}
        </tr>
      ))}
    </>
  );
}

function HowToUse() {
  return (
    <LegacyHowTo
      title="How to use — Farm out Partners"
      padY="py-2.5"
      footer="Infants are never counted in the settlement amount, on any tour."
    >
      <li>
        Add a partner: click + Add partner, type its name, click Add. It
        appears in the list with no rates set yet.
      </li>
      <li>
        Set rates: click Edit. Every tour shows, even ones with no rate yet.
        Fill in Adult and/or Child and click Save on that row. Leaving both
        empty and clicking Save clears the rate — that tour can no longer be
        farmed out to this partner until you set it again.
      </li>
      <li>
        Click Done to close the rate editor. Delete removes the partner and
        every rate set for it, after you confirm.
      </li>
    </LegacyHowTo>
  );
}
