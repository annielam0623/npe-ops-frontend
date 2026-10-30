"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { fmtShort } from "@/components/dispatch/config";
import { hasInAppHistory } from "@/components/nav/in-app-history";
import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  ATTR_LEN,
  fetchManifest,
  MANIFEST_DOWNLOAD_URL,
  manifestGuideUrl,
  manifestPrintUrl,
  saveAttraction,
  saveGuestNotes,
  saveManifestVersion,
  saveTextSize,
  setGuestBus,
} from "@/lib/dispatch-manifest-api";
import { isYmd } from "@/lib/la-date";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { tourColorFor } from "@/lib/tour-colors";
import { cn } from "@/lib/utils";
import { PageLink } from "@/components/ui/page-link";
import { useViewOnly, ViewOnly } from "@/components/ui/view-only";
import { usePermissions } from "@/lib/staff-permissions";

import { AffiliateCard } from "./affiliate-card";
import {
  applyMoves,
  attrKey,
  type AttrValues,
  EMPTY_PENDING,
  isDirty,
  LeaveDialog,
  type Pending,
  pendingSummary,
  SaveFirstDialog,
  savedBusOf,
  Stage,
  UNSAVED_RING,
  UNSAVED_TAG,
  useStage,
} from "./page-save";
import {
  LunchMismatchDialog,
  type MismatchAction,
} from "./lunch-mismatch-dialog";
import {
  cellText,
  editCellClass,
  EMPTY_TEXT_SIZE,
  HEAD_PX,
  isPicked,
  layerOf,
  type ManifestColumnKey,
  type TextMode,
  type TextPick,
  TextSizeHistory,
  TextSizeToolbar,
  togglePick,
  updateLayers,
  usePhoneWidth,
} from "./text-size";
import type {
  ManifestBlock,
  ManifestFooterCell,
  ManifestGoneGuest,
  ManifestGuest,
  ManifestLunch,
  ManifestLunchMismatch,
  ManifestRestaurant,
  ManifestSection,
  ManifestTextSize,
  ManifestVersion,
  ManifestView as ManifestData,
} from "@/types";

type ViewState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "bad-link" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ManifestData };

/**
 * 页头的人数只算我们车上的（Annie 2026-10-18：「不需要统计 our 和 A 的总数」）：后端整团 `totals.pax` 已含转单客人，
 * 用 `pax_ours`；旧后端没有这个字段（也没有 affiliate）时就是 `totals.pax`。订单数同理，扣掉 Affiliate 的。
 */
function ourPax(data: ManifestData): number {
  return (
    data.totals.pax_ours ?? data.totals.pax - (data.affiliate?.totals.pax ?? 0)
  );
}
function ourOrders(data: ManifestData): number {
  return data.totals.guests - (data.affiliate?.totals.guests ?? 0);
}

/** 客人表的一列：列键（G197 存「整列」用，换版式不丢）+ 表头。 */
interface Column {
  key: ManifestColumnKey;
  label: string;
}

/** General / Marcello 的列（Marcello = 字大的 General，定 14）。 */
const GENERAL_COLUMNS: Column[] = [
  { key: "order_number", label: "Order Number" },
  { key: "pickup_time", label: "Pick-up Time" },
  { key: "pickup_location", label: "Pick-up Location" },
  { key: "last_name", label: "Last Name" },
  { key: "first_name", label: "First Name" },
  { key: "phone", label: "Customer Phone" },
  { key: "pax", label: "#" },
  { key: "ticket", label: "Quantities" },
  { key: "notes", label: "Special Requirements" },
];

/** Lankun 的列序（定 5，同后端 LANKUN_COLUMNS）；没有 ✓ 列。 */
const LANKUN_COLUMNS: Column[] = [
  { key: "order_number", label: "Order #" },
  { key: "pickup_time", label: "Time" },
  { key: "pickup_location", label: "Hotel" },
  { key: "phone", label: "Phone" },
  { key: "ticket", label: "Ticket" },
  { key: "pax", label: "Pax" },
  { key: "last_name", label: "Last Name" },
  { key: "first_name", label: "First Name" },
  { key: "notes", label: "Special Requirements" },
];

/** West Rim 的列序（Annie 10-29，后端 20 转）：没有 ✓ 列。 */
const WEST_COLUMNS: Column[] = [
  { key: "order_number", label: "Order #" },
  { key: "pickup_time", label: "Time" },
  { key: "pickup_location", label: "Hotel" },
  { key: "phone", label: "Phone" },
  { key: "last_name", label: "Last Name" },
  { key: "first_name", label: "First Name" },
  { key: "pax", label: "Pax" },
  { key: "ticket", label: "Quantities" },
  { key: "notes", label: "Special Requirements" },
];

/**
 * 这个版式的列（同后端 `version_columns()`）。排了餐厅的团（`lunch_column`）三个版式都出 Lunch，
 * 放在 Special Requirements 左边（Q19 A、Q26）。
 */
function columnsFor(version: ManifestVersion, lunch: boolean): Column[] {
  const cols = [
    ...(version === "lankun"
      ? LANKUN_COLUMNS
      : version === "west"
        ? WEST_COLUMNS
        : GENERAL_COLUMNS),
  ];
  if (lunch)
    cols.splice(
      cols.findIndex((c) => c.key === "notes"),
      0,
      { key: "lunch", label: "Lunch" },
    );
  return cols;
}

const VERSIONS: { value: ManifestVersion; label: string }[] = [
  { value: "general", label: "General" },
  { value: "lankun", label: "Lankun" },
  { value: "marcello", label: "Marcello" },
  { value: "west", label: "West Rim" },
];

function versionOf(data: ManifestData): ManifestVersion {
  const v = data.tour.manifest_version;
  return v === "lankun" || v === "marcello" || v === "west" ? v : "general";
}

// 样子照旧后台 admin/tour_manifest.html（Annie 2026-10-07：和旧版一模一样）。
/** .mf-nav a.back */
const NAV_LINK =
  "inline-flex h-7 items-center rounded-lg border border-[rgba(147,197,253,.35)] px-[11px] text-[13px] text-[#93c5fd] no-underline hover:bg-white/[.07]";
/** .mf-warn */
const WARN =
  "mb-3.5 rounded-[10px] border border-[rgba(251,191,36,.34)] bg-[rgba(251,191,36,.10)] px-3.5 py-2.5 text-[13px] text-[#fde68a]";
/** .mf-card */
const CARD =
  "mb-[22px] overflow-hidden rounded-[10px] bg-paper px-3 pt-2.5 pb-3 font-[Arial,'Helvetica_Neue',Helvetica,sans-serif] text-[#111]";
/** .mf-band a.print */
const BAND_LINK =
  "inline-flex h-7 items-center rounded-[7px] border border-black/25 bg-paper px-3 text-[12px] font-bold text-[#111] no-underline";
/** .mf-card th / td。客人表的字号 / 粗细照纸本（G198 Q1：正文 16.5px 粗体、人数 19px），每格由 `cellText()` 给。 */
const TH =
  "border border-[#9aa] bg-[#e6eaee] px-1.5 py-1 text-left text-[9.5px] font-bold whitespace-nowrap";
const TD =
  "border border-[#c8ced2] px-[7px] py-[3px] align-middle whitespace-nowrap";
/** 名字、酒店、票型：太长就在格里换行，不截断（定 8）；单号、时间、电话、人数、餐不折行。 */
const WRAP_TD =
  "border border-[#c8ced2] px-[7px] py-[3px] align-middle whitespace-normal [overflow-wrap:anywhere]";
/** 取消 / 改期那一块照旧的小字（不是车上的名单）。 */
const TD_SMALL = cn(TD, "text-[13.5px]");

/** 合计行照纸本改名（G198 Q9）；后端打印 / Excel 那边由后端改。 */
const FOOTER_LABEL: Record<string, string> = {
  "BUS SEATS LEFT": "AVAILABLE SEATS LEFT",
  "BUS SEATS USED": "SEATS USED",
  "NO LUNCH (INCL. SHUTTLE)": "No Lunch (including shuttle)",
};

/**
 * 一个团、一天的 manifest，照纸本版式（同旧页面 /admin/dispatch/manifest）。
 * 车来自排车页已保存的排车，客人从主 Manifest 同步（G35，打开排车页时）。
 */
