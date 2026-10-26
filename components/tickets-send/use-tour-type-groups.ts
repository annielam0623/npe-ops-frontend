"use client";

import { useEffect, useState } from "react";

import { fetchSendableTixTourTypes } from "@/lib/tix-tour-types-api";

import {
  rememberExtraTourTypes,
  TOUR_TYPE_GROUPS,
  tourTypeGroups,
} from "./config";

/**
 * 门票团下拉的分组：写死的清单，加上 Content Studio 新建、已填齐的团（G190）。
 * 读不到后端清单（接口没上线 / 出错）就只用写死的清单，和以前一样。
 */
export function useTourTypeGroups(): typeof TOUR_TYPE_GROUPS {
  const [groups, setGroups] = useState(TOUR_TYPE_GROUPS);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const sendable = await fetchSendableTixTourTypes(controller.signal);
        if (controller.signal.aborted || !Array.isArray(sendable)) return;
        setGroups(tourTypeGroups(rememberExtraTourTypes(sendable)));
      } catch {
        // 照旧用写死的清单。
      }
    })();
    return () => controller.abort();
  }, []);
  return groups;
}
