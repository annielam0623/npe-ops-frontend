"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { copyText } from "@/lib/clipboard";
import { fetchManifest } from "@/lib/dispatch-manifest-api";
import { refreshOrderFromRezdy } from "@/lib/orders-api";
import { useTick } from "@/lib/use-tick";
import { cn } from "@/lib/utils";
import type { ManifestGuest, ManifestView } from "@/types/dispatch-manifest";

import { fmtShort } from "./config";

/**
 * Nov 18–22 临时：Vegas 只在 3 家酒店接客（Annie 2026-11-17「动手」，preview https://claude.ai/artifact/G2FfFfTmFo4s1bFS1soHPb 第 4 版）。
 * - 黄框只在 FROM..TO 这几天出（过了自动不出），能开 Dispatch 的都看得到，不加开关（Annie 点名、临时用）；partner 不出。
 * - 名单只列 Dispatch 当前这一天（Annie「她只用处理明天出发的就好了」），从 Dispatch 的名单取（= Main manifest 同步过来的）。
 * - 对酒店：订单接客点（对上 Pickup Locations 的简称 + 原文）按关键字归到 3 家；Hoover Dam 的团、Private group 不列（Annie「Hoover Dam不受影响」）。
 *   接客点空着 / 对不上 Pickup Locations / 不在映射里的 Vegas 酒店 ⇒ 「To check」黄行。
 * - 在 Rezdy 改，回来按一次「Refresh from Rezdy」（Annie「改了的这一批就按一次就行了」）：逐张走现成的单张重拉
 *   POST /api/operations/orders/{单号}/refresh-from-rezdy（挂 orders.edit），完了让 Dispatch 重新同步名单。
 */
export const PICKUP_MOVE_FROM = "2026-11-18";
export const PICKUP_MOVE_TO = "2026-11-22";

type Target = "Treasure Island" | "Park MGM" | "Excalibur";

const TARGETS: [Target, RegExp][] = [
  ["Treasure Island", /treasure\s*island|\bt\.?i\.?\b/i],
  ["Park MGM", /park\s*mgm/i],
  ["Excalibur", /excalibur/i],
];

/** Annie 的表（2026-11-17）：哪家改到哪家。 */
const MOVES: [RegExp, Target, string][] = [
  [/\bplaza\b/i, "Treasure Island", "Plaza"],
  [/\bstrat(osphere)?\b/i, "Treasure Island", "STRAT"],
  [/\bsahara\b/i, "Treasure Island", "Sahara"],
  [/circus\s*circus/i, "Treasure Island", "Circus Circus"],
  [/westgate/i, "Treasure Island", "Westgate"],
  [/resorts?\s*world/i, "Treasure Island", "Resorts World"],
  [/\btrump\b/i, "Treasure Island", "Trump"],
  [/bellagio/i, "Treasure Island", "Bellagio"],
  [/horseshoe/i, "Treasure Island", "Horseshoe"],
  [/\baria\b/i, "Park MGM", "Aria"],
  [/mgm\s*grand/i, "Excalibur", "MGM Grand"],
  [/mandalay\s*bay/i, "Excalibur", "Mandalay Bay"],
];

export const MOVE_GROUPS: [Target, string][] = [
  [
    "Treasure Island",
    "Plaza, STRAT, Sahara, Circus Circus, Westgate, Resorts World, Trump, Bellagio, Horseshoe",
  ],
  ["Park MGM", "Aria"],
  ["Excalibur", "MGM Grand, Mandalay Bay"],
];

export function inPickupMoveDays(date: string): boolean {
  return date >= PICKUP_MOVE_FROM && date <= PICKUP_MOVE_TO;
}

export type PickupClass =
  | { kind: "ok" }
  | { kind: "skip" }
  | { kind: "move"; to: Target }
  | { kind: "check" };

/** 一段接客点文字归哪类（Refresh 后也用它看新接客点）。 */
export function classifyPickup(text: string): PickupClass {
  const t = text.trim();
  if (!t) return { kind: "check" };
  if (/private/i.test(t)) return { kind: "skip" };
  for (const [, re] of TARGETS) if (re.test(t)) return { kind: "ok" };
  for (const [re, to] of MOVES) if (re.test(t)) return { kind: "move", to };
  return { kind: "check" };
}

