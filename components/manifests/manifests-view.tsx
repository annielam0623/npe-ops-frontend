"use client";

import {
  PhoneMore,
  PhoneOneLine,
  usePhoneInfo,
} from "@/components/ui/phone";
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
import { mainManifestGuestLunchNote } from "@/lib/guest-lunch";
import { isYmd, laToday, shiftYmd } from "@/lib/la-date";
import {
  fetchManifestPage,
  type ManifestSearchEntry,
  saveManifestCfm,
} from "@/lib/manifests-api";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { replaceUrl, useLeaveGuard } from "@/lib/use-leave-guard";
import { fetchUserPref, saveUserPref } from "@/lib/user-prefs-api";
import { OTHER_TOUR_COLOR, resolveTourColor } from "@/lib/tour-colors";
import { usePageVisibility } from "@/lib/page-visibility";
import { byTick } from "@/lib/permissions";
import { withoutManifestMoney } from "@/lib/money-view";
import { usePermissions } from "@/lib/staff-permissions";
import {
  formatCsvNoteTime,
  noteAuthor,
  type StaffNote,
} from "@/lib/staff-notes-api";
import { cn } from "@/lib/utils";
import { useViewOnly, ViewOnly } from "@/components/ui/view-only";
import type {
  ManifestField,
  ManifestHiddenRow,
  ManifestPage,
  ManifestRow,
  ManifestTab,
  ManifestTabKey,
} from "@/types";

import { CfmUploadPanel } from "./cfm-upload-panel";
import {
  buildCsv,
  buildHiddenCsv,
  csvFilename,
  formatValue,
  isLegacy,
  cfmProblem,
  NO_CFM_REASON,
  isTabKey,
  colsFor,
  EMPTY_COLS,
  hasOwnCols,
  parseSavedCols,
  type SavedCols,
  serializeSavedCols,
  paxOf,
  canSend,
  cfmMismatch,
  cfmMismatchTip,
  plural,
  REZDY_CFM_KEY,
  PREF_KEY,
  requestFields,
  sectionBg,
  sentAt,
  shownFields,
  STAFF_CFM_KEY,
  TAB_KEYS,
  CHECK_BIG,
  missingWaiver,
  pageNeedsWaiver,
  rememberWaiverChoice,
  softBlocks,
  WAIVER_KEY,
  WAIVER_OFF,
  withWaiverColumn,
  withBookedOrder,
  withTicketSessions,
  rememberMarkChoice,
  withMarkColumns,
  withMarks,
  NOTE_KEY,
  rememberNoteChoice,
  withNoteColumn,
  withNotes,
} from "./config";
import { NoteInput } from "./note-cell";
import { StaffNoteCell } from "./staff-note-cell";
import { FieldPicker } from "./field-picker";
import { ManifestSearch } from "./manifest-search";
import { SectionCfm } from "./section-cfm";
import { WaiverInput } from "./waiver-cell";
import { WaiverUploadPanel } from "./waiver-upload-panel";
import {
  MessageDialog,
  ReminderDialog,
  TourConfirmDialog,
} from "./send-dialogs";

const NO_KEYS: ReadonlySet<string> = new Set();

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

/** 账号里存的列：undefined = 还没拉；null = 没存过（用后端默认列）。 */
type SavedFields = Record<ManifestTabKey, SavedCols | undefined>;

// 样子照旧后台 manifests.html / base.html（Annie 2026-10-07：和旧版一模一样）。
/** base.html 的 .btn：深色底上的半透明按钮。 */
const LEGACY_BTN_CLASS =
  "inline-flex h-9 items-center justify-center gap-2 rounded-[10px] border border-white/10 bg-white/[.04] px-3.5 text-[13px] font-[650] whitespace-nowrap text-white transition hover:bg-white/[.08] disabled:cursor-not-allowed disabled:opacity-50";
/** 淡红确认条上的次要键（「Go fill them in」）：同 LEGACY_BTN_CLASS 的大小，字用条上的深红（白字在淡红底上看不见）。 */
const RED_BAR_BTN_CLASS =
  "inline-flex h-9 items-center justify-center gap-2 rounded-[10px] border border-[#e4a5a0] bg-white/60 px-3.5 text-[13px] font-[650] whitespace-nowrap text-[#7a2424] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 night:border-rose-400/30 night:bg-white/[.04] night:text-rose-200 night:hover:bg-white/[.08]";
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
  admin_fee: "Admin fee",
};

