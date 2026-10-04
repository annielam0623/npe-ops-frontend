"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ManifestsPanel } from "@/components/dispatch-manifest/manifests-panel";
import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  copyDispatchDay,
  fetchDispatchDay,
  fetchDispatchPrefill,
  pullFromDiscord,
  saveDispatchDay,
} from "@/lib/dispatch-api";
import { isYmd, shiftYmd } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type { DispatchDay, DispatchPrefill, DispatchRow } from "@/types";

import { CclBanner } from "./ccl-banner";
import {
  analyze,
  BUS_TOUR_SHIFT,
  cloneRow,
  cloneRows,
  countChanges,
  fmtLong,
  fmtShort,
  hasDriver,
  isRelay,
  makeLookup,
  rowKey,
  secOf,
} from "./config";
import { Rail } from "./rail";
import { RelayRow, VanBlock } from "./vehicle-row";

const RING = ["#0ea5e9", "#6366f1", "#a855f7", "#14b8a6"];

type Banner = "none" | "prefill" | "revision";

type Pending =
  { kind: "leave"; to: string } | { kind: "discard" } | { kind: "copy" } | null;

/** 一个通知（存完的结果、复制丢了几台车、邮件没发出去）。不像旧页面用 alert，也不会 3 秒就消失。 */
type Notice = { tone: "ok" | "warn"; text: string } | null;

