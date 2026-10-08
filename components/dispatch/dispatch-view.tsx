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
import { replaceUrl, useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import type {
  DispatchClosure,
  DispatchDay,
  DispatchPrefill,
  DispatchRow,
} from "@/types";

import { CclBanner } from "./ccl-banner";
import {
  analyze,
  applyDispatchMeta,
  cloneRow,
  cloneRows,
  countChanges,
  fmtLong,
  fmtShort,
  hasDriver,
  isRelay,
  makeLookup,
  META,
  rowKey,
  secOf,
} from "./config";
import {
  ADDVAN,
  ADDVAN_DARK,
  BANNER,
  BTN_BLUE,
  BTN_DISCORD,
  BTN_GHOST,
  DNAV,
  DPICK,
  ERRBAR,
  HOWTO,
  HOWTO_OL,
  HOWTO_SUMMARY,
  MUTED,
  TM_BTN,
} from "./legacy-styles";
import { BusIcon } from "./icons";
import { Rail } from "./rail";
import { RelayPanel } from "./relay-panel";
import { StepBox } from "./step-box";
import { RelayRow, VanBlock } from "./vehicle-row";

const RING = ["#0ea5e9", "#6366f1", "#a855f7", "#14b8a6"];

type Banner = "none" | "prefill" | "revision";

type Pending =
  { kind: "leave"; to: string } | { kind: "discard" } | { kind: "copy" } | null;

/** 一个通知（存完的结果、复制丢了几台车、邮件没发出去）。不像旧页面用 alert，也不会 3 秒就消失。 */
type Notice = { tone: "ok" | "warn"; text: string } | null;

/**
 * Annie 2026-10-07 定：Assign = 分配车、司机、酒店（Step 1 Guest lists、Step 2 Buses & drivers）；
 * Send = 发给司机（手机版 manifest 的链接）+ 原来的早班发送（Morning Relay 按轮发）。
 * 中间的检查点：Send 读的是存好的排车，有没存的改动时 Send 的发送键关着。地址带 ?tab=send。
 */
type Tab = "assign" | "send";
const TABS: readonly [Tab, string][] = [
  ["assign", "Assign"],
  ["send", "Send"],
];

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
  /** CCL 关闭的线：跟 prefill 分开存（Discard 不能把 Closed 一起丢掉）。 */
  const [closures, setClosures] = useState<DispatchClosure[]>([]);
  /** 换天的读取还在路上：不让改、不让存。 */
  const [loading, setLoading] = useState(false);
  /**
   * 重新读这一天失败了：页面上这份已经不能代表服务端（例如刚 Copy / Save 成功、重读失败）。
   * 这时 Save 是整天覆盖，一按就把旧的写回去 ⇒ 全部按钮关掉，只能刷新（同旧页面 load().catch 的 setControls(false)）。
   */
  const [stale, setStale] = useState(false);
  const loadSeqRef = useRef(0);
  const startedRef = useRef(false);
  const redirectingRef = useRef(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Assign Bus 跳过来的那一块（闪 2 秒）。 */
  const [flashSec, setFlashSec] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tab, setTab] = useState<Tab>("assign");
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
    setClosures([]);
    setCclImportId(null);
    let p: DispatchPrefill | null = null;
    try {
      p = await fetchDispatchPrefill(date);
    } catch {
      return; // 拿不到不影响排班
    }
    const cur = stateRef.current;
    if (!p || cur.day?.run_date !== date) return;
    // 关闭的线：存没存过都标出来。
    setClosures(p.closures ?? []);
    // 动过手 / 已应用：不预填、不列改版（同旧页面：这时也不记 prefill）。
    if (countChanges(cur.base, cur.rows) > 0 || p.status !== "pending") return;
    setPrefill(p);
    stateRef.current = { ...cur, prefill: p };
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
      // 只认最后一次读取（连点 › 时先发的可能后到）。
      const seq = ++loadSeqRef.current;
      try {
        const d = await fetchDispatchDay(date);
        if (seq !== loadSeqRef.current) return false;
        applyDispatchMeta(d.meta);
        setStale(false);
        setClosures([]);
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
        // 不直接 replaceState(null)：会冲掉离开提醒的记号。
        replaceUrl(url);
        stateRef.current = {
          rows: d.rows,
          base: d.rows,
          day: d,
          prefill: null,
        };
        return true;
      } catch (e) {
        if (seq !== loadSeqRef.current) return false;
        setStale(true);
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
    // StrictMode 下开发环境会跑两次：只读一次、只拉一次 Discord。
    if (startedRef.current) return;
    startedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("date");
    if (params.get("tab") === "send") setTab("send");
    void (async () => {
      const d = isYmd(fromUrl) ? fromUrl : null;
      if (await load(d)) {
        const cur = stateRef.current.day;
        if (cur) await maybePrefill(cur.run_date);
        await pull("page");
      }
    })();
  }, [load, maybePrefill, pull]);

  // 有没存的改动时离开先问：关标签 / 刷新、站内链接（侧栏、Open manifest）、浏览器后退 / 前进。
  useLeaveGuard(dirty, "This day has unsaved changes. Leave without saving?");

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
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
    setLoading(true);
    try {
      if (await load(date)) await maybePrefill(date);
    } finally {
      setLoading(false);
    }
  }

  function requestGo(date: string) {
    // 日期框边打字边触发 change（年份打到一半是 0202-…）：没打完的年份不跳。
    if (!day || !isYmd(date) || date < "2000-01-01" || date === day.run_date)
      return;
    if (dirty) setPending({ kind: "leave", to: date });
    else void goTo(date);
  }

  /** 换标签：只换显示（两边都留着，没存的改动、拉过的名单都在），地址里记 ?tab=。 */
  function switchTab(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "send") url.searchParams.set("tab", "send");
    else url.searchParams.delete("tab");
    replaceUrl(url);
  }

  function focusRow(idx: number, field?: string) {
    // 存的时候缺司机 / 服务端点名哪一行：行在 Assign 里，先切回去，显示出来以后再滚。
    if (tab !== "assign") {
      switchTab("assign");
      setTimeout(() => scrollToRow(idx, field), 0);
      return;
    }
    scrollToRow(idx, field);
  }

  function scrollToRow(idx: number, field?: string) {
    const el = document.querySelector<HTMLElement>(`.vrow[data-idx="${idx}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (field)
      el.querySelector<HTMLElement>(`[data-f="${field}"]`)?.focus({
        preventScroll: true,
      });
  }

  /**
   * Step 1 团卡片上的 Assign Bus：滚到 Step 2 里这个团的那一块、闪 2 秒（同旧页面 dispatch:assign-bus）。
   * 这个团今天没有块（停用了、没排）⇒ 滚到 Step 2 开头。
   */
  function assignBus(manifestId: number) {
    const key = secOf({ shift: META.bus_tour_shift, manifest_id: manifestId });
    const sec = document.querySelector<HTMLElement>(
      `[data-sec="${CSS.escape(key)}"]`,
    );
    (sec ?? document.getElementById("step2"))?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    if (!sec) return;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashSec(key);
    flashTimerRef.current = setTimeout(() => setFlashSec(null), 2000);
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
        manifest_id: shift === META.bus_tour_shift ? tour : null,
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
  const disabled = !day || busy || loading || stale;

  return (
    <Shell>
      {/* 照旧页面 `.dhead`：日期是这一页的主标题（深底上，白字），右边换日期。 */}
      <header className="mb-4 flex flex-wrap items-start justify-between gap-[18px]">
        <div>
          <h1 className="m-0 flex flex-wrap items-center gap-3 text-[29px] leading-[1.12] font-bold tracking-[-.02em] text-white">
            <span>{day ? fmtLong(day.run_date) : " "}</span>
            {tag ? (
              <span className="relative -top-0.5 rounded-full border border-[rgba(59,130,246,.35)] bg-[rgba(59,130,246,.18)] px-2.5 py-1 text-[11px] font-bold tracking-[.05em] text-[#93c5fd] uppercase">
                {tag}
              </span>
            ) : null}
          </h1>
          {/* 原来写「Saving sends nothing…」；分步以后照后端 G29 第 7 条改成按步骤说；10-07 拆成两个标签。 */}
          <p className="mt-1.5 mb-0 text-[13.5px] text-[#94a3b8]">
            Assign the buses, drivers and hotels and save, then Send: driver
            texts first, then guests&rsquo; morning pickup texts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="Previous day"
            disabled={disabled}
            onClick={() => day && requestGo(shiftYmd(day.run_date, -1))}
            className={DNAV}
          >
            ‹
          </button>
          <input
            type="date"
            aria-label="Day"
            disabled={disabled}
            value={day?.run_date ?? ""}
            onChange={(e) => e.target.value && requestGo(e.target.value)}
            className={DPICK}
          />
          <button
            type="button"
            aria-label="Next day"
            disabled={disabled}
            onClick={() => day && requestGo(shiftYmd(day.run_date, 1))}
            className={DNAV}
          >
            ›
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => requestGo(today)}
            className={BTN_GHOST}
          >
            Today
          </button>
        </div>
      </header>

      {loadError ? (
        <p role="alert" className={cn(ERRBAR, "mb-4")}>
          {loadError}
        </p>
      ) : null}

      {!day || !L || !analysis ? (
        loadError ? null : (
          <p className={cn(MUTED, "py-10 text-center text-[13px]")}>Loading…</p>
        )
      ) : (
        <>
          {/* Assign / Send 两个标签：旧页面没有（Annie 2026-10-07 定的新功能），样子用旧后台深色那一套。 */}
          <div
            role="tablist"
            aria-label="Dispatch"
            className="mb-4 flex gap-1 border-b border-white/10"
          >
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`panel-${key}`}
                onClick={() => switchTab(key)}
                className={cn(
                  "-mb-px border-b-2 px-4 py-2 text-[13.5px] font-semibold",
                  tab === key
                    ? "border-[#3b82f6] text-white"
                    : "border-transparent text-[#94a3b8] hover:text-white",
                )}
              >
                {label}
                {key === "assign" && dirty ? (
                  <span className="ml-1.5 rounded-full bg-[rgba(251,191,36,.16)] px-1.5 py-px text-[11px] font-semibold text-[#fde68a]">
                    unsaved
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {/* 两个标签都留着（hidden），来回切不丢没存的改动、拉过的名单。
              Assign：1 Guest lists → 2 Buses & drivers（后端 G29 第一批的前两步）。
              步骤框之间 18px（旧 `.dstep{margin-bottom:18px}`）。 */}
          <div
            role="tabpanel"
            id="panel-assign"
            aria-labelledby="tab-assign"
            hidden={tab !== "assign"}
            className="flex flex-col gap-[18px]"
          >
            <ManifestsPanel
              key={day.run_date}
              date={day.run_date}
              version={manifestVersion}
              onUnauthorized={redirectToLogin}
              onAssignBus={assignBus}
            />

            <StepBox
              n={2}
              id="step2"
              title="Buses & drivers"
              desc="CCL's schedule from Discord fills in the vehicles. Fix anything in red, then Save schedule."
            >
              {/* 旧 `.s2bar`。 */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={pulling || !day}
                  onClick={() => void pull("manual")}
                  className={BTN_DISCORD}
                >
                  <DiscordIcon />
                  Pull from Discord
                </button>
                {day.copy_from ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      rows.length ? setPending({ kind: "copy" }) : void copy()
                    }
                    className={BTN_GHOST}
                  >
                    Copy {fmtShort(day.copy_from)}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void save()}
                  className={BTN_BLUE}
                >
                  Save schedule
                </button>
                {pullMsg ? (
                  <span role="status" className="text-[11.5px] text-[#94a3b8]">
                    {pullMsg}
                  </span>
                ) : null}
              </div>

              <HowToUse />

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

              {!day.drivers.length ? (
                <p className={BANNER}>
                  <b>No drivers yet.</b> Drivers come from Human Resource: set a
                  person&rsquo;s <b>Position</b> to Driver or Driver + Guide
                  there, then come back here. No login account is needed to be
                  scheduled.
                </p>
              ) : null}

              {/* 旧页面这些话是 alert（差异清单 112），这里一直在的一条；样子同旧页面深底上的 `.cclbar`。 */}
              {notice ? (
                <p
                  role="status"
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-xl border px-4 py-[13px] text-[13px] leading-[1.55]",
                    notice.tone === "ok"
                      ? "border-[rgba(74,222,128,.30)] bg-[rgba(74,222,128,.09)] text-[#bbf7d0]"
                      : "border-[rgba(251,191,36,.38)] bg-[rgba(251,191,36,.10)] text-[#fde68a]",
                  )}
                >
                  <span>{notice.text}</span>
                  <button
                    type="button"
                    onClick={() => setNotice(null)}
                    className="text-[12px] whitespace-nowrap underline"
                  >
                    Dismiss
                  </button>
                </p>
              ) : null}

              {/* 旧 `.toprow`：统计条（三个数）+ 右上角要看的事。 */}
              <section
                aria-label="Summary"
                className="grid grid-cols-1 items-stretch gap-[18px] min-[901px]:grid-cols-[minmax(0,1fr)_312px]"
              >
                <div className="flex flex-wrap items-stretch rounded-[14px] border border-white/10 bg-white/[.04] px-1.5 py-1">
                  <Stat
                    icon="👤"
                    value={analysis.driversUsed}
                    label="drivers"
                  />
                  <Stat icon="🚐" value={rows.length} label="vehicles" border />
                  {analysis.coverage.map((c) => (
                    <Stat
                      key={c.shift}
                      icon="🏨"
                      value={
                        <>
                          {c.covered}
                          <span className="text-[13px] font-semibold text-[#94a3b8]">
                            {" "}
                            / {c.total}
                          </span>
                        </>
                      }
                      label={`relay hotels · ${META.round_names[c.shift] ?? c.shift}`}
                      border
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById("schedule-check")
                      ?.scrollIntoView({ block: "start", behavior: "smooth" })
                  }
                  className={cn(
                    "flex w-full items-center gap-[11px] rounded-[14px] border px-3.5 py-3 text-left",
                    analysis.issues.length
                      ? "border-[rgba(251,191,36,.34)] bg-[rgba(251,191,36,.10)] hover:bg-[rgba(251,191,36,.16)]"
                      : "border-[rgba(74,222,128,.30)] bg-[rgba(74,222,128,.09)]",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-7 flex-none items-center justify-center rounded-[9px] text-[14px]",
                      analysis.issues.length
                        ? "bg-[rgba(251,191,36,.18)] text-[#fbbf24]"
                        : "bg-[rgba(74,222,128,.16)] text-[#4ade80]",
                    )}
                  >
                    {analysis.issues.length ? "⚠" : "✓"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-[13.5px] leading-[1.25] font-[650]",
                        analysis.issues.length
                          ? "text-[#fde68a]"
                          : "text-[#bbf7d0]",
                      )}
                    >
                      {analysis.issues.length
                        ? `${analysis.issues.length} ${analysis.issues.length === 1 ? "issue" : "issues"} to review`
                        : "Ready"}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-[#94a3b8]">
                      {analysis.issues.length
                        ? analysis.missingTitles.length
                          ? analysis.missingTitles.join("; ")
                          : "none of them block saving"
                        : "nothing to review"}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex-none text-[15px]",
                      analysis.issues.length
                        ? "text-[#fbbf24]"
                        : "text-[#4ade80]",
                    )}
                  >
                    ›
                  </span>
                </button>
              </section>

              {/* 旧 `.cols`：≤1300px 拆成一栏，右栏落到卡片下面。 */}
              <div className="grid grid-cols-1 items-start gap-[18px] min-[1301px]:grid-cols-[minmax(0,1fr)_312px]">
                <div className="flex min-w-0 flex-col gap-4">
                  {day.sections.map((s, cardIdx) => {
                    const key = secOf(s);
                    const idxs = rows.flatMap((r, i) =>
                      secOf(r) === key ? [i] : [],
                    );
                    const hotels = new Set(
                      idxs.flatMap((i) => rows[i].location_ids),
                    ).size;
                    const closed = closures.find(
                      (c) =>
                        c.shift &&
                        secOf({
                          shift: c.shift,
                          manifest_id: c.manifest_id,
                        }) === key,
                    );
                    const relay = isRelay(s.shift);
                    return (
                      <section
                        key={key}
                        data-sec={key}
                        aria-label={s.title}
                        className={cn(
                          // 旧 `.card`：白卡片，深字。闪一下 = 旧 `.card.flash`（3px #fbbf24）。
                          "scroll-mt-20 overflow-hidden rounded-xl border-[0.5px] border-black/10 bg-white text-[#1a1a1a] transition-shadow duration-300",
                          flashSec === key && "ring-[3px] ring-[#fbbf24]",
                        )}
                      >
                        <div
                          className={cn(
                            "flex flex-wrap items-center gap-3.5 border-b border-[#e5e7eb] px-5 pt-3.5 pb-3",
                            closed ? "bg-[#f3f3f1]" : "bg-white",
                          )}
                        >
                          <span
                            aria-hidden
                            className="flex size-10 flex-none items-center justify-center rounded-[10px] bg-[#e3edff] text-[#2563eb]"
                          >
                            <BusIcon className="size-[22px]" />
                          </span>
                          <span className="text-[18px] font-bold tracking-[-.01em] text-[#111827]">
                            {s.title}
                          </span>
                          {closed ? (
                            <span className="max-w-full rounded-full bg-[#e9e9e6] px-2.5 py-[3px] text-[11.5px] font-bold whitespace-normal text-[#555]">
                              {closed.note || "Closed"}
                            </span>
                          ) : null}
                          {s.sub ? (
                            <span className="inline-flex items-center gap-[5px] rounded-full border border-[#cfdcf3] bg-[#eef4ff] py-[3px] pr-3 pl-[11px] text-[12.5px] font-medium text-[#111827] tabular-nums">
                              <ClockIcon />
                              {s.sub}
                            </span>
                          ) : null}
                          <span className="ml-auto text-[13px] text-[#4b5563] tabular-nums">
                            <b>{idxs.length}</b> vehicles · <b>{hotels}</b>{" "}
                            hotels
                          </span>
                        </div>
                        <div className="px-5 pt-0.5 pb-4 text-[#111827]">
                          {idxs.length === 0 ? (
                            closed ? (
                              <p className="m-0 px-2 pt-[18px] pb-4 text-center text-[13px] text-[#666]">
                                CCL closed this tour for the day. No vehicles
                                can be added.
                              </p>
                            ) : (
                              <div className="flex flex-col items-center gap-[11px] px-2 pt-[22px] pb-5">
                                <span className="text-[14px] font-semibold text-[#4a5568]">
                                  No vehicles assigned yet
                                </span>
                                <button
                                  type="button"
                                  disabled={disabled}
                                  onClick={() =>
                                    addVehicle(s.shift, s.manifest_id)
                                  }
                                  className={ADDVAN_DARK}
                                >
                                  + Add vehicle
                                </button>
                              </div>
                            )
                          ) : (
                            <>
                              {relay ? (
                                <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.85fr)_minmax(0,1.35fr)_84px] gap-[18px] border-b border-[#e5e7eb] pt-3 pb-2 text-[11px] font-[650] tracking-[.06em] text-[#4b5563] uppercase max-[860px]:hidden">
                                  <span>Driver</span>
                                  <span>Vehicle</span>
                                  <span>Hotel pickup stops</span>
                                  <span>Actions</span>
                                </div>
                              ) : null}
                              {idxs.map((i) => {
                                const props = {
                                  rows,
                                  idx: i,
                                  L,
                                  ring: RING[cardIdx % RING.length],
                                  flagged:
                                    flagged.includes(rows[i]) &&
                                    !hasDriver(rows[i]),
                                  isDup: analysis.dup.has(i),
                                  disabled,
                                  onChange: (n: DispatchRow) => {
                                    // 红框跟着这一行走（行对象每改一次就换一个）。
                                    if (flagged.includes(rows[i]))
                                      setFlagged(
                                        flagged.map((f) =>
                                          f === rows[i] ? n : f,
                                        ),
                                      );
                                    edit(rows.map((r, j) => (j === i ? n : r)));
                                  },
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
                                <button
                                  type="button"
                                  disabled={disabled}
                                  onClick={() =>
                                    addVehicle(s.shift, s.manifest_id)
                                  }
                                  className={cn(ADDVAN, "mt-3.5")}
                                >
                                  + Add vehicle
                                </button>
                              ) : null}
                            </>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
                <Rail analysis={analysis} onGoto={(i) => focusRow(i)} />
              </div>
            </StepBox>
          </div>

          {/* Send：1 Send to drivers → 2 Morning Relay（早班发送）。都读存好的排车。 */}
          <div
            role="tabpanel"
            id="panel-send"
            aria-labelledby="tab-send"
            hidden={tab !== "send"}
            className="flex flex-col gap-[18px]"
          >
            {dirty ? (
              <div
                role="alert"
                className={cn(BANNER, "flex flex-wrap items-center gap-3")}
              >
                <span className="mr-auto">
                  <b>Assign has unsaved changes.</b> Sending uses the saved
                  schedule, so the send buttons are off until you save.
                </span>
                <button
                  type="button"
                  onClick={() => switchTab("assign")}
                  className={TM_BTN}
                >
                  Back to Assign
                </button>
              </div>
            ) : null}
            <RelayPanel
              // manifestVersion 每次读好这一天（换天 / 存好 / 复制）都加一：面板跟着重建，
              // 不留存之前读的司机名单（服务端按存好的排车发）。
              key={`relay-${day.run_date}-${manifestVersion}`}
              date={day.run_date}
              dirty={dirty}
              disabled={disabled}
              onUnauthorized={redirectToLogin}
            />
          </div>
        </>
      )}

      {/* 旧 `.savebar`：内容栏里贴底（sticky，不盖侧栏）；右边留 40px 给右下角两个浮动滚动按钮。
          动作级的错误写在条里上面一行（旧 `.sberr`），改动数 / 已保存在下面一行。 */}
      {dirty || saved || actionError ? (
        <div
          className={cn(
            "sticky bottom-3 z-40 mt-4 rounded-xl border border-white/16 px-3.5 py-[11px] shadow-[0_10px_30px_rgba(0,0,0,.35)] backdrop-blur-[9px]",
            saved && !dirty && !actionError
              ? "border-t-[rgba(74,222,128,.3)] bg-[rgba(9,28,20,.9)]"
              : "bg-[rgba(6,16,28,.92)]",
          )}
        >
          {actionError ? (
            <div
              role="status"
              className={cn(
                "pr-10 text-[13px] leading-[1.45] font-semibold text-[#fecaca]",
                dirty &&
                  "mb-2.5 border-b border-[rgba(254,202,202,.22)] pb-2.5",
              )}
            >
              {actionError}
            </div>
          ) : null}
          {dirty || (saved && !actionError) ? (
            <div className="flex flex-wrap items-center gap-3 pr-10">
              <span
                role={actionError ? undefined : "status"}
                className={cn(
                  "flex items-center gap-[9px] text-[13px]",
                  dirty ? "text-[#e2e8f0]" : "text-[#bbf7d0]",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2 flex-none rounded-full",
                    dirty ? "bg-[#fbbf24]" : "bg-[#4ade80]",
                  )}
                />
                {dirty
                  ? `${changes} unsaved ${changes === 1 ? "change" : "changes"}`
                  : saved}
              </span>
              <span className="flex-1" />
              {dirty ? (
                <>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setPending({ kind: "discard" })}
                    className={BTN_GHOST}
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void save()}
                    className={BTN_BLUE}
                  >
                    {busy ? "Saving…" : "Save schedule"}
                  </button>
                </>
              ) : null}
            </div>
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

function Shell({ children }: { children: React.ReactNode }) {
  // 底色、外边距由整站外框（照 base.html）给；白卡片里的字靠 text-stone-800 以外各自写死的颜色。
  return <main className="text-stone-800">{children}</main>;
}

/** 旧 `.sitem`：图标块 + 大数字 + 小字；第二格起左边一条竖线。 */
function Stat({
  icon,
  value,
  label,
  border = false,
}: {
  icon: string;
  value: React.ReactNode;
  label: string;
  border?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2.5 px-5 py-3",
        border && "border-l border-white/10",
      )}
    >
      <span
        aria-hidden
        className="flex size-[26px] flex-none items-center justify-center rounded-lg bg-white/[.07] text-[13px]"
      >
        {icon}
      </span>
      <span>
        <span className="text-[19px] leading-[1.1] font-bold text-white tabular-nums">
          {value}
        </span>
        <span className="ml-[.3em] text-[12px] text-[#94a3b8]">{label}</span>
      </span>
    </div>
  );
}

/** 卡头时间胶囊里的钟（旧 `.card-header .when` 的背景图）。 */
function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#2f5fb3"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
      className="size-3.5 flex-none"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/** Pull from Discord 上的 Discord 标志（旧 `.btn-discord .dico`）。 */
function DiscordIcon() {
  return (
    <svg
      viewBox="0 0 127.14 96.36"
      aria-hidden="true"
      className="h-[13px] w-[17px] flex-none"
    >
      <path
        fill="currentColor"
        d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"
      />
    </svg>
  );
}

function HowToUse() {
  return (
    <details className={HOWTO}>
      <summary className={HOWTO_SUMMARY}>
        📖 How to use — Buses &amp; drivers
      </summary>
      <ol className={HOWTO_OL}>
        <li>
          Pick the day with the arrows or the date box at the top. The page
          opens on tomorrow. The day is kept in the page address, so Back from a
          manifest returns to it.
        </li>
        <li>
          The page pulls CCL&rsquo;s schedule from Discord when it opens. Pull
          from Discord pulls again; the time of the last pull is shown next to
          the buttons.
        </li>
        <li>
          If nothing is saved for that day yet and CCL has posted it, the
          vehicles are filled in for you and a blue bar says so. Nothing is
          saved until you press Save schedule. Discard empties the day again.
        </li>
        <li>
          Under each box, &quot;CCL: NAME&quot; shows what CCL wrote. Orange
          text with a warning sign means the name or vehicle did not match -
          pick it from the list. Next time CCL writes it the same way, it
          matches on its own.
        </li>
        <li>
          When CCL&rsquo;s name fits more than one person (for example BRUCE:
          Bruce O or Bruce W), the orange text names them and they are at the
          top of the list. Pick the right one each time; this kind of name is
          never filled in on its own.
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
          without hotels. Pick the hotels for each vehicle in Add hotel; click a
          hotel&rsquo;s x to take it off.
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
      </ol>
    </details>
  );
}