function classifyGuest(g: ManifestGuest, tourName: string): PickupClass {
  if (/hoover/i.test(`${tourName} ${g.product}`)) return { kind: "skip" };
  const text = `${g.hotel_short ?? ""} ${g.pickup_location ?? ""}`;
  const c = classifyPickup(text);
  if (c.kind !== "check" || !g.pickup_location?.trim()) return c;
  // 对上了 Pickup Locations、但那家不是 Vegas 酒店（机场、外地 Shuttle 点等）⇒ 不归这次管。
  if (g.pickup_location_id != null && g.pickup_is_vegas === false)
    return { kind: "skip" };
  return c;
}

export interface PickupMoveRow {
  order_number: string;
  name: string;
  pax: number;
  tour: string;
  pickup: string;
  to: Target | null;
}

export function pickupMoveRows(views: ManifestView[]): PickupMoveRow[] {
  const seen = new Set<string>();
  const move: PickupMoveRow[] = [];
  const check: PickupMoveRow[] = [];
  for (const v of views) {
    const secs = [
      ...(v.blocks ?? []).flatMap((b) => b.sections ?? []),
      ...(v.unplaced?.sections ?? []),
    ];
    const tourName = v.tour?.name ?? "";
    for (const sec of secs)
      for (const g of sec.guests ?? []) {
        if (seen.has(g.order_number)) continue;
        const c = classifyGuest(g, tourName);
        if (c.kind !== "move" && c.kind !== "check") continue;
        seen.add(g.order_number);
        const row: PickupMoveRow = {
          order_number: g.order_number,
          name: g.name || `${g.first_name} ${g.last_name}`.trim(),
          pax: g.pax,
          tour: tourName,
          pickup: g.pickup_location ?? "",
          to: c.kind === "move" ? c.to : null,
        };
        (c.kind === "move" ? move : check).push(row);
      }
  }
  return [...move, ...check];
}

