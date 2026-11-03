"use client";

import { useId, useRef, useState } from "react";

import {
  DARK_PRIMARY_BUTTON_CLASS,
  DARK_SECONDARY_BUTTON_CLASS,
} from "@/components/ui/buttons";
import { usePhoneInfo } from "@/components/ui/phone";
import { describeError } from "@/lib/api-errors";
import {
  fetchScheduleSettings,
  updateShiftTypeDefaults,
  updateWorkWindow,
} from "@/lib/schedule-api";
import { formatClock } from "@/lib/schedule-time";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import type { ScheduleSettings, ScheduleShiftType } from "@/types";

import { TimePicker } from "./time-picker";

/** 能改的人没改时也照样看得到的那句：怎么要权限（Annie 2026-11-02「需要加一个可以edit的权限让我来Admin里勾选」）。 */
const ASK_PERMISSION =
  "You can view these. Ask a Super Admin for the “Settings: Schedule work window and shift types” permission to change them.";

type Defaults = Record<string, [string, string]>;

function defaultsOf(types: ScheduleShiftType[]): Defaults {
  const out: Defaults = {};
  for (const t of types)
    out[t.key] = [t.default_start_time ?? "", t.default_end_time ?? ""];
  return out;
}

/**
 * 排班页的设置集中一处（Annie 2026-11-02「所以两个edit，到底哪个管用」「可以集中在一起管各自不同的功能么」，
 * preview 97MgNcpw28p7W4DxXmpgrM 第 3 版「同意全部推荐。动手」）：Working hours、Default shift times 两块，
 * 一个 Save（10-29 规矩：先暂存、按 Save 才存；有没存的改动时关窗先问）。
 * 能改照 Team 页的勾 settings.schedule（Super Admin 恒能改，后端保存接口本来就按这一项查）；没勾的排班人只读。
 * 「Different by day」七行等后端按天设上线再接（f8 派工：先只做 Same every day，不出灰掉的选项）。
 */
export function ScheduleSettingsDialog({
  settings,
  canChange,
  onSaved,
  onClose,
}: {
  settings: ScheduleSettings;
  canChange: boolean;
  onSaved: (settings: ScheduleSettings) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const types = settings.shift_types.filter((t) => t.is_active);
  // 后端还没带默认时间（旧版）时整块不出（同原来的 DefaultShiftTimes）。
  const hasDefaults = types.some((t) => t.default_start_time !== undefined);
  const [start, setStart] = useState(settings.work_window.start_time);
  const [end, setEnd] = useState(settings.work_window.end_time);
  const [defaults, setDefaults] = useState<Defaults>(() => defaultsOf(types));
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; lines: string[] }
  >({ kind: "idle" });
  const [askClose, setAskClose] = useState(false);
  const pressedOnBackdropRef = useRef(false);
  const hoursInfo = usePhoneInfo("About working hours");
  const defaultsInfo = usePhoneInfo("About default shift times");
  const confirmInfo = usePhoneInfo("About staff confirmation");

  const hoursDirty =
    start !== settings.work_window.start_time ||
    end !== settings.work_window.end_time;
  const changedTypes = types.filter((t) => {
    const [s, e] = defaults[t.key] ?? ["", ""];
    return (
      s !== (t.default_start_time ?? "") || e !== (t.default_end_time ?? "")
    );
  });
  const dirty = canChange && (hoursDirty || changedTypes.length > 0);
  useLeaveGuard(dirty, "You have unsaved schedule settings.");

  const unsaved = [
    hoursDirty ? "working hours" : null,
    changedTypes.length
      ? `default times for ${changedTypes.map((t) => t.label).join(", ")}`
      : null,
  ].filter(Boolean);

  async function save(): Promise<boolean> {
    setState({ kind: "saving" });
    const lines: string[] = [];
    let hoursOk = true;
    if (hoursDirty) {
      try {
        await updateWorkWindow({ start_time: start, end_time: end });
      } catch (err) {
        hoursOk = false;
        lines.push(`Working hours not saved — ${describeError(err)}`);
      }
    }
    const failedTypes = new Set<string>();
    for (const t of changedTypes) {
      const [s, e] = defaults[t.key] ?? ["", ""];
      try {
        // 后端：两个都带时间 = 设置，两个都 null = 清除；只填一个会 400（原话显示出来）。
        await updateShiftTypeDefaults(t, {
          default_start_time: s || null,
          default_end_time: e || null,
        });
      } catch (err) {
        failedTypes.add(t.key);
        lines.push(
          `Default shift times not saved — ${t.label}: ${describeError(err)}`,
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
      }
      const next = defaultsOf(fresh.shift_types.filter((t) => t.is_active));
      setDefaults((cur) => {
        const out = { ...next };
        for (const key of failedTypes) if (cur[key]) out[key] = cur[key];
        return out;
      });
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
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
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
            </div>
          ) : (
            <p className="text-[13px] text-white/85">
              {timeText(
                settings.work_window.start_time,
                settings.work_window.end_time,
              )}
            </p>
          )}
        </section>

        {hasDefaults ? (
          <section
            data-settings-defaults
            className="border-t border-white/10 py-3"
          >
            <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-white">
              Default shift times {defaultsInfo.button}
            </h3>
            <p
              className={cn(
                "mt-0.5 mb-2 text-[12.5px] text-white/75",
                defaultsInfo.hide,
              )}
            >
              Pre-filled times for new shifts only. Does not change shifts
              already scheduled or the gap check.
            </p>
            {canChange ? (
              <div className="grid grid-cols-[minmax(52px,110px)_auto_auto_auto_1fr] items-center gap-x-2 gap-y-1.5 text-[13px]">
                {types.map((t) => {
                  const [s, e] = defaults[t.key] ?? ["", ""];
                  const set = (i: 0 | 1, v: string) =>
                    setDefaults((d) => {
                      const cur = d[t.key] ?? ["", ""];
                      const next: [string, string] = [cur[0], cur[1]];
                      next[i] = v;
                      return { ...d, [t.key]: next };
                    });
                  return (
                    <div
                      key={t.key}
                      className="contents"
                      data-default-row={t.key}
                    >
                      <span className="font-semibold text-white/90">
                        {t.label}
                      </span>
                      <TimePicker
                        ariaLabel={`${t.label} start`}
                        allowEmpty
                        value={s}
                        onChange={(v) => set(0, v)}
                      />
                      <span className="text-white/60">–</span>
                      <TimePicker
                        ariaLabel={`${t.label} end`}
                        allowEmpty
                        value={e}
                        onChange={(v) => set(1, v)}
                      />
                      <span>
                        {s || e ? (
                          <button
                            type="button"
                            onClick={() =>
                              setDefaults((d) => ({ ...d, [t.key]: ["", ""] }))
                            }
                            className="cursor-pointer text-[11.5px] text-white/55 hover:text-white"
                          >
                            Clear
                          </button>
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px] text-white/85">
                {types
                  .map(
                    (t) =>
                      `${t.label} ${timeText(t.default_start_time, t.default_end_time)}`,
                  )
                  .join(" · ")}
              </p>
            )}
          </section>
        ) : null}

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
                Not saved yet: {unsaved.join(", ")} changed
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
