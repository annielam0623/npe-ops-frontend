"use client";

import { useEffect, useRef, useState } from "react";

import type { MapZone } from "@/components/products/manifest-setup-map";
import {
  HINT,
  INPUT,
  MapField,
  SELECT,
  TD,
  TH,
} from "@/components/products/setup-ui";
import {
  CHANGED_RING,
  SaveControl,
  useBlockSave,
} from "@/components/products/unsaved";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  addAllotmentDates,
  addClosedDates,
  deleteAllotment,
  deleteAllotmentDates,
  deleteClosedDates,
  fetchForecastSettings,
  saveAllotment,
  saveOrderDetailBlocks,
  saveRunDays,
} from "@/lib/forecast-api";
import { cn } from "@/lib/utils";
import type {
  ForecastAllotmentSetting,
  ForecastSettings,
  ForecastSettingsBlock,
  ForecastUnmatchedSetting,
} from "@/types";

/** 0 = 星期一（后端按洛杉矶日期、Python weekday()）。 */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
/** 提交键蓝色（全站规矩：蓝色只给提交键）。 */
const ADD_BUTTON =
  "h-7 cursor-pointer rounded-[7px] bg-[#3b82f6] px-3 text-[12px] font-semibold text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-50";
const DELETE_BUTTON =
  "cursor-pointer rounded-[6px] border-[0.5px] border-[#A32D2D] bg-paper px-2.5 py-[3px] text-[11px] text-[#A32D2D] disabled:opacity-50 night:bg-transparent night:text-red-300";

type FieldProps = (z: MapZone) => {
  zone: MapZone;
  active: MapZone | null;
  onZone: (z: MapZone | null) => void;
};

/**
 * Bus Manifest setup 第 9–11 项：7 Days Forecast 的设置（后端 G63；Annie 2026-10-15 看预览同意，admin 才能改）。
 * 9 Running days（每周开哪几天 + 停开日期）、10 Max allotments（每行平常上限 + 按日期段另设）、
 * 11 List each order（这块在 Forecast 上逐单列订单，CCL 的 Private tours）。
 * 团有单独成块的节（Own block）时，9 和 11 每块各一份，用上面的小标签切；10 按行名认（一行只属于一块）。
 * 每次改完都整份重拉，跟后端保持一致；对不上的旧设置（节改了名）列在最下面黄框里可删。
 */
