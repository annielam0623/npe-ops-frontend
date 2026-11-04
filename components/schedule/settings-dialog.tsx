"use client";

import { useId, useRef, useState } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { usePhoneInfo } from "@/components/ui/phone";
import { describeError } from "@/lib/api-errors";
import {
  createShiftType,
  fetchScheduleSettings,
  shiftTypeKeyFor,
  updateShiftType,
  updateWorkHours,
  updateWorkWindow,
} from "@/lib/schedule-api";
import type { Rule } from "@/lib/schedule-engine";
import { formatClock } from "@/lib/schedule-time";
import {
  type DayHours,
  sameEveryDay,
  WEEKDAY_SHORT,
  weekDays,
  workHoursSummary,
} from "@/lib/schedule-work-hours";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import type { ScheduleSettings, ScheduleWorkHours } from "@/types";

import type { DescribeContext } from "./rules";
import {
  rowChanges,
  rowsOf,
  type ShiftTypeRow,
  ShiftTypesEditor,
  sortOrders,
  unsavedShiftTypeParts,
  validateShiftTypes,
} from "./shift-types-editor";
import { TimePicker } from "./time-picker";

/** 能改的人没改时也照样看得到的那句：怎么要权限（Annie 2026-11-02「需要加一个可以edit的权限让我来Admin里勾选」）。 */
const ASK_PERMISSION =
  "You can view these. Ask a Super Admin for the “Settings: Schedule work window and shift types” permission to change them.";

/**
 * 排班页的设置集中一处（Annie 2026-11-02「所以两个edit，到底哪个管用」「可以集中在一起管各自不同的功能么」，
 * preview 97MgNcpw28p7W4DxXmpgrM 第 3 版「同意全部推荐。动手」）：Working hours、Shift types 两块
 * （Shift types 原来叫 Default shift times，置顶 85 起能新增 / 改名 / 停用 / 排序 / 选颜色，见 shift-types-editor.tsx），
 * 一个 Save（10-29 规矩：先暂存、按 Save 才存；有没存的改动时关窗先问）。
 * 能改照 Team 页的勾 settings.schedule（Super Admin 恒能改，后端保存接口本来就按这一项查）；没勾的排班人只读。
 * Working hours 按星期几（Annie 2026-11-02「可以选择一周的时间，也可以分别设置几天的时间不同」，⑦⑧⑨ A）：
 * 后端带了 work_hours 才出「Same every day / Different by day」两个选项和七行（No coverage needed、Copy Monday to all days）；
 * 旧后端没有就照旧一组时间、走 work-window 接口。
 */
