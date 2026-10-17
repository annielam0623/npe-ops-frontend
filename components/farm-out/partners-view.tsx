"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

import {
  BTN_ADD_CLASS,
  BTN_ADD_SMALL_CLASS,
  BTN_EDIT_CLASS,
  BTN_OFF_CLASS,
  BTN_ON_CLASS,
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
import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  createPartner,
  fetchPartners,
  updatePartner,
} from "@/lib/farm-out-api";
import { cn } from "@/lib/utils";
import type { FarmOutPartner } from "@/types/farm-out";

import { gateFromError, type LoadGate } from "./config";
import { PartnerDetail } from "./partner-detail";
import { CELL_INPUT, GateNotice, ResultLine, useRedirectToLogin } from "./ui";

/** Settings → Farm out Partners：合作公司名单、改名、停用，展开改结算价和它自己的上车点。 */
export function PartnersView() {
  const [gate, setGate] = useState<LoadGate>({ kind: "loading" });
  const [partners, setPartners] = useState<FarmOutPartner[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{
    id: number;
    name: string;
    error: string | null;
  } | null>(null);
  const [deactivating, setDeactivating] = useState<FarmOutPartner | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const redirectToLogin = useRedirectToLogin();

  useEffect(() => {
    const controller = new AbortController();
    setGate({ kind: "loading" });
    (async () => {
      try {
        const me = await fetchCurrentUser(controller.signal);
        if (controller.signal.aborted) return;
        // 只有 admin 能管合作公司（后端也会 403）。
        if (!me.is_admin) {
          setGate({ kind: "forbidden" });
          return;
        }
        const list = await fetchPartners();
        if (controller.signal.aborted) return;
        setPartners(list);
        setGate({ kind: "ready" });
      } catch (error) {
        if (controller.signal.aborted) return;
        const next = gateFromError(error);
        if (next) setGate(next);
        else redirectToLogin();
      }
    })();
    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  const replace = useCallback((p: FarmOutPartner) => {
    setPartners((all) => all.map((x) => (x.id === p.id ? p : x)));
  }, []);

  async function addPartner() {
    const name = newName.trim();
    if (adding) return;
    if (!name) {
      setAddResult({ tone: "error", text: "Partner name is required." });
      return;
    }
    setAdding(true);
    setAddResult(null);
    try {
      const created = await createPartner(name);
      setPartners((all) => [...all, created]);
      setNewName("");
      setOpenId(created.id);
      setAddResult({ tone: "ok", text: "✓ Added" });
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setAddResult({ tone: "error", text: describeError(error) });
    } finally {
      setAdding(false);
    }
  }

  async function saveRename() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) {
      setRenaming({ ...renaming, error: "Partner name is required." });
      return;
    }
    try {
      replace(await updatePartner(renaming.id, { name }));
      setRenaming(null);
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setRenaming({ ...renaming, error: describeError(error) });
    }
  }

  async function setActive(p: FarmOutPartner, active: boolean) {
    setActionError(null);
    try {
      replace(await updatePartner(p.id, { is_active: active }));
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else
        setActionError(`Could not change ${p.name}: ${describeError(error)}`);
    }
  }

  async function confirmDeactivate(p: FarmOutPartner): Promise<ActionResult> {
    try {
      replace(await updatePartner(p.id, { is_active: false }));
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      return { status: "error", message: describeError(error) };
    }
    setDeactivating(null);
    return { status: "ok" };
  }

  const ready = gate.kind === "ready";

  return (
    <main className="text-stone-800 night:text-white/90">
      <LegacyPageHeader
        title="⇄ Farm out Partners"
        count={
          ready
            ? `${partners.length} ${partners.length === 1 ? "partner" : "partners"}`
            : null
        }
      />

      {!ready && gate.kind !== "loading" ? (
        <GateNotice gate={gate} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : null}
      {gate.kind === "loading" ? (
        <p className="text-[12px] text-white/60">Loading…</p>
      ) : null}

      {ready ? (
        <>
          <HowToUse />

          <section className={CARD_CLASS}>
            <div className={CARD_HEADER_CLASS}>
              <h2 className={CARD_TITLE_CLASS}>+ Add Partner</h2>
            </div>
            <form
              className="flex flex-wrap items-center gap-3 px-5 py-[18px]"
              onSubmit={(e) => {
                e.preventDefault();
                void addPartner();
              }}
            >
              <input
                type="text"
                aria-label="New partner name"
                placeholder="Partner name"
                value={newName}
                disabled={adding}
                onChange={(e) => setNewName(e.target.value)}
                className={cn(FORM_INPUT_CLASS, "w-[260px]")}
              />
              <button type="submit" disabled={adding} className={cn(BTN_ADD_CLASS)}>
                {adding ? "Adding…" : "Add"}
              </button>
              <ResultLine result={addResult} />
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
              <h2 className={CARD_TITLE_CLASS}>Partners &amp; rates</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th className={TH_CLASS}>Partner</th>
                    <th className={TH_CLASS}>Status</th>
                    <th className={TH_CLASS}>Actions</th>
                  </tr>
                </thead>
                <tbody className={TBODY_CLASS}>
                  {partners.length === 0 ? (
                    <tr>
                      <td colSpan={3} className={cn(TD_CLASS, "text-center")}>
                        No partners yet.
                      </td>
                    </tr>
                  ) : (
                    partners.map((p) => (
                      <Fragment key={p.id}>
                        <tr className={TR_CLASS} data-partner={p.name}>
                          <td className={cn(TD_CLASS, "font-semibold")}>
                            {renaming?.id === p.id ? (
                              <span className="flex flex-wrap items-center gap-2">
                                <input
                                  type="text"
                                  aria-label="Partner name"
                                  autoFocus
                                  value={renaming.name}
                                  onChange={(e) =>
                                    setRenaming({
                                      ...renaming,
                                      name: e.target.value,
                                      error: null,
                                    })
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") void saveRename();
                                    if (e.key === "Escape") setRenaming(null);
                                  }}
                                  className={cn(CELL_INPUT, "w-[200px]")}
                                />
                                <button
                                  type="button"
                                  className={BTN_ADD_SMALL_CLASS}
                                  onClick={() => void saveRename()}
                                >
                                  Save name
                                </button>
                                <button
                                  type="button"
                                  className={BTN_EDIT_CLASS}
                                  onClick={() => setRenaming(null)}
                                >
                                  Cancel
                                </button>
                                {renaming.error ? (
                                  <span
                                    role="alert"
                                    className="text-[12px] font-normal text-[#A32D2D] night:text-red-300"
                                  >
                                    {renaming.error}
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              p.name
                            )}
                          </td>
                          <td className={TD_CLASS}>
                            {p.is_active ? "Active" : "Inactive"}
                          </td>
                          <td className={cn(TD_CLASS, "whitespace-nowrap")}>
                            <span className="inline-flex gap-1.5">
                              <button
                                type="button"
                                aria-expanded={openId === p.id}
                                className={BTN_EDIT_CLASS}
                                onClick={() =>
                                  setOpenId(openId === p.id ? null : p.id)
                                }
                              >
                                {openId === p.id ? "Close" : "Edit"}
                              </button>
                              <button
                                type="button"
                                className={BTN_EDIT_CLASS}
                                onClick={() =>
                                  setRenaming({
                                    id: p.id,
                                    name: p.name,
                                    error: null,
                                  })
                                }
                              >
                                Rename
                              </button>
                              {p.is_active ? (
                                <button
                                  type="button"
                                  className={BTN_OFF_CLASS}
                                  onClick={() => setDeactivating(p)}
                                >
                                  Deactivate
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className={BTN_ON_CLASS}
                                  onClick={() => void setActive(p, true)}
                                >
                                  Reactivate
                                </button>
                              )}
                            </span>
                          </td>
                        </tr>
                        {openId === p.id ? (
                          <tr className={TR_CLASS}>
                            <td colSpan={3} className="p-0">
                              <PartnerDetail
                                partnerId={p.id}
                                onUnauthorized={redirectToLogin}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {deactivating ? (
        <ConfirmDialog
          title={`Deactivate "${deactivating.name}"?`}
          confirmLabel="Deactivate"
          busyLabel="Deactivating…"
          onConfirm={() => confirmDeactivate(deactivating)}
          onClose={() => setDeactivating(null)}
        >
          <p>
            It stops appearing as a choice when you farm out an order in
            Dispatch. Orders already farmed out to it are not changed. You can
            reactivate it here at any time.
          </p>
        </ConfirmDialog>
      ) : null}
    </main>
  );
}

/** 页面说明（同其它 Settings 页的蓝色 How to use 条）。 */
function HowToUse() {
  return (
    <LegacyHowTo
      title="How to use — Farm out Partners"
      padY="py-2.5"
      footer="Infants are never counted in the settlement amount, on any tour."
    >
      <li>
        Add a partner: type its name and click Add. It opens right away so you
        can fill in its rates and pick-up locations.
      </li>
      <li>
        Edit opens the partner. Every tour is listed, even ones with no price
        yet. Fill in Adult and/or Child and click Save rates. A tour with no
        price cannot get a payable amount in Dispatch until you set one.
      </li>
      <li>
        Pick-up locations are this partner&apos;s own hotels (not linked to our
        Pickup Locations). Their order here is the order shown in Dispatch.
        Click Save locations to keep your changes.
      </li>
      <li>
        Rename changes the name shown in this system. Deactivate hides the
        partner from the Farm out choice in Dispatch; orders already farmed out
        to it are not changed, and you can Reactivate at any time.
      </li>
    </LegacyHowTo>
  );
}
