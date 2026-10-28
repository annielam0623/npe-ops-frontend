"use client";

import { useEffect, useState } from "react";

import {
  BTN_DELETE_CLASS,
  BTN_EDIT_CLASS,
  CARD_CLASS,
  FORM_INPUT_CLASS,
  LegacyPageHeader,
} from "@/components/pickup-locations/legacy-ui";
import {
  BTN_BLUE,
  ResultLine,
  useRedirectToLogin,
} from "@/components/farm-out/ui";
import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchCurrentUser } from "@/lib/auth-api";
import {
  createRestaurant,
  deleteRestaurant,
  fetchRestaurants,
  updateRestaurant,
} from "@/lib/supplier-api";
import { cn } from "@/lib/utils";
import type {
  LunchRestaurant,
  RestaurantInput,
  RestaurantList,
  RestaurantSaved,
} from "@/types/supplier";

/**
 * Supplier › Restaurant（G199，preview https://claude.ai/artifact/BxohT6D7sXeRKMrpNkA7rb 第 4 版 ②，
 * Annie 2026-10-27「Supplier preview 动手」）：一家午餐店一张卡（店名、给哪些团、联系人 / 订餐方式两行 + 亮黄印出来的样子、员工备注），
 * 「+ Add a restaurant」加一张；增删改都在本页（Annie 明天自己加 BZ / South Rim 的店）。蓝色只有 Save。
 * 后端 404（还没上线）不报错，只写一句还没开。
 */

type Gate =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: RestaurantList };

type Result = { tone: "ok" | "error"; text: string };

/** 新卡片的键（还没有 id）。 */
const NEW = "new";

