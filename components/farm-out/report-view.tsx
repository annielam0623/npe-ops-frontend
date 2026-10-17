"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DateRangeFilter,
  type DateRangeValue,
} from "@/components/promotion-stats/date-range-filter";
import {
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_TITLE_CLASS,
  LegacyPageHeader,
  TBODY_CLASS,
  TD_CLASS,
  TH_CLASS,
  TR_CLASS,
} from "@/components/pickup-locations/legacy-ui";
import { HowToUse } from "@/components/ui/how-to-use";
import { describeError, isStatus } from "@/lib/api-errors";
import { farmOutReportCsvUrl, fetchFarmOutReport } from "@/lib/farm-out-api";
import { fetchCurrentUser } from "@/lib/auth-api";
import { laToday, shiftYmd } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { FarmOutReport } from "@/types";

type View =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: FarmOutReport };

const EMPTY_RANGE: DateRangeValue = { from: "", to: "" };
const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Farm out Report（G40 任务包第 24 条）：转单的财务报表，按日期范围 / 合作公司筛，能导出 CSV。
 * 列照任务包：日期、团、订单号、OTA 确认号、客人、成人数、儿童数、转给谁、经手人、客人实付、应付对方、差额。
 */
export function FarmOutReportView() {
  const [draftRange, setDraftRange] = useState<DateRangeValue>(EMPTY_RANGE);
  const [appliedRange, setAppliedRange] = useState<DateRangeValue>(EMPTY_RANGE);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [view, setView] = useState<View>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  const { from, to } = appliedRange;

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const me = await fetchCurrentUser(controller.signal);
        if (controller.signal.aborted) return;
        if (!me.is_admin) {
          setView({ kind: "forbidden" });
          return;
        }
        const data = await fetchFarmOutReport(
          {
            date_from: from || shiftYmd(laToday(), -30),
            date_to: to || laToday(),
            partner_id: partnerId ?? undefined,
          },
          controller.signal,
        );
        if (!controller.signal.aborted) setView({ kind: "ready", data });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setView({ kind: "forbidden" });
        else setView({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [from, to, partnerId, reloadKey, redirectToLogin]);

  function handleApply(hasIncompleteInput: boolean) {
    if (hasIncompleteInput) {
      setRangeError("Enter a complete date, or clear that box.");
      return;
    }
    if (draftRange.from && draftRange.to && draftRange.from > draftRange.to) {
      setRangeError("The start date can't be after the end date.");
      return;
    }
    setRangeError(null);
    setAppliedRange(draftRange);
    setReloadKey((k) => k + 1);
  }

  function handleClear() {
    setRangeError(null);
    setDraftRange(EMPTY_RANGE);
    setAppliedRange(EMPTY_RANGE);
    setPartnerId(null);
    setReloadKey((k) => k + 1);
  }

  const data = view.kind === "ready" ? view.data : null;
  const rows = data?.rows ?? [];
  const totals = rows.reduce(
    (acc, r) => ({
      adults: acc.adults + r.adults,
      children: acc.children + r.children,
      guestPaid: acc.guestPaid + r.guest_paid,
      payable: acc.payable + r.payable,
      difference: acc.difference + r.difference,
    }),
    { adults: 0, children: 0, guestPaid: 0, payable: 0, difference: 0 },
  );

  return (
    <main className="text-stone-800 night:text-white/90">
      <LegacyPageHeader
        title="Farm out Report"
        count={data ? `${rows.length} order${rows.length === 1 ? "" : "s"}` : undefined}
      />
      <div className="mb-5 flex flex-wrap items-end gap-2.5">
        <DateRangeFilter
          value={draftRange}
          error={rangeError}
          onChange={setDraftRange}
          onApply={handleApply}
          onClear={handleClear}
        />
        <label className="flex items-center gap-2 text-[13px] text-[#94a3b8] night:text-white/45">
          Partner
          <select
            value={partnerId ?? ""}
            onChange={(e) =>
              setPartnerId(e.target.value ? Number(e.target.value) : null)
            }
            className="h-8 rounded-[7px] border-[0.5px] border-black/15 bg-paper px-2.5 text-[13px] text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/90"
          >
            <option value="">All partners</option>
            {(data?.partners ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <a
          href={farmOutReportCsvUrl({
            date_from: from || shiftYmd(laToday(), -30),
            date_to: to || laToday(),
            partner_id: partnerId ?? undefined,
          })}
          className="ml-auto inline-flex h-8 cursor-pointer items-center justify-center rounded-[10px] border border-white/10 bg-white/[.04] px-3.5 text-[13px] font-[650] text-white transition hover:bg-white/[.08]"
        >
          ⬇ Export CSV
        </a>
      </div>

      {view.kind === "loading" ? (
        <div className={CARD_CLASS}>
          <p className="m-0 p-4 text-[13px]">Loading…</p>
        </div>
      ) : view.kind === "forbidden" ? (
        <div className={CARD_CLASS}>
          <p className="m-0 p-4 text-[13px]">
            Admin access required. Only admins can see the farm out report.
          </p>
        </div>
      ) : view.kind === "error" ? (
        <div className={CARD_CLASS}>
          <p role="alert" className="m-0 p-4 text-[13px] text-[#A32D2D]">
            Could not load the report: {view.message}
          </p>
        </div>
      ) : (
        <div className={CARD_CLASS}>
          <div className={CARD_HEADER_CLASS}>
            <span className={CARD_TITLE_CLASS}>Farmed-out orders</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-[12px] tabular-nums">
              <thead>
                <tr>
                  <th className={TH_CLASS}>Date</th>
                  <th className={TH_CLASS}>Tour</th>
                  <th className={TH_CLASS}>Order#</th>
                  <th className={TH_CLASS}>OTA conf#</th>
                  <th className={TH_CLASS}>Guest</th>
                  <th className={TH_CLASS}>Adults</th>
                  <th className={TH_CLASS}>Children</th>
                  <th className={TH_CLASS}>Partner</th>
                  <th className={TH_CLASS}>Handled by</th>
                  <th className={cn(TH_CLASS, "text-right")}>Guest paid</th>
                  <th className={cn(TH_CLASS, "text-right")}>Payable</th>
                  <th className={cn(TH_CLASS, "text-right")}>Difference</th>
                </tr>
              </thead>
              <tbody className={TBODY_CLASS}>
                {rows.map((r) => (
                  <tr key={r.order_number} className={TR_CLASS}>
                    <td className={TD_CLASS}>
                      {new Date(`${r.run_date}T00:00:00`).toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric" },
                      )}
                    </td>
                    <td className={TD_CLASS}>{r.tour_name}</td>
                    <td className={TD_CLASS}>{r.order_number}</td>
                    <td className={TD_CLASS}>{r.confirmation}</td>
                    <td className={TD_CLASS}>{r.guest_name}</td>
                    <td className={TD_CLASS}>{r.adults}</td>
                    <td className={TD_CLASS}>{r.children}</td>
                    <td className={TD_CLASS}>{r.partner_name}</td>
                    <td className={TD_CLASS}>{r.handled_by}</td>
                    <td className={cn(TD_CLASS, "text-right")}>
                      {money(r.guest_paid)}
                    </td>
                    <td
                      className={cn(TD_CLASS, "text-right")}
                      title={
                        r.payable_edited
                          ? `Changed by ${r.payable_edited_by}, ${r.payable_edited_at}`
                          : undefined
                      }
                    >
                      {money(r.payable)}
                      {r.payable_edited ? (
                        <span className="ml-1 text-[#1d4ed8]">✎</span>
                      ) : null}
                    </td>
                    <td className={cn(TD_CLASS, "text-right")}>
                      {money(r.difference)}
                    </td>
                  </tr>
                ))}
                {rows.length ? (
                  <tr className="bg-[#efeee8] font-semibold night:bg-white/[.06]">
                    <td className={TD_CLASS} colSpan={5}>
                      Total · {rows.length} order{rows.length === 1 ? "" : "s"}
                    </td>
                    <td className={TD_CLASS}>{totals.adults}</td>
                    <td className={TD_CLASS}>{totals.children}</td>
                    <td className={TD_CLASS} colSpan={2} />
                    <td className={cn(TD_CLASS, "text-right")}>
                      {money(totals.guestPaid)}
                    </td>
                    <td className={cn(TD_CLASS, "text-right")}>
                      {money(totals.payable)}
                    </td>
                    <td className={cn(TD_CLASS, "text-right")}>
                      {money(totals.difference)}
                    </td>
                  </tr>
                ) : (
                  <tr>
                    <td
                      className={cn(TD_CLASS, "text-center")}
                      colSpan={12}
                    >
                      No farmed-out orders for this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <HowToUse
        title="How to use — Farm out Report"
        items={[
          "Shows every order farmed out to a partner, for the date range and partner above. Defaults to the last 30 days.",
          "Payable is what we owe the partner, automatically calculated from Settings → Farm out Partners; a ✎ means staff changed it by hand — hover to see who and when.",
          "Difference is what the guest paid minus what we owe the partner.",
          "Click ⬇ Export CSV to download the same rows as a file.",
        ]}
      />
    </main>
  );
}