export function DispatchView() {
  const [day, setDay] = useState<DispatchDay | null>(null);
  const [rows, setRows] = useState<DispatchRow[]>([]);
  const [base, setBase] = useState<DispatchRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [saved, setSaved] = useState<string | null>(null);
  /** 点 Save 那一刻缺司机的行（对象引用：新加的行不会一出现就是红的）。 */
  const [flagged, setFlagged] = useState<DispatchRow[]>([]);
  const [prefill, setPrefill] = useState<DispatchPrefill | null>(null);
  const [banner, setBanner] = useState<Banner>("none");
  const [cclImportId, setCclImportId] = useState<number | null>(null);
  const [pullMsg, setPullMsg] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [manifestVersion, setManifestVersion] = useState(0);
  const redirectingRef = useRef(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 异步回调里要读最新的值。
  const stateRef = useRef({ rows, base, day, prefill });
  stateRef.current = { rows, base, day, prefill };

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  const L = useMemo(() => (day ? makeLookup(day) : null), [day]);
  const analysis = useMemo(() => (L ? analyze(rows, L) : null), [rows, L]);
  const changes = countChanges(base, rows);
  const dirty = changes > 0;

  /** CCL：预填（没存过的一天）/ 改版（存过的一天）/ 关闭的线。动过手就不碰。 */
  const maybePrefill = useCallback(async (date: string) => {
    setBanner("none");
    setPrefill(null);
    setCclImportId(null);
    let p: DispatchPrefill | null = null;
    try {
      p = await fetchDispatchPrefill(date);
    } catch {
      return; // 拿不到不影响排班
    }
    const cur = stateRef.current;
    if (!p || cur.day?.run_date !== date) return;
    setPrefill(p);
    if (countChanges(cur.base, cur.rows) > 0 || p.status !== "pending") return;
    if (!cur.base.length) {
      if (!p.rows?.length) return;
      setCclImportId(p.import_id);
      setRows(cloneRows(p.rows));
      setBanner("prefill");
    } else if (p.changes?.length) {
      setBanner("revision");
    }
  }, []);

  const load = useCallback(
    async (date: string | null): Promise<boolean> => {
      try {
        const d = await fetchDispatchDay(date);
        setDay(d);
        setRows(cloneRows(d.rows));
        setBase(cloneRows(d.rows));
        setFlagged([]);
        setActionError(null);
        setLoadError(null);
        setPrefill(null);
        setBanner("none");
        setCclImportId(null);
        setManifestVersion((v) => v + 1);
        const url = new URL(window.location.href);
        url.searchParams.set("date", d.run_date);
        window.history.replaceState(null, "", url);
        stateRef.current = {
          rows: d.rows,
          base: d.rows,
          day: d,
          prefill: null,
        };
        return true;
      } catch (e) {
        if (isStatus(e, 401)) redirectToLogin();
        else if (isStatus(e, 403)) setForbidden(true);
        else
          setLoadError(
            e instanceof TypeError
              ? "Could not reach the server. Check your connection, then reload the page."
              : `Could not load this day: ${describeError(e)} Reload the page to try again.`,
          );
        return false;
      }
    },
    [redirectToLogin],
  );

  const pull = useCallback(
    async (trigger: "page" | "manual") => {
      const quiet = trigger === "page";
      setPulling(true);
      if (!quiet) setPullMsg("Pulling from Discord...");
      let res;
      try {
        res = await pullFromDiscord(trigger);
      } catch (e) {
        if (isStatus(e, 401)) {
          redirectToLogin();
          return;
        }
        setPullMsg(
          e instanceof TypeError
            ? "Pull failed: could not reach the server. Check your connection and try again."
            : `Pull failed: ${describeError(e)}`,
        );
        setPulling(false);
        return;
      }
      setPulling(false);
      const last = res.last_ok ? `Last pull from Discord: ${res.last_ok}.` : "";
      if (quiet && res.status !== "failed") setPullMsg(last);
      else
        setPullMsg(`${res.message || "Pull failed."}${last ? ` ${last}` : ""}`);
      const cur = stateRef.current;
      if ((res.status === "new" || res.status === "revision") && cur.day) {
        const isDirty = countChanges(cur.base, cur.rows) > 0;
        const untouched =
          !!cur.prefill &&
          !cur.base.length &&
          cur.prefill.status === "pending" &&
          JSON.stringify(cloneRows(cur.prefill.rows).map(rowKey).sort()) ===
            JSON.stringify(cur.rows.map(rowKey).sort());
        if (!isDirty) {
          void maybePrefill(cur.day.run_date);
        } else if (untouched) {
          setRows(cloneRows(cur.base));
          stateRef.current = { ...cur, rows: cur.base };
          void maybePrefill(cur.day.run_date);
        } else {
          setPullMsg(
            `CCL posted something new while you were editing this day. Save first - the changes will be listed after saving.${last ? ` ${last}` : ""}`,
          );
        }
      }
    },
    [maybePrefill, redirectToLogin],
  );

  // 打开：先显示已存的排车，再看 CCL，再在后台去 Discord 拉一次（同旧页面）。认 ?date=（旧页面不认）。
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("date");
    void (async () => {
      const d = isYmd(fromUrl) ? fromUrl : null;
      if (await load(d)) {
        const cur = stateRef.current.day;
        if (cur) await maybePrefill(cur.run_date);
        await pull("page");
      }
    })();
  }, [load, maybePrefill, pull]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    },
    [],
  );

  function flashSaved(text: string) {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setSaved(text);
    savedTimerRef.current = setTimeout(() => setSaved(null), 3000);
  }

  function edit(next: DispatchRow[]) {
    setRows(next);
    setActionError(null);
    if (saved) setSaved(null);
  }

  async function goTo(date: string) {
    setNotice(null);
    if (await load(date)) await maybePrefill(date);
  }

  function requestGo(date: string) {
    if (!day || !isYmd(date) || date === day.run_date) return;
    if (dirty) setPending({ kind: "leave", to: date });
    else void goTo(date);
  }

  function focusRow(idx: number, field?: string) {
    const el = document.querySelector<HTMLElement>(`.vrow[data-idx="${idx}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (field)
      el.querySelector<HTMLElement>(`[data-f="${field}"]`)?.focus({
        preventScroll: true,
      });
  }

  async function save() {
    if (!day || busy) return;
    const missing = rows.flatMap((r, i) => (hasDriver(r) ? [] : [i]));
    if (missing.length) {
      // 缺司机：不发请求，标红、滚过去。
      setFlagged(missing.map((i) => rows[i]));
      setActionError(null);
      setTimeout(() => focusRow(missing[0], "driver"), 0);
      return;
    }
    const date = day.run_date;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const j = await saveDispatchDay(date, rows, cclImportId);
      const vans = typeof j.saved === "number" ? j.saved : rows.length;
      if (await load(date)) {
        const names = j.typed_names ?? [];
        flashSaved(
          `Saved. ${vans} vehicle${vans === 1 ? "" : "s"} for ${fmtLong(date)}.${
            names.length && j.typed_alert === "sent"
              ? ` Annie was emailed to add ${names.join(", ")} to Human Resource.`
              : ""
          }`,
        );
        if (
          names.length &&
          (j.typed_alert === "failed" || j.typed_alert === "not_set_up")
        ) {
          setNotice({
            tone: "warn",
            text: `Saved. The email to Annie about ${names.join(", ")} (not in Human Resource) could not be sent. Please tell Annie.`,
          });
        }
        await maybePrefill(date);
      }
    } catch (e) {
      if (isStatus(e, 401)) {
        redirectToLogin();
        return;
      }
      const msg =
        e instanceof TypeError
          ? "Could not reach the server. Check your connection and try again - nothing was saved."
          : describeError(e);
      setActionError(msg);
      const m = /^Row (\d+):/.exec(msg);
      if (m) focusRow(Number(m[1]) - 1);
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    setRows(cloneRows(base));
    setFlagged([]);
    setCclImportId(null);
    setActionError(null);
    // 存过的一天点过 Apply 又 Discard ⇒ 改版那一条重新列出来；预填的一天 ⇒ 蓝条收起。
    if (prefill && base.length && prefill.changes?.length)
      setBanner("revision");
    else {
      setBanner("none");
      setPrefill(null);
    }
  }

  async function copy(): Promise<ActionResult> {
    if (!day?.copy_from) return { status: "ok" };
    const date = day.run_date;
    setBusy(true);
    setActionError(null);
    try {
      const j = await copyDispatchDay(date, day.copy_from);
      setPending(null);
      if (await load(date)) {
        const lines: string[] = [];
        if (j.dropped) {
          lines.push(
            j.dropped === 1
              ? "1 hotel was left out - it is no longer active."
              : `${j.dropped} hotels were left out - they are no longer active.`,
          );
        }
        if (j.dropped_expired) {
          lines.push(
            j.dropped_expired === 1
              ? "1 vehicle was left out: its driver's license will have expired by this day. Assign its hotels to another driver."
              : `${j.dropped_expired} vehicles were left out: their drivers' licenses will have expired by this day. Assign their hotels to other drivers.`,
          );
        }
        if (j.dropped_deleted) {
          lines.push(
            j.dropped_deleted === 1
              ? "1 vehicle was left out: its driver was removed from Human Resource. Add a vehicle for its hotels with another driver."
              : `${j.dropped_deleted} vehicles were left out: their drivers were removed from Human Resource. Add vehicles for their hotels with other drivers.`,
          );
        }
        // 旧页面什么都没丢时一声不吭；这里说一句。
        setNotice({
          tone: lines.length ? "warn" : "ok",
          text: `Copied ${fmtShort(day.copy_from)}: ${j.saved} vehicle${j.saved === 1 ? "" : "s"}.${lines.length ? ` ${lines.join(" ")}` : ""}`,
        });
        await maybePrefill(date);
      }
      return { status: "ok" };
    } catch (e) {
      if (isStatus(e, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      return {
        status: "error",
        message:
          e instanceof TypeError
            ? "Could not reach the server. Check your connection and try again - nothing was changed."
            : describeError(e),
      };
    } finally {
      setBusy(false);
    }
  }

  /** 改版的 Apply：只改 CCL 说了算的（司机、导游、车、Bus 字母）；加 / 去掉车。不存。 */
  function applyRevision() {
    if (!prefill?.changes) return;
    const byId = new Map(
      rows.filter((r) => r.id != null).map((r) => [r.id, cloneRow(r)]),
    );
    const drop = new Set<number>();
    const added: DispatchRow[] = [];
    for (const c of prefill.changes) {
      if (c.kind === "removed") {
        drop.add(c.row_id);
        continue;
      }
      const n = prefill.rows[c.ccl_row];
      if (c.kind === "added") {
        added.push(cloneRow(n));
        continue;
      }
      const r = byId.get(c.row_id);
      if (!r) continue;
      for (const f of c.fields) {
        if (f === "driver")
          Object.assign(r, {
            driver_hr_id: n.driver_hr_id,
            driver_typed_name: n.driver_typed_name,
            driver_name: null,
          });
        else if (f === "guide")
          Object.assign(r, {
            guide_hr_id: n.guide_hr_id,
            guide_typed_name: n.guide_typed_name,
            guide_name: null,
          });
        else if (f === "vehicle") r.vehicle_id = n.vehicle_id;
        else if (f === "bus_label") r.bus_label = n.bus_label;
      }
      r.ccl = n.ccl;
    }
    const next = rows
      .map((r) => (r.id != null && byId.has(r.id) ? byId.get(r.id)! : r))
      .filter((r) => !(r.id != null && drop.has(r.id)))
      .concat(added);
    edit(next);
    setCclImportId(prefill.import_id);
    setBanner("none");
  }

  function addVehicle(shift: string, tour: number | null) {
    if (!L) return;
    edit([
      ...rows,
      cloneRow({
        shift,
        manifest_id: shift === BUS_TOUR_SHIFT ? tour : null,
        location_ids: L.defaultStops(shift, tour),
      }),
    ]);
  }

  if (forbidden) {
    return (
      <Shell>
        <Panel>
          <p className="font-medium text-stone-800">Staff access required</p>
        </Panel>
      </Shell>
    );
  }

  const today = day?.today ?? "";
  const tag = day
    ? day.run_date === today
      ? "Today"
      : day.run_date === shiftYmd(today, 1)
        ? "Tomorrow"
        : ""
    : "";
  const disabled = !day || busy;

  return (
    <Shell>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            Dispatch
          </span>
          <h1 className="text-2xl font-semibold text-stone-900">
            {day ? fmtLong(day.run_date) : "Dispatch"}
            {tag ? (
              <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 align-middle text-xs font-medium text-sky-800">
                {tag}
              </span>
            ) : null}
          </h1>
          <p className="text-sm text-stone-500">
            Set who drives which vehicle and which hotels they pick up. Nothing
            is sent from this page.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-label="Previous day"
              disabled={disabled}
              onClick={() => day && requestGo(shiftYmd(day.run_date, -1))}
              className={NAV}
            >
              ‹
            </button>
            <input
              type="date"
              aria-label="Day"
              disabled={disabled}
              value={day?.run_date ?? ""}
              onChange={(e) => e.target.value && requestGo(e.target.value)}
              className={NAV}
            />
            <button
              type="button"
              aria-label="Next day"
              disabled={disabled}
              onClick={() => day && requestGo(shiftYmd(day.run_date, 1))}
              className={NAV}
            >
              ›
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => requestGo(today)}
              className={NAV}
            >
              Today
            </button>
            <button
              type="button"
              disabled={pulling || !day}
              onClick={() => void pull("manual")}
              className="rounded-md bg-[#5865F2] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4752c4] disabled:opacity-50"
            >
              Pull from Discord
            </button>
            {day?.copy_from ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  rows.length ? setPending({ kind: "copy" }) : void copy()
                }
                className={NAV}
              >
                Copy {fmtShort(day.copy_from)}
              </button>
            ) : null}
            <button
              type="button"
              disabled={disabled}
              onClick={() => void save()}
              className="rounded-md bg-stone-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
            >
              Save schedule
            </button>
          </div>
          {pullMsg ? (
            <p role="status" className="text-xs text-stone-500">
              {pullMsg}
            </p>
          ) : null}
        </div>
      </header>

      {loadError ? (
        <p
          role="alert"
          className="rounded-md border border-[#A32D2D]/30 bg-[#FCEBEB] px-4 py-3 text-sm text-[#A32D2D]"
        >
          {loadError}
        </p>
      ) : null}

      {!day || !L || !analysis ? (
        loadError ? null : (
          <p className="py-10 text-center text-sm text-stone-500">Loading…</p>
        )
      ) : (
        <>
          {!day.drivers.length ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              <b>No drivers yet.</b> Drivers come from Human Resource: set a
              person&rsquo;s <b>Position</b> to Driver or Driver + Guide there,
              then come back here. No login account is needed to be scheduled.
            </p>
          ) : null}

          {banner !== "none" && prefill ? (
            <CclBanner
              kind={banner}
              prefill={prefill}
              rows={rows}
              L={L}
              onApply={applyRevision}
              onLater={() => setBanner("none")}
            />
          ) : null}

          {notice ? (
            <p
              role="status"
              className={cn(
                "flex items-start justify-between gap-3 rounded-md border px-4 py-2.5 text-sm",
                notice.tone === "ok"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-300 bg-amber-50 text-amber-900",
              )}
            >
              <span>{notice.text}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="text-xs underline"
              >
                Dismiss
              </button>
            </p>
          ) : null}

          <section
            aria-label="Summary"
            className="flex flex-wrap items-stretch gap-3"
          >
            <Stat value={analysis.driversUsed} label="drivers" />
            <Stat value={rows.length} label="vehicles" />
            {analysis.coverage.map((c) => (
              <Stat
                key={c.shift}
                value={`${c.covered} / ${c.total}`}
                label={`relay hotels · ${c.shift === "relay" ? "1st Round" : "2nd Round"}`}
              />
            ))}
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById("schedule-check")
                  ?.scrollIntoView({ block: "start", behavior: "smooth" })
              }
              className={cn(
                "ml-auto flex min-w-[220px] items-center gap-3 rounded-lg border px-4 py-2 text-left",
                analysis.issues.length
                  ? "border-amber-300 bg-amber-50"
                  : "border-emerald-200 bg-emerald-50",
              )}
            >
              <span aria-hidden className="text-xl">
                {analysis.issues.length ? "⚠" : "✓"}
              </span>
              <span>
                <span className="block text-sm font-semibold">
                  {analysis.issues.length
                    ? `${analysis.issues.length} ${analysis.issues.length === 1 ? "issue" : "issues"} to review`
                    : "Ready"}
                </span>
                <span className="block text-xs text-stone-600">
                  {analysis.issues.length
                    ? analysis.missingTitles.length
                      ? analysis.missingTitles.join("; ")
                      : "none of them block saving"
                    : "nothing to review"}
                </span>
              </span>
            </button>
          </section>

          <ManifestsPanel
            key={day.run_date}
            date={day.run_date}
            version={manifestVersion}
            onUnauthorized={redirectToLogin}
          />

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
            <div className="flex min-w-0 flex-col gap-4">
              {day.sections.map((s, cardIdx) => {
                const key = secOf(s);
                const idxs = rows.flatMap((r, i) =>
                  secOf(r) === key ? [i] : [],
                );
                const hotels = new Set(
                  idxs.flatMap((i) => rows[i].location_ids),
                ).size;
                const closed = (prefill?.closures ?? []).find(
                  (c) =>
                    c.shift &&
                    secOf({ shift: c.shift, manifest_id: c.manifest_id }) ===
                      key,
                );
                const relay = isRelay(s.shift);
                return (
                  <section
                    key={key}
                    data-sec={key}
                    aria-label={s.title}
                    className={cn(
                      "overflow-hidden rounded-lg border bg-white",
                      closed
                        ? "border-stone-300 opacity-80"
                        : "border-stone-200",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-4 py-2.5">
                      <span className="font-semibold text-stone-900">
                        {s.title}
                      </span>
                      {closed ? (
                        <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700">
                          {closed.note || "Closed"}
                        </span>
                      ) : null}
                      {s.sub ? (
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                          {s.sub}
                        </span>
                      ) : null}
                      <span className="ml-auto text-xs text-stone-500">
                        <b>{idxs.length}</b> vehicles · <b>{hotels}</b> hotels
                      </span>
                    </div>
                    {idxs.length === 0 ? (
                      closed ? (
                        <p className="px-4 py-5 text-sm text-stone-500">
                          CCL closed this tour for the day. No vehicles can be
                          added.
                        </p>
                      ) : (
                        <div className="flex items-center justify-between gap-3 px-4 py-5">
                          <span className="text-sm text-stone-500">
                            No vehicles assigned yet
                          </span>
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => addVehicle(s.shift, s.manifest_id)}
                            className={ADD}
                          >
                            + Add vehicle
                          </button>
                        </div>
                      )
                    ) : (
                      <>
                        {relay ? (
                          <div className="hidden grid-cols-[minmax(200px,1.1fr)_minmax(140px,0.8fr)_2fr_auto] gap-2 border-b border-stone-100 bg-stone-50 px-3 py-1.5 text-[11px] font-semibold text-stone-500 uppercase md:grid">
                            <span>Driver</span>
                            <span>Vehicle</span>
                            <span>Hotel pickup stops</span>
                            <span />
                          </div>
                        ) : null}
                        {idxs.map((i) => {
                          const props = {
                            rows,
                            idx: i,
                            L,
                            ring: RING[cardIdx % RING.length],
                            flagged:
                              flagged.includes(rows[i]) && !hasDriver(rows[i]),
                            isDup: analysis.dup.has(i),
                            onChange: (n: DispatchRow) =>
                              edit(rows.map((r, j) => (j === i ? n : r))),
                            onRemove: () =>
                              edit(rows.filter((_, j) => j !== i)),
                          };
                          return relay ? (
                            <RelayRow key={i} {...props} />
                          ) : (
                            <VanBlock key={i} {...props} />
                          );
                        })}
                        {!closed ? (
                          <div className="px-4 py-2.5">
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => addVehicle(s.shift, s.manifest_id)}
                              className={ADD}
                            >
                              + Add vehicle
                            </button>
                          </div>
                        ) : null}
                      </>
                    )}
                  </section>
                );
              })}
            </div>
            <Rail analysis={analysis} onGoto={(i) => focusRow(i)} />
          </div>

          <HowToUse />
        </>
      )}

      {dirty || saved || actionError ? (
        <div
          className={cn(
            "sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 px-6 py-3 text-sm text-white sm:-mx-6",
            actionError
              ? "bg-[#8a2424]"
              : saved && !dirty
                ? "bg-[#1e6b43]"
                : "bg-stone-800",
          )}
        >
          <span role="status" className="mr-auto">
            {actionError ??
              (dirty
                ? `${changes} unsaved ${changes === 1 ? "change" : "changes"}`
                : saved)}
          </span>
          {dirty ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPending({ kind: "discard" })}
                className="rounded-md border border-white/40 px-3 py-1.5 font-medium hover:bg-white/10 disabled:opacity-50"
              >
                Discard
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void save()}
                className="rounded-md bg-white px-3 py-1.5 font-medium text-stone-900 hover:bg-stone-100 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save schedule"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {pending?.kind === "leave" ? (
        <ConfirmDialog
          title="This day has unsaved changes"
          confirmLabel="Leave without saving"
          busyLabel="Loading…"
          danger
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const to = pending.to;
            setPending(null);
            await goTo(to);
            return { status: "ok" };
          }}
        >
          <p>Leave this day without saving? Your changes will be lost.</p>
        </ConfirmDialog>
      ) : pending?.kind === "discard" ? (
        <ConfirmDialog
          title="Throw away the changes on this day?"
          confirmLabel="Discard"
          busyLabel="Discarding…"
          danger
          onClose={() => setPending(null)}
          onConfirm={async () => {
            discard();
            setPending(null);
            return { status: "ok" };
          }}
        >
          <p>The page goes back to the last saved schedule.</p>
        </ConfirmDialog>
      ) : pending?.kind === "copy" && day?.copy_from ? (
        <ConfirmDialog
          title={`Copy ${fmtShort(day.copy_from)}?`}
          confirmLabel="Copy and replace"
          busyLabel="Copying…"
          danger
          onClose={() => setPending(null)}
          onConfirm={copy}
        >
          <p>
            This will replace everything already scheduled on this day
            {dirty ? ", including your unsaved changes" : ""}. It is saved right
            away.
          </p>
        </ConfirmDialog>
      ) : null}
    </Shell>
  );
}

