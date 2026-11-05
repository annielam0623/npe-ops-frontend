"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ErrorBanner } from "@/components/ui/panel";
import { usePhoneInfo } from "@/components/ui/phone";
import { describeError, isStatus } from "@/lib/api-errors";
import { downloadCsv } from "@/lib/csv";
import {
  fetchFieldCalendarAll,
  fetchFieldCalendarOne,
} from "@/lib/hr-working-record-api";
import { laToday, shiftYmd } from "@/lib/la-date";
import { cn } from "@/lib/utils";
import type {
  FieldCalendarDay,
  FieldCalendarPerson,
  FieldRun,
} from "@/types/hr-working-record";

import {
  HR_BTN_CLASS,
  HR_BTN_PRIMARY_CLASS,
  HR_CARD_CLASS,
  HR_CARD_HEADER_CLASS,
  HR_CARD_TITLE_CLASS,
  HR_EMPTY_CLASS,
} from "./legacy-ui";
import { SnapshotDialog, type SnapshotTarget } from "./snapshot-dialog";
import {
  dayHeader,
  EXPORT_HEADERS,
  exportRows,
  formatHours,
  hasText,
  hoursLine,
  hoursNeedCheck,
  hoursNote,
  monthGrid,
  monthRange,
  monthTitle,
  ROLE_LABEL,
  runTitle,
  sectionOf,
  totalsOf,
  weekDays,
  weekTitle,
  WORK_SECTIONS,
} from "./working-record-utils";

/**
 * Settings › Human Resource › Working Record（置顶 86，Annie「working record这里全部同意推荐，动手」，preview v2
 * https://claude.ai/artifact/U951qPXH1hNBzLbuSGY6Hm）：
 * Q1 C 默认周表看所有人（Drivers / Guides 两节），点名字看此人月历 + 当月合计；Q2 A 格子写角色色 + 团名 + 车号，
 * 📷 有快照、虚线 + live 未存档；Q3 A 快照弹窗；Q4 A 合计 + ⬇ Export for payroll（CSV）；Q5 B 要 Hours；
 * Q6 A 📷 只给也能看 Live drivers 的人（canSnapshot）。整块先只 Super Admin 可见（hr-view 按开关 hr_working_record 判）。
 * 只看不改：没有要存的东西。
 */

type Mode =
  | { view: "all"; span: "week" | "month"; anchor: string }
  | {
      view: "person";
      hrId: number;
      name: string;
      anchor: string;
      back: "week" | "month";
    };

type Load<T> =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

