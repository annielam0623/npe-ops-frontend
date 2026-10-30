"use client";

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import { fetchActionLog } from "@/lib/action-log";
import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { downloadCsv } from "@/lib/csv";
import { isYmd, laToday, shiftYmd } from "@/lib/la-date";
import {
  fetchManifestPage,
  type ManifestSearchEntry,
  saveManifestCfm,
} from "@/lib/manifests-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { fetchUserPref, saveUserPref } from "@/lib/user-prefs-api";
import { OTHER_TOUR_COLOR, resolveTourColor } from "@/lib/tour-colors";
import { usePermissions } from "@/lib/staff-permissions";
import { cn } from "@/lib/utils";
import { useViewOnly, ViewOnly } from "@/components/ui/view-only";
import type {
  ManifestField,
  ManifestHiddenRow,
  ManifestPage,
  ManifestRow,
  ManifestTabKey,
} from "@/types";

import { SyncRezdyButton } from "@/components/rezdy-sync/sync-rezdy-button";

import { CfmUploadPanel } from "./cfm-upload-panel";
import {
  buildCsv,
  buildHiddenCsv,
  csvFilename,
  formatValue,
  isLegacy,
  isSelectable,
  isTabKey,
  parseSavedFields,
  paxOf,
  plural,
  PREF_KEY,
  requestFields,
  sectionBg,
  sentAt,
  shownFields,
  STAFF_CFM_KEY,
  TAB_KEYS,
  CHECK_BIG,
} from "./config";
import { FieldPicker } from "./field-picker";
import { ManifestSearch } from "./manifest-search";
import { SectionCfm } from "./section-cfm";
import {
  MessageDialog,
  ReminderDialog,
  TourConfirmDialog,
} from "./send-dialogs";

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

/** 账号里存的列：undefined = 还没拉；null = 没存过（用后端默认列）。 */
type SavedFields = Record<ManifestTabKey, string[] | null | undefined>;

// 样子照旧后台 manifests.html / base.html（Annie 2026-10-07：和旧版一模一样）。
/** base.html 的 .btn：深色底上的半透明按钮。 */
const LEGACY_BTN_CLASS =
  "inline-flex h-9 items-center justify-center gap-2 rounded-[10px] border border-white/10 bg-white/[.04] px-3.5 text-[13px] font-[650] whitespace-nowrap text-white transition hover:bg-white/[.08] disabled:cursor-not-allowed disabled:opacity-50";
/** manifests.html 的 .btn-nav（‹ ›）。 */
const NAV_BTN_CLASS =
  "flex h-7 w-7 items-center justify-center rounded-[7px] border-[0.5px] border-black/15 bg-paper text-[15px] text-[#1a1a1a] hover:bg-[#f5f5f3] disabled:opacity-50 night:border-white/15 night:bg-white/[.04] night:text-white/80 night:hover:bg-white/[.08]";
// 本页的 night: 全深色样式照公司旁支 49c5d40 的配色（白卡片 → 半透明深色、浅字），平时不生效（lib/theme.ts）。
// 例外：胶囊选中旁支用蓝底，这里改成白框——蓝色只给提交键（CLAUDE.md）。
/** 操作条上的主按钮（发确认 / 提醒）：深底上的亮蓝，同排车页 Send 标签的按钮。 */
const PRIMARY_ACTION_CLASS =
  "inline-flex h-9 items-center justify-center rounded-[10px] border border-[#3b82f6] bg-[#3b82f6] px-3.5 text-[13px] font-[650] whitespace-nowrap text-white hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-50";
/** Last Minute Order 键（Annie 2026-10-17）：白底蓝字 + 细蓝边框，和旁边实心蓝的发送键一眼分开；悬停淡蓝底。 */
const LAST_MINUTE_CLASS =
  "inline-flex h-9 items-center justify-center rounded-[10px] border border-[#3b82f6] bg-white px-3.5 text-[13px] font-[650] whitespace-nowrap text-[#2563eb] hover:bg-[#eaf2ff] disabled:cursor-not-allowed disabled:opacity-50";
/** 搜索框（ops 才有）：同 .btn 的深色半透明底。 */
const SEARCH_INPUT_CLASS =
  "h-9 w-[300px] max-w-full rounded-[10px] border border-white/10 bg-white/[.04] px-3 text-[13px] text-white placeholder:text-[#94a3b8] night:placeholder:text-white/45 focus:border-white/30 focus:outline-none";
/** 旧页「No bookings for this date / filter.」：直接写在深色底上。 */
const EMPTY_CLASS =
  "p-8 text-center text-[13px] text-[#aaa] night:text-white/35";
/** ops 才有的提示条，用旧页 .sp-onhold 的配色。 */
const NOTE_CLASS =
  "mb-4 rounded-[10px] border-[0.5px] border-[#ba7517]/30 bg-[#faeeda] px-3.5 py-2 text-[13px] text-[#854f0b] night:border-amber-400/30 night:bg-amber-400/10 night:text-amber-200";

/** 发送弹窗的种类：lastminute = 团确认弹窗 + lane "last_minute"（只有 Bus 标签）。 */
type SendKind = "message" | "tour" | "lastminute" | "reminder";

const TAB_FALLBACK_LABEL: Record<ManifestTabKey, string> = {
  bus: "Bus Tour",
  tickets: "Tickets - SelfDrive",
};