export function ScheduleSettingsDialog({
  settings,
  canChange,
  rules,
  ruleCtx,
  onSaved,
  onClose,
}: {
  settings: ScheduleSettings;
  canChange: boolean;
  /** 停用提醒用（还有开着的规则用这个班次类型）；读不到 = 不提醒。 */
  rules: Rule[] | null;
  ruleCtx: DescribeContext;
  onSaved: (settings: ScheduleSettings) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  // Shift types（置顶 85）：停用的也列出来（能再勾回 Active），按后端顺序。
  const types = settings.shift_types;
  const activeTypes = types.filter((t) => t.is_active);
  // 后端还没带默认时间（旧版）时不出时间那两格。
  const hasDefaults = types.some((t) => t.default_start_time !== undefined);
  // 后端带了 work_hours（v144）才能按天设。
  const byDaySupported = !!settings.work_hours;
  const savedDays = weekDays(settings);
  const savedSame = sameEveryDay(settings);
  const [start, setStart] = useState(settings.work_window.start_time);
  const [end, setEnd] = useState(settings.work_window.end_time);
  const [same, setSame] = useState(savedSame);
  const [days, setDays] = useState<DayHours[]>(savedDays);
  const [rows, setRows] = useState<ShiftTypeRow[]>(() => rowsOf(types));
  const [errorIds, setErrorIds] = useState<Set<string>>(new Set());
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; lines: string[] }
  >({ kind: "idle" });
  const [askClose, setAskClose] = useState(false);
  const pressedOnBackdropRef = useRef(false);
  const hoursInfo = usePhoneInfo("About working hours");
  const defaultsInfo = usePhoneInfo("About shift types");
  const confirmInfo = usePhoneInfo("About staff confirmation");

  /** 要存的那一份（按天设）：Same every day 时 7 天都是那一组、都不勾 No coverage needed。 */
  const draftHours = (): ScheduleWorkHours => ({
    same_every_day: same,
    days: (same
      ? days.map(() => ({ start_time: start, end_time: end, off: false }))
      : days
    ).map((d, weekday) => ({ weekday, ...d })),
  });
  const savedHours: ScheduleWorkHours = {
    same_every_day: savedSame,
    days: savedDays.map((d, weekday) => ({ weekday, ...d })),
  };
  const hoursDirty = byDaySupported
    ? JSON.stringify(draftHours()) !== JSON.stringify(savedHours)
    : start !== settings.work_window.start_time ||
      end !== settings.work_window.end_time;
  const setDay = (i: number, patch: Partial<DayHours>) =>
    setDays((cur) => cur.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const typeParts = unsavedShiftTypeParts(rows, types);
  const dirty = canChange && (hoursDirty || typeParts.length > 0);
  useLeaveGuard(dirty, "You have unsaved schedule settings.");

  const unsaved = [hoursDirty ? "working hours changed" : null, ...typeParts]
    .filter(Boolean)
    .join(", ");

  async function save(): Promise<boolean> {
    // 名字空着 / 重名 / 默认时间只填一个：页面上先挡，一样都不存。
    const invalid = validateShiftTypes(rows, types);
    if (invalid.length) {
      setErrorIds(new Set(invalid.map(([id]) => id)));
      setState({ kind: "error", lines: invalid.map(([, l]) => l) });
      return false;
    }
    setErrorIds(new Set());
    setState({ kind: "saving" });
    const lines: string[] = [];
    let hoursOk = true;
    if (hoursDirty) {
      try {
        if (byDaySupported) await updateWorkHours(draftHours());
        else await updateWorkWindow({ start_time: start, end_time: end });
      } catch (err) {
        hoursOk = false;
        lines.push(`Working hours not saved — ${describeError(err)}`);
      }
    }
    // 班次类型：改了的已有类型逐个 PUT（整行一起送），新加的逐个 POST；一个失败不挡别的，失败的留在弹窗里。
    const failedTypes = new Set<string>();
    const sorts = sortOrders(rows, types);
    const byKey = new Map(types.map((t) => [t.key, t]));
    const taken = types.map((t) => t.key);
    for (const r of rows) {
      const saved = r.key ? byKey.get(r.key) : undefined;
      const sort = sorts.get(r.id) ?? 0;
      const input = {
        label: r.label.trim(),
        sort_order: sort,
        // 后端：两个都带时间 = 设置，两个都 null = 清除。
        default_start_time: r.start || null,
        default_end_time: r.end || null,
        color: r.color,
      };
      if (saved) {
        const c = rowChanges(r, saved);
        if (
          !c.renamed &&
          !c.color &&
          !c.times &&
          !c.active &&
          sort === saved.sort_order
        )
          continue;
        try {
          await updateShiftType(saved.key, { ...input, is_active: r.active });
        } catch (err) {
          failedTypes.add(r.id);
          lines.push(
            `Shift type not saved — ${saved.label}: ${describeError(err)}`,
          );
        }
        continue;
      }
      const key = shiftTypeKeyFor(input.label, taken);
      taken.push(key);
      try {
        await createShiftType({ ...input, key });
        // 新加时就不勾 Active 的：后端 POST 不收 is_active，建好再停用。
        if (!r.active)
          await updateShiftType(key, { ...input, is_active: false });
      } catch (err) {
        failedTypes.add(r.id);
        lines.push(
          `Shift type not saved — ${input.label}: ${describeError(err)}`,
        );
      }
    }
    let fresh: ScheduleSettings | null = null;
    try {
      fresh = await fetchScheduleSettings();
      onSaved(fresh);
    } catch (err) {
      lines.push(describeError(err));
    }
    // 存上的那几块跟着库里的值走；没存上的留在页面上，改了再按 Save。
    if (fresh) {
      if (hoursOk) {
        setStart(fresh.work_window.start_time);
        setEnd(fresh.work_window.end_time);
        setSame(sameEveryDay(fresh));
        setDays(weekDays(fresh));
      }
      const next = rowsOf(fresh.shift_types);
      if (failedTypes.size === 0) setRows(next);
      else {
        // 存上的跟着库里走；没存上的（含没建成的新类型）留在原位置，改了再按 Save。
        const freshById = new Map(next.map((r) => [r.id, r]));
        setRows((cur) => {
          const out = cur.flatMap((r) =>
            failedTypes.has(r.id)
              ? [r]
              : r.key && freshById.has(r.key)
                ? [freshById.get(r.key)!]
                : [],
          );
          // 这次新建成功的类型从库里补进来（它们在页面上是 new-N，库里有了 key）。
          for (const r of next)
            if (!out.some((x) => x.key === r.key)) out.push(r);
          return out;
        });
      }
    }
    setState(lines.length ? { kind: "error", lines } : { kind: "saved" });
    return lines.length === 0;
  }

  function requestClose() {
    if (state.kind === "saving") return;
    if (dirty) setAskClose(true);
    else onClose();
  }

  const timeText = (
    s: string | null | undefined,
    e: string | null | undefined,
  ) => (s && e ? `${formatClock(s)} – ${formatClock(e)}` : "not set");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 max-sm:items-stretch max-sm:p-0"
      onMouseDown={(event) => {
        pressedOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (
          pressedOnBackdropRef.current &&
          event.target === event.currentTarget
        )
          requestClose();
        pressedOnBackdropRef.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-schedule-settings
        className="flex max-h-[90vh] w-full max-w-[640px] flex-col overflow-y-auto rounded-xl border border-white/10 bg-[#0d1b2e] p-5 text-white/90 shadow-[0_8px_40px_rgba(0,0,0,.45)] max-sm:max-h-none max-sm:rounded-none max-sm:p-3"
      >
        <div className="flex items-center justify-between gap-3 pb-2">
          <h2 id={titleId} className="text-[16px] font-semibold text-white">
            Schedule settings
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={requestClose}
            className="cursor-pointer px-1 text-[18px] leading-none text-white/60 hover:text-white"
          >
            ×
          </button>
        </div>

        <section data-settings-hours className="border-t border-white/10 py-3">
          <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-white">
            Working hours {hoursInfo.button}
          </h3>
          <p
            className={cn(
              "mt-0.5 mb-2 text-[12.5px] text-white/75",
              hoursInfo.hide,
            )}
          >
            Gaps are checked inside these hours.
          </p>
          {canChange ? (
            <>
              {byDaySupported ? (
                <label className="my-1 flex cursor-pointer items-center gap-2 text-[12.5px] text-white/90">
                  <input
                    type="radio"
                    name="work-hours-mode"
                    data-hours-mode="same"
                    checked={same}
                    onChange={() => {
                      // 切回七天一样：用 Monday 那一组（preview：「All days will use …」）。
                      setStart(days[0].start_time);
                      setEnd(days[0].end_time);
                      setSame(true);
                    }}
                  />
                  Same every day
                </label>
              ) : null}
              {same || !byDaySupported ? (
                <div
                  className={cn(
                    "flex flex-wrap items-center gap-2 text-[13px]",
                    byDaySupported && "ml-6",
                  )}
                >
                  <TimePicker
                    ariaLabel="Working hours start"
                    value={start}
                    onChange={setStart}
                  />
                  <span className="text-white/60">–</span>
                  <TimePicker
                    ariaLabel="Working hours end"
                    value={end}
                    onChange={setEnd}
                  />
                  {byDaySupported && !savedSame && same ? (
                    <span className="text-[12px] text-[#fcd34d]">
                      All days will use {formatClock(start)} –{" "}
                      {formatClock(end)}.
                    </span>
                  ) : null}
                </div>
              ) : null}
              {byDaySupported ? (
                <label className="my-1 flex cursor-pointer items-center gap-2 text-[12.5px] text-white/90">
                  <input
                    type="radio"
                    name="work-hours-mode"
                    data-hours-mode="by-day"
                    checked={!same}
                    onChange={() => {
                      // 从七天一样切过来：七行先都填上那一组，再逐天改。
                      if (same)
                        setDays((cur) =>
                          cur.map((d) => ({
                            ...d,
                            start_time: start,
                            end_time: end,
                          })),
                        );
                      setSame(false);
                    }}
                  />
                  Different by day
                </label>
              ) : null}
              {byDaySupported && !same ? (
                <div className="ml-6">
                  <div className="grid grid-cols-[40px_auto_auto_auto_1fr] items-center gap-x-2 gap-y-1.5 text-[13px] max-sm:grid-cols-[34px_auto_auto_auto]">
                    {days.map((d, i) => (
                      <div key={i} className="contents" data-work-day={i}>
                        <span className="font-semibold text-white/90">
                          {WEEKDAY_SHORT[i]}
                        </span>
                        <TimePicker
                          ariaLabel={`${WEEKDAY_SHORT[i]} start`}
                          value={d.start_time}
                          onChange={(v) => setDay(i, { start_time: v })}
                        />
                        <span className="text-white/60">–</span>
                        <TimePicker
                          ariaLabel={`${WEEKDAY_SHORT[i]} end`}
                          value={d.end_time}
                          onChange={(v) => setDay(i, { end_time: v })}
                        />
                        <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-white/65 max-sm:col-span-4 max-sm:mb-1">
                          <input
                            type="checkbox"
                            data-day-off={i}
                            checked={d.off}
                            onChange={(e) =>
                              setDay(i, { off: e.target.checked })
                            }
                          />
                          No coverage needed
                        </label>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    data-copy-monday
                    onClick={() =>
                      setDays((cur) =>
                        cur.map((d) => ({
                          ...d,
                          start_time: cur[0].start_time,
                          end_time: cur[0].end_time,
                        })),
                      )
                    }
                    className={cn(
                      DARK_SECONDARY_BUTTON_CLASS,
                      "mt-2 px-2 py-0.5 text-[11.5px]",
                    )}
                  >
                    Copy Monday to all days
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-[13px] text-white/85">
              {workHoursSummary(settings)}
            </p>
          )}
        </section>

        <section
          data-settings-defaults
          className="border-t border-white/10 py-3"
        >
          <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-white">
            Shift types {defaultsInfo.button}
          </h3>
          <div
            className={cn(
              "mt-0.5 mb-2 flex flex-col gap-1 text-[12.5px] text-white/75",
              defaultsInfo.hide,
            )}
          >
            <p>
              Default times pre-fill new shifts only. Untick Active to stop
              offering a shift type; shifts already scheduled keep it.
            </p>
            {/* How to use 那段（置顶 85 Q5，2c 定放这里的说明里，不另加框）。 */}
            <p data-shift-types-help className="text-white/60">
              Shift types (Super Admin): open ⚙ Settings → Shift types. Click +
              Add shift type, type a name, pick a colour and, if you like,
              default times, then press Save. To rename a shift type, change its
              name and press Save; shifts already scheduled and your rules show
              the new name. Untick Active to stop offering a shift type; shifts
              already scheduled keep it. Drag ⋮⋮ to change the order of the
              buttons in Add shift.
            </p>
          </div>
          {canChange ? (
            <ShiftTypesEditor
              rows={rows}
              setRows={(update) => {
                setRows(update);
                // 页面上没过检查的红字：一改就收起，页脚回到黄字「Not saved yet」（后端的红字留到下次 Save）。
                if (errorIds.size) {
                  setErrorIds(new Set());
                  setState({ kind: "idle" });
                }
              }}
              types={types}
              showTimes={hasDefaults}
              rules={rules}
              ruleCtx={ruleCtx}
              errorIds={errorIds}
            />
          ) : (
            <p className="text-[13px] text-white/85">
              {activeTypes
                .map((t) =>
                  hasDefaults
                    ? `${t.label} ${timeText(t.default_start_time, t.default_end_time)}`
                    : t.label,
                )
                .join(" · ")}
            </p>
          )}
        </section>

        <section className="border-t border-white/10 py-3">
          <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-white">
            Staff confirmation {confirmInfo.button}
          </h3>
          <p
            className={cn(
              "mt-0.5 text-[12.5px] text-white/75",
              confirmInfo.hide,
            )}
          >
            The Wednesday reminder and the staff confirm page are turned on and
            off in Settings › Notifications.
          </p>
        </section>

        {askClose ? (
          <div
            data-settings-ask-close
            className="rounded-lg border border-white/20 bg-[#0b1727] p-3"
          >
            <p className="mb-2 text-[13px] text-white/85">
              You have unsaved changes in Schedule settings. Save them before
              closing?
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setAskClose(false)}
                className={DARK_SECONDARY_BUTTON_CLASS}
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className={DARK_SECONDARY_BUTTON_CLASS}
              >
                Discard
              </button>
              <button
                type="button"
                onClick={async () => {
                  setAskClose(false);
                  if (await save()) onClose();
                }}
                className={DARK_PRIMARY_BUTTON_CLASS}
              >
                Save
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
          <div className="min-w-0 flex-1 text-[12.5px]">
            {!canChange ? (
              <span className="text-white/55 italic">{ASK_PERMISSION}</span>
            ) : state.kind === "error" ? (
              <div role="alert" data-settings-error className="text-red-300">
                {state.lines.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            ) : dirty ? (
              <span data-settings-unsaved className="text-[#fcd34d]">
                Not saved yet: {unsaved}
              </span>
            ) : state.kind === "saved" ? (
              <span
                data-settings-saved
                className="font-semibold text-emerald-400"
              >
                Saved
              </span>
            ) : null}
          </div>
          {canChange ? (
            <>
              <button
                type="button"
                onClick={requestClose}
                disabled={state.kind === "saving"}
                className={DARK_SECONDARY_BUTTON_CLASS}
              >
                {dirty ? "Cancel" : "Close"}
              </button>
              <button
                type="button"
                data-settings-save
                onClick={() => void save()}
                disabled={!dirty || state.kind === "saving"}
                className={DARK_PRIMARY_BUTTON_CLASS}
              >
                {state.kind === "saving" ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className={DARK_SECONDARY_BUTTON_CLASS}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
