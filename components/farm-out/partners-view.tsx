"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState, useRef } from "react";

import {
  BTN_SUBMIT_CLASS,
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
import { byTick } from "@/lib/by-tick";
import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import type { ActionResult } from "@/components/ui/action-result";
import { BulkImportButton, StandardImport } from "@/components/ui/bulk-import";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner } from "@/components/ui/panel";
import { fetchActionLog } from "@/lib/action-log";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  createPartner,
  fetchPartnerRates,
  fetchPartners,
  savePartnerRates,
  updatePartner,
} from "@/lib/farm-out-api";
import { usePermissions } from "@/lib/staff-permissions";
import { csvBlob } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import type {
  FarmOutPartner,
  FarmOutPrice,
  FarmOutRate,
  FarmOutRatePut,
} from "@/types/farm-out";

import { gateFromError, type LoadGate } from "./config";
import { PartnerDetail } from "./partner-detail";
import { TourProducts } from "./tour-products";
import {
  BTN_BLUE_SMALL,
  CELL_INPUT,
  GateNotice,
  ResultLine,
  useRedirectToLogin,
} from "./ui";

/** Settings → Farm out Partners：合作公司名单、改名、停用，展开改结算价和它自己的上车点。 */
/** ⬆ Import 的栏：key → 模板 / 预览里的栏名（G263 v3：多了 Product、Infant）。 */
const RATE_IMPORT_LABEL: Record<string, string> = {
  partner: "Partner",
  tour_name: "Tour",
  product: "Product",
  adult_price: "Adult",
  child_price: "Child",
  infant_price: "Infant",
};

