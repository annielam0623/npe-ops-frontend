"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner } from "@/components/ui/panel";
import { usePhoneInfo } from "@/components/ui/phone";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchPayrollPeriod,
  payrollCsvUrl,
  savePayrollRun,
} from "@/lib/guide-payroll-api";
import { laToday, shiftYmd } from "@/lib/la-date";
import { usePermissions } from "@/lib/staff-permissions";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import type {
  PayrollLock,
  PayrollPeriod,
  PayrollPerson,
  PayrollRun,
  PayrollRunInput,
} from "@/types/guide-payroll";

import {
  HR_BTN_CLASS,
  HR_CARD_CLASS,
  HR_CARD_HEADER_CLASS,
  HR_CARD_TITLE_CLASS,
  HR_EMPTY_CLASS,
} from "./legacy-ui";
import { PayrollHistory } from "./payroll-history";
import { PayrollLocks } from "./payroll-locks";
import { PayrollRates } from "./payroll-rates";
import {
  amountError,
  CHG,
  dash,
  FLAG,
  fmtDay,
  fmtShort,
  LINK,
  money,
  MONEY_INPUT,
  NIH,
  NUM,
  periodName,
  rangeName,
  SAVE_BTN,
  ST_DIM,
  ST_GREEN,
  ST_RED,
  TABLE,
  TD,
  TH,
  WHITE_BTN,
  XS_BTN,
  YELLOW_BOX,
} from "./payroll-ui";

/**
 * Settings › Human Resource › Payroll（138 / G309，Annie 2026-11-16「138 全部按推荐，动手」）。
 * 样子、文字、How to use、红字照 preview V9（docs/previews/138-guide-payroll-v9.html），接口照后端合同 v2（main 85152f75）。
 *
 * - 期间页：‹ › 换期、Export CSV、锁住一行、四格数字、Payroll by person（点名字展开明细）、Needs review。
 * - 改（settings.payroll.edit）：每趟 Fee 点格子改（题 11 A，照 Main manifest Special Requirements：cursor-text、Done / Cancel、
 *   橙色 edited、Price … · Use the price 蓝下划线）；Extras 勾；私人团 Tips 框。锁住的日子、归档日（assignment_id null）只读。
 *   改动全部先暂存（淡黄底），一个蓝「Save payroll changes」一次存：每趟 PUT /api/payroll/runs/{id} 只带改了的键；
 *   Saving… / Saved 绿 / 后端原句红字。存好重拉（No rate 手改后挪进名单由后端算）。
 * - 换期 / 离开页面有没存的改动先问（换期：黄框 Save / Discard / Stay；离开：useLeaveGuard）。
 * - 下面挂 Pay rates / Locked dates / Change history 三张卡（5a，payroll-rates / -locks / -history）和 How to use。
 */

const ROLE_LABEL: Record<string, string> = {
  guide: "Guide",
  driver_guide: "Driver + Guide",
};
const STATUS: Record<string, [string, string]> = {
  no_rate: [
    "No rate",
    "Add a rate under Pay rates, or type a fee for this run.",
  ],
  no_guide: ["No guide", "Assign a guide in Dispatch to pay the tips."],
};

const LEAVE_MESSAGE =
  "You have changes that are not saved. Leave without saving?";

/** 期间的 ‹ ›：同 Staff Schedule 周切换的 HEAD_ICON（components/schedule/schedule-view.tsx）。 */
const PERIOD_ARROW =
  "inline-flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[8px] border border-white/10 bg-white/[.04] text-white/80 transition hover:bg-white/[.08] max-sm:h-[26px]! max-sm:w-[26px]! max-sm:p-0!";

/** 这一期的第一天（1 号或 16 号），前一期 / 后一期的任何一天都行，后端按这天找期。 */
function shiftPeriod(from: string, dir: -1 | 1): string {
  return dir < 0 ? shiftYmd(from, -1) : shiftYmd(from, 16);
}

function roleOf(run: PayrollRun): string {
  return run.shift === "private_tour"
    ? "Private Tour guide"
    : (ROLE_LABEL[run.role] ?? run.role);
}

/** 一趟没存的改动。fee / tips："" = 清掉（回到价格 / 没有小费）。 */
type RunDraft = {
  fee?: string;
  tips?: string;
  extras?: Record<string, boolean>;
};
type Drafts = Record<number, RunDraft>;

const numOrNull = (v: string | null | undefined): number | null =>
  v === null || v === undefined || v.trim() === "" ? null : Number(v);

/** 一趟加上暂存以后的样子。 */
type Shown = {
  edited: boolean;
  /** 显示在格子里的 Fee（手改的或价格表的）。 */
  fee: number;
  hasFee: boolean;
  /** 打了勾的加购项 code。 */
  ticked: Set<string>;
  extrasTotal: number;
  tips: string | null;
  tipsNum: number;
  total: number;
  chgFee: boolean;
  chgTips: boolean;
  chgExtras: boolean;
};

