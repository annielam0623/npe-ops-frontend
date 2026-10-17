"use client";

import { useEffect, useState } from "react";

import { ApiError } from "@/types";
import {
  fetchPartnerLocations,
  fetchPartners,
  fetchPartnerTimetable,
} from "@/lib/farm-out-api";
import type {
  FarmOutLocation,
  FarmOutPartner,
  FarmOutTimetable,
} from "@/types/farm-out";

/**
 * Dispatch 里 Farm out 用到的合作公司数据（G40）。后端没上线 / 读不到时当作「没有」，页面和以前一样；
 * 这些只读，改它们在 Settings（admin）。同一个页面里按 id 缓存，换页面刷新才重读。
 */
export type Loaded<T> =
  | { state: "loading" }
  | { state: "ready"; data: T }
  | { state: "none" };

const partnersP: { p: Promise<FarmOutPartner[]> | null } = { p: null };
const locP = new Map<number, Promise<FarmOutLocation[]>>();
const ttP = new Map<number, Promise<FarmOutTimetable>>();

function cached<K, V>(m: Map<K, Promise<V>>, k: K, f: () => Promise<V>) {
  let p = m.get(k);
  if (!p) {
    p = f();
    p.catch(() => m.delete(k));
    m.set(k, p);
  }
  return p;
}

/** 测试 / 重新读：清掉缓存。 */
export function resetFarmOutCache() {
  partnersP.p = null;
  locP.clear();
  ttP.clear();
}

function useAsync<T>(get: (() => Promise<T>) | null, key: string): Loaded<T> {
  const [res, setRes] = useState<{ key: string; v: Loaded<T> }>({
    key: "",
    v: { state: "loading" },
  });
  useEffect(() => {
    if (!get) return;
    let live = true;
    get().then(
      (data) => live && setRes({ key, v: { state: "ready", data } }),
      (e) => {
        if (!live) return;
        // 404 = 后端还没上线；别的错也不打扰 staff，当没有（Farm out 键就不出现）。
        if (!(e instanceof ApiError) || e.status !== 404) console.warn(e);
        setRes({ key, v: { state: "none" } });
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!get) return { state: "none" };
  return res.key === key ? res.v : { state: "loading" };
}

export function usePartners(): Loaded<FarmOutPartner[]> {
  return useAsync(
    () => (partnersP.p ??= fetchPartners().catch((e) => {
      partnersP.p = null;
      throw e;
    })),
    "partners",
  );
}

export function usePartnerLocations(
  partnerId: number | null | undefined,
): Loaded<FarmOutLocation[]> {
  return useAsync(
    partnerId == null
      ? null
      : () => cached(locP, partnerId, () => fetchPartnerLocations(partnerId)),
    `loc${partnerId}`,
  );
}

export function usePartnerTimetable(
  partnerId: number | null | undefined,
): Loaded<FarmOutTimetable> {
  return useAsync(
    partnerId == null
      ? null
      : () => cached(ttP, partnerId, () => fetchPartnerTimetable(partnerId)),
    `tt${partnerId}`,
  );
}

/** 这家公司的时刻表里有没有这个团（至少一个酒店有发车时间）。 */
export function timetableHasTour(t: FarmOutTimetable, manifestId: number) {
  return t.hotels.some((h) => !!t.cells[`${h.id}_${manifestId}`]);
}
