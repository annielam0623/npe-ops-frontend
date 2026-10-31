"use client";

import { useState } from "react";

import { TimePicker } from "@/components/schedule/time-picker";
import { describeError, isStatus } from "@/lib/api-errors";
import { laToday, shiftYmd } from "@/lib/la-date";
import { saveShuttleSeasons } from "@/lib/pickup-locations-api";
import { formatClock } from "@/lib/schedule-time";
import {
  formatSeasonDate,
  formatSeasonRange,
  nextYearSeason,
  seasonOverlaps,
  sortSeasons,
  uncoveredRanges,
} from "@/lib/shuttle-seasons";
import { cn } from "@/lib/utils";
import type { PickupLocation, ShuttleRoute, ShuttleSeason } from "@/types";

import { type TimeRowDraft, timeRowsOf } from "./config";
import {
  BTN_ADD_GREEN_SMALL_CLASS,
  BTN_ADD_SMALL_CLASS,
  BTN_EDIT_CLASS,
} from "./legacy-ui";

/**
 * Shuttle 站的接人时间（preview v3 https://claude.ai/artifact/HTezuw3d3VnNSyo63VJEzN ，
 * Annie 2026-10-29「shuttle改完Q8」「就可以动手了」）：
 * - 季节全站共用（Q12 A），一处定好起止；表上默认看今天所在的季节，可以切；
 * - 每个站 × 线路（Shuttle 产品）× 班次，每季一格：时间 / No service / 没填；
 * - 全部先暂存，按 Save 才存（全站规矩）；存好绿、失败红。
 */

/** 往后看多少天找「没有季节」的日子（季节表后面没接上要提醒）。 */
export const SEASON_LOOKAHEAD_DAYS = 180;

const CHIP =
  "inline-block rounded-[6px] border border-[#f0d080] bg-[#fff8e1] px-[7px] text-[11px] font-semibold whitespace-nowrap text-[#7C4A00] night:border-amber-300/40 night:bg-amber-300/10 night:text-amber-200";
const MONO =
  "font-mono text-[12px] font-semibold text-[#111] night:text-white/90";
const SMALL_BTN = cn(BTN_EDIT_CLASS, "whitespace-nowrap");

/** 表上要列出来的季节：还没结束的（过去的季节不用再看 / 填）。 */
export function currentSeasons(
  seasons: ShuttleSeason[],
  today = laToday(),
): ShuttleSeason[] {
  return sortSeasons(seasons).filter((s) => s.ends_on >= today);
}

/** 线路 id → 显示名：先用服务端给的，再用下拉列表。 */
export function routeNames(
  routes: ShuttleRoute[],
  locations: PickupLocation[],
): Map<number, string> {
  const m = new Map<number, string>();
  for (const r of routes) m.set(r.product_id, r.label);
  for (const loc of locations)
    for (const t of loc.times ?? [])
      if (!m.has(t.product_id)) m.set(t.product_id, t.route_label);
  return m;
}

/**
 * 没有季节的日子写成一句话。一直到往后看的最后一天都没有的（最后一季之后没接上），
 * 写「No season after 某天 yet」，不写往后看的那个截止日（那不是真的日子）。
 */
export function describeGaps(
  gaps: { from: string; to: string }[],
  today = laToday(),
): string {
  const end = shiftYmd(today, SEASON_LOOKAHEAD_DAYS - 1);
  return gaps
    .map((g) =>
      g.to === end
        ? `No season after ${formatSeasonDate(shiftYmd(g.from, -1))} yet`
        : g.from === g.to
          ? `No season on ${formatSeasonDate(g.from)}`
          : `No season from ${formatSeasonDate(g.from)} to ${formatSeasonDate(g.to)}`,
    )
    .join("; ");
}

// ── Shuttle 卡头：季节键 ────────────────────────────────────────────────