export function RestaurantView() {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [deleting, setDeleting] = useState<LunchRestaurant | null>(null);
  const redirectToLogin = useRedirectToLogin();

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const me = await fetchCurrentUser(controller.signal);
        if (controller.signal.aborted) return;
        // 后端 require_admin，同 Settings。
        if (!me.is_admin) {
          setGate({ kind: "forbidden" });
          return;
        }
        const data = await fetchRestaurants(controller.signal);
        if (controller.signal.aborted) return;
        setGate({ kind: "ready", data });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setGate({ kind: "forbidden" });
        else if (isStatus(error, 404)) setGate({ kind: "unavailable" });
        else setGate({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  const reload = () => setReloadKey((k) => k + 1);

  /** 存好：写结果、重读（别家的团可能挪过来了，其他卡片也要跟着变）。 */
  function saved(key: string, saved: RestaurantSaved, isNew: boolean) {
    const data = gate.kind === "ready" ? gate.data : null;
    const moved = Object.entries(saved.moved_from ?? {}).map(([gid, rid]) => {
      const tour =
        data?.groups.find((g) => g.id === Number(gid))?.display_name ?? gid;
      const from =
        data?.restaurants.find((r) => r.id === rid)?.name ?? "another vendor";
      return `${tour} moved here from ${from}.`;
    });
    setResults((all) => {
      const next = { ...all };
      delete next[key];
      next[String(saved.id)] = {
        tone: "ok",
        text: [isNew ? "✓ Added" : "✓ Saved", ...moved].join(" "),
      };
      return next;
    });
    if (isNew) setAdding(false);
    reload();
  }

  async function confirmDelete(r: LunchRestaurant): Promise<ActionResult> {
    try {
      await deleteRestaurant(r.id);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      return { status: "error", message: describeError(error) };
    }
    setDeleting(null);
    reload();
    return { status: "ok" };
  }

  const data = gate.kind === "ready" ? gate.data : null;

  return (
    <main className="text-stone-800 night:text-white/90">
      <LegacyPageHeader
        title="Restaurant"
        count={
          data
            ? `${data.restaurants.length} ${data.restaurants.length === 1 ? "restaurant" : "restaurants"}`
            : null
        }
      />

      {gate.kind === "loading" ? (
        <p className="text-[12px] text-white/60">Loading…</p>
      ) : null}
      {gate.kind === "forbidden" ? (
        <Panel>
          <p className="font-medium text-stone-800 night:text-white/90">
            Admin access required
          </p>
          <p className="mt-1">Only admins can change lunch restaurants.</p>
        </Panel>
      ) : null}
      {gate.kind === "unavailable" ? (
        <Panel>
          <p className="font-medium text-stone-800 night:text-white/90">
            Restaurant isn&apos;t available yet
          </p>
          <p className="mt-1">It will show up here once it is switched on.</p>
        </Panel>
      ) : null}
      {gate.kind === "error" ? (
        <ErrorBanner actionLabel="Retry" onAction={reload}>
          Could not load restaurants: {gate.message}
        </ErrorBanner>
      ) : null}

      {data ? (
        <>
          <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
            <p className="m-0 text-[13px] text-white/60">
              Lunch vendors and how to order. The footer text prints at the
              bottom of each bus&apos;s lunch sheet.
            </p>
            <button
              type="button"
              data-add-restaurant
              disabled={adding}
              onClick={() => setAdding(true)}
              className="cursor-pointer rounded-[8px] border border-white/20 bg-transparent px-3 py-[5px] text-[12.5px] font-bold text-[#cbd5e1] hover:bg-white/[.06] disabled:cursor-not-allowed disabled:opacity-50"
            >
              + Add a restaurant
            </button>
          </div>

          <div className="flex flex-col gap-3.5">
            {adding ? (
              <RestaurantCard
                key={NEW}
                restaurant={null}
                list={data}
                result={results[NEW] ?? null}
                onResult={(r) => setResults((all) => ({ ...all, [NEW]: r }))}
                onSaved={(s) => saved(NEW, s, true)}
                onCancelNew={() => {
                  setAdding(false);
                  setResults((all) => {
                    const next = { ...all };
                    delete next[NEW];
                    return next;
                  });
                }}
                onDelete={() => {}}
                onUnauthorized={redirectToLogin}
              />
            ) : null}
            {data.restaurants.length === 0 && !adding ? (
              <section
                className={cn(CARD_CLASS, "mb-0 px-4 py-3.5 text-[13px]")}
              >
                No restaurants yet. Click + Add a restaurant.
              </section>
            ) : null}
            {data.restaurants.map((r) => (
              <RestaurantCard
                // 重读后资料或分配变了就重画成存好的样子。
                key={`${r.id}|${r.updated_at}|${r.groups.map((g) => g.id).join(",")}`}
                restaurant={r}
                list={data}
                result={results[String(r.id)] ?? null}
                onResult={(res) =>
                  setResults((all) => ({ ...all, [String(r.id)]: res }))
                }
                onSaved={(s) => saved(String(r.id), s, false)}
                onCancelNew={() => {}}
                onDelete={() => setDeleting(r)}
                onUnauthorized={redirectToLogin}
              />
            ))}
          </div>
        </>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          onConfirm={() => confirmDelete(deleting)}
          onClose={() => setDeleting(null)}
        >
          {deleting.groups.length ? (
            <p>
              It is still the lunch vendor for{" "}
              {deleting.groups.map((g) => g.display_name).join(", ")}. Untick
              those tours and Save first.
            </p>
          ) : (
            <p>It is removed from this page. No tour uses it.</p>
          )}
        </ConfirmDialog>
      ) : null}
    </main>
  );
}

/** 页脚最多两行（后端三行 400）：第三个换行起并回第二行（同 Manifest setup 原来那格）。 */
function twoLines(value: string): string {
  return value.replace(
    /^([^\n]*\n[^\n]*)\n([\s\S]*)$/,
    (_, two: string, rest: string) => `${two} ${rest.replace(/\n/g, " ")}`,
  );
}

/** 印出来的样子：每行去首尾空白、空行去掉（同后端规整）。 */
function printedFooter(value: string): string {
  return value
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const LA_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const LABEL = "pt-[7px] text-[13px] font-bold text-[#333] night:text-white/80";
const HINT = "mt-[3px] mb-0 text-[11.5px] text-[#555] night:text-white/55";

function RestaurantCard({
  restaurant,
  list,
  result,
  onResult,
  onSaved,
  onCancelNew,
  onDelete,
  onUnauthorized,
}: {
  /** null = 新加的那张。 */
  restaurant: LunchRestaurant | null;
  list: RestaurantList;
  result: Result | null;
  onResult: (r: Result) => void;
  onSaved: (s: RestaurantSaved) => void;
  onCancelNew: () => void;
  onDelete: () => void;
  onUnauthorized: () => void;
}) {
  const isNew = restaurant === null;
  const savedIds = (restaurant?.groups ?? [])
    .map((g) => g.id)
    .sort((a, b) => a - b);
  const [name, setName] = useState(restaurant?.name ?? "");
  const [footer, setFooter] = useState(restaurant?.footer ?? "");
  const [note, setNote] = useState(restaurant?.staff_note ?? "");
  const [ids, setIds] = useState<number[]>(savedIds);
  const [saving, setSaving] = useState(false);
  const idBase = `rest-${restaurant?.id ?? "new"}`;

  const dirty =
    isNew ||
    name !== restaurant.name ||
    footer !== restaurant.footer ||
    note !== restaurant.staff_note ||
    ids.join(",") !== savedIds.join(",");

  // 停用的团不列，除非已经分给这家（好取消）。
  const tours = list.groups.filter((g) => g.is_active || ids.includes(g.id));
  const printed = printedFooter(footer);

  function reset() {
    if (isNew) {
      onCancelNew();
      return;
    }
    setName(restaurant.name);
    setFooter(restaurant.footer);
    setNote(restaurant.staff_note);
    setIds(savedIds);
  }

  async function save() {
    if (saving) return;
    if (!name.trim()) {
      onResult({ tone: "error", text: "Enter the restaurant name." });
      return;
    }
    setSaving(true);
    const input: RestaurantInput = {
      name,
      footer,
      staff_note: note,
      manifest_ids: ids,
    };
    try {
      const s = isNew
        ? await createRestaurant(input)
        : await updateRestaurant(restaurant.id, input);
      onSaved(s);
    } catch (error) {
      if (isStatus(error, 401)) onUnauthorized();
      else onResult({ tone: "error", text: describeError(error) });
      setSaving(false);
    }
  }

  const lunchFor = (restaurant?.groups ?? []).map((g) => g.display_name);

  return (
    <section
      className={cn(
        CARD_CLASS,
        "mb-0 px-4 py-3.5 text-[#111] night:text-white/90",
      )}
      data-restaurant={restaurant?.name ?? NEW}
    >
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
        <h3 className="m-0 text-[17px] font-bold">
          {isNew ? "New restaurant" : restaurant.name}
        </h3>
        {!isNew ? (
          <span
            data-lunch-for
            className="text-[12.5px] text-[#555] night:text-white/55"
          >
            Lunch for: {lunchFor.length ? lunchFor.join(", ") : "no tours"}
          </span>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {!isNew ? (
            <button
              type="button"
              className={BTN_DELETE_CLASS}
              disabled={saving}
              onClick={onDelete}
            >
              Delete
            </button>
          ) : null}
          <button
            type="button"
            className={BTN_EDIT_CLASS}
            disabled={saving || !dirty}
            onClick={reset}
          >
            Cancel
          </button>
          <button
            type="button"
            className={BTN_BLUE}
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </span>
      </div>
      {result ? (
        <div className="mt-1.5">
          <ResultLine result={result} />
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-1 items-start gap-x-3.5 gap-y-2 sm:grid-cols-[170px_minmax(0,1fr)]">
        <label htmlFor={`${idBase}-name`} className={LABEL}>
          Vendor name
        </label>
        <div>
          <input
            id={`${idBase}-name`}
            type="text"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            className={cn(FORM_INPUT_CLASS, "w-full max-w-[520px]")}
          />
          <p className={HINT}>
            Lunch sheet title: NPE Lunch Box - {name.trim() || "…"}
          </p>
        </div>

        <span className={LABEL}>Lunch for (tours)</span>
        <div>
          <div
            role="group"
            aria-label="Lunch for (tours)"
            className="flex flex-wrap gap-x-4 gap-y-1 pt-[7px] text-[13px]"
          >
            {tours.map((g) => {
              const other =
                g.restaurant_id != null && g.restaurant_id !== restaurant?.id
                  ? list.restaurants.find((r) => r.id === g.restaurant_id)
                  : undefined;
              return (
                <label
                  key={g.id}
                  data-tour={g.display_name}
                  className="inline-flex cursor-pointer items-center gap-1.5"
                >
                  <input
                    type="checkbox"
                    checked={ids.includes(g.id)}
                    onChange={(e) =>
                      setIds((cur) =>
                        e.target.checked
                          ? [...cur, g.id].sort((a, b) => a - b)
                          : cur.filter((x) => x !== g.id),
                      )
                    }
                  />
                  {g.display_name}
                  {other ? (
                    <span className="text-[11.5px] text-[#6b7280] night:text-white/45">
                      (now {other.name})
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
          <p className={HINT}>
            Pick one or more tours. A tour can have only one lunch vendor:
            ticking a tour that is now with another vendor moves it here when
            you save. A tour with no lunch vendor prints no lunch sheet.
          </p>
        </div>

        <label htmlFor={`${idBase}-footer`} className={LABEL}>
          Contact / how to order
        </label>
        <div>
          <textarea
            id={`${idBase}-footer`}
            rows={2}
            maxLength={300}
            value={footer}
            placeholder="(TEXT) POC: name phone ..."
            onChange={(e) => setFooter(twoLines(e.target.value))}
            className={cn(
              FORM_INPUT_CLASS,
              "w-full max-w-[520px] resize-none leading-[1.45]",
            )}
          />
          <p className={HINT}>
            Two lines at most. Prints at the bottom of the lunch sheet like
            this:
          </p>
          {printed ? (
            <div
              data-footer-preview
              className="mt-1 max-w-[640px] bg-[#ffff00] px-1.5 py-1 text-center font-[Arial,Helvetica,sans-serif] text-[14px] leading-[1.45] font-bold whitespace-pre-line text-[#111]"
            >
              {printed}
            </div>
          ) : (
            <p className="mt-1 mb-0 text-[12px] text-[#6b7280] italic night:text-white/45">
              Nothing prints under the lunch sheet.
            </p>
          )}
        </div>

        <label htmlFor={`${idBase}-note`} className={LABEL}>
          Notes for staff
        </label>
        <div>
          <textarea
            id={`${idBase}-note`}
            rows={2}
            maxLength={1000}
            value={note}
            placeholder="Optional, only shown on this page"
            onChange={(e) => setNote(e.target.value)}
            className={cn(
              FORM_INPUT_CLASS,
              "w-full max-w-[520px] resize-y leading-[1.45]",
            )}
          />
          <p className={HINT}>Not printed.</p>
        </div>
      </div>

      {restaurant?.updated_at ? (
        <p
          data-updated
          className="mt-2.5 mb-0 text-[11.5px] text-[#6b7280] night:text-white/45"
        >
          Saved by {restaurant.updated_by || "—"} ·{" "}
          {LA_TIME.format(new Date(restaurant.updated_at))}
        </p>
      ) : null}
    </section>
  );
}