const NAV =
  "rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm hover:bg-stone-50 disabled:opacity-50";
const ADD =
  "rounded-md bg-[#185FA5] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#134c85] disabled:opacity-50";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-stone-100 text-stone-800">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 pt-6 sm:px-6">
        {children}
      </div>
    </main>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex min-w-[110px] flex-col rounded-lg border border-stone-200 bg-white px-4 py-2">
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-stone-500">{label}</span>
    </div>
  );
}

function HowToUse() {
  return (
    <details className="max-w-3xl rounded-lg border border-sky-200 bg-sky-50 px-5 py-4 text-sm leading-relaxed text-stone-700">
      <summary className="cursor-pointer font-semibold text-sky-900">
        📖 How to use — Dispatch
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Pick the day with the arrows or the date box. The page opens on
          tomorrow.
        </li>
        <li>
          The page pulls CCL&rsquo;s schedule from Discord when it opens. Pull
          from Discord pulls again; the time of the last pull is shown under the
          buttons.
        </li>
        <li>
          If nothing is saved for that day yet and CCL has posted it, the
          vehicles are filled in for you and a blue bar says so. Nothing is
          saved until you press Save schedule. Discard empties the day again.
        </li>
        <li>
          Under each box, &quot;CCL: NAME&quot; shows what CCL wrote. Red text
          means the name or vehicle did not match - pick it from the list. Next
          time CCL writes it the same way, it matches on its own.
        </li>
        <li>
          When CCL&rsquo;s name fits more than one person (for example BRUCE:
          Bruce O or Bruce W), the red text names them and they are at the top
          of the list. Pick the right one each time; this kind of name is never
          filled in on its own.
        </li>
        <li>
          Someone not in the list: choose &quot;Not in the list? Type a
          name...&quot; and type it. The box shows &quot;Not in HR&quot;, and
          Annie gets an email to add the person to Human Resource. A typed
          driver does not see the vehicle on the driver phone page.
        </li>
        <li>
          Private Tour: pick the tour beside &quot;Private Tour&quot;, or choose
          &quot;Custom - type a tour name...&quot; and type it.
        </li>
        <li>
          Morning Relay: CCL&rsquo;s vehicles are filled into the 1st Round
          without hotels. Pick the hotels for each vehicle.
        </li>
        <li>
          A tour CCL closed shows &quot;Closed&quot; (or CCL&rsquo;s words) and
          no vehicles can be added to it.
        </li>
        <li>
          If the day is already saved and CCL posts a change, a yellow bar lists
          what changed. Apply changes puts them on the page (hotels you picked
          stay); then press Save schedule. Not now hides the bar until you open
          the day again.
        </li>
        <li>
          View CCL&rsquo;s message shows CCL&rsquo;s message as it was posted.
        </li>
        <li>
          If Save shows a red message at the bottom, fix what it says and press
          Save schedule again. Nothing was saved.
        </li>
        <li>
          Tour manifests (above the sections) use the saved schedule: save
          first, then upload each tour&rsquo;s Rezdy CSV.
        </li>
      </ol>
    </details>
  );
}