export function ManifestView() {
  const [params, setParams] = useState<{ date: string; tour: number } | null>(
    null,
  );
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  // 整页 Save（Annie 2026-10-29「缓存，然后等整页存」）：版式、字号、换车、黄框都先放在这里。
  const [pending, setPending] = useState<Pending>(EMPTY_PENDING);
  const [saveState, setSaveState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved"; at: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  /** 有没存的改动时按 Print / Download：先问「Save before printing?」（Q3）。 */
  const [saveFirst, setSaveFirst] = useState<{
    action: MismatchAction;
    ordersOf: (d: ManifestData) => ManifestLunchMismatch[];
    go: () => void;
  } | null>(null);
  /** 离开页面时的三个键（Save / Don't save / Cancel）；resolve(true) = 走。 */
  const [leaveAsk, setLeaveAsk] = useState<{
    resolve: (leave: boolean) => void;
  } | null>(null);
  const [mismatch, setMismatch] = useState<{
    action: MismatchAction;
    orders: ManifestLunchMismatch[];
    go: () => void;
  } | null>(null);
  const downloadRef = useRef<HTMLFormElement>(null);
  const redirectingRef = useRef(false);
  const router = useRouter();
  // partner 只看：不换车、不改备注 / 景点，导游页不出。
  // 打印：后端打印页只要 dispatch.view（G208，Annie：partner 也能打印 manifest），partner 勾了就出。
  // Download 后端只给员工（require_staff），partner 一律不出（Annie 10-27「A 不能下载」）。
  const perms = usePermissions();
  const viewOnly = perms.partnerLacks("manifests.edit");
  const canPrint = !viewOnly || !perms.partnerLacks("dispatch.view");
  const canDownload = !perms.isPartner;

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const date = q.get("date");
    const tour = Number(q.get("tour"));
    if (!isYmd(date) || !Number.isInteger(tour) || tour <= 0) {
      setView({ kind: "bad-link" });
      return;
    }
    setParams({ date, tour });
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!params) return;
      try {
        const data = await fetchManifest(params.date, params.tour, signal);
        if (!signal?.aborted) setView({ kind: "ready", data });
      } catch (error) {
        if (signal?.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setView({ kind: "forbidden" });
        else setView({ kind: "error", message: describeError(error) });
      }
    },
    [params, redirectToLogin],
  );

  useEffect(() => {
    if (!params) return;
    const controller = new AbortController();
    setView((v) => (v.kind === "ready" ? v : { kind: "loading" }));
    void load(controller.signal);
    return () => controller.abort();
  }, [params, reloadKey, load]);

  function onActionError(error: unknown) {
    if (isStatus(error, 401)) redirectToLogin();
    else setActionError(describeError(error));
  }

  /** 改 Special Requirements：存好再重读；存失败时错误显示在上面，抛出去让格子留着。 */
  async function changeNotes(guest: ManifestGuest, notes: string | null) {
    setActionError(null);
    try {
      await saveGuestNotes(guest.id, notes);
    } catch (error) {
      onActionError(error);
      throw error;
    }
    if (!params) return;
    try {
      const data = await fetchManifest(params.date, params.tour);
      setView({ kind: "ready", data });
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else
        setActionError(
          `The note was saved, but the page could not be refreshed: ${describeError(error)} Reload the page.`,
        );
    }
  }

  const data = view.kind === "ready" ? view.data : null;
  const dirty = !viewOnly && isDirty(pending);

  /** 换车（Q4 改了：没存之前就在页面上挪到新车）。换回库里那辆 = 没改。 */
  function stageMove(guest: ManifestGuest, label: string) {
    if (!data) return;
    const saved = savedBusOf(data).get(guest.id) ?? "";
    setPending((p) => {
      const moves = { ...p.moves };
      if (label === saved) delete moves[guest.id];
      else moves[guest.id] = label;
      return { ...p, moves };
    });
    setSaveState({ kind: "idle" });
  }

  /** 版式下拉：只在页面上照新版式画，整页 Save 才存成这个团的（定 22：谁打开都一样）。 */
  function stageVersion(version: ManifestVersion) {
    if (!data) return;
    setPending((p) => ({
      ...p,
      version: version === versionOf(data) ? null : version,
    }));
    setSaveState({ kind: "idle" });
  }

  /** Aa Text size 框按 Done（Q2）：调好的字号留在页面上；和库里一样 = 没改。 */
  function stageTextSize(busKey: string, textSize: ManifestTextSize) {
    if (!data) return;
    const saved = data.blocks.find((b) => b.bus_key === busKey)?.text_size;
    setPending((p) => {
      const textSizes = { ...p.textSizes };
      if (JSON.stringify(textSize) === JSON.stringify(saved))
        delete textSizes[busKey];
      else textSizes[busKey] = textSize;
      return { ...p, textSizes };
    });
    setSaveState({ kind: "idle" });
  }

  /** 黄框（Q5 并进整页 Save）：和库里一样 = 没改。 */
  function stageAttraction(
    busKey: string,
    section: ManifestSection,
    values: AttrValues,
  ) {
    const initial = section.attraction;
    const same =
      !!initial &&
      (Object.keys(values) as (keyof AttrValues)[]).every(
        (k) => values[k].trim() === (initial[k] ?? "").trim(),
      );
    setPending((p) => {
      const attractions = { ...p.attractions };
      const key = attrKey(busKey, section.key);
      if (same) delete attractions[key];
      else
        attractions[key] = {
          busKey,
          section: section.key,
          title: section.title,
          values,
        };
      return { ...p, attractions };
    });
    setSaveState({ kind: "idle" });
  }

  /**
   * 整页 Save：照现有接口依次存（版式 → 每辆车的字号 → 每位换车的客人 → 每个黄框），不加批量接口。
   * 存上的拿掉；没存上的留着（继续标琥珀色），红字写哪几样、后端原话。最后重读一次。
   * 返回没存上的原因（全部存上 = null）和重读到的数据（打印前要用新的餐不符名单）。
   */
  async function savePending(): Promise<{
    error: string | null;
    data: ManifestData | null;
  }> {
    if (!params || !data) return { error: null, data };
    setSaveState({ kind: "saving" });
    setActionError(null);
    const next: Pending = {
      version: pending.version,
      textSizes: { ...pending.textSizes },
      moves: { ...pending.moves },
      attractions: { ...pending.attractions },
    };
    const fails: string[] = [];
    let unauthorized = false;
    const attempt = async (what: string, run: () => Promise<unknown>) => {
      if (unauthorized) return false;
      try {
        await run();
        return true;
      } catch (error) {
        if (isStatus(error, 401)) unauthorized = true;
        else fails.push(`${what}: ${describeError(error)}`);
        return false;
      }
    };
    if (next.version) {
      const v = next.version;
      if (await attempt("Version", () => saveManifestVersion(params.tour, v)))
        next.version = null;
    }
    for (const [busKey, textSize] of Object.entries(pending.textSizes)) {
      const bus = data.blocks.find((b) => b.bus_key === busKey);
      if (
        data.manifest &&
        (await attempt(`Text size on Bus ${bus?.bus_number ?? busKey}`, () =>
          saveTextSize({
            tourManifestId: data.manifest!.id,
            busKey,
            textSize,
          }),
        ))
      )
        delete next.textSizes[busKey];
    }
    const orders = new Map<number, string>();
    for (const b of data.blocks)
      for (const sec of b.sections)
        for (const g of sec.guests) orders.set(g.id, g.order_number);
    for (const sec of data.unplaced.sections)
      for (const g of sec.guests) orders.set(g.id, g.order_number);
    for (const [id, label] of Object.entries(pending.moves)) {
      if (
        await attempt(`Bus for ${orders.get(Number(id)) ?? id}`, () =>
          setGuestBus(Number(id), label || null),
        )
      )
        delete next.moves[Number(id)];
    }
    for (const [key, a] of Object.entries(pending.attractions)) {
      if (
        data.manifest &&
        (await attempt(`${a.title} confirmation box`, () =>
          saveAttraction({
            tourManifestId: data.manifest!.id,
            busKey: a.busKey,
            section: a.section,
            ...a.values,
          }),
        ))
      )
        delete next.attractions[key];
    }
    if (unauthorized) {
      redirectToLogin();
      return { error: "Signed out.", data: null };
    }
    setPending(next);
    let fresh: ManifestData | null = null;
    try {
      fresh = await fetchManifest(params.date, params.tour);
      setView({ kind: "ready", data: fresh });
    } catch (error) {
      if (isStatus(error, 401)) redirectToLogin();
      else
        setActionError(
          `Saved, but the page could not be refreshed: ${describeError(error)} Reload the page.`,
        );
    }
    if (fails.length) {
      const total =
        (pending.version ? 1 : 0) +
        Object.keys(pending.textSizes).length +
        Object.keys(pending.moves).length +
        Object.keys(pending.attractions).length;
      const message = `Could not save: ${fails.join("; ")}. ${fails.length < total ? "The rest was saved. " : ""}What was not saved is still marked; click Save to try again.`;
      setSaveState({ kind: "error", message });
      return { error: message, data: fresh };
    }
    setSaveState({
      kind: "saved",
      at: new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }),
    });
    return { error: null, data: fresh };
  }

  // 有没存的改动时离开页面：拦下来问 Save / Don't save / Cancel（关标签 / 刷新是浏览器自己的提示）。
  useLeaveGuard(
    dirty,
    "You have unsaved changes on this Bus Manifest. Leave without saving?",
    () => new Promise<boolean>((resolve) => setLeaveAsk({ resolve })),
  );

  /**
   * 打印 / 下载前：有餐不符的单就先弹提醒（定 12 / Q21），staff 按「… anyway」才继续；没有就直接做。
   * 返回 true = 已拦下（调用方要 preventDefault）。
   */
  function guardMismatch(
    action: MismatchAction,
    orders: ManifestLunchMismatch[],
    go: () => void,
  ): boolean {
    if (!orders.length) return false;
    setMismatch({ action, orders, go });
    return true;
  }

  /**
   * 打印 / 下载：有没存的改动先问要不要存（Q3；打印页和 Excel 都按库里已存的出）；
   * 没有就照旧看餐不符。返回 true = 拦下了。ordersOf 从（存好后重读的）数据里取餐不符的单。
   */
  function guardOutput(
    action: MismatchAction,
    ordersOf: (d: ManifestData) => ManifestLunchMismatch[],
    go: () => void,
  ): boolean {
    if (dirty) {
      setSaveFirst({ action, ordersOf, go });
      return true;
    }
    return data ? guardMismatch(action, ordersOf(data), go) : false;
  }
  const allOrders = (d: ManifestData) =>
    d.blocks.flatMap((b) => b.lunch_mismatch_orders ?? []);
  const busOrders = (busKey: string) => (d: ManifestData) =>
    d.blocks.find((b) => b.bus_key === busKey)?.lunch_mismatch_orders ?? [];

  /** 页面上画的样子 = 库里的 + 没存的版式 / 换车。 */
  const shown = data
    ? applyMoves(
        pending.version
          ? {
              ...data,
              tour: { ...data.tour, manifest_version: pending.version },
            }
          : data,
        pending.moves,
      )
    : null;
  const savedBus = data ? savedBusOf(data) : new Map<number, string>();
  const movedFrom = new Map(
    Object.keys(pending.moves).map((id) => [
      Number(id),
      savedBus.get(Number(id)) ?? "",
    ]),
  );
  const summary =
    data && dirty
      ? pendingSummary(
          pending,
          data,
          (v) => VERSIONS.find((x) => x.value === v)?.label ?? v,
          versionOf(data),
        )
      : [];
  const backHref = params ? `/dispatch?date=${params.date}` : "/dispatch";

  return (
    <ViewOnly.Provider value={viewOnly}>
      <main className="text-stone-800">
        <div>
          {/* 后端 G29 第 5 条（2026-10-05）：‹ Back 回到点进来的那一页（排车页回去还是那一天、原来的位置）；
            直接打开的 ⇒ 去排车页的这一天。Dispatch · <日子> 不管从哪来都打开排车页的这一天。 */}
          <nav aria-label="Back" className="flex flex-wrap gap-2">
            <Link
              href={backHref}
              onClick={(e) => {
                if (!hasInAppHistory()) return;
                e.preventDefault();
                router.back();
              }}
              className={NAV_LINK}
            >
              ‹ Back
            </Link>
            <Link href={backHref} className={NAV_LINK}>
              {params ? `Dispatch · ${fmtShort(params.date)}` : "Dispatch"}
            </Link>
          </nav>

          {view.kind === "bad-link" ? (
            <div className={cn(WARN, "mt-3.5")}>
              <p className="font-medium">
                This link is missing the day or the tour.
              </p>
              <p className="mt-1">
                Open the manifest from{" "}
                <PageLink href="/dispatch" className="text-[#93c5fd] underline">
                  Dispatch
                </PageLink>
                .
              </p>
            </div>
          ) : view.kind === "forbidden" ? (
            <p className="mt-3.5 text-[13px] text-[#94a3b8]">
              Staff access required
            </p>
          ) : view.kind === "error" ? (
            <div className="mt-3.5">
              <ErrorBanner
                actionLabel="Retry"
                onAction={() => setReloadKey((k) => k + 1)}
              >
                Could not load this manifest: {view.message}
              </ErrorBanner>
            </div>
          ) : view.kind === "loading" || !data || !shown || !params ? (
            <p className="py-10 text-center text-[13px] text-[#94a3b8]">
              Loading…
            </p>
          ) : (
            <>
              {/* .mf-head：标题和返回键在左、Print all / Download 在右 */}
              <header className="mt-1 mb-3.5 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="m-0 flex items-center gap-2.5 text-[24px] font-bold tracking-[-.02em] text-white">
                    {/* 团色（同 Main manifest / Dispatch，Annie 2026-10-14）。 */}
                    <span
                      aria-hidden
                      className="size-3.5 rounded-[4px]"
                      style={{ background: tourColorFor(data.tour.name) }}
                    />
                    {data.tour.name}
                  </h1>
                  <p className="mt-1 text-[13px] text-[#94a3b8]">
                    {data.date_label} ·{" "}
                    {data.manifest
                      ? `${ourOrders(data)} orders, ${ourPax(data)} pax · ${data.manifest.file_name}`
                      : "no guests yet"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* 整页 Save（Q1）：蓝色提交键，工具条最前面、Version 左边；没有改动时灰的。 */}
                  {viewOnly ? null : (
                    <button
                      type="button"
                      data-page-save
                      disabled={!dirty || saveState.kind === "saving"}
                      onClick={() => void savePending()}
                      className="inline-flex h-8 cursor-pointer items-center rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-[18px] text-[12.5px] font-semibold text-white disabled:cursor-default disabled:opacity-40"
                    >
                      {saveState.kind === "saving" ? "Saving…" : "Save"}
                    </button>
                  )}
                  {data.tour.manifest_version !== undefined ? (
                    <VersionPicker
                      version={versionOf(shown)}
                      readOnly={viewOnly}
                      unsaved={pending.version !== null}
                      onChange={stageVersion}
                    />
                  ) : null}
                  {canPrint && data.manifest && data.blocks.length > 0 ? (
                    <a
                      href={manifestPrintUrl(params.date, params.tour)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => {
                        const url = e.currentTarget.href;
                        if (
                          guardOutput("print", allOrders, () =>
                            window.open(url, "_blank", "noopener,noreferrer"),
                          )
                        )
                          e.preventDefault();
                      }}
                      className="inline-flex h-8 items-center rounded-[9px] border border-[#3b82f6] bg-[#3b82f6] px-[15px] text-[12.5px] font-semibold text-white no-underline"
                    >
                      Print all buses
                    </a>
                  ) : null}
                  {viewOnly || !canDownload ? null : (
                    <form
                      ref={downloadRef}
                      method="post"
                      action={MANIFEST_DOWNLOAD_URL}
                      className="m-0"
                      onSubmit={(e) => {
                        // form.submit() 不会再触发 onSubmit，所以「Download anyway」直接交。
                        if (
                          guardOutput("download", allOrders, () =>
                            downloadRef.current?.submit(),
                          )
                        )
                          e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="date" value={params.date} />
                      <input type="hidden" name="tour" value={params.tour} />
                      <button
                        type="submit"
                        disabled={!data.manifest}
                        className="inline-flex h-8 cursor-pointer items-center rounded-[9px] border border-white/[.18] bg-transparent px-[13px] text-[12.5px] text-[#cbd5e1] hover:bg-white/[.07] disabled:cursor-default disabled:opacity-50"
                      >
                        Download
                      </button>
                    </form>
                  )}
                  {/* 存好绿、失败红、有没存的琥珀色（全站规矩）。 */}
                  {viewOnly ? null : saveState.kind === "error" ? (
                    <span
                      role="alert"
                      data-page-save-error
                      className="basis-full text-right text-[12.5px] font-semibold text-[#fca5a5]"
                    >
                      {saveState.message}
                    </span>
                  ) : dirty ? (
                    <span
                      data-page-unsaved
                      className="basis-full text-right text-[12.5px] font-semibold text-[#fcd34d]"
                    >
                      Not saved yet: {summary.join(" · ")}. Click Save to keep
                      {summary.length === 1 ? " it" : " them"}.
                    </span>
                  ) : saveState.kind === "saved" ? (
                    <span
                      role="status"
                      data-page-saved
                      className="basis-full text-right text-[12.5px] font-semibold text-[#4ade80]"
                    >
                      ✓ Saved · {saveState.at}
                    </span>
                  ) : null}
                </div>
              </header>

              {!data.manifest ? (
                <Warn>
                  The main manifest has no orders for this tour on this day. An
                  order whose product has no Group is not on any tour: set its
                  Group in Settings → Products.
                </Warn>
              ) : null}
              {data.mode === "none" ? (
                <Warn>
                  No bus is scheduled for this tour on this day yet. Add one on
                  the Dispatch page.
                </Warn>
              ) : data.mode === "unlettered" ? (
                <Warn>
                  This tour has more than one bus, but not every bus has its own
                  letter. Give each bus a letter (A, B ...) on the Dispatch
                  page. Until then no guest can be put on a bus.
                </Warn>
              ) : null}

              {actionError ? (
                // .mf-err
                <div
                  role="alert"
                  className="mb-3.5 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[rgba(239,68,68,.35)] bg-[rgba(239,68,68,.12)] px-3.5 py-2.5 text-[13px] text-[#fecaca]"
                >
                  <span>{actionError}</span>
                  <button
                    type="button"
                    onClick={() => setActionError(null)}
                    className="text-[12px] text-[#fecaca] underline"
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}

              <Stage.Provider
                value={{
                  movedFrom,
                  attractions: pending.attractions,
                  stageAttraction,
                  failed: saveState.kind === "error",
                }}
              >
                {shown.blocks.map((block) => (
                  <BusCard
                    key={block.bus.id}
                    data={shown}
                    params={params}
                    block={block}
                    viewOnly={viewOnly}
                    canPrint={canPrint}
                    onBusChange={stageMove}
                    onNotesChange={changeNotes}
                    onActionError={onActionError}
                    stagedTextSize={pending.textSizes[block.bus_key]}
                    onStageTextSize={(ts) => stageTextSize(block.bus_key, ts)}
                    onPrintGuard={(go) =>
                      guardOutput("print", busOrders(block.bus_key), go)
                    }
                  />
                ))}

                {shown.unplaced.sections.length > 0 ? (
                  <section aria-label="Not on a bus yet" className={CARD}>
                    {/* 旧页同样是一个 .mf-card + 团色条，标题写 Not on a bus yet。 */}
                    <div
                      className="flex flex-wrap items-end gap-[22px] rounded-[3px] px-3 py-1.5"
                      style={{ background: data.tour.band_color }}
                    >
                      <span className="text-[26px] font-extrabold">
                        Not on a bus yet · {data.unplaced.totals.pax} pax
                      </span>
                      <span className="ml-auto text-[19px] font-bold">
                        {data.date_label}
                      </span>
                    </div>
                    <GuestTable
                      data={shown}
                      sections={shown.unplaced.sections}
                      onBusChange={stageMove}
                      onNotesChange={changeNotes}
                      attraction={null}
                    />
                  </section>
                ) : null}
              </Stage.Provider>

              {data.affiliate ? (
                <AffiliateCard affiliate={data.affiliate} />
              ) : null}

              {data.gone?.length ? <GoneCard gone={data.gone} /> : null}

              {viewOnly ? null : <HowToUse />}
              {saveFirst ? (
                <SaveFirstDialog
                  action={saveFirst.action}
                  items={summary}
                  onCancel={() => setSaveFirst(null)}
                  onConfirm={async () => {
                    const r = await savePending();
                    if (r.error) return r.error;
                    const { action, ordersOf, go } = saveFirst;
                    setSaveFirst(null);
                    // 存好了：照新的数据看餐不符，没有就直接打开 / 下载。
                    if (!guardMismatch(action, ordersOf(r.data ?? data), go))
                      go();
                    return null;
                  }}
                />
              ) : null}
              {leaveAsk ? (
                <LeaveDialog
                  items={summary}
                  onCancel={() => {
                    leaveAsk.resolve(false);
                    setLeaveAsk(null);
                  }}
                  onDiscard={() => {
                    leaveAsk.resolve(true);
                    setLeaveAsk(null);
                  }}
                  onSave={async () => {
                    const r = await savePending();
                    if (r.error) return r.error;
                    leaveAsk.resolve(true);
                    setLeaveAsk(null);
                    return null;
                  }}
                />
              ) : null}
              {mismatch ? (
                <LunchMismatchDialog
                  action={mismatch.action}
                  dateLabel={data.date_label}
                  orders={mismatch.orders}
                  onCancel={() => setMismatch(null)}
                  onConfirm={() => {
                    const { go } = mismatch;
                    setMismatch(null);
                    go();
                  }}
                />
              ) : null}
            </>
          )}
        </div>
      </main>
    </ViewOnly.Provider>
  );
}

/**
 * G65 只增不删：Rezdy 取消、改到别的日期 / 团的单留在名单上，单独一组、0 人、写原因（Annie 2026-10-13 定）。
 * 不在任何车上、不算总数，打印 / Excel / 司机 / 导游页都没有它们（后端管）。
 */
function GoneCard({ gone }: { gone: ManifestGoneGuest[] }) {
  return (
    <section aria-label="Cancelled or moved" data-gone className={CARD}>
      <div className="flex flex-wrap items-end gap-[22px] rounded-[3px] bg-[#d6d3cc] px-3 py-1.5">
        <span className="text-[22px] font-extrabold">
          Cancelled / moved · {gone.length} order{gone.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto text-[13px] font-bold">
          0 pax — not counted, not printed
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="mt-1.5 w-full min-w-[980px] border-collapse">
          <thead>
            <tr>
              {[
                "Order Number",
                "Pick-up Time",
                "Pick-up Location",
                "Name",
                "Product",
                "Was on bus",
                "#",
                "Why",
              ].map((c) => (
                <th key={c} className={TH}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gone.map((g) => (
              <tr
                key={g.id}
                data-gone-row={g.order_number}
                className="text-[#57534e]"
              >
                <td className="border border-[#c8ced2] px-[7px] py-[3px] align-middle font-['Courier_New',monospace] text-[13px] whitespace-nowrap line-through">
                  {g.order_number}
                </td>
                <td className={TD_SMALL}>{g.pickup_time}</td>
                <td className={TD_SMALL}>{g.pickup_location}</td>
                <td className={TD_SMALL}>{g.name}</td>
                <td className={TD_SMALL}>{g.product}</td>
                <td className={TD_SMALL}>{g.bus_label || "—"}</td>
                <td className="border border-[#c8ced2] px-[7px] py-[3px] text-center align-middle text-[15px] font-extrabold whitespace-nowrap">
                  0
                  <span className="ml-1 text-[11px] font-normal">
                    (was {g.was_pax})
                  </span>
                </td>
                <td
                  className={cn(
                    TD_SMALL,
                    "font-bold",
                    g.sync_status === "cancelled"
                      ? "text-[#b3261e]"
                      : "text-[#1d4ed8]",
                  )}
                >
                  {g.sync_note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * 一台车的 Bus Manifest（色条 + 名单 + 合计行），后面接这台车的午餐表（G198）。
 * G197 字号编辑：后端带了 `text_size` 才出「Aa Text size」键（上线前看不到）；partner 只读，看得到存好的样子、没有键。
 */
function BusCard({
  data,
  params,
  block,
  viewOnly,
  canPrint,
  onBusChange,
  onNotesChange,
  onActionError,
  stagedTextSize,
  onStageTextSize,
  onPrintGuard,
}: {
  data: ManifestData;
  params: { date: string; tour: number };
  block: ManifestBlock;
  viewOnly: boolean;
  /** 这一车的 Print 键（partner 勾了 dispatch.view 也有，见上面 canPrint）。 */
  canPrint: boolean;
  onBusChange: (guest: ManifestGuest, label: string) => void;
  onNotesChange: (guest: ManifestGuest, notes: string | null) => Promise<void>;
  onActionError: (e: unknown) => void;
  /** 按了 Done、还没整页 Save 的字号（Q2）。 */
  stagedTextSize: ManifestTextSize | undefined;
  onStageTextSize: (textSize: ManifestTextSize) => void;
  /** 有没存的改动先问要不要存，再看这一车的餐不符；返回 true = 拦下了。 */
  onPrintGuard: (go: () => void) => boolean;
}) {
  const phone = usePhoneWidth();
  const version = versionOf(data);
  const columns = columnsFor(version, !!data.tour.lunch_column);
  const saved = block.text_size;
  const canEdit = !viewOnly && saved !== undefined;
  const [draft, setDraft] = useState<ManifestTextSize | null>(null);
  const [mode, setMode] = useState<TextMode>("column");
  const [picks, setPicks] = useState<TextPick[]>([]);
  const editing = draft !== null;
  /** 页面上现在的字号：按了 Done 没存的，否则库里的。 */
  const current = stagedTextSize ?? saved;

  function close() {
    setDraft(null);
    setPicks([]);
  }
  /** Done（Q2）：收起这一排，调好的留在页面上，跟整页 Save 一起存。 */
  function done() {
    if (draft) onStageTextSize(draft);
    close();
  }

  const names = new Map<string, string>();
  for (const s of block.sections)
    for (const g of s.guests) names.set(g.order_number, g.name);
  const pickedLabel = picks
    .map((p) =>
      p.kind === "page"
        ? "the whole page"
        : p.kind === "column"
          ? `column “${columns.find((c) => c.key === p.id)?.label ?? p.id}”`
          : `row ${names.get(p.id) ?? p.id}`,
    )
    .join(", ");
  const currentLayer = draft && picks.length ? layerOf(draft, picks[0]) : {};

  return (
    <>
      <section aria-label={`Bus ${block.bus_number}`} className={CARD}>
        {/* .mf-band */}
        <div
          className="flex flex-wrap items-end gap-[22px] rounded-[3px] px-3 py-1.5"
          style={{ background: data.tour.band_color }}
        >
          <span className="text-[26px] font-extrabold">{data.tour.name}</span>
          <Person label="Driver" value={block.bus.driver} />
          <Person label="Guide" value={block.bus.guide} />
          <span className="ml-auto text-[19px] font-bold">
            {data.date_label}
          </span>
          <span className="text-[19px] font-extrabold">
            BUS #: {block.bus_number}
          </span>
          {data.manifest && canPrint ? (
            <a
              href={manifestPrintUrl(params.date, params.tour, block.bus.id)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                const url = e.currentTarget.href;
                if (
                  onPrintGuard(() =>
                    window.open(url, "_blank", "noopener,noreferrer"),
                  )
                )
                  e.preventDefault();
              }}
              className={BAND_LINK}
            >
              Print
            </a>
          ) : null}
          {/* 导游看到的样子（导游还没账号时 staff 从这里看，同旧页面）：后端渲染的页面，新标签页打开。 */}
          {viewOnly ? null : (
            <a
              href={manifestGuideUrl(block.bus.id)}
              target="_blank"
              rel="noopener noreferrer"
              className={BAND_LINK}
            >
              Guide view
            </a>
          )}
          {canEdit ? (
            <button
              type="button"
              data-text-size-button
              aria-pressed={editing}
              onClick={() =>
                editing
                  ? close()
                  : (setDraft(current ?? null), setMode("column"))
              }
              className={cn(
                BAND_LINK,
                "cursor-pointer",
                editing && "border-[#111] shadow-[inset_0_0_0_1px_#111]",
              )}
            >
              {editing ? "Close text size" : "Aa Text size"}
            </button>
          ) : null}
          {stagedTextSize && !editing ? (
            <span data-text-size-unsaved className={UNSAVED_TAG}>
              Text size not saved
            </span>
          ) : null}
        </div>
        {!viewOnly && block.text_size_history ? (
          <TextSizeHistory history={block.text_size_history} />
        ) : null}
        {editing ? (
          <TextSizeToolbar
            mode={mode}
            onMode={(m) => {
              setMode(m);
              setPicks(m === "page" ? [{ kind: "page" }] : []);
            }}
            picks={picks}
            pickedLabel={pickedLabel}
            current={currentLayer}
            onStep={(n) =>
              setDraft((d) =>
                d
                  ? updateLayers(d, picks, (l) => ({ ...l, d: (l.d ?? 0) + n }))
                  : d,
              )
            }
            onBold={(bold) =>
              setDraft((d) =>
                d ? updateLayers(d, picks, (l) => ({ ...l, bold })) : d,
              )
            }
            onResetSelection={() =>
              setDraft((d) => (d ? updateLayers(d, picks, () => ({})) : d))
            }
            onResetAll={() => setDraft(EMPTY_TEXT_SIZE)}
            onCancel={close}
            onDone={done}
          />
        ) : null}
        <GuestTable
          data={data}
          sections={block.sections}
          onBusChange={onBusChange}
          onNotesChange={onNotesChange}
          textSize={draft ?? current}
          phone={phone}
          edit={
            editing
              ? {
                  mode,
                  picks,
                  onPick: (p) => {
                    if (mode !== "page") setPicks((cur) => togglePick(cur, p));
                  },
                }
              : null
          }
          attraction={
            data.manifest
              ? {
                  tourManifestId: data.manifest.id,
                  busKey: block.bus_key,
                  onError: onActionError,
                }
              : null
          }
        />
        <Footer
          cells={block.footer}
          sandwich={block.restaurant?.totals ?? null}
          big={version === "marcello"}
        />
        {block.restaurant ? (
          <RestaurantBlock
            restaurant={block.restaurant}
            busNumber={block.bus_number}
          />
        ) : null}
      </section>
      {/* Lankun 不另印午餐单，餐厅信息在合计下面（定 19）；General / Marcello 照旧（Q31）。 */}
      {block.lunch && version !== "lankun" ? (
        <LunchSheet
          lunch={block.lunch}
          dateLabel={data.date_label}
          block={block}
          tourSections={block.sections}
        />
      ) : null}
    </>
  );
}

/**
 * 版式下拉（定 22 选 B）：在 Print / Download 旁边，选了马上存成这个团的，谁打开都一样。
 * 不用蓝色（蓝色只给提交键）。只读的人（partner）只看到文字。
 */
function VersionPicker({
  version,
  readOnly,
  unsaved,
  onChange,
}: {
  version: ManifestVersion;
  readOnly: boolean;
  /** 选了还没整页 Save（琥珀色框 + Unsaved）。 */
  unsaved: boolean;
  onChange: (v: ManifestVersion) => void;
}) {
  const label = VERSIONS.find((v) => v.value === version)?.label ?? version;
  if (readOnly)
    return (
      <span data-version-text className="text-[12.5px] text-[#cbd5e1]">
        Version: {label}
      </span>
    );
  return (
    <label
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-[9px] border pr-1 pl-[11px] text-[12.5px] text-[#cbd5e1]",
        unsaved ? "border-[#f59e0b]" : "border-white/[.18]",
      )}
    >
      Version:
      <select
        data-version-select
        aria-label="Bus Manifest version"
        value={version}
        onChange={(e) => onChange(e.target.value as ManifestVersion)}
        className="h-6 cursor-pointer rounded-md border-0 bg-transparent px-1 text-[12.5px] font-semibold text-white disabled:opacity-50 [&>option]:text-[#111]"
      >
        {VERSIONS.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
      {unsaved ? (
        <span
          data-version-unsaved
          className="pr-1.5 text-[11px] font-bold text-[#fcd34d]"
        >
          Unsaved
        </span>
      ) : null}
    </label>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return <p className={WARN}>{children}</p>;
}

function Person({ label, value }: { label: string; value: string }) {
  return (
    // .mf-band .kv：小字标签在上、斜体名字在下
    <span className="flex flex-col">
      <span className="text-[10px] opacity-75">{label}:</span>
      <span className="text-[19px] font-bold italic">{value || "—"}</span>
    </span>
  );
}

const SHUTTLE_WORD: Record<string, string> = {
  outbound: "OUTBOUND",
  inbound: "INBOUND",
};

function sectionColor(data: ManifestData, s: ManifestSection): string {
  if (s.color) return s.color;
  if (s.kind === "tour") return data.tour.section_color;
  return data.shuttle_colors[s.kind];
}

/** G197 编辑中：现在选的是哪种、选了哪些，点表格时回调。 */
interface TextEdit {
  mode: TextMode;
  picks: TextPick[];
  onPick: (p: TextPick) => void;
}

/** 一格的字号 / 粗细（G197）+ 编辑时的选中框和改过的橙线。 */
interface CellFont {
  style: (col: ManifestColumnKey, order: string | null) => CSSProperties;
  edit: (
    col: ManifestColumnKey,
    order: string | null,
  ) => {
    className: string;
    onClick?: () => void;
  };
}

function GuestTable({
  data,
  sections,
  onBusChange,
  onNotesChange,
  attraction,
  textSize,
  phone = false,
  edit = null,
}: {
  data: ManifestData;
  sections: ManifestSection[];
  onBusChange: (guest: ManifestGuest, label: string) => void;
  onNotesChange: (guest: ManifestGuest, notes: string | null) => Promise<void>;
  /** 有车、有 manifest 时才有黄框。 */
  attraction: {
    tourManifestId: number;
    busKey: string;
    onError: (e: unknown) => void;
  } | null;
  /** G197 存好的（或编辑中的）字号；没有 = 纸本默认。 */
  textSize?: ManifestTextSize;
  phone?: boolean;
  edit?: TextEdit | null;
}) {
  const lettered = data.mode === "lettered";
  const version = versionOf(data);
  const columns = columnsFor(version, !!data.tour.lunch_column);
  // ✓（司机标的上车）：Lankun（定 5）和 West Rim 不要这一列。
  const boarding = version !== "lankun" && version !== "west";
  const cols = columns.length + (lettered ? 1 : 0) + (boarding ? 1 : 0);
  const th = { fontSize: `${HEAD_PX[version].th}px` };
  if (sections.length === 0) {
    return (
      <p className="px-1 py-3.5 text-[13px] text-[#1a1a1a]">
        No guests on this bus yet.
      </p>
    );
  }
  const font: CellFont = {
    style: (col, order) => {
      const t = cellText(textSize, col, order, phone, version);
      return { fontSize: t.fontSize, fontWeight: t.fontWeight };
    },
    edit: (col, order) => {
      if (!edit) return { className: "" };
      const selected =
        isPicked(edit.picks, "page") ||
        isPicked(edit.picks, "column", col) ||
        (order !== null && isPicked(edit.picks, "row", order));
      const changed = cellText(textSize, col, order, false, version).changed;
      return {
        className: cn(editCellClass(selected, changed), "cursor-pointer"),
        onClick: () =>
          edit.onPick(
            edit.mode === "row" && order !== null
              ? { kind: "row", id: order }
              : { kind: "column", id: col },
          ),
      };
    },
  };
  return (
    <div className="overflow-x-auto">
      <table
        className={cn(
          "mt-1.5 w-full min-w-[980px] border-collapse",
          edit &&
            isPicked(edit.picks, "page") &&
            "outline-2 outline-offset-2 outline-[#2563eb]",
        )}
      >
        <thead>
          <tr>
            {columns.map(({ key, label }) => {
              const picked = !!edit && isPicked(edit.picks, "column", key);
              return (
                <th
                  key={key}
                  data-col={key}
                  style={th}
                  className={cn(
                    TH,
                    key === "lunch" && "text-center",
                    edit && "cursor-pointer",
                    picked && "outline-2 -outline-offset-2 outline-[#2563eb]",
                  )}
                  onClick={
                    edit && edit.mode === "column"
                      ? () => edit.onPick({ kind: "column", id: key })
                      : undefined
                  }
                >
                  {label}
                </th>
              );
            })}
            {lettered ? (
              <th className={TH} style={th}>
                Bus
              </th>
            ) : null}
            {boarding ? (
              <th className={TH} style={th}>
                ✓
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {sections.map((s) => (
            <SectionRows
              key={s.key}
              data={data}
              section={s}
              columns={columns}
              cols={cols}
              lettered={lettered}
              boarding={boarding}
              sectionPx={HEAD_PX[version].section}
              onBusChange={onBusChange}
              onNotesChange={onNotesChange}
              attraction={attraction}
              font={font}
              editing={!!edit}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 酒店隔组标色（G198 Q2 A，Annie「198全按推荐」）：同一家连着的算一组，第一组不标、第二组标、第三组不标……，
 * 标的那组只标第一行。比的是 Pick-up Location 原文（去空格、不分大小写）。只给 tour 节。
 */
function hotelMarks(guests: ManifestGuest[]): boolean[] {
  const out = guests.map(() => false);
  let group = -1;
  let prev: string | null = null;
  guests.forEach((g, i) => {
    const h = g.pickup_location.trim().toLowerCase();
    if (h !== prev) {
      group += 1;
      prev = h;
      if (group % 2 === 1) out[i] = true;
    }
  });
  return out;
}

/**
 * 节标题（G198 Q4 / Q11 / Q12）。开了 Cfm # 格的 tour 节（`show_cfm`）用后端拼好的 `heading`（就是打印版，
 * 「UPPER 12:40P (CHECK-IN 12:10P) - 18 PAX · CFM # 4471」，缺的部分后端不写），check-in 那段小一号；
 * 网页上另外照字段画灰字：没号「· CFM # —」、没设时间「No tour time …」，这两样打印都不印。
 * 没开格的 tour 节写「节名 - N PAX」；Shuttle 节照后端的标题。
 */
function SectionHeading({ section: s }: { section: ManifestSection }) {
  if (s.kind !== "tour") return <>{s.heading}</>;
  if (!s.show_cfm) return <>{`${s.title} - ${s.pax} PAX`}</>;
  const m = /^(.*?)( \(CHECK-IN [^)]*\))(.*)$/.exec(s.heading);
  return (
    <>
      {m ? (
        <>
          {m[1]}
          <span data-checkin className="text-[.8em] font-bold">
            {m[2]}
          </span>
          {m[3]}
        </>
      ) : (
        s.heading
      )}
      {!s.cfm_no ? (
        <span data-no-cfm className="text-[#6b7280] print:hidden">
          {" "}
          · CFM # —
        </span>
      ) : null}
      {!s.tour_time ? (
        <span
          data-no-tour-time
          className="ml-2 text-[11px] font-normal text-[#4b5563] print:hidden"
        >
          No tour time in Bus Manifest setup (Max allotments)
        </span>
      ) : null}
    </>
  );
}

/**
 * Special Requirements 一格（Annie 2026-10-18「special requirment 那里改成可以编辑，带进来的内容也可以删除或者编辑」）：
 * 点格子改；清空再 Save = 删除；Cancel 不存；改过的格子有 edited 小标记，Reset to Rezdy 恢复原文。
 * 后端没带 `notes_edited`（编辑接口还没上线）时这一格只读，样子和以前一样。
 */
function NotesCell({
  guest: g,
  onSave,
  font,
  editing: textEditing,
}: {
  guest: ManifestGuest;
  onSave: (guest: ManifestGuest, notes: string | null) => Promise<void>;
  font: CellFont;
  /** G197 字号编辑中：点格子是选中，不打开备注编辑。 */
  editing: boolean;
}) {
  const viewOnly = useViewOnly();
  const editable = !viewOnly && !textEditing && g.notes_edited !== undefined;
  const textEdit = font.edit("notes", g.order_number);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(next: string | null) {
    setBusy(true);
    try {
      await onSave(g, next);
      setEditing(false);
    } catch {
      /* 错误已经显示在页面上方，格子留着让 staff 再试 */
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <td
        data-notes-editor
        className="min-w-[240px] border border-[#c8ced2] bg-white px-[5px] py-1 align-top"
      >
        <textarea
          autoFocus
          aria-label="Special Requirements"
          value={value}
          maxLength={2000}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          className="min-h-[46px] w-full resize-y rounded border border-[#888] px-1.5 py-[3px] font-[Arial,sans-serif] text-[13px] font-normal text-[#111]"
        />
        <div className="mt-1 flex items-center gap-1.5">
          <button
            type="button"
            data-notes-save
            disabled={busy}
            onClick={() => void save(value.trim())}
            className="cursor-pointer rounded-[5px] bg-[#3b82f6] px-[9px] py-0.5 text-[11px] font-bold text-white disabled:opacity-60"
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(false)}
            className="cursor-pointer rounded-[5px] border border-[#888] bg-white px-[9px] py-0.5 text-[11px] font-bold text-[#333] disabled:opacity-60"
          >
            Cancel
          </button>
          {g.notes_edited ? (
            <button
              type="button"
              data-notes-reset
              disabled={busy}
              onClick={() => void save(null)}
              className="ml-auto cursor-pointer text-[11px] text-[#1d4ed8] underline disabled:opacity-60"
            >
              Reset to Rezdy
            </button>
          ) : null}
        </div>
      </td>
    );
  }

  return (
    <td
      data-notes-cell
      onClick={
        textEditing
          ? textEdit.onClick
          : editable
            ? () => {
                setValue(g.notes);
                setEditing(true);
              }
            : undefined
      }
      style={font.style("notes", g.order_number)}
      className={cn(
        "border border-[#c8ced2] px-[7px] py-[3px] align-middle",
        textEdit.className,
        g.notes && "bg-[#fff200]",
        g.notes_check
          ? "min-w-[220px] whitespace-pre-wrap text-[#d00000]"
          : "whitespace-nowrap",
        editable && "cursor-text",
      )}
      title={
        g.notes_check
          ? "Sandwiches could not be read: this is the full Rezdy text. Check the booking."
          : editable
            ? "Click to edit"
            : undefined
      }
    >
      {g.notes}
      {g.notes_edited ? (
        <span
          data-notes-edited
          className="ml-1.5 rounded-full bg-[#fed7aa] px-1.5 text-[10px] font-bold text-[#7c2d12]"
        >
          edited
        </span>
      ) : null}
    </td>
  );
}

/**
 * Lunch 格（定 6 / 定 21）：一格里 B / T / V 三个固定位置，0 份留空，竖着对齐；没点餐 / 读不出写「-」（Q28）。
 * 餐份数和 Pax 对不上（`lunch_mismatch`）整格红字浅红底（定 9 / Q28），只在屏幕上，纸上不印红（Q17）。
 */
function LunchCell({
  guest: g,
  font,
}: {
  guest: ManifestGuest;
  font: CellFont;
}) {
  const e = font.edit("lunch", g.order_number);
  return (
    <td
      data-lunch-cell
      data-mismatch={g.lunch_mismatch || undefined}
      onClick={e.onClick}
      style={font.style("lunch", g.order_number)}
      className={cn(
        TD,
        "border-x-2 border-x-[#444] text-center",
        g.lunch_mismatch && "bg-[#ffe1e1] text-[#c00000]",
        e.className,
      )}
    >
      {g.lunch_slots ? (
        <span className="inline-grid grid-cols-[repeat(3,2.6em)] gap-x-0.5 text-left align-middle">
          {g.lunch_slots.map((x, i) => (
            <span key={i}>{x}</span>
          ))}
        </span>
      ) : (
        "-"
      )}
    </td>
  );
}

function SectionRows({
  data,
  section: s,
  columns,
  cols,
  lettered,
  boarding,
  sectionPx,
  onBusChange,
  onNotesChange,
  attraction,
  font,
  editing,
}: {
  data: ManifestData;
  section: ManifestSection;
  columns: Column[];
  cols: number;
  lettered: boolean;
  /** 出不出 ✓ 列（Lankun 不出）。 */
  boarding: boolean;
  /** 节标题字号（Marcello 放大）。 */
  sectionPx: number;
  onBusChange: (guest: ManifestGuest, label: string) => void;
  onNotesChange: (guest: ManifestGuest, notes: string | null) => Promise<void>;
  attraction: {
    tourManifestId: number;
    busKey: string;
    onError: (e: unknown) => void;
  } | null;
  font: CellFont;
  editing: boolean;
}) {
  const color = sectionColor(data, s);
  const marks = s.kind === "tour" ? hotelMarks(s.guests) : [];
  /** 一格的 className / style / 点击（字号来自 G197，编辑时可点选）。 */
  const cell = (col: ManifestColumnKey, g: ManifestGuest, className = TD) => {
    const e = font.edit(col, g.order_number);
    return {
      className: cn(className, e.className),
      style: font.style(col, g.order_number),
      onClick: e.onClick,
    };
  };
  return (
    <>
      <tr>
        <td
          colSpan={cols}
          className={cn(TD, "text-center font-extrabold")}
          style={{ background: color, fontSize: `${sectionPx}px` }}
        >
          <SectionHeading section={s} />
        </td>
      </tr>
      {s.guests.map((g, i) => (
        <tr
          key={g.id}
          data-guest={g.order_number}
          // Extra 客人（Heli 这类 combo 产品）整行标色（后端 bus-manifest-extras ad8b7ab，同旧 tour_manifest.html / 打印页）。
          style={
            g.extra && data.extra_row_color
              ? { background: data.extra_row_color }
              : undefined
          }
        >
          {columns.map(({ key }) => {
            switch (key) {
              case "order_number":
                // 纸本：单号同正文一样的大号粗体（G198 Q1），不再用等宽小字。
                return (
                  <td key={key} {...cell("order_number", g)}>
                    {g.order_number}
                    {/* G65：主 Manifest 里找不到、原因不明的单：人数照算，橙字提醒去 Rezdy 查。 */}
                    {g.sync_status === "missing" ? (
                      <div
                        data-sync-missing
                        className="font-[Arial,sans-serif] text-[11px] font-bold text-[#c2410c]"
                      >
                        {g.sync_note || "Not in main manifest — check Rezdy"}
                      </div>
                    ) : null}
                  </td>
                );
              case "pickup_time":
                // 去掉 AM / PM（定 3）：只改显示，排序照原值。
                return (
                  <td key={key} {...cell("pickup_time", g)}>
                    {g.pickup_time_short ?? g.pickup_time}
                  </td>
                );
              case "pickup_location": {
                // 酒店简称（定 7）；隔组标色照旧按订单原文比。名字长的在格里换行（定 8）。
                const c = cell("pickup_location", g, WRAP_TD);
                return (
                  <td
                    key={key}
                    {...c}
                    data-hotel-mark={marks[i] || undefined}
                    title={
                      g.hotel_short && g.hotel_short !== g.pickup_location
                        ? g.pickup_location
                        : undefined
                    }
                    style={
                      marks[i] ? { ...c.style, background: color } : c.style
                    }
                  >
                    {g.hotel_short ?? g.pickup_location}
                  </td>
                );
              }
              case "last_name":
              case "first_name":
                return (
                  <td key={key} {...cell(key, g, WRAP_TD)}>
                    {g[key]}
                  </td>
                );
              case "phone":
                return (
                  <td key={key} {...cell("phone", g)}>
                    {g.phone}
                  </td>
                );
              case "pax":
                return (
                  <td key={key} {...cell("pax", g, cn(TD, "text-center"))}>
                    {g.pax}
                  </td>
                );
              case "ticket":
                return (
                  <td
                    key={key}
                    {...cell(
                      "ticket",
                      g,
                      cn(WRAP_TD, g.ticket_hl && "bg-[#fff200]"),
                    )}
                  >
                    {g.ticket}
                    {s.kind !== "tour" &&
                    !g.ticket.toUpperCase().includes(SHUTTLE_WORD[s.kind]) ? (
                      <b className="font-extrabold text-[#d00000]">
                        {" "}
                        {SHUTTLE_WORD[s.kind]}
                      </b>
                    ) : null}
                  </td>
                );
              case "lunch":
                return <LunchCell key={key} guest={g} font={font} />;
              case "notes":
                return (
                  <NotesCell
                    key={key}
                    guest={g}
                    onSave={onNotesChange}
                    font={font}
                    editing={editing}
                  />
                );
              default:
                return null;
            }
          })}
          {lettered ? (
            <td className={TD}>
              <BusSelect
                guest={g}
                labels={data.bus_labels}
                onChange={onBusChange}
              />
            </td>
          ) : null}
          {boarding ? (
            <td className={TD}>
              {g.boarding === "boarded" ? (
                <span className="rounded-full bg-[#e6f4ec] px-[7px] py-px text-[11px] font-bold whitespace-nowrap text-[#1e6b43]">
                  ✓
                </span>
              ) : g.boarding === "no_show" ? (
                <span className="rounded-full bg-[#fdeceb] px-[7px] py-px text-[11px] font-bold whitespace-nowrap text-[#b3261e]">
                  No show
                </span>
              ) : null}
            </td>
          ) : null}
        </tr>
      ))}
      {/* G198：开了 Cfm # 格的组（tour.confirm_box = false）整团不画黄框，号和时间在节标题里（Annie「把下面的cfm的小表去掉」）；其他团照旧。 */}
      {attraction &&
      s.kind === "tour" &&
      s.attraction &&
      data.tour.confirm_box !== false ? (
        <tr>
          <td colSpan={cols} className="border-0 px-0 py-0.5">
            <AttractionBox
              section={s}
              color={color}
              tourManifestId={attraction.tourManifestId}
              busKey={attraction.busKey}
              onError={attraction.onError}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function BusSelect({
  guest,
  labels,
  onChange,
}: {
  guest: ManifestGuest;
  labels: string[];
  onChange: (guest: ManifestGuest, label: string) => void;
}) {
  const viewOnly = useViewOnly();
  const { movedFrom } = useStage();
  const value = guest.bus_label ?? "";
  const unset = !value || !labels.includes(value);
  const moved = movedFrom.has(guest.id);
  if (viewOnly)
    return (
      <span data-bus-text className="text-[12px] text-[#111]">
        {value || "—"}
      </span>
    );
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <select
        aria-label={`Bus for ${guest.name}`}
        value={value}
        // 换车先放在页面上（客人马上挪到新车），整页 Save 才存（Q4）。
        onChange={(e) => onChange(guest, e.target.value)}
        className={cn(
          // .mf-card select.bus（.unset 橙框）
          "h-[26px] rounded-md px-1 font-[inherit] text-[12px] text-[#111]",
          moved
            ? cn("border border-[#f59e0b] bg-[#fffbeb]", UNSAVED_RING)
            : unset
              ? "border border-[#e0a63a] bg-[#fffaf0]"
              : "border-[0.5px] border-black/25 bg-paper",
        )}
      >
        <option value="">—</option>
        {value && !labels.includes(value) ? (
          <option value={value}>{value}</option>
        ) : null}
        {labels.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      {moved ? (
        <span data-moved-from className={UNSAVED_TAG}>
          from {movedFrom.get(guest.id) || "no bus"} · not saved
        </span>
      ) : null}
    </span>
  );
}

const ATTR_FIELDS = [
  ["checkin_time", "Check-in Time"],
  ["pax_text", "# of Pax"],
  ["tour_time", "Tour Time"],
  ["confirmation_no", "Confirmation"],
] as const;

/** 黄框（Q5 并进整页 Save）：改了先放在页面上，标琥珀色；整页 Save 才存。 */
function AttractionBox({
  section,
  color,
  busKey,
}: {
  section: ManifestSection;
  color: string;
  tourManifestId: number;
  busKey: string;
  onError: (e: unknown) => void;
}) {
  const viewOnly = useViewOnly();
  const { attractions, stageAttraction } = useStage();
  const initial = section.attraction!;
  const staged = attractions[attrKey(busKey, section.key)];
  const values: AttrValues = staged?.values ?? {
    checkin_time: initial.checkin_time,
    pax_text: initial.pax_text,
    tour_time: initial.tour_time,
    confirmation_no: initial.confirmation_no,
  };

  return (
    <div
      role="group"
      aria-label={`${section.title} Confirmation Information`}
      data-attr-unsaved={staged ? true : undefined}
      // .mf-attr：旧页只在节有自己的颜色时才换底色，否则是黄色 #fff27a。
      className={cn(
        "my-0.5 grid max-w-[820px] grid-cols-[repeat(auto-fit,minmax(140px,1fr))] items-end gap-x-3 gap-y-1.5 rounded border border-[#c9b200] bg-[#fff27a] px-2.5 py-1.5",
        staged && UNSAVED_RING,
      )}
      style={section.color ? { background: color } : undefined}
    >
      <div className="col-span-full text-[11px] font-extrabold">
        {section.title} Confirmation Information
        {staged ? (
          <span className={cn(UNSAVED_TAG, "ml-2")}>not saved</span>
        ) : null}
      </div>
      {ATTR_FIELDS.map(([k, label]) => (
        <label
          key={k}
          className="flex flex-col gap-0.5 text-[10.5px] font-bold"
        >
          {label}
          <input
            value={values[k]}
            readOnly={viewOnly}
            maxLength={ATTR_LEN[k]}
            onChange={(e) =>
              stageAttraction(busKey, section, {
                ...values,
                [k]: e.target.value,
              })
            }
            className="h-7 rounded-[5px] border-[0.5px] border-black/30 bg-paper px-2 font-[inherit] text-[13px] font-normal text-[#111]"
          />
        </label>
      ))}
    </div>
  );
}

/**
 * Lankun 合计一排下面的餐厅块（定 19 / Q30）：只放店名、Contact 两行（亮黄，同午餐单页脚）、这车 B / T / V 合计。
 * 照后端打印模板的 .rest。
 */
function RestaurantBlock({
  restaurant: r,
  busNumber,
}: {
  restaurant: ManifestRestaurant;
  busNumber: string;
}) {
  const t = r.totals;
  return (
    <div
      data-restaurant
      className="mt-2 max-w-[560px] border-2 border-[#444] text-[13px]"
    >
      <div className="flex justify-between gap-3 bg-[#fff200] px-2 py-[3px] text-[14px] font-extrabold">
        <span>{r.title || r.name}</span>
        <span>Bus {busNumber}</span>
      </div>
      {r.footer_lines.length ? (
        <div className="border-t border-[#444] bg-[#ffff00] px-2 py-1 text-center leading-[1.35] font-extrabold">
          {r.footer_lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      ) : null}
      <div
        data-restaurant-totals
        className="border-t border-[#444] px-2 py-[3px] font-bold [word-spacing:2px]"
      >
        This bus: <b>{t.total}</b> = {t.beef} B &nbsp;{t.turkey} T &nbsp;
        {t.veggie} V
      </div>
    </div>
  );
}

function Footer({
  cells,
  sandwich = null,
  big = false,
}: {
  cells: ManifestFooterCell[];
  /** Lankun：合计一排最后加 TOTAL SANDWICH（定 18，读不出的按 Turkey 算，后端算好）。 */
  sandwich?: ManifestRestaurant["totals"] | null;
  /** Marcello：合计一排的数字一起放大（Q24）。 */
  big?: boolean;
}) {
  if (!cells.length) return null;
  return (
    // .mf-foot：一排连在一起的格子
    <div className="mt-2.5 flex overflow-x-auto border border-[#9aa]">
      {cells.map((c) => (
        <div
          key={c.label}
          className="flex min-w-[92px] flex-[1_1_0] flex-col items-center border-r border-[#9aa] last:border-r-0"
        >
          <span
            className={cn(
              "flex h-8 w-full items-center justify-center px-[3px] py-0.5 text-center text-[11px] leading-[1.2] font-extrabold text-[#222] uppercase",
              c.custom ? "bg-[#ddd0f0]" : "bg-[#c9d3dc]",
            )}
          >
            {FOOTER_LABEL[c.label] ?? c.label}
          </span>
          <span
            className={cn(
              "py-[3px] font-extrabold",
              big ? "text-[27px]" : "text-[22px]",
            )}
          >
            {c.value ?? "—"}
          </span>
        </div>
      ))}
      {sandwich ? (
        <div
          data-total-sandwich
          className="flex min-w-[150px] flex-[2.2_1_0] flex-col items-center border-l-2 border-[#444]"
        >
          <span className="flex h-8 w-full items-center justify-center bg-[#fff200] px-[3px] py-0.5 text-center text-[11px] leading-[1.2] font-extrabold text-[#222] uppercase">
            TOTAL SANDWICH
          </span>
          <span className="py-[3px] text-[17px] font-extrabold whitespace-nowrap">
            <b className="mr-1.5 text-[22px]">{sandwich.total}</b>={" "}
            {sandwich.beef} B &nbsp;{sandwich.turkey} T &nbsp;{sandwich.veggie}{" "}
            V
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * G198：每台车 Bus Manifest 后面的 Bee's 午餐表，照打印模板（后端 tour_manifest_print.html 的 .lpage）：
 * 日期黄条在上、下面一行「NPE Lunch Box - 店名」（Annie「日期在上，餐厅信息在下」，不挪位置）；
 * 列头写各口味总数；没写口味默认 Turkey 整行标黄；读不准的 Notes 红字原文；
 * 底部黄字提示、Bus # / Tour Guide / Driver 一行（Annie「把下面小表的3行信息改成一行」）、亮黄两行页脚。
 * 字号同 Bus Manifest 默认（G198 Q13 A），不跟 A− / A+。节标题 = 节名 + Tour time + 人数（Q14）。只看，不能改。
 */
function LunchSheet({
  lunch,
  dateLabel,
  block,
  tourSections,
}: {
  lunch: ManifestLunch;
  dateLabel: string;
  block: ManifestBlock;
  tourSections: ManifestSection[];
}) {
  const LTD =
    "border border-[#c8ced2] px-1.5 leading-6 text-[16.5px] font-bold whitespace-nowrap";
  const N = cn(LTD, "w-[72px] text-center text-[17px]");
  const t = lunch.totals;
  return (
    <section
      aria-label={`Lunch ${block.bus_number}`}
      data-lunch
      className={cn(CARD, "max-w-[820px]")}
    >
      <div className="bg-[#fff27a] p-1.5 text-center text-[24px] font-extrabold">
        {dateLabel}
      </div>
      <div className="mt-0.5 mb-1.5 text-center text-[12px] text-[#333]">
        {lunch.title ||
          `NPE Lunch Box${lunch.vendor ? ` - ${lunch.vendor}` : ""}`}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse">
          <thead>
            <tr>
              <th className={cn(TH, "text-center whitespace-normal")}>
                Lead Guest Name
              </th>
              <th className={cn(TH, "text-center whitespace-normal")}>
                Number of Passengers
              </th>
              {(
                [
                  [t.turkey, "Turkey"],
                  [t.veggie, "Veggie"],
                  [t.beef, "Roast Beef"],
                ] as const
              ).map(([n, label]) => (
                <th key={label} className={cn(TH, "text-center")}>
                  {n}
                  <br />
                  {label}
                </th>
              ))}
              <th className={cn(TH, "text-center")}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {lunch.sections.map((s) => {
              // 后端的 title 已拼好（「LOWER 1P - 12 PAX」）：按节名开头找这一节的颜色，名字长的先配（VIP LOWER 不配到 LOWER）。
              const color = [...tourSections]
                .sort((a, b) => b.title.length - a.title.length)
                .find(
                  (x) =>
                    s.title === x.title || s.title.startsWith(`${x.title} `),
                )?.color;
              return (
                <Fragment key={s.title}>
                  <tr>
                    <td
                      colSpan={6}
                      className={cn(
                        LTD,
                        "text-center text-[17px] font-extrabold",
                      )}
                      style={color ? { background: color } : undefined}
                    >
                      {s.title}
                    </td>
                  </tr>
                  {s.rows.map((r, i) => (
                    <tr
                      key={`${r.name}-${i}`}
                      data-lunch-row={r.name}
                      className={r.defaulted ? "bg-[#fff200]" : undefined}
                    >
                      <td className={LTD}>{r.name}</td>
                      <td className={N}>{r.pax}</td>
                      <td className={N}>{r.turkey}</td>
                      <td className={N}>{r.veggie}</td>
                      <td className={N}>{r.beef}</td>
                      <td
                        className={cn(
                          "border border-[#c8ced2] px-1.5",
                          r.check_text &&
                            "w-[240px] text-[11px] leading-[13px] font-bold whitespace-normal text-[#d00000]",
                        )}
                      >
                        {r.check_text || ""}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            <tr className="bg-[#dfe5ea]">
              <td className={LTD} />
              <td className={cn(N, "font-extrabold")}>{t.pax}</td>
              <td className={cn(N, "font-extrabold")}>{t.turkey}</td>
              <td className={cn(N, "font-extrabold")}>{t.veggie}</td>
              <td className={cn(N, "font-extrabold")}>{t.beef}</td>
              <td className="border border-[#c8ced2]" />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="my-2 text-center text-[12px] font-bold">
        ALL GUESTS HIGHLIGHTED IN YELLOW WILL BE RECEIVING A TURKEY SANDWICH NO
        EXCEPTIONS.
      </p>
      <table data-lunch-info className="border-collapse">
        <tbody>
          <tr>
            {(
              [
                ["Bus #", block.bus_number],
                ["Tour Guide", block.bus.guide || "—"],
                ["Driver", block.bus.driver || "—"],
              ] as const
            ).flatMap(([k, v]) => [
              <td
                key={k}
                className="border border-[#999] px-2.5 py-[3px] text-[15px]"
              >
                {k}
              </td>,
              <td
                key={`${k}-v`}
                className="border border-[#999] px-2.5 py-[3px] text-[15px]"
              >
                {v}
              </td>,
            ])}
          </tr>
        </tbody>
      </table>
      {lunch.note ? (
        <div
          data-lunch-note
          className="mt-2.5 bg-[#ffff00] px-1.5 py-1 text-center text-[14px] leading-[1.45] font-bold whitespace-pre-line"
        >
          {lunch.note}
        </div>
      ) : null}
    </section>
  );
}

function HowToUse() {
  return (
    // .howto-d（旧页的蓝框，默认收起）
    <details className="group mt-6 mb-8 max-w-[760px] rounded-[10px] border border-[#b5d4f4] bg-[#e8f3fc] px-5 py-3 text-[12px] leading-[1.9] text-[#0c3a6b]">
      <summary className="cursor-pointer font-semibold text-[#185FA5] group-open:mb-1.5">
        📖 How to use — Tour manifest
      </summary>
      <ol className="list-decimal pl-[18px]">
        <li>
          This page shows one tour for one day, laid out like the paper
          manifest. Each bus on the Dispatch schedule gets its own block.
        </li>
        <li>
          Changes to the Version, text size, a guest&rsquo;s bus and the yellow
          boxes stay on the page, marked orange, until you click Save at the
          top. Saved turns green; anything that could not be saved stays orange
          with the reason in red. If you print, download or leave the page
          first, it asks whether to save.
        </li>
        <li>
          If the tour has two or more buses, pick a bus for every guest in the
          Bus column; the guest moves to that bus right away (not saved until
          you click Save). Guests without a bus are marked orange and listed
          under Not on a bus yet.
        </li>
        <li>
          Fill in the yellow box under a section (Check-in time, # of Pax, Tour
          time, Confirmation), then click Save at the top. Only sections with
          something filled in print a yellow box.
        </li>
        <li>
          Red text under Special Requirements means the sandwiches could not be
          read, so the full Rezdy text is shown. Check the booking in Rezdy and
          tell the lunch place.
        </li>
        <li>
          Version (next to Print all buses): General, Lankun, Marcello or West
          Rim. When you click Save it is saved for this tour, so everyone who
          opens it gets the same one, on screen, when printed and in Excel.
          Hotel names use the first Alias in Settings → Pickup Locations, and
          times have no AM / PM.
        </li>
        <li>
          Tours with a lunch place have a Lunch column (B = Beef, T = Turkey, V
          = Veggie). A red Lunch cell means the sandwiches don&rsquo;t add up to
          the pax, or could not be read (-). Before you print or download, the
          page lists these bookings; check them, or print / download anyway.
        </li>
        <li>
          Click Print on a bus (or Print all buses), then Print in the new tab.
          It prints on A4 landscape and goes onto more pages when needed. The
          lunch sheet prints after it for tours that have one. Guests not on a
          bus yet are not printed; the print tab says how many.
        </li>
        <li>Click Download for an Excel copy with the same columns.</li>
        <li>
          Sections, colours and Extras come from Settings → Products (Bus
          Manifest setup). A guest on an Extra (for example Heli) has the whole
          row coloured, and each Extra has its own SEATS LEFT box at the bottom.
          Seats come from Settings → Vehicles.
        </li>
        <li>
          Back returns to the page you came from. The Dispatch button opens
          Dispatch on this manifest&rsquo;s day.
        </li>
        <li>
          The guest list comes from the main manifest and updates each time
          Dispatch is opened. To change it, change the order in Rezdy.
        </li>
        <li>
          Orders are never taken off the list by an update. An order cancelled
          in Rezdy, or moved to another day or tour, moves to Cancelled / moved
          at the bottom with 0 pax and the reason; it is not counted, printed or
          downloaded, and drivers and guides don&rsquo;t see it. If it comes
          back in Rezdy, it returns to its bus by itself.
        </li>
        <li>
          Orange text under an order number (Not in main manifest — check Rezdy)
          means the order is gone from the main manifest but we can&rsquo;t tell
          why. Its guests still count. Check the order in Rezdy.
        </li>
      </ol>
    </details>
  );
}
