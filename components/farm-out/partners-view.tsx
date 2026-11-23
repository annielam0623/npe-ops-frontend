"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BTN_SUBMIT_CLASS,
  BTN_EDIT_CLASS,
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
import { BulkImportButton, StandardImport } from "@/components/ui/bulk-import";
import { ErrorBanner } from "@/components/ui/panel";
import { PhoneMore, usePhoneCollapse } from "@/components/ui/phone";
import { fetchActionLog } from "@/lib/action-log";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  createPartner,
  fetchPartnerRates,
  fetchPartners,
} from "@/lib/farm-out-api";
import { usePermissions } from "@/lib/staff-permissions";
import { csvBlob } from "@/lib/csv";
import { cn } from "@/lib/utils";
import type {
  FarmOutPartner,
  FarmOutPrice,
  FarmOutRate,
} from "@/types/farm-out";

import { gateFromError, type LoadGate } from "./config";
import {
  GateNotice,
  PAPER_PHONE_MORE,
  ResultLine,
  useRedirectToLogin,
} from "./ui";

/**
 * Settings → Farm out Partners：合作公司名单（第 8 件，Annie 11-20「8-Q7–Q11 都 A | 动手」，preview v2
 * https://claude.ai/artifact/9eCQCXvHoEDaEDgsU3uYks）。Q5 Annie「我需要每个partner一页」⇒ 这里只列公司，
 * 点名字 / Open › 进每家自己的页（/settings/farm-out-partners/<id>，partner-page.tsx）。
 * Q9 A：Add Partner、⬆ Import rates（所有公司一个文件）、改动记录留在这一页；Add 后直接打开新公司的页。
 * Q10 A：列 Partner | Tours with products | Status | Open ›；Rename / Timetable / Deactivate 搬到每家的页。
 */
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

/** 有产品的团（价格表里至少一个产品）。 */
export const hasProducts = (r: FarmOutRate) => (r.products ?? []).length > 0;

export const partnerHref = (id: number) => `/settings/farm-out-partners/${id}`;

/** 读每家的价格（读不出来的公司记 "error"，401 往外抛）。 */
async function loadRates(
  list: FarmOutPartner[],
): Promise<Record<number, FarmOutRate[] | "error">> {
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
  return Object.fromEntries(entries);
}