export function SeasonTabs({
  seasons,
  selectedId,
  todayId,
  onSelect,
  onEditSeasons,
}: {
  seasons: ShuttleSeason[];
  selectedId: number | null;
  todayId: number | null;
  onSelect: (id: number) => void;
  onEditSeasons: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-season-tabs>
      <span className="text-[12px] text-[#6b7280] night:text-white/45">
        Season:
      </span>
      {seasons.length === 0 ? (
        <span className={CHIP}>No seasons yet</span>
      ) : (
        seasons.map((s) => {
          const on = s.id === selectedId;
          return (
            <button
              key={s.id}
              type="button"
              data-season-tab={s.id}
              aria-pressed={on}
              onClick={() => onSelect(s.id)}
              className={cn(
                "flex cursor-pointer flex-col rounded-[7px] border px-[11px] py-1 text-left leading-tight",
                on
                  ? "border-[#374151] bg-[#374151] text-white"
                  : "border-black/20 bg-white text-[#111] hover:bg-[#fafaf8] night:border-white/15 night:bg-white/[.04] night:text-white/80",
              )}
            >
              <b className="text-[12px]">
                {s.name}
                {s.id === todayId ? (
                  <span
                    className={cn(
                      "ml-1 rounded-full px-[5px] text-[10.5px] font-semibold",
                      on ? "bg-white/20" : "bg-[#e5e7eb] night:bg-white/10",
                    )}
                  >
                    today
                  </span>
                ) : null}
              </b>
              <span className="text-[10.5px] opacity-75">
                {formatSeasonRange(s)}
              </span>
            </button>
          );
        })
      )}
      <button
        type="button"
        onClick={onEditSeasons}
        className="ml-1.5 cursor-pointer text-[12px] font-semibold text-[#2563eb] underline night:text-sky-300"
      >
        Edit seasons
      </button>
    </div>
  );
}

/** 季节表往后没接上：Shuttle 卡头一行黄字（照「只显示问题」，接上就没了）。 */
export function SeasonGapWarning({ seasons }: { seasons: ShuttleSeason[] }) {
  const gaps = uncoveredRanges(seasons, laToday(), SEASON_LOOKAHEAD_DAYS);
  if (!gaps.length) return null;
  return (
    <div
      data-season-gap
      className="basis-full text-[12px] font-semibold text-[#92400e] night:text-amber-200"
    >
      ⚠ {describeGaps(gaps)}
      {" — stops show no times on those days. Add one in Edit seasons."}
    </div>
  );
}

// ── 列表的 Times 格 ───────────────────────────────────────────────────

export function TimesCell({
  loc,
  seasonId,
  seasons,
  names,
}: {
  loc: PickupLocation;
  /** 正在看的季节；null = 还没有任何季节。 */
  seasonId: number | null;
  /** 还没结束的季节（用来提醒「别的季节缺时间」）。 */
  seasons: ShuttleSeason[];
  names: Map<number, string>;
}) {
  const rows = timeRowsOf(loc.times);
  if (!rows.length) return <span className={CHIP}>No times yet</span>;
  const name = (id: number | null) =>
    id == null ? "—" : (names.get(id) ?? `#${id}`);
  const missingElsewhere = seasons
    .filter((s) => s.id !== seasonId)
    .map((s) => ({
      season: s,
      n: rows.filter((r) => !r.cells[s.id]).length,
    }))
    .filter((x) => x.n > 0);
  return (
    <div className="flex flex-col gap-0.5" data-times-cell>
      {rows.map((r) => {
        const cell = seasonId != null ? r.cells[seasonId] : undefined;
        return (
          <div
            key={r.key}
            className="flex items-baseline gap-2 whitespace-nowrap"
          >
            <span
              className={cn(
                cell?.noService
                  ? "text-[#9ca3af] night:text-white/35"
                  : "text-[#4b5563] night:text-white/60",
              )}
            >
              {name(r.product_id)}
            </span>
            {cell?.noService ? (
              <span className="text-[11.5px] text-[#9ca3af] italic night:text-white/35">
                no service
              </span>
            ) : cell?.time ? (
              <b className={MONO}>{formatClock(cell.time)}</b>
            ) : (
              <span className={CHIP}>no time yet</span>
            )}
          </div>
        );
      })}
      {missingElsewhere.map((x) => (
        <span key={x.season.id} className={cn(CHIP, "mt-0.5 self-start")}>
          {x.season.name}: {x.n} {x.n === 1 ? "time" : "times"} missing
        </span>
      ))}
    </div>
  );
}

// ── Edit 下的小时刻表 ──────────────────────────────────────────────────

/** 存之前在页面上就能看出来的错（红字，不发请求）：没选线路、同一条线路同一季同一个时间写了两次。 */
export function timesError(
  rows: TimeRowDraft[],
  seasons: ShuttleSeason[],
  names: Map<number, string>,
): string | null {
  for (const r of rows) {
    const filled = Object.values(r.cells).some((c) => c.time || c.noService);
    if (r.product_id == null && filled)
      return "Pick a route for every time you filled in.";
  }
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.product_id == null) continue;
    for (const s of seasons) {
      const c = r.cells[s.id];
      if (!c?.time || c.noService) continue;
      const k = `${r.product_id}|${s.id}|${c.time}`;
      if (seen.has(k))
        return `${names.get(r.product_id) ?? "This route"} ${formatClock(c.time)} is listed twice in ${s.name}.`;
      seen.add(k);
    }
  }
  return null;
}

