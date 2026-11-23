"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  BTN_EDIT_CLASS,
  BTN_OFF_CLASS,
  BTN_ON_CLASS,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_TITLE_CLASS,
  LegacyHowTo,
  LegacyPageHeader,
  TBODY_CLASS,
  TD_CLASS,
  TH_CLASS,
} from "@/components/pickup-locations/legacy-ui";
import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner } from "@/components/ui/panel";
import { PhoneMore } from "@/components/ui/phone";
import { SelectMenu } from "@/components/ui/select-menu";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import { byTick } from "@/lib/by-tick";
import {
  fetchPartnerRates,
  fetchPartners,
  savePartnerRates,
  updatePartner,
} from "@/lib/farm-out-api";
import { usePermissions } from "@/lib/staff-permissions";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import type {
  FarmOutPartner,
  FarmOutRate,
  FarmOutRatePut,
} from "@/types/farm-out";

import { gateFromError, type LoadGate } from "./config";
import { PartnerDetail } from "./partner-detail";
import { hasProducts, partnerHref } from "./partners-view";
import { TourProducts } from "./tour-products";
import {
  BTN_BLUE_SMALL,
  CELL_INPUT,
  GateNotice,
  PAPER_PHONE_MORE,
  useRedirectToLogin,
} from "./ui";

/**
 * 一家合作公司自己的页（第 8 件，Annie 11-20「8-Q7–Q11 都 A | 动手」，preview v2
 * https://claude.ai/artifact/9eCQCXvHoEDaEDgsU3uYks）：
 * 页头 ‹ Partners + Partner 下拉（Q7 A）→ 信息行（Status、Rename / Timetable / Deactivate）→ 有产品的团 →
 * Pick-up locations（Q8 A 一直显示，没有 Locations 键）→ 灰色折叠行「▸ N tours with no products yet」。
 * 折叠行（146 Q1–Q4、Q6 = A）：电脑写团名、手机只写数目；里面的团正在编辑时 Hide 灰掉；存好有产品马上上移、绿字 ✓ Saved；
 * 每次打开都收着。价格、上车点都先改在页面上，按 Save 才存；有没存的改动时离开（下拉、‹ Partners、Timetable、侧栏、关标签）先问。
 */