type RowResult =
  | { kind: "ok"; text: string }
  | { kind: "same"; text: string }
  | { kind: "error"; text: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BTN =
  "cursor-pointer rounded-[9px] border border-[#c9d3cc] bg-white px-3 py-1 text-[13px] text-[#1f2d25] disabled:cursor-default disabled:opacity-60";
const BTN_SM =
  "cursor-pointer rounded-[7px] border border-[#c9d3cc] bg-white px-2 py-[1px] text-[12px] text-[#1f2d25]";
const BTN_BLUE =
  "cursor-pointer rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-3.5 py-1 text-[13px] font-bold text-white disabled:cursor-default disabled:opacity-60";

export function PickupMoveBox({
  date,
  tourIds,
  onRefreshed,
  onUnauthorized,
}: {
  date: string;
  /** 这一天传过名单、有客人的团（Step 1 卡片报上来的）；null = 还没读到。 */
  tourIds: number[] | null;
  /** Refresh 完：让 Dispatch 重新按 Main manifest 同步名单。 */
  onRefreshed: () => void;
  onUnauthorized: () => void;
}) {
  const canRefresh = useTick("orders.edit");
  const [rows, setRows] = useState<PickupMoveRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(true);
  const [results, setResults] = useState<Record<string, RowResult>>({});
  /** 按过 Refresh 的行：名单重读后不在了也留着显示结果，换天清掉。 */
  const [kept, setKept] = useState<PickupMoveRow[]>([]);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateRef = useRef(date);
  dateRef.current = date;

  const ids = tourIds?.join(",") ?? null;

  useEffect(() => {
    setResults({});
    setKept([]);
    setRows(null);
  }, [date]);

  useEffect(() => {
    if (ids === null) return;
    const list = ids ? ids.split(",").map(Number) : [];
    const ac = new AbortController();
    Promise.all(list.map((id) => fetchManifest(date, id, ac.signal))).then(
      (views) => {
        if (ac.signal.aborted) return;
        setLoadError(false);
        setRows(pickupMoveRows(views));
      },
      (e) => {
        if (ac.signal.aborted) return;
        if (isStatus(e, 401)) onUnauthorized();
        else setLoadError(true);
      },
    );
    return () => ac.abort();
  }, [date, ids, onUnauthorized]);

  const shown = useMemo(() => {
    const now = rows ?? [];
    const have = new Set(now.map((r) => r.order_number));
    return [...now, ...kept.filter((r) => !have.has(r.order_number))];
  }, [rows, kept]);

  const toMove = (rows ?? []).filter((r) => r.to).length;
  const toCheck = (rows ?? []).length - toMove;

  function flash(key: string) {
    setCopied(key);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 1500);
  }

  async function refreshAll() {
    const list = shown;
    if (!list.length) return;
    const forDate = date;
    setKept(list);
    setResults({});
    setRunning({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      if (dateRef.current !== forDate) return;
      const r = list[i];
      let res: RowResult;
      try {
        const out = await refreshOrderFromRezdy(r.order_number);
        const change = out.changed.find((c) =>
          c.field.toLowerCase().startsWith("pickup location"),
        );
        const now = change ? (change.after ?? "") : r.pickup;
        const c = classifyPickup(now);
        if (out.result === "not_applied")
          res = { kind: "same", text: out.message };
        else if (c.kind === "ok")
          res = { kind: "ok", text: `Now ${now} ✓` };
        else
          res = {
            kind: "same",
            text: now.trim()
              ? `Still ${now} in Rezdy`
              : "Pickup is still empty in Rezdy",
          };
      } catch (e) {
        if (isStatus(e, 401)) {
          onUnauthorized();
          return;
        }
        res = { kind: "error", text: describeError(e) };
      }
      if (dateRef.current !== forDate) return;
      setResults((m) => ({ ...m, [r.order_number]: res }));
      setRunning({ done: i + 1, total: list.length });
      if (i < list.length - 1) await sleep(800);
    }
    setRunning(null);
    onRefreshed();
  }

  if (!inPickupMoveDays(date)) return null;

  const vals = Object.values(results);
  const nOk = vals.filter((v) => v.kind === "ok").length;
  const nSame = vals.filter((v) => v.kind === "same").length;
  const nErr = vals.filter((v) => v.kind === "error").length;

  return (
    <section
      data-pickup-move
      className="mb-[18px] rounded-[14px] bg-white p-4 text-[#1f2d25] max-sm:mb-3 max-sm:p-3"
    >
      <div className="grid gap-2 rounded-[10px] border border-[#fbbf24] bg-[#fffbeb] px-3.5 py-3 text-[13.5px]">
        <b className="text-[14.5px]">
          Nov 18 – Nov 22: we pick up at 3 hotels only — Treasure Island, Park
          MGM and Excalibur.
        </b>
        <span>
          Before you assign buses, change every other hotel&rsquo;s pickup
          location in Rezdy as below. Then click Refresh from Rezdy once so the
          new pickups come into the Main manifest and Dispatch.
        </span>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
          {MOVE_GROUPS.map(([to, from]) => (
            <div
              key={to}
              data-move-group
              className="rounded-[8px] border border-[#f1d58a] bg-white px-2.5 py-2 text-[13px]"
            >
              <b>→ {to}</b>
              <br />
              {from}
            </div>
          ))}
        </div>
        <span>
          Hoover Dam tours are not affected — keep their pickups as they are.
          Check bus assignments after the pickups change.
        </span>
        <div className="flex flex-wrap items-center gap-2.5">
          {loadError ? (
            <span className="font-semibold text-[#b91c1c]">
              Could not load the guest lists for this day. Reload the page to
              try again.
            </span>
          ) : rows === null ? (
            <span className="text-[#55645a]">Checking pickups…</span>
          ) : toMove + toCheck === 0 ? (
            <b data-move-count className="text-[#15803d]">
              All pickups for {fmtShort(date)} are at the 3 hotels.
            </b>
          ) : (
            <>
              <b data-move-count>
                {toMove} {toMove === 1 ? "order" : "orders"} for{" "}
                {fmtShort(date)} still to change
              </b>
              {toCheck ? (
                <span className="text-[#55645a]">· {toCheck} to check</span>
              ) : null}
            </>
          )}
          {shown.length ? (
            <button
              type="button"
              data-move-toggle
              onClick={() => setOpen((v) => !v)}
              className={BTN}
            >
              {open ? "Hide list" : "Show list"}
            </button>
          ) : null}
        </div>
      </div>

      {shown.length && open ? (
        <div data-move-list className="mt-3 grid gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <h2 className="m-0 text-[15px] font-bold">
              Orders still to change in Rezdy
            </h2>
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                data-copy-all
                onClick={() => {
                  void copyText(
                    shown.map((r) => r.order_number).join("\n"),
                  ).then((ok) => ok && flash("all"));
                }}
                className={BTN}
              >
                {copied === "all"
                  ? `Copied ${shown.length} order numbers`
                  : "Copy all order numbers"}
              </button>
              {canRefresh ? (
                <button
                  type="button"
                  data-move-refresh
                  disabled={!!running}
                  onClick={() => void refreshAll()}
                  className={BTN_BLUE}
                >
                  {running
                    ? `Refreshing… ${running.done} of ${running.total}`
                    : "Refresh from Rezdy"}
                </button>
              ) : null}
            </div>
          </div>
          <p className="m-0 text-[12.5px] text-[#55645a]">
            {canRefresh
              ? "Change these orders in Rezdy first, then click Refresh from Rezdy once. Rows whose new pickup came in turn green and leave the list next time you open it."
              : "Change these orders in Rezdy. Then ask someone who can edit orders to click Refresh from Rezdy here."}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px] tabular-nums">
              <thead>
                <tr className="bg-[#f3f6f4] text-left text-[12px] text-[#55645a]">
                  {[
                    "Order",
                    "Guest",
                    "Pax",
                    "Tour",
                    "Pickup now",
                    "Change to",
                    "After refresh",
                  ].map((h) => (
                    <th
                      key={h}
                      className="border-b border-[#e2e8e4] px-2 py-1.5 font-semibold whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const res = results[r.order_number];
                  return (
                    <tr
                      key={r.order_number}
                      data-move-row={r.order_number}
                      data-move-check={r.to ? undefined : ""}
                      className={cn(!r.to && "bg-[#fffbeb]")}
                    >
                      <td className="border-b border-[#e2e8e4] px-2 py-1.5 whitespace-nowrap">
                        <span className="mr-1.5 select-all">
                          {r.order_number}
                        </span>
                        <button
                          type="button"
                          data-copy={r.order_number}
                          onClick={() => {
                            void copyText(r.order_number).then(
                              (ok) => ok && flash(r.order_number),
                            );
                          }}
                          className={BTN_SM}
                        >
                          {copied === r.order_number ? "Copied" : "Copy"}
                        </button>
                      </td>
                      <td className="border-b border-[#e2e8e4] px-2 py-1.5 whitespace-nowrap">
                        {r.name}
                      </td>
                      <td className="border-b border-[#e2e8e4] px-2 py-1.5">
                        {r.pax}
                      </td>
                      <td className="border-b border-[#e2e8e4] px-2 py-1.5 whitespace-nowrap">
                        {r.tour}
                      </td>
                      <td className="border-b border-[#e2e8e4] px-2 py-1.5">
                        {r.pickup.trim() || "(empty)"}
                      </td>
                      <td className="border-b border-[#e2e8e4] px-2 py-1.5 whitespace-nowrap">
                        {r.to ? <b>{r.to}</b> : "Check"}
                      </td>
                      <td
                        data-move-result
                        className={cn(
                          "border-b border-[#e2e8e4] px-2 py-1.5",
                          res?.kind === "ok" && "font-bold text-[#15803d]",
                          res?.kind === "same" &&
                            "font-semibold text-[#b45309]",
                          res?.kind === "error" &&
                            "font-semibold text-[#b91c1c]",
                        )}
                      >
                        {res?.text ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {vals.length && !running ? (
            <p data-move-summary className="m-0 text-[12.5px]">
              <span className="font-bold text-[#15803d]">
                Done: {nOk} changed
              </span>
              {" · "}
              <span className="font-semibold text-[#b45309]">
                {nSame} still the old hotel
              </span>
              {" · "}
              <span className="font-semibold text-[#b91c1c]">
                {nErr} failed
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