let newKey = 0;

export function TimesEditor({
  rows,
  seasons,
  routes,
  names,
  disabled,
  dirty,
  onChange,
}: {
  rows: TimeRowDraft[];
  /** 还没结束的季节，一季一列。 */
  seasons: ShuttleSeason[];
  routes: ShuttleRoute[];
  names: Map<number, string>;
  disabled: boolean;
  /** 和服务端不一样（写「Not saved yet」）。 */
  dirty: boolean;
  onChange: (rows: TimeRowDraft[]) => void;
}) {
  const setRow = (key: string, patch: Partial<TimeRowDraft>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setCell = (
    row: TimeRowDraft,
    sid: number,
    patch: Partial<{ time: string; noService: boolean }>,
  ) =>
    setRow(row.key, {
      cells: {
        ...row.cells,
        [sid]: {
          ...(row.cells[sid] ?? { time: "", noService: false }),
          ...patch,
        },
      },
    });
  const missing = rows
    .filter((r) => r.product_id != null)
    .flatMap((r) =>
      seasons
        .filter((s) => {
          const c = r.cells[s.id];
          return !c || (!c.time && !c.noService);
        })
        .map(
          (s) =>
            `${names.get(r.product_id!) ?? "A route"} has no ${s.name} time`,
        ),
    );
  const added = rows.filter((r) => r.isNew).length;
  const error = timesError(rows, seasons, names);
  return (
    <div
      data-times-editor
      className="max-w-[900px] rounded-[10px] border border-black/[.12] bg-white px-3 py-2.5 night:border-white/10 night:bg-white/[.04]"
    >
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2.5">
        <b className="text-[13px] text-[#111] night:text-white/90">
          Times at this stop
        </b>
        <span className="text-[12px] text-[#6b7280] night:text-white/45">
          Bus at this stop, for both pick-up and drop-off. Guests are told 15
          minutes earlier.
        </span>
      </div>
      {seasons.length === 0 ? (
        <p className="text-[12px] text-[#92400e] night:text-amber-200">
          Add a season first (Edit seasons above), then fill in the times for
          it.
        </p>
      ) : (
        <table className="border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left text-[11px] font-semibold text-[#6b7280] night:text-white/45">
                Route (shuttle product)
              </th>
              {seasons.map((s) => (
                <th
                  key={s.id}
                  className="px-2 py-1 text-left text-[11px] leading-tight font-semibold text-[#6b7280] night:text-white/45"
                >
                  {s.name}
                  <br />
                  <span className="font-normal">{formatSeasonRange(s)}</span>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                data-time-row
                className={r.isNew ? "bg-amber-500/10" : undefined}
              >
                <td className="px-2 py-1">
                  <select
                    aria-label="Route"
                    value={r.product_id ?? ""}
                    disabled={disabled}
                    onChange={(e) =>
                      setRow(r.key, {
                        product_id: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    className="h-8 w-[220px] rounded-[7px] border border-black/25 bg-white px-2 text-[12.5px] text-[#111] night:border-white/20 night:bg-white/[.04] night:text-white/90"
                  >
                    <option value="">Choose a route…</option>
                    {[...names].map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                    {routes.length === 0 && names.size === 0 ? (
                      <option disabled>No shuttle products found</option>
                    ) : null}
                  </select>
                </td>
                {seasons.map((s) => {
                  const c = r.cells[s.id] ?? { time: "", noService: false };
                  const empty = !c.time && !c.noService;
                  return (
                    <td
                      key={s.id}
                      // 没填的格子：淡黄底（同 preview v3 的黄色虚线），下面一行黄字列出来。
                      className={cn(
                        "px-2 py-1 align-top",
                        empty && "bg-[#fdf6e7] night:bg-amber-300/10",
                      )}
                      data-time-cell={s.id}
                      data-empty={empty || undefined}
                    >
                      <div className="flex flex-col gap-0.5">
                        {c.noService ? (
                          <span className="inline-flex h-8 w-[104px] items-center rounded-[6px] border border-dashed border-black/25 px-2.5 text-[12px] text-[#9ca3af] italic night:border-white/20">
                            No service
                          </span>
                        ) : (
                          <TimePicker
                            tone="light"
                            allowEmpty
                            ariaLabel={`${s.name} time`}
                            value={c.time}
                            onChange={(v) => setCell(r, s.id, { time: v })}
                          />
                        )}
                        <label className="flex items-center gap-1 text-[11px] text-[#6b7280] night:text-white/45">
                          <input
                            type="checkbox"
                            checked={c.noService}
                            disabled={disabled}
                            onChange={(e) =>
                              setCell(r, s.id, {
                                noService: e.target.checked,
                                time: "",
                              })
                            }
                          />
                          No service
                        </label>
                      </div>
                    </td>
                  );
                })}
                <td className="px-2 py-1 align-top whitespace-nowrap">
                  <button
                    type="button"
                    aria-label="Remove this route"
                    disabled={disabled}
                    onClick={() =>
                      onChange(rows.filter((x) => x.key !== r.key))
                    }
                    className={SMALL_BTN}
                  >
                    ×
                  </button>
                  {r.isNew ? (
                    <span className="ml-2 rounded-full bg-amber-500/20 px-[7px] text-[10.5px] font-bold text-[#92400e]">
                      new
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled || seasons.length === 0}
          onClick={() =>
            onChange([
              ...rows,
              {
                key: `new-${++newKey}`,
                product_id: null,
                cells: {},
                isNew: true,
              },
            ])
          }
          className={BTN_ADD_GREEN_SMALL_CLASS}
        >
          + Add time
        </button>
        {dirty ? (
          <span
            data-times-unsaved
            className="text-[12.5px] font-semibold text-[#b45309] night:text-amber-300"
          >
            Not saved yet
            {added ? `: ${added} ${added === 1 ? "time" : "times"} added` : ""}.
            Click Save on this row to keep it.
          </span>
        ) : null}
        {error ? (
          <span
            role="alert"
            data-times-error
            className="text-[12.5px] font-semibold text-[#b91c1c] night:text-red-300"
          >
            {error}
          </span>
        ) : null}
        {missing.length ? (
          <span
            data-times-missing
            className="basis-full text-[12px] text-[#92400e] night:text-amber-200"
          >
            ⚠ {missing.join("; ")}. Pick a time or No service (you can still
            save).
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ── Edit seasons（全站一处）──────────────────────────────────────────────

interface SeasonDraft {
  key: string;
  id?: number;
  name: string;
  starts_on: string;
  ends_on: string;
}

export function SeasonsEditor({
  seasons,
  onSaved,
  onClose,
  onDirtyChange,
  onUnauthorized,
}: {
  seasons: ShuttleSeason[];
  onSaved: (seasons: ShuttleSeason[]) => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onUnauthorized: () => void;
}) {
  const initial = (): SeasonDraft[] =>
    sortSeasons(seasons).map((s) => ({ key: `s${s.id}`, ...s }));
  const [rows, setRowsState] = useState<SeasonDraft[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setRows = (next: SeasonDraft[]) => {
    setRowsState(next);
    setError(null);
    onDirtyChange(
      JSON.stringify(next.map(strip)) !== JSON.stringify(initial().map(strip)),
    );
  };
  const valid = rows.filter((r) => r.starts_on && r.ends_on);
  const overlaps = seasonOverlaps(valid);
  const gaps = uncoveredRanges(valid, laToday(), SEASON_LOOKAHEAD_DAYS);
  const bad = new Set(overlaps.flatMap((o) => [o.a.key, o.b.key]));

  async function save() {
    for (const r of rows) {
      if (!r.name.trim()) return setError("Every season needs a name.");
      if (!r.starts_on || !r.ends_on)
        return setError(`${r.name}: fill in both dates.`);
      if (r.starts_on > r.ends_on)
        return setError(`${r.name}: From is after To.`);
    }
    if (overlaps.length) {
      const o = overlaps[0];
      return setError(
        `Could not save: ${o.a.name} and ${o.b.name} overlap (${formatSeasonDate(o.from)} – ${formatSeasonDate(o.to)}). A day can only be in one season. Nothing was saved.`,
      );
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveShuttleSeasons(
        rows.map((r) => ({
          ...(r.id ? { id: r.id } : {}),
          name: r.name.trim(),
          starts_on: r.starts_on,
          ends_on: r.ends_on,
        })),
      );
      onDirtyChange(false);
      onSaved(saved);
    } catch (e) {
      if (isStatus(e, 401)) return onUnauthorized();
      setError(`Could not save: ${describeError(e)} Nothing was saved.`);
    } finally {
      setSaving(false);
    }
  }

  const input =
    "h-8 rounded-[7px] border bg-white px-2 text-[12.5px] text-[#111] night:bg-white/[.04] night:text-white/90";
  return (
    <div
      data-seasons-editor
      className="mx-4 mt-3 mb-1 max-w-[820px] rounded-[10px] border border-black/[.12] bg-white px-3 py-2.5 night:border-white/10 night:bg-white/[.04]"
    >
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2.5">
        <b className="text-[13px] text-[#111] night:text-white/90">Seasons</b>
        <span className="text-[12px] text-[#6b7280] night:text-white/45">
          Used by every shuttle stop. Each stop fills in a time (or No service)
          for each season.
        </span>
      </div>
      <table className="border-collapse text-[12.5px]">
        <thead>
          <tr>
            {["Name", "From", "To", ""].map((h) => (
              <th
                key={h}
                className="px-2 py-1 text-left text-[11px] font-semibold text-[#6b7280] night:text-white/45"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-season-row>
              <td className="px-2 py-1">
                <input
                  type="text"
                  aria-label="Season name"
                  value={r.name}
                  disabled={saving}
                  placeholder="e.g. Summer 2027"
                  onChange={(e) =>
                    setRows(
                      rows.map((x) =>
                        x.key === r.key ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                  className={cn(
                    input,
                    "w-[170px] border-black/25 night:border-white/20",
                  )}
                />
              </td>
              {(["starts_on", "ends_on"] as const).map((k) => (
                <td key={k} className="px-2 py-1">
                  <input
                    type="date"
                    aria-label={k === "starts_on" ? "From" : "To"}
                    value={r[k]}
                    disabled={saving}
                    onChange={(e) =>
                      setRows(
                        rows.map((x) =>
                          x.key === r.key ? { ...x, [k]: e.target.value } : x,
                        ),
                      )
                    }
                    className={cn(
                      input,
                      "w-[150px]",
                      bad.has(r.key)
                        ? "border-[1.5px] border-[#dc2626]"
                        : "border-black/25 night:border-white/20",
                    )}
                  />
                </td>
              ))}
              <td className="px-2 py-1">
                <button
                  type="button"
                  aria-label="Remove this season"
                  disabled={saving}
                  onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                  className={SMALL_BTN}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          disabled={saving}
          onClick={() =>
            setRows([
              ...rows,
              { key: `new-${++newKey}`, name: "", starts_on: "", ends_on: "" },
            ])
          }
          className={BTN_ADD_GREEN_SMALL_CLASS}
        >
          + Add season
        </button>
        <button
          type="button"
          disabled={saving || rows.length === 0}
          title="Adds next year's seasons with the same dates; change them if they differ."
          onClick={() => {
            const last = sortSeasons(valid);
            const lastYear = last.length
              ? last[last.length - 1].starts_on.slice(0, 4)
              : null;
            const copies = last
              .filter((s) => s.starts_on.slice(0, 4) === lastYear)
              .map((s) => ({ key: `new-${++newKey}`, ...nextYearSeason(s) }));
            setRows([...rows, ...copies]);
          }}
          className={SMALL_BTN}
        >
          Copy to next year
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className={BTN_ADD_SMALL_CLASS}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            onDirtyChange(false);
            onClose();
          }}
          className={SMALL_BTN}
        >
          Cancel
        </button>
        {error ? (
          <span
            role="alert"
            data-seasons-error
            className="basis-full text-[12.5px] font-semibold text-[#b91c1c] night:text-red-300"
          >
            {error}
          </span>
        ) : overlaps.length ? (
          <span
            data-seasons-overlap
            className="basis-full text-[12.5px] font-semibold text-[#b91c1c] night:text-red-300"
          >
            {overlaps[0].a.name || "A season"} and{" "}
            {overlaps[0].b.name || "another season"} overlap (
            {formatSeasonDate(overlaps[0].from)} –{" "}
            {formatSeasonDate(overlaps[0].to)}). A day can only be in one
            season.
          </span>
        ) : gaps.length ? (
          <span
            data-seasons-gap
            className="basis-full text-[12px] font-semibold text-[#92400e] night:text-amber-200"
          >
            ⚠ {describeGaps(gaps)}. You can still save; stops show no times on
            those days.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function strip(r: SeasonDraft) {
  return { id: r.id, name: r.name, starts_on: r.starts_on, ends_on: r.ends_on };
}