export function WorkingRecord({
  canSnapshot,
  onUnauthorized,
}: {
  canSnapshot: boolean;
  onUnauthorized: () => void;
}) {
  const today = laToday();
  const [mode, setMode] = useState<Mode>({
    view: "all",
    span: "week",
    anchor: today,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [load, setLoad] = useState<Load<FieldCalendarPerson[]>>({
    kind: "loading",
  });
  const [snapshot, setSnapshot] = useState<SnapshotTarget | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const info = usePhoneInfo("About Working Record");

  /** 这一页要的天：周表七天；按月叠的周表 / 月历是整月补满的周。 */
  const weeks = useMemo(
    () =>
      mode.view === "all" && mode.span === "week"
        ? [weekDays(mode.anchor)]
        : monthGrid(mode.anchor),
    [mode],
  );
  /** 合计 / Export 只算这段（月历前后补的格子不算）。 */
  const range = useMemo(
    () =>
      mode.view === "all" && mode.span === "week"
        ? { from: weeks[0][0], to: weeks[0][6] }
        : monthRange(mode.anchor),
    [mode, weeks],
  );
  const fetchFrom = weeks[0][0];
  const fetchTo = weeks[weeks.length - 1][6];
  const personId = mode.view === "person" ? mode.hrId : null;

  const applyError = useCallback(
    (error: unknown) => {
      if (isStatus(error, 401)) onUnauthorized();
      else if (isStatus(error, 404)) setLoad({ kind: "missing" });
      else setLoad({ kind: "error", message: describeError(error) });
    },
    [onUnauthorized],
  );

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setLoad({ kind: "loading" });
    (async () => {
      try {
        const people =
          personId === null
            ? (await fetchFieldCalendarAll(fetchFrom, fetchTo, signal)).people
            : [
                await fetchFieldCalendarOne(
                  personId,
                  fetchFrom,
                  fetchTo,
                  signal,
                ),
              ];
        if (!signal.aborted) setLoad({ kind: "ready", data: people });
      } catch (error) {
        if (!signal.aborted) applyError(error);
      }
    })();
    return () => controller.abort();
  }, [personId, fetchFrom, fetchTo, reloadKey, applyError]);

  const people = load.kind === "ready" ? load.data : [];

  function step(dir: -1 | 1) {
    setMode((m) => {
      if (m.view === "all" && m.span === "week") {
        return { ...m, anchor: shiftYmd(m.anchor, dir * 7) };
      }
      const [y, mo] = m.anchor.split("-").map(Number);
      const next = new Date(Date.UTC(y, mo - 1 + dir, 1))
        .toISOString()
        .slice(0, 10);
      return { ...m, anchor: next };
    });
  }

  /** Q4 A：Export 一律是整月（周表看的是哪一周，就导出那周起始日所在的月）；周表的数据不够整月就另读一次。 */
  async function runExport() {
    if (exporting) return;
    const month = monthRange(mode.anchor);
    const name =
      mode.view === "person"
        ? `${mode.name.replace(/[^A-Za-z0-9]+/g, "-")}_`
        : "";
    setExporting(true);
    setExportError(null);
    try {
      const rows =
        fetchFrom <= month.from && fetchTo >= month.to
          ? people
          : (await fetchFieldCalendarAll(month.from, month.to)).people;
      downloadCsv(
        `working-record_${name}${month.from}_${month.to}.csv`,
        EXPORT_HEADERS,
        exportRows(rows, month.from, month.to),
      );
    } catch (error) {
      if (isStatus(error, 401)) onUnauthorized();
      else setExportError(`Could not export — ${describeError(error)}`);
    } finally {
      setExporting(false);
    }
  }

  function openPerson(p: FieldCalendarPerson) {
    setMode((m) => ({
      view: "person",
      hrId: p.hr_id,
      name: p.name,
      anchor: m.anchor,
      back: m.view === "all" ? m.span : m.back,
    }));
  }

  const onThisPeriod =
    mode.view === "all" && mode.span === "week"
      ? weeks[0].includes(today)
      : mode.anchor.slice(0, 7) === today.slice(0, 7);
  const title =
    mode.view === "all" && mode.span === "week"
      ? weekTitle(weeks[0])
      : monthTitle(range.from);
  const canExport = load.kind === "ready";

  return (
    <div data-working-record>
      <p className="mb-3 text-[12px] text-[#888] night:text-white/55">
        What each driver and guide did each day, for payroll.
        {info.button}
      </p>
      <div
        className={cn(
          "mb-3 max-w-[760px] text-[12px] text-[#888] night:text-white/55",
          info.hide,
        )}
      >
        Click a name for that person&apos;s month and totals.
        {canSnapshot ? " 📷 opens that day's snapshot." : ""} A dashed box
        marked live is not saved yet and follows Dispatch as it is now.
      </div>

      <div
        data-wr-bar
        className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px]"
      >
        {mode.view === "person" ? (
          <>
            <button
              type="button"
              data-wr-back
              onClick={() =>
                setMode({ view: "all", span: mode.back, anchor: mode.anchor })
              }
              className={HR_BTN_CLASS}
            >
              ← All people
            </button>
            <span
              data-wr-person
              className="text-[14px] font-bold text-white night:text-white"
            >
              {mode.name}
              {load.kind === "ready" && people[0]?.position ? (
                <span className="font-normal text-white/70">
                  {" "}
                  · {positionLabel(people[0].position)}
                </span>
              ) : null}
            </span>
          </>
        ) : (
          <div role="group" aria-label="Period" className="flex gap-1.5">
            {(["week", "month"] as const).map((s) => (
              <button
                key={s}
                type="button"
                data-wr-span={s}
                aria-pressed={mode.span === s}
                onClick={() => setMode({ ...mode, span: s })}
                className={
                  mode.span === s ? HR_BTN_PRIMARY_CLASS : HR_BTN_CLASS
                }
              >
                {s === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          aria-label="Previous"
          data-wr-prev
          onClick={() => step(-1)}
          className={HR_BTN_CLASS}
        >
          ‹
        </button>
        <span
          data-wr-title
          className="font-semibold whitespace-nowrap text-white night:text-white"
        >
          {title}
        </span>
        <button
          type="button"
          aria-label="Next"
          data-wr-next
          onClick={() => step(1)}
          className={HR_BTN_CLASS}
        >
          ›
        </button>
        {!onThisPeriod ? (
          <button
            type="button"
            data-wr-today
            onClick={() => setMode({ ...mode, anchor: today })}
            className={HR_BTN_CLASS}
          >
            {mode.view === "all" && mode.span === "week"
              ? "This week"
              : "This month"}
          </button>
        ) : null}
        <button
          type="button"
          data-wr-export
          disabled={!canExport || exporting}
          onClick={() => void runExport()}
          className={cn(HR_BTN_CLASS, "ml-auto")}
        >
          {exporting ? "Preparing…" : "⬇ Export for payroll"}
        </button>
      </div>
      {exportError ? (
        <p
          role="alert"
          data-wr-export-error
          className="mb-3 text-[12.5px] text-[#f87171]"
        >
          {exportError}
        </p>
      ) : null}

      {load.kind === "error" ? (
        <ErrorBanner
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Could not load the Working Record: {load.message}
        </ErrorBanner>
      ) : load.kind === "missing" ? (
        <div data-wr-missing className={HR_CARD_CLASS}>
          <p className={HR_EMPTY_CLASS}>
            The Working Record is not available on the server yet.
          </p>
        </div>
      ) : mode.view === "person" ? (
        <PersonMonth
          person={people[0] ?? null}
          loading={load.kind === "loading"}
          weeks={weeks}
          range={range}
          today={today}
          canSnapshot={canSnapshot}
          onSnapshot={setSnapshot}
        />
      ) : (
        <AllPeople
          people={people}
          loading={load.kind === "loading"}
          weeks={weeks}
          range={range}
          today={today}
          canSnapshot={canSnapshot}
          onOpen={openPerson}
          onSnapshot={setSnapshot}
        />
      )}

      {snapshot ? (
        <SnapshotDialog
          target={snapshot}
          onClose={() => setSnapshot(null)}
          onUnauthorized={onUnauthorized}
        />
      ) : null}
    </div>
  );
}

function positionLabel(position: string): string {
  if (position === "driver") return "Driver";
  if (position === "guide") return "Guide";
  if (position === "both") return "Driver + Guide";
  return "Position not set";
}

interface GridProps {
  weeks: string[][];
  range: { from: string; to: string };
  today: string;
  canSnapshot: boolean;
  onSnapshot: (t: SnapshotTarget) => void;
}

function AllPeople({
  people,
  loading,
  weeks,
  range,
  today,
  canSnapshot,
  onOpen,
  onSnapshot,
}: GridProps & {
  people: FieldCalendarPerson[];
  loading: boolean;
  onOpen: (p: FieldCalendarPerson) => void;
}) {
  return (
    <>
      {WORK_SECTIONS.map((section) => {
        const list = people
          .filter((p) => sectionOf(p.position) === section.key)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (section.key === "unset" && !list.length) return null;
        return (
          <section
            key={section.key}
            data-wr-section={section.key}
            className={HR_CARD_CLASS}
          >
            <div className={HR_CARD_HEADER_CLASS}>
              <h3 className={HR_CARD_TITLE_CLASS}>
                {section.title} — {loading ? "…" : list.length}
              </h3>
              <span className="text-[11.5px] text-[#555] night:text-white/55">
                {section.note}
                {list.length ? " · click a name for the month" : ""}
              </span>
            </div>
            {loading ? (
              <p className={HR_EMPTY_CLASS}>Loading…</p>
            ) : !list.length ? (
              <p className={HR_EMPTY_CLASS}>
                No {section.title.toLowerCase()} worked in this period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] table-fixed border-collapse text-[11.5px]">
                  <colgroup>
                    <col className="w-[130px]" />
                    {weeks[0].map((d) => (
                      <col key={d} />
                    ))}
                  </colgroup>
                  {weeks.map((week) => (
                    <tbody key={week[0]} data-wr-week={week[0]}>
                      <tr>
                        <th className="border-b-[0.5px] border-black/10 bg-[#fafafa] px-2 py-1.5 text-left text-[11px] font-semibold night:border-white/10 night:bg-white/[.03]">
                          Name
                        </th>
                        {week.map((d) => (
                          <th
                            key={d}
                            className={cn(
                              "border-b-[0.5px] border-black/10 bg-[#fafafa] px-2 py-1.5 text-left text-[11px] font-semibold night:border-white/10 night:bg-white/[.03]",
                              d === today &&
                                "text-[#1d4ed8] night:text-sky-300",
                              (d < range.from || d > range.to) && "opacity-40",
                            )}
                          >
                            {dayHeader(d)}
                          </th>
                        ))}
                      </tr>
                      {list.map((p) => {
                        const byDate = new Map(p.days.map((d) => [d.date, d]));
                        return (
                          <tr key={p.hr_id} data-wr-row={p.hr_id}>
                            <td className="border-b-[0.5px] border-black/[.06] px-2 py-1.5 align-top night:border-white/[.06]">
                              <button
                                type="button"
                                data-wr-name={p.hr_id}
                                onClick={() => onOpen(p)}
                                className="cursor-pointer text-left text-[12px] font-bold text-[#1f4e79] underline night:text-sky-300"
                              >
                                {p.name}
                              </button>
                            </td>
                            {week.map((d) => {
                              const outside = d < range.from || d > range.to;
                              const day = outside ? undefined : byDate.get(d);
                              return (
                                <td
                                  key={d}
                                  data-wr-cell={`${p.hr_id}|${d}`}
                                  className={cn(
                                    "h-[54px] border-b-[0.5px] border-l-[0.5px] border-black/[.06] px-1.5 py-1 align-top night:border-white/[.06]",
                                    outside &&
                                      "bg-black/[.03] night:bg-white/[.02]",
                                  )}
                                >
                                  {day ? (
                                    <DayJobs
                                      day={day}
                                      person={p}
                                      canSnapshot={canSnapshot}
                                      onSnapshot={onSnapshot}
                                    />
                                  ) : null}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  ))}
                </table>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

function PersonMonth({
  person,
  loading,
  weeks,
  range,
  today,
  canSnapshot,
  onSnapshot,
}: GridProps & { person: FieldCalendarPerson | null; loading: boolean }) {
  if (loading || !person) {
    return (
      <div className={HR_CARD_CLASS}>
        <p className={HR_EMPTY_CLASS}>Loading…</p>
      </div>
    );
  }
  const byDate = new Map(person.days.map((d) => [d.date, d]));
  const totals = totalsOf(person.days, range.from, range.to);
  return (
    <div className="flex flex-wrap items-start gap-4">
      <section
        data-wr-month
        className={cn(HR_CARD_CLASS, "min-w-0 flex-[2_1_520px] p-2.5")}
      >
        <div className="overflow-x-auto">
          <div className="grid min-w-[560px] grid-cols-7 gap-1">
            {weeks[0].map((d) => (
              <div
                key={d}
                className="px-1 py-0.5 text-[11px] font-semibold text-[#555] night:text-white/55"
              >
                {dayHeader(d).split(" ")[0]}
              </div>
            ))}
            {weeks.flat().map((d) => {
              const outside = d < range.from || d > range.to;
              const day = outside ? undefined : byDate.get(d);
              return (
                <div
                  key={d}
                  data-wr-cell={`${person.hr_id}|${d}`}
                  className={cn(
                    "min-h-[70px] rounded-[6px] border-[0.5px] px-1 py-0.5 text-[11px]",
                    outside
                      ? "border-dashed border-black/15 opacity-50 night:border-white/15"
                      : "border-black/[.12] bg-white night:border-white/10 night:bg-white/[.03]",
                  )}
                >
                  <div
                    className={cn(
                      "text-[10.5px] text-[#555] night:text-white/55",
                      d === today &&
                        "font-bold text-[#1d4ed8] night:text-sky-300",
                    )}
                  >
                    {Number(d.slice(8))}
                  </div>
                  {day ? (
                    <DayJobs
                      day={day}
                      person={person}
                      canSnapshot={canSnapshot}
                      onSnapshot={onSnapshot}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>
      <section
        data-wr-totals
        className={cn(HR_CARD_CLASS, "min-w-[280px] flex-[1_1_280px]")}
      >
        <div className={HR_CARD_HEADER_CLASS}>
          <h3 className={HR_CARD_TITLE_CLASS}>
            {monthTitle(range.from).split(" ")[0]} totals
          </h3>
          {totals.liveDays ? (
            <span className="text-[11px] text-[#b45309] night:text-amber-300">
              includes {totals.liveDays} live day
              {totals.liveDays === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <table className="w-full border-collapse text-[12px]">
          <tbody>
            <TotalsHead label="Worked" />
            <TotalsRow label="Days as Driver" value={totals.days.driver} />
            <TotalsRow label="Days as Guide" value={totals.days.guide} />
            <TotalsRow
              label="Days as Driver & Guide"
              value={totals.days.both}
            />
            <TotalsHead label="By tour" />
            {totals.byTour.length ? (
              totals.byTour.map((t) => (
                <TotalsRow key={t.title} label={t.title} value={t.count} />
              ))
            ) : (
              <tr>
                <td colSpan={2} className="px-2.5 py-1.5 text-[#8a8a8a]">
                  No tours this month.
                </td>
              </tr>
            )}
            <TotalsHead label="Hours" />
            <TotalsRow
              label={`Total (${totals.hoursDays} day${totals.hoursDays === 1 ? "" : "s"} with times)`}
              value={formatHours(totals.hours)}
            />
            {totals.needCheck ? (
              <tr data-wr-check>
                <td
                  colSpan={2}
                  className="px-2.5 py-1.5 font-semibold text-[#b45309] night:text-amber-300"
                >
                  ⚠ {totals.needCheck} day{totals.needCheck === 1 ? "" : "s"}{" "}
                  without full Samsara times — check before payroll.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function TotalsHead({ label }: { label: string }) {
  return (
    <tr>
      <th
        colSpan={2}
        className="border-b-[0.5px] border-black/[.08] bg-[#fafafa] px-2.5 py-1 text-left text-[11px] font-semibold text-[#555] night:border-white/10 night:bg-white/[.03] night:text-white/55"
      >
        {label}
      </th>
    </tr>
  );
}

function TotalsRow({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <tr>
      <td className="border-b-[0.5px] border-black/[.08] px-2.5 py-1 night:border-white/10">
        {label}
      </td>
      <td className="border-b-[0.5px] border-black/[.08] px-2.5 py-1 text-right tabular-nums night:border-white/10">
        {value}
      </td>
    </tr>
  );
}

const ROLE_TEXT: Record<"driver" | "guide" | "both", string> = {
  driver: "text-[#1d4ed8]",
  guide: "text-[#7c3aed]",
  both: "text-[#0f766e]",
};

/** 同一段（同 shift + 段名 + 车）既开车又带团 ⇒ 合成一张「Driver & Guide」。 */
function groupRuns(runs: FieldRun[]) {
  const out: Array<{ run: FieldRun; role: "driver" | "guide" | "both" }> = [];
  for (const r of runs) {
    const same = out.find(
      (x) =>
        x.run.shift === r.shift &&
        runTitle(x.run) === runTitle(r) &&
        (x.run.van ?? "") === (r.van ?? ""),
    );
    if (same && same.role !== r.as) same.role = "both";
    else if (!same) out.push({ run: r, role: r.as });
  }
  return out;
}

function DayJobs({
  day,
  person,
  canSnapshot,
  onSnapshot,
}: {
  day: FieldCalendarDay;
  person: FieldCalendarPerson;
  canSnapshot: boolean;
  onSnapshot: (t: SnapshotTarget) => void;
}) {
  const live = day.source === "live";
  const jobs = groupRuns(day.runs);
  const showCam = canSnapshot && day.snapshot;
  const h = day.hours ?? null;
  const line = h ? hoursLine(h) : null;
  const note = h ? hoursNote(h) : null;
  return (
    <>
      {(jobs.length ? jobs : [null]).map((job, i) => {
        const role = job?.role ?? (day.role === "both" ? "both" : day.role);
        const title = job ? runTitle(job.run) : "";
        return (
          <span
            key={i}
            data-wr-job
            data-wr-live={live ? "" : undefined}
            className={cn(
              "mb-[3px] block rounded-[5px] border-[0.5px] bg-white px-[5px] py-0.5 leading-[1.3] text-[#1a1a1a] night:bg-white/[.06] night:text-white/90",
              live
                ? "border border-dashed border-[#b45309]"
                : "border-black/15 night:border-white/15",
            )}
          >
            <b className={cn("block text-[10.5px]", ROLE_TEXT[role])}>
              {ROLE_LABEL[role]}
              {live ? (
                <span className="ml-[3px] inline-block rounded-[4px] bg-[#fef3c7] px-1 text-[9.5px] font-bold text-[#92400e]">
                  live
                </span>
              ) : null}
              {showCam && i === 0 ? (
                <button
                  type="button"
                  data-wr-cam={`${person.hr_id}|${day.date}`}
                  aria-label={`Open the snapshot for ${person.name} on ${day.date}`}
                  onClick={() =>
                    onSnapshot({
                      hrId: person.hr_id,
                      name: person.name,
                      date: day.date,
                      kind: day.role === "guide" ? "guide" : "driver",
                      other: day.role === "both" ? "guide" : null,
                      hours: h,
                    })
                  }
                  className="float-right cursor-pointer text-[11px]"
                >
                  📷
                </button>
              ) : null}
            </b>
            {hasText(title) ? (
              title
            ) : (
              <span className="text-[#8a8a8a] italic">no tour name</span>
            )}
            {" · "}
            {job && hasText(job.run.van) ? (
              job.run.van
            ) : (
              <span className="text-[#8a8a8a] italic">no van</span>
            )}
          </span>
        );
      })}
      {line || note ? (
        <span
          data-wr-hours={h?.source}
          className={cn(
            "block leading-[1.3]",
            h?.source === "schedule"
              ? "text-[#8a8a8a] night:text-white/45"
              : "text-[#1a1a1a] night:text-white/80",
          )}
        >
          {line}
          {h?.source === "schedule" ? (
            <span className="block text-[10px]">Tour times</span>
          ) : null}
        </span>
      ) : null}
      {hoursNeedCheck(h) && note ? (
        <span
          data-wr-hours-check
          className="mt-0.5 block rounded-[4px] bg-[#fef3c7] px-1 py-px text-[10.5px] leading-[1.3] font-bold text-[#92400e]"
        >
          ⚠ {note}
        </span>
      ) : null}
    </>
  );
}