const priceCell = (prices: FarmOutPrice[], t: string) =>
  prices.find((x) => x.ticket_type === t)?.price ?? "";

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
  /** 每家公司每个团的价格（列表里直接显示）；读不出来的公司是 "error"。 */
  const [rates, setRates] = useState<Record<number, FarmOutRate[] | "error">>(
    {},
  );
  /** 正在编辑的团（一次只开一个；G263 v3 一个团一个 Save）。 */
  const [editingTour, setEditingTour] = useState<{
    partnerId: number;
    manifestId: number;
  } | null>(null);
  /** 正在编辑的团有没存的改动：离开页面先问。 */
  const [tourDirty, setTourDirty] = useState(false);
  useLeaveGuard(
    tourDirty,
    "You have unsaved product prices. Leave without saving?",
  );
  /** 刚存好的团（`<合作公司 id>|<团 id>`）：团名旁边写绿字 ✓ Saved，再编辑就去掉。 */
  const [savedRow, setSavedRow] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [logVersion, setLogVersion] = useState(0);
  const redirectToLogin = useRedirectToLogin();
  const perms = usePermissions();
  // 没勾 See prices, agent & commission（orders.money_view，题 8；Annie「除了客人的基本信息，CCL看不到任何有价格的信息」，
  // 合作方的价格也算）：价格列、每个团的价格行、Import rates 都不出，也不请求价格；合作公司本身照 settings.farm_out 照旧。
  const seeMoney = perms.canSeeMoney;
  /** 价格那几列算不算在表里（没勾时表只剩 Partner / Status / Actions）。 */
  const cols = seeMoney ? 6 : 3;

  /** 导入存好后静悄悄重拉（不回到 Loading，Import 块和展开的上车点都留着）。 */
  const refreshAll = useCallback(async () => {
    setLogVersion((v) => v + 1);
    try {
      const list = await fetchPartners();
      const entries = await Promise.all(
        list.map(async (p) => {
          try {
            return [p.id, await fetchPartnerRates(p.id)] as const;
          } catch (error) {
            if (isStatus(error, 401)) throw error;
            return [p.id, "error"] as const;
          }
        }),
      );
      setPartners(list);
      setRates(Object.fromEntries(entries));
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setActionError(`Could not reload the list: ${describeError(error)}`);
    }
  }, [redirectToLogin]);

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
        // 只有 admin 能管合作公司（后端也会 403）。
        if (
          !byTick(tickPermsRef.current, "settings.farm_out", {
            superAdmin: !!me.is_superadmin,
          })
        ) {
          setGate({ kind: "forbidden" });
          return;
        }
        const list = await fetchPartners();
        if (controller.signal.aborted) return;
        setPartners(list);
        if (!tickPermsRef.current.canSeeMoney) {
          setRates({});
          setGate({ kind: "ready" });
          return;
        }
        const entries = await Promise.all(
          list.map(async (p) => {
            try {
              return [p.id, await fetchPartnerRates(p.id)] as const;
            } catch (error) {
              if (isStatus(error, 401)) throw error;
              return [p.id, "error"] as const;
            }
          }),
        );
        if (controller.signal.aborted) return;
        setRates(Object.fromEntries(entries));
        setGate({ kind: "ready" });
      } catch (error) {
        if (controller.signal.aborted) return;
        const next = gateFromError(error);
        if (next) setGate(next);
        else redirectToLogin();
      }
    })();
    return () => controller.abort();
  }, [reloadKey, redirectToLogin, tickPerms.ready, tickPerms.active]);

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
      if (seeMoney) {
        try {
          const r = await fetchPartnerRates(created.id);
          setRates((all) => ({ ...all, [created.id]: r }));
        } catch {
          setRates((all) => ({ ...all, [created.id]: "error" }));
        }
      }
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

  /** 存一个团的产品：别的团只带 manifest_id（后端「没带 products 就不动」）。返回 null = 存好，字符串 = 原话。 */
  async function saveTour(
    partnerId: number,
    put: FarmOutRatePut,
  ): Promise<string | null> {
    const list = rates[partnerId];
    if (!Array.isArray(list)) return "Reload the page and try again.";
    try {
      const saved = await savePartnerRates(
        partnerId,
        list.map((r) =>
          r.manifest_id === put.manifest_id
            ? put
            : { manifest_id: r.manifest_id },
        ),
      );
      setRates((all) => ({ ...all, [partnerId]: saved }));
      setTourDirty(false);
      setEditingTour(null);
      setSavedRow(`${partnerId}|${put.manifest_id}`);
      setLogVersion((v) => v + 1);
      return null;
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return null;
      }
      return describeError(error);
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
          <HowToUse money={seeMoney} />

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
              <button
                type="submit"
                disabled={adding}
                className={BTN_SUBMIT_CLASS}
              >
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

          {importOpen && seeMoney ? (
            <StandardImport
              title="Import rates"
              help={
                <>
                  <b>Partner</b>, <b>Tour</b> and <b>Product</b> find the row
                  (the short or the full product name). A partner or tour not on
                  the list is an error (add partners above); a product not on
                  the tour is added as a new product. Adult, Child and Infant
                  are numbers, e.g. 98. A blank cell never clears a price.
                </>
              }
              endpoint="/api/farm-out/rates/import"
              labelOf={(k) => RATE_IMPORT_LABEL[k] ?? k}
              template={() => ({
                blob: csvBlob(
                  ["Partner", "Tour", "Product", "Adult", "Child", "Infant"],
                  partners.flatMap((p) => {
                    const list = rates[p.id];
                    return list === "error" || !list
                      ? []
                      : list.flatMap((r) =>
                          (r.products ?? []).map((x) => [
                            p.name,
                            r.tour_name,
                            x.name,
                            priceCell(x.prices, "adult"),
                            priceCell(x.prices, "child"),
                            priceCell(x.prices, "infant"),
                          ]),
                        );
                  }),
                ),
                filename: "farm_out_rates_template.csv",
              })}
              onClose={() => setImportOpen(false)}
              onSaved={() => void refreshAll()}
              onUnauthorized={redirectToLogin}
            />
          ) : null}

          <section className={CARD_CLASS}>
            <div className={CARD_HEADER_CLASS}>
              <h2 className={CARD_TITLE_CLASS}>
                {seeMoney ? <>Partners &amp; rates</> : "Partners"}
              </h2>
              <span
                hidden={!seeMoney}
                title={
                  editingTour
                    ? "Save or cancel the prices you are editing first."
                    : ""
                }
              >
                <BulkImportButton
                  onClick={() => setImportOpen(true)}
                  disabled={importOpen || editingTour !== null}
                />
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[12px]">
                <thead>
                  <tr>
                    <th className={TH_CLASS}>
                      {seeMoney ? "Partner / Tour / Product" : "Partner"}
                    </th>
                    {seeMoney ? (
                      <>
                        <th className={cn(TH_CLASS, "text-right")}>Adult</th>
                        <th className={cn(TH_CLASS, "text-right")}>Child</th>
                        <th className={cn(TH_CLASS, "text-right")}>Infant</th>
                      </>
                    ) : null}
                    <th className={TH_CLASS}>Status</th>
                    <th className={TH_CLASS}>Actions</th>
                  </tr>
                </thead>
                <tbody className={TBODY_CLASS}>
                  {partners.length === 0 ? (
                    <tr>
                      <td
                        colSpan={cols}
                        className={cn(TD_CLASS, "text-center")}
                      >
                        No partners yet.
                      </td>
                    </tr>
                  ) : (
                    partners.map((p) => {
                      const list = rates[p.id];
                      return (
                        <Fragment key={p.id}>
                          <tr
                            className={cn(
                              TR_CLASS,
                              !p.is_active && "opacity-60",
                            )}
                            data-partner={p.name}
                          >
                            <td
                              className={cn(TD_CLASS, "font-semibold")}
                              colSpan={seeMoney ? 4 : 1}
                            >
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
                                    className={BTN_BLUE_SMALL}
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
                                <button
                                  type="button"
                                  aria-expanded={openId === p.id}
                                  className={BTN_EDIT_CLASS}
                                  onClick={() =>
                                    setOpenId(openId === p.id ? null : p.id)
                                  }
                                >
                                  {openId === p.id
                                    ? "Close locations"
                                    : "Locations"}
                                </button>
                                {/* 每家自己的时刻表（G199，Annie 2026-10-27），侧栏不再单列 Timetable。 */}
                                <Link
                                  href={`/settings/farm-out-partners/${p.id}/timetable`}
                                  data-timetable-link
                                  className={cn(BTN_EDIT_CLASS, "no-underline")}
                                >
                                  Timetable
                                </Link>
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
                          {!seeMoney ? null : list === "error" ? (
                            <tr className={TR_CLASS}>
                              <td
                                colSpan={6}
                                className={cn(TD_CLASS, "pl-6 text-[#A32D2D]")}
                              >
                                Could not load this partner&apos;s prices.
                              </td>
                            </tr>
                          ) : Array.isArray(list) && list.length === 0 ? (
                            <tr className={TR_CLASS}>
                              <td colSpan={6} className={cn(TD_CLASS, "pl-6")}>
                                No tours yet.
                              </td>
                            </tr>
                          ) : (
                            (list ?? []).map((r) => (
                              <TourProducts
                                key={r.manifest_id}
                                partnerName={p.name}
                                active={p.is_active}
                                rate={r}
                                editing={
                                  editingTour?.partnerId === p.id &&
                                  editingTour.manifestId === r.manifest_id
                                }
                                saved={savedRow === `${p.id}|${r.manifest_id}`}
                                disabled={editingTour !== null}
                                onStartEdit={() => {
                                  setSavedRow(null);
                                  setEditingTour({
                                    partnerId: p.id,
                                    manifestId: r.manifest_id,
                                  });
                                }}
                                onCancel={() => {
                                  setTourDirty(false);
                                  setEditingTour(null);
                                }}
                                onSave={(put) => saveTour(p.id, put)}
                                onDirty={setTourDirty}
                              />
                            ))
                          )}
                          {openId === p.id ? (
                            <tr className={TR_CLASS}>
                              <td colSpan={cols} className="p-0">
                                <PartnerDetail
                                  partnerId={p.id}
                                  partnerName={p.name}
                                  onUnauthorized={redirectToLogin}
                                />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* G203 第三批：Farm out 设置的改动记录（后端按 settings.farm_out，同写接口）；partner 后端 403，干脆不出。 */}
          {perms.isPartner || !perms.can("settings.farm_out") ? null : (
            <ActionLogPanel
              refreshKey={logVersion}
              reloadOnOpen
              onUnauthorized={redirectToLogin}
              load={(before, signal) =>
                fetchActionLog(
                  "/api/farm-out/settings/action-log",
                  before,
                  signal,
                )
              }
            />
          )}
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
/** money = false（没勾 orders.money_view）：不讲价格、子项和 Import rates。 */
function HowToUse({ money }: { money: boolean }) {
  return (
    <LegacyHowTo
      title="How to use — Farm out Partners"
      padY="py-2.5"
      footer={
        money
          ? "Infants are never counted in the settlement amount, on any tour."
          : undefined
      }
    >
      {money ? (
        <MoneyHowTo />
      ) : (
        <li>Add a partner: type its name and click Add.</li>
      )}
      <PartnerHowTo />
    </LegacyHowTo>
  );
}

function MoneyHowTo() {
  return (
    <>
      <li>
        Add a partner: type its name and click Add. Its tours appear under it
        with prices not set; click Edit on a tour to set them.
      </li>
      <li>
        Every tour is listed under its partner with the Adult and Child price,
        even tours with no price yet. Click Edit on a tour row, change the
        prices and click Save. A tour with no price cannot get a payable amount
        in Dispatch until you set one. A tour with items under it shows N/A when
        its Adult and Child are blank — the prices are on its items, so nothing
        is missing.
      </li>
      <li>
        Click ＋ on a tour to add an item under it — a name and a price per
        person (for example Lunch 15.00). Add as many as you need with ＋ Add
        item; ↑↓ changes the order and ✕ removes one. Items are saved together
        with the Adult and Child prices when you click Save. They are a price
        list only and are not added to the amount payable in Dispatch.
      </li>
      <li>
        To change many prices at once (for example the yearly price change),
        click ⬆ Import in Partners &amp; rates, then ⬇ Download template (every
        partner and tour with today&apos;s prices). Change the prices in Excel,
        choose the file, check the preview and click Save. Rows are matched by
        Partner and Tour; a blank cell never clears a price; rows marked Error
        are not saved.
      </li>
    </>
  );
}

function PartnerHowTo() {
  return (
    <>
      <li>
        Locations opens this partner&apos;s own pick-up hotels (not linked to
        our Pickup Locations). Their order there is the order shown in Dispatch.
        Click Save locations to keep your changes. To change or add many at
        once, click ⬆ Import, then ⬇ Download template (this partner&apos;s
        locations), change or add rows in Excel, choose the file, check the
        preview and click Save. Rows are matched by Hotel; a blank cell never
        clears a box; rows marked Error are not saved.
      </li>
      <li>
        Rename changes the name shown in this system. Deactivate hides the
        partner from the Farm out choice in Dispatch; orders already farmed out
        to it are not changed, and you can Reactivate at any time.
      </li>
    </>
  );
}