export function PartnerPage({ partnerId }: { partnerId: number }) {
  const router = useRouter();
  const [gate, setGate] = useState<LoadGate>({ kind: "loading" });
  const [partners, setPartners] = useState<FarmOutPartner[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [rates, setRates] = useState<FarmOutRate[] | "error" | null>(null);
  const [renaming, setRenaming] = useState<{
    name: string;
    error: string | null;
  } | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** 正在编辑的团（一次只开一个；一个团一个 Save）。 */
  const [editingTour, setEditingTour] = useState<number | null>(null);
  const [tourDirty, setTourDirty] = useState(false);
  const [locDirty, setLocDirty] = useState(false);
  /** 刚存好的团：团名旁边绿字 ✓ Saved，再编辑就去掉。 */
  const [savedTour, setSavedTour] = useState<number | null>(null);
  /** 「没有产品的团」折叠行：每次打开页面都收着（146 Q4 A）。 */
  const [showEmpty, setShowEmpty] = useState(false);
  const redirectToLogin = useRedirectToLogin();
  const perms = usePermissions();
  const seeMoney = perms.canSeeMoney;

  const partner = partners.find((p) => p.id === partnerId) ?? null;
  const name = partner?.name ?? "this partner";
  const dirty = tourDirty || locDirty;
  const leaveMessage = `You have unsaved changes on ${name}. Leave without saving?`;
  useLeaveGuard(dirty, leaveMessage);

  const tickPermsRef = useRef(perms);
  tickPermsRef.current = perms;
  useEffect(() => {
    if (!perms.ready) return;
    const controller = new AbortController();
    setGate({ kind: "loading" });
    (async () => {
      try {
        const me = await fetchCurrentUser(controller.signal);
        if (controller.signal.aborted) return;
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
        if (
          tickPermsRef.current.canSeeMoney &&
          list.some((p) => p.id === partnerId)
        ) {
          try {
            const r = await fetchPartnerRates(partnerId);
            if (controller.signal.aborted) return;
            setRates(r);
          } catch (error) {
            if (isStatus(error, 401)) throw error;
            if (controller.signal.aborted) return;
            setRates("error");
          }
        }
        setGate({ kind: "ready" });
      } catch (error) {
        if (controller.signal.aborted) return;
        const next = gateFromError(error);
        if (next) setGate(next);
        else redirectToLogin();
      }
    })();
    return () => controller.abort();
  }, [partnerId, reloadKey, redirectToLogin, perms.ready, perms.active]);

  const replace = useCallback((p: FarmOutPartner) => {
    setPartners((all) => all.map((x) => (x.id === p.id ? p : x)));
  }, []);

  async function saveRename() {
    if (!renaming || !partner) return;
    const next = renaming.name.trim();
    if (!next) {
      setRenaming({ ...renaming, error: "Partner name is required." });
      return;
    }
    try {
      replace(await updatePartner(partner.id, { name: next }));
      setRenaming(null);
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setRenaming({ ...renaming, error: describeError(error) });
    }
  }

  async function reactivate() {
    if (!partner) return;
    setActionError(null);
    try {
      replace(await updatePartner(partner.id, { is_active: true }));
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else
        setActionError(
          `Could not change ${partner.name}: ${describeError(error)}`,
        );
    }
  }

  async function confirmDeactivate(): Promise<ActionResult> {
    if (!partner) return { status: "ok" };
    try {
      replace(await updatePartner(partner.id, { is_active: false }));
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      return { status: "error", message: describeError(error) };
    }
    setDeactivating(false);
    return { status: "ok" };
  }

  /** 存一个团的产品：别的团只带 manifest_id（后端「没带 products 就不动」）。返回 null = 存好，字符串 = 原话。 */
  async function saveTour(put: FarmOutRatePut): Promise<string | null> {
    if (!Array.isArray(rates)) return "Reload the page and try again.";
    try {
      const saved = await savePartnerRates(
        partnerId,
        rates.map((r) =>
          r.manifest_id === put.manifest_id
            ? put
            : { manifest_id: r.manifest_id },
        ),
      );
      setRates(saved);
      setTourDirty(false);
      setEditingTour(null);
      setSavedTour(put.manifest_id);
      return null;
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return null;
      }
      return describeError(error);
    }
  }

  /** Partner 下拉换公司：有没存的改动先问（同离开页面）。 */
  function switchPartner(id: string) {
    if (Number(id) === partnerId) return;
    if (dirty && !window.confirm(leaveMessage)) return;
    // 不先撤离开提醒：撤的时候它会 history.back() 退掉哨兵，正好把这次跳转退回来。
    // 直接跳；旧页卸下时已不在哨兵那一条上，提醒自己收掉。
    router.push(partnerHref(Number(id)));
  }

  const ready = gate.kind === "ready";
  const notFound = ready && !partner;

  const tourRows = (list: FarmOutRate[]) =>
    list.map((r) => (
      <TourProducts
        key={r.manifest_id}
        partnerName={partner?.name ?? ""}
        active={!!partner?.is_active}
        rate={r}
        editing={editingTour === r.manifest_id}
        saved={savedTour === r.manifest_id}
        disabled={editingTour !== null}
        onStartEdit={() => {
          setSavedTour(null);
          setEditingTour(r.manifest_id);
        }}
        onCancel={() => {
          setTourDirty(false);
          setEditingTour(null);
        }}
        onSave={saveTour}
        onDirty={setTourDirty}
      />
    ));

  const withProducts = Array.isArray(rates) ? rates.filter(hasProducts) : [];
  const empty = Array.isArray(rates)
    ? rates.filter((r) => !hasProducts(r))
    : [];
  const editingInEmpty =
    editingTour !== null && empty.some((r) => r.manifest_id === editingTour);
  // 正在编辑的团在折叠里：一直展开（Hide 灰掉，Q2 A）。
  const emptyOpen = showEmpty || editingInEmpty;

  return (
    <main className="text-stone-800 max-sm:flex max-sm:flex-col night:text-white/90">
      <LegacyPageHeader
        title={`⇄ ${partner ? `${partner.name} · ` : ""}Farm out Partner`}
      />
      <nav
        aria-label="Back"
        className="mb-3.5 flex flex-wrap items-center gap-3"
      >
        <Link
          href="/settings/farm-out-partners"
          className="inline-flex h-7 items-center rounded-lg border border-[rgba(147,197,253,.35)] px-[11px] text-[13px] text-[#93c5fd] no-underline hover:bg-white/[.07]"
        >
          ‹ Partners
        </Link>
        {ready && partner ? (
          <label className="flex items-center gap-2 text-[12px] text-[#93a7c2]">
            Partner
            <SelectMenu
              aria-label="Partner"
              data-partner-select
              tone="dark"
              value={String(partnerId)}
              options={[
                ...partners.filter((p) => p.is_active),
                ...partners.filter((p) => !p.is_active),
              ].map((p) => ({
                value: String(p.id),
                label: p.is_active ? p.name : `${p.name} (Inactive)`,
              }))}
              onChange={switchPartner}
              className="h-[30px] min-w-[160px] rounded-[8px] border border-[#33465f] bg-[#0d1a2b] px-2 text-[13px] text-white"
            />
          </label>
        ) : null}
      </nav>

      {!ready && gate.kind !== "loading" ? (
        <GateNotice gate={gate} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : null}
      {gate.kind === "loading" ? (
        <p className="text-[12px] text-white/60">Loading…</p>
      ) : null}

      {notFound ? (
        <p role="alert" className="text-[13px] text-white/70">
          This partner was not found. Go back to Partners and pick a partner.
        </p>
      ) : null}

      {ready && partner ? (
        <>
          <div className="max-sm:order-last">
            <PartnerHowTo money={seeMoney} />
          </div>

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

          {/* 信息行：名字、状态，Rename / Timetable / Deactivate（手机收进 ⋯）。 */}
          {/* 不裁边：手机上 ⋯ 点开的菜单要能伸出卡片。 */}
          <section
            className={CARD_CLASS.replace("overflow-hidden", "")}
            aria-label="Partner"
            data-partner={partner.name}
          >
            <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 px-4 py-3 text-[12.5px] text-[#1a1a1a] night:text-white/85">
              {renaming ? (
                <span className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    aria-label="Partner name"
                    autoFocus
                    value={renaming.name}
                    onChange={(e) =>
                      setRenaming({ name: e.target.value, error: null })
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
                      className="text-[12px] text-[#A32D2D] night:text-red-300"
                    >
                      {renaming.error}
                    </span>
                  ) : null}
                </span>
              ) : (
                <b data-partner-title className="text-[14px]">
                  {partner.name}
                </b>
              )}
              <span data-status>
                Status: <b>{partner.is_active ? "Active" : "Inactive"}</b>
              </span>
              <span
                className={cn(
                  "ml-auto inline-flex items-center gap-1.5",
                  PAPER_PHONE_MORE,
                )}
              >
                <PhoneMore label="More partner actions">
                  <button
                    type="button"
                    className={BTN_EDIT_CLASS}
                    disabled={!!renaming}
                    onClick={() =>
                      setRenaming({ name: partner.name, error: null })
                    }
                  >
                    Rename
                  </button>
                  {/* 每家自己的时刻表（G199）；146 Q6 A：照旧一个跳页键。 */}
                  <Link
                    href={`${partnerHref(partner.id)}/timetable`}
                    data-timetable-link
                    className={cn(BTN_EDIT_CLASS, "no-underline")}
                  >
                    Timetable
                  </Link>
                  {partner.is_active ? (
                    <button
                      type="button"
                      className={BTN_OFF_CLASS}
                      onClick={() => setDeactivating(true)}
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={BTN_ON_CLASS}
                      onClick={() => void reactivate()}
                    >
                      Reactivate
                    </button>
                  )}
                </PhoneMore>
              </span>
            </div>
          </section>

          {seeMoney ? (
            <section
              className={CARD_CLASS}
              aria-label="Tours with products"
              data-tours-with-products
            >
              <div className={CARD_HEADER_CLASS}>
                <h2 className={CARD_TITLE_CLASS}>Tours with products</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-[12px]">
                  <thead>
                    <tr>
                      <th className={TH_CLASS}>Tour / Product</th>
                      <th className={cn(TH_CLASS, "text-right")}>Adult</th>
                      <th className={cn(TH_CLASS, "text-right")}>Child</th>
                      <th className={cn(TH_CLASS, "text-right")}>Infant</th>
                      <th className={cn(TH_CLASS, "w-0")}>
                        <span className="sr-only">Status</span>
                      </th>
                      <th className={TH_CLASS}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className={TBODY_CLASS}>
                    {rates === "error" ? (
                      <tr>
                        <td
                          colSpan={6}
                          className={cn(TD_CLASS, "text-[#A32D2D]")}
                        >
                          Could not load this partner&apos;s prices.{" "}
                          <button
                            type="button"
                            className={BTN_EDIT_CLASS}
                            onClick={() => setReloadKey((k) => k + 1)}
                          >
                            Retry
                          </button>
                        </td>
                      </tr>
                    ) : withProducts.length === 0 ? (
                      <tr>
                        <td colSpan={6} className={cn(TD_CLASS, "text-center")}>
                          {rates && rates.length === 0
                            ? "No tours yet."
                            : "No tours with products yet."}
                        </td>
                      </tr>
                    ) : (
                      tourRows(withProducts)
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className={CARD_CLASS}>
            <PartnerDetail
              partnerId={partner.id}
              partnerName={partner.name}
              onUnauthorized={redirectToLogin}
              onDirty={setLocDirty}
            />
          </section>

          {seeMoney && empty.length > 0 ? (
            <section className={CARD_CLASS} data-empty-tours>
              <button
                type="button"
                aria-expanded={emptyOpen}
                disabled={editingInEmpty}
                title={
                  editingInEmpty
                    ? "Save or cancel the prices you are editing first."
                    : ""
                }
                onClick={() => setShowEmpty((v) => !v)}
                className="flex w-full cursor-pointer flex-wrap items-center gap-2 border-none bg-[#f4f6f8] px-4 py-[11px] text-left text-[12.5px] text-[#1a1a1a] hover:bg-[#eceff3] disabled:cursor-not-allowed night:bg-white/[.03] night:text-white/80 night:hover:bg-white/[.06]"
              >
                <span>
                  <b data-empty-count>
                    {emptyOpen ? "▾" : "▸"} {empty.length}{" "}
                    {empty.length === 1 ? "tour" : "tours"} with no products yet
                  </b>
                  {emptyOpen ? null : (
                    <span
                      data-empty-names
                      className="text-[#6b7280] max-sm:hidden night:text-white/50"
                    >
                      : {empty.map((r) => r.tour_name).join(", ")}
                    </span>
                  )}
                </span>
                <span aria-hidden>·</span>
                <span
                  className={cn(
                    "font-semibold text-[#185FA5] night:text-[#93c5fd]",
                    editingInEmpty && "opacity-45",
                  )}
                >
                  {emptyOpen ? "Hide" : "Show"}
                </span>
              </button>
              {emptyOpen ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-[12px]">
                    <tbody className={TBODY_CLASS}>{tourRows(empty)}</tbody>
                  </table>
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}

      {deactivating && partner ? (
        <ConfirmDialog
          title={`Deactivate "${partner.name}"?`}
          confirmLabel="Deactivate"
          busyLabel="Deactivating…"
          onConfirm={confirmDeactivate}
          onClose={() => setDeactivating(false)}
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

/**
 * 单家页的 How to use（preview v2「How to use — one partner's page」原文）。
 * money = false（没勾 orders.money_view）：不讲团、产品和价格。
 */
function PartnerHowTo({ money }: { money: boolean }) {
  return (
    <LegacyHowTo title="How to use — Farm out Partner" padY="py-2.5">
      {money ? (
        <>
          <li>
            Find the tour and click Edit. Tours with no products yet are folded
            into one line at the bottom of the page (for example ▸ 6 tours with
            no products yet). Click the line to show them, then click Edit on
            the tour. Once a tour is saved with a product, it moves up with the
            other tours.
          </li>
          {RATES_HOW_TO.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </>
      ) : null}
      <li>
        Pick-up locations are this partner&apos;s own hotels (not linked to our
        Pickup Locations). Their order here is the order shown in Dispatch.
        Click Save locations to keep your changes. To change or add many at
        once, click ⬆ Import, then ⬇ Download template (this partner&apos;s
        locations), change or add rows in Excel, choose the file, check the
        preview and click Save. Rows are matched by Hotel; a blank cell never
        clears a box; rows marked Error are not saved.
      </li>
      <li>
        Rename changes the name shown in this system. Deactivate hides the
        partner from the Farm out choice in Dispatch; orders already farmed out
        to it are not changed, and you can Reactivate at any time. Timetable
        opens this partner&apos;s timetable.
      </li>
      <li>
        To go to another partner, pick it in the Partner list at the top or
        click ‹ Partners. If you have unsaved prices or locations, you are asked
        first.
      </li>
    </LegacyHowTo>
  );
}

/** G263 v3 定稿的价格说明（第 2–7 条，原文不变；第 1 条换成单家页的找团说明，Import rates 那条留在列表页）。 */
export const RATES_HOW_TO = [
  "Each tour lists its products. Click + Add product and type its name (for example Premium Pass, Admission Only). Names must be different within a tour. ↑ ↓ change the order; × removes a product. Everywhere else the system shows the full name: tour, product and partner, for example West Rim Premium Pass - C Tour.",
  "Prices: under each product, click + Add price, choose Adult, Child or Infant and type the price. Same price for adults and children? Add an Adult row and a Child row with the same price. × removes a price row.",
  "Click Save on the tour. Nothing is kept until you do.",
  "In Dispatch › Farm out guests, pick the product for each order. A tour with only one product uses it automatically. The payable is the product's price for each ticket type; infants with no price count as 0.",
  "An order with more than one product: pick one of them, then type the payable by hand.",
  "If the product has no Adult or Child price, the order shows “no adult rate” (or child) and its payable stays empty. Add the price here, then pick the product again on the order, or type the payable by hand. Changing a price here does not change orders that already have a payable.",
];
