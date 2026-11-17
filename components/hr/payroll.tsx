"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchPayrollPeriod, payrollCsvUrl } from "@/lib/guide-payroll-api";
import { laToday, shiftYmd } from "@/lib/la-date";
import { cn } from "@/lib/utils";
import type { PayrollPeriod, PayrollRun } from "@/types/guide-payroll";

import {
  HR_BTN_CLASS,
  HR_CARD_CLASS,
  HR_CARD_HEADER_CLASS,
  HR_CARD_TITLE_CLASS,
  HR_EMPTY_CLASS,
} from "./legacy-ui";

/**
 * Settings › Human Resource › Payroll（138 / G309，Annie 2026-11-16「138 全部按推荐，动手」）。
 * 样子照 preview V9（docs/previews/138-guide-payroll-v9.html），接口照后端合同 v2（main 85152f75）。
 *
 * WIP（8d 11-16 公司电脑）：这一版只有只读的期间页——页头 ‹ › 换期 + Export CSV、锁住一行、四格数字、
 * Payroll by person（点名字展开明细）、Needs review。还没做：Fee 点格子改 / Extras 勾 / Tips 框 / Save、
 * Pay rates、Locked dates、Change history、离开拦截、How to use。见 PROGRESS.md 138 的「下一步」。
 */

