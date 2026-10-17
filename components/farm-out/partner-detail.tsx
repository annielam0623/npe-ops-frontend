"use client";

import { useCallback, useEffect, useState } from "react";

import {
  BTN_ADD_SMALL_CLASS,
  BTN_DELETE_CLASS,
  BTN_EDIT_CLASS,
  TBODY_CLASS,
  TD_CLASS,
  TH_CLASS,
  TR_CLASS,
} from "@/components/pickup-locations/legacy-ui";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchPartnerLocations,
  fetchPartnerRates,
  savePartnerLocations,
  savePartnerRates,
} from "@/lib/farm-out-api";
import { cn } from "@/lib/utils";
import type { FarmOutLocation, FarmOutRate } from "@/types/farm-out";

import { parsePriceInput, priceText } from "./config";
import { BTN_BLUE, CELL_INPUT, ResultLine } from "./ui";

type Result = { tone: "ok" | "error"; text: string } | null;

interface RateDraft {
  manifest_id: number;
  tour_name: string;
  adult: string;
  child: string;
}

interface LocationDraft {
  id: number | null;
  hotel_name: string;
  spot: string;
  address: string;
  map_link: string;
  /** 只用来给新行做 React key。 */
  key: string;
}

const toRateDrafts = (rates: FarmOutRate[]): RateDraft[] =>
  rates.map((r) => ({
    manifest_id: r.manifest_id,
    tour_name: r.tour_name,
    adult: priceText(r.adult_price),
    child: priceText(r.child_price),
  }));

let newKey = 0;
const toLocationDrafts = (locs: FarmOutLocation[]): LocationDraft[] =>
  [...locs]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((l) => ({
      id: l.id,
      hotel_name: l.hotel_name,
      spot: l.spot,
      address: l.address,
      map_link: l.map_link,
      key: l.id != null ? `id-${l.id}` : `new-${newKey++}`,
    }));

