"use client";

import {
  type CSSProperties,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CompletedBar,
  EmptyToursToggle,
  ManifestsPanel,
  type SyncInfo,
} from "@/components/dispatch-manifest/manifests-panel";
import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageLink } from "@/components/ui/page-link";
import { Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  copyDispatchDay,
  fetchDispatchDay,
  fetchDispatchPrefill,
  fetchSeating,
  matchPrivateOrders,
  moveSeating,
  pullFromDiscord,
  saveDispatchDay,
  saveDispatchSection,
} from "@/lib/dispatch-api";
import { syncManifests } from "@/lib/dispatch-manifest-api";
import { isYmd, shiftYmd } from "@/lib/la-date";
import { resolveTourColor } from "@/lib/tour-colors";
import { usePageVisibility } from "@/lib/page-visibility";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import {
  fetchRoster,
  type Roster,
  type RosterPerson,
} from "@/lib/dispatch-roster-api";
import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import { fetchActionLog } from "@/lib/action-log";
import { usePermissions } from "@/lib/staff-permissions";
import { replaceUrl, useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import { ViewOnly } from "@/components/ui/view-only";
import type {
  DispatchClosure,
  DispatchDay,
  DispatchPrefill,
  DispatchRow,
  DispatchSeating,
  GuestListsDone,
  SeatingOrder,
} from "@/types";

import { CclBanner } from "./ccl-banner";
import { FarmOutBlock } from "./farm-out-block";
import { FarmOutGuests, whenText } from "./farm-out-guests";
import { FarmOutNoticeDialog } from "./farm-out-notice-dialog";
import { RosterDialog } from "./roster-dialog";
import { usePartners } from "./use-farm-out";
import {
  analyze,
  applyDispatchMeta,
  cloneRow,
  cloneRows,
  countChanges,
  fmtLong,
  fmtShort,
  isBlankRow,
  isRelay,
  makeLookup,
  META,
  rowKey,
  secOf,
  unitOf,
} from "./config";
import {
  ADDVAN,
  ADDVAN_DARK,
  BANNER,
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
import { Rail, useCheckOpen } from "./rail";
import { RelayPanel } from "./relay-panel";
import {
  isAutoWindow,
  notNeededRows,
  openWindows,
  type TourNeed,
  withoutAutoWindows,
} from "./bus-windows";
import { UnitError, UnitSave } from "./unit-save";
import {
  ArrangeBoard,
  seatNotes,
  type SeatDayState,
  type SeatMove,
  SingleBusGuests,
  TourSeatingNotes,
} from "./seating";
import { StepBox } from "./step-box";
import { lockedByText, useEditLock } from "./use-edit-lock";
import { PrivateOrderCards } from "./private-orders";
import { RelayRow, VanBlock } from "./vehicle-row";

const RING = ["#0ea5e9", "#6366f1", "#a855f7", "#14b8a6"];

type Banner = "none" | "prefill" | "revision";

type Pending = { kind: "leave"; to: string } | { kind: "copy" } | null;

/**
 * 停手多久自动保存（Annie 2026-10-15 去掉整天的 Save 键、改动自动保存；2026-10-18 改成每个单元自己的 Save 键，
 * 自动保存退成后备：页面 60 秒没有任何操作才存）。
 */
const AUTOSAVE_MS = 60000;

/** headless 检查（checks/headless/da-test.js）可以设 window.__dispatchAutosaveMs 改等待时间；staff 一律 3 秒。 */
function autosaveDelay(): number {
  const v = (window as { __dispatchAutosaveMs?: unknown }).__dispatchAutosaveMs;
  return typeof v === "number" && v >= 0 ? v : AUTOSAVE_MS;
}

/** 一个单元里要存的车（不含补开的空车）。 */
function unitRowsOf(list: DispatchRow[], unit: string): DispatchRow[] {
  return withoutAutoWindows(list).filter((r) => unitOf(r) === unit);
}

/** 这个单元和已存的不一样（按行内容配对，同「N unsaved changes」）。 */
function unitDirty(
  base: DispatchRow[],
  list: DispatchRow[],
  unit: string,
): boolean {
  return (
    countChanges(
      base.filter((r) => unitOf(r) === unit),
      unitRowsOf(list, unit),
    ) > 0
  );
}

function omitKey<T>(o: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _gone, ...rest } = o;
  void _gone;
  return rest;
}

const SAVED_AT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
});
/** 「All changes saved · 9:42 PM」的时间（洛杉矶）。 */
function savedTime(): string {
  return SAVED_AT.format(new Date()).replace(/\s/g, " ");
}

/** 一个通知（存完的结果、复制丢了几台车、邮件没发出去）。不像旧页面用 alert，也不会 3 秒就消失。 */
type Notice = { tone: "ok" | "warn"; text: string } | null;

/** 浅色提示条上的白键（Check again / Reload，不是提交，所以不用蓝色）。 */
const LOCK_BTN =
  "h-[30px] cursor-pointer rounded-[8px] border border-black/20 bg-white px-3 text-[12.5px] font-semibold whitespace-nowrap text-[#1a1a1a] hover:bg-[#f5f5f4] disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Annie 2026-10-07 定：Assign = 分配车、司机、酒店（Step 1 Guest lists、Step 2 Buses & drivers）；
 * Send = 发给司机（手机版 manifest 的链接）+ 原来的早班发送（Morning Relay 按轮发）。
 * 中间的检查点：Send 读的是存好的排车，有没存的改动时 Send 的发送键关着。地址带 ?tab=send。
 */
