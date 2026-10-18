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
  savePartnerLocations,
} from "@/lib/farm-out-api";
import { cn } from "@/lib/utils";
import type { FarmOutLocation } from "@/types/farm-out";

import { BTN_BLUE, CELL_INPUT, ResultLine } from "./ui";

type Result = { tone: "ok" | "error"; text: string } | null;

interface LocationDraft {
  id: number | null;
  hotel_name: string;
  spot: string;
  address: string;
  map_link: string;
  /** 只用来给新行做 React key。 */
  key: string;
}

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

/** 一家合作公司展开后：它自己的上车点表（结算价在列表里每个团一行直接改）（不连我们的 Pickup Locations，Annie 2026-10-15）。 */
export function PartnerDetail({
  partnerId,
  onUnauthorized,
}: {
  partnerId: number;
  onUnauthorized: () => void;
}) {
  const [locations, setLocations] = useState<LocationDraft[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locResult, setLocResult] = useState<Result>(null);
  const [savingLocs, setSavingLocs] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    (async () => {
      try {
        const l = await fetchPartnerLocations(partnerId);
        if (controller.signal.aborted) return;
        setLocations(toLocationDrafts(l));
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else setLoadError(describeError(error));
      }
    })();
    return () => controller.abort();
  }, [partnerId, reloadKey, onUnauthorized]);

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
  if (!locations) {
    return (
      <div className="px-4 py-3 text-[12px] text-[#1a1a1a] night:text-white/60">
        Loading…
      </div>
    );
  }

  return (
    <div className="grid gap-5 px-4 py-4">
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