export function ManifestsView() {
  // partner 只能看（Annie 2026-10-27「合作方只能看manifest和订单，不能改或者选任何功能，比如加colum之类的」）：
  // 勾了 manifests.edit 也不上传确认号、不改 Cfm #、不 Sync Rezdy；Columns、拖表头、Export CSV、Show hidden rows 都不出。
  // 发送（团确认 / 门票提醒 / Send message）partner 一律没有（Annie「发送只能是我们内部员工发送」），也就没有勾选框。员工照旧。
  const perms = usePermissions();
  const noFeatures = perms.partnerView;
  const viewOnly = perms.partnerLacks("manifests.edit");
  const noConfirm = perms.partnerLacks("manifests.send");
  const noMessage = perms.partnerLacks("broadcast.send");
  const noSend = noConfirm && noMessage;
  const [date, setDate] = useState("");
  const [tab, setTab] = useState<ManifestTabKey>("bus");
  /** 请求的胶囊；空串 = 让后端挑 A→Z 第一颗。显示以返回的 data.pill 为准。 */
  const [pill, setPill] = useState("");
  const [saved, setSaved] = useState<SavedFields>({
    bus: undefined,
    tickets: undefined,
  });
  const [prefNote, setPrefNote] = useState("");
  const [data, setData] = useState<ManifestPage | null>(null);
  const [state, setState] = useState<LoadState | null>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  /** Sync Rezdy 刚加进来的单（订单号）：重读后标绿几秒（How to use 写的）。 */
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [uploadingCfm, setUploadingCfm] = useState(false);
  /**
   * Show hidden rows（后端 G167）：默认关。开了请求带 include_hidden=true，响应多一个 `hidden` 块；
   * `viewHidden` = 正在看灰色虚线的 Hidden rows 胶囊（只读表，不是后端的胶囊，所以不进 pill / 地址栏）。
   */
  const [showHidden, setShowHidden] = useState(false);
  const [viewHidden, setViewHidden] = useState(false);
  /** 勾选的行（row_key）。换日期 / 标签 / 胶囊、发完都清掉。 */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sendDialog, setSendDialog] = useState<SendKind | null>(null);
  /**
   * 点了发送、但勾里有门票缺 Cfm # 的行：先弹这条确认条，不直接开发送弹窗
   * （Annie 2026-10-17：缺的红字提醒 + staff 主动点 Skip 才继续，不悄悄漏发）。
   * 记的是想开哪个弹窗，Skip 了才真的 setSendDialog。
   */
  const [pendingSend, setPendingSend] = useState<SendKind | null>(null);
  // G129：门票提醒里点了 Send anyway 的缺 Cfm # 订单号（照发，确认号栏留空）。
  const [cfmOver, setCfmOver] = useState<string[]>([]);
  /** 搜索跳过来的那一行（row_key）：标黄、滚到眼前；手动换日期 / 标签 / 胶囊就不再标。 */
  const [highlight, setHighlight] = useState<string | null>(null);
  const scrolledToRef = useRef<string | null>(null);
  const redirectingRef = useRef(false);
  /** 上一次返回已经满足的请求：后端换了胶囊（我们没指定 / 指定的当天不存在）时不再重拉一次。 */
  const satisfiedRef = useRef("");

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  // 地址栏的 ?date= &tab= &pill= 是打开页面时的起点；没有 / 不合法时用洛杉矶今天、Bus Tour、第一颗胶囊。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("date");
    const tabFromUrl = params.get("tab");
    setDate(isYmd(fromUrl) ? fromUrl : laToday());
    if (isTabKey(tabFromUrl)) setTab(tabFromUrl);
    setPill(params.get("pill") ?? "");
  }, []);

  // 这个标签存的列（每个标签只拉一次）。
  const savedHere = saved[tab];
  useEffect(() => {
    if (savedHere !== undefined) return;
    const controller = new AbortController();
    fetchUserPref(PREF_KEY[tab], controller.signal)
      .then((value) =>
        setSaved((s) => ({ ...s, [tab]: parseSavedFields(value) })),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) {
          redirectToLogin();
          return;
        }
        // 拉不到不挡页面：先用默认列，并说明。
        setPrefNote(
          `Could not load your saved columns (${describeError(error)}), showing the default columns.`,
        );
        setSaved((s) => ({ ...s, [tab]: null }));
      });
    return () => controller.abort();
  }, [tab, savedHere, redirectToLogin]);

  const fieldsKey = savedHere ? savedHere.join(",") : "";
  useEffect(() => {
    if (!date || savedHere === undefined) return;
    const requestKey = `${date}|${tab}|${pill}|${fieldsKey}|${reloadKey}|${showHidden}`;
    if (requestKey === satisfiedRef.current) return;
    const controller = new AbortController();
    let finished = false;
    setState({ kind: "loading" });
    fetchManifestPage(
      {
        date,
        tab,
        pill,
        fields: requestFields(savedHere, tab),
        includeHidden: showHidden,
      },
      controller.signal,
    )
      .then((page) => {
        finished = true;
        setData(page);
        setState(null);
        const url = new URL(window.location.href);
        url.searchParams.set("date", page.date);
        url.searchParams.set("tab", page.tab);
        if (page.pill) url.searchParams.set("pill", page.pill);
        else url.searchParams.delete("pill");
        window.history.replaceState(null, "", url);
        if ((page.pill ?? "") !== pill) {
          satisfiedRef.current = `${date}|${tab}|${page.pill ?? ""}|${fieldsKey}|${reloadKey}|${showHidden}`;
          setPill(page.pill ?? "");
        } else {
          satisfiedRef.current = requestKey;
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setState({ kind: "forbidden" });
        else setState({ kind: "error", message: describeError(error) });
      });
    return () => {
      controller.abort();
      // 没拿到就被打断（例如很快地关了又开 Show hidden rows）：上一次记下的「已经拿到」作废，
      // 不然切回原来的条件时会跳过请求，页面停在旧数据 / Loading。
      if (!finished) satisfiedRef.current = "";
    };
  }, [
    date,
    tab,
    pill,
    fieldsKey,
    savedHere,
    reloadKey,
    showHidden,
    redirectToLogin,
  ]);

  function changeDate(next: string) {
    if (!isYmd(next) || next === date) return;
    setDate(next);
    setViewHidden(false);
    setSelected(new Set());
    setPendingSend(null);
    setHighlight(null);
  }

  function changeTab(next: ManifestTabKey) {
    if (next === tab) return;
    setTab(next);
    setViewHidden(false);
    setPill("");
    setSelected(new Set());
    setPendingSend(null);
    setHighlight(null);
  }

  function changePill(next: string) {
    setViewHidden(false);
    setPill(next);
    setSelected(new Set());
    setPendingSend(null);
    setHighlight(null);
  }

  /** 搜索结果：跳到那一单所在的标签 / 胶囊，标出那一行。 */
  function jumpTo(entry: ManifestSearchEntry) {
    if (entry.tab !== tab || entry.pill !== pill) {
      setSelected(new Set());
      setPendingSend(null);
    }
    setViewHidden(false);
    setTab(entry.tab);
    setPill(entry.pill);
    setHighlight(entry.row_key);
    scrolledToRef.current = null;
  }

  /**
   * 发出去了：只把这次真的发了的（`pickedRows`）从勾选里摘掉，重拉（发过的显示时间，门票发过的沉底）。
   * Skip & send 跳过的缺 Cfm # 行不在 `pickedRows` 里，继续留着勾选和标红，等 staff 回来处理
   * （不是整批清掉——预览 https://claude.ai/artifact/3sj1zArf7UxBTDdR1pyAc2 的 skipAndSend 就是这么演示的，Annie 看过同意）。
   * 弹窗自己留着显示结果。
   */
  function onSent() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of pickedRows) next.delete(r.row_key);
      return next;
    });
    setPendingSend(null);
    satisfiedRef.current = "";
    setReloadKey((k) => k + 1);
  }

  function toggleRows(keys: readonly string[], on: boolean) {
    setSelected((cur) => {
      const next = new Set(cur);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }

  /** Select unsent（Annie 2026-10-18）：勾上当前页面里还没发过的订单，其余取消（门票缺 Cfm # 的也算没发）。 */
  function selectUnsent() {
    setSelected(
      new Set(
        (shown?.rows ?? [])
          .filter((row) => !sentAt(row, tab))
          .map((row) => row.row_key),
      ),
    );
  }

  async function applyFields(fields: string[] | null) {
    try {
      await saveUserPref(PREF_KEY[tab], JSON.stringify(fields ?? []));
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      throw new Error(describeError(error));
    }
    setSaved((s) => ({ ...s, [tab]: fields }));
    setPrefNote("");
    setPicking(false);
  }

  /**
   * 拖表头换列的顺序（Annie 2026-10-14：后加的 Pickup time 排在最右，挪不过去）：马上存进账号，同 ☰ Columns；
   * 存不上就改回原来的顺序、写原因。
   */
  async function reorderFields(next: string[]) {
    const before = saved[tab];
    setSaved((s) => ({ ...s, [tab]: next }));
    setPrefNote("");
    try {
      await saveUserPref(PREF_KEY[tab], JSON.stringify(next));
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setSaved((s) => ({ ...s, [tab]: before }));
      setPrefNote(`Could not save the column order: ${describeError(error)}`);
    }
  }

  /** 改了还没存的 Cfm # 格（按行）：离开页面先问（全站规矩，A2）。 */
  const [dirtyCfm, setDirtyCfm] = useState<ReadonlySet<string>>(new Set());
  const onCfmDirty = useCallback((rowKey: string, dirty: boolean) => {
    setDirtyCfm((cur) => {
      if (cur.has(rowKey) === dirty) return cur;
      const next = new Set(cur);
      if (dirty) next.add(rowKey);
      else next.delete(rowKey);
      return next;
    });
  }, []);
  useLeaveGuard(
    dirtyCfm.size > 0,
    "A Cfm # you typed is not saved yet. Leave without saving?",
  );

  function onCfmSaved(rowKey: string, values: ManifestRow["values"]) {
    setData((d) =>
      d
        ? {
            ...d,
            rows: d.rows.map((r) =>
              r.row_key === rowKey
                ? { ...r, values: { ...r.values, ...values } }
                : r,
            ),
          }
        : d,
    );
  }

  const today = date ? laToday() : "";
  const loading = state?.kind === "loading";
  // 换了标签还没回来时，旧标签的数据不当成这个标签的。
  const shown = data && data.tab === tab ? data : null;
  // 搜索跳过来的行到了：滚到屏幕中间（每次跳转只滚一次，后面重拉不再拽视线）。
  const highlightShown =
    !!highlight && !!shown?.rows.some((r) => r.row_key === highlight);
  useEffect(() => {
    if (!highlight || !highlightShown || scrolledToRef.current === highlight)
      return;
    scrolledToRef.current = highlight;
    document
      .querySelector(`tr[data-row="${CSS.escape(highlight)}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [highlight, highlightShown]);
  const legacyCount = shown ? shown.rows.filter(isLegacy).length : 0;
  const tabs =
    data?.tabs ??
    TAB_KEYS.map((key) => ({
      key,
      label: TAB_FALLBACK_LABEL[key],
      rows: 0,
      orders: 0,
      pax: 0,
    }));
  const currentPill = shown?.pills.find((p) => p.key === shown.pill);
  const fields = shown ? shownFields(shown, savedHere) : [];
  // 隐藏行：只在勾了开关、响应里有 hidden 块时才有；有行才出灰色胶囊，没有行写一句小字。
  const hidden = showHidden ? (shown?.hidden ?? null) : null;
  const hiddenRows = hidden?.rows ?? [];
  const seeingHidden = viewHidden && hiddenRows.length > 0;
  // 「存着、但这页用不了」只说 staff 自己存的列，不算为勾选多要的辅助列。
  const isSavedKey = (k: string) => !savedHere || savedHere.includes(k);
  const denied = shown ? shown.denied.filter(isSavedKey) : [];
  const unknown = shown ? shown.unknown.filter(isSavedKey) : [];
  // 勾了以后 Cfm # 被清掉的门票行不再算勾着（发不出去）。
  const pickedRows = shown
    ? shown.rows.filter((r) => selected.has(r.row_key) && isSelectable(r, tab))
    : [];
  const pickedPax = pickedRows.reduce((n, r) => n + paxOf(r), 0);
  const pickedOrders = new Set(pickedRows.map((r) => r.order_number)).size;
  // 勾了、但门票还没填 Cfm # 的行：点发送时先拦一道，不悄悄漏发。
  const missingPicked = shown
    ? shown.rows.filter((r) => selected.has(r.row_key) && !isSelectable(r, tab))
    : [];
  // 这页门票里有没有还没填 Cfm # 的行（不看有没有勾）：表格上方要不要出黄字提示。
  const anyMissingCfm =
    tab === "tickets" && !!shown?.rows.some((r) => !isSelectable(r, tab));

  /** Send reminder / Send message / Send tour confirmation 的统一入口。 */
  function requestSend(kind: SendKind) {
    if (kind === "message" ? noMessage : noConfirm) return;
    if (missingPicked.length) {
      setPendingSend(kind);
      return;
    }
    setSendDialog(kind);
  }

  return (
    <ViewOnly.Provider value={viewOnly}>
      <main className="text-stone-800 night:text-white/90">
        {state?.kind === "forbidden" ? (
          <div className={EMPTY_CLASS}>
            <p className="font-medium">Staff access required</p>
            <p className="mt-1">This page is for office staff.</p>
          </div>
        ) : (
          <>
            {/* 照旧页 .date-nav：‹ 日期 › Today；Columns / Export CSV / Upload 是 ops 才有的，同样用旧版 .btn。 */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label="Previous day"
                onClick={() => changeDate(shiftYmd(date, -1))}
                disabled={!date}
                className={NAV_BTN_CLASS}
              >
                ‹
              </button>
              <input
                type="date"
                aria-label="Manifest date"
                value={date}
                onChange={(e) => changeDate(e.target.value)}
                className="h-7 min-w-[120px] rounded-[7px] border-[0.5px] border-black/15 bg-paper px-3.5 text-center text-[13px] font-medium text-[#1a1a1a] focus:outline-none night:border-white/15 night:bg-white/[.06] night:text-white night:[color-scheme:dark]"
              />
              <button
                type="button"
                aria-label="Next day"
                onClick={() => changeDate(shiftYmd(date, 1))}
                disabled={!date}
                className={NAV_BTN_CLASS}
              >
                ›
              </button>
              <button
                type="button"
                aria-pressed={!!date && date === today}
                onClick={() => changeDate(laToday())}
                className={LEGACY_BTN_CLASS}
              >
                Today
              </button>
              <ManifestSearch
                date={date}
                version={reloadKey}
                onJump={jumpTo}
                onUnauthorized={redirectToLogin}
                inputClassName={SEARCH_INPUT_CLASS}
              />
              <button
                type="button"
                hidden={noFeatures}
                onClick={() => setPicking(true)}
                disabled={!shown}
                className={LEGACY_BTN_CLASS}
              >
                ☰ Columns
              </button>
              <button
                type="button"
                hidden={noFeatures}
                onClick={() => {
                  if (!shown) return;
                  if (seeingHidden && hidden) {
                    const csv = buildHiddenCsv(shown, hidden, fields);
                    downloadCsv(
                      `manifest_${shown.date}_hidden-rows.csv`,
                      csv.headers,
                      csv.rows,
                    );
                    return;
                  }
                  const csv = buildCsv(shown, fields);
                  downloadCsv(csvFilename(shown), csv.headers, csv.rows);
                }}
                disabled={seeingHidden ? false : !shown?.rows.length}
                className={LEGACY_BTN_CLASS}
              >
                ↓ Export CSV
              </button>
              {/* Show hidden rows（后端 G167，Annie 2026-10-23「动手」）：默认关；和 Columns / Export 一样是“怎么看这一页”的选项。 */}
              <label
                hidden={noFeatures}
                className="inline-flex h-7 cursor-pointer items-center gap-1.5 px-1 text-[12.5px] text-[#cbd5e1] select-none"
              >
                <input
                  type="checkbox"
                  aria-label="Show hidden rows"
                  checked={showHidden}
                  onChange={(e) => {
                    setShowHidden(e.target.checked);
                    if (!e.target.checked) setViewHidden(false);
                  }}
                  className="size-[15px] accent-[#94a3b8]"
                />
                Show hidden rows
              </label>
              <button
                type="button"
                hidden={viewOnly}
                onClick={() => setUploadingCfm(true)}
                disabled={!date}
                className={LEGACY_BTN_CLASS}
              >
                ↑ Upload confirmation #s
              </button>
              <span className="text-[12px] text-[#94a3b8] night:text-white/45">
                {loading ? "Loading…" : null}
              </span>
              {/* Sync Rezdy（后端 G70，Annie 2026-10-15）：这一排最右边；点完重读列表，新单标绿几秒。 */}
              {viewOnly ? null : (
                <SyncRezdyButton
                  kind="manifests"
                  date={date}
                  today={laToday()}
                  onUnauthorized={redirectToLogin}
                  onSynced={(r) => {
                    setFresh(new Set(r.new));
                    setReloadKey((k) => k + 1);
                    if (r.new.length)
                      window.setTimeout(() => setFresh(new Set()), 4000);
                  }}
                />
              )}
            </div>

            {/* 页名「Manifest」和顶栏重复，只留给读屏（Annie 2026-10-19：保留顶栏那个，页内重复的去掉）。 */}
            <h2 className="sr-only">Manifest</h2>

            {/* Annie 2026-10-14：照 Dispatch Assign / Send 的黄框标签（选中的黄框 + 浅黄底 + 底边黄条）。 */}
            <div
              role="tablist"
              aria-label="Manifest type"
              className="mb-3.5 flex flex-wrap"
            >
              {tabs.map((t, n) => {
                const on = t.key === tab;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => changeTab(t.key)}
                    className={cn(
                      "-ml-px inline-flex items-baseline gap-2 border px-4 py-[7px] text-left transition-colors first:ml-0",
                      n === 0 && "rounded-l-[10px]",
                      n === tabs.length - 1 && "rounded-r-[10px]",
                      on
                        ? "relative z-[1] border-[rgba(251,191,36,.6)] bg-[rgba(251,191,36,.10)] text-white shadow-[inset_0_-2px_0_#fbbf24]"
                        : "border-white/10 bg-white/[.04] text-[#cbd5e1] hover:bg-white/[.07]",
                    )}
                  >
                    <span className="text-[14px] font-semibold">{t.label}</span>{" "}
                    <span
                      className={cn(
                        "text-[12.5px] tabular-nums",
                        on ? "text-[#fde68a]" : "text-[#94a3b8]",
                      )}
                    >
                      {data ? `${t.orders} · ${t.pax} pax` : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            {prefNote ? <p className={NOTE_CLASS}>{prefNote}</p> : null}

            {state?.kind === "error" ? (
              <div className="mb-4">
                <ErrorBanner
                  actionLabel="Retry"
                  onAction={() => {
                    satisfiedRef.current = "";
                    setReloadKey((k) => k + 1);
                  }}
                >
                  Could not load manifests: {state.message}
                </ErrorBanner>
              </div>
            ) : null}

            {shown && shown.pills.length ? (
              <div
                role="group"
                aria-label={tab === "bus" ? "Group" : "Tour type"}
                className="mb-5 flex flex-wrap gap-2"
              >
                {shown.pills.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={p.key === shown.pill && !seeingHidden}
                    onClick={() =>
                      (p.key !== shown.pill || seeingHidden) &&
                      changePill(p.key)
                    }
                    // 团色认 Settings → Products → Manifest setup（G142，`p.color`）；没配颜色时按团名猜
                    // （Antelope 紫、West 橙、Bryce 蓝、South Rim 绿，lib/tour-colors.ts），和 Dispatch 团卡片统一；其他和「还没分组」灰色。
                    style={
                      {
                        "--c": p.key.endsWith(":none")
                          ? OTHER_TOUR_COLOR
                          : resolveTourColor(p.color, p.label),
                      } as CSSProperties
                    }
                    className={cn(
                      // Annie 2026-10-14：像游戏里的按钮——平涂（中间不做高光）、有厚度（底下一道同色系的阴影边），悬停微微抬起，选中是「按下去」的样子（颜色更深、加粗）。黑字。
                      "rounded-[8px] border px-3.5 py-[5px] text-[12.5px] font-semibold whitespace-nowrap text-[#1a1a1a] transition-[transform,box-shadow,background] duration-100",
                      p.key === shown.pill
                        ? "translate-y-[3px] border-[var(--c)] bg-[color-mix(in_srgb,var(--c)_54%,var(--paper))] font-bold shadow-[inset_0_2px_3px_rgba(0,0,0,.22)] night:border-white/70 night:bg-white/[.14] night:text-white"
                        : "border-[color-mix(in_srgb,var(--c)_60%,#b5b2a8)] bg-[color-mix(in_srgb,var(--c)_30%,var(--paper))] shadow-[0_3px_0_color-mix(in_srgb,var(--c)_70%,#555),0_4px_7px_rgba(0,0,0,.28)] hover:-translate-y-px hover:shadow-[0_4px_0_color-mix(in_srgb,var(--c)_70%,#555),0_6px_9px_rgba(0,0,0,.3)] active:translate-y-[3px] active:shadow-none night:border-white/15 night:bg-white/[.04] night:text-white/70 night:hover:border-white/10 night:hover:bg-white/[.08] night:hover:text-white",
                      p.key.endsWith(":none") &&
                        p.key !== shown.pill &&
                        "border-dashed",
                    )}
                  >
                    {p.label}{" "}
                    <span
                      className={cn(
                        "ml-[3px] text-[11px] font-normal text-[#1a1a1a] tabular-nums",
                        p.key === shown.pill
                          ? "night:text-white/70"
                          : "night:text-white/40",
                      )}
                    >
                      {/* 只写人数（Annie 2026-10-15：单数拿掉，Bus / Tickets 都是）；
                        人数的数字蓝色 #0066ff（Annie 2026-10-14 选的亮蓝，原来的 #48a0c7 不够显眼）。 */}
                      <span className="font-semibold text-[#0066ff] night:text-sky-300">
                        {p.pax}
                      </span>{" "}
                      pax
                    </span>
                  </button>
                ))}
                {hidden && hiddenRows.length ? (
                  <>
                    <span
                      aria-hidden
                      className="mx-1 w-px self-stretch bg-white/20"
                    />
                    <button
                      type="button"
                      data-hidden-pill
                      aria-pressed={seeingHidden}
                      onClick={() => {
                        setViewHidden(true);
                        setSelected(new Set());
                        setPendingSend(null);
                        setHighlight(null);
                      }}
                      // 灰色虚线、和 Bus / Tickets 的团胶囊同款的筛选 pill；数字是灰字，不是蓝色。
                      className={cn(
                        "rounded-[8px] border px-3.5 py-[5px] text-[12.5px] font-semibold whitespace-nowrap transition",
                        seeingHidden
                          ? "border-white/70 bg-white/[.14] text-white"
                          : "border-dashed border-white/35 bg-white/[.05] text-[#cbd5e1] hover:bg-white/[.1]",
                      )}
                    >
                      Hidden rows{" "}
                      <span className="ml-[3px] text-[11px] font-normal text-[#94a3b8] tabular-nums">
                        {plural(hidden.pill.orders, "order")} ·{" "}
                        {hidden.pill.pax} pax
                      </span>
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}

            {hidden && !hiddenRows.length && state === null ? (
              <p
                data-no-hidden
                className="-mt-2 mb-4 text-[12px] text-[#94a3b8] night:text-white/45"
              >
                No hidden rows on this day.
              </p>
            ) : null}

            {denied.length || unknown.length ? (
              <p className="mb-3 text-[12px] text-[#94a3b8] night:text-white/45">
                {denied.length
                  ? `${plural(denied.length, "saved column")} need admin access and ${denied.length === 1 ? "is" : "are"} hidden. `
                  : ""}
                {unknown.length
                  ? `${plural(unknown.length, "saved column")} ${unknown.length === 1 ? "doesn't" : "don't"} appear on this day and ${unknown.length === 1 ? "is" : "are"} hidden. `
                  : ""}
                They stay in your column choice.
              </p>
            ) : null}

            {legacyCount > 0 ? (
              <p className={NOTE_CLASS}>
                ⚠️ {plural(legacyCount, "row")} on this page{" "}
                {legacyCount === 1 ? "comes" : "come"} from data frozen before
                Aug 16, 2026 (marked <span className="font-medium">Legacy</span>
                ). Booking questions and most Trip / Booking fields are empty
                for
                {legacyCount === 1 ? " it" : " them"}.
              </p>
            ) : null}

            {state?.kind === "loading" && !shown ? (
              <div className={EMPTY_CLASS}>Loading…</div>
            ) : null}

            {!seeingHidden &&
            shown &&
            shown.rows.length === 0 &&
            state === null ? (
              <div className={EMPTY_CLASS}>
                No live {TAB_FALLBACK_LABEL[tab]} orders for this date.
              </div>
            ) : null}

            {!noSend && !seeingHidden && shown && shown.rows.length ? (
              // 勾选后的操作条（Annie 2026-10-09 样稿第 3 版）：几位几人、发确认 / 提醒、自定义消息、清空。
              <div
                role="group"
                aria-label="Selected guests"
                className="mb-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-white/10 bg-white/[.04] px-3 py-2 text-[13px]"
              >
                <span className="mr-auto text-[#cbd5e1] tabular-nums">
                  {plural(pickedOrders, "order")} selected · {pickedPax} pax
                </span>
                {noConfirm ? null : (
                  <button
                    type="button"
                    disabled={!selected.size}
                    onClick={() =>
                      requestSend(tab === "bus" ? "tour" : "reminder")
                    }
                    className={PRIMARY_ACTION_CLASS}
                  >
                    {tab === "bus" ? "Send tour confirmation" : "Send reminder"}
                  </button>
                )}
                {tab === "bus" && !noConfirm ? (
                  <button
                    type="button"
                    disabled={!selected.size}
                    onClick={() => requestSend("lastminute")}
                    className={LAST_MINUTE_CLASS}
                  >
                    Last Minute Order
                  </button>
                ) : null}
                {noMessage ? null : (
                  <button
                    type="button"
                    disabled={!selected.size}
                    onClick={() => requestSend("message")}
                    className={PRIMARY_ACTION_CLASS}
                  >
                    Send message
                  </button>
                )}
                <button
                  type="button"
                  disabled={!selected.size}
                  onClick={() => {
                    setSelected(new Set());
                    setPendingSend(null);
                  }}
                  className={LEGACY_BTN_CLASS}
                >
                  Clear
                </button>
              </div>
            ) : null}

            {!noConfirm && !seeingHidden && pendingSend ? (
              // 勾里有门票缺 Cfm # 的：先问清楚，staff 主动点了 Skip 才真的发（Annie 2026-10-17）。
              <div
                role="alert"
                className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border-[0.5px] border-[#e4a5a0] bg-[#fdeceb] px-3.5 py-2.5 text-[13px] text-[#7a2424] night:border-rose-400/30 night:bg-rose-400/10 night:text-rose-200"
              >
                <span className="max-w-[60ch]">
                  <b>{missingPicked.length}</b>{" "}
                  {missingPicked.length === 1 ? "order" : "orders"} selected{" "}
                  {missingPicked.length === 1 ? "has" : "have"} no Cfm # yet, so{" "}
                  {missingPicked.length === 1 ? "it" : "they"} cannot be sent:{" "}
                  {missingPicked.map((r) => r.order_number).join(", ")}. Fill it
                  in, or skip and send the rest.
                </span>
                <span className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingSend(null)}
                    className={LEGACY_BTN_CLASS}
                  >
                    Go fill them in
                  </button>
                  <button
                    type="button"
                    disabled={!pickedRows.length}
                    onClick={() => {
                      setCfmOver([]);
                      setSendDialog(pendingSend);
                      setPendingSend(null);
                    }}
                    className={PRIMARY_ACTION_CLASS}
                  >
                    Skip & send {pickedRows.length}
                  </button>
                  {pendingSend === "reminder" ? (
                    // G129：手动发送的拦截都是软的：缺 Cfm # 也可以照发，确认号栏留空，Send Log 里留痕。
                    <button
                      type="button"
                      data-send-anyway-cfm
                      onClick={() => {
                        setCfmOver(missingPicked.map((r) => r.order_number));
                        setSendDialog("reminder");
                        setPendingSend(null);
                      }}
                      className={PRIMARY_ACTION_CLASS}
                    >
                      Send anyway {pickedRows.length + missingPicked.length}
                    </button>
                  ) : null}
                </span>
              </div>
            ) : null}

            {!noConfirm && !seeingHidden && anyMissingCfm ? (
              <p className="mb-2 text-[12.5px] font-medium text-[#ba7517] night:text-amber-300">
                Orders without a Cfm # will be skipped when you send. Click the
                Cfm # cell to fill one in anytime.
              </p>
            ) : null}

            {seeingHidden && shown && hidden ? (
              <HiddenRowsSection
                data={shown}
                hidden={hidden}
                rows={hiddenRows}
                fields={fields}
                loading={loading}
              />
            ) : null}

            {!seeingHidden && shown && shown.rows.length ? (
              <section
                // 团色条：同一个团在 Main manifest → Dispatch → Bus manifest 一路同一个颜色（认 Products
                // → Manifest setup 配的颜色，G142；没配时按团名猜，lib/tour-colors.ts）。
                style={
                  {
                    "--c":
                      !currentPill || currentPill.key.endsWith(":none")
                        ? OTHER_TOUR_COLOR
                        : resolveTourColor(
                            currentPill.color,
                            currentPill.label,
                          ),
                  } as CSSProperties
                }
                className={cn(
                  "mb-4 overflow-hidden rounded-[10px] border-[0.5px] border-l-[5px] border-black/10 border-l-[var(--c)] bg-paper transition-opacity night:border-white/10 night:bg-white/[.032]",
                  loading && "opacity-50",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b-[0.5px] border-black/[.08] bg-paper px-3.5 py-[9px] night:border-white/10 night:bg-white/[.03]">
                  <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[#1a1a1a] night:text-white/90">
                    <span
                      aria-hidden
                      className="size-2.5 rounded-full bg-[var(--c)]"
                    />
                    {currentPill?.label ?? ""}
                  </h2>
                  <span className="text-[11px] text-[#1a1a1a] tabular-nums night:text-white/50">
                    {currentPill
                      ? `${plural(currentPill.orders, "order")} · ${currentPill.pax} pax · ${plural(shown.rows.length, "row")}`
                      : plural(shown.rows.length, "row")}
                  </span>
                </div>
                <ManifestTable
                  data={shown}
                  fields={fields}
                  selected={selected}
                  highlight={highlight}
                  fresh={fresh}
                  selectable={!noSend}
                  onToggle={toggleRows}
                  onSelectUnsent={selectUnsent}
                  onReorder={
                    noFeatures ? undefined : (next) => void reorderFields(next)
                  }
                  onCfmSaved={onCfmSaved}
                  onCfmDirty={onCfmDirty}
                  onUnauthorized={redirectToLogin}
                />
              </section>
            ) : null}

            {viewOnly && noSend ? null : <ManifestsHowToUse />}
            {/* Cfm # 的改动记录（G203，manifests.edit；partner 后端 403，干脆不出）。 */}
            {noFeatures ? null : (
              <ActionLogPanel
                refreshKey={0}
                reloadOnOpen
                onUnauthorized={redirectToLogin}
                load={(before, signal) =>
                  fetchActionLog("/api/manifests/action-log", before, signal)
                }
              />
            )}
          </>
        )}

        {picking && shown ? (
          <FieldPicker
            tabLabel={
              shown.tabs.find((t) => t.key === tab)?.label ??
              TAB_FALLBACK_LABEL[tab]
            }
            catalog={shown.catalog}
            groups={shown.groups}
            selected={savedHere ?? shown.default_fields}
            defaults={shown.default_fields}
            onApply={applyFields}
            onClose={() => setPicking(false)}
          />
        ) : null}

        {sendDialog === "message" && shown ? (
          <MessageDialog
            date={shown.date}
            rows={pickedRows}
            onClose={() => setSendDialog(null)}
            onSent={onSent}
            onUnauthorized={redirectToLogin}
          />
        ) : null}
        {(sendDialog === "tour" || sendDialog === "lastminute") && shown ? (
          <TourConfirmDialog
            lane={sendDialog === "lastminute" ? "last_minute" : undefined}
            date={shown.date}
            rows={pickedRows}
            pill={shown.pill ?? ""}
            sections={shown.sections ?? []}
            pillLabel={currentPill?.label ?? ""}
            onClose={() => setSendDialog(null)}
            onSent={onSent}
            onUnauthorized={redirectToLogin}
          />
        ) : null}
        {sendDialog === "reminder" && shown ? (
          <ReminderDialog
            date={shown.date}
            rows={
              cfmOver.length ? [...pickedRows, ...missingPicked] : pickedRows
            }
            noCfmOrders={cfmOver}
            pill={shown.pill ?? ""}
            tourTypeLabel={currentPill?.label ?? ""}
            onClose={() => {
              setSendDialog(null);
              setCfmOver([]);
            }}
            onSent={() => {
              onSent();
              setCfmOver([]);
            }}
            onUnauthorized={redirectToLogin}
          />
        ) : null}

        {uploadingCfm && date && !viewOnly ? (
          <CfmUploadPanel
            date={date}
            onClose={() => setUploadingCfm(false)}
            onInserted={() => setReloadKey((k) => k + 1)}
            onUnauthorized={redirectToLogin}
          />
        ) : null}
      </main>
    </ViewOnly.Provider>
  );
}

/** 隐藏行的只读表：没有勾选框 / Select all / 发送条；Group 和 Why hidden 两列（后端 reason_label 原样显示）。 */
function HiddenRowsSection({
  data,
  hidden,
  rows,
  fields,
  loading,
}: {
  data: ManifestPage;
  hidden: NonNullable<ManifestPage["hidden"]>;
  rows: ManifestHiddenRow[];
  fields: string[];
  loading: boolean;
}) {
  const byKey = new Map(data.catalog.map((f) => [f.key, f]));
  // order_number 已经是固定第一列，不重复。
  const extra = fields.filter((k) => k !== "order_number");
  return (
    <div data-hidden-section>
      <div className="mb-3 rounded-[10px] border-[0.5px] border-white/20 bg-white/[.07] px-3.5 py-2 text-[12.5px] text-[#cbd5e1]">
        <b className="text-white">For checking only.</b> These orders are kept
        off the Bus and Tickets lists, so they are not in the counts above and
        cannot be selected or sent.
      </div>
      <section
        className={cn(
          "mb-4 overflow-hidden rounded-[10px] border-[0.5px] border-l-[5px] border-black/10 border-l-[#94a3b8] bg-paper transition-opacity night:border-white/10 night:bg-white/[.032]",
          loading && "opacity-50",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b-[0.5px] border-black/[.08] bg-paper px-3.5 py-[9px] night:border-white/10 night:bg-white/[.03]">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[#1a1a1a] night:text-white/90">
            <span aria-hidden className="size-2.5 rounded-full bg-[#94a3b8]" />
            Hidden rows
          </h2>
          <span className="text-[11px] text-[#1a1a1a] tabular-nums night:text-white/50">
            {plural(hidden.pill.orders, "order")} · {hidden.pill.pax} pax ·{" "}
            {plural(rows.length, "row")}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-[12px]">
            <thead className="border-b-[0.5px] border-black/[.08] text-left text-[11px] font-medium text-[#1a1a1a] night:border-white/10 night:text-white/45">
              <tr>
                <th className="px-2.5 py-[7px] font-medium whitespace-nowrap">
                  Order #
                </th>
                <th className="px-2.5 py-[7px] font-medium whitespace-nowrap">
                  Product
                </th>
                <th className="px-2.5 py-[7px] font-medium whitespace-nowrap">
                  Group
                </th>
                <th className="px-2.5 py-[7px] font-medium whitespace-nowrap">
                  Why hidden
                </th>
                <th className="px-2.5 py-[7px] font-medium whitespace-nowrap">
                  Tour date
                </th>
                {extra.map((k) => (
                  <th
                    key={k}
                    className="px-2.5 py-[7px] font-medium whitespace-nowrap"
                  >
                    {byKey.get(k)?.label ?? k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.row_key}
                  data-hidden-row={r.row_key}
                  className="border-b-[0.5px] border-black/[.06] align-middle last:border-b-0 night:border-white/[.06]"
                >
                  <td className="px-2.5 py-2 text-[#378ADD] night:text-sky-300">
                    {r.order_number}
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap text-[#1a1a1a] night:text-white/85">
                    {r.product_code}
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap text-[#1a1a1a] night:text-white/85">
                    {r.group_name}
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    <span
                      data-why={r.reason}
                      className={cn(
                        "inline-block rounded-[9px] border px-2 text-[11px]",
                        r.reason === "product_category_in_operational_group"
                          ? "border-[#e0b36a] bg-[#fff4dc] text-[#7a4b00]"
                          : "border-[#c9c2b8] bg-[#f6f4f0] text-[#4a4540]",
                      )}
                    >
                      {r.reason_label}
                    </span>
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap text-[#1a1a1a] night:text-white/85">
                    {r.tour_date}
                  </td>
                  {extra.map((k) => (
                    <td
                      key={k}
                      className={cn(
                        "px-2.5 py-2 text-[#1a1a1a] night:text-white/85",
                        (byKey.get(k)?.type === "number" ||
                          byKey.get(k)?.type === "money") &&
                          "text-right tabular-nums",
                      )}
                    >
                      <Cell
                        field={byKey.get(k)}
                        row={r as unknown as ManifestRow}
                        fieldKey={k}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ManifestTable({
  data,
  fields,
  selected,
  highlight,
  fresh,
  selectable,
  onToggle,
  onSelectUnsent,
  onReorder,
  onCfmSaved,
  onCfmDirty,
  onUnauthorized,
}: {
  data: ManifestPage;
  /** 显示的列（staff 选的，不含为勾选多要的辅助列）。 */
  fields: string[];
  selected: ReadonlySet<string>;
  /** 搜索跳过来的那一行，标黄。 */
  highlight: string | null;
  /** Sync Rezdy 刚加进来的单（订单号），标绿。 */
  fresh: ReadonlySet<string>;
  /** 有勾选框（勾选只为发送；partner 什么都不能发时没有）。 */
  selectable: boolean;
  onToggle: (rowKeys: readonly string[], on: boolean) => void;
  /** 只勾还没发过的订单。 */
  onSelectUnsent: () => void;
  /** 拖表头换了顺序：新的整列顺序。没有 = 表头不能拖（partner）。 */
  onReorder?: (fields: string[]) => void;
  onCfmSaved: (rowKey: string, values: ManifestRow["values"]) => void;
  /** 某一行的 Cfm # 改了没存 / 存好了。 */
  onCfmDirty: (rowKey: string, dirty: boolean) => void;
  onUnauthorized: () => void;
}) {
  // partner 不能发时没有勾选；Cfm # 能不能改由格子自己看 ViewOnly（manifests.edit）。
  const viewOnly = !selectable;
  const byKey = new Map(data.catalog.map((f) => [f.key, f]));
  const tab = data.tab;
  /** 正在拖的列、指着的列（指着的那列左 / 右边画一条蓝线，表示会落在哪边）。 */
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  /** 往右拖落在目标后面、往左拖落在目标前面（同 Tracking 页）。 */
  function moveField(from: string, to: string) {
    if (from === to) return;
    const forward = fields.indexOf(from) < fields.indexOf(to);
    const rest = fields.filter((k) => k !== from);
    const at = rest.indexOf(to) + (forward ? 1 : 0);
    onReorder?.([...rest.slice(0, at), from, ...rest.slice(at)]);
  }
  const allOn =
    data.rows.length > 0 && data.rows.every((r) => selected.has(r.row_key));
  const sections = data.sections ?? [];
  // 团胶囊「g:<id>」里的 id，存节的 Cfm # 用（G198）。
  const pillGroupId = /^g:(\d+)$/.exec(data.pill ?? "")?.[1];
  // 勾选框 + 计数列 + 字段列。
  const colSpan = fields.length + 2;

  /**
   * 单号左边的计数（Annie 2026-10-15）：每个团（节）各自从 1 排，按单算——
   * 同一单有几行时只在第一行写号，最后一个号 = 节标题的「N orders」。没分节时整张表从 1 排。
   */
  function numberRows(rows: ManifestRow[]) {
    const seen = new Map<string, number>();
    return rows.map((r) => {
      if (seen.has(r.order_number)) return rowTr(r, null);
      seen.set(r.order_number, seen.size + 1);
      return rowTr(r, seen.size);
    });
  }

  function rowTr(r: ManifestRow, n: number | null) {
    const hasCfm = isSelectable(r, tab);
    // 门票提醒发过的（后端已经把它们排到最后）：原来整行变灰；Annie 2026-10-15「灰字都要黑」⇒
    // 字照常黑，改用发送页统一的淡黄行（同 legacy-ui / manifest-preview 的 #fff8e1）标出发过。
    const sentTickets = tab === "tickets" && !!sentAt(r, "tickets");
    // 没填 Cfm # 的门票行：整行标红提醒（Annie 2026-10-17）；勾选本身不再被这个挡住，
    // 真正拦截挪到了发送前的 Skip & send 确认条（见上面 requestSend）。
    const missingCfm = tab === "tickets" && !hasCfm;
    return (
      <tr
        key={r.row_key}
        data-row={r.row_key}
        data-highlight={r.row_key === highlight ? "" : undefined}
        data-fresh={fresh.has(r.order_number) ? "" : undefined}
        className={cn(
          "border-b-[0.5px] border-black/[.06] align-middle last:border-b-0 night:border-white/[.06]",
          r.row_key === highlight
            ? "bg-[#fff3cd] hover:bg-[#ffecb3] night:bg-amber-400/15 night:hover:bg-amber-400/20"
            : fresh.has(r.order_number)
              ? "bg-[#dcfce7] transition-colors night:bg-emerald-400/15"
              : sentTickets
                ? "bg-[#fff8e1] hover:bg-[#fff3cd] night:bg-amber-400/[.06] night:hover:bg-amber-400/10"
                : missingCfm
                  ? "bg-[#fdeceb] hover:bg-[#fbdedb] night:bg-rose-400/10 night:hover:bg-rose-400/15"
                  : "hover:bg-[#fafaf8] night:hover:bg-white/[.03]",
        )}
      >
        <td className="w-9 p-0">
          {/* 整个单元格都能点（Annie 2026-10-18：勾选框太小太难点中）。 */}
          <label
            hidden={viewOnly}
            className="flex min-h-9 cursor-pointer items-center justify-center px-2.5 py-1.5"
          >
            <input
              type="checkbox"
              className={CHECK_BIG}
              aria-label={`Select ${r.order_number}`}
              checked={selected.has(r.row_key)}
              onChange={(e) => onToggle([r.row_key], e.target.checked)}
            />
          </label>
        </td>
        <td
          data-count
          className="w-7 py-2 pr-1 pl-1 text-right text-[#1a1a1a] tabular-nums night:text-white/60"
        >
          {n}
        </td>
        {fields.map((k, i) => (
          <td
            key={k}
            className={cn(
              "px-2.5 py-2",
              k === "order_number"
                ? "text-[#378ADD] night:text-sky-300"
                : "text-[#1a1a1a] night:text-white/85",
              (byKey.get(k)?.type === "number" ||
                byKey.get(k)?.type === "money") &&
                "text-right tabular-nums",
            )}
          >
            {k === STAFF_CFM_KEY ? (
              <CfmInput
                row={r}
                onSaved={onCfmSaved}
                onDirty={onCfmDirty}
                onUnauthorized={onUnauthorized}
              />
            ) : (
              <Cell field={byKey.get(k)} row={r} fieldKey={k} />
            )}
            {i === 0 && isLegacy(r) ? (
              <span
                title="From data frozen before Aug 16, 2026 — booking questions and most Trip / Booking fields are empty"
                className="ml-1.5 inline-block rounded-[10px] bg-[#faeeda] px-2 py-0.5 text-[11px] text-[#ba7517] night:bg-amber-400/15 night:text-amber-300"
              >
                Legacy
              </span>
            ) : null}
          </td>
        ))}
      </tr>
    );
  }

  let tourIndex = 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[800px] border-collapse text-[12px]">
        <thead className="border-b-[0.5px] border-black/[.08] text-left text-[11px] font-medium text-[#1a1a1a] night:border-white/10 night:text-white/45">
          <tr>
            {/* 表头左上角「Select all」（带文字，Annie 2026-10-09：不能只是一个框）。 */}
            <th className="bg-paper px-2.5 py-[7px] font-medium whitespace-nowrap night:bg-transparent">
              <label
                hidden={viewOnly}
                className="inline-flex cursor-pointer items-center gap-1.5 text-[#1a1a1a] night:text-white/85"
              >
                <input
                  type="checkbox"
                  className={CHECK_BIG}
                  checked={allOn}
                  disabled={!data.rows.length}
                  onChange={(e) =>
                    onToggle(
                      data.rows.map((r) => r.row_key),
                      e.target.checked,
                    )
                  }
                />
                Select all
              </label>
              <button
                type="button"
                hidden={viewOnly}
                disabled={!data.rows.length}
                onClick={onSelectUnsent}
                className="ml-2 cursor-pointer text-[#1a1a1a] disabled:cursor-not-allowed disabled:opacity-50 night:text-white/85"
              >
                Select all unsent tours
              </button>
            </th>
            <th
              aria-label="Count"
              className="bg-paper px-1 py-[7px] text-right font-medium night:bg-transparent"
            >
              #
            </th>
            {fields.map((k) => {
              const f = byKey.get(k);
              const numeric = f?.type === "number" || f?.type === "money";
              const target = dragKey !== null && overKey === k && dragKey !== k;
              const toRight =
                target && fields.indexOf(dragKey) < fields.indexOf(k);
              return (
                <th
                  key={k}
                  data-col={k}
                  draggable={!!onReorder}
                  title={onReorder ? "Drag to move this column" : undefined}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", k);
                    setDragKey(k);
                  }}
                  onDragOver={(e) => {
                    if (dragKey === null) return;
                    e.preventDefault();
                    if (overKey !== k) setOverKey(k);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragKey !== null) moveField(dragKey, k);
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  onDragEnd={() => {
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  className={cn(
                    "bg-paper px-2.5 py-[7px] font-medium whitespace-nowrap night:bg-transparent",
                    onReorder &&
                      "cursor-grab hover:bg-[#f9f9f7] night:hover:bg-white/[.04]",
                    numeric && "text-right",
                    dragKey === k && "opacity-50",
                    target &&
                      (toRight
                        ? "shadow-[inset_-2px_0_0_#378ADD]"
                        : "shadow-[inset_2px_0_0_#378ADD]"),
                  )}
                >
                  {f?.label ?? k}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sections.length
            ? sections.flatMap((sec) => {
                const rows = data.rows.filter((r) => r.section === sec.key);
                const keys = rows.map((r) => r.row_key);
                const on =
                  keys.length > 0 && keys.every((k) => selected.has(k));
                const bg = sectionBg(
                  sec.kind,
                  sec.kind === "tour" ? tourIndex++ : 0,
                );
                return [
                  <tr key={`sec:${sec.key}`} data-section={sec.key}>
                    <td
                      colSpan={colSpan}
                      style={{ background: bg }}
                      className="px-2.5 py-1.5 text-[12px] font-semibold tracking-[.02em] text-[#1a1a1a] night:text-white/90"
                    >
                      <label className="inline-flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          hidden={viewOnly}
                          className={CHECK_BIG}
                          aria-label={`Select all in ${sec.title}`}
                          checked={on}
                          disabled={!keys.length}
                          onChange={(e) => onToggle(keys, e.target.checked)}
                        />
                        {sec.title}
                      </label>
                      <span className="ml-2 font-normal text-[#1a1a1a]">
                        {plural(sec.orders, "order")} · {sec.pax} pax
                        {sec.show_cfm && sec.tour_time
                          ? ` · Tour time ${sec.tour_time}`
                          : ""}
                      </span>
                      {/* G198 preview ③：开了格的节，Cfm # 靠左紧跟在后面。 */}
                      {sec.show_cfm && pillGroupId ? (
                        <SectionCfm
                          section={sec}
                          date={data.date}
                          manifestId={Number(pillGroupId)}
                          onUnauthorized={onUnauthorized}
                        />
                      ) : null}
                    </td>
                  </tr>,
                  ...numberRows(rows),
                ];
              })
            : numberRows(data.rows)}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  field,
  row,
  fieldKey,
}: {
  field: ManifestField | undefined;
  row: ManifestRow;
  fieldKey: string;
}) {
  const text = formatValue(field, row.values[fieldKey], row);
  if (!text)
    return <span className="text-[#1a1a1a] night:text-white/25">—</span>;
  const long = text.length > 40;
  return (
    <span
      className={cn(
        long
          ? "block max-w-xs min-w-48 [overflow-wrap:anywhere] whitespace-pre-line"
          : "whitespace-nowrap",
      )}
    >
      {text}
    </span>
  );
}

type CfmState = "saving" | "saved" | "failed";

/**
 * staff 的确认号（自动保存盘点 A2，Annie「4项全部动手」）：照节标题 Cfm # 的样子，改了以后格旁出蓝色 Save，
 * 按 Save 或 Enter 才存（离开框不再存）；Esc 放弃。存好闪绿「Saved」，失败红字写原因、保留输入。
 */
function CfmInput({
  row,
  onSaved,
  onDirty,
  onUnauthorized,
}: {
  row: ManifestRow;
  onSaved: (rowKey: string, values: ManifestRow["values"]) => void;
  onDirty: (rowKey: string, dirty: boolean) => void;
  onUnauthorized: () => void;
}) {
  const stored = row.values[STAFF_CFM_KEY];
  const storedText =
    stored === null || stored === undefined ? "" : String(stored);
  const [text, setText] = useState(storedText);
  const [status, setStatus] = useState<CfmState | null>(null);
  const [error, setError] = useState("");
  const viewOnly = useViewOnly();
  useEffect(() => setText(storedText), [storedText]);
  const dirty = !viewOnly && text.trim() !== storedText;
  const rowKey = row.row_key;
  useEffect(() => {
    onDirty(rowKey, dirty);
  }, [rowKey, dirty, onDirty]);
  // 这一行不在了（换天 / 换标签）：不算没存的。
  useEffect(() => () => onDirty(rowKey, false), [rowKey, onDirty]);

  async function save() {
    if (viewOnly || status === "saving") return;
    const next = text.trim();
    if (next === storedText) {
      setText(storedText);
      return;
    }
    setStatus("saving");
    setError("");
    try {
      const result = await saveManifestCfm({
        order_number: row.order_number,
        product_code: row.product_code,
        tour_date: row.tour_date,
        confirmation_no: next,
      });
      // 清空后列表里 by / at 也是空的（后端契约 C 补充），这里同样清掉，和刷新后一致。
      const cleared = !result.confirmation_no;
      onSaved(row.row_key, {
        [STAFF_CFM_KEY]: cleared ? null : result.confirmation_no,
        staff_cfm_by: cleared ? null : result.updated_by,
        staff_cfm_at: cleared ? null : result.updated_at,
      });
      setText(result.confirmation_no);
      setStatus("saved");
      setTimeout(() => setStatus((s) => (s === "saved" ? null : s)), 1400);
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setStatus("failed");
      setError(
        isStatus(e, 404)
          ? "This order / product / date is no longer in Rezdy."
          : describeError(e),
      );
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1">
        <input
          type="text"
          aria-label={`Cfm # for ${row.order_number} ${row.product_code}`}
          value={text}
          maxLength={100}
          placeholder={viewOnly ? "" : "Add #"}
          readOnly={viewOnly}
          disabled={status === "saving"}
          onChange={(e) => {
            setText(e.target.value);
            if (status === "failed") setStatus(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setText(storedText);
              setStatus(null);
              setError("");
            }
          }}
          className={cn(
            // 旧页 .inline-edit：无框、底下一条虚线；存的状态用底线和底色表示。
            "w-[90px] border-b bg-transparent px-0.5 py-px font-[inherit] text-[12px] text-[#1a1a1a] placeholder:text-[#ccc] focus:border-solid focus:outline-none night:text-white night:placeholder:text-white/30",
            status === "saving" &&
              "border-amber-400 bg-amber-50 night:border-amber-400/60 night:bg-amber-400/10",
            status === "saved" &&
              "border-emerald-500 bg-emerald-50 night:border-emerald-400/60 night:bg-emerald-400/10",
            status === "failed" &&
              "border-red-400 bg-red-50 night:border-red-400/60 night:bg-red-400/10",
            !status &&
              "border-dashed border-black/20 focus:border-black/50 night:border-white/25 night:focus:border-white/60",
          )}
        />
        {dirty || status === "saving" ? (
          // 照节标题 Cfm # 的 Save（蓝色提交键）；改了才出，免得一整列都是键。
          <button
            type="button"
            data-cfm-save
            onClick={() => void save()}
            disabled={status === "saving"}
            className="cursor-pointer rounded-md border border-[#3b82f6] bg-[#3b82f6] px-2 py-px text-[11px] font-bold whitespace-nowrap text-white disabled:cursor-default disabled:opacity-50"
          >
            {status === "saving" ? "Saving…" : "Save"}
          </button>
        ) : status === "saved" ? (
          <span
            role="status"
            data-cfm-saved
            className="text-[11px] font-semibold text-[#047857] night:text-emerald-300"
          >
            Saved
          </span>
        ) : null}
      </span>
      {error ? (
        <span
          role="alert"
          className="text-[11px] text-[#a32d2d] night:text-red-300"
        >
          Not saved: {error}
        </span>
      ) : null}
    </div>
  );
}

function ManifestsHowToUse() {
  return (
    <HowToUse
      title="How to use — Manifests"
      items={[
        <>
          Pick a day with ‹ › or the date box, or click <b>Today</b>. Cancelled
          orders are left out.
        </>,
        // Sync Rezdy 那几条照预览第 3 版的建议文字（Annie 2026-10-15）。
        <>
          <b>Sync Rezdy</b> (the Rezdy button at the far right of the top row):
          pick the day, then click it. The list reloads. The text next to the
          button changes to &ldquo;Last updated from Rezdy&rdquo; with the time,
          your name and what changed. New orders are highlighted for a few
          seconds. Cancelled orders leave the list. If it says &ldquo;Could not
          reach Rezdy&rdquo;, nothing was changed. Wait a minute and click the
          sync button again. Past days cannot be synced; the button is greyed
          out.
        </>,
        <>
          <b>Search</b>: type an order #, guest name, phone or email. It looks
          through every tab and group on this day. Click a result to jump to it;
          the row is highlighted in yellow.
        </>,
        <>
          <b>Bus Tour</b> shows one group at a time (the groups from Settings →
          Products). <b>Tickets - SelfDrive</b> shows one tour type at a time
          (the Tour type column in Settings → Products). Click a pill to switch;
          each pill shows its pax. &ldquo;No group yet&rdquo; / &ldquo;No tour
          type yet&rdquo; collects products that haven&apos;t been set up in
          Settings → Products.
        </>,
        <>
          Click <b>☰ Columns</b> to choose which fields to show. Every field
          Rezdy sends is there, grouped (Guest, Trip, Booking, Our records,
          Booking questions…). Your choice is saved to your account, separately
          for each tab. Booking questions only appear on days when an order on
          that tab asked them.
        </>,
        <>
          To move a column: in <b>☰ Columns</b>, drag its box under Column
          order to where you want it and click Apply. Or drag its header on the
          page left or right; that order is saved to your account right away.
        </>,
        <>
          <b>Cfm #</b>: if the Cfm # column is shown, type the confirmation
          number in the box, then click <b>Save</b> next to it (or press Enter).
          Clicking out of the box does not save; Esc puts the old number back.
          The box turns green and shows Saved when it is saved; if it can&apos;t
          be saved, the reason shows in red. Rezdy&apos;s own confirmation
          number is a separate, read-only column.
        </>,
        <>
          Tick orders. Tick a section header to select that section, or{" "}
          <b>Select all</b> at the top left of the table to select everyone. A
          group with sections set in Settings → Products → Manifest setup (for
          example UPPER / LOWER / X for Antelope) is split into those sections.
        </>,
        <>
          <b>Bus Tour</b>: <b>Send tour confirmation</b>. Pick the tour type for
          each section, then Send (a section left on Don&apos;t send is not
          sent). Orders already sent from here or from the Tour Confirmation
          page are skipped; tick them on the result and click Send anyway to
          send again. MTLV is not included.
        </>,
        // G189（Annie 2026-10-26 preview 第 3 版「动手」）：How to use 补的 4 条。
        <>
          <b>Shuttle sections</b> (orange header) and the{" "}
          <b>Boulder City Shuttle</b> group: tick them and click{" "}
          <b>Send tour confirmation</b> as usual. You do not pick a tour type
          for them; they use the shared Shuttle text from Settings → Content
          Studio → Shuttle.
        </>,
        <>
          If the shared Shuttle text in Settings → Content Studio → Shuttle is
          not complete, shuttle orders are not sent and are listed under{" "}
          <b>Not sent</b>. Fill it, then send those orders again. The other
          orders in the same send go out normally.
        </>,
        <>
          <b>Last Minute Order</b> (Bus Tour only): for orders placed within the
          cancellation window, or after 6 PM the day before the tour. The
          scheduled send does not send these, so they stay here. Tick them,
          click Last Minute Order, pick the tour type, then Send. It uses the
          Last Minute Order email. An order sent this way counts as already sent
          for Send tour confirmation, and the other way round. Last Minute Order
          does not send to shuttle guests; use Send tour confirmation for them.
        </>,
        <>
          Shuttle guests confirm by opening the link in the SMS or email. Track
          them on the Tour Confirmation Tracking page under <b>Shuttle</b>. To
          send a shuttle confirmation again, do it from Manifests.
        </>,
        <>
          <b>Tickets</b>: rows without a Cfm # are highlighted in red; you can
          still tick them. Clicking <b>Send reminder</b> with some of those
          ticked asks you to skip them (send the rest) or fill them in first.
          Sent rows move to the bottom.
        </>,
        <>
          <b>Send message</b>: write your own text, choose SMS and/or Email,
          then Review and Send. One message per order. It shows up in
          Broadcasting Log. Orders that already got the exact same message for
          this tour date (from here or from Tracking) are skipped unless you
          tick Send anyway. A changed message goes to everyone. SMS can be at
          most 300 characters, plain characters only (no emoji, curly quotes or
          long dashes). If it is longer, send it by Email.
        </>,
        <>
          If an order fails, the result lists the order number and the reason.
          Fix it (phone, email, Cfm #) and send that order again. If the page
          says it lost contact with the server, do not send again — check the
          Send Log first.
        </>,
        <>
          A row marked <b>Legacy</b> comes from data frozen before Aug 16, 2026.
          Booking questions and most Trip / Booking fields are empty for it.
        </>,
        <>
          <b>↓ Export CSV</b> downloads the rows and columns you see right now
          (this tab and pill only).
        </>,
        <>
          <b>Show hidden rows</b> (next to Export CSV): shows the orders this
          page normally keeps out, such as products in an Unmapped group or a
          custom category (for example fees). They are for checking only: they
          are not counted in Bus or Tickets, and they cannot be selected or
          sent.
        </>,
        <>
          <b>↑ Upload confirmation #s</b>: upload a vendor&apos;s spreadsheet
          with an order number column and a confirmation number column. Matched
          by order number against this date only, across every tab and group —
          not just the one you&apos;re viewing. Rows that match cleanly get the
          Cfm # written in; a pax mismatch, more than one system row for the
          same order, or a duplicate in the file are left red for you to check
          by hand instead of guessing.
        </>,
      ]}
    />
  );
}
