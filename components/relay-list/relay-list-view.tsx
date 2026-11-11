"use client";

import "./relay-list.css";

import {
  createContext,
  type CSSProperties,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner } from "@/components/ui/panel";
import { PageLink } from "@/components/ui/page-link";
import { LineIcon } from "@/components/dispatch-manifest/line-icons";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  downloadRelayListExcel,
  fetchRelayPull,
  type RelayGuest,
  type RelayPull,
} from "@/lib/dispatch-api";
import { isYmd } from "@/lib/la-date";
import {
  busBar,
  busLegend,
  busName,
  buildRound,
  hotelText,
  newGroup,
  RELAY_LIST_ROUNDS,
  type RelayCarSheet,
  type RelayRoundList,
  relayDates,
  tourText,
} from "@/lib/relay-list";
import {
  effectiveMargin,
  effectivePaper,
  fetchPrintLayout,
  type PrintLayoutResponse,
  type PrintLayoutSettings,
  resolveBox,
} from "@/lib/print-layout";
import {
  fetchRelayListSettings,
  orientationOf,
  type RelayListSettings,
} from "@/lib/relay-list-settings-api";
import { usePageVisibility } from "@/lib/page-visibility";
import { byTick } from "@/lib/permissions";
import { relayTextElements } from "@/components/print-layout/text-elements";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { usePermissions } from "@/lib/staff-permissions";

import {
  type AlsoRelayCar,
  RelaySettingsDialog,
} from "./relay-settings-dialog";
import {
  type RelayColumn,
  RelayTextContext,
  RelayTextSave,
  SheetTextBar,
  useRelayCellFont,
  useRelayPageDelta,
  useRelaySpacing,
  useRelayTextSize,
} from "./relay-text-size";
import { SheetFitMarks, SheetFitWarn, useSheetFit } from "./sheet-fit";

/** 版式设置（置顶 92）里画在单子上的：Hotel 格涂不涂车色。纸张 / 边距 / 表头色走 CSS 变量。 */
const RelayLookContext = createContext<{
  hotelCell: boolean;
  /** Hotel 格的颜色；null = 用车色（07）。 */
  hotelColor: string | null;
  /** 客人表正文现在的字号（每天的起点，置顶 92 第 2 批）：当天 Aa 加在它上面。 */
  summaryPx: number;
  carPx: number;
}>({ hotelCell: true, hotelColor: null, summaryPx: 12.5, carPx: 15 });

/** 纸张尺寸（mm，竖放）。 */
const PAPER_MM = { a4: [210, 297], letter: [215.9, 279.4] } as const;

/** 纸张是 Letter：打印的 @page 跟着换（竖 / 横两种命名页同 relay-list.css）。 */
const LETTER_PAGE =
  "@media print { @page { size: letter portrait; margin: 0; } @page rl-land { size: letter landscape; margin: 0; } }";

type ViewState =
  | { kind: "loading" }
  | { kind: "bad-link" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: RelayPull };

/** 返回键（置顶 114：页头左边「‹ Dispatch」，34px；手机 26px）。 */
const NAV_LINK =
  "inline-flex h-[34px] items-center gap-1.5 rounded-[9px] border border-[rgba(147,197,253,.35)] px-3 text-[13.5px] font-semibold text-[#93c5fd] no-underline hover:bg-white/[.07] max-sm:h-[26px] max-sm:rounded-[7px] max-sm:px-[9px] max-sm:text-[12.5px]";
/** 白底键（Print / Excel / ⚙ 不是提交键，不用蓝色；置顶 114 前面带线条图标）。 */
const WHITE_BTN =
  "inline-flex h-[34px] cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-black/25 bg-paper px-3.5 text-[13.5px] font-bold whitespace-nowrap text-[#111] max-sm:h-[34px] max-sm:px-2 max-sm:text-[13px]";

/**
 * Relay list：Dispatch › Morning Relay「📋 Relay list」打开（Annie：「排完relay并保存了以后，应该加一个按键显示这些relay的list」）。
 * 地址 `?date=YYYY-MM-DD`；带 `&car=<排车行 id>` = 只看 / 只印这一台（车头的 Print）。显示的是已保存的排车。
 * 一轮一张 RELAY SPLITS 总表 + 每台有客人的车一张，屏幕上看、按 Print 打印（A4，每张从新的一页开始）。
 * 每张单的方向、各车颜色由 staff 在「⚙ Colours & page」设（置顶 73），relay-pull 带回算好的 orientation / color。
 */