export function ManifestsView() {
  // 152 回退修：复制订单号只给纯单号。
  useOrderNumberCopy();
  /** 置顶 115 题 8 A：Legacy 黄框手机上收进 i。 */
  const legacyInfo = usePhoneInfo("About legacy rows");
  // partner 只能看（Annie 2026-10-27「合作方只能看manifest和订单，不能改或者选任何功能，比如加colum之类的」）：
  // 勾了 manifests.edit 也不上传确认号、不改 Cfm #、不 Sync Rezdy；Columns、拖表头、Export CSV、Show hidden rows 都不出。
  // 发送（团确认 / 门票提醒 / Send message）partner 一律没有（Annie「发送只能是我们内部员工发送」），也就没有勾选框。员工照旧。
  // 员工也按勾（Annie 2026-10-30 置顶 10c「全部按照勾选」）：总开关对他开着时，没勾 manifests.edit 就只看，
  // 没勾 manifests.send / broadcast.send 就没有对应的发送；关着照旧全给，Super Admin 全给。
  const perms = usePermissions();
  const isSuperAdmin = usePageVisibility().isSuperAdmin;
  const tick = (code: string) =>
    byTick(perms, code, { superAdmin: isSuperAdmin });
  const noFeatures = perms.partnerView;
  const viewOnly =
    perms.partnerLacks("manifests.edit") || !tick("manifests.edit");
  const noConfirm =
    perms.partnerLacks("manifests.send") || !tick("manifests.send");
  const noMessage =
    perms.partnerLacks("broadcast.send") || !tick("broadcast.send");
  const noSend = noConfirm && noMessage;
  const [date, setDate] = useState("");
  const [tab, setTab] = useState<ManifestTabKey>("bus");
  /** 请求的胶囊；空串 = 让后端挑 A→Z 第一颗。显示以返回的 data.pill 为准。 */
  const [pill, setPill] = useState("");
  const [saved, setSaved] = useState<SavedFields>({
    bus: undefined,
    tickets: undefined,
    admin_fee: undefined,
  });
  const [prefNote, setPrefNote] = useState("");
  const [data, setData] = useState<ManifestPage | null>(null);
  const [state, setState] = useState<LoadState | null>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [picking, setPicking] = useState(false);
  const [uploadingCfm, setUploadingCfm] = useState(false);
  const [uploadingWaiver, setUploadingWaiver] = useState(false);
  /**
   * 置顶 74：Tickets 没存过列（用后端默认列）、这一页又有要 waiver 的单时，默认列里没有 waiver 那几项 ⇒
   * 记下后端的默认列，再按「默认列 + 辅助列」重拉一次，Waiver link 格和拦截才有值。
   */
  const [ticketDefaults, setTicketDefaults] = useState<string[] | null>(null);
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
  /** 置顶 51 B：?row= 带来的行，这一页拿到后用一次（预勾 + 去掉网址里的 row / tick）。 */
  const jumpRef = useRef<{ rows: string[]; tick: boolean } | null>(null);
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
    // 置顶 51 B：订单详情「Open in Main manifest →」带来的 ?row=（这单的行，逗号隔开）：标黄、滚到、预勾（tick=0 只标黄）。
    const rows = (params.get("row") ?? "").split(",").filter(Boolean);
    if (rows.length) {
      jumpRef.current = { rows, tick: params.get("tick") !== "0" };
      setHighlight(rows[0]);
      scrolledToRef.current = null;
    }
  }, []);

  // 这个标签存的列（每个标签只拉一次）；这颗胶囊有自己的一套就用自己的（置顶 71）。
  const colsHere = saved[tab];
  const ownHere = hasOwnCols(colsHere, pill);
  const savedHere =
    colsHere === undefined ? undefined : colsFor(colsHere, pill);
  useEffect(() => {
    if (colsHere !== undefined) return;
    const controller = new AbortController();
    fetchUserPref(PREF_KEY[tab], controller.signal)
      .then((value) =>
        setSaved((s) => ({ ...s, [tab]: parseSavedCols(value) })),
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
        setSaved((s) => ({ ...s, [tab]: EMPTY_COLS }));
      });
    return () => controller.abort();
  }, [tab, colsHere, redirectToLogin]);

  const reqSaved =
    savedHere ?? (tab === "tickets" ? ticketDefaults : null) ?? null;
  const fieldsKey = reqSaved ? reqSaved.join(",") : "";
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
        fields: requestFields(reqSaved, tab),
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
    reqSaved,
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

  /** 当前页面里还没发过的订单（门票缺 Cfm # 的也算没发）。 */
  function unsentKeysOf(): string[] {
    return (shown?.rows ?? [])
      .filter((row) => canSend(row) && !sentAt(row, tab))
      .map((row) => row.row_key);
  }
  /**
   * 表头「unsent」框（Annie 2026-10-18 Select unsent；2026-11-21 改成框）：勾上 = 只勾没发过的、其余取消（同以前）；
   * 取消 = 把没发过的那些取消，别的不动。
   */
  function toggleUnsent(on: boolean) {
    const unsentKeys = unsentKeysOf();
    if (on) setSelected(new Set(unsentKeys));
    else
      setSelected((prev) => {
        const next = new Set(prev);
        for (const k of unsentKeys) next.delete(k);
        return next;
      });
  }

  /** 存这个标签的列选择（整个 {shared, pages}）；失败 reject，原因原样给弹窗显示红字。 */
  async function saveCols(next: SavedCols) {
    try {
      await saveUserPref(PREF_KEY[tab], serializeSavedCols(next));
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      throw new Error(describeError(error));
    }
    setSaved((s) => ({ ...s, [tab]: next }));
    setPrefNote("");
  }

  /**
   * ☰ Columns 存（置顶 71，Annie「1 A 2 A 3 apply for this page 用蓝色 apply for all 用白色」）：
   * page = 只给这颗胶囊；all = 整个标签共用、清掉各页自己的（题 1 A）；
   * Reset to default（fields = null）在有自己设置的页只重置这一页，没有就重置共用的那套。
   */
  async function applyFields(fields: string[] | null, scope: "page" | "all") {
    const cur = colsHere ?? EMPTY_COLS;
    let next: SavedCols;
    if (fields === null)
      next = ownHere
        ? { ...cur, pages: { ...cur.pages, [pill]: null } }
        : { ...cur, shared: null };
    else if (scope === "page" && pill)
      next = { ...cur, pages: { ...cur.pages, [pill]: fields } };
    else next = { shared: fields, pages: {} };
    await saveCols(next);
    setPicking(false);
  }

  /** Use the shared columns：这颗胶囊不再用自己的一套，回到整个标签共用的。 */
  async function useSharedCols() {
    const cur = colsHere ?? EMPTY_COLS;
    const pages = { ...cur.pages };
    delete pages[pill];
    await saveCols({ ...cur, pages });
    setPicking(false);
  }

  /**
   * 拖表头换列的顺序（Annie 2026-10-14：后加的 Pickup time 排在最右，挪不过去）：马上存进账号，同 ☰ Columns；
   * 这颗胶囊有自己的一套就存进它自己的，没有就存共用的（置顶 71）。存不上就改回原来的顺序、写原因。
   */
  async function reorderFields(moved: string[]) {
    const before = colsHere ?? EMPTY_COLS;
    const next = shown
      ? rememberMarkChoice(
          rememberNoteChoice(rememberWaiverChoice(moved, shown.rows), shown),
          shown,
        )
      : moved;
    const after: SavedCols = ownHere
      ? { ...before, pages: { ...before.pages, [pill]: next } }
      : { ...before, shared: next };
    setSaved((s) => ({ ...s, [tab]: after }));
    setPrefNote("");
    try {
      await saveUserPref(PREF_KEY[tab], serializeSavedCols(after));
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setSaved((s) => ({ ...s, [tab]: before }));
      setPrefNote(`Could not save the column order: ${describeError(error)}`);
    }
  }

  /** 153：Tickets 场次组哪些收起了（只记这一页：日期 + 标签 + 团胶囊）。 */
  const [fold, setFold] = useState<{
    page: string;
    keys: ReadonlySet<string>;
  }>({ page: "", keys: NO_KEYS });

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
  /** 置顶 74：Waiver link 格改了没存（和 Cfm # 同一份记录，键前面加 w:）。 */
  const onWaiverDirty = useCallback(
    (rowKey: string, dirty: boolean) => onCfmDirty(`w:${rowKey}`, dirty),
    [onCfmDirty],
  );
  /** 150 Notes：备注格改了没存（同一份记录，键前面加 n:）。 */
  const onNoteDirty = useCallback(
    (rowKey: string, dirty: boolean) => onCfmDirty(`n:${rowKey}`, dirty),
    [onCfmDirty],
  );
  useLeaveGuard(
    dirtyCfm.size > 0,
    [...dirtyCfm].some((k) => k.startsWith("w:"))
      ? "A waiver link you typed is not saved yet. Leave without saving?"
      : [...dirtyCfm].some((k) => k.startsWith("n:"))
        ? "A note you typed is not saved yet. Leave without saving?"
        : "A Cfm # you typed is not saved yet. Leave without saving?",
  );

  /** 备注存好：同一单、同一产品、同一团期的行一起换（往返 shuttle 两段是同一条）。 */
  function onNoteSaved(
    key: { order_number: string; product_code: string; tour_date: string },
    note: { note: string; by: string; at: string | null },
  ) {
    setData((d) =>
      d
        ? {
            ...d,
            rows: d.rows.map((r) =>
              r.order_number === key.order_number &&
              r.product_code === key.product_code &&
              r.tour_date === key.tour_date
                ? {
                    ...r,
                    note: note.note,
                    note_updated_by: note.by,
                    note_updated_at: note.at,
                  }
                : r,
            ),
          }
        : d,
    );
  }

  /**
   * ★ Note 加好（后端合同 v1）：同单、同产品的行都加上（往返 shuttle 两段 / 别的团期同一产品）；
   * 整单的（product_code null）同单每一行都加。CSV 那一格先在前面补上，下次读页面以后端拼的为准。
   */
  function onStaffNoteAdded(row: ManifestRow, note: StaffNote) {
    const body = note.body.replace(/\s*[\r\n]+\s*/g, " ");
    const line = `${noteAuthor(note)} ${formatCsvNoteTime(note.created_at)}: ${body}`;
    setData((d) =>
      d
        ? {
            ...d,
            rows: d.rows.map((r) =>
              r.order_number === row.order_number &&
              Array.isArray(r.staff_notes) &&
              (note.product_code === null ||
                r.product_code === note.product_code) &&
              !r.staff_notes.some((n) => n.id === note.id)
                ? {
                    ...r,
                    staff_notes: [note, ...r.staff_notes],
                    staff_notes_csv: r.staff_notes_csv
                      ? `${line} | ${r.staff_notes_csv}`
                      : line,
                  }
                : r,
            ),
          }
        : d,
    );
  }

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
  // 没勾 See prices, agent & commission（orders.money_view，题 8）：金额 / 代理商列整列不出，Columns 里也没有
  // （后端这时本来就不给，这里再挡一道：存着的列、旧后端都不出空栏，也不算进「need admin access」那句）。
  // 150 Notes：Bus、Tickets 标签多一列备注（后端给了 note 才有），见 config.withNotes。
  // 默认 By order time；记在这台电脑这个浏览器（P3 A，localStorage 读写失败就照默认）。
  const [ticketView, setTicketView] = useState<TicketView>("time");
  useEffect(() => {
    try {
      if (localStorage.getItem(TICKET_VIEW_KEY) === "session")
        setTicketView("session");
    } catch {
      // 隐私模式 / 被挡：照默认。
    }
  }, []);
  function changeTicketView(next: TicketView) {
    setTicketView(next);
    try {
      localStorage.setItem(TICKET_VIEW_KEY, next);
    } catch {
      // 记不住也照样切换。
    }
  }
  // Bus / Admin fee 两种看法（Annie 2026-11-21 第 5 件「其他问题全部同意推荐，动手」，题 1–4 都 A）：
  // 默认 By pickup time（= 后端原来的顺序）；记在这台电脑这个浏览器，Bus 和 Admin fee 共用一个键，跟 Tickets 分开。
  const [busView, setBusView] = useState<BusView>("pickup");
  useEffect(() => {
    try {
      if (localStorage.getItem(BUS_VIEW_KEY) === "order") setBusView("order");
    } catch {
      // 隐私模式 / 被挡：照默认。
    }
  }, []);
  function changeBusView(next: BusView) {
    setBusView(next);
    try {
      localStorage.setItem(BUS_VIEW_KEY, next);
    } catch {
      // 记不住也照样切换。
    }
  }
  // Tickets 两种看法（Annie 2026-11-19「同意推荐，动手」）：By session = 按场次分组（153）；
  // By order time = 不分组，照后端原来的先后（门票提醒发过的沉底 → 下单先后，P1 A）。勾选按 row_key 记，切换不清。
  const shownBase =
    data && data.tab === tab
      ? withMarks(
          withNotes(perms.canSeeMoney ? data : withoutManifestMoney(data)),
        )
      : null;
  const shown = !shownBase
    ? null
    : shownBase.tab === "tickets"
      ? ticketView === "session"
        ? withTicketSessions(shownBase)
        : shownBase
      : busView === "order"
        ? withBookedOrder(shownBase)
        : shownBase;
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
  // 不能发的标签（admin_fee = CHD 组的 Admin fee，后端 G232）先不显示：样子还没给 Annie 看过。
  const tabs =
    data?.tabs ??
    TAB_KEYS.map((key): ManifestTab => ({
      key,
      label: TAB_FALLBACK_LABEL[key],
      rows: 0,
      orders: 0,
      pax: 0,
    }));
  // 这个标签能不能发（admin_fee = CHD 组的 Admin fee 不能）：不能就没有勾选、没有发送条。
  const tabSendable = tabs.find((t) => t.key === tab)?.sendable !== false;
  // 置顶 51 B：?row= 的行到了：只预勾能发的行（On Hold 带 tick=0 不勾），然后把 row / tick 从网址去掉（刷新不再勾一次）。
  useEffect(() => {
    const jump = jumpRef.current;
    if (!jump || !shown) return;
    const here = shown.rows.filter((r) => jump.rows.includes(r.row_key));
    if (!here.length) return;
    jumpRef.current = null;
    if (jump.tick && !noSend && tabSendable)
      setSelected(new Set(here.filter(canSend).map((r) => r.row_key)));
    const url = new URL(window.location.href);
    url.searchParams.delete("row");
    url.searchParams.delete("tick");
    replaceUrl(url);
  }, [shown, noSend, tabSendable]);
  const currentPill = shown?.pills.find((p) => p.key === shown.pill);
  // 置顶 74：Waiver link 列这一页有要 waiver 的单才自动出（题 1 A），☰ Columns 里关掉就不加。
  // 150 Notes：默认放最后，☰ Columns 里关掉就不加（withNoteColumn）。
  const fields = shown
    ? withMarkColumns(
        withNoteColumn(
        tab === "tickets"
          ? withWaiverColumn(
              shownFields(shown, savedHere ?? ticketDefaults),
              shown.rows,
              savedHere,
            )
          : shownFields(shown, savedHere),
        shown,
        savedHere,
        ),
        shown,
        savedHere,
      )
    : [];
  const needsWaiver =
    tab === "tickets" && !!shown && pageNeedsWaiver(shown.rows);
  // 隐藏行：只在勾了开关、响应里有 hidden 块时才有；有行才出灰色胶囊，没有行写一句小字。
  const hidden = showHidden ? (shown?.hidden ?? null) : null;
  const hiddenRows = hidden?.rows ?? [];
  const seeingHidden = viewHidden && hiddenRows.length > 0;
  // 「存着、但这页用不了」只说 staff 自己存的列，不算为勾选多要的辅助列。
  const isSavedKey = (k: string) => !savedHere || savedHere.includes(k);
  const denied = shown ? shown.denied.filter(isSavedKey) : [];
  const unknown = shown ? shown.unknown.filter(isSavedKey) : [];
  // 勾了以后 Cfm # 被清掉的门票行不再算勾着（发不出去）；不能发的行（CHD 组，canSend）也不算。
  // 置顶 74：要 waiver 却没填链接的门票行同样先拦（同 No Cfm #，一行两个原因合成一条）。
  const pickedRows = shown
    ? shown.rows.filter(
        (r) =>
          selected.has(r.row_key) &&
          canSend(r) &&
          softBlocks(r, tab).length === 0,
      )
    : [];
  const pickedPax = pickedRows.reduce((n, r) => n + paxOf(r), 0);
  const pickedOrders = new Set(pickedRows.map((r) => r.order_number)).size;
  // 153：收起的场次组（题 3 A 不记：换日期 / 标签 / 团胶囊就回到全部展开，题 2 A）。
  const foldPage = shown ? `${shown.date}|${shown.tab}|${shown.pill ?? ""}` : "";
  const folded = fold.page === foldPage ? fold.keys : NO_KEYS;
  const setFolded = (keys: readonly string[], on: boolean) =>
    setFold((cur) => {
      const next = new Set(cur.page === foldPage ? cur.keys : NO_KEYS);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return { page: foldPage, keys: next };
    });
  // 搜索 / Open in Main manifest 跳到的行在收起的组里 ⇒ 把那组打开（不然标黄的行看不见）。
  const highlightSection = highlight
    ? shown?.rows.find((r) => r.row_key === highlight)?.section
    : undefined;
  const highlightFolded = !!highlightSection && folded.has(highlightSection);
  useEffect(() => {
    if (highlightFolded && highlightSection)
      setFold((cur) => {
        const keys = new Set(cur.keys);
        keys.delete(highlightSection);
        return { ...cur, keys };
      });
  }, [highlightFolded, highlightSection]);
  // 勾了、在收起的组里的（题 1 A：照样发，发送条上写明）。
  const foldedRows = shown
    ? shown.rows.filter(
        (r) => selected.has(r.row_key) && !!r.section && folded.has(r.section),
      )
    : [];
  const foldedPicked = {
    orders: new Set(foldedRows.map((r) => r.order_number)).size,
    groups: new Set(foldedRows.map((r) => r.section)).size,
  };
  // 勾了、但门票还没填 Cfm # 的行：点发送时先拦一道，不悄悄漏发。
  const missingPicked = shown
    ? shown.rows.filter(
        (r) =>
          selected.has(r.row_key) &&
          canSend(r) &&
          softBlocks(r, tab).length > 0,
      )
    : [];
  // 只缺 Cfm #（没有 waiver、号也没不对、也不是号太短）⇒ 红条照原来的写法；别的逐单列原因。
  const onlyCfmMissing = missingPicked.every(
    (r) =>
      !missingWaiver(r) &&
      !cfmMismatch(r, tab) &&
      cfmProblem(r, tab) === NO_CFM_REASON,
  );
  // G245：号不对的单不能 Send anyway（后端 can_override=false）；Send anyway 只带其余缺 Cfm # / waiver 的单。
  const softPicked = missingPicked.filter((r) => !cfmMismatch(r, tab));
  const anyMismatchPicked = softPicked.length < missingPicked.length;
  // 这页门票里有没有号不对的行（表格上方黄字多半句）。
  const anyMismatch =
    tab === "tickets" && !!shown?.rows.some((r) => !!r.cfm_mismatch);
  // 这页门票里有没有还没填 Cfm # 或号不到 6 位数字的行（不看有没有勾）：表格上方要不要出黄字提示
  // （Annie 2026-11-07「同意推荐，动手」：号短的也出黄字）。
  const anyMissingCfm =
    tab === "tickets" && !!shown?.rows.some((r) => !!cfmProblem(r, tab));
  const anyMissingWaiver =
    tab === "tickets" && !!shown?.rows.some((r) => missingWaiver(r));

  useEffect(() => {
    if (
      tab === "tickets" &&
      shown &&
      savedHere === null &&
      !ticketDefaults &&
      pageNeedsWaiver(shown.rows) &&
      !shown.rows.some((r) => WAIVER_KEY in r.values)
    )
      setTicketDefaults(shown.default_fields);
  }, [tab, shown, savedHere, ticketDefaults]);

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
              {/* 手机上 Columns / Export / Show hidden rows / Upload 收进「⋯」（Annie 2026-11-01 手机版规则）。 */}
              <PhoneMore>
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
                      const csv = buildHiddenCsv(
                        shown,
                        hidden,
                        fields.filter((k) => !k.startsWith("_")),
                      );
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
                {/* 置顶 74：这一页有要 waiver 的单才出；只对这一天。 */}
                <button
                  type="button"
                  data-waiver-upload
                  hidden={viewOnly || !needsWaiver}
                  onClick={() => setUploadingWaiver(true)}
                  disabled={!date}
                  className={LEGACY_BTN_CLASS}
                >
                  ↑ Upload waiver links
                </button>
              </PhoneMore>
              <span className="text-[12px] text-[#94a3b8] night:text-white/45">
                {loading ? "Loading…" : null}
              </span>
              {/* Sync Rezdy 键去掉了（Annie 2026-10-30「不留，彻底删掉」；订单流固定：订单从 Order List 进 Main manifest）。 */}
            </div>

            {/* 页名「Manifest」和顶栏重复，只留给读屏（Annie 2026-10-19：保留顶栏那个，页内重复的去掉）。 */}
            <h2 className="sr-only">Manifest</h2>

            {/* Annie 2026-10-14：照 Dispatch Assign / Send 的黄框标签（选中的黄框 + 浅黄底 + 底边黄条）。 */}
            {/* 置顶 115 题 8 A：手机上黄框「… frozen …」收进标签后面的 i。 */}
            <div className="mb-3.5 flex flex-wrap items-center max-sm:mb-2.5">
            <div
              role="tablist"
              aria-label="Manifest type"
              className="flex flex-wrap"
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
                      {data ? `${t.orders} · ${t.pax} pax${unknownPax(t)}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
            {legacyCount > 0 ? legacyInfo.button : null}
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
                // 置顶 115 题 8 A：手机上一行横着滑（不折两行）。
                className="mb-5 flex flex-wrap gap-2 max-sm:mb-3 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:pt-0.5 max-sm:pb-1.5 max-sm:[&>button]:shrink-0"
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
                    // Tickets 不用团色（团色是给 bus 流程的）：回到 10-14 之前的白色胶囊（Annie 2026-11-22 P-Q1 选 A）。
                    data-tour-color={tab === "tickets" ? undefined : ""}
                    style={
                      tab === "tickets"
                        ? undefined
                        : ({
                            "--c": p.key.endsWith(":none")
                              ? OTHER_TOUR_COLOR
                              : resolveTourColor(p.color, p.label),
                          } as CSSProperties)
                    }
                    className={cn(
                      // Annie 2026-10-14：像游戏里的按钮——平涂（中间不做高光）、有厚度（底下一道同色系的阴影边），悬停微微抬起，选中是「按下去」的样子（颜色更深、加粗）。黑字。
                      "rounded-[8px] border px-3.5 py-[5px] text-[12.5px] font-semibold whitespace-nowrap text-[#1a1a1a] transition-[transform,box-shadow,background] duration-100",
                      tab === "tickets"
                        ? p.key === shown.pill
                          ? "translate-y-[3px] border-[#8f8c82] bg-linear-to-b from-[#dedcd3] to-[#d3d0c6] font-bold shadow-[inset_0_2px_3px_rgba(0,0,0,.22),0_0_0_#a9a69c] night:border-white/70 night:bg-white/[.14] night:bg-none night:text-white"
                          : "border-[#b5b2a8] bg-linear-to-b from-paper to-[#e8e6de] shadow-[0_3px_0_#a9a69c,0_4px_7px_rgba(0,0,0,.28)] hover:-translate-y-px hover:shadow-[0_4px_0_#a9a69c,0_6px_9px_rgba(0,0,0,.3)] active:translate-y-[3px] active:shadow-[0_0_0_#a9a69c] night:border-white/15 night:bg-white/[.04] night:bg-none night:text-white/70 night:hover:border-white/10 night:hover:bg-white/[.08] night:hover:text-white"
                        : p.key === shown.pill
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
                      pax{unknownPax(p)}
                    </span>
                    {/* 置顶 71 题 2 A：这颗胶囊用自己的一套列 ⇒ 小灰标 OWN。 */}
                    {hasOwnCols(colsHere, p.key) ? (
                      <span
                        data-own-cols
                        title="This page has its own columns (☰ Columns)"
                        className="ml-1.5 rounded-[4px] bg-[#64748b] px-1 py-px align-[1px] text-[10px] font-bold tracking-[.04em] text-white"
                      >
                        OWN
                      </span>
                    ) : null}
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
                  ? `${plural(denied.length, "saved column")} ${denied.length === 1 ? "needs" : "need"} admin access and ${denied.length === 1 ? "is" : "are"} hidden. `
                  : ""}
                {unknown.length
                  ? `${plural(unknown.length, "saved column")} ${unknown.length === 1 ? "doesn't" : "don't"} appear on this day and ${unknown.length === 1 ? "is" : "are"} hidden. `
                  : ""}
                They stay in your column choice.
              </p>
            ) : null}

            {legacyCount > 0 ? (
              <p data-legacy-note className={cn(NOTE_CLASS, legacyInfo.hide)}>
                <PhoneOneLine>
                  ⚠️ {plural(legacyCount, "row")} on this page{" "}
                  {legacyCount === 1 ? "comes" : "come"} from data frozen before
                  Aug 16, 2026 (marked{" "}
                  <span className="font-medium">Legacy</span>
                  ). Booking questions and most Trip / Booking fields are empty
                  for
                  {legacyCount === 1 ? " it" : " them"}.
                </PhoneOneLine>
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

            {!noSend &&
            tabSendable &&
            !seeingHidden &&
            shown &&
            shown.rows.length ? (
              // 勾选后的操作条（Annie 2026-10-09 样稿第 3 版）：几位几人、发确认 / 提醒、自定义消息、清空。
              <div
                role="group"
                aria-label="Selected guests"
                data-selected-bar
                // 置顶 115 题 8 A：手机上没勾选时不占位；勾了浮在屏幕底部（右边让开 ↑↓）。
                className={cn(
                  "mb-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-white/10 bg-white/[.04] px-3 py-2 text-[13px] max-sm:flex-nowrap max-sm:gap-1.5 max-sm:px-2 max-sm:py-1.5 max-sm:[&>button]:shrink-0 max-sm:[&>button]:whitespace-nowrap",
                  selected.size
                    ? "max-sm:fixed max-sm:right-[60px] max-sm:bottom-[calc(12px+env(safe-area-inset-bottom,0px))] max-sm:left-3 max-sm:z-[90] max-sm:mb-0 max-sm:border-white/20 max-sm:bg-[#0b1726] max-sm:shadow-[0_8px_24px_rgba(0,0,0,.5)]"
                    : "max-sm:hidden",
                )}
              >
                <span className="mr-auto text-[#cbd5e1] tabular-nums max-sm:min-w-0 max-sm:text-[12px] max-sm:leading-tight">
                  {plural(pickedOrders, "order")}
                  <span className="max-sm:hidden"> selected</span> · {pickedPax}{" "}
                  pax
                  {foldedPicked.orders
                    ? ` (${foldedPicked.orders} in ${foldedPicked.groups === 1 ? "a collapsed group" : "collapsed groups"})`
                    : ""}
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
                {/* 13（Annie 2026-11-23「13 动手」，手机版规则）：手机上只露几位几人 + 主发送键；其余收进 ⋯（往上开）。原来挤在一行、右边的键被挡在屏幕外。 */}
                <PhoneMore up label="More send actions">
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
                </PhoneMore>
              </div>
            ) : null}

            {!noConfirm && !seeingHidden && pendingSend ? (
              // 勾里有门票缺 Cfm # 的：先问清楚，staff 主动点了 Skip 才真的发（Annie 2026-10-17）。
              <div
                role="alert"
                className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border-[0.5px] border-[#e4a5a0] bg-[#fdeceb] px-3.5 py-2.5 text-[13px] text-[#7a2424] night:border-rose-400/30 night:bg-rose-400/10 night:text-rose-200"
              >
                {onlyCfmMissing ? (
                  <span className="max-w-[60ch]">
                    <b>{missingPicked.length}</b>{" "}
                    {missingPicked.length === 1 ? "order" : "orders"} selected{" "}
                    {missingPicked.length === 1 ? "has" : "have"} no Cfm # yet,
                    so {missingPicked.length === 1 ? "it" : "they"} cannot be
                    sent: {missingPicked.map((r) => r.order_number).join(", ")}.
                    Fill it in, or skip and send the rest.
                  </span>
                ) : (
                  // 置顶 74：缺 Cfm # / 缺 waiver link 合成一条，逐单写缺什么。
                  <span data-soft-blocked className="max-w-[62ch]">
                    <b>{missingPicked.length}</b>{" "}
                    {missingPicked.length === 1 ? "order" : "orders"} selected
                    cannot be sent yet:
                    <ul className="mt-1 list-disc pl-5">
                      {missingPicked.map((r) => (
                        <li key={r.row_key} data-soft-block={r.order_number}>
                          {r.order_number} — {softBlocks(r, tab).join(", ")}
                        </li>
                      ))}
                    </ul>
                    Fill them in, or skip and send the rest.
                    {anyMismatchPicked
                      ? " An order with a Cfm # that doesn't match the product can't be sent anyway."
                      : ""}
                  </span>
                )}
                <span className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingSend(null)}
                    // 只修 bug：原来用深色底的白字键，放在淡红条上看不见；改成红条的深红字（同条上的文字），别的不变。
                    className={RED_BAR_BTN_CLASS}
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
                  {pendingSend === "reminder" && softPicked.length ? (
                    // G129：手动发送的拦截都是软的：缺 Cfm # 也可以照发，确认号栏留空，Send Log 里留痕。
                    <button
                      type="button"
                      data-send-anyway-cfm
                      onClick={() => {
                        setCfmOver(softPicked.map((r) => r.order_number));
                        setSendDialog("reminder");
                        setPendingSend(null);
                      }}
                      className={PRIMARY_ACTION_CLASS}
                    >
                      Send anyway {pickedRows.length + softPicked.length}
                    </button>
                  ) : null}
                </span>
              </div>
            ) : null}

            {!noConfirm && !seeingHidden && anyMissingWaiver ? (
              <p className="mb-2 text-[12.5px] font-medium text-[#ba7517] night:text-amber-300">
                <PhoneOneLine>
                  Orders without a Cfm # or a waiver link, or with a Cfm # under
                  6 digits, will be stopped when you send. Click the cell to
                  fill one in anytime.
                  {anyMismatch ? ` ${MISMATCH_HINT}` : ""}
                </PhoneOneLine>
              </p>
            ) : !noConfirm && !seeingHidden && anyMissingCfm ? (
              <p className="mb-2 text-[12.5px] font-medium text-[#ba7517] night:text-amber-300">
                <PhoneOneLine>
                  Orders without a Cfm #, or with one under 6 digits, will be
                  skipped when you send. Click the Cfm # cell to fill one in
                  anytime.
                  {anyMismatch ? ` ${MISMATCH_HINT}` : ""}
                </PhoneOneLine>
              </p>
            ) : !noConfirm && !seeingHidden && anyMismatch ? (
              // G245：只有号不对的行时，黄字只写这半句。
              <p
                data-mismatch-hint
                className="mb-2 text-[12.5px] font-medium text-[#ba7517] night:text-amber-300"
              >
                <PhoneOneLine>{MISMATCH_HINT}</PhoneOneLine>
              </p>
            ) : null}

            {seeingHidden && shown && hidden ? (
              <HiddenRowsSection
                data={shown}
                hidden={hidden}
                rows={hiddenRows}
                fields={fields.filter((k) => !k.startsWith("_"))}
                loading={loading}
              />
            ) : null}

            {!seeingHidden && shown && shown.rows.length ? (
              <section
                // 团色条：同一个团在 Main manifest → Dispatch → Bus manifest 一路同一个颜色（认 Products
                // → Manifest setup 配的颜色，G142；没配时按团名猜，lib/tour-colors.ts）。
                // Tickets 不用团色：没有左边团色条、标题前没有团色圆点（Annie 2026-11-22 P-Q1 选 A）。
                style={
                  tab === "tickets"
                    ? undefined
                    : ({
                        "--c":
                          !currentPill || currentPill.key.endsWith(":none")
                            ? OTHER_TOUR_COLOR
                            : resolveTourColor(
                                currentPill.color,
                                currentPill.label,
                              ),
                      } as CSSProperties)
                }
                className={cn(
                  "mb-4 overflow-hidden rounded-[10px] border-[0.5px] border-black/10 bg-paper transition-opacity night:border-white/10 night:bg-white/[.032]",
                  tab !== "tickets" && "border-l-[5px] border-l-[var(--c)]",
                  loading && "opacity-50",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b-[0.5px] border-black/[.08] bg-paper px-3.5 py-[9px] night:border-white/10 night:bg-white/[.03]">
                  <h2 className="flex items-center gap-2 text-[13px] font-semibold text-[#1a1a1a] night:text-white/90">
                    {tab === "tickets" ? null : (
                      <span
                        aria-hidden
                        data-tour-dot
                        className="size-2.5 rounded-full bg-[var(--c)]"
                      />
                    )}
                    {currentPill?.label ?? ""}
                  </h2>
                  <span className="text-[11px] text-[#1a1a1a] tabular-nums night:text-white/50">
                    {currentPill
                      ? `${plural(currentPill.orders, "order")} · ${currentPill.pax} pax${unknownPax(currentPill)} · ${plural(shown.rows.length, "row")}`
                      : plural(shown.rows.length, "row")}
                  </span>
                </div>
                {tab === "tickets" && shown.rows.length ? (
                  <TicketViewSwitch
                    value={ticketView}
                    onChange={changeTicketView}
                  />
                ) : shown.rows.length ? (
                  <ViewSwitch
                    label="Bus view"
                    data={{ "data-bus-view": busView }}
                    options={[
                      ["pickup", "By pickup time"],
                      ["order", "By order time"],
                    ]}
                    value={busView}
                    onChange={changeBusView}
                  />
                ) : null}
                <ManifestTable
                  data={shown}
                  fields={fields}
                  selected={selected}
                  highlight={highlight}
                  selectable={!noSend && tabSendable}
                  onToggle={toggleRows}
                  unsentKeys={unsentKeysOf()}
                  onToggleUnsent={toggleUnsent}
                  onReorder={
                    noFeatures ? undefined : (next) => void reorderFields(next)
                  }
                  onCfmSaved={onCfmSaved}
                  onCfmDirty={onCfmDirty}
                  onWaiverDirty={onWaiverDirty}
                  onNoteSaved={onNoteSaved}
                  onNoteDirty={onNoteDirty}
                  onStaffNoteAdded={onStaffNoteAdded}
                  folded={folded}
                  onFold={setFolded}
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
            pageLabel={
              shown.pill
                ? (shown.pills.find((p) => p.key === shown.pill)?.label ??
                  undefined)
                : undefined
            }
            ownPage={ownHere}
            onUseShared={ownHere ? useSharedCols : undefined}
            catalog={shown.catalog}
            groups={shown.groups}
            selected={withMarkColumns(
              withNoteColumn(
              tab === "tickets"
                ? withWaiverColumn(
                    (savedHere ?? shown.default_fields).filter(
                      (k) => k !== WAIVER_OFF,
                    ),
                    shown.rows,
                    savedHere,
                  )
                : (savedHere ?? shown.default_fields),
              shown,
              savedHere,
              ),
              shown,
              savedHere,
            )}
            defaults={shown.default_fields}
            onApply={(next, scope) =>
              applyFields(
                next
                  ? rememberMarkChoice(
                      rememberNoteChoice(
                        tab === "tickets"
                          ? rememberWaiverChoice(next, shown.rows)
                          : next,
                        shown,
                      ),
                      shown,
                    )
                  : next,
                scope,
              )
            }
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
            rows={cfmOver.length ? [...pickedRows, ...softPicked] : pickedRows}
            noCfmOrders={cfmOver}
            overReasons={Object.fromEntries(
              missingPicked
                .filter((r) => cfmOver.includes(r.order_number))
                .map((r) => [r.order_number, softBlocks(r, tab)]),
            )}
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

        {uploadingWaiver && date && !viewOnly ? (
          <WaiverUploadPanel
            date={date}
            onClose={() => setUploadingWaiver(false)}
            onSaved={() => setReloadKey((k) => k + 1)}
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
                  <td className="relative px-2.5 py-2 text-[#378ADD] night:text-sky-300">
                    <OrderLink orderNumber={r.order_number} />
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

/** 费用单里拿不到件数的行（pax 是 null）：写在 pax 后面「 + 3 unknown」，没有就不写。 */
function unknownPax(c: { pax_unknown?: number }): string {
  return c.pax_unknown ? ` + ${c.pax_unknown} unknown` : "";
}

function ManifestTable({
  data,
  fields,
  selected,
  highlight,
  selectable,
  onToggle,
  unsentKeys,
  onToggleUnsent,
  onReorder,
  onCfmSaved,
  onCfmDirty,
  onWaiverDirty,
  onNoteSaved,
  onNoteDirty,
  onStaffNoteAdded,
  folded,
  onFold,
  onUnauthorized,
}: {
  data: ManifestPage;
  /** 显示的列（staff 选的，不含为勾选多要的辅助列）。 */
  fields: string[];
  selected: ReadonlySet<string>;
  /** 搜索跳过来的那一行，标黄。 */
  highlight: string | null;
  /** 有勾选框（勾选只为发送；partner 什么都不能发时没有）。 */
  selectable: boolean;
  onToggle: (rowKeys: readonly string[], on: boolean) => void;
  /** 只勾还没发过的订单。 */
  /** 这一页还没发过的行（表头 unsent 框的勾 / 半勾按它算）。 */
  unsentKeys: string[];
  onToggleUnsent: (on: boolean) => void;
  /** 拖表头换了顺序：新的整列顺序。没有 = 表头不能拖（partner）。 */
  onReorder?: (fields: string[]) => void;
  onCfmSaved: (rowKey: string, values: ManifestRow["values"]) => void;
  /** 某一行的 Cfm # 改了没存 / 存好了。 */
  onCfmDirty: (rowKey: string, dirty: boolean) => void;
  /** 某一行的 Waiver link 改了没存 / 存好了（置顶 74）。 */
  onWaiverDirty: (rowKey: string, dirty: boolean) => void;
  /** 150 Notes：存好了（同单同产品同团期的行一起换）/ 改了没存。 */
  onNoteSaved: Parameters<typeof NoteInput>[0]["onSaved"];
  onNoteDirty: (rowKey: string, dirty: boolean) => void;
  /** ★ Note 加好了（同单同产品的行一起加）。 */
  onStaffNoteAdded: (row: ManifestRow, note: StaffNote) => void;
  /** 153：收起的 Tickets 场次组（节键）；收 / 展开几个组。 */
  folded: ReadonlySet<string>;
  onFold: (keys: readonly string[], on: boolean) => void;
  onUnauthorized: () => void;
}) {
  // partner 不能发时没有勾选；Cfm # 能不能改由格子自己看 ViewOnly（manifests.edit）。
  const viewOnly = !selectable;
  const seeMoney = usePermissions().canSeeMoney;
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
  // 能勾的行（CHD 组的行不能勾，Select all / 节的全选都不带它们）。
  const pickable = data.rows.filter(canSend);
  const allOn =
    pickable.length > 0 && pickable.every((r) => selected.has(r.row_key));
  // unsent 框：没发过的都勾了 = 勾；勾了一部分 = 半勾；一个没勾 = 空。
  const unsentOn =
    unsentKeys.length > 0 && unsentKeys.every((k) => selected.has(k));
  const unsentSome = unsentKeys.some((k) => selected.has(k));
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
    // 门票 Cfm # 规则（后端 51ffe2ca）：不需要号的团不标红；号不到 6 位数字同没号一样标红。
    const cfmBad = !!cfmProblem(r, tab);
    // 门票提醒发过的（后端已经把它们排到最后）：原来整行变灰；Annie 2026-10-15「灰字都要黑」⇒
    // 字照常黑，改用发送页统一的淡黄行（同 legacy-ui / manifest-preview 的 #fff8e1）标出发过。
    const sentTickets = tab === "tickets" && !!sentAt(r, "tickets");
    // 没填 Cfm # 的门票行：整行标红提醒（Annie 2026-10-17）；勾选本身不再被这个挡住，
    // 真正拦截挪到了发送前的 Skip & send 确认条（见上面 requestSend）。
    const missingCfm = tab === "tickets" && (cfmBad || missingWaiver(r));
    // 费用单（不能发的行）没收齐款：Due 不是 0 ⇒ 整行同样的淡红（Annie 2026-11-02 题 1 选 B）。
    // 看不到钱的人不标（标了就等于告诉他没收齐款）。
    const unpaidFee =
      seeMoney && !canSend(r) && Number(r.values.total_due ?? 0) !== 0;
    return (
      <tr
        key={r.row_key}
        data-row={r.row_key}
        data-highlight={r.row_key === highlight ? "" : undefined}
        className={cn(
          "border-b-[0.5px] border-black/[.06] align-middle last:border-b-0 night:border-white/[.06]",
          r.row_key === highlight
            ? "bg-[#fff3cd] hover:bg-[#ffecb3] night:bg-amber-400/15 night:hover:bg-amber-400/20"
            : sentTickets
              ? "bg-[#fff8e1] hover:bg-[#fff3cd] night:bg-amber-400/[.06] night:hover:bg-amber-400/10"
              : missingCfm || unpaidFee
                ? "bg-[#fdeceb] hover:bg-[#fbdedb] night:bg-rose-400/10 night:hover:bg-rose-400/15"
                : "hover:bg-[#fafaf8] night:hover:bg-white/[.03]",
        )}
      >
        <td className="w-px p-0">
          {/* 整个单元格都能点（Annie 2026-10-18：勾选框太小太难点中）。 */}
          {/* 不能发的行（CHD 组）没有勾选框，同 Show hidden rows 里的行。 */}
          <label
            hidden={viewOnly || !canSend(r)}
            className="flex min-h-9 cursor-pointer items-center justify-start py-1.5 pr-3 pl-2.5"
          >
            <input
              type="checkbox"
              className={CHECK_BIG}
              aria-label={`Select ${r.order_number}`}
              checked={selected.has(r.row_key)}
              onChange={(e) => onToggle([r.row_key], e.target.checked)}
            />
            {/* 还没发过的门票单在框旁边标 NEW（Annie 2026-11-21「还没有的订单在打勾的框旁边加个tag，new」；「全部同意推荐，new的样式选B,动手」）：
                浅绿底深绿字、方角；Bus Tours 也加（「T-Q3 Bus Tours 要不要也加 NEW  要」）。
                判断同表头 unsent 框：Tickets 看 sent_tickets_at、Bus 看 sent_tour_at；Admin fee 不标；不能撑宽勾选列。 */}
            {(tab === "tickets" || tab === "bus") && !sentAt(r, tab) ? (
              <span
                data-new-tag
                className="ml-1 rounded-[3px] bg-[#e3f1e6] px-1 text-[9.5px] leading-[15px] font-bold tracking-[.04em] whitespace-nowrap text-[#2f6b3f] night:bg-emerald-400/15 night:text-emerald-300"
              >
                NEW
              </span>
            ) : null}
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
            // 产品名和同节大多数不一样 ⇒ 整个产品名红字（后端比，前端只认 product_differs）；
            // 电脑上停鼠标看这一节大多数产品叫什么（Annie 2026-11-17 题 2 A，手机上只有红字）。
            data-product-differs={
              k === "product" && r.product_differs ? "" : undefined
            }
            // Annie 2026-11-20 选 A：后端给了这一单实际产品名 ⇒ 悬停两行；没给（旧后端）照旧一行。
            title={
              k === "product" && r.product_differs && r.product_majority
                ? r.product_actual
                  ? `This order: ${r.product_actual}\nMost of this section: ${r.product_majority}`
                  : `Different from most products in this section: ${r.product_majority}`
                : undefined
            }
            className={cn(
              "px-2.5 py-2",
              k === "order_number"
                ? "relative text-[#378ADD] night:text-sky-300"
                : k === "product" && r.product_differs
                  ? "text-[#a32d2d] night:text-red-300"
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
            ) : k === WAIVER_KEY ? (
              <WaiverInput
                row={r}
                onSaved={onCfmSaved}
                onDirty={onWaiverDirty}
                onUnauthorized={onUnauthorized}
              />
            ) : k === REZDY_CFM_KEY && cfmMismatch(r, tab) ? (
              <CfmMismatchCell row={r} />
            ) : k === NOTE_KEY && Array.isArray(r.staff_notes) ? (
              <StaffNoteCell
                row={r}
                notes={r.staff_notes}
                onAdded={onStaffNoteAdded}
                onDirty={onNoteDirty}
                onUnauthorized={onUnauthorized}
              />
            ) : k === NOTE_KEY ? (
              <NoteInput
                row={r}
                onSaved={onNoteSaved}
                onDirty={onNoteDirty}
                onUnauthorized={onUnauthorized}
              />
            ) : k === "order_number" && r.order_number ? (
              <OrderLink orderNumber={r.order_number} />
            ) : (
              <Cell field={byKey.get(k)} row={r} fieldKey={k} />
            )}
            {r.shown_on === "order_date" &&
            r.reason_label &&
            (k === "product" || (i === 0 && !fields.includes("product"))) ? (
              // 没有团日期、放在下单日的 admin fee 行（G232）：在 Product 下面一行小字写清楚（没选 Product 列就写在第一列）。
              <span
                data-shown-on
                className="mt-0.5 block text-[11px] text-[#1a1a1a] night:text-white/50"
              >
                {r.reason_label}
              </span>
            ) : null}
            {i === 0 && isLegacy(r) ? (
              <span
                title="From data frozen before Aug 16, 2026 — booking questions and most Trip / Booking fields are empty"
                className="relative z-[1] ml-1.5 inline-block rounded-[10px] bg-[#faeeda] px-2 py-0.5 text-[11px] text-[#ba7517] night:bg-amber-400/15 night:text-amber-300"
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
    <>
    <SessionTools sections={sections} folded={folded} onFold={onFold} />
    <div className="overflow-x-auto">
      <table className="w-full min-w-[800px] border-collapse text-[12px]">
        <thead className="border-b-[0.5px] border-black/[.08] text-left text-[11px] font-medium text-[#1a1a1a] night:border-white/10 night:text-white/45">
          <tr>
            {/* 表头左上角两个框上下排（Annie 2026-11-21「我要上下两个框啊」）：ALL / unsent，跟每行的框同一竖线。 */}
            <th className="w-px bg-paper py-1.5 pr-3 pl-2.5 align-middle font-medium whitespace-nowrap night:bg-transparent">
              <div hidden={viewOnly} className="flex flex-col gap-1">
                <label
                  title="Select all"
                  className="flex cursor-pointer items-center gap-1.5 text-[10.5px] leading-5 font-semibold tracking-[.04em] text-[#1a1a1a] night:text-white/85"
                >
                  <input
                    type="checkbox"
                    data-select-all
                    className={CHECK_BIG}
                    checked={allOn}
                    disabled={!pickable.length}
                    onChange={(e) =>
                      onToggle(
                        pickable.map((r) => r.row_key),
                        e.target.checked,
                      )
                    }
                  />
                  ALL
                </label>
                <label
                  title="Select all unsent tours"
                  className="flex cursor-pointer items-center gap-1.5 text-[10.5px] leading-5 font-semibold text-[#1a1a1a] has-disabled:cursor-not-allowed has-disabled:opacity-50 night:text-white/85"
                >
                  <input
                    type="checkbox"
                    data-select-unsent
                    className={CHECK_BIG}
                    checked={unsentOn}
                    ref={(el) => {
                      if (el) el.indeterminate = unsentSome && !unsentOn;
                    }}
                    disabled={!unsentKeys.length}
                    onChange={(e) => onToggleUnsent(e.target.checked)}
                  />
                  unsent
                </label>
              </div>
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
                const keys = rows.filter(canSend).map((r) => r.row_key);
                const on =
                  keys.length > 0 && keys.every((k) => selected.has(k));
                const bg = sectionBg(
                  sec.kind,
                  sec.kind === "tour" || sec.kind === "session"
                    ? tourIndex++
                    : 0,
                );
                // 153：Tickets 场次组（前端分的）能折叠，组头的框有半选；Bus 的节照旧。
                const session = isSessionGroup(sec);
                const isFolded = session && folded.has(sec.key);
                const some = keys.some((k) => selected.has(k));
                const tickedOrders = new Set(
                  rows
                    .filter((r) => selected.has(r.row_key))
                    .map((r) => r.order_number),
                ).size;
                return [
                  <tr
                    key={`sec:${sec.key}`}
                    data-section={sec.key}
                    data-session={session ? "" : undefined}
                    data-folded={isFolded ? "" : undefined}
                  >
                    <td
                      colSpan={colSpan}
                      // Tickets 场次组头一律浅灰、night 深灰（Annie 2026-11-19「同意推荐，动手」1A / 4A）；Bus 的节照旧 inline 色。
                      style={session ? undefined : { background: bg }}
                      data-session-head={session ? "" : undefined}
                      className={cn(
                        "px-2.5 py-1.5 text-[12px] font-semibold tracking-[.02em] text-[#1a1a1a] night:text-white/90",
                        session && "bg-[#bdbdbd] night:bg-white/[.09]", // Annie 2026-11-21：白天 #bdbdbd 深字；夜间照旧深灰（Q4 A）
                      )}
                    >
                      {/* 手机上组头钉在左边，表格左右滑时不跟着跑（题 4 A）。 */}
                      <span
                        className={cn(
                          "inline-flex items-center",
                          session && "max-sm:sticky max-sm:left-2",
                        )}
                      >
                        {session ? (
                          <button
                            type="button"
                            data-fold
                            aria-expanded={!isFolded}
                            aria-label={`${isFolded ? "Open" : "Fold"} ${sec.title}`}
                            onClick={() => onFold([sec.key], !isFolded)}
                            className="mr-1.5 inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded text-[12px] text-[#1a1a1a] hover:bg-black/[.06] night:text-white/80"
                          >
                            {isFolded ? "▸" : "▾"}
                          </button>
                        ) : null}
                        <label className="inline-flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            hidden={viewOnly}
                            className={CHECK_BIG}
                            aria-label={`Select all in ${sec.title}`}
                            checked={on}
                            ref={(el) => {
                              // 一场里只勾了几单 ⇒ 半选（Annie：可以全选、可以选 session、也可以单独选订单）。
                              if (el) el.indeterminate = session && some && !on;
                            }}
                            disabled={!keys.length}
                            onChange={(e) => onToggle(keys, e.target.checked)}
                          />
                          {session && sec.short_title ? (
                            <>
                              <span className="max-sm:hidden">{sec.title}</span>
                              <span className="sm:hidden">{sec.short_title}</span>
                            </>
                          ) : (
                            sec.title
                          )}
                        </label>
                        <span className="ml-2 font-normal whitespace-nowrap text-[#1a1a1a]">
                          {plural(sec.orders, "order")} · {sec.pax} pax
                          {session && sec.breakdown ? (
                            <span className="max-sm:hidden">
                              {` (${sec.breakdown})`}
                            </span>
                          ) : null}
                          {sec.show_cfm && sec.tour_time
                            ? ` · Tour time ${sec.tour_time}`
                            : ""}
                        </span>
                        {isFolded && tickedOrders ? (
                          <span
                            data-folded-ticked
                            className="ml-2 font-semibold whitespace-nowrap text-[#1a1a1a]"
                          >
                            · {tickedOrders} ticked
                          </span>
                        ) : null}
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
                  ...(isFolded ? [] : numberRows(rows)),
                ];
              })
            : numberRows(data.rows)}
        </tbody>
      </table>
    </div>
    </>
  );
}

type TicketView = "session" | "time";
// 默认改 By order time（Annie 2026-11-19「默认order time」「B」「order time在前。动手」）：换新键 v2，
// 今天之前存的选择不再读，所有人先回到 By order time。
const TICKET_VIEW_KEY = "ops.manifests.ticketsView.v2";

/**
 * Tickets 的「By session | By order time」切换（Annie 2026-11-19「同意推荐，动手」，P3 A 记在这台电脑这个浏览器）。
 * 不是提交键，不用蓝色：选中的深底白字（同 DOR 状态页签的样子）。
 */
function TicketViewSwitch({
  value,
  onChange,
}: {
  value: TicketView;
  onChange: (next: TicketView) => void;
}) {
  return (
    <ViewSwitch
      label="Tickets view"
      data={{ "data-ticket-view": value }}
      options={[
        ["time", "By order time"],
        ["session", "By session"],
      ]}
      value={value}
      onChange={onChange}
    />
  );
}

/** Bus / Admin fee 两种看法的键（第 5 件）。 */
type BusView = "pickup" | "order";
const BUS_VIEW_KEY = "ops.manifests.busView.v1";

/** 看法切换的一组键（Tickets、Bus / Admin fee 共用一个样子）：选中深底白字，不是提交键所以不用蓝色。 */
function ViewSwitch<V extends string>({
  label,
  data,
  options,
  value,
  onChange,
}: {
  label: string;
  data: Record<string, string>;
  options: readonly (readonly [V, string])[];
  value: V;
  onChange: (next: V) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      {...data}
      className="flex flex-wrap items-center gap-1 px-3.5 pt-2.5 text-[12px]"
    >
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "cursor-pointer rounded-md border px-3 py-1",
            value === key
              ? "border-[#1a1a1a] bg-[#1a1a1a] font-semibold text-white night:border-white/90 night:bg-white/90 night:text-[#06101c]"
              : "border-black/20 text-[#1a1a1a] hover:bg-black/[.04] night:border-white/25 night:text-white/80 night:hover:bg-white/[.08]",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** 153：前端给 Tickets 分的场次组（能折叠、组头半选）；后端给的 Bus 节不是。 */
function isSessionGroup(sec: { kind: string }): boolean {
  return sec.kind === "session" || sec.kind === "no_time";
}

/** 153：Tickets 表上面一行「6 start times · Expand all · Collapse all」（只在有场次组时出）。 */
function SessionTools({
  sections,
  folded,
  onFold,
}: {
  sections: readonly { key: string; kind: string }[];
  folded: ReadonlySet<string>;
  onFold: (keys: readonly string[], on: boolean) => void;
}) {
  const keys = sections.filter(isSessionGroup).map((s) => s.key);
  if (!keys.length) return null;
  const times = sections.filter((s) => s.kind === "session").length;
  return (
    <div
      data-session-tools
      className="mb-2 flex flex-wrap items-center gap-3 px-1 text-[12px] text-[#1a1a1a] night:text-white/70"
    >
      <span>{plural(times, "start time")}</span>
      <button
        type="button"
        disabled={!keys.some((k) => folded.has(k))}
        onClick={() => onFold(keys, false)}
        className="cursor-pointer underline underline-offset-2 disabled:cursor-default disabled:no-underline disabled:opacity-50"
      >
        Expand all
      </button>
      <button
        type="button"
        disabled={keys.every((k) => folded.has(k))}
        onClick={() => onFold(keys, true)}
        className="cursor-pointer underline underline-offset-2 disabled:cursor-default disabled:no-underline disabled:opacity-50"
      >
        Collapse all
      </button>
    </div>
  );
}

/**
 * 152（Annie「152 同意推荐，动手」）：订单号点了在新标签页打开 Order details（题 1 A）。样子照 Order List：
 * 蓝字不变、移上去下划线 + 提示（题 2 A）；整个格子都能点（题 3 A，td 要 relative）；每行都能点（题 4 A）。
 * 新标签页 ⇒ 离开拦截（useLeaveGuard 放过 target=_blank）不拦，勾选和没存的改动都留在这一页。
 *
 * 152 回退修（Annie「…现在变得在main manifest上没有办法复制这个number，帮我调整一下，弄成还是可以复制，而不是复制链接」）：
 * - 电脑上不再用 ::after 铺满整格（它盖住了字，拖不出选区）；整格可点只留在手机（max-sm，题 3 A）。
 * - 链接不能拖（draggable=false / -webkit-user-drag:none），字可以拖选；拖选、双击选中以后松开的那一下不开新标签页。
 * - 复制只给纯单号（text/plain），不带链接（不写 text/html）。
 */
/**
 * 选中的字落在订单号链接里时，复制只给纯文字（text/plain），不带链接的 HTML——贴到 Excel / 邮件里是单号，不是超链接。
 * 挂在 document 上一次（复制事件不一定派到链接本身），页面上其他地方的复制照旧。
 */
function useOrderNumberCopy() {
  useEffect(() => {
    function onCopy(e: ClipboardEvent) {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !e.clipboardData) return;
      const inLink = (n: Node | null) =>
        !!(n instanceof Element ? n : n?.parentElement)?.closest(
          "a[data-order-link]",
        );
      if (!inLink(sel.anchorNode) && !inLink(sel.focusNode)) return;
      const text = sel.toString().trim();
      if (!text) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", text);
    }
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, []);
}

function OrderLink({ orderNumber }: { orderNumber: string }) {
  return (
    <a
      href={`/orders/${encodeURIComponent(orderNumber)}`}
      target="_blank"
      rel="noopener noreferrer"
      data-order-link
      draggable={false}
      title="Open order details in a new tab"
      onClick={(e) => {
        // 双击（第二下）、或这一格里已经选中了字（刚拖选完）⇒ 是在选字，不开新标签页。
        const sel = window.getSelection();
        const selecting =
          !!sel &&
          !sel.isCollapsed &&
          sel.toString().trim() !== "" &&
          e.currentTarget.contains(sel.anchorNode);
        if (e.detail > 1 || selecting) e.preventDefault();
      }}
      className="cursor-pointer whitespace-nowrap select-text [-webkit-user-drag:none] hover:underline focus-visible:underline focus-visible:outline-none max-sm:after:absolute max-sm:after:inset-0 max-sm:after:content-['']"
    >
      {orderNumber}
    </a>
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
  // G364 Q1 A：Special requirements 格下面一行橙字（只在后端说不一样的单；这一列关了就不出）。
  const guestLunch =
    fieldKey === "special_requirements" &&
    row.guest_lunch_differs === true &&
    row.guest_lunch ? (
      <span
        data-guest-lunch-differs
        className="mt-0.5 block max-w-xs min-w-48 text-[11.5px] leading-[1.35] whitespace-normal text-[#c2410c] night:text-orange-300"
      >
        {mainManifestGuestLunchNote(row.guest_lunch)}
      </span>
    ) : null;
  if (!text)
    return (
      <>
        <span className="text-[#1a1a1a] night:text-white/25">—</span>
        {guestLunch}
      </>
    );
  const long = text.length > 40;
  return (
    <>
      <span
        className={cn(
          long
            ? "block max-w-xs min-w-48 [overflow-wrap:anywhere] whitespace-pre-line"
            : guestLunch
              ? "block whitespace-nowrap"
              : "whitespace-nowrap",
        )}
      >
        {text}
      </span>
      {guestLunch}
    </>
  );
}

/**
 * G245（置顶 82 Q1 C）：Rezdy 的 Cfm # 跟产品不符 ⇒ 那一格红底白字（行不变色）。鼠标停上去写原因；
 * 手机上没有鼠标，点一下在格子下面展开同一句，再点收起。
 */
function CfmMismatchCell({ row }: { row: ManifestRow }) {
  const [open, setOpen] = useState(false);
  const m = row.cfm_mismatch;
  if (!m) return null;
  const tip = cfmMismatchTip(m);
  const text = String(row.values[REZDY_CFM_KEY] ?? "");
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        data-cfm-mismatch
        title={tip}
        aria-label={`${text} — ${tip}`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="cursor-help rounded-[4px] bg-[#d9534f] px-1.5 py-px font-bold whitespace-nowrap text-white"
      >
        {text || "—"}
      </button>
      {open ? (
        <span
          data-cfm-mismatch-tip
          className="block max-w-[260px] text-[11px] leading-snug whitespace-normal text-[#a32d2d] night:text-red-300"
        >
          {tip}
        </span>
      ) : null}
    </span>
  );
}

/** G245 Q2 A：表格上方黄字的半句（Annie 要去 Rezdy 改，所以两种改法都写）。 */
const MISMATCH_HINT =
  "Orders with a red Cfm # can't be sent until the Cfm # is fixed in Rezdy or in the Cfm # cell.";

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
            "w-[90px] border-b bg-transparent px-0.5 py-px font-[inherit] text-[12px] text-[#1a1a1a] focus:border-solid focus:outline-none night:text-white night:placeholder:text-white/30",
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
        <>
          <b>Search</b>: type an order #, guest name, phone or email. It looks
          through every tab and group on this day. Click a result to jump to it;
          the row is highlighted in yellow.
        </>,
        <>
          <b>Order lookup / Order details</b>: Open in Main manifest → opens the
          order on Main manifest, highlighted and ticked, so you can resend the
          confirmation or reminder. Nothing is sent until you press Send. If the
          order is not on Main manifest, check its status in Order List.
        </>,
        <>
          Click an order number to open that order’s <b>Order details</b> in a
          new tab. This page stays as it is, with your ticked rows and unsaved
          changes. On Order details, <b>Open in Main manifest →</b> brings you
          back to that order’s rows here.
        </>,
        <>
          <b>Bus Tour</b> shows one group at a time (the groups from Settings →
          Products). <b>Tickets - SelfDrive</b> shows one tour type at a time
          (the Tour type column in Settings → Products). Click a pill to switch;
          each pill shows its pax. &ldquo;No group yet&rdquo; / &ldquo;No tour
          type yet&rdquo; collects products that haven&apos;t been set up in
          Settings → Products.
        </>,
        // G364 Q4 A（preview 第 7 版原文）。
        <>
          Lunch comes from Special requirements in Rezdy. Orange &ldquo;Guest
          picked … — check Rezdy&rdquo; under Special requirements means the
          guest picked a different lunch in the tour confirmation, so the lunch
          in Rezdy is probably wrong. Check it and fix Special Requirements in
          Rezdy.
        </>,
        <>
          Click <b>☰ Columns</b> to choose which fields to show. Every field
          Rezdy sends is there, grouped (Guest, Trip, Booking, Our records,
          Booking questions…). Your choice is saved to your account, separately
          for each tab. Booking questions only appear on days when an order on
          that tab asked them.
        </>,
        <>
          <b>Apply for this page</b> keeps your columns for the group or tour
          type you are on; <b>Apply for all</b> uses them for every page in the
          tab and clears any page&apos;s own columns. A page with its own
          columns shows <b>OWN</b> on its pill; in <b>☰ Columns</b>, click Use
          the shared columns to go back to the tab&apos;s columns.
        </>,
        <>
          To move a column: in <b>☰ Columns</b>, drag its box under Column
          order to where you want it and click Apply for this page or Apply for
          all. Or drag its header on the page left or right; that order is saved
          to your account right away (to this page only if it has its own
          columns).
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
          <b>ALL</b> at the top left of the table to select everyone. Tick{" "}
          <b>unsent</b> under it to select only the orders not sent yet;
          untick it to clear them. Orders not sent yet show a green{" "}
          <b>NEW</b> tag next to their box. A group with sections set in
          Settings → Products → Manifest setup (for
          example UPPER / LOWER / X for Antelope) is split into those sections.
        </>,
        // 产品名标红（Annie 2026-11-17「产品标红同意全部推荐。动手」，题 4 A 原文）。
        <>
          A product name in red is different from most products in its section
          (the agent name in brackets and the pickup part don&apos;t count), for
          example missing &quot;with Lunch&quot;. Hover over it to see what most
          of the section booked. Check the order in Order List before you count
          meals or tickets.
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
          <b>Tickets</b>: rows without a Cfm #, or with a Cfm # under 6 digits,
          are highlighted in red; you can still tick them. Clicking{" "}
          <b>Send reminder</b> with some of those ticked asks you to skip them
          (send the rest), fill them in first, or Send anyway. Sent rows move to
          the bottom.
        </>,
        <>
          A Cfm # with fewer than 6 digits (for example &quot;1&quot; or
          &quot;TBA&quot;) counts as no Cfm #. The scheduled send skips these
          orders and the daily report lists them as &quot;Cfm # is too short
          (under 6 digits)&quot;. When you send by hand you can still Send
          anyway; the number goes out as it is. Tour types ticked No Cfm #
          needed in Settings → Content Studio (such as the two Hogan Upper
          Antelope tours) are sent without a Cfm #.
        </>,
        <>
          <b>Send message</b>: write your own text, choose SMS and/or Email,
          then Review and Send. One message per order. It shows up in
          Broadcasting Log. Orders that already got the exact same message for
          this tour date (from here or from Tracking) are skipped unless you
          tick Send anyway. A changed message goes to everyone. SMS can be at
          most 306 characters (134 if the message or a guest name has a
          character such as Δ or Ł), counting the &quot;Hi (name),&quot; added
          at the start. Plain characters only (no emoji, accents such as á, or
          symbols such as € and {"{ }"}); curly quotes and long dashes are
          changed to plain ones automatically. If the message is longer or uses
          other characters, SMS
          is greyed out and it goes by Email only. Shorten it to use SMS again,
          then tick SMS again.
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
          by hand instead of guessing. If the saved Cfm # has fewer than 6
          digits, Overwrite is ticked for you; untick it to keep the saved
          number.
        </>,
        <>
          <b>Waiver link</b>: Upper Antelope (Brenda) orders need a waiver link.
          Click the Waiver link cell, paste the link, then press Save or Enter
          (Esc cancels). Other orders have no waiver link cell. Open ↗ opens the
          saved link. The guest finds it on their ticket page, in step 1 of
          Prepare for Your Tour.
        </>,
        <>
          <b>↑ Upload waiver links</b>: upload a spreadsheet with two columns,
          the order number and the waiver link. It is checked against this date
          only. You see every row first: new, changed (replaces the saved link),
          same (skipped), and rows that are not saved (order not found, not a
          waiver order, not a web link, empty, or in the file twice). Press Save
          to write the new and changed links.
        </>,
        <>
          <b>No waiver link</b>: an order without a waiver link is stopped when
          you send, the same way as an order without a Cfm #. Fill the link in,
          skip it and send the rest, or press Send anyway (the guest&apos;s
          ticket page then says the waiver link will be sent separately).
        </>,
        <>
          <b>Changed since sent</b>: the link was changed after the guest got
          the reminder. Tick the order, then tick Send anyway in the send window
          to send the reminder again, so the guest gets the new link on their
          ticket page. The tag goes away once it is sent.
        </>,
        <>
          <b>Notes</b> (Bus Tour and Tickets): ★ Notes for staff about this
          order and product. The cell shows the newest one; click{" "}
          <b>+N more</b> to see them all, or <b>Add</b> to write a new one.
          Type @ to mention a teammate or a team; they get a Notice. Notes are
          only added, never changed. They aren’t printed and aren’t sent to
          guests. Partners can read them but can’t add notes or be mentioned.
          The same notes show in Order details and in the Tracking chat window.
        </>,
        <>
          <b>Tickets</b> are grouped by session (start time). Each group shows
          the start time, the product, and how many orders and pax (with the
          Adult / Child / Infant split). Click ▸ / ▾ on a group to fold or open
          it, or use <b>Expand all</b> / <b>Collapse all</b>. Tick{" "}
          <b>ALL</b> for every order, the box on a group for the whole
          session, or the box on a row for one order. Folding only hides the
          rows: ticked orders in a folded group stay ticked and are sent, and
          the group shows how many are ticked. Orders without a start time are
          in the last group, <b>No time</b>.
        </>,
        <>
          On <b>Tickets</b>, switch between <b>By order time</b> (the
          default: one list, no groups, in the order the bookings came in;
          orders already sent go to the bottom) and <b>By session</b> (grouped
          by start time). Ticked orders stay ticked when you switch. This
          computer remembers your choice.
        </>,
        <>
          On <b>Bus Tours</b> and <b>Admin fees</b>, switch between{" "}
          <b>By pickup time</b> (the default: earliest pickup first) and{" "}
          <b>By order time</b> (in the order the bookings came in; orders with
          no booking time go last). Sections stay the same in both views.
          Ticked orders stay ticked when you switch. This computer remembers
          your choice.
        </>,
      ]}
    />
  );
}