function shownOf(run: PayrollRun, d: RunDraft | undefined): Shown {
  const feeRaw = d?.fee !== undefined ? d.fee : run.fee_override;
  const override = numOrNull(feeRaw);
  const edited = override !== null && Number.isFinite(override);
  const rate = numOrNull(run.rate_fee);
  const fee = edited ? override : (rate ?? 0);
  const ticked = new Set(run.extras.map((x) => x.code));
  for (const [code, on] of Object.entries(d?.extras ?? {})) {
    if (on) ticked.add(code);
    else ticked.delete(code);
  }
  const allowed = new Map(run.extras_allowed.map((x) => [x.code, x]));
  let extrasTotal = 0;
  for (const code of ticked) {
    // 勾了但这天已不能勾（价格改了）：用后端给的已勾金额。
    const x = allowed.get(code) ?? run.extras.find((e) => e.code === code);
    if (x) extrasTotal += Number(x.amount);
  }
  const tips = d?.tips !== undefined ? d.tips : run.tips;
  const t = numOrNull(tips);
  const tipsNum = t !== null && Number.isFinite(t) ? t : 0;
  const chgFee =
    d?.fee !== undefined &&
    numOrNull(d.fee) !== numOrNull(run.fee_override) &&
    !(d.fee.trim() === "" && run.fee_override === null);
  const chgTips =
    d?.tips !== undefined && numOrNull(d.tips) !== numOrNull(run.tips);
  const baseTicked = new Set(run.extras.map((x) => x.code));
  const chgExtras = Object.entries(d?.extras ?? {}).some(
    ([code, on]) => on !== baseTicked.has(code),
  );
  return {
    edited,
    fee,
    hasFee: edited || rate !== null,
    ticked,
    extrasTotal,
    tips,
    tipsNum,
    total: fee + extrasTotal + tipsNum,
    chgFee,
    chgTips,
    chgExtras,
  };
}

const isDirty = (s: Shown) => s.chgFee || s.chgTips || s.chgExtras;

/** 一趟能不能改（页面自己挡；后端也会挡）。 */
function runEditable(run: PayrollRun, canEdit: boolean): boolean {
  return canEdit && run.assignment_id !== null && !run.locked;
}

/** 改了的键（只带改了的）。 */
function bodyOf(run: PayrollRun, d: RunDraft, s: Shown): PayrollRunInput {
  const body: PayrollRunInput = {};
  if (s.chgFee) body.fee = (d.fee ?? "").trim();
  if (s.chgTips) body.tips = (d.tips ?? "").trim();
  if (s.chgExtras) {
    const base = new Set(run.extras.map((x) => x.code));
    const ex: Record<string, boolean> = {};
    for (const [code, on] of Object.entries(d.extras ?? {}))
      if (on !== base.has(code)) ex[code] = on;
    body.extras = ex;
  }
  return body;
}