export function ForecastSetupFields({
  manifestId,
  field,
  onStart,
  onFail,
  focusUnmatchedKey,
}: {
  manifestId: number;
  field: FieldProps;
  onStart: () => void;
  onFail: (e: unknown) => void;
  /** Products 页顶部提醒区点了某一条「对不上的设置」跳过来时，这里是那一条的 key（见 unmatchedSettingKey）。 */
  focusUnmatchedKey?: string | null;
}) {
  const [settings, setSettings] = useState<ForecastSettings | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "forbidden" | "error"
  >("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [section, setSection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

  // 9 星期几、10 每行平常的上限、11 逐单列出：改了先放在页面上，这三项一个 Save（Annie 2026-10-29「不要改一点存一点」；
  // 主窗口 eb 2026-10-30 定合成一个 Save、参加 Bus Manifest setup 的 10 分钟自动存）。几块（Own block）各自的改动都留着，切标签不丢。
  // 停开日期、按日期段另设上限的 Add / Delete 本来就是按键，照旧马上存。
  const [runEdits, setRunEdits] = useState<Record<string, number[]>>({});
  const [capEdits, setCapEdits] = useState<Record<string, CapDraft>>({});
  const [listEdits, setListEdits] = useState<Record<string, boolean>>({});
  const changes = settings
    ? pendingChanges(settings, manifestId, runEdits, capEdits, listEdits)
    : { run: [], caps: [], list: [] };
  const dirty =
    changes.run.length + changes.caps.length + changes.list.length > 0;
  const saver = useBlockSave({
    id: `setup:${manifestId}:forecast`,
    label:
      "7 Days Forecast settings (running days, max allotments, list each order)",
    dirty,
    auto: true,
    draftKey: JSON.stringify(changes),
    doSave: async () => {
      if (!settings) return null;
      for (const c of changes.caps) {
        if (!c.time && !c.max) continue;
        const n = Number(c.max);
        if (!/^\d+$/.test(c.max) || n < 1 || n > 9999)
          return `${c.row}: Max guests must be a number from 1 to 9999.`;
      }
      let err: string | null = null;
      onStart();
      try {
        for (const r of changes.run)
          await saveRunDays({
            manifest_id: manifestId,
            section: r.section,
            weekdays: r.weekdays,
          });
        for (const c of changes.caps) {
          if (!c.time && !c.max) {
            if (c.existed) await deleteAllotment(manifestId, c.row);
          } else {
            await saveAllotment({
              manifest_id: manifestId,
              row_label: c.row,
              time_label: c.time,
              max_pax: Number(c.max),
            });
          }
        }
        if (changes.list.length) {
          const on = new Map(changes.list.map((l) => [l.section, l.on]));
          await saveOrderDetailBlocks([
            ...settings.order_detail_blocks.filter(
              (b) => !(b.manifest_id === manifestId && on.has(b.section)),
            ),
            ...changes.list
              .filter((l) => l.on)
              .map((l) => ({ manifest_id: manifestId, section: l.section })),
          ]);
        }
      } catch (e) {
        if (isStatus(e, 401)) {
          onFailRef.current(e);
          return "";
        }
        err = describeError(e);
      }
      // 存上的那几项：重拉后和已存的一样，草稿里去掉；没存上的留着。
      try {
        const fresh = await fetchForecastSettings();
        setSettings(fresh);
        // 按现在的草稿去掉（存的那一两秒里又改的不丢）。
        setRunEdits((m) =>
          pick(
            m,
            pendingChanges(fresh, manifestId, m, {}, {}).run.map(
              (r) => r.section,
            ),
          ),
        );
        setCapEdits((m) =>
          pick(
            m,
            pendingChanges(fresh, manifestId, {}, m, {}).caps.map((c) =>
              capKey(c.row),
            ),
          ),
        );
        setListEdits((m) =>
          pick(
            m,
            pendingChanges(fresh, manifestId, {}, {}, m).list.map(
              (l) => l.section,
            ),
          ),
        );
      } catch (e) {
        if (!err) err = describeError(e);
      }
      return err;
    },
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchForecastSettings(controller.signal)
      .then((s) => {
        setSettings(s);
        setState("ready");
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 403)) {
          setState("forbidden");
          return;
        }
        // 后端 G63 还没上线（404）：不显示这三项，页面其余照旧；别的错误照常报到面板顶上。
        setState("error");
        if (!isStatus(e, 404)) onFailRef.current(e);
      });
    return () => controller.abort();
  }, [reloadKey]);

  if (state === "forbidden") {
    return (
      <p className={cn(HINT, "m-0 px-2.5")}>
        7 Days Forecast settings (running days, max allotments, each order):
        only admins can change them.
      </p>
    );
  }
  if (state !== "ready" || !settings) return null;

  const blocks = settings.blocks.filter((b) => b.manifest_id === manifestId);
  if (!blocks.length) return null;
  const fb = blocks.find((b) => b.section === section) ?? blocks[0];
  const saving = saver.state.kind === "saving";

  /** 一次写操作：出错把后端原话写在这几项上面，成功就整份重拉。 */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    onStart();
    try {
      await action();
      setReloadKey((k) => k + 1);
      return true;
    } catch (e) {
      if (isStatus(e, 401)) onFailRef.current(e);
      else setError(describeError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const unmatched = settings.unmatched.filter(
    (u) => u.manifest_id === manifestId,
  );

  return (
    <div data-forecast-setup className="grid gap-3">
      {blocks.length > 1 ? (
        <div
          role="tablist"
          aria-label="Forecast block"
          className="flex flex-wrap items-center gap-1.5 px-2.5"
        >
          <span className={HINT}>Forecast block:</span>
          {blocks.map((b) => (
            <button
              key={b.section}
              type="button"
              role="tab"
              aria-selected={b.section === fb.section}
              onClick={() => setSection(b.section)}
              className={cn(
                "h-7 rounded-[6px] px-2.5 text-[12px]",
                b.section === fb.section
                  ? "bg-[#1a1a1a] font-semibold text-white night:bg-white/90 night:text-[#06101c]"
                  : "border-[0.5px] border-black/25 bg-paper text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/80",
              )}
            >
              {b.name}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="m-0 px-2.5 text-[12.5px] text-[#b3261e] night:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <RunDaysField
        key={`run:${fb.section}`}
        block={fb}
        settings={settings}
        weekdays={
          runEdits[fb.section] ??
          savedWeekdays(settings, manifestId, fb.section)
        }
        onWeekdays={(w) => setRunEdits((m) => ({ ...m, [fb.section]: w }))}
        changed={changes.run.some((r) => r.section === fb.section)}
        busy={busy || saving}
        field={field}
        run={run}
      />
      <AllotmentsField
        key={`allot:${fb.section}`}
        block={fb}
        settings={settings}
        capEdits={capEdits}
        onCap={(row, d) => setCapEdits((m) => ({ ...m, [capKey(row)]: d }))}
        changedRows={changes.caps.map((c) => capKey(c.row))}
        busy={busy || saving}
        field={field}
        run={run}
      />
      <MapField
        {...field("orderList")}
        title="List each order on the 7 Days Forecast"
        hint="Not printed. Tick it for tours like Private, where the Forecast lists every order (CHD#, pax, tour, pick-up place and time) under the tour. Most tours leave it off. Click Save below to keep it."
      >
        <label
          className={cn(
            "flex items-center gap-2 self-start rounded-[6px] text-[12.5px]",
            changes.list.some((l) => l.section === fb.section) && CHANGED_RING,
          )}
        >
          <input
            type="checkbox"
            aria-label="List each order on the 7 Days Forecast"
            disabled={busy || saving}
            checked={
              listEdits[fb.section] ??
              savedList(settings, manifestId, fb.section)
            }
            onChange={(event) => {
              const on = event.target.checked;
              setListEdits((m) => ({ ...m, [fb.section]: on }));
            }}
          />
          List each order
        </label>
      </MapField>
      <div data-forecast-save className="px-2.5">
        <SaveControl block={saver} />
      </div>

      {unmatched.length ? (
        <UnmatchedBox
          items={unmatched}
          settings={settings}
          busy={busy}
          run={run}
          highlightKey={focusUnmatchedKey ?? null}
        />
      ) : null}
    </div>
  );
}

type Run = (action: () => Promise<unknown>) => Promise<boolean>;

function RunDaysField({
  block,
  settings,
  weekdays,
  onWeekdays,
  changed,
  busy,
  field,
  run,
}: {
  block: ForecastSettingsBlock;
  settings: ForecastSettings;
  /** 页面上现在的星期几（含没存的改动）。 */
  weekdays: number[];
  onWeekdays: (w: number[]) => void;
  changed: boolean;
  busy: boolean;
  field: FieldProps;
  run: Run;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const same = (x: { manifest_id: number; section: string }) =>
    x.manifest_id === block.manifest_id && x.section === block.section;
  const closed = settings.closed_dates
    .filter(same)
    .sort((a, b) => a.date_from.localeCompare(b.date_from));

  function toggle(day: number) {
    onWeekdays(
      weekdays.includes(day)
        ? weekdays.filter((d) => d !== day)
        : [...weekdays, day].sort(),
    );
  }

  async function add() {
    if (!from) return;
    if (
      await run(() =>
        addClosedDates({
          manifest_id: block.manifest_id,
          section: block.section,
          date_from: from,
          date_to: to || from,
          note: note.trim(),
        }),
      )
    ) {
      setFrom("");
      setTo("");
      setNote("");
    }
  }

  return (
    <MapField
      {...field("runDays")}
      title="Running days"
      hint='Not printed. On the 7 Days Forecast a day this tour does not run shows "-" instead of 0. Untick a weekday it never runs and click Save below; add dates it is closed (one day or a range, Add saves it).'
    >
      <div
        role="group"
        aria-label="Runs on"
        data-changed={changed || undefined}
        className={cn(
          "flex flex-wrap items-center gap-1.5 self-start rounded-[7px]",
          changed && CHANGED_RING,
        )}
      >
        {WEEKDAYS.map((name, day) => {
          const on = weekdays.includes(day);
          return (
            <button
              key={name}
              type="button"
              aria-pressed={on}
              disabled={busy}
              onClick={() => toggle(day)}
              className={cn(
                "h-7 rounded-[6px] px-2.5 text-[12px] disabled:opacity-60",
                on
                  ? "bg-[#1a1a1a] font-semibold text-white night:bg-white/90 night:text-[#06101c]"
                  : "border-[0.5px] border-black/25 bg-paper text-[#999] line-through night:border-white/10 night:bg-white/[.04] night:text-white/40",
              )}
            >
              {name}
            </button>
          );
        })}
      </div>
      <div className="mt-1 overflow-x-auto">
        <table className="min-w-[520px] border-collapse text-[12px]">
          <thead>
            <tr>
              <th className={TH}>Closed from</th>
              <th className={TH}>to</th>
              <th className={TH}>Note</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {closed.map((c) => (
              <tr key={c.id} data-closed-date={c.id}>
                <td className={TD}>{c.date_from}</td>
                <td className={TD}>{c.date_to}</td>
                <td className={TD}>{c.note}</td>
                <td className={TD}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => deleteClosedDates(c.id))}
                    className={DELETE_BUTTON}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td className={TD}>
                <input
                  type="date"
                  aria-label="Closed from"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  className={INPUT}
                />
              </td>
              <td className={TD}>
                <input
                  type="date"
                  aria-label="Closed to"
                  value={to}
                  min={from || undefined}
                  onChange={(event) => setTo(event.target.value)}
                  className={INPUT}
                />
              </td>
              <td className={TD}>
                <input
                  type="text"
                  aria-label="Closed note"
                  value={note}
                  maxLength={200}
                  placeholder="Note (optional)"
                  onChange={(event) => setNote(event.target.value)}
                  className={cn(INPUT, "w-[180px]")}
                />
              </td>
              <td className={TD}>
                <button
                  type="button"
                  disabled={busy || !from}
                  onClick={() => void add()}
                  className={ADD_BUTTON}
                >
                  Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className={cn(HINT, "m-0")}>One day: leave &ldquo;to&rdquo; empty.</p>
    </MapField>
  );
}

function AllotmentsField({
  block,
  settings,
  capEdits,
  onCap,
  changedRows,
  busy,
  field,
  run,
}: {
  block: ForecastSettingsBlock;
  settings: ForecastSettings;
  /** 没存的改动（键见 capKey）。 */
  capEdits: Record<string, CapDraft>;
  onCap: (row: string, d: CapDraft) => void;
  /** 改了没存的行（capKey）。 */
  changedRows: string[];
  busy: boolean;
  field: FieldProps;
  run: Run;
}) {
  const mine = settings.allotments.filter(
    (a) =>
      a.manifest_id === block.manifest_id &&
      block.rows.some((r) => sameLabel(r, a.row_label)),
  );
  const dated = mine
    .filter((a) => a.date_from !== null)
    .sort((a, b) => (a.date_from ?? "").localeCompare(b.date_from ?? ""));

  return (
    <MapField
      {...field("allotments")}
      title="Max allotments"
      hint="Not printed. The most guests a row can take each day, and its time slot. The 7 Days Forecast shows the cap and how many seats are left (red when oversold). Type both and click Save below; clear both to remove the cap."
    >
      {block.rows.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-[420px] border-collapse text-[12px]">
            <thead>
              <tr>
                <th className={TH}>Row</th>
                <th className={TH}>Time</th>
                <th className={TH}>Max guests</th>
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => {
                const d =
                  capEdits[capKey(row)] ??
                  savedCap(settings, block.manifest_id, row);
                const changed = changedRows.includes(capKey(row));
                return (
                  <tr
                    key={row}
                    data-allot-row={row}
                    data-changed={changed || undefined}
                  >
                    <td className={cn(TD, "font-semibold")}>{row}</td>
                    <td className={TD}>
                      <input
                        type="text"
                        aria-label={`${row} time`}
                        value={d.time}
                        maxLength={20}
                        placeholder="1p"
                        disabled={busy}
                        onChange={(event) =>
                          onCap(row, { ...d, time: event.target.value })
                        }
                        className={cn(
                          INPUT,
                          "w-[80px]",
                          changed && CHANGED_RING,
                        )}
                      />
                    </td>
                    <td className={TD}>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={`${row} max guests`}
                        value={d.max}
                        placeholder="No cap"
                        disabled={busy}
                        onChange={(event) =>
                          onCap(row, { ...d, max: event.target.value })
                        }
                        className={cn(
                          INPUT,
                          "w-[80px]",
                          changed && CHANGED_RING,
                        )}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={cn(HINT, "m-0")}>This block has no rows yet.</p>
      )}

      {block.rows.length ? (
        <DatedCaps
          manifestId={block.manifest_id}
          rows={block.rows}
          dated={dated}
          busy={busy}
          run={run}
        />
      ) : null}
    </MapField>
  );
}

/** 某段日子换一个上限（Annie 2026-10-15：「Max allotments 这里也给它加个跟上面一样的日期设定」）。 */
function DatedCaps({
  manifestId,
  rows,
  dated,
  busy,
  run,
}: {
  manifestId: number;
  rows: string[];
  dated: ForecastAllotmentSetting[];
  busy: boolean;
  run: Run;
}) {
  const [row, setRow] = useState(rows[0] ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [time, setTime] = useState("");
  const [max, setMax] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  async function add() {
    setProblem(null);
    const n = Number(max.trim());
    if (!/^\d+$/.test(max.trim()) || n < 1 || n > 9999) {
      setProblem("Max guests must be a number from 1 to 9999.");
      return;
    }
    if (
      await run(() =>
        addAllotmentDates({
          manifest_id: manifestId,
          row_label: row,
          date_from: from,
          date_to: to || from,
          time_label: time.trim(),
          max_pax: n,
        }),
      )
    ) {
      setFrom("");
      setTo("");
      setTime("");
      setMax("");
    }
  }

  return (
    <div data-dated-caps className="mt-1.5 flex flex-col gap-1">
      <h4 className="m-0 text-[12px] font-semibold text-[#22324a] night:text-white/90">
        Different cap on these dates
      </h4>
      <p className={cn(HINT, "m-0")}>
        On these dates the row uses this cap and time instead of the one above.
        One day: leave &ldquo;to&rdquo; empty.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-[640px] border-collapse text-[12px]">
          <thead>
            <tr>
              <th className={TH}>Row</th>
              <th className={TH}>From</th>
              <th className={TH}>to</th>
              <th className={TH}>Time</th>
              <th className={TH}>Max guests</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {dated.map((a) => (
              <tr
                key={a.id ?? `${a.row_label}:${a.date_from}`}
                data-dated-cap={a.id ?? ""}
              >
                <td className={cn(TD, "font-semibold")}>{a.row_label}</td>
                <td className={TD}>{a.date_from}</td>
                <td className={TD}>{a.date_to}</td>
                <td className={TD}>{a.time_label}</td>
                <td className={TD}>{a.max_pax}</td>
                <td className={TD}>
                  <button
                    type="button"
                    disabled={busy || a.id === null}
                    onClick={() =>
                      a.id !== null &&
                      void run(() => deleteAllotmentDates(a.id!))
                    }
                    className={DELETE_BUTTON}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td className={TD}>
                <select
                  aria-label="Dated cap row"
                  value={row}
                  onChange={(event) => setRow(event.target.value)}
                  className={SELECT}
                >
                  {rows.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </td>
              <td className={TD}>
                <input
                  type="date"
                  aria-label="Dated cap from"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  className={INPUT}
                />
              </td>
              <td className={TD}>
                <input
                  type="date"
                  aria-label="Dated cap to"
                  value={to}
                  min={from || undefined}
                  onChange={(event) => setTo(event.target.value)}
                  className={INPUT}
                />
              </td>
              <td className={TD}>
                <input
                  type="text"
                  aria-label="Dated cap time"
                  value={time}
                  maxLength={20}
                  placeholder="1p"
                  onChange={(event) => setTime(event.target.value)}
                  className={cn(INPUT, "w-[70px]")}
                />
              </td>
              <td className={TD}>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Dated cap max guests"
                  value={max}
                  placeholder="35"
                  onChange={(event) => setMax(event.target.value)}
                  className={cn(INPUT, "w-[60px]")}
                />
              </td>
              <td className={TD}>
                <button
                  type="button"
                  disabled={busy || !row || !from || !max.trim()}
                  onClick={() => void add()}
                  className={ADD_BUTTON}
                >
                  Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {problem ? (
        <p className="m-0 text-[12px] text-[#b3261e] night:text-red-300">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** 存过、但节改了名对不上的设置：照后端说的删法删（4f 2026-10-15）。 */
/** 稳定的身份（不依赖数组下标），Products 页顶部提醒区用它拼跳转目标的 DOM id。 */
export function unmatchedSettingKey(u: ForecastUnmatchedSetting): string {
  return [
    u.kind,
    u.manifest_id,
    u.section ?? "",
    u.row_label ?? "",
    u.id ?? "",
    u.date_from ?? "",
  ].join(":");
}

function UnmatchedBox({
  items,
  settings,
  busy,
  run,
  highlightKey,
}: {
  items: ForecastUnmatchedSetting[];
  settings: ForecastSettings;
  busy: boolean;
  run: Run;
  /** 和某一条的 unmatchedSettingKey 一样时，那一行亮起来并在挂载时滚过去。 */
  highlightKey?: string | null;
}) {
  const highlightRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlightKey) highlightRef.current?.scrollIntoView({ block: "center" });
  }, [highlightKey]);
  function remove(u: ForecastUnmatchedSetting) {
    switch (u.kind) {
      case "run_days":
        return saveRunDays({
          manifest_id: u.manifest_id,
          section: u.section ?? "",
          weekdays: ALL_WEEKDAYS,
        });
      case "closed_date":
        return deleteClosedDates(u.id!);
      case "allotment":
        return u.date_from
          ? deleteAllotmentDates(u.id!)
          : deleteAllotment(u.manifest_id, u.row_label ?? "");
      case "order_detail":
        return saveOrderDetailBlocks(
          settings.order_detail_blocks.filter(
            (b) =>
              !(
                b.manifest_id === u.manifest_id &&
                b.section === (u.section ?? "")
              ),
          ),
        );
    }
  }
  return (
    <div
      data-unmatched
      className="rounded-[10px] border border-[#f0d080] bg-[#fff8e1] px-4 py-2.5 text-[12px] leading-[1.7] text-[#7C4A00] night:border-amber-400/30 night:bg-amber-400/10 night:text-amber-200"
    >
      <b>Saved settings that no longer match a row or block</b> (a section was
      renamed or removed):
      <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
        {items.map((u) => {
          const itemKey = unmatchedSettingKey(u);
          const isHighlighted = highlightKey === itemKey;
          return (
            <li
              key={itemKey}
              id={`unmatched-${itemKey}`}
              ref={isHighlighted ? highlightRef : undefined}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-[6px]",
                isHighlighted && "bg-[#f0d080]/40 night:bg-amber-400/25",
              )}
            >
              <span>{u.label}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => remove(u))}
                className={DELETE_BUTTON}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 行名不分大小写（后端同样按不分大小写认）。 */
function sameLabel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** 一行平常上限的草稿（输入框原文）。 */
interface CapDraft {
  time: string;
  max: string;
}

/** 草稿按行名认（不分大小写，同后端）。 */
function capKey(row: string): string {
  return row.trim().toLowerCase();
}

function savedWeekdays(
  s: ForecastSettings,
  manifestId: number,
  section: string,
): number[] {
  return (
    s.run_days.find(
      (x) => x.manifest_id === manifestId && x.section === section,
    )?.weekdays ?? ALL_WEEKDAYS
  );
}

function savedCap(s: ForecastSettings, manifestId: number, row: string) {
  const a = s.allotments.find(
    (x) =>
      x.manifest_id === manifestId &&
      x.date_from === null &&
      sameLabel(x.row_label, row),
  );
  return {
    time: a?.time_label ?? "",
    max: a ? String(a.max_pax) : "",
    existed: !!a,
  };
}

function savedList(
  s: ForecastSettings,
  manifestId: number,
  section: string,
): boolean {
  return s.order_detail_blocks.some(
    (b) => b.manifest_id === manifestId && b.section === section,
  );
}

/** 草稿里和已存的不一样的那几项（这个团的；行名、节名都照后端现在的块）。 */
function pendingChanges(
  s: ForecastSettings,
  manifestId: number,
  runEdits: Record<string, number[]>,
  capEdits: Record<string, CapDraft>,
  listEdits: Record<string, boolean>,
) {
  const blocks = s.blocks.filter((b) => b.manifest_id === manifestId);
  const run: { section: string; weekdays: number[] }[] = [];
  const list: { section: string; on: boolean }[] = [];
  const caps: { row: string; time: string; max: string; existed: boolean }[] =
    [];
  for (const b of blocks) {
    const w = runEdits[b.section];
    if (
      w &&
      [...w].sort().join() !==
        [...savedWeekdays(s, manifestId, b.section)].sort().join()
    )
      run.push({ section: b.section, weekdays: [...w].sort() });
    const on = listEdits[b.section];
    if (on !== undefined && on !== savedList(s, manifestId, b.section))
      list.push({ section: b.section, on });
    for (const row of b.rows) {
      const d = capEdits[capKey(row)];
      if (!d) continue;
      const cur = savedCap(s, manifestId, row);
      const time = d.time.trim();
      const max = d.max.trim();
      if (time !== cur.time || max !== cur.max)
        caps.push({ row, time, max, existed: cur.existed });
    }
  }
  return { run, caps, list };
}

/** 只留这几个键（存好的草稿去掉）。 */
function pick<T>(m: Record<string, T>, keys: string[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of keys) if (k in m) out[k] = m[k];
  return out;
}