/** 一家合作公司展开后：结算价表 + 它自己的上车点表（不连我们的 Pickup Locations，Annie 2026-10-15）。 */
export function PartnerDetail({
  partnerId,
  onUnauthorized,
}: {
  partnerId: number;
  onUnauthorized: () => void;
}) {
  const [rates, setRates] = useState<RateDraft[] | null>(null);
  const [locations, setLocations] = useState<LocationDraft[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rateResult, setRateResult] = useState<Result>(null);
  const [locResult, setLocResult] = useState<Result>(null);
  const [savingRates, setSavingRates] = useState(false);
  const [savingLocs, setSavingLocs] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    (async () => {
      try {
        const [r, l] = await Promise.all([
          fetchPartnerRates(partnerId),
          fetchPartnerLocations(partnerId),
        ]);
        if (controller.signal.aborted) return;
        setRates(toRateDrafts(r));
        setLocations(toLocationDrafts(l));
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else setLoadError(describeError(error));
      }
    })();
    return () => controller.abort();
  }, [partnerId, reloadKey, onUnauthorized]);

  const saveRates = useCallback(async () => {
    if (!rates || savingRates) return;
    const body: FarmOutRate[] = [];
    for (const r of rates) {
      const adult = parsePriceInput(r.adult);
      const child = parsePriceInput(r.child);
      if (adult === undefined || child === undefined) {
        setRateResult({
          tone: "error",
          text: `${r.tour_name}: prices must be numbers like 105 or 105.00.`,
        });
        return;
      }
      body.push({
        manifest_id: r.manifest_id,
        tour_name: r.tour_name,
        adult_price: adult,
        child_price: child,
      });
    }
    setSavingRates(true);
    setRateResult(null);
    try {
      const saved = await savePartnerRates(partnerId, body);
      setRates(toRateDrafts(saved));
      setRateResult({ tone: "ok", text: "✓ Saved" });
    } catch (error) {
      if (isStatus(error, 401)) onUnauthorized();
      else setRateResult({ tone: "error", text: describeError(error) });
    } finally {
      setSavingRates(false);
    }
  }, [rates, savingRates, partnerId, onUnauthorized]);

  const saveLocations = useCallback(async () => {
    if (!locations || savingLocs) return;
    const blank = locations.findIndex((l) => !l.hotel_name.trim());
    if (blank >= 0) {
      setLocResult({
        tone: "error",
        text: `Row ${blank + 1}: hotel name is required.`,
      });
      return;
    }
    setSavingLocs(true);
    setLocResult(null);
    try {
      const saved = await savePartnerLocations(
        partnerId,
        locations.map((l, i) => ({
          id: l.id,
          hotel_name: l.hotel_name.trim(),
          spot: l.spot.trim(),
          address: l.address.trim(),
          map_link: l.map_link.trim(),
          sort_order: i,
        })),
      );
      setLocations(toLocationDrafts(saved));
      setLocResult({ tone: "ok", text: "✓ Saved" });
    } catch (error) {
      if (isStatus(error, 401)) onUnauthorized();
      else setLocResult({ tone: "error", text: describeError(error) });
    } finally {
      setSavingLocs(false);
    }
  }, [locations, savingLocs, partnerId, onUnauthorized]);

  function patchRate(i: number, patch: Partial<RateDraft>) {
    setRates((all) =>
      all ? all.map((r, j) => (j === i ? { ...r, ...patch } : r)) : all,
    );
  }
  function patchLocation(i: number, patch: Partial<LocationDraft>) {
    setLocations((all) =>
      all ? all.map((l, j) => (j === i ? { ...l, ...patch } : l)) : all,
    );
  }
  function moveLocation(i: number, dir: -1 | 1) {
    setLocations((all) => {
      if (!all || i + dir < 0 || i + dir >= all.length) return all;
      const next = [...all];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next;
    });
  }

  if (loadError) {
    return (
      <div className="px-4 py-3 text-[12px] text-[#A32D2D] night:text-red-300">
        Could not load this partner: {loadError}{" "}
        <button
          type="button"
          className={BTN_EDIT_CLASS}
          onClick={() => setReloadKey((k) => k + 1)}
        >
          Retry
        </button>
      </div>
    );
  }
  if (!rates || !locations) {
    return (
      <div className="px-4 py-3 text-[12px] text-[#1a1a1a] night:text-white/60">
        Loading…
      </div>
    );
  }

  return (
    <div className="grid gap-5 px-4 py-4">
      {/* 结算价 */}
      <section aria-label="Settlement rates">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h3 className="text-[13px] font-semibold text-[#1a1a1a] night:text-white/90">
            Settlement rates
          </h3>
          <span className="text-[11px] text-[#1a1a1a] night:text-white/50">
            What we pay this partner per guest. Infants are not counted. Leave a
            price empty if it is not set.
          </span>
          <span className="ml-auto flex items-center gap-3">
            <ResultLine result={rateResult} />
            <button
              type="button"
              className={BTN_BLUE}
              disabled={savingRates}
              onClick={() => void saveRates()}
            >
              {savingRates ? "Saving…" : "Save rates"}
            </button>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[12px]">
            <thead>
              <tr>
                <th className={TH_CLASS}>Tour</th>
                <th className={TH_CLASS}>Adult</th>
                <th className={TH_CLASS}>Child</th>
              </tr>
            </thead>
            <tbody className={TBODY_CLASS}>
              {rates.length === 0 ? (
                <tr>
                  <td colSpan={3} className={cn(TD_CLASS, "text-center")}>
                    No tours yet.
                  </td>
                </tr>
              ) : (
                rates.map((r, i) => (
                  <tr key={r.manifest_id} className={TR_CLASS}>
                    <td className={TD_CLASS}>{r.tour_name}</td>
                    <td className={TD_CLASS}>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`${r.tour_name} adult price`}
                        placeholder="not set"
                        value={r.adult}
                        onChange={(e) => patchRate(i, { adult: e.target.value })}
                        className={cn(CELL_INPUT, "w-[96px]")}
                      />
                    </td>
                    <td className={TD_CLASS}>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`${r.tour_name} child price`}
                        placeholder="not set"
                        value={r.child}
                        onChange={(e) => patchRate(i, { child: e.target.value })}
                        className={cn(CELL_INPUT, "w-[96px]")}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 上车点 */}
      <section aria-label="Pick-up locations">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h3 className="text-[13px] font-semibold text-[#1a1a1a] night:text-white/90">
            Pick-up locations
          </h3>
          <span className="text-[11px] text-[#1a1a1a] night:text-white/50">
            This partner&apos;s own hotels. They are not linked to our Pickup
            Locations. Order here is the order in Dispatch.
          </span>
          <span className="ml-auto flex items-center gap-3">
            <ResultLine result={locResult} />
            <button
              type="button"
              className={BTN_BLUE}
              disabled={savingLocs}
              onClick={() => void saveLocations()}
            >
              {savingLocs ? "Saving…" : "Save locations"}
            </button>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[12px]">
            <thead>
              <tr>
                <th className={TH_CLASS}>Hotel</th>
                <th className={TH_CLASS}>Spot</th>
                <th className={TH_CLASS}>Address</th>
                <th className={TH_CLASS}>Map link</th>
                <th className={TH_CLASS}>Order</th>
              </tr>
            </thead>
            <tbody className={TBODY_CLASS}>
              {locations.length === 0 ? (
                <tr>
                  <td colSpan={5} className={cn(TD_CLASS, "text-center")}>
                    No locations yet.
                  </td>
                </tr>
              ) : (
                locations.map((l, i) => (
                  <tr key={l.key} className={TR_CLASS}>
                    {(
                      [
                        ["hotel_name", "Hotel name", "w-[150px]"],
                        ["spot", "Spot", "w-[170px]"],
                        ["address", "Address", "w-[210px]"],
                        ["map_link", "Map link", "w-[190px]"],
                      ] as const
                    ).map(([field, label, width]) => (
                      <td key={field} className={TD_CLASS}>
                        <input
                          type="text"
                          aria-label={`${label} ${i + 1}`}
                          value={l[field]}
                          onChange={(e) =>
                            patchLocation(i, { [field]: e.target.value })
                          }
                          className={cn(CELL_INPUT, width)}
                        />
                      </td>
                    ))}
                    <td className={cn(TD_CLASS, "whitespace-nowrap")}>
                      <span className="inline-flex gap-1">
                        <button
                          type="button"
                          aria-label={`Move ${l.hotel_name || "row"} up`}
                          disabled={i === 0}
                          className={BTN_EDIT_CLASS}
                          onClick={() => moveLocation(i, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${l.hotel_name || "row"} down`}
                          disabled={i === locations.length - 1}
                          className={BTN_EDIT_CLASS}
                          onClick={() => moveLocation(i, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${l.hotel_name || "row"}`}
                          className={BTN_DELETE_CLASS}
                          onClick={() =>
                            setLocations((all) =>
                              all ? all.filter((_, j) => j !== i) : all,
                            )
                          }
                        >
                          Delete
                        </button>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2">
          <button
            type="button"
            className={BTN_ADD_SMALL_CLASS}
            onClick={() =>
              setLocations((all) => [
                ...(all ?? []),
                {
                  id: null,
                  hotel_name: "",
                  spot: "",
                  address: "",
                  map_link: "",
                  key: `new-${newKey++}`,
                },
              ])
            }
          >
            + Add location
          </button>
        </div>
      </section>
    </div>
  );
}