export function PartnersView() {
  const router = useRouter();
  const [gate, setGate] = useState<LoadGate>({ kind: "loading" });
  const [partners, setPartners] = useState<FarmOutPartner[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** 每家公司每个团的价格（算「Tours with products」和 Import 模板）；读不出来的公司是 "error"。 */
  const [rates, setRates] = useState<Record<number, FarmOutRate[] | "error">>(
    {},
  );
  const [importOpen, setImportOpen] = useState(false);
  const [logVersion, setLogVersion] = useState(0);
  const redirectToLogin = useRedirectToLogin();
  const perms = usePermissions();
  const addFold = usePhoneCollapse();
  // 没勾 See prices, agent & commission（orders.money_view，题 8）：价格相关的列、Import rates 都不出，也不请求价格。
  const seeMoney = perms.canSeeMoney;

  /** 导入存好后静悄悄重拉（不回到 Loading，Import 块留着）。 */
  const refreshAll = useCallback(async () => {
    setLogVersion((v) => v + 1);
    try {
      const list = await fetchPartners();
      const r = await loadRates(list);
      setPartners(list);
      setRates(r);
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
        const r = await loadRates(list);
        if (controller.signal.aborted) return;
        setRates(r);
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

  /** 停用的排最后、变灰（preview v2 第 1 页）；同组照后端顺序。 */
  const ordered = useMemo(
    () => [
      ...partners.filter((p) => p.is_active),
      ...partners.filter((p) => !p.is_active),
    ],
    [partners],
  );

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
      setAddResult({ tone: "ok", text: "✓ Added" });
      // Q9 A：加好直接打开新公司的页，接着加团、价格和上车点。
      router.push(partnerHref(created.id));
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else setAddResult({ tone: "error", text: describeError(error) });
    } finally {
      setAdding(false);
    }
  }

  const ready = gate.kind === "ready";

  return (
    <main className="text-stone-800 max-sm:flex max-sm:flex-col night:text-white/90">
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
          {/* 手机上 How to use 放页面最底（手机版统一规则）。 */}
          <div className="max-sm:order-last">
            <ListHowTo money={seeMoney} />
          </div>

          <section className={CARD_CLASS}>
            <div className={CARD_HEADER_CLASS}>
              <h2 className={cn(CARD_TITLE_CLASS, "flex w-full items-center")}>
                <button
                  type="button"
                  onClick={addFold.toggle}
                  aria-expanded={addFold.open}
                  className="pointer-events-none flex w-full items-center text-left max-sm:pointer-events-auto"
                >
                  + Add Partner
                  {addFold.caret}
                </button>
              </h2>
            </div>
            <form
              className={cn(
                "flex flex-wrap items-center gap-3 px-5 py-[18px]",
                addFold.hide,
              )}
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
                className={cn(FORM_INPUT_CLASS, "w-[260px] max-sm:w-full")}
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
              statusText={{ new: "New product" }}
              labelColumn="product"
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

          <section className={CARD_CLASS} aria-label="Partners">
            <div className={CARD_HEADER_CLASS}>
              <h2 className={CARD_TITLE_CLASS}>Partners</h2>
              {seeMoney ? (
                <span className={PAPER_PHONE_MORE}>
                  <PhoneMore label="More partner actions">
                    <BulkImportButton
                      onClick={() => setImportOpen(true)}
                      disabled={importOpen}
                    />
                  </PhoneMore>
                </span>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[12px] max-sm:min-w-0">
                <thead className="max-sm:hidden">
                  <tr>
                    <th className={TH_CLASS}>Partner</th>
                    {seeMoney ? (
                      <th className={TH_CLASS}>Tours with products</th>
                    ) : null}
                    <th className={TH_CLASS}>Status</th>
                    <th className={TH_CLASS}>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody className={TBODY_CLASS}>
                  {ordered.length === 0 ? (
                    <tr>
                      <td
                        colSpan={seeMoney ? 4 : 3}
                        className={cn(TD_CLASS, "text-center")}
                      >
                        No partners yet.
                      </td>
                    </tr>
                  ) : (
                    ordered.map((p) => {
                      const list = rates[p.id];
                      const count =
                        list === "error"
                          ? null
                          : Array.isArray(list)
                            ? `${list.filter(hasProducts).length} of ${list.length}`
                            : null;
                      const none =
                        Array.isArray(list) && !list.some(hasProducts);
                      const status = p.is_active ? "Active" : "Inactive";
                      return (
                        <tr
                          key={p.id}
                          className={cn(TR_CLASS, !p.is_active && "opacity-60")}
                          data-partner={p.name}
                        >
                          <td className={cn(TD_CLASS, "font-semibold")}>
                            <Link
                              href={partnerHref(p.id)}
                              data-partner-link
                              className="text-[#185FA5] no-underline hover:underline night:text-[#93c5fd]"
                            >
                              {p.name}
                            </Link>
                            <span className="mt-0.5 block text-[11px] font-normal text-[#6b7280] sm:hidden night:text-white/50">
                              {seeMoney && count
                                ? `${count} tours with products · `
                                : ""}
                              {status}
                            </span>
                          </td>
                          {seeMoney ? (
                            <td
                              data-tours-with-products
                              className={cn(
                                TD_CLASS,
                                "max-sm:hidden",
                                none && "text-[#6b7280] night:text-white/45",
                              )}
                            >
                              {count ??
                                (list === "error" ? (
                                  <span className="text-[#A32D2D] night:text-red-300">
                                    Could not load
                                  </span>
                                ) : (
                                  "—"
                                ))}
                            </td>
                          ) : null}
                          <td
                            data-status
                            className={cn(TD_CLASS, "max-sm:hidden")}
                          >
                            {status}
                          </td>
                          <td
                            className={cn(
                              TD_CLASS,
                              "text-right whitespace-nowrap",
                            )}
                          >
                            <Link
                              href={partnerHref(p.id)}
                              aria-label={`Open ${p.name}`}
                              className={cn(BTN_EDIT_CLASS, "no-underline")}
                            >
                              Open ›
                            </Link>
                          </td>
                        </tr>
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
    </main>
  );
}

/** 列表页的 How to use（preview v2「How to use — Farm out Partners (the list)」原文）。money = false：不讲价格和 Import rates。 */
function ListHowTo({ money }: { money: boolean }) {
  return (
    <LegacyHowTo title="How to use — Farm out Partners" padY="py-2.5">
      <li>
        Click a partner&apos;s name to open its own page: its tours
        {money ? " and prices" : ""}, its pick-up locations and its timetable.
      </li>
      <li>
        Add a partner: type its name and click Add. Its page opens so you can
        add its {money ? "tours, prices and " : ""}pick-up locations.
      </li>
      {money ? (
        <>
          <li>
            Tours with products shows how many of the partner&apos;s tours
            already have a product with a price.
          </li>
          <li>{IMPORT_RATES_HOW_TO}</li>
        </>
      ) : null}
      <li>
        Inactive partners are greyed out at the bottom of the list. Open one to
        reactivate it.
      </li>
    </LegacyHowTo>
  );
}

export const IMPORT_RATES_HOW_TO =
  "⬆ Import rates (all partners in one file): the file has the columns Partner, Tour, Product, Adult, Child, Infant. Rows are matched by partner, tour and product name; the product can be the short name (Premium Pass) or the full name (West Rim Premium Pass - C Tour). A blank cell changes nothing. A product name that is not on the tour yet is added as a new product. Partners and tours must already be here.";