export function RelayListView() {
  const [params, setParams] = useState<{
    date: string;
    car: number | null;
  } | null>(null);
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);
  /**
   * 颜色和方向设置（置顶 73）：后端还没上线（404）/ 读不到 = null ⇒ 没有 ⚙ 键、没有 How to use，页面和以前一样。
   */
  const [settings, setSettings] = useState<RelayListSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  /** 版式设置（置顶 92 第 1 批）：后端没上线（404）= null，单子照旧。暂存的那份放这里，单子马上跟着变。 */
  const [layout, setLayout] = useState<PrintLayoutResponse | null>(null);
  const [layoutDraft, setLayoutDraft] = useState<PrintLayoutSettings | null>(
    null,
  );
  // 能改 = 能编辑 Dispatch（题 5 A；同 Dispatch 页：partner 只看，Super Admin 全给）。PUT 后端也按 dispatch.edit 挡。
  const perms = usePermissions();
  const isSuperAdmin = usePageVisibility().isSuperAdmin;
  const canEdit =
    !perms.partnerLacks("dispatch.edit") &&
    byTick(perms, "dispatch.edit", { superAdmin: isSuperAdmin });
  // ⬇ Excel 跟 Bus Manifest 的 Download 一样（后端 07：manifests.export）：要勾了导出，partner 一律没有（系统定过 partner 不能导出客人资料）。
  const canExcel =
    !perms.isPartner &&
    byTick(perms, "manifests.export", { superAdmin: isSuperAdmin });

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  // Relay Splits 当天字号（置顶 92 Q5 A）：接口没有 = 不出 Aa 键。
  const textState = useRelayTextSize(
    params?.date ?? null,
    canEdit,
    redirectToLogin,
    view.kind === "ready" ? view.data : null,
  );

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const date = q.get("date");
    const car = Number(q.get("car"));
    if (!isYmd(date)) {
      setView({ kind: "bad-link" });
      return;
    }
    setParams({ date, car: Number.isInteger(car) && car > 0 ? car : null });
  }, []);

  useEffect(() => {
    if (!params) return;
    let alive = true;
    setView({ kind: "loading" });
    fetchRelayPull(params.date)
      .then((data) => {
        if (alive) setView({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setView({ kind: "forbidden" });
        else setView({ kind: "error", message: describeError(error) });
      });
    return () => {
      alive = false;
    };
  }, [params, reloadKey, redirectToLogin]);

  useEffect(() => {
    if (!params) return;
    const ctrl = new AbortController();
    fetchPrintLayout("relay_list", ctrl.signal)
      .then(setLayout)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted && isStatus(e, 401)) redirectToLogin();
      });
    return () => ctrl.abort();
  }, [params, redirectToLogin]);

  // 带 ?date=：弹窗只列那天排车出现过 / 配过色的字母。
  useEffect(() => {
    if (!params) return;
    const ctrl = new AbortController();
    fetchRelayListSettings(params.date, ctrl.signal)
      .then((s) => setSettings(s))
      .catch(() => {
        if (!ctrl.signal.aborted) setSettings(null);
      });
    return () => ctrl.abort();
  }, [params]);

  /** 存好颜色 / 方向后：重读设置和 relay-pull（单子上的颜色、方向后端算），不闪 Loading。 */
  const afterSave = useCallback(async () => {
    setRefreshError(null);
    try {
      const [s, data] = await Promise.all([
        fetchRelayListSettings(params?.date),
        params ? fetchRelayPull(params.date) : Promise.resolve(null),
      ]);
      setSettings(s);
      if (data) setView({ kind: "ready", data });
    } catch (e) {
      setRefreshError(describeError(e));
    }
  }, [params]);

  const backHref = params ? `/dispatch?date=${params.date}` : "/dispatch";

  // 版式设置画到单子上（暂存的优先）：没设的全是现在的样子。
  const ls = layout ? (layoutDraft ?? layout.settings) : null;
  const paper = layout && ls ? effectivePaper(ls, layout.defaults) : "a4";
  const margin = layout && ls ? effectiveMargin(ls, layout.defaults) : null;
  const th =
    layout && ls
      ? resolveBox(ls, layout.defaults, "column_titles", null)
      : null;
  const hotelBox =
    layout && ls ? resolveBox(ls, layout.defaults, "hotel_cell", null) : null;
  const hotelCell = hotelBox ? hotelBox.on : true;
  const hotelColor = hotelBox?.color ?? null;
  const [pw, ph] = PAPER_MM[paper];
  const sheetVars = {
    ...(paper !== "a4" ? { "--rl-pw": `${pw}mm`, "--rl-ph": `${ph}mm` } : {}),
    ...(margin !== null ? { "--rl-pad": `${margin}mm` } : {}),
    ...(th
      ? { "--rl-th": th.on ? (th.color ?? "#d9d9d9") : "transparent" }
      : {}),
    ...(ls ? textVars(ls.text) : {}),
  } as CSSProperties;
  const summaryPx = 12.5 + (ls?.text.summary?.table_text?.d ?? 0);
  const carPx = 15 + (ls?.text.car?.table_text?.d ?? 0);

  // 横版单 297mm 宽（置顶 73）：max-w 放得下一整张。
  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 py-5 sm:px-6 print:max-w-none print:p-0">
      {/* 置顶 114 第 4 版（Annie「我要这个版式，我不要任何隐藏菜单，我要一目了然」，照参考图）：
          电脑一行「‹ Dispatch｜Colours, Text & Page｜● 未存黄字｜Save｜Print｜Excel｜⚙ Settings」；
          手机照图竖排：‹ Dispatch + Save → 标题 → 黄字 → Print / Excel / ⚙ Settings 一排，不收进 ⋯。
          「Colours, Text & Page」照图变成标题；原来打开设置的键改名「⚙ Settings」，一直看得见。 */}
      <div
        data-relay-header
        className="rl-screen-only mb-4 flex flex-wrap items-center gap-3 max-sm:gap-x-2 max-sm:gap-y-2"
      >
        <PageLink href={backHref} className={NAV_LINK}>
          ‹ Dispatch
        </PageLink>
        <h1
          data-relay-title
          className="m-0 inline-flex items-center gap-2 text-[22px] font-bold text-white max-sm:order-2 max-sm:basis-full max-sm:text-[18px]"
        >
          <span className="sm:hidden">
            <LineIcon name="gear" />
          </span>
          {layout ? "Colours, Text & Page" : "Colours & Page"}
        </h1>
        {/* 置顶 114 第 4 版（d8 定，Annie「不要任何隐藏菜单」）：手机上这句也摊开，不收进「i」。 */}
        <span
          data-relay-about
          className="order-last basis-full text-[12.5px] text-[#cbd5e1]"
        >
          Shows the saved Dispatch schedule. Changed something? Save it on
          Dispatch, then reload this page.
        </span>
        <span className="flex-1 max-sm:hidden" />
        {view.kind === "ready" ? (
          <RelayTextContext.Provider value={textState}>
            <RelayTextSave />
          </RelayTextContext.Provider>
        ) : null}
        {view.kind === "ready" ? (
          <div
            data-relay-actions
            className="contents max-sm:order-4 max-sm:grid max-sm:basis-full max-sm:grid-cols-3 max-sm:gap-2"
          >
            <button
              type="button"
              data-relay-print
              data-phone-keep
              onClick={() => window.print()}
              className={WHITE_BTN}
            >
              <LineIcon name="print" />
              Print
            </button>
            {params && canExcel ? (
              <ExcelButton
                date={params.date}
                car={params.car}
                onUnauthorized={redirectToLogin}
              />
            ) : null}
            {settings ? (
              <button
                type="button"
                data-relay-settings-open
                data-phone-keep
                onClick={() => setSettingsOpen(true)}
                className={WHITE_BTN}
              >
                <LineIcon name="gear" />
                Settings
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {paper === "letter" ? <style>{LETTER_PAGE}</style> : null}
      {refreshError ? (
        <div className="rl-screen-only mb-3">
          <ErrorBanner
            actionLabel="Reload"
            onAction={() => window.location.reload()}
          >
            Saved, but the sheets could not be reloaded: {refreshError}
          </ErrorBanner>
        </div>
      ) : null}
      {view.kind === "loading" ? (
        <p className="text-[13px] text-[#94a3b8]">Loading…</p>
      ) : view.kind === "bad-link" ? (
        <p className="text-[13px] text-[#cbd5e1]">
          This link is missing the date. Open the Relay list from Dispatch.
        </p>
      ) : view.kind === "forbidden" ? (
        <p className="text-[13px] text-[#cbd5e1]">
          You don&apos;t have access to Dispatch.
        </p>
      ) : view.kind === "error" ? (
        <ErrorBanner
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Could not load the relay list: {view.message}
        </ErrorBanner>
      ) : params ? (
        // A4 宽 210mm：手机上这一块自己左右滑，整页不晃（手机版规则）。
        <div
          className="overflow-x-auto print:overflow-visible"
          style={sheetVars}
        >
          <RelayLookContext.Provider
            value={{ hotelCell, hotelColor, summaryPx, carPx }}
          >
            <RelayTextContext.Provider value={textState}>
              <Sheets
                data={view.data}
                date={params.date}
                onlyCar={params.car}
              />
            </RelayTextContext.Provider>
          </RelayLookContext.Provider>
        </div>
      ) : null}
      {view.kind === "ready" && settings ? (
        <div className="rl-screen-only">
          <HowToUse
            dark
            title="How to use — Relay list"
            items={[
              ...HOW_TO,
              ...(layout ? [RELAY_LAYOUT_HOW_TO] : []),
              ...(textState.ready ? [RELAY_AA_HOW_TO] : []),
              ...RELAY_FIT_HOW_TO,
              ...(textState.spacingReady ? [RELAY_SPACING_HOW_TO] : []),
            ]}
          />
        </div>
      ) : null}
      {settingsOpen && settings && view.kind === "ready" ? (
        <RelaySettingsDialog
          settings={settings}
          canEdit={canEdit}
          {...todayTours(view.data)}
          layout={layout}
          layoutDraft={layoutDraft}
          onLayoutDraft={setLayoutDraft}
          onSaved={async () => {
            await afterSave();
            if (layout && layoutDraft)
              setLayout({ ...layout, settings: layoutDraft });
            setLayoutDraft(null);
          }}
          onClose={() => {
            setSettingsOpen(false);
            setLayoutDraft(null);
          }}
        />
      ) : null}
    </main>
  );
}

/** How to use（置顶 73 preview 第 5 节原文，题 1 A ⇒ 第 3 句写三处一起变）。 */
const HOW_TO = [
  "Press ⚙ Colours & page to choose the colour of each relay car and tour bus, and whether each sheet prints Portrait or Landscape.",
  "Colours and page directions are saved for everyone and apply to every day, not only the day you are looking at.",
  "A tour bus colour is also used for that bus on the driver page and on the Bus Manifest bus header.",
  'A bus letter without its own colour or direction uses the tour\'s "All buses" row.',
  "A relay car that is also a tour bus uses that bus's row, not a Relay number.",
  "Nothing is saved until you press Save. Reset puts one colour back to the paper colour; Reset to paper colours puts them all back (press Save after).",
  "Some older printers need Auto-rotate turned on in the print window to print Portrait and Landscape sheets together.",
];

/** 置顶 92 Q11 A 原文（第 1 批、Relay list 用得上的部分；字号那半句等第 2 批）。 */
const RELAY_LAYOUT_HOW_TO =
  "In ⚙ Colours, text & page you can also turn colouring on or off for the Hotel cell and the column titles, add or remove colour choices, set the everyday text size, and on the Page tab set the paper (A4 or Letter) and margins. Changes show on the sheet right away; press Save to keep them. Reset all to paper puts everything back. Saved settings are used on screen and when you print, for everyone and every day.";

/** 置顶 92 Q5 A；置顶 114 换成新键名（preview 第 3 版原文，Q2 A 加「Save stays grey…」）。 */
const RELAY_AA_HOW_TO =
  "Text size (the card above each sheet): under Apply To pick Column, Row or Page, click the table, then use Text Size (A− / A+) and Font Weight (Regular / Bold). The sheet changes right away; press Save at the top to keep it. Save stays grey until something is changed. Text size is saved for this day only and prints as you see it; the next day starts from the everyday size.";

/** 置顶 112 Spacing（Annie「用-+是最好，一目了然…不要让staff去判断px」）：一组 − / +，不提 px。 */
const RELAY_SPACING_HOW_TO =
  "Spacing (in the card above each sheet): press − for less space between rows and between hotels, + for more. The sheet changes right away. It is saved with the text size for this day only and prints as you see it. If the sheet no longer fits on one page, the space gets smaller by itself until it fits. Default Spacing (under Quick Actions) puts it back.";

/** 置顶 112（Annie「111， 112 全 A + 动手」）：Q3 定稿原文 + Q7 A 原文。 */
const RELAY_FIT_HOW_TO = [
  "If a sheet no longer fits on one page after you make the text bigger, the space between hotels and inside each row gets smaller by itself until the sheet fits. Your text size does not change. If the sheet still does not fit, a yellow note above it says how many pages it will print on; make the text smaller.",
  "If a sheet is too wide for the paper, the space inside each cell gets smaller and the sheet moves to the middle of the paper by itself. If it is still too wide, a yellow note above it says so; make the text smaller.",
];

/**
 * 「⬇ Excel」（置顶 92 Q8 A，Annie「记得要可以下载」「下载功能不用给i我preview了，直接上线」）：下载这一天的 Relay list，
 * 一张单一个工作表，后端生成（GET /api/dispatch/relay-list/excel）。白底次要键，放 ⚙ 左边；出错红字写原话，404 = 后端还没上。
 */
function ExcelButton({
  date,
  car,
  onUnauthorized,
}: {
  date: string;
  /** 页面带 &car=（车头的 Print）：只下载这一台车那张。 */
  car: number | null;
  onUnauthorized: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await downloadRelayListExcel(date, car);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      setError(
        isStatus(e, 404)
          ? "Excel download isn't available yet."
          : `Could not download: ${describeError(e)}`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        data-relay-excel
        data-phone-keep
        disabled={busy}
        onClick={() => void download()}
        className={`${WHITE_BTN} disabled:cursor-default disabled:opacity-60`}
      >
        <LineIcon name="download" />
        {busy ? "Downloading…" : "Excel"}
      </button>
      {error ? (
        <span
          role="alert"
          data-relay-excel-error
          className="text-[12.5px] font-semibold text-[#f87171]"
        >
          {error}
        </span>
      ) : null}
    </>
  );
}

/** 当天的团（设置弹窗默认只列这些）和「同时是团大巴的 relay 车」。 */
function todayTours(data: RelayPull): {
  todayTourIds: Set<number>;
  todayTourNames: Set<string>;
  alsoRelay: AlsoRelayCar[];
} {
  const ids = new Set<number>();
  const names = new Set<string>();
  const also: AlsoRelayCar[] = [];
  const seen = new Set<string>();
  for (const blocks of Object.values(data.rounds))
    for (const b of blocks) {
      for (const g of b.guests) {
        if (g.manifest_id != null) ids.add(g.manifest_id);
        if (g.bus?.tour) names.add(g.bus.tour);
      }
      for (const tb of b.car.tour_buses ?? []) {
        if (tb.manifest_id != null) ids.add(tb.manifest_id);
        names.add(tb.tour);
        const who = `${(b.car.driver || "No driver").trim()} - ${b.car.van || "No vehicle"}`;
        const k = `${tb.manifest_id}|${tb.tour}|${tb.label}|${who}`;
        if (seen.has(k)) continue;
        seen.add(k);
        also.push({
          manifestId: tb.manifest_id ?? null,
          tour: tb.tour,
          label: tb.label,
          who,
        });
      }
    }
  return { todayTourIds: ids, todayTourNames: names, alsoRelay: also };
}

function Sheets({
  data,
  date,
  onlyCar,
}: {
  data: RelayPull;
  date: string;
  onlyCar: number | null;
}) {
  const dates = relayDates(date);
  const rounds = RELAY_LIST_ROUNDS.map((r) => buildRound(data, r)).filter(
    (r): r is RelayRoundList => !!r && r.cars.length > 0,
  );
  if (onlyCar !== null) {
    const round = rounds.find((r) => r.cars.some((c) => c.carId === onlyCar));
    const car = round?.cars.find((c) => c.carId === onlyCar);
    return car && round ? (
      <CarSheet car={car} dateShort={dates.short} />
    ) : (
      <p className="text-[13px] text-[#cbd5e1]">
        This car is not on the saved Morning Relay for this day.
      </p>
    );
  }
  if (!rounds.length)
    return (
      <p className="text-[13px] text-[#cbd5e1]">
        No relay cars are saved for this day yet.
      </p>
    );
  const unplaced = data.need_a_look ?? [];
  return (
    <>
      {rounds.map((r) => (
        <Fragment key={r.round}>
          <TotalSheet
            round={r}
            dateLong={dates.long}
            many={rounds.length > 1}
            orientation={orientationOf(data.summary_orientation)}
          />
          {r.cars
            .filter((c) => c.rows.length > 0)
            .map((c) => (
              <CarSheet key={c.key} car={c} dateShort={dates.short} />
            ))}
        </Fragment>
      ))}
      {unplaced.length ? <Unplaced guests={unplaced} /> : null}
    </>
  );
}

const TOTAL_HEAD = [
  "Pick up Time",
  "Pick up Location",
  "Quantities",
  "Customer name",
  "Customer Phone",
  "Tour",
  "Order Number",
];

/** 总表图例：第一排接驳车，下面几排大巴（每个团一栏，同团的车叠在一起）。 */
function Legend({ round }: { round: RelayRoundList }) {
  const relayCars = round.cars.filter((c) => !c.isBus);
  const cols = Math.max(relayCars.length, 1);
  const byTour = new Map<string, typeof round.buses>();
  for (const b of round.buses)
    byTour.set(b.tour, [...(byTour.get(b.tour) ?? []), b]);
  const tours = [...byTour.values()];
  const depth = Math.max(0, ...tours.map((t) => t.length));
  const busRows: (typeof round.buses)[] = [];
  // 每 cols 个团一组；组里按「第几辆车」一排排往下叠。
  for (let start = 0; start < tours.length; start += cols) {
    const group = tours.slice(start, start + cols);
    for (let i = 0; i < depth; i++) {
      const row = group.map((t) => t[i] ?? null);
      if (row.some(Boolean)) busRows.push(row as typeof round.buses);
    }
  }
  const cell = (text: string, color: string | null, key: string) => (
    <td key={key} style={color ? { background: color } : undefined}>
      {text}
    </td>
  );
  return (
    <table className="rl-legend mt-1.5">
      <tbody>
        <tr>
          {relayCars.map((c) => [
            cell(c.title, c.color, `${c.key}-t`),
            cell(c.who, c.color, `${c.key}-w`),
          ])}
        </tr>
        {busRows.map((row, i) => (
          <tr key={i}>
            {Array.from({ length: cols }, (_, j) => {
              const b = row[j];
              return b
                ? [
                    cell(busName(b), b.color, `${i}-${j}-n`),
                    cell(busLegend(b), b.color, `${i}-${j}-w`),
                  ]
                : [<td key={`${i}-${j}-a`} />, <td key={`${i}-${j}-b`} />];
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Total Pax 那一行（每天的起点字号 car.total_pax，置顶 92 第 2 批）；当天 Aa 整页加减几 px 它也跟着加减（置顶 112 Q6 A，
 * Annie「页面上的字体变得时候Total Pax这一行也要跟着变」）。
 */
function totalPaxStyle(pageDelta: number): CSSProperties {
  return {
    fontSize: pageDelta
      ? `calc(var(--rl-car-total, 20px) + ${pageDelta}px)`
      : "var(--rl-car-total, 20px)",
    fontWeight: "var(--rl-car-total-w, 700)" as CSSProperties["fontWeight"],
  };
}

/** 每天的起点字号 ⇒ CSS 变量（只写设了的）。 */
const TEXT_VARS: Record<string, Record<string, string>> = {
  summary: {
    table_text: "--rl-sum-td",
    legend: "--rl-sum-legend",
    column_titles: "--rl-sum-th",
  },
  car: {
    header: "--rl-car-head",
    table_text: "--rl-car-td",
    total_pax: "--rl-car-total",
    bus_bars: "--rl-car-bar",
  },
};
function textVars(text: PrintLayoutSettings["text"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [layout, vars] of Object.entries(TEXT_VARS)) {
    const els = relayTextElements(layout);
    for (const [el, name] of Object.entries(vars)) {
      const t = text[layout]?.[el];
      const def = els.find((e) => e.key === el);
      if (!t || !def) continue;
      if (t.d) out[name] = `${def.px + t.d}px`;
      if (t.bold !== undefined) out[`${name}-w`] = t.bold ? "700" : "400";
    }
  }
  return out;
}

/** Hotel 格涂车色（版式设置可以关）。 */
function useHotelStyle() {
  const { hotelCell, hotelColor } = useContext(RelayLookContext);
  return (color: string | null | undefined): CSSProperties | undefined =>
    hotelCell && (hotelColor ?? color)
      ? { background: hotelColor ?? color ?? undefined }
      : undefined;
}

function TotalSheet({
  round,
  dateLong,
  many,
  orientation,
}: {
  round: RelayRoundList;
  dateLong: string;
  /** 有两轮时右上角带上是哪一轮。 */
  many: boolean;
  orientation: "portrait" | "landscape";
}) {
  const hotelStyle = useHotelStyle();
  const sheet = round.textSheet;
  const font = useRelayCellFont(sheet, useContext(RelayLookContext).summaryPx);
  const ref = useRef<HTMLElement>(null);
  const fit = useSheetFit(ref, true, useRelaySpacing(sheet));
  let prev: { guest: RelayGuest; carKey: string } | null = null;
  return (
    <>
      <SheetTextBar
        sheet={sheet}
        orders={round.rows.map((r) => r.guest.order_number)}
      />
      <SheetFitWarn fit={fit} />
      <section
        ref={ref}
        data-relay-total={round.round}
        data-orient={orientation}
        className="rl-sheet rl-total"
      >
        <SheetFitMarks fit={fit} />
        <div className="flex items-baseline justify-between text-[20px] font-bold">
          <span>RELAY SPLITS</span>
          <span>
            {dateLong}
            {many ? (
              <span className="ml-2 text-[13px] font-semibold">
                · {round.name}
              </span>
            ) : null}
          </span>
        </div>
        <Legend round={round} />
        <table className="mt-2">
          <thead>
            <tr>
              {TOTAL_HEAD.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {round.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="!font-normal text-[#555]">
                  No guests on a relay car yet.
                </td>
              </tr>
            ) : (
              round.rows.map(({ guest: g, car }) => {
                const cur = { guest: g, carKey: car.key };
                const gap = newGroup(prev, cur);
                prev = cur;
                return (
                  <Fragment key={`${car.key}-${g.id}`}>
                    {gap ? (
                      <tr>
                        <td className="rl-gap" colSpan={7} />
                      </tr>
                    ) : null}
                    <tr data-relay-row={g.order_number}>
                      <GuestCells
                        g={g}
                        color={car.color}
                        hotelStyle={hotelStyle}
                        font={font}
                      />
                    </tr>
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

function CarSheet({
  car,
  dateShort,
}: {
  car: RelayCarSheet;
  dateShort: string;
}) {
  const hotelStyle = useHotelStyle();
  const sheet = car.textSheet;
  const font = useRelayCellFont(sheet, useContext(RelayLookContext).carPx);
  const totalPax = totalPaxStyle(useRelayPageDelta(sheet));
  const ref = useRef<HTMLElement>(null);
  const fit = useSheetFit(ref, false, useRelaySpacing(sheet));
  let prev: { guest: RelayGuest; carKey: string } | null = null;
  return (
    <>
      <SheetTextBar
        sheet={sheet}
        orders={car.rows.map((g) => g.order_number)}
      />
      <SheetFitWarn fit={fit} />
      <section
        ref={ref}
        data-relay-car={car.key}
        data-orient={car.orientation}
        className="rl-sheet"
      >
        <SheetFitMarks fit={fit} />
        <div className="rl-head" style={{ background: car.color }}>
          <span>
            {car.title} &nbsp;{car.who}
          </span>
          <span className="whitespace-nowrap">
            Service Date: &nbsp;{dateShort}
          </span>
        </div>
        {car.problems.map((p) => (
          <p key={p} className="px-3 py-1 text-[14px] font-bold text-[#d00000]">
            {p}
          </p>
        ))}
        <table className="mt-1.5">
          <thead>
            <tr>
              <th>Time</th>
              <th>Hotel</th>
              <th>Qty</th>
              <th>Full Name</th>
              <th>Phone #</th>
              <th>Product</th>
              <th>Order #</th>
            </tr>
          </thead>
          <tbody>
            {car.rows.map((g) => {
              const cur = { guest: g, carKey: car.key };
              const gap = newGroup(prev, cur);
              prev = cur;
              return (
                <Fragment key={g.id}>
                  {gap ? (
                    <tr>
                      <td className="rl-gap" colSpan={7} />
                    </tr>
                  ) : null}
                  <tr data-relay-row={g.order_number}>
                    <GuestCells
                      g={g}
                      color={car.color}
                      hotelStyle={hotelStyle}
                      font={font}
                    />
                  </tr>
                </Fragment>
              );
            })}
            <tr>
              <td className="rl-gap" colSpan={7} />
            </tr>
            <tr>
              <td colSpan={2} className="!text-right" style={totalPax}>
                Total Pax
              </td>
              <td data-relay-total-pax style={totalPax}>
                {car.pax}
              </td>
              <td colSpan={4} className="!border-0" />
            </tr>
          </tbody>
        </table>
        {car.buses.length ? (
          <div className="mt-5">
            {car.buses.map((b) => (
              <div
                key={`${b.tour}-${b.label}-${b.van}`}
                data-relay-bus
                className="rl-bar"
                style={b.color ? { background: b.color } : undefined}
              >
                {busBar(b)}
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

/** 还没上任何 relay 车的客人：只在屏幕上，给 staff 看还差谁没排（不印）。 */
/** 客人一行的 7 格（总表、车单同一套）：Hotel 格涂车色；字号照当天 Aa（置顶 92 Q5）。 */
function GuestCells({
  g,
  color,
  hotelStyle,
  font,
}: {
  g: RelayGuest;
  color: string;
  hotelStyle: (c: string | null | undefined) => CSSProperties | undefined;
  font: ReturnType<typeof useRelayCellFont>;
}) {
  const cell = (col: RelayColumn, extra?: CSSProperties) => {
    const f = font(col, g.order_number);
    return {
      "data-relay-col": col,
      style: extra || f.style ? { ...extra, ...f.style } : undefined,
      className: f.className || undefined,
      onClick: f.onClick,
    };
  };
  return (
    <>
      <td {...cell("time")}>{g.pickup_time}</td>
      <td {...cell("hotel", hotelStyle(color))}>{hotelText(g)}</td>
      <td {...cell("qty")}>{g.pax ?? ""}</td>
      <td {...cell("name")}>{g.name}</td>
      <td {...cell("phone")}>{g.phone ?? ""}</td>
      <td {...cell("product")}>{tourText(g)}</td>
      <td {...cell("order")}>{g.order_number}</td>
    </>
  );
}

function Unplaced({ guests }: { guests: (RelayGuest & { reason: string })[] }) {
  const pax = guests.reduce((s, g) => s + (g.pax ?? 0), 0);
  return (
    <section
      data-relay-unplaced
      className="rl-screen-only mx-auto mb-6 w-full max-w-[210mm] overflow-hidden rounded-[10px] bg-paper text-[#111]"
    >
      <div className="border-b border-black/10 px-4 py-2.5 text-[14px] font-bold text-[#8a5a00]">
        Not on any relay car yet — {guests.length}{" "}
        {guests.length === 1 ? "order" : "orders"}, {pax} pax
        <span className="ml-2 text-[12px] font-normal text-[#1a1a1a]">
          Not printed. Add their hotel to a relay car on Dispatch.
        </span>
      </div>
      <div className="rl-scroll">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[#f1f5f9] text-left">
              {["Time", "Hotel", "Qty", "Name", "Tour", "Order #", "Why"].map(
                (h) => (
                  <th
                    key={h}
                    className="border-b border-black/10 px-2.5 py-1.5 font-semibold"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {guests.map((g) => (
              <tr key={g.id} className="border-b border-black/[.06]">
                <td className="px-2.5 py-1.5">{g.pickup_time}</td>
                <td className="px-2.5 py-1.5">{hotelText(g)}</td>
                <td className="px-2.5 py-1.5">{g.pax ?? ""}</td>
                <td className="px-2.5 py-1.5">{g.name}</td>
                <td className="px-2.5 py-1.5">{tourText(g)}</td>
                <td className="px-2.5 py-1.5">{g.order_number}</td>
                <td className="px-2.5 py-1.5 text-[#8a5a00]">{g.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