type Tab = "assign" | "send";
// 步骤条（Annie 2026-10-11 选的方案 B：原来的小标签找不到；步骤条一看就是功能，跟下面的巴士分开）：
// ① Assign › ② Send，当前那块琥珀色框 + 底线；不用蓝色（蓝色只给提交键）。
// Annie 2026-10-15：去掉 FIRST / THEN 那一行，改成圈数字放在名字前，每块只留两行。
const TABS: readonly [Tab, string, string, string][] = [
  [
    "assign",
    "①",
    "Assign",
    "Guest lists · buses, drivers, hotels · arrange seats",
  ],
  ["send", "②", "Send", "Driver texts · morning pickup texts"],
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
  /**
   * staff 动过手、还没存（自动保存只存 staff 改的；打开时 CCL 预填、按人数补开的车不自动存——
   * 只是看一眼不会把这一天存掉、占住。它们在 staff 改了任何地方或点 Completed 时一起存）。
   */
  const [userEdited, setUserEdited] = useState(false);
  /** 上一次自动保存存不上时的行（同样的行不再重试，staff 再改才试）。 */
  const lastFailRef = useRef<string | null>(null);
  /** 按单元保存：正在存的单元（只锁它）/ 每个单元挡下来的原因（原文）/ 自动保存存不上的那份行（不重试）。 */
  const [unitBusy, setUnitBusy] = useState<Record<string, boolean>>({});
  const [unitError, setUnitError] = useState<Record<string, string>>({});
  const unitBusyRef = useRef<Set<string>>(new Set());
  const unitFailRef = useRef<Record<string, string>>({});
  const [prefill, setPrefill] = useState<DispatchPrefill | null>(null);
  const [banner, setBanner] = useState<Banner>("none");
  const [cclImportId, setCclImportId] = useState<number | null>(null);
  const [pullMsg, setPullMsg] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [manifestVersion, setManifestVersion] = useState(0);
  /** 最近一次 Step 1 名单同步的结果（G35）。 */
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  /** Seat guests（每台车下面的客人）：读的是已保存的排车 + Step 1 的名单。 */
  const [seating, setSeating] = useState<DispatchSeating | null>(null);
  const [seatVersion, setSeatVersion] = useState(0);
  /** 这一天点没点过 Completed、之后新进来的单（G56，Step 1 读到后报上来）：车下面的名单据此关掉 Auto、标新单。 */
  const [seatDay, setSeatDay] = useState<
    (SeatDayState & { date: string }) | null
  >(null);
  const [seatMoving, setSeatMoving] = useState(false);
  /** 按人数开车窗（G29 第 3 条）：团 id → 要几台车，来自 Step 1 的卡片（只放传过名单的团）。换天清掉。 */
  const [need, setNeed] = useState<Record<number, TourNeed>>({});
  /** 加 1 = 重新看一遍要不要补开（CCL 预填完、Discard 以后：行整个换掉了）。 */
  const [openTick, setOpenTick] = useState(0);
  /** Step 1 卡片点 Seat guests：哪个团的车下面名单要展开（n 每点一次加 1）。 */
  const [seatOpen, setSeatOpen] = useState<{ mid: number; n: number } | null>(
    null,
  );
  /** 挪车出错：哪个团、什么原因（写在那个团的车下面）。 */
  const [seatError, setSeatError] = useState<{
    mid: number;
    text: string;
  } | null>(null);
  // Farm out 有开关（farm_out_dispatch，默认只 Super Admin；Annie 2026-10-25「虽然上线了但是功能还在讨论中」
  // 「Farm out都还没有开始，你就加吧」；2026-10-26「还没有做好……就仅 super admin 可见」）：看不到时和没有 Farm out
  // 功能一样——不出 Farm out 键、不出 Send farm out notice，已转出去的车也只画成普通车（座位板、人数、车行都不标
  // Farm out）。只改画法：行数据原样保存，farm_out 等字段不动。
  // partner 只看（Annie 2026-10-27「合作方只能看…不能改或者选任何功能」，勾了 dispatch.edit 也一样，partnerLacks 对非 .view 永远 true）：
  // 不占编辑、不存、不拉 Discord、不按 CCL 预填、不补开空车、不配 Private 订单、不挪座位，只画存好的排车。
  // ② Send partner 一律不出（Annie「发送只能是我们内部员工发送」）。
  // Farm out 对 partner 关（Annie 2026-10-27「关」）：键、车下的名单、Farm out 车都不出，也不读合作公司名单（后端名单只给员工）。
  const perms = usePermissions();
  const viewOnly = perms.partnerLacks("dispatch.edit");
  const canSend = !perms.partnerLacks("dispatch.send");
  const viewOnlyRef = useRef(viewOnly);
  viewOnlyRef.current = viewOnly;
  const farmOutVisible =
    usePageVisibility().visible("farm_out_dispatch") &&
    !viewOnly &&
    !perms.isPartner;
  /** Farm out（G40）：合作公司名单（后端没上线 / 读不到 = 没有，页面和以前一样）。只看时、partner 不读。 */
  const partners = usePartners(!viewOnly && !perms.isPartner);
  // G192 司机 / 导游名单（Annie 2026-10-26 preview 全 A）：开关 dispatch_roster 对我开着才读；读不到（后端没上线 404、
  // 没勾 403、出错）就当没有，不出键、不报错。partner 也能用（只看 Dispatch 时这个键单独出现），Add 看 dispatch.edit 的勾。
  const rosterVisible = usePageVisibility().visible("dispatch_roster");
  const canAddRoster = perms.can("dispatch.edit") && !viewOnly;
  const [roster, setRoster] = useState<Roster | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  /** 发 Farm out 通知的弹窗：哪个团、哪些订单。 */
  const [farmNotice, setFarmNotice] = useState<{
    mid: number;
    tourName: string;
    orders: SeatingOrder[];
  } | null>(null);
  /** 把已发过通知的订单挪回我们的车以后的提醒（系统不自动补发，G40 第 16 条）。 */
  const [seatRemind, setSeatRemind] = useState<{
    mid: number;
    text: string;
  } | null>(null);
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
  /** Schedule check 浮窗展开 / 折起（记在这个浏览器里）。 */
  const [checkOpen, toggleCheck] = useCheckOpen();
  /**
   * Step 1 的卡片（这一天）：团 id → 有没有客人、几位；Completed 点没点过。
   * Step 2 据此收起没客人的团、在团名右边写人数（Annie 2026-10-15），底下的 Completed 据此显示。
   */
  const [tourCards, setTourCards] = useState<{
    date: string;
    byId: Record<number, { uploaded: boolean; pax: number }>;
    done: GuestListsDone | null;
    any: boolean;
  } | null>(null);
  /** 没客人的团展开没有：Step 1、Step 2 同一个开关。 */
  const [showEmpty, setShowEmpty] = useState(false);
  /** G82：点 Re-match 加 1，重新给 Private 车配订单。 */
  const [matchTick, setMatchTick] = useState(0);
  const matchSeqRef = useRef(0);
  /** 点过 Completed：加 1 让 Step 1 重读卡片（拿到谁、几点）。 */
  const [doneTick, setDoneTick] = useState(0);
  /** 点过 Completed：步骤条的 ② Send 闪 2 秒。 */
  const [flashSend, setFlashSend] = useState(false);
  const flashSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 异步回调里要读最新的值。
  const stateRef = useRef({ rows, base, day, prefill });
  stateRef.current = { rows, base, day, prefill };

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    if (!rosterVisible) {
      setRoster(null);
      return;
    }
    const controller = new AbortController();
    fetchRoster(controller.signal)
      .then(setRoster)
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 401)) redirectToLogin();
        else setRoster(null);
      });
    return () => controller.abort();
  }, [rosterVisible, redirectToLogin]);

  /** 名单里加了人：这一页的司机 / 导游下拉马上有他（Q4 A：只加进本页的名单，不重读这一天，免得丢正在存的改动）。 */
  function rosterAdded(p: RosterPerson, side: "driver" | "guide") {
    setRoster((r) =>
      r
        ? side === "driver"
          ? { ...r, drivers: [...r.drivers, p] }
          : { ...r, guides: [...r.guides, p] }
        : r,
    );
    setDay((d) => {
      if (!d) return d;
      if (side === "driver") {
        if (d.drivers.some((x) => x.id === p.id)) return d;
        return {
          ...d,
          drivers: insertByName(d.drivers, {
            id: p.id,
            name: p.name,
            initials: initialsOf(p.name),
            license_state: "none",
            license_days: null,
            license_blocked: false,
            position: p.type === "both" ? "both" : "driver",
            // 还没勾 Assignment ⇒ 每一段都能跑（同现在的规则）。
            assignments: [],
          }),
        };
      }
      if (d.guides.some((x) => x.id === p.id)) return d;
      return {
        ...d,
        guides: insertByName(d.guides, { id: p.id, name: p.name }),
      };
    });
  }

  const L = useMemo(() => (day ? makeLookup(day) : null), [day]);
  const analysis = useMemo(() => (L ? analyze(rows, L) : null), [rows, L]);
  // Step 1 团卡片（ManifestsPanel，另读 /api/dispatch/manifests，没有 color 字段）要和这里的团色条
  // 用同一个颜色：从 day.sections（有 color，G142）按 manifest_id 做一张表传过去。
  const colorByManifestId = useMemo(() => {
    const m: Record<number, string | null> = {};
    for (const s of day?.sections ?? [])
      if (s.manifest_id != null) m[s.manifest_id] = s.color ?? null;
    return m;
  }, [day]);
  /**
   * 按人数开车窗（2026-10-16 紧急）要看页面上**当前选的车**，不等存：staff 换车但没点别的（没改 need /
   * closures），车窗该不该开也要跟着变。只取巴士团每行的 manifest_id:vehicle_id，字段以外的改动（备注、酒店……）
   * 不影响这个信号，避免每次按键都重算一轮车窗。
   */
  const busCapacitySignal = rows
    .filter((r) => r.shift === META.bus_tour_shift)
    .map((r) => `${r.manifest_id}:${r.vehicle_id ?? ""}`)
    .sort()
    .join("|");
  const changes = countChanges(base, rows);
  const dirty = changes > 0;
  /** 和已存的不一样（不算补开的空车：它们不存、重读后自己再开）。Send 读的是已存的排车。 */
  const unsaved = countChanges(base, withoutAutoWindows(rows)) > 0;
  /** staff 改了、还没存好：离开要问、标签上写 Saving。 */
  const pendingSave = userEdited && unsaved;

  // 同一天同时只能一个人编辑（后端 G71，Annie 2026-10-15 看过预览）。
  /** 占的时候 409（别人在改）的原话；null = 看 day.edit_lock。 */
  const [blockedBy, setBlockedBy] = useState<string | null>(null);
  /** Save / Copy 被 409 拒（别人在改 / 自己的编辑已结束）的原话。 */
  const [saveEnded, setEditEnded] = useState<string | null>(null);
  const lock = useEditLock({
    date: day?.run_date ?? null,
    version: day?.version ?? null,
    timing: day?.edit_timing,
    onUnauthorized: redirectToLogin,
    onIdleExit: () =>
      setNotice({
        tone: "warn",
        text: "You stopped editing this day after 15 minutes without changes, so others can edit it. Your changes that could not be saved are still on the page; change anything to try again.",
      }),
  });
  /** 编辑被结束了（心跳 / Save 409）：红条 + Reload，只能看。 */
  const endedText = lock.ended ?? saveEnded;
  /** 别人正在改这一天：只能看。 */
  const readOnlyText =
    blockedBy ??
    (day?.edit_lock && !day.edit_lock.by_me && !lock.holding
      ? lockedByText(day.edit_lock)
      : null);

  /** CCL：预填（没存过的一天）/ 改版（存过的一天）/ 关闭的线。动过手就不碰。 */
  const prefillInner = useCallback(async (date: string) => {
    if (viewOnlyRef.current) return;
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
    // 动过手 / 已应用：不预填、不列改版（同旧页面：这时也不记 prefill）。按人数补开的空车不算动过手（Annie 2026-10-11）。
    if (
      countChanges(cur.base, withoutAutoWindows(cur.rows)) > 0 ||
      p.status !== "pending"
    )
      return;
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

  /** 预填以后行可能整个换成 CCL 的：再按人数补一遍（CCL 给的车不够时，多出来的空着等 farm out）。 */
  const maybePrefill = useCallback(
    async (date: string) => {
      await prefillInner(date);
      setOpenTick((t) => t + 1);
    },
    [prefillInner],
  );

  const load = useCallback(
    async (
      date: string | null,
      opts: { sync?: boolean } = {},
    ): Promise<boolean> => {
      // 只认最后一次读取（连点 › 时先发的可能后到）。
      const seq = ++loadSeqRef.current;
      try {
        const d = await fetchDispatchDay(date);
        if (seq !== loadSeqRef.current) return false;
        // 打开页面 / 换天：先按主 Manifest 同步 Step 1 的名单（G35，Annie 2026-10-12），再让下面的卡片、
        // 车下面的名单去读。保存 / 复制后的重读不同步（名单没动）。同步失败不挡排车，Step 1 写出来。
        if (opts.sync && !viewOnlyRef.current) {
          let info: SyncInfo;
          try {
            info = {
              date: d.run_date,
              result: await syncManifests(d.run_date),
            };
          } catch (e) {
            if (isStatus(e, 401)) {
              redirectToLogin();
              return false;
            }
            info = {
              date: d.run_date,
              error:
                e instanceof TypeError
                  ? "Could not reach the server."
                  : describeError(e),
            };
          }
          if (seq !== loadSeqRef.current) return false;
          setSyncInfo(info);
        }
        applyDispatchMeta(d.meta);
        setStale(false);
        setBlockedBy(null);
        setEditEnded(null);
        setClosures([]);
        setDay(d);
        setRows(cloneRows(d.rows));
        setBase(cloneRows(d.rows));
        setUserEdited(false);
        lastFailRef.current = null;
        unitFailRef.current = {};
        setUnitError({});
        setActionError(null);
        setLoadError(null);
        setPrefill(null);
        setBanner("none");
        setCclImportId(null);
        setManifestVersion((v) => v + 1);
        if (d.run_date !== stateRef.current.day?.run_date) {
          setNeed({});
          // 换天：上一天的「All changes saved」不留。
          setSaved(null);
        }
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
      if (viewOnlyRef.current) return;
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
        const isDirty =
          countChanges(cur.base, withoutAutoWindows(cur.rows)) > 0;
        const untouched =
          !!cur.prefill &&
          !cur.base.length &&
          cur.prefill.status === "pending" &&
          JSON.stringify(cloneRows(cur.prefill.rows).map(rowKey).sort()) ===
            JSON.stringify(withoutAutoWindows(cur.rows).map(rowKey).sort());
        if (!isDirty) {
          void maybePrefill(cur.day.run_date);
        } else if (untouched) {
          setRows(cloneRows(cur.base));
          stateRef.current = { ...cur, rows: cur.base };
          void maybePrefill(cur.day.run_date);
        } else {
          setPullMsg(
            `CCL posted something new while you were editing this day. It will be listed once your changes are saved.${last ? ` ${last}` : ""}`,
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
    if (params.get("tab") === "send" && canSend) setTab("send");
    void (async () => {
      const d = isYmd(fromUrl) ? fromUrl : null;
      if (await load(d, { sync: true })) {
        const cur = stateRef.current.day;
        if (cur) await maybePrefill(cur.run_date);
        await pull("page");
      }
    })();
  }, [load, maybePrefill, pull, canSend]);

  // 改了还没存好时离开先问：关标签 / 刷新、站内链接（侧栏、Open manifest）、浏览器后退 / 前进。
  useLeaveGuard(
    pendingSave,
    "This day has changes that are not saved yet. Leave without saving?",
  );

  // Seat guests：换天、保存 / 重读（manifestVersion）、Step 1 Apply、挪车以后重读。读不到就不显示（不挡排车）。
  const runDate = day?.run_date ?? null;
  useEffect(() => {
    if (!runDate) return;
    const controller = new AbortController();
    fetchSeating(runDate, controller.signal)
      .then((d) => {
        if (d.run_date === runDate) setSeating(d);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 401)) redirectToLogin();
        else setSeating(null);
      });
    return () => controller.abort();
  }, [runDate, manifestVersion, seatVersion, redirectToLogin]);

  // 名单（卡片）一到就补开，不等 CCL（Annie 2026-10-11）；CCL 预填、存好重读以后再补一遍。补开的空车不存。
  useEffect(() => {
    const cur = stateRef.current;
    if (!cur.day || !L || viewOnlyRef.current) return;
    const next = openWindows(
      cur.rows,
      cur.day.sections,
      need,
      (s) =>
        closures.some(
          (c) =>
            c.shift &&
            secOf({ shift: c.shift, manifest_id: c.manifest_id }) === secOf(s),
        ),
      L.defaultStops,
      (id) => L.vehicle(id)?.seats ?? null,
    );
    if (next) {
      setRows(next);
      stateRef.current = { ...cur, rows: next };
    }
    // busCapacitySignal：staff 换车（哪怕还没存）要立刻重算车够不够坐，不等 need / closures 变。
  }, [need, closures, L, openTick, busCapacitySignal]);

  /**
   * G82：Private 车自动配 Rezdy 订单（Annie 2026-10-16 看过预览）。打开某一天、换了车、加了车、点 Re-match 时去问后端；
   * 后端只告诉我们每台车配哪张订单，页面把没被 staff 指定（Pinned）的行换成配好的。真有变化才走 edit()（照常自动保存）。
   * 只看车换没换（不看订单号）：staff 清空一行的订单不会马上又被配回去。
   */
  const privateSignal =
    day?.private_orders && day.run_date >= day.today
      ? rows
          .flatMap((r) =>
            r.shift === "private_tour" && r.vehicle_id ? [r.vehicle_id] : [],
          )
          .join(",")
      : "";
  useEffect(() => {
    if (!privateSignal) return;
    const timer = setTimeout(() => void rematchPrivate(), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privateSignal, matchTick, runDate]);

  async function rematchPrivate() {
    const cur = stateRef.current;
    const d = cur.day;
    if (viewOnlyRef.current || !d?.private_orders || d.run_date < d.today)
      return;
    const sent = cur.rows.flatMap((r, i) =>
      r.shift === "private_tour" && r.vehicle_id
        ? [{ i, vehicleId: r.vehicle_id, r }]
        : [],
    );
    if (!sent.length) return;
    const seq = ++matchSeqRef.current;
    try {
      const res = await matchPrivateOrders(
        d.run_date,
        sent.map(({ i, vehicleId, r }) => ({
          key: `r${i}`,
          vehicle_id: vehicleId,
          order_number: r.order_number ?? null,
          order_number_set_by_staff: !!r.order_number_set_by_staff,
        })),
      );
      const now = stateRef.current;
      if (seq !== matchSeqRef.current || now.day?.run_date !== d.run_date)
        return;
      let changed = false;
      const next = now.rows.map((r, i) => {
        const m = res.matches.find((x) => x.key === `r${i}`);
        const asked = sent.find((x) => x.i === i);
        if (
          !m ||
          !asked ||
          r.vehicle_id !== asked.vehicleId ||
          r.order_number_set_by_staff ||
          (m.order_number ?? null) === (r.order_number ?? null)
        )
          return r;
        changed = true;
        return {
          ...r,
          order_number: m.order_number,
          order_number_set_by_staff: false,
        };
      });
      if (changed) edit(next);
    } catch (e) {
      if (isStatus(e, 401)) redirectToLogin();
      // 配不上不挡排车：订单下拉还是能手选。
    }
  }

  /** 挪一张或几张订单（Arrange seats：勾选 / 拖拽成组）；成功 = true，板据此决定先改的数字留不留。 */
  async function moveSeatMany(
    mid: number,
    orders: SeatingOrder[],
    to: string | null,
  ): Promise<boolean> {
    if (viewOnlyRef.current || seatMoving || !orders.length) return false;
    const order = orders[0];
    setSeatMoving(true);
    setSeatError(null);
    setSeatRemind(null);
    try {
      const r = await moveSeating(
        orders.flatMap((o) => o.guest_ids),
        to,
      );
      // 撤销时已发过通知的订单：以后端 `farm_out.already_notified` 为准；
      // 后端没回 farm_out 才退回页面自己的判断（这一单的 notice_sent_at）。
      const notified: string[] = r?.farm_out
        ? r.farm_out.already_notified
        : orders
            .filter((o) => o.farm_out?.notice_sent_at && to !== o.bus_label)
            .map((o) => o.order_number ?? "");
      if (notified.length)
        setSeatRemind({
          mid,
          text:
            orders.length === 1 &&
            notified.length === 1 &&
            notified[0] === order.order_number
              ? `Moved back: ${order.name || order.order_number} (${order.order_number}) already received a farm out notice${order.farm_out?.notice_sent_at ? ` on ${whenText(order.farm_out.notice_sent_at)}` : ""}. Nothing was re-sent — contact the guest yourself.`
              : `Moved back: ${notified.join(", ")} already received a farm out notice. Nothing was re-sent — contact the guest${notified.length === 1 ? "" : "s"} yourself.`,
        });
      // Completed 那天后端不自动分车（G56）：客人还在 Not on a bus，提示 staff 自己选车。
      if (r?.auto_skipped)
        setSeatError({ mid, text: "This day is Completed — pick a bus." });
      return true;
    } catch (e) {
      if (isStatus(e, 401)) {
        redirectToLogin();
        return false;
      }
      setSeatError({
        mid,
        text:
          e instanceof TypeError
            ? "Could not reach the server - the order was not moved. Try again."
            : `Not moved: ${describeError(e)}`,
      });
      return false;
    } finally {
      setSeatMoving(false);
      setSeatVersion((v) => v + 1);
    }
  }

  async function moveSeat(mid: number, { order, to }: SeatMove) {
    await moveSeatMany(mid, [order], to);
  }

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    [],
  );

  /** 「All changes saved · 时间」一直留着（换天清掉），不像原来 3 秒就消失。 */
  function flashSaved(text: string) {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setSaved(text);
  }

  /**
   * 动手改：没占住这一天就先占（G71）。别人在改 ⇒ 不改、页面只读；打开之后别人存过 ⇒ 先换成最新的、这一下不算。
   * 占的那一下页面是灰的（acquiring），不会有第二个改动叠上来。
   */
  function edit(next: DispatchRow[]) {
    if (viewOnlyRef.current) return;
    if (lock.token()) {
      apply(next);
      return;
    }
    const date = day?.run_date;
    void (async () => {
      const r = await lock.ensure();
      if (!date || stateRef.current.day?.run_date !== date) return;
      if (r.kind === "ok") apply(next);
      else await lockFailed(r, date);
    })();
  }

  function apply(next: DispatchRow[]) {
    lock.markEdited();
    setRows(next);
    setUserEdited(true);
    setActionError(null);
  }

  /** 占不住 / 打开之后别人存过：说明原因（stale 时换成最新的这一天）。 */
  async function lockFailed(
    r: Exclude<Awaited<ReturnType<typeof lock.ensure>>, { kind: "ok" }>,
    date: string,
  ) {
    if (r.kind === "busy") {
      setBlockedBy(r.detail);
      return;
    }
    if (r.kind === "error") {
      setActionError(r.detail);
      return;
    }
    if (await load(date)) {
      setNotice({
        tone: "warn",
        text: "Someone saved this day after you opened it. The page now shows the latest schedule. Make your change again.",
      });
      await maybePrefill(date);
    }
  }

  /** 别人在改时：再看一次放开了没有；放开了就换成最新的这一天（别人刚存过）。 */
  const recheckLock = useCallback(async () => {
    const date = stateRef.current.day?.run_date;
    if (!date) return;
    try {
      const d = await fetchDispatchDay(date);
      if (stateRef.current.day?.run_date !== date) return;
      if (!d.edit_lock || d.edit_lock.by_me) {
        if (await load(date)) await maybePrefill(date);
      } else {
        setBlockedBy(null);
        setDay((cur) =>
          cur?.run_date === date ? { ...cur, edit_lock: d.edit_lock } : cur,
        );
      }
    } catch (e) {
      if (isStatus(e, 401)) redirectToLogin();
    }
  }, [load, maybePrefill, redirectToLogin]);

  // 别人在改时每隔一个心跳的时间看一次（Annie 2026-10-15 看过预览：对方存完就能改）。
  const lockPollS = lock.timing.heartbeat_every_s;
  useEffect(() => {
    if (!readOnlyText) return;
    const id = setInterval(() => void recheckLock(), lockPollS * 1000);
    return () => clearInterval(id);
  }, [readOnlyText, recheckLock, lockPollS]);

  async function goTo(date: string) {
    setNotice(null);
    setLoading(true);
    lock.clearEnded();
    await lock.release();
    try {
      if (await load(date, { sync: true })) await maybePrefill(date);
    } finally {
      setLoading(false);
    }
  }

  function requestGo(date: string) {
    // 日期框边打字边触发 change（年份打到一半是 0202-…）：没打完的年份不跳。
    if (!day || !isYmd(date) || date < "2000-01-01" || date === day.run_date)
      return;
    if (pendingSave) setPending({ kind: "leave", to: date });
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
    // Schedule check 的 Fix：这台车框闪黄 2 秒。
    el.style.boxShadow = "0 0 0 3px #f5c518";
    setTimeout(() => {
      el.style.boxShadow = "";
    }, 2000);
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
    goSection(secOf({ shift: META.bus_tour_shift, manifest_id: manifestId }));
  }

  /** 滚到 Step 2 里某一块（团 / Relay 轮次，key 是 secOf）并闪 2 秒；Schedule check 的 Fix 也用它。 */
  function goSection(key: string, unfolded = false) {
    const sec = document.querySelector<HTMLElement>(
      `[data-sec="${CSS.escape(key)}"]`,
    );
    // 没客人的团收起来了（hidden 里滚不过去）：先展开，画出来以后再滚。
    if (sec?.closest("[hidden]") && tab === "assign" && !unfolded) {
      setShowEmpty(true);
      setTimeout(() => goSection(key, true), 0);
      return;
    }
    (sec ?? document.getElementById("step2"))?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    if (!sec) return;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashSec(key);
    flashTimerRef.current = setTimeout(() => setFlashSec(null), 2000);
  }

  /**
   * 点了 Completed（Annie 2026-10-15）：重读 Step 1 的卡片（拿到谁、几点），滚到最上面的步骤条、② Send 闪 2 秒。
   * 不切过去、不发东西：要不要现在发由 staff 自己决定。
   */
  function completed() {
    setDoneTick((t) => t + 1);
    document
      .getElementById("dispatch-steps")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (flashSendTimerRef.current) clearTimeout(flashSendTimerRef.current);
    setFlashSend(true);
    flashSendTimerRef.current = setTimeout(() => setFlashSend(false), 2000);
  }

  /**
   * 存这一天（自动保存、点 Completed 前都走这里；Annie 2026-10-15 去掉了 Save schedule 键）。存好返回 true。
   * 补开的空车不存（重读后按人数自己再开）。缺司机 / 服务端拒：不跳、不滚，原因写在底下的条上，标红那几行。
   */
  async function save(): Promise<boolean> {
    if (viewOnly || !day || busy || unitBusyRef.current.size) return false;
    const toSave = withoutAutoWindows(rows);
    const date = day.run_date;
    // 没动过手也可能要存（点 Completed 时 CCL 预填的车）：存之前占住（G71）。
    const got = await lock.ensure();
    if (got.kind !== "ok") {
      await lockFailed(got, date);
      return false;
    }
    setBusy(true);
    setActionError(null);
    try {
      const j = await saveDispatchDay(date, toSave, cclImportId, lock.token());
      // 存好服务器就放开了。
      lock.forget();
      if (!(await load(date))) return false;
      const names = j.typed_names ?? [];
      // Farm out 车被删 / 取消 / 换了合作公司：只在客人已经收过通知时才说一句（不自动补发）。
      const foNotified = j.farm_out?.already_notified ?? [];
      flashSaved(
        `All changes saved · ${savedTime()}${
          names.length && j.typed_alert === "sent"
            ? `. Annie was emailed to add ${names.join(", ")} to Human Resource.`
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
      if (
        foNotified.length &&
        !(
          names.length &&
          (j.typed_alert === "failed" || j.typed_alert === "not_set_up")
        )
      ) {
        setNotice({
          tone: "warn",
          text: `Saved. A farm out was taken back for ${foNotified.join(", ")}, and the guest already received a farm out notice. Nothing was re-sent — contact ${foNotified.length === 1 ? "the guest" : "the guests"} yourself.`,
        });
      }
      await maybePrefill(date);
      return true;
    } catch (e) {
      if (isStatus(e, 401)) {
        redirectToLogin();
        return false;
      }
      // 409（G71）：别人在改 / 自己的编辑已结束。照原文显示，页面变只读。
      if (isStatus(e, 409)) {
        lock.forget();
        setEditEnded(describeError(e));
        return false;
      }
      setActionError(
        e instanceof TypeError
          ? "Not saved: could not reach the server. Check your connection; it saves again when you change something."
          : `Not saved: ${describeError(e)}`,
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;

  /**
   * 只存一个单元（Annie 2026-10-18「动手」；后端 POST /api/dispatch/section）：这个单元所有的车整块替换，
   * 别的单元的行和没存的改动都不碰（所以不重读整天，只换这一块的行 id、已存的底稿和版本）。只锁正在存的单元。
   * 缺司机的前端先挡（后端放宽落地后去掉）；服务端拒绝就把原文写在这个单元的标题下面。
   */
  async function saveUnit(unit: string): Promise<boolean> {
    const cur = stateRef.current;
    const d = cur.day;
    if (
      viewOnly ||
      !d ||
      busy ||
      loading ||
      stale ||
      unitBusyRef.current.has(unit)
    )
      return false;
    // 打开的是 CCL 预填的一天：按单元存不会把这份 CCL 记成「已采用」，所以第一次存还是整天存。
    if (cclImportId != null) return save();
    const date = d.run_date;
    const toSave = unitRowsOf(cur.rows, unit);
    const got = await lock.ensure();
    if (got.kind !== "ok") {
      await lockFailed(got, date);
      return false;
    }
    unitBusyRef.current.add(unit);
    setUnitBusy((b) => ({ ...b, [unit]: true }));
    setUnitError((e) => omitKey(e, unit));
    try {
      const j = await saveDispatchSection(date, unit, toSave, lock.token());
      const latest = stateRef.current;
      if (latest.day?.run_date !== date) return true;
      if (j.ids.length !== toSave.length) {
        // 后端回的行数对不上：不猜，整天重读。
        await load(date);
        return true;
      }
      const savedRows = toSave.map((r, i) => cloneRow({ ...r, id: j.ids[i] }));
      let k = 0;
      const nextRows = latest.rows.map((r) =>
        unitOf(r) === unit && !isAutoWindow(r) ? (savedRows[k++] ?? r) : r,
      );
      const nextBase = [
        ...latest.base.filter((r) => unitOf(r) !== unit),
        ...savedRows.map(cloneRow),
      ];
      const nextDay = { ...latest.day, version: j.version };
      stateRef.current = {
        ...latest,
        rows: nextRows,
        base: nextBase,
        day: nextDay,
      };
      setRows(nextRows);
      setBase(nextBase);
      setDay(nextDay);
      delete unitFailRef.current[unit];
      // 这个团的客人后端重新分过车了；Relay 面板、Step 1 卡片跟着重读（同整天保存后）。
      setManifestVersion((v) => v + 1);
      const names = j.typed_names ?? [];
      const foNotified = j.farm_out?.already_notified ?? [];
      flashSaved(`All changes saved · ${savedTime()}`);
      if (
        names.length &&
        (j.typed_alert === "failed" || j.typed_alert === "not_set_up")
      ) {
        setNotice({
          tone: "warn",
          text: `Saved. The email to Annie about ${names.join(", ")} (not in Human Resource) could not be sent. Please tell Annie.`,
        });
      } else if (foNotified.length) {
        setNotice({
          tone: "warn",
          text: `Saved. A farm out was taken back for ${foNotified.join(", ")}, and the guest already received a farm out notice. Nothing was re-sent — contact ${foNotified.length === 1 ? "the guest" : "the guests"} yourself.`,
        });
      }
      return true;
    } catch (e) {
      if (isStatus(e, 401)) {
        redirectToLogin();
        return false;
      }
      // 409（G71）：别人在改 / 自己的编辑已结束。照原文显示，页面变只读。
      if (isStatus(e, 409)) {
        lock.forget();
        setEditEnded(describeError(e));
        return false;
      }
      setUnitError((er) => ({
        ...er,
        [unit]:
          e instanceof TypeError
            ? "Not saved: could not reach the server. Check your connection, then press Save again."
            : `Not saved: ${describeError(e)}`,
      }));
      return false;
    } finally {
      unitBusyRef.current.delete(unit);
      setUnitBusy((b) => omitKey(b, unit));
    }
  }
  const saveUnitRef = useRef(saveUnit);
  saveUnitRef.current = saveUnit;

  // 自动保存（Annie 2026-10-15；2026-10-18 退成后备）：staff 改了、页面 60 秒没有任何操作，才把没存的单元一个个存掉。
  // 存不上的同一份不再重试，staff 再改才试。
  const anyUnitBusy = Object.keys(unitBusy).length > 0;
  const autosaveBlocked =
    busy || anyUnitBusy || loading || stale || !!readOnlyText || !!endedText;
  const lastChangeRef = useRef(0);
  useEffect(() => {
    lastChangeRef.current = Date.now();
  }, [rows]);
  useEffect(() => {
    if (!pendingSave || autosaveBlocked) return;
    const key = JSON.stringify(rows);
    // 每 250ms 看一次停手够不够久（不用一次性的 setTimeout：检查脚本中途改等待时间也能马上生效）。
    const id = setInterval(() => {
      if (Date.now() - lastChangeRef.current < autosaveDelay()) return;
      clearInterval(id);
      void (async () => {
        // 打开的是 CCL 预填的一天：只有整天保存才会把这份 CCL 记成「已采用」，所以照旧整天存。
        if (cclImportId != null) {
          if (key === lastFailRef.current) return;
          if (!(await saveRef.current()))
            lastFailRef.current = JSON.stringify(stateRef.current.rows);
          return;
        }
        const { rows: now, base: was } = stateRef.current;
        const units = new Set([...now, ...was].map(unitOf));
        for (const u of units) {
          const cur = stateRef.current;
          if (!unitDirty(cur.base, cur.rows, u)) continue;
          if (
            unitFailRef.current[u] === JSON.stringify(unitRowsOf(cur.rows, u))
          )
            continue;
          if (!(await saveUnitRef.current(u)))
            unitFailRef.current[u] = JSON.stringify(
              unitRowsOf(stateRef.current.rows, u),
            );
        }
      })();
    }, 250);
    return () => clearInterval(id);
  }, [rows, pendingSave, autosaveBlocked, cclImportId]);

  async function copy(): Promise<ActionResult> {
    if (viewOnly || !day?.copy_from) return { status: "ok" };
    const date = day.run_date;
    const got = await lock.ensure();
    if (got.kind !== "ok") {
      setPending(null);
      await lockFailed(got, date);
      return { status: "ok" };
    }
    setBusy(true);
    setActionError(null);
    try {
      const j = await copyDispatchDay(date, day.copy_from, lock.token());
      lock.forget();
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
        if (j.dropped_farm_out) {
          lines.push(
            j.dropped_farm_out === 1
              ? "1 farm out car was not copied. Add it again if you need it."
              : `${j.dropped_farm_out} farm out cars were not copied. Add them again if you need them.`,
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
      // 409（G71）：同 Save。
      if (isStatus(e, 409)) {
        lock.forget();
        setPending(null);
        setEditEnded(describeError(e));
        return { status: "ok" };
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

  function addVehicle(shift: string, tour: number | null, order?: string) {
    if (!L) return;
    edit([
      ...rows,
      cloneRow({
        shift,
        manifest_id: shift === META.bus_tour_shift ? tour : null,
        location_ids: L.defaultStops(shift, tour),
        // G82：后端认订单号时，Private 新车明确写上（加在订单卡下面 = staff 指定）。
        ...(shift === "private_tour" && day?.private_orders
          ? {
              order_number: order ?? null,
              order_number_set_by_staff: !!order,
            }
          : {}),
      }),
    ]);
  }

  /**
   * 第 2 轮「Copy 1st Round」（Annie 2026-10-14，后端 7c）：把第 1 轮每台车（车、司机、停的酒店）复制成第 2 轮的新行，
   * 只改页面、没存；staff 再改、照常 Save（整天覆盖，接口不变）。
   * 第 2 轮还没有车、或者只有什么都没填的空车时给（Annie 10-14：空车也算没排），空车被复制的车换掉；排过一点的车不盖掉。
   */
  function canCopyFirstRound(target: string): boolean {
    return (
      rows.some((r) => r.shift === META.relay_shifts[0]) &&
      rows.filter((r) => r.shift === target).every(isBlankRow)
    );
  }

  function copyFirstRound(target: string) {
    if (!canCopyFirstRound(target)) return;
    const first = rows.filter((r) => r.shift === META.relay_shifts[0]);
    edit([
      ...rows.filter((r) => r.shift !== target),
      ...first.map((r) =>
        cloneRow({ ...r, id: null, shift: target, ccl: null }),
      ),
    ]);
  }

  /** Send 页第 2 轮的 Copy 1st Round：复制完切回 Assign，让人看过、Save 了再回来 Pull。 */
  function copyFirstRoundFromSend() {
    copyFirstRound(META.relay_shifts[1]);
    switchTab("assign");
    setNotice({
      tone: "ok",
      text: "Copied the 1st Round cars into the 2nd Round. Check them; once they are saved, go back to Send and pull again.",
    });
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
  /** 换日期、Send 标签、挪座位：别人在改时照样能用（只看、不改排车）。 */
  const navDisabled = !day || busy || loading || stale;
  const hasUnitError = Object.keys(unitError).length > 0;
  /** 单元标题行的保存区要的东西；只锁正在存的这个单元。 */
  const unitSaveState = (unit: string) => ({
    dirty: unitDirty(base, rows, unit),
    saving: !!unitBusy[unit],
    error: unitError[unit] ?? null,
    disabled:
      viewOnly ||
      navDisabled ||
      !!readOnlyText ||
      !!endedText ||
      lock.acquiring,
    onSave: () => void saveUnit(unit),
  });
  /** 改排车的控件：再加上别人在改 / 编辑已结束 / 正在占（G71）。 */
  const disabled =
    viewOnly || navDisabled || !!readOnlyText || !!endedText || lock.acquiring;

  return (
    <ViewOnly.Provider value={viewOnly}>
      <Shell gutter={checkOpen}>
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
            {/* Annie 2026-10-15：这句改黄色（琥珀，同步骤条当前块）。 */}
            {viewOnly ? null : (
              <p className="mt-1.5 mb-0 text-[13.5px] text-[#fbbf24]">
                Assign the buses, drivers and hotels, then Send: driver texts
                first, then guests&rsquo; morning pickup texts.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="Previous day"
              disabled={navDisabled}
              onClick={() => day && requestGo(shiftYmd(day.run_date, -1))}
              className={DNAV}
            >
              ‹
            </button>
            <input
              type="date"
              aria-label="Day"
              disabled={navDisabled}
              value={day?.run_date ?? ""}
              onChange={(e) => e.target.value && requestGo(e.target.value)}
              className={DPICK}
            />
            <button
              type="button"
              aria-label="Next day"
              disabled={navDisabled}
              onClick={() => day && requestGo(shiftYmd(day.run_date, 1))}
              className={DNAV}
            >
              ›
            </button>
            <button
              type="button"
              disabled={navDisabled}
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
            <p className={cn(MUTED, "py-10 text-center text-[13px]")}>
              Loading…
            </p>
          )
        ) : (
          <>
            {/* Assign / Send 两个标签：旧页面没有（Annie 2026-10-07 定的新功能），样子用旧后台深色那一套。 */}
            {canSend ? (
              <div
                id="dispatch-steps"
                role="tablist"
                aria-label="Dispatch"
                className="mb-[18px] flex scroll-mt-24 flex-col sm:flex-row"
              >
                {TABS.map(([key, step, label, desc], n) => {
                  const on = tab === key;
                  return (
                    <Fragment key={key}>
                      {n > 0 ? (
                        <span
                          aria-hidden
                          className="relative z-[2] hidden w-0 flex-none sm:block"
                        >
                          <span className="absolute top-1/2 -left-[15px] flex size-[30px] -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-[#06101c] text-[18px] text-[#94a3b8]">
                            ›
                          </span>
                        </span>
                      ) : null}
                      <button
                        type="button"
                        role="tab"
                        id={`tab-${key}`}
                        aria-selected={on}
                        aria-controls={`panel-${key}`}
                        onClick={() => switchTab(key)}
                        // 两行：圈数字一栏，名字和下面那行小字在第二栏、字头左对齐（Annie 2026-10-15）。
                        // 点过 Completed：② Send 黄框闪 2 秒（同 Check the bus 闪团块）。
                        className={cn(
                          "grid flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 border px-5 py-3.5 text-left transition-colors",
                          n === 0
                            ? "rounded-t-[14px] sm:rounded-l-[14px] sm:rounded-tr-none"
                            : "rounded-b-[14px] sm:rounded-r-[14px] sm:rounded-bl-none",
                          on
                            ? "border-[rgba(251,191,36,.6)] bg-[rgba(251,191,36,.10)] text-white shadow-[inset_0_-3px_0_#fbbf24]"
                            : "border-white/10 bg-white/[.04] text-[#cbd5e1] hover:bg-white/[.07]",
                          key === "send" &&
                            flashSend &&
                            "ring-[3px] ring-[#fbbf24] ring-inset",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "text-[20px] leading-tight font-bold",
                            on ? "text-[#fbbf24]" : "text-[#94a3b8]",
                          )}
                        >
                          {step}
                        </span>
                        <span className="flex flex-wrap items-center gap-2 text-[20px] leading-tight font-bold tracking-[-.01em]">
                          {label}
                          {key === "assign" &&
                          pendingSave &&
                          (actionError || hasUnitError) ? (
                            <span
                              data-not-saved
                              className="text-[12px] font-bold tracking-normal text-[#fde68a]"
                            >
                              not saved
                            </span>
                          ) : null}
                        </span>
                        <span className="col-start-2 text-[12.5px] text-[#94a3b8]">
                          {desc}
                        </span>
                      </button>
                    </Fragment>
                  );
                })}
              </div>
            ) : null}

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
              {/* G71（Annie 2026-10-15 看过预览）：编辑被结束 = 红条 + Reload；别人在改 = 琥珀条 + Check again。 */}
              {endedText ? (
                <div
                  role="alert"
                  data-edit-ended
                  className={cn(ERRBAR, "flex flex-wrap items-center gap-3")}
                >
                  <span className="min-w-0 flex-[1_1_260px]">{endedText}</span>
                  <button
                    type="button"
                    disabled={navDisabled}
                    onClick={() => {
                      lock.clearEnded();
                      setEditEnded(null);
                      void (async () => {
                        if (await load(day.run_date))
                          await maybePrefill(day.run_date);
                      })();
                    }}
                    className={LOCK_BTN}
                  >
                    Reload
                  </button>
                </div>
              ) : readOnlyText ? (
                <div
                  role="status"
                  data-edit-locked
                  className={cn(BANNER, "flex flex-wrap items-center gap-3")}
                >
                  <span className="min-w-0 flex-[1_1_260px]">
                    🔒 {readOnlyText}
                  </span>
                  <button
                    type="button"
                    disabled={navDisabled}
                    onClick={() => void recheckLock()}
                    className={LOCK_BTN}
                  >
                    Check again
                  </button>
                </div>
              ) : null}
              <ManifestsPanel
                key={day.run_date}
                date={day.run_date}
                colorByManifestId={colorByManifestId}
                // 两个都只会变大：存好 / 重读、点过 Completed 都让卡片重读。
                version={manifestVersion + doneTick}
                sync={syncInfo?.date === day.run_date ? syncInfo : null}
                // 上传 Rezdy CSV 并 Apply 了：重读卡片和车下面的名单（同上）。
                onUploaded={() => setManifestVersion((v) => v + 1)}
                onUnauthorized={redirectToLogin}
                onAssignBus={(mid) => assignBus(mid)}
                showEmpty={showEmpty}
                onToggleEmpty={() => setShowEmpty((v) => !v)}
                onCards={(date, cards, done) => {
                  if (date !== stateRef.current.day?.run_date) return;
                  setTourCards({
                    date,
                    byId: Object.fromEntries(
                      cards.map((c) => [
                        c.manifest_id,
                        { uploaded: c.uploaded, pax: c.pax ?? 0 },
                      ]),
                    ),
                    done,
                    any: cards.length > 0,
                  });
                  const m: Record<number, TourNeed> = {};
                  for (const c of cards)
                    if (c.uploaded && typeof c.buses_needed === "number")
                      m[c.manifest_id] = {
                        needed: c.buses_needed,
                        pax: c.pax ?? 0,
                        bus_pax: c.bus_pax ?? {},
                        guests_per_bus: c.guests_per_bus,
                      };
                  setNeed(m);
                }}
                onCompletedState={(date, st) =>
                  setSeatDay({
                    date,
                    completed: st.completed,
                    newOrders: new Set(st.newOrders),
                  })
                }
                onSeatGuests={(mid) => {
                  setSeatOpen((o) => ({ mid, n: (o?.n ?? 0) + 1 }));
                  assignBus(mid);
                }}
              />

              <StepBox
                n={2}
                id="step2"
                title="Buses & drivers"
                desc="CCL's schedule from Discord fills in the vehicles. Fix anything in red. Only tours with bookings need a bus."
              >
                {/* 旧 `.s2bar`。只看（partner）：整条不出（拉 Discord、导入记录、Copy、保存状态都是改排车用的），
                    只留 Drivers & guides（G192：partner 勾了 dispatch.view 也能看名单）。 */}
                {viewOnly ? (
                  roster ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <RosterButton onClick={() => setRosterOpen(true)} />
                    </div>
                  ) : null
                ) : (
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
                    {/* Dispatch Imports 合进 Dispatch、侧栏不再单列（Annie 2026-10-11）：入口放在用得着它的地方——
                    拉 Discord 旁边，看拉过哪些、读没读懂。 */}
                    <PageLink
                      href="/dispatch/imports"
                      className={cn(
                        BTN_GHOST,
                        "inline-flex items-center no-underline",
                      )}
                    >
                      Import history →
                    </PageLink>
                    {roster ? (
                      <RosterButton onClick={() => setRosterOpen(true)} />
                    ) : null}
                    {day.copy_from ? (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                          rows.length
                            ? setPending({ kind: "copy" })
                            : void copy()
                        }
                        className={BTN_GHOST}
                      >
                        Copy {fmtShort(day.copy_from)}
                      </button>
                    ) : null}
                    {/* Save schedule 键去掉了（Annie 2026-10-15）：这里写自动保存的状态。 */}
                    <span
                      role="status"
                      data-save-state
                      className={cn(
                        "text-[12.5px]",
                        pendingSave && (actionError || hasUnitError)
                          ? "font-semibold text-[#fde68a]"
                          : pendingSave || busy || anyUnitBusy
                            ? "text-[#cbd5e1]"
                            : "text-[#86efac]",
                      )}
                    >
                      {busy || anyUnitBusy
                        ? "Saving…"
                        : pendingSave
                          ? actionError
                            ? "Not saved - see the message at the bottom"
                            : hasUnitError
                              ? "Not saved - see the message on the section"
                              : "Unsaved changes"
                          : saved
                            ? `✓ ${saved}`
                            : ""}
                    </span>
                    {pullMsg ? (
                      <span
                        role="status"
                        className="text-[11.5px] text-[#94a3b8]"
                      >
                        {pullMsg}
                      </span>
                    ) : null}
                  </div>
                )}

                {viewOnly ? null : <HowToUse />}

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

                {!day.drivers.length && !viewOnly ? (
                  <p className={BANNER}>
                    <b>No drivers yet.</b> Drivers come from Human Resource: set
                    a person&rsquo;s <b>Position</b> to Driver or Driver + Guide
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
                  className="grid grid-cols-1 items-stretch gap-[18px]"
                >
                  <div className="flex flex-wrap items-stretch rounded-[14px] border border-white/10 bg-white/[.04] px-1.5 py-1">
                    <Stat
                      icon="👤"
                      value={analysis.driversUsed}
                      label="drivers"
                    />
                    <Stat
                      icon="🚐"
                      value={rows.length}
                      label="vehicles"
                      border
                    />
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
                </section>

                {/* 旧 `.cols`：≤1300px 拆成一栏，右栏落到卡片下面。 */}
                <div className="grid grid-cols-1 items-start gap-[18px]">
                  <div className="flex min-w-0 flex-col gap-4">
                    {(() => {
                      type Sec = DispatchDay["sections"][number];
                      // 巴士团在 Step 1 的卡片：有没有客人、几位（Relay、Private Tour 没有卡片，照常显示）。
                      const tourCard = (s: Sec) =>
                        tourCards?.date === day.run_date &&
                        s.shift === META.bus_tour_shift &&
                        s.manifest_id != null
                          ? tourCards.byId[s.manifest_id]
                          : undefined;
                      // 跟着 Step 1 收起没客人的团（Annie 2026-10-15）；万一排了车就不收，免得车藏起来。
                      const isFolded = (s: Sec) => {
                        const c = tourCard(s);
                        return (
                          !!c &&
                          !c.uploaded &&
                          !rows.some((r) => secOf(r) === secOf(s))
                        );
                      };
                      // 一台车（VanBlock / RelayRow）要的属性：普通卡片和 Private 订单卡共用。
                      const vanProps = (i: number, cardIdx: number) => ({
                        rows,
                        idx: i,
                        L,
                        ring: RING[cardIdx % RING.length],
                        isDup: analysis.dup.has(i),
                        // 座位调整还没存：后端只按已保存的调整分车，小块旁写 Saving…。
                        seatPending:
                          (rows[i].seat_adjustment ?? 0) !==
                          (base.find((b) => b.id != null && b.id === rows[i].id)
                            ?.seat_adjustment ?? 0),
                        disabled: disabled || !!unitBusy[unitOf(rows[i])],
                        onChange: (n: DispatchRow) => {
                          edit(rows.map((r, j) => (j === i ? n : r)));
                        },
                        onRemove: () => edit(rows.filter((_, j) => j !== i)),
                        orders: day.private_orders,
                      });
                      const renderSec = (s: Sec, cardIdx: number) => {
                        // G82：后端带了 Rezdy 订单 => Private Tour 按订单分卡（上面订单 / 团名，下面这张订单的车）。
                        const unit = unitOf(s);
                        const secDisabled = disabled || !!unitBusy[unit];
                        if (s.shift === "private_tour" && day.private_orders) {
                          const us = unitSaveState(unit);
                          return (
                            <PrivateOrderCards
                              key={secOf(s)}
                              sectionKey={secOf(s)}
                              orders={day.private_orders}
                              rows={rows}
                              L={L}
                              disabled={secDisabled}
                              saveBar={
                                <>
                                  <div className="flex items-center justify-end gap-3">
                                    <span className="mr-auto text-[14px] font-semibold text-[#cfe0f2]">
                                      {s.title}
                                    </span>
                                    <UnitSave unit={unit} s={us} tone="dark" />
                                  </div>
                                  {us.dirty ? (
                                    <UnitError
                                      unit={unit}
                                      text={us.error}
                                      tone="dark"
                                    />
                                  ) : null}
                                </>
                              }
                              renderVan={(i) => (
                                <VanBlock key={i} {...vanProps(i, cardIdx)} />
                              )}
                              onAdd={(order) =>
                                addVehicle(s.shift, s.manifest_id, order)
                              }
                              onRematch={() => setMatchTick((n) => n + 1)}
                            />
                          );
                        }
                        const key = secOf(s);
                        const tc = tourCard(s);
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
                        // Seat guests 只看巴士团；车按「已保存的那一行」的字母对上（没存的新车 / 改了没存的字母对不上，存了才算）。
                        const seat0 =
                          s.shift === META.bus_tour_shift &&
                          seating?.run_date === day.run_date
                            ? seating.tours.find(
                                (t) => t.manifest_id === s.manifest_id,
                              )
                            : undefined;
                        // Farm out 车（G40）：后端没标就按已保存排车的 farm_out 补上，下拉里写 Farm out。
                        const farmLabels = new Set(
                          base.flatMap((r) =>
                            r.farm_out && r.bus_label && secOf(r) === key
                              ? [r.bus_label]
                              : [],
                          ),
                        );
                        // partner 不碰 Farm out（Annie 2026-10-27「关」）：Farm out 车和车下的客人名单整辆不画。
                        const seat =
                          seat0 && perms.partnerView
                            ? {
                                ...seat0,
                                buses: seat0.buses
                                  .filter(
                                    (b) =>
                                      !b.farm_out &&
                                      !(
                                        b.label != null &&
                                        farmLabels.has(b.label)
                                      ),
                                  )
                                  .map((b) => ({ ...b, farm_out: false })),
                              }
                            : seat0 && !farmOutVisible
                              ? {
                                  ...seat0,
                                  buses: seat0.buses.map((b) => ({
                                    ...b,
                                    farm_out: false,
                                  })),
                                }
                              : seat0 && farmLabels.size
                                ? {
                                    ...seat0,
                                    buses: seat0.buses.map((b) => ({
                                      ...b,
                                      farm_out:
                                        b.farm_out ??
                                        (b.label != null &&
                                          farmLabels.has(b.label)),
                                    })),
                                  }
                                : seat0;
                        const savedIdxs = idxs.filter(
                          (i) => rows[i].id != null,
                        );
                        const dayState =
                          seatDay?.date === day.run_date ? seatDay : undefined;
                        const extra = notNeededRows(
                          rows,
                          s.manifest_id,
                          need,
                          (id) => L.vehicle(id)?.seats ?? null,
                        );
                        const seatFor = (i: number) => {
                          if (!seat?.uploaded || rows[i].id == null)
                            return null;
                          if (seat.mode === "single")
                            return i === savedIdxs[0] ? (
                              <SingleBusGuests tour={seat} />
                            ) : null;
                          if (seat.mode !== "lettered") return null;
                          const label = base.find(
                            (b) => b.id === rows[i].id,
                          )?.bus_label;
                          // 没字母的 Farm out 草稿车（label: null）不画成可放人的车，也不能拿 null 去对「没上车」的订单。
                          const bus =
                            label != null
                              ? seat.buses.find((b) => b.label === label)
                              : undefined;
                          if (bus && rows[i].farm_out && farmOutVisible)
                            return (
                              <FarmOutGuests
                                tour={seat}
                                bus={bus}
                                date={day.run_date}
                                partnerId={rows[i].partner_id ?? null}
                                openSignal={
                                  seatOpen?.mid === seat.manifest_id
                                    ? seatOpen.n
                                    : undefined
                                }
                                disabled={navDisabled || seatMoving}
                                onMove={(m) =>
                                  void moveSeat(seat.manifest_id, m)
                                }
                                onChanged={() => setSeatVersion((v) => v + 1)}
                                onSend={
                                  farmOutVisible && canSend
                                    ? (orders) =>
                                        setFarmNotice({
                                          mid: seat.manifest_id,
                                          tourName: seat.title || seat.name,
                                          orders,
                                        })
                                    : undefined
                                }
                              />
                            );
                          // 普通车下面不再各列一条：这个团的车并排放在团下面的 Arrange seats 板里。
                          return null;
                        };
                        return (
                          <section
                            key={key}
                            data-sec={key}
                            aria-label={s.title}
                            // 团色条 + 图标块用团的颜色（同 Main manifest / Step 1 / Bus manifest，Annie
                            // 2026-10-14；G142 起认接口给的 `s.color`，没配时按团名猜）。
                            style={
                              {
                                "--c": resolveTourColor(s.color, s.title),
                              } as CSSProperties
                            }
                            className={cn(
                              // 旧 `.card`：白卡片，深字。闪一下 = 旧 `.card.flash`（3px #fbbf24）。
                              "scroll-mt-20 overflow-hidden rounded-xl border-[0.5px] border-l-[5px] border-black/10 border-l-[var(--c)] bg-paper text-[#1a1a1a] transition-shadow duration-300",
                              flashSec === key && "ring-[3px] ring-[#fbbf24]",
                            )}
                          >
                            <div
                              className={cn(
                                "flex flex-wrap items-center gap-3.5 border-b border-[#e5e7eb] px-5 pt-3.5 pb-3",
                                closed ? "bg-[#f3f3f1]" : "bg-paper",
                              )}
                            >
                              <span
                                aria-hidden
                                className="flex size-10 flex-none items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--c)_16%,var(--paper))] text-[var(--c)]"
                              >
                                <BusIcon className="size-[22px]" />
                              </span>
                              <span className="text-[18px] font-bold tracking-[-.01em] text-[#111827]">
                                {s.title}
                              </span>
                              {closed ? (
                                <span className="max-w-full rounded-full bg-[#e9e9e6] px-2.5 py-[3px] text-[11.5px] font-bold whitespace-normal text-[#1a1a1a]">
                                  {closed.note || "Closed"}
                                </span>
                              ) : null}
                              {s.sub ? (
                                <span className="inline-flex items-center gap-[5px] rounded-full border border-[#cfdcf3] bg-[#eef4ff] py-[3px] pr-3 pl-[11px] text-[12.5px] font-medium text-[#111827] tabular-nums">
                                  <ClockIcon />
                                  {s.sub}
                                </span>
                              ) : null}
                              <span className="ml-auto text-[13px] text-[#1a1a1a] tabular-nums">
                                {/* 有客人的巴士团先写人数（Annie 2026-10-15）。 */}
                                {tc?.uploaded ? (
                                  <>
                                    <b>{tc.pax}</b> pax
                                    {farmOutVisible && seat0?.pax_farm_out ? (
                                      <span data-pax-split>
                                        {" "}
                                        (
                                        {seat0.pax_ours ??
                                          tc.pax - seat0.pax_farm_out}{" "}
                                        ours · {seat0.pax_farm_out} Farm out)
                                      </span>
                                    ) : null}{" "}
                                    ·{" "}
                                  </>
                                ) : null}
                                <b>{idxs.length}</b> vehicles · <b>{hotels}</b>{" "}
                                hotels
                                {seatNotes(seat, dirty).map((t) => (
                                  <span
                                    key={t}
                                    data-seat-note
                                    className="ml-2.5 text-[11.5px] font-medium text-[#8a5a00]"
                                  >
                                    {t}
                                  </span>
                                ))}
                              </span>
                              <UnitSave unit={unit} s={unitSaveState(unit)} />
                            </div>
                            {unitSaveState(unit).dirty ? (
                              <UnitError
                                unit={unit}
                                text={unitError[unit] ?? null}
                              />
                            ) : null}
                            <div className="px-5 pt-0.5 pb-4 text-[#111827]">
                              {idxs.length === 0 ? (
                                closed ? (
                                  <p className="m-0 px-2 pt-[18px] pb-4 text-center text-[13px] text-[#1a1a1a]">
                                    CCL closed this tour for the day. No
                                    vehicles can be added.
                                  </p>
                                ) : (
                                  <div className="flex flex-col items-center gap-[11px] px-2 pt-[22px] pb-5">
                                    <span className="text-[14px] font-semibold text-[#1a1a1a]">
                                      No vehicles assigned yet
                                    </span>
                                    {viewOnly ? null : (
                                      <div className="flex flex-wrap justify-center gap-2.5">
                                        <button
                                          type="button"
                                          disabled={secDisabled}
                                          onClick={() =>
                                            addVehicle(s.shift, s.manifest_id)
                                          }
                                          className={ADDVAN_DARK}
                                        >
                                          + Add vehicle
                                        </button>
                                        {s.shift === META.relay_shifts[1] &&
                                        canCopyFirstRound(s.shift) ? (
                                          <button
                                            type="button"
                                            disabled={secDisabled}
                                            onClick={() =>
                                              copyFirstRound(s.shift)
                                            }
                                            className={ADDVAN}
                                          >
                                            Copy 1st Round
                                          </button>
                                        ) : null}
                                      </div>
                                    )}
                                  </div>
                                )
                              ) : (
                                <>
                                  {!viewOnly &&
                                  s.shift === META.relay_shifts[1] &&
                                  canCopyFirstRound(s.shift) ? (
                                    // 第 2 轮只有空车（什么都没填）：也给复制，空车被换掉。
                                    <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3">
                                      <span className="text-[12.5px] text-[#4a5568]">
                                        Nothing filled in yet.
                                      </span>
                                      <button
                                        type="button"
                                        disabled={secDisabled}
                                        onClick={() => copyFirstRound(s.shift)}
                                        className={ADDVAN}
                                      >
                                        Copy 1st Round
                                      </button>
                                    </div>
                                  ) : null}
                                  {relay ? (
                                    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.85fr)_minmax(0,1.35fr)_84px] gap-[18px] border-b border-[#e5e7eb] pt-3 pb-2 text-[11px] font-[650] tracking-[.06em] text-[#1a1a1a] uppercase max-[860px]:hidden">
                                      <span>Driver</span>
                                      <span>Vehicle</span>
                                      <span>Hotel pickup stops</span>
                                      <span>Actions</span>
                                    </div>
                                  ) : null}
                                  {idxs.map((i) => {
                                    const props = {
                                      ...vanProps(i, cardIdx),
                                      notNeeded: extra.get(i),
                                    };
                                    if (relay)
                                      return <RelayRow key={i} {...props} />;
                                    const r = rows[i];
                                    const savedLabel = base.find(
                                      (b) => b.id === r.id,
                                    )?.bus_label;
                                    const needHotel = seat
                                      ? seat.orders.filter(
                                          (o) =>
                                            o.farm_out &&
                                            o.farm_out.partner_location_id ==
                                              null &&
                                            o.bus_label === savedLabel,
                                        ).length
                                      : undefined;
                                    // ⇄ Farm out 键：只有巴士团的第二台车有（Annie 2026-10-15），后端没有合作公司就不出现。
                                    const act =
                                      partners.state === "ready"
                                        ? partners.data.filter(
                                            (p) => p.is_active,
                                          )
                                        : [];
                                    // Annie 2026-10-17 夜：第二台车一直显示键，不按人数限制（超过 10 位也不消失，选不选 Farm out 是 staff 的事）；没有合作公司时键灰着、点不了。
                                    const canFarmOut =
                                      farmOutVisible &&
                                      s.shift === META.bus_tour_shift &&
                                      idxs.indexOf(i) === 1 &&
                                      // 后端没有 Farm out（接口读不到）时整个不出现，跟以前一样。
                                      partners.state === "ready";
                                    const noPartners =
                                      partners.state === "ready" &&
                                      act.length === 0;
                                    return (
                                      <Fragment key={i}>
                                        {r.farm_out && farmOutVisible ? (
                                          <FarmOutBlock
                                            row={r}
                                            partners={partners}
                                            needHotel={needHotel}
                                            disabled={secDisabled}
                                            onChange={(n) =>
                                              props.onChange(
                                                n.farm_out === false
                                                  ? {
                                                      ...n,
                                                      location_ids:
                                                        L.defaultStops(
                                                          n.shift,
                                                          n.manifest_id,
                                                        ),
                                                    }
                                                  : n,
                                              )
                                            }
                                            onRemove={props.onRemove}
                                          />
                                        ) : (
                                          <VanBlock
                                            {...props}
                                            farmOutOff={
                                              noPartners
                                                ? "No farm out partners yet. An admin adds them in Supplier → Partners."
                                                : undefined
                                            }
                                            onFarmOut={
                                              canFarmOut
                                                ? () =>
                                                    props.onChange({
                                                      ...r,
                                                      farm_out: true,
                                                      // Farm out 车必须有车字母（后端 400 A farm out car needs a bus letter.）。
                                                      bus_label:
                                                        r.bus_label ??
                                                        META.bus_labels.find(
                                                          (l) =>
                                                            !idxs.some(
                                                              (j) =>
                                                                rows[j]
                                                                  .bus_label ===
                                                                l,
                                                            ),
                                                        ) ??
                                                        null,
                                                      partner_id:
                                                        act.length === 1
                                                          ? act[0].id
                                                          : null,
                                                      partner_name:
                                                        act.length === 1
                                                          ? act[0].name
                                                          : null,
                                                      driver_hr_id: null,
                                                      driver_typed_name: null,
                                                      vehicle_id: null,
                                                      guide_hr_id: null,
                                                      guide_typed_name: null,
                                                      location_ids: [],
                                                    })
                                                : undefined
                                            }
                                          />
                                        )}
                                        {seatFor(i)}
                                      </Fragment>
                                    );
                                  })}
                                  {seat?.uploaded &&
                                  seat.mode === "lettered" ? (
                                    <ArrangeBoard
                                      tour={seat}
                                      day={dayState}
                                      disabled={navDisabled || seatMoving}
                                      onMoveMany={(orders, to) =>
                                        moveSeatMany(
                                          seat.manifest_id,
                                          orders,
                                          to,
                                        )
                                      }
                                    />
                                  ) : null}
                                  {seat ? (
                                    <TourSeatingNotes
                                      tour={seat}
                                      error={
                                        seatError?.mid === seat.manifest_id
                                          ? seatError.text
                                          : null
                                      }
                                    />
                                  ) : null}
                                  {seatRemind?.mid === s.manifest_id ? (
                                    <p
                                      data-farm-out-remind
                                      role="status"
                                      className="mt-2 mb-0 rounded-[10px] border border-[#f0d080] bg-[#fff8e1] px-4 py-2.5 text-[12px] leading-[1.7] text-[#7C4A00]"
                                    >
                                      {seatRemind.text}
                                    </p>
                                  ) : null}
                                  {!closed && !viewOnly ? (
                                    <button
                                      type="button"
                                      disabled={secDisabled}
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
                      };
                      const folded = day.sections.flatMap((s, i) =>
                        isFolded(s) ? [{ s, i }] : [],
                      );
                      // Private Tour 没有 Step 1 卡片，看有没有排车（Annie 2026-10-15：先收口，回头做）。
                      const privateTourIdx = day.sections.findIndex(
                        (s) => s.shift === "private_tour",
                      );
                      const privateTourSection =
                        privateTourIdx >= 0
                          ? day.sections[privateTourIdx]
                          : undefined;
                      // 有 Rezdy 订单（G82）就不收起：订单要看得见，哪怕还没排车。
                      const privateTourFolded =
                        !!privateTourSection &&
                        !day.private_orders?.length &&
                        !rows.some(
                          (r) => secOf(r) === secOf(privateTourSection),
                        );
                      return (
                        <>
                          {day.sections.map((s, i) =>
                            isFolded(s) ||
                            (privateTourFolded && i === privateTourIdx)
                              ? null
                              : renderSec(s, i),
                          )}
                          {folded.length || privateTourFolded ? (
                            <>
                              <EmptyToursToggle
                                names={folded.map(({ s }) => s.title)}
                                extra={
                                  privateTourFolded
                                    ? "Private Tour (no vehicles)"
                                    : undefined
                                }
                                open={showEmpty}
                                onToggle={() => setShowEmpty((v) => !v)}
                              />
                              <div
                                data-empty-sections
                                hidden={!showEmpty}
                                className="flex flex-col gap-4"
                              >
                                {folded.map(({ s, i }) => renderSec(s, i))}
                                {privateTourFolded && privateTourSection
                                  ? renderSec(
                                      privateTourSection,
                                      privateTourIdx,
                                    )
                                  : null}
                              </div>
                            </>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <Rail
                  analysis={analysis}
                  guests={Object.fromEntries(
                    analysis.sections.flatMap((s) => {
                      const sec = day.sections.find((d) => secOf(d) === s.key);
                      const card =
                        tourCards?.date === day.run_date &&
                        sec &&
                        sec.shift === META.bus_tour_shift &&
                        sec.manifest_id != null
                          ? tourCards.byId[sec.manifest_id]
                          : undefined;
                      return card ? [[s.key, card.pax]] : [];
                    }),
                  )}
                  open={checkOpen}
                  onToggle={toggleCheck}
                  onGoto={(i, f) => focusRow(i, f)}
                  onGoSection={(k) => goSection(k)}
                />

                {!viewOnly &&
                tourCards?.date === day.run_date &&
                tourCards.any ? (
                  <CompletedBar
                    date={day.run_date}
                    done={tourCards.done}
                    onDone={completed}
                    onUnauthorized={redirectToLogin}
                    // 先把还没存的（包括 CCL 预填的车）存好；存不上就不标完成，原因写在底下的条上。
                    beforeComplete={() =>
                      unsaved ? saveRef.current() : Promise.resolve(true)
                    }
                    disabled={disabled}
                  />
                ) : null}
              </StepBox>
            </div>

            {/* Send：1 Send to drivers → 2 Morning Relay（早班发送）。都读存好的排车。 */}
            {canSend ? (
              <div
                role="tabpanel"
                id="panel-send"
                aria-labelledby="tab-send"
                hidden={tab !== "send"}
                className="flex flex-col gap-[18px]"
              >
                {unsaved ? (
                  <div
                    role="alert"
                    className={cn(BANNER, "flex flex-wrap items-center gap-3")}
                  >
                    <span className="mr-auto">
                      <b>Assign is not saved yet.</b> Sending uses the saved
                      schedule, so the send buttons are off until it is saved.
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
                  dirty={unsaved}
                  disabled={navDisabled}
                  onUnauthorized={redirectToLogin}
                  onCopyFirstRound={
                    canCopyFirstRound(META.relay_shifts[1])
                      ? copyFirstRoundFromSend
                      : undefined
                  }
                />
              </div>
            ) : null}
          </>
        )}

        {/* G203 第四批：这一天的排车改动记录（后端 dispatch.edit 才能读；partner、没有 edit 的不出、不请求）。
            换日期、存好一块（day.version 变了）就重读。 */}
        {day && !perms.isPartner && perms.can("dispatch.edit") ? (
          <div className="mt-[18px]">
            <ActionLogPanel
              refreshKey={`${day.run_date}|${day.version ?? ""}`}
              reloadOnOpen
              onUnauthorized={redirectToLogin}
              load={(before, signal) =>
                fetchActionLog("/api/dispatch/action-log", before, signal, {
                  date: day.run_date,
                })
              }
            />
          </div>
        ) : null}

        {/* 旧 `.savebar`：内容栏里贴底（sticky）。改动自动保存（Annie 2026-10-15），这条只在存不上 / 出错时出现，写原因。 */}
        {actionError ? (
          <div
            data-save-error
            className="sticky bottom-3 z-40 mt-4 rounded-xl border border-white/16 bg-[rgba(6,16,28,.92)] px-3.5 py-[11px] shadow-[0_10px_30px_rgba(0,0,0,.35)] backdrop-blur-[9px]"
          >
            <div
              role="status"
              className="pr-10 text-[13px] leading-[1.45] font-semibold text-[#fecaca]"
            >
              {actionError}
            </div>
          </div>
        ) : null}

        {rosterOpen && roster ? (
          <RosterDialog
            roster={roster}
            canAdd={canAddRoster}
            onClose={() => setRosterOpen(false)}
            onAdded={rosterAdded}
            onUnauthorized={redirectToLogin}
          />
        ) : null}

        {farmNotice && day ? (
          <FarmOutNoticeDialog
            manifestId={farmNotice.mid}
            tourName={farmNotice.tourName}
            date={day.run_date}
            orders={farmNotice.orders}
            onClose={() => setFarmNotice(null)}
            onDone={() => setSeatVersion((v) => v + 1)}
          />
        ) : null}

        {pending?.kind === "leave" ? (
          <ConfirmDialog
            title="This day has changes that are not saved yet"
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
              {pendingSave
                ? ", including your changes that are not saved yet"
                : ""}
              . It is saved right away.
            </p>
          </ConfirmDialog>
        ) : null}
      </Shell>
    </ViewOnly.Provider>
  );
}

/**
 * Step 2 按钮条里 Import history 旁边的键（G192 Q1 A）。图标：细线两个人形、橙色 #f97316
 *（Annie 2026-10-26「用你推荐的人形，但是要C的颜色」，图标 preview 第 2 版 D）；按钮照旧是灰描边键。
 */
function RosterButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      data-roster-open
      onClick={onClick}
      className={cn(BTN_GHOST, "inline-flex items-center gap-[7px]")}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="#f97316"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        data-roster-icon
        className="size-4 flex-none"
      >
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
        <circle cx="16.5" cy="9" r="2.6" />
        <path d="M15.5 14.2c2.6-.3 4.6 1.3 5 4.3" />
      </svg>
      Drivers &amp; guides
    </button>
  );
}

/** 两个字母的头像缩写（新加的司机；下次读这一天后端给的为准）。 */
function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return (
    parts.length > 1
      ? parts[0][0] + parts[parts.length - 1][0]
      : name.slice(0, 2)
  ).toUpperCase();
}

/** 按名字插进已排好的名单（不重排别的人）。 */
function insertByName<T extends { name: string }>(list: T[], item: T): T[] {
  const at = list.findIndex(
    (x) =>
      x.name.localeCompare(item.name, undefined, { sensitivity: "base" }) > 0,
  );
  return at < 0
    ? [...list, item]
    : [...list.slice(0, at), item, ...list.slice(at)];
}

function Shell({
  children,
  gutter = false,
}: {
  children: React.ReactNode;
  /** Schedule check 浮窗展开：宽屏右边让出位置，不盖住内容（窄屏浮窗直接盖在上面，用胶囊折起）。 */
  gutter?: boolean;
}) {
  // 底色、外边距由整站外框（照 base.html）给；白卡片里的字靠 text-stone-800 以外各自写死的颜色。
  return (
    <main className={cn("text-stone-800", gutter && "min-[1301px]:pr-[330px]")}>
      {children}
    </main>
  );
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
          CCL&rsquo;s schedule fills in the buses and drivers. Orange text means
          a name or vehicle did not match: pick it from the list, or choose
          &quot;Not in the list? Type a name...&quot; once (Annie is emailed to
          add the person to Human Resource).
        </li>
        <li>
          Morning Relay: pick each car&rsquo;s hotels in Add hotel. 2nd Round:
          Copy 1st Round copies the cars, drivers and hotels.
        </li>
        <li>
          &quot;Not on a bus&quot; (orange) lists orders with no room. Drag an
          order onto another bus of the tour, or pick the bus in its list.
        </li>
        <li>
          A yellow bar means CCL posted a change: Apply changes puts it on the
          page.
        </li>
        <li>
          Press Save on a block to save it; changes also save by themselves
          after a minute without activity. A red message says what to fix. Only
          one person can edit a day at a time.
        </li>
      </ol>
    </details>
  );
}