/** Fee 格：题 11 A 照 Main manifest Special Requirements 点格子改。 */
function FeeCell({
  run,
  s,
  editable,
  editing,
  onStartEdit,
  onDone,
  onCancel,
  onUsePrice,
}: {
  run: PayrollRun;
  s: Shown;
  editable: boolean;
  editing: boolean;
  onStartEdit: () => void;
  onDone: (value: string) => void;
  onCancel: () => void;
  onUsePrice: () => void;
}) {
  const [value, setValue] = useState("");
  const amt = s.hasFee ? money(s.fee) : <span className="text-[#888]">—</span>;
  const pill = s.edited ? (
    <span
      data-payroll-edited
      className="ml-1.5 rounded-full bg-[#fed7aa] px-1.5 text-[10px] font-bold whitespace-nowrap text-[#7c2d12]"
    >
      edited
    </span>
  ) : null;
  const sub = s.edited ? (
    <span className="block text-[11px] whitespace-nowrap text-[#4b5563]">
      Price {run.rate_fee === null ? "none" : money(run.rate_fee)}
      {editable ? (
        <>
          {" · "}
          <button
            type="button"
            data-payroll-use-price
            className={LINK}
            onClick={(e) => {
              e.stopPropagation();
              onUsePrice();
            }}
          >
            Use the price
          </button>
        </>
      ) : null}
    </span>
  ) : null;

  if (editing) {
    return (
      <div data-payroll-fee-editor>
        <input
          autoFocus
          className={MONEY_INPUT}
          inputMode="decimal"
          placeholder="0.00"
          aria-label={`Fee ${fmtShort(run.date)}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onDone(value);
            else if (e.key === "Escape") onCancel();
          }}
        />
        <div className="mt-1 flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            data-payroll-fee-done
            className={XS_BTN}
            onClick={() => onDone(value)}
          >
            Done
          </button>
          <button type="button" className={XS_BTN} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  if (!editable)
    return (
      <>
        {amt}
        {pill}
        {sub}
      </>
    );
  return (
    <span
      role="button"
      tabIndex={0}
      data-payroll-fee-cell
      title="Click to edit"
      className="-mx-1 -my-0.5 block cursor-text rounded px-1 py-0.5 hover:bg-[#eef4ff] hover:shadow-[inset_0_0_0_1px_#bfdbfe]"
      onClick={() => {
        setValue(s.edited || s.hasFee ? s.fee.toFixed(2) : "");
        onStartEdit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          (e.currentTarget as HTMLElement).click();
        }
      }}
    >
      {amt}
      {pill}
      {sub}
    </span>
  );
}

function ExtrasCell({
  run,
  s,
  editable,
  onTick,
}: {
  run: PayrollRun;
  s: Shown;
  editable: boolean;
  onTick: (code: string, on: boolean) => void;
}) {
  if (!editable) {
    const on = run.extras_allowed
      .filter((x) => s.ticked.has(x.code))
      .concat(
        run.extras.filter(
          (x) =>
            s.ticked.has(x.code) &&
            !run.extras_allowed.some((a) => a.code === x.code),
        ),
      );
    return on.length ? (
      <>
        {on.map((x) => (
          <div key={x.code}>
            {x.name} {money(x.amount)}
          </div>
        ))}
      </>
    ) : (
      <span className="text-[#888]">—</span>
    );
  }
  if (!run.extras_allowed.length) return <span className="text-[#888]">—</span>;
  return (
    <>
      {run.extras_allowed.map((x) => {
        const on = s.ticked.has(x.code);
        return (
          <div key={x.code}>
            <label className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap">
              <input
                type="checkbox"
                data-payroll-extra={`${run.assignment_id}|${x.code}`}
                checked={on}
                aria-label={`${x.name} ${fmtShort(run.date)}`}
                onChange={(e) => onTick(x.code, e.target.checked)}
              />
              {x.name}{" "}
              {on ? (
                money(x.amount)
              ) : (
                <span className="text-[#888]">{money(x.amount)}</span>
              )}
            </label>
          </div>
        );
      })}
    </>
  );
}

function TipsCell({
  run,
  s,
  editable,
  onChange,
}: {
  run: PayrollRun;
  s: Shown;
  editable: boolean;
  onChange: (v: string) => void;
}) {
  if (run.shift !== "private_tour")
    return <span className="text-[#888]">—</span>;
  if (!editable)
    return s.tips === null || s.tips === "" ? (
      <span className="text-[#888]">—</span>
    ) : (
      <>{money(s.tipsNum)}</>
    );
  const bad = s.tips !== null && s.tips.trim() !== "" && !!amountError(s.tips);
  return (
    <span className="inline-flex items-center gap-1.5">
      ${" "}
      <input
        className={cn(MONEY_INPUT, bad && "border-[#b3261e]")}
        inputMode="decimal"
        placeholder="0.00"
        data-payroll-tips={run.assignment_id ?? ""}
        aria-label={`Tips ${fmtShort(run.date)}`}
        value={s.tips ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

type RowApi = {
  canEdit: boolean;
  drafts: Drafts;
  editingId: number | null;
  setEditingId: (id: number | null) => void;
  patch: (run: PayrollRun, p: RunDraft) => void;
  /** 这一期碰到的锁：状态格判断「Paid · locked」用（后端的 run.locked 之外再按日期对一次）。 */
  locks: PayrollLock[];
};

/** 这一趟的日子锁住了：后端标了 locked，或落在某个锁的日期里。 */
function isLockedDay(run: PayrollRun, locks: PayrollLock[]): boolean {
  return run.locked || locks.some((l) => l.from <= run.date && run.date <= l.to);
}

function RunRows({
  runs,
  needs,
  api,
}: {
  runs: PayrollRun[];
  needs: boolean;
  api: RowApi;
}) {
  return (
    <>
      {runs.map((run, i) => {
        const id = run.assignment_id;
        const d = id !== null ? api.drafts[id] : undefined;
        const s = shownOf(run, d);
        const editable = runEditable(run, api.canEdit);
        // 没有导游的趟 Fee 不能改（V9：No guide 先去 Dispatch 排人）。
        const feeEditable = editable && !!run.guide_name;
        return (
          <tr key={`${id ?? "x"}-${run.date}-${i}`} data-payroll-run={id ?? ""}>
            <td className={TD}>
              <span className="whitespace-nowrap">{fmtDay(run.date)}</span>
              {run.locked ? (
                <span className="ml-1.5 text-[11px] whitespace-nowrap text-[#4b5563]">
                  🔒 Locked
                </span>
              ) : null}
            </td>
            {needs ? (
              <td className={TD}>
                <b>{run.guide_name ? run.guide_name.trim() : "Unassigned"}</b>
                {run.guide_name && !run.guide_in_hr ? (
                  <span className={NIH}>Not in HR</span>
                ) : null}
              </td>
            ) : null}
            <td className={TD}>
              {run.tour}
              {id === null ? (
                <div className="text-[11.5px] text-[#888]">
                  Archived — can’t be changed
                </div>
              ) : null}
            </td>
            <td className={TD}>{roleOf(run)}</td>
            <td
              className={cn(
                TD,
                NUM,
                s.chgFee && CHG,
                run.locked && "bg-[#f3f4f6]",
              )}
            >
              <FeeCell
                run={run}
                s={s}
                editable={feeEditable}
                editing={id !== null && api.editingId === id}
                onStartEdit={() => api.setEditingId(id)}
                onCancel={() => api.setEditingId(null)}
                onDone={(v) => {
                  api.patch(run, { fee: v.trim() });
                  api.setEditingId(null);
                }}
                onUsePrice={() => {
                  api.patch(run, { fee: "" });
                  api.setEditingId(null);
                }}
              />
            </td>
            {needs ? null : (
              <td className={cn(TD, s.chgExtras && CHG)}>
                <ExtrasCell
                  run={run}
                  s={s}
                  editable={editable}
                  onTick={(code, on) =>
                    api.patch(run, {
                      extras: { ...(d?.extras ?? {}), [code]: on },
                    })
                  }
                />
              </td>
            )}
            <td className={cn(TD, NUM, s.chgTips && CHG)}>
              <TipsCell
                run={run}
                s={s}
                editable={editable}
                onChange={(v) => api.patch(run, { tips: v })}
              />
            </td>
            {needs ? null : (
              <td className={cn(TD, NUM, "font-bold")}>{money(s.total)}</td>
            )}
            <td className={cn(TD, "whitespace-nowrap")} data-payroll-status>
              {/* Annie 2026-11-17「选A」「留空，动手」：paid 只表示算进合计，不是「已付」——没锁的留空，
                  锁住的日子写 Paid · locked（灰字）；No rate / No guide / Not completed 照旧琥珀字。 */}
              {run.status === "paid" ? (
                isLockedDay(run, api.locks) ? (
                  <span className="text-[#888]">Paid · locked</span>
                ) : null
              ) : (
                <span className={FLAG}>{STATUS[run.status]?.[0]}</span>
              )}
              {run.day_status === "not_completed" ? (
                <>
                  {run.status === "paid" && !isLockedDay(run, api.locks) ? null : (
                    <br />
                  )}
                  <span className={FLAG}>Not completed</span>
                </>
              ) : null}
            </td>
            {needs ? (
              <td className={cn(TD, "text-[12px] text-[#4b5563]")}>
                {STATUS[run.status]?.[1]}
              </td>
            ) : null}
          </tr>
        );
      })}
    </>
  );
}

type PersonSum = {
  fee: number;
  extras: number;
  tips: number;
  total: number;
};

function sumRuns(runs: PayrollRun[], drafts: Drafts): PersonSum {
  const out = { fee: 0, extras: 0, tips: 0, total: 0 };
  for (const r of runs) {
    const s = shownOf(
      r,
      r.assignment_id !== null ? drafts[r.assignment_id] : undefined,
    );
    out.fee += s.fee;
    out.extras += s.extrasTotal;
    out.tips += s.tipsNum;
    out.total += s.total;
  }
  return out;
}

/** 钉住第一列（手机上表格左右滑，题 4 甲）。 */
const STICKY = "max-sm:sticky max-sm:left-0 max-sm:z-[1]";

export const PAYROLL_HOW_TO = [
  "Payroll adds up what each guide and driver-guide earned in one pay period: the 1st–15th, or the 16th to the last day of the month. Use ‹ and › on either side of the dates to move between periods.",
  "Each tour run pays one fee. A guide gets the Guide fee; a driver who also guides the run gets the Driver + Guide fee. Two tours on one day pay two fees. Relay runs and bus tours without a guide are not on this page.",
  "Days are counted up to today. A day marked Not completed has not been marked Completed on Dispatch yet; it is still counted, so check it before paying.",
  "Which price a run gets: the newest price for that guide that covers the day; if there is none, the newest price for everyone that covers it. A price with no end date keeps going, so a price for November 1–30 wins only in November. The line under the fee says when a date-range price or a price for that guide was used.",
  "Click a name to see that person's runs. Click a run’s fee to type a different fee for that run only, then click Done; it shows edited, with the price under it. Use the price puts the price back. Extras and tips are still added on top.",
  "Extras are paid per ticked run. ANT relay can be ticked only on tours whose price has ANT relay; other extras, like Long day, can be ticked on any run. On Private Tour runs, type the tips; they are paid to that run's guide.",
  "Changes stay on the page until you click Save payroll changes. If you leave the page or change the period first, you are asked whether to save.",
  "The Status column is blank for runs that are counted in the total. Runs on locked days show Paid · locked. No rate, No guide and Not completed need a look.",
  "Needs review lists runs that are left out of the period total: No rate (no price covers that run — add a price under Pay rates, or type a fee for the run) and No guide (nobody is picked as guide on Dispatch).",
  "A guide whose name was typed by hand on Dispatch is paid under that name and shows Not in HR. Add the person in Human Resource so their details are on file, and pick them from the list on Dispatch next time. The same person typed with two spellings shows as two people.",
  "Pay rates: click + Add price to add a price for a tour from a start date, with or without an end date, for everyone or only for the people you tick. For a tour name typed on Dispatch, pick Type a tour name… and type it the same way. Click + Add extra for a new extra or a new amount for an existing one; like prices, an extra amount can be for everyone or only for the people you tick. Nothing is kept until you click Save rates.",
  "Locked dates: once pay for some days is final, pick the dates, add a note if you like, and click Lock dates. Fees, extras and tips on locked days can’t be changed, and prices or extra amounts that cover them can’t be changed or removed — add a new price that starts after the locked days instead. Unlock to change them again. Locking and unlocking are saved right away. When Auto-lock is on, the 1st–15th lock by themselves on the 20th at 11:59 PM and the 16th–end of month on the 5th of the next month at 11:59 PM (Los Angeles time); those locks show Auto under Locked by and can be unlocked like any other.",
  "Change history lists every change to prices, extras, fees, tips and locks: when, who, what, before and after.",
  "Export CSV downloads the period: each person's runs with a total line, then the runs that need review. It shows whether a fee was changed by hand and which extras were ticked.",
  "Only Admin accounts given Payroll on the Team page can open this page. Payroll: View can look, export and see the change history; Payroll: Edit can also change prices, extras, fees and tips, and lock or unlock dates.",
];

export function Payroll({
  onUnauthorized,
  onDirtyChange,
}: {
  onUnauthorized: () => void;
  /** 有没存的改动（HR 页换页签时先问）。 */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const perms = usePermissions();
  const canEdit = perms.can("settings.payroll.edit");
  const [date, setDate] = useState<string>(() => laToday());
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "forbidden" }
    | { kind: "ready"; data: PayrollPeriod }
  >({ kind: "loading" });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Drafts>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<
    null | "saving" | "saved" | { error: string }
  >(null);
  /** 换期时有没存的改动：黄框问 Save / Discard / Stay。 */
  const [guard, setGuard] = useState<null | -1 | 1>(null);
  const [ratesDirty, setRatesDirty] = useState(false);
  /** Change history 重拉的记号：每次存好加 1。 */
  const [version, setVersion] = useState(0);
  const byPersonInfo = usePhoneInfo("About Payroll by person");
  const needsInfo = usePhoneInfo("About Needs review");

  const load = useCallback(
    (d: string, opts?: { signal?: AbortSignal; silent?: boolean }) => {
      if (!opts?.silent) setState({ kind: "loading" });
      return fetchPayrollPeriod(d, opts?.signal)
        .then((data) => setState({ kind: "ready", data }))
        .catch((e) => {
          if (opts?.signal?.aborted) return;
          if (isStatus(e, 401)) onUnauthorized();
          else if (isStatus(e, 403)) setState({ kind: "forbidden" });
          else setState({ kind: "error", message: describeError(e) });
        });
    },
    [onUnauthorized],
  );

  useEffect(() => {
    const c = new AbortController();
    void load(date, { signal: c.signal });
    return () => c.abort();
  }, [date, load]);

  const data = state.kind === "ready" ? state.data : null;
  const allRuns = data
    ? [...data.people.flatMap((p) => p.runs), ...data.unpaid]
    : [];
  // 按日期存（同一天按趟号）：存不上的那趟留着、标红字，后面的照样存。
  const dirtyRuns = allRuns
    .filter(
      (r) =>
        r.assignment_id !== null &&
        drafts[r.assignment_id] &&
        isDirty(shownOf(r, drafts[r.assignment_id])),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.assignment_id! - b.assignment_id!,
    );
  const runsDirty = dirtyRuns.length > 0;
  const anyDirty = runsDirty || ratesDirty;

  useLeaveGuard(anyDirty, LEAVE_MESSAGE);
  const dirtyCb = useRef(onDirtyChange);
  useEffect(() => {
    dirtyCb.current = onDirtyChange;
  });
  useEffect(() => {
    dirtyCb.current?.(anyDirty);
  }, [anyDirty]);

  const patch = useCallback((run: PayrollRun, p: RunDraft) => {
    const id = run.assignment_id;
    if (id === null) return;
    setSaveState((s) => (s === "saving" ? s : null));
    setDrafts((all) => ({ ...all, [id]: { ...all[id], ...p } }));
  }, []);

  /** 依次存每一趟改了的；存不上的留着（红字第一个后端原句），其余照样存。返回是否全部存好。 */
  const saveRuns = useCallback(async (): Promise<boolean> => {
    if (!data) return true;
    for (const run of dirtyRuns) {
      const d = drafts[run.assignment_id!];
      for (const v of [d.fee, d.tips]) {
        if (v !== undefined && v.trim() !== "") {
          const err = amountError(v);
          if (err) {
            setSaveState({ error: err });
            return false;
          }
        }
      }
    }
    setSaveState("saving");
    setEditingId(null);
    const left: Drafts = { ...drafts };
    let failed: string | null = null;
    for (const run of dirtyRuns) {
      const id = run.assignment_id!;
      const d = drafts[id];
      try {
        await savePayrollRun(id, bodyOf(run, d, shownOf(run, d)));
        delete left[id];
      } catch (e) {
        if (isStatus(e, 401)) {
          onUnauthorized();
          return false;
        }
        // 第一个后端原句标红；这趟留着，后面的照样存。
        failed ??= describeError(e);
      }
    }
    setDrafts(left);
    setVersion((v) => v + 1);
    await load(date, { silent: true });
    setSaveState(failed ? { error: failed } : "saved");
    return !failed;
    // dirtyRuns 每次渲染重算；依赖 drafts / data 就够了。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, drafts, date, load, onUnauthorized]);

  function discard() {
    setDrafts({});
    setEditingId(null);
    setSaveState(null);
  }

  function goPeriod(dir: -1 | 1) {
    if (!data) return;
    if (runsDirty) {
      setGuard(dir);
      return;
    }
    setGuard(null);
    setDrafts({});
    setEditingId(null);
    setSaveState(null);
    setDate(shiftPeriod(data.from, dir));
  }

  const reloadQuiet = useCallback(() => {
    setVersion((v) => v + 1);
    void load(date, { silent: true });
  }, [date, load]);
  /** 锁 / 解锁以后：Pay rates 卡重新挂载（它自己拉 locks 判断 🔒 Locked）。 */
  const [locksVersion, setLocksVersion] = useState(0);
  const onLocksChanged = useCallback(() => {
    setLocksVersion((v) => v + 1);
    reloadQuiet();
  }, [reloadQuiet]);

  if (state.kind === "forbidden") {
    return (
      <ErrorBanner>
        Your account can’t open Payroll. Ask an admin to give you Payroll on the
        Team page.
      </ErrorBanner>
    );
  }
  if (state.kind === "error") {
    return (
      <ErrorBanner actionLabel="Try again" onAction={() => void load(date)}>
        Could not load payroll: {state.message}
      </ErrorBanner>
    );
  }
  if (state.kind === "loading")
    return (
      <p className="py-10 text-center text-[13px] text-white/55">Loading…</p>
    );

  const P = state.data;
  const nRuns = P.people.reduce((a, p) => a + p.runs.length, 0);
  const sums = P.people.map((p) => sumRuns(p.runs, drafts));
  const tot = sums.reduce(
    (a, s) => ({
      fee: a.fee + s.fee,
      extras: a.extras + s.extras,
      tips: a.tips + s.tips,
      total: a.total + s.total,
    }),
    { fee: 0, extras: 0, tips: 0, total: 0 },
  );
  const keyOf = (p: PayrollPerson) =>
    p.in_hr ? `hr:${p.hr_id}` : `typed:${p.name.trim().toLowerCase()}`;
  const hitLocks = P.locks.filter((l) => l.to >= P.from && l.from <= P.to);
  const api: RowApi = {
    canEdit,
    drafts,
    editingId,
    setEditingId,
    patch,
    locks: P.locks,
  };
  const nDirty = dirtyRuns.length;
  const saving = saveState === "saving";

  return (
    <div data-payroll>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-[34px] leading-[1.1] font-bold text-white/90 max-sm:text-[26px]">
            Payroll
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-white/55">
            {/* 日期在两个箭头中间（Annie 2026-11-16「一般不是日期在中间，箭头在两边么」，11-17 当动手）；键和间距照 Staff Schedule 的周切换。 */}
            <span className="inline-flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Previous period"
                data-payroll-prev
                className={PERIOD_ARROW}
                onClick={() => goPeriod(-1)}
              >
                ‹
              </button>
              <b
                className="px-1 text-center text-[13.5px] font-semibold whitespace-nowrap text-white max-sm:text-[13px]"
                data-payroll-period
              >
                {periodName(P.from, P.to)}
              </b>
              <button
                type="button"
                aria-label="Next period"
                data-payroll-next
                className={PERIOD_ARROW}
                onClick={() => goPeriod(1)}
              >
                ›
              </button>
            </span>
            <span>
              ·{" "}
              {!P.through
                ? "Not started yet"
                : P.through === P.to
                  ? "Whole period counted"
                  : `Counted through ${fmtDay(P.through)}`}
            </span>
          </div>
        </div>
        {P.through ? (
          <a
            href={payrollCsvUrl(P.from)}
            className={HR_BTN_CLASS}
            data-payroll-export
          >
            ↓ Export CSV
          </a>
        ) : null}
      </div>

      {hitLocks.length ? (
        <div
          className="mb-3.5 rounded-lg bg-white/[.12] px-3 py-2 text-[12.5px] text-white/90"
          data-payroll-lockline
        >
          🔒 Locked in this period:{" "}
          {hitLocks
            .map((l) =>
              rangeName(
                l.from < P.from ? P.from : l.from,
                l.to > P.to ? P.to : l.to,
              ),
            )
            .join(", ")}
          . Fees, extras and tips on these days can’t be changed.
        </div>
      ) : null}

      {guard !== null ? (
        <div className={cn(YELLOW_BOX, "mb-3.5")} data-payroll-guard>
          <span className="flex-[1_1_260px]">
            You have changes that are not saved. Save them before going to{" "}
            {guard < 0 ? "the previous period" : "the next period"}?
          </span>
          <button
            type="button"
            className={SAVE_BTN}
            data-payroll-guard-save
            onClick={() => {
              const dir = guard;
              setGuard(null);
              void saveRuns().then((ok) => {
                if (ok) {
                  setDrafts({});
                  setSaveState(null);
                  setDate(shiftPeriod(P.from, dir));
                }
              });
            }}
          >
            Save
          </button>
          <button
            type="button"
            className={WHITE_BTN}
            data-payroll-guard-discard
            onClick={() => {
              const dir = guard;
              setGuard(null);
              discard();
              setDate(shiftPeriod(P.from, dir));
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className={WHITE_BTN}
            onClick={() => setGuard(null)}
          >
            Stay
          </button>
        </div>
      ) : null}

      {!P.through ? (
        <div className={HR_CARD_CLASS}>
          <div className={HR_EMPTY_CLASS}>
            This period has not started yet. Runs show up here day by day from{" "}
            {fmtShort(P.from)}.
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-[1.4fr_1fr_1fr_1fr] overflow-hidden rounded-xl border-[0.5px] border-black/10 bg-paper text-[#1a1a1a] max-sm:grid-cols-2">
            {[
              ["Period total", money(tot.total)],
              ["People", String(P.people.length)],
              ["Counted runs", String(nRuns)],
              ["Needs review", String(P.unpaid.length)],
            ].map(([k, v], i) => (
              <div
                key={k}
                data-payroll-tile={k}
                className={cn(
                  "px-[18px] py-3.5",
                  i === 0 ? "bg-[#f6f7f9]" : "border-l border-[#f0f1f3]",
                )}
              >
                <div className="text-[12px] text-[#4b5563]">{k}</div>
                <div
                  className={cn(
                    "mt-1 font-bold tabular-nums",
                    i === 0 ? "text-[26px]" : "text-[22px]",
                    i === 3 && P.unpaid.length ? "text-[#b45309]" : "",
                  )}
                >
                  {v}
                </div>
              </div>
            ))}
          </div>

          <div className={HR_CARD_CLASS} data-payroll-by-person>
            <div className={HR_CARD_HEADER_CLASS}>
              <span className={HR_CARD_TITLE_CLASS}>
                Payroll by person
                {byPersonInfo.button}
              </span>
              <span
                className={cn("text-[12px] text-[#4b5563]", byPersonInfo.hide)}
              >
                Click a name to see the runs.
                <span className="sm:hidden">
                  {" "}
                  Swipe the table sideways to see every column.
                </span>
              </span>
            </div>
            <div className="overflow-x-auto px-4 pt-3 pb-3">
              <table className={cn(TABLE, "max-sm:min-w-[620px]")}>
                <thead>
                  <tr>
                    <th className={cn(TH, STICKY)}>Person</th>
                    <th className={cn(TH, NUM)}>Runs</th>
                    <th className={cn(TH, NUM)}>Fees</th>
                    <th className={cn(TH, NUM)}>Extras</th>
                    <th className={cn(TH, NUM)}>Tips</th>
                    <th className={cn(TH, NUM)}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {P.people.map((p, pi) => {
                    const k = keyOf(p);
                    const o = open.has(k);
                    const s = sums[pi];
                    return (
                      <Fragment key={k}>
                        <tr
                          className="cursor-pointer hover:bg-[#f8fafc]"
                          tabIndex={0}
                          aria-expanded={o}
                          data-payroll-person={p.name}
                          onClick={() =>
                            setOpen((cur) => {
                              const n = new Set(cur);
                              if (n.has(k)) n.delete(k);
                              else n.add(k);
                              return n;
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              (e.currentTarget as HTMLElement).click();
                            }
                          }}
                        >
                          <td
                            className={cn(
                              TD,
                              STICKY,
                              "font-semibold max-sm:bg-paper",
                            )}
                          >
                            <span className="inline-block w-3.5 text-[10px] text-[#4b5563]">
                              {o ? "▼" : "▶"}
                            </span>
                            {p.name}
                            {p.in_hr ? null : (
                              <span className={NIH}>Not in HR</span>
                            )}
                          </td>
                          <td className={cn(TD, NUM)}>{p.runs.length}</td>
                          <td className={cn(TD, NUM)}>{money(s.fee)}</td>
                          <td className={cn(TD, NUM)}>{dash(s.extras)}</td>
                          <td className={cn(TD, NUM)}>{dash(s.tips)}</td>
                          <td
                            className={cn(TD, NUM, "font-bold")}
                            data-payroll-person-total
                          >
                            {money(s.total)}
                          </td>
                        </tr>
                        {o ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="border border-[#e1e5ea] bg-[#f6f7f9] py-2 pr-3 pl-7 max-sm:pl-3"
                            >
                              <div className="overflow-x-auto">
                                <table
                                  className={cn(
                                    TABLE,
                                    "bg-white max-sm:min-w-[640px]",
                                  )}
                                >
                                  <thead>
                                    <tr>
                                      <th className={TH}>Date</th>
                                      <th className={TH}>Tour</th>
                                      <th className={TH}>Role</th>
                                      <th className={cn(TH, NUM)}>Fee</th>
                                      <th className={TH}>Extras</th>
                                      <th className={cn(TH, NUM)}>Tips</th>
                                      <th className={cn(TH, NUM)}>Total</th>
                                      <th className={TH}>Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {p.in_hr ? null : (
                                      <tr>
                                        <td
                                          colSpan={8}
                                          className={cn(
                                            TD,
                                            "bg-[#f8fafc] text-[12px] text-[#4b5563]",
                                          )}
                                        >
                                          Not in HR: {p.name} was typed by hand
                                          on Dispatch. Add this person in Human
                                          Resource so their details are on file.
                                        </td>
                                      </tr>
                                    )}
                                    <RunRows
                                      runs={p.runs}
                                      needs={false}
                                      api={api}
                                    />
                                    <tr className="bg-[#f6f7f9] font-bold">
                                      <td
                                        colSpan={3}
                                        className={cn(
                                          TD,
                                          "border-t-[1.5px] border-t-[#9aa3af]",
                                        )}
                                      >
                                        Total · {p.name} · {p.runs.length} run
                                        {p.runs.length === 1 ? "" : "s"}
                                      </td>
                                      <td
                                        className={cn(
                                          TD,
                                          NUM,
                                          "border-t-[1.5px] border-t-[#9aa3af]",
                                        )}
                                      >
                                        {money(s.fee)}
                                      </td>
                                      <td
                                        className={cn(
                                          TD,
                                          NUM,
                                          "border-t-[1.5px] border-t-[#9aa3af]",
                                        )}
                                      >
                                        {dash(s.extras)}
                                      </td>
                                      <td
                                        className={cn(
                                          TD,
                                          NUM,
                                          "border-t-[1.5px] border-t-[#9aa3af]",
                                        )}
                                      >
                                        {dash(s.tips)}
                                      </td>
                                      <td
                                        className={cn(
                                          TD,
                                          NUM,
                                          "border-t-[1.5px] border-t-[#9aa3af]",
                                        )}
                                      >
                                        {money(s.total)}
                                      </td>
                                      <td
                                        className={cn(
                                          TD,
                                          "border-t-[1.5px] border-t-[#9aa3af]",
                                        )}
                                      />
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                  <tr className="bg-[#eef0f3] font-bold" data-payroll-total>
                    <td className={cn(TD, STICKY, "max-sm:bg-[#eef0f3]")}>
                      Period total
                    </td>
                    <td className={cn(TD, NUM)}>{nRuns}</td>
                    <td className={cn(TD, NUM)}>{money(tot.fee)}</td>
                    <td className={cn(TD, NUM)}>{money(tot.extras)}</td>
                    <td className={cn(TD, NUM)}>{money(tot.tips)}</td>
                    <td className={cn(TD, NUM)}>{money(tot.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {canEdit ? (
              <div
                className="flex flex-wrap items-center gap-2.5 border-t-[0.5px] border-black/[.08] px-4 py-3"
                data-payroll-savebar
              >
                <span className={cn(ST_DIM, "max-sm:hidden")}>
                  Fees changed by hand, extras and Private Tour tips are saved
                  together.
                </span>
                <span className="flex-1" />
                {typeof saveState === "object" && saveState !== null ? (
                  <span className={ST_RED} data-payroll-save-error>
                    {saveState.error}
                  </span>
                ) : nDirty ? (
                  <span className={ST_RED} data-payroll-not-saved>
                    Not saved yet · {nDirty} change{nDirty === 1 ? "" : "s"}
                  </span>
                ) : saveState === "saved" ? (
                  <span className={ST_GREEN} data-payroll-saved>
                    Saved
                  </span>
                ) : saving ? (
                  <span className={ST_DIM}>Saving…</span>
                ) : null}
                {nDirty && !saving ? (
                  <button
                    type="button"
                    className={WHITE_BTN}
                    data-payroll-discard
                    onClick={discard}
                  >
                    Discard
                  </button>
                ) : null}
                <button
                  type="button"
                  className={SAVE_BTN}
                  data-payroll-save
                  disabled={!nDirty || saving}
                  onClick={() => void saveRuns()}
                >
                  {saving ? "Saving…" : "Save payroll changes"}
                </button>
              </div>
            ) : null}
          </div>

          {P.unpaid.length ? (
            <div className={HR_CARD_CLASS} data-payroll-needs>
              <div className={HR_CARD_HEADER_CLASS}>
                <span className={HR_CARD_TITLE_CLASS}>
                  Needs review{" "}
                  <span className="text-[12.5px] font-semibold text-[#b45309]">
                    {P.unpaid.length} run{P.unpaid.length === 1 ? "" : "s"}
                  </span>
                  {needsInfo.button}
                </span>
                <span
                  className={cn("text-[12px] text-[#4b5563]", needsInfo.hide)}
                >
                  Excluded from the period total until resolved.
                </span>
              </div>
              <div className="overflow-x-auto px-4 py-3">
                <table className={cn(TABLE, "max-sm:min-w-[620px]")}>
                  <thead>
                    <tr>
                      <th className={TH}>Date</th>
                      <th className={TH}>Person</th>
                      <th className={TH}>Tour</th>
                      <th className={TH}>Role</th>
                      <th className={cn(TH, NUM)}>Fee</th>
                      <th className={cn(TH, NUM)}>Tips</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>Next step</th>
                    </tr>
                  </thead>
                  <tbody>
                    <RunRows runs={P.unpaid} needs api={api} />
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Pay rates / Locked dates / Change history（5a 写的卡，照 V9 放在期间页下面）。 */}
      <PayrollRates
        key={locksVersion}
        canEdit={canEdit}
        onUnauthorized={onUnauthorized}
        onDirtyChange={setRatesDirty}
        onSaved={reloadQuiet}
        people={P.people}
        runs={[...P.runs, ...P.unpaid]}
        defaultFrom={P.from}
      />
      <PayrollLocks
        canEdit={canEdit}
        onUnauthorized={onUnauthorized}
        locks={P.locks}
        runsDirty={runsDirty || ratesDirty}
        onChanged={onLocksChanged}
      />
      <PayrollHistory
        canEdit={canEdit}
        onUnauthorized={onUnauthorized}
        version={version}
      />

      <HowToUse title="How to use — Payroll" items={PAYROLL_HOW_TO} />
    </div>
  );
}