const MON = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ymdParts(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}
const fmtShort = (ymd: string) => {
  const { m, d } = ymdParts(ymd);
  return `${MON[m - 1]} ${d}`;
};
const fmtDay = (ymd: string) => {
  const { y, m, d } = ymdParts(ymd);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MON[m - 1]} ${d}`;
};
const periodName = (from: string, to: string) =>
  `${fmtShort(from)}–${ymdParts(to).d}, ${ymdParts(from).y}`;
const rangeName = (from: string, to: string) =>
  from.slice(0, 7) === to.slice(0, 7)
    ? periodName(from, to)
    : `${fmtShort(from)} – ${fmtShort(to)}, ${ymdParts(to).y}`;

function money(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const dash = (v: string | null | undefined) =>
  v && Number(v) ? money(v) : "—";

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

const TABLE =
  "w-full border-collapse border border-[#cfd4dc] text-[13px] text-[#1a1a1a]";
const TH =
  "border border-[#cfd4dc] bg-[#f1f3f6] px-3.5 py-2 text-left text-[11.5px] font-semibold whitespace-nowrap text-[#374151]";
const TD = "border border-[#e1e5ea] px-3.5 py-2.5 align-middle";
const NUM = "text-right tabular-nums whitespace-nowrap";
const FLAG = "text-[12px] font-semibold whitespace-nowrap text-[#b45309]";
const NIH = "ml-1.5 text-[11.5px] font-medium whitespace-nowrap text-[#4b5563]";

/** 这一期的第一天（1 号或 16 号），前一期 / 后一期的任何一天都行，后端按这天找期。 */
function shiftPeriod(from: string, dir: -1 | 1): string {
  return dir < 0 ? shiftYmd(from, -1) : shiftYmd(from, 16);
}

function roleOf(run: PayrollRun): string {
  return run.shift === "private_tour"
    ? "Private Tour guide"
    : (ROLE_LABEL[run.role] ?? run.role);
}

function RunRows({ runs, needs }: { runs: PayrollRun[]; needs: boolean }) {
  return (
    <>
      {runs.map((run, i) => {
        const feeShown = run.fee_override !== null || run.rate_fee !== null;
        return (
          <tr key={`${run.assignment_id ?? "x"}-${run.date}-${i}`}>
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
            <td className={TD}>{run.tour}</td>
            <td className={TD}>{roleOf(run)}</td>
            <td className={cn(TD, NUM)}>
              {feeShown ? (
                money(run.fee)
              ) : (
                <span className="text-[#888]">—</span>
              )}
              {run.fee_override !== null ? (
                <span className="ml-1.5 rounded-full bg-[#fed7aa] px-1.5 text-[10px] font-bold text-[#7c2d12]">
                  edited
                </span>
              ) : null}
            </td>
            {needs ? null : (
              <td className={TD}>
                {run.extras.length ? (
                  run.extras.map((x) => (
                    <div key={x.code}>
                      {x.name} {money(x.amount)}
                    </div>
                  ))
                ) : (
                  <span className="text-[#888]">—</span>
                )}
              </td>
            )}
            <td className={cn(TD, NUM)}>
              {run.tips !== null ? (
                money(run.tips)
              ) : (
                <span className="text-[#888]">—</span>
              )}
            </td>
            {needs ? null : (
              <td className={cn(TD, NUM, "font-bold")}>{money(run.total)}</td>
            )}
            <td className={cn(TD, "whitespace-nowrap")}>
              {run.status === "paid" ? (
                <span className="text-[#888]">Paid</span>
              ) : (
                <span className={FLAG}>{STATUS[run.status]?.[0]}</span>
              )}
              {run.day_status === "not_completed" ? (
                <>
                  <br />
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

export function Payroll({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [date, setDate] = useState<string>(() => laToday());
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "forbidden" }
    | { kind: "ready"; data: PayrollPeriod }
  >({ kind: "loading" });
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(
    (d: string, signal?: AbortSignal) => {
      setState({ kind: "loading" });
      fetchPayrollPeriod(d, signal)
        .then((data) => setState({ kind: "ready", data }))
        .catch((e) => {
          if (signal?.aborted) return;
          if (isStatus(e, 401)) onUnauthorized();
          else if (isStatus(e, 403)) setState({ kind: "forbidden" });
          else setState({ kind: "error", message: describeError(e) });
        });
    },
    [onUnauthorized],
  );

  useEffect(() => {
    const c = new AbortController();
    load(date, c.signal);
    return () => c.abort();
  }, [date, load]);

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
      <ErrorBanner actionLabel="Try again" onAction={() => load(date)}>
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
  const sum = (k: "fee" | "extras_total" | "tips") =>
    P.people.reduce(
      (a, p) => a + p.runs.reduce((b, r) => b + Number(r[k] ?? 0), 0),
      0,
    );
  const keyOf = (p: PayrollPeriod["people"][number]) =>
    p.in_hr ? `hr:${p.hr_id}` : `typed:${p.name.trim().toLowerCase()}`;
  const hitLocks = P.locks.filter((l) => l.to >= P.from && l.from <= P.to);

  return (
    <div data-payroll>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-[34px] leading-[1.1] font-bold text-white/90 max-sm:text-[26px]">
            Payroll
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-white/55">
            <span className="inline-flex gap-1">
              <button
                type="button"
                aria-label="Previous period"
                className={cn(HR_BTN_CLASS, "px-[9px] py-0.5")}
                onClick={() => setDate(shiftPeriod(P.from, -1))}
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Next period"
                className={cn(HR_BTN_CLASS, "px-[9px] py-0.5")}
                onClick={() => setDate(shiftPeriod(P.from, 1))}
              >
                ›
              </button>
            </span>
            <b className="text-white/90">{periodName(P.from, P.to)}</b>
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
              ["Period total", money(P.total)],
              ["People", String(P.people.length)],
              ["Counted runs", String(nRuns)],
              ["Needs review", String(P.unpaid.length)],
            ].map(([k, v], i) => (
              <div
                key={k}
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

          <div className={HR_CARD_CLASS}>
            <div className={HR_CARD_HEADER_CLASS}>
              <span className={HR_CARD_TITLE_CLASS}>Payroll by person</span>
              <span className="text-[12px] text-[#4b5563] max-sm:hidden">
                Click a name to see the runs.
              </span>
            </div>
            <div className="overflow-x-auto px-4 pt-3 pb-3">
              <table className={cn(TABLE, "max-sm:min-w-[620px]")}>
                <thead>
                  <tr>
                    <th className={TH}>Person</th>
                    <th className={cn(TH, NUM)}>Runs</th>
                    <th className={cn(TH, NUM)}>Fees</th>
                    <th className={cn(TH, NUM)}>Extras</th>
                    <th className={cn(TH, NUM)}>Tips</th>
                    <th className={cn(TH, NUM)}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {P.people.map((p) => {
                    const k = keyOf(p);
                    const o = open.has(k);
                    const fee = p.runs.reduce((a, r) => a + Number(r.fee), 0);
                    const ex = p.runs.reduce(
                      (a, r) => a + Number(r.extras_total),
                      0,
                    );
                    const tips = p.runs.reduce(
                      (a, r) => a + Number(r.tips ?? 0),
                      0,
                    );
                    return (
                      <Fragment key={k}>
                        <tr
                          className="cursor-pointer hover:bg-[#f8fafc]"
                          tabIndex={0}
                          aria-expanded={o}
                          data-payroll-person={p.name}
                          onClick={() =>
                            setOpen((s) => {
                              const n = new Set(s);
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
                          <td className={cn(TD, "font-semibold")}>
                            <span className="inline-block w-3.5 text-[10px] text-[#4b5563]">
                              {o ? "▼" : "▶"}
                            </span>
                            {p.name}
                            {p.in_hr ? null : (
                              <span className={NIH}>Not in HR</span>
                            )}
                          </td>
                          <td className={cn(TD, NUM)}>{p.runs.length}</td>
                          <td className={cn(TD, NUM)}>{money(fee)}</td>
                          <td className={cn(TD, NUM)}>{dash(String(ex))}</td>
                          <td className={cn(TD, NUM)}>{dash(String(tips))}</td>
                          <td className={cn(TD, NUM, "font-bold")}>
                            {money(p.total)}
                          </td>
                        </tr>
                        {o ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="border border-[#e1e5ea] bg-[#f6f7f9] py-2 pr-3 pl-7"
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
                                    <RunRows runs={p.runs} needs={false} />
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
                                        {money(fee)}
                                      </td>
                                      <td
                                        className={cn(
                                          TD,
                                          NUM,
                                          "border-t-[1.5px] border-t-[#9aa3af]",
                                        )}
                                      >
                                        {dash(String(ex))}
                                      </td>
                                      <td
                                        className={cn(
                                          TD,
                                          NUM,
                                          "border-t-[1.5px] border-t-[#9aa3af]",
                                        )}
                                      >
                                        {dash(String(tips))}
                                      </td>
                                      <td
                                        className={cn(
                                          TD,
                                          NUM,
                                          "border-t-[1.5px] border-t-[#9aa3af]",
                                        )}
                                      >
                                        {money(p.total)}
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
                  <tr className="bg-[#eef0f3] font-bold">
                    <td className={TD}>Period total</td>
                    <td className={cn(TD, NUM)}>{nRuns}</td>
                    <td className={cn(TD, NUM)}>{money(sum("fee"))}</td>
                    <td className={cn(TD, NUM)}>
                      {money(sum("extras_total"))}
                    </td>
                    <td className={cn(TD, NUM)}>{money(sum("tips"))}</td>
                    <td className={cn(TD, NUM)}>{money(P.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {P.unpaid.length ? (
            <div className={HR_CARD_CLASS} data-payroll-needs>
              <div className={HR_CARD_HEADER_CLASS}>
                <span className={HR_CARD_TITLE_CLASS}>
                  Needs review{" "}
                  <span className="text-[12.5px] font-semibold text-[#b45309]">
                    {P.unpaid.length} run{P.unpaid.length === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="text-[12px] text-[#4b5563]">
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
                    <RunRows runs={P.unpaid} needs />
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
