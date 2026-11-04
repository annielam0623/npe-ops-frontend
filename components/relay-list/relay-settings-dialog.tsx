"use client";

import { useEffect, useMemo, useState } from "react";

import { Modal } from "@/components/ui/modal";
import { describeError } from "@/lib/api-errors";
import {
  buildPatch,
  busColor,
  busHasOwnDefault,
  busOrientation,
  isHex,
  type DraftTour,
  type Orientation,
  type RelayListSettings,
  type RelaySettingsDraft,
  type RelaySettingsTour,
  resetColors,
  RELAY_SLOTS,
  saveRelayListSettings,
  setAllOrientations,
  toDraft,
  tourAllColor,
  tourOrientation,
} from "@/lib/relay-list-settings-api";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";

/** 蓝色只给 Save（提交）；其余白底。 */
const SAVE_BTN =
  "h-8 rounded-[8px] bg-[#3b82f6] px-[18px] text-[13px] font-bold text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60";
const WHITE_BTN =
  "h-8 rounded-[8px] border border-black/25 bg-white px-3.5 text-[13px] font-semibold text-[#111] hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-60";
const LINK_BTN =
  "cursor-pointer border-0 bg-transparent p-0 text-[12px] text-[#2563eb] underline";

/** 当天这台 relay 车也是哪个团的哪辆车（「Also a relay car today」）。 */
export interface AlsoRelayCar {
  manifestId: number | null;
  tour: string;
  label: string | null;
  who: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; text: string };

/**
 * Relay list ›「⚙ Colours & page」弹窗（置顶 73；preview https://claude.ai/artifact/L7Ks8gymYvsd33Q9DuLGUr 定稿）。
 * 每一行 = 一种单子：颜色 + Portrait / Landscape；改了先暂存，蓝色 Save 才存（一个 PUT），没存关窗 / 跳页要问。
 * 只能看 Dispatch 的人：只读，没有 Save / Reset / Set all。
 */
export function RelaySettingsDialog({
  settings,
  canEdit,
  todayTourIds,
  todayTourNames,
  alsoRelay,
  onSaved,
  onClose,
}: {
  settings: RelayListSettings;
  canEdit: boolean;
  /** 当天有车 / 有客人的团（manifest_id）；默认只列这些，「Show all tours」展开全部。 */
  todayTourIds: Set<number>;
  /** 旧后端 tour_buses 没带 manifest_id 时按团名对。 */
  todayTourNames: Set<string>;
  alsoRelay: AlsoRelayCar[];
  /** 存好了：父组件重读设置和 relay-pull（单子上的颜色由后端算）。 */
  onSaved: () => Promise<void> | void;
  onClose: () => void;
}) {
  const base = useMemo(() => toDraft(settings), [settings]);
  const defaults = useMemo(
    () => settings.defaults?.colors ?? [],
    [settings.defaults],
  );
  const [draft, setDraft] = useState<RelaySettingsDraft>(base);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [asking, setAsking] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // 存好后父组件给的新设置：暂存那份跟着换成存好的。
  useEffect(() => {
    setDraft(base);
  }, [base]);

  const patch = useMemo(
    () => buildPatch(base, draft, defaults),
    [base, draft, defaults],
  );
  const dirty = canEdit && patch !== null;
  useLeaveGuard(
    dirty,
    "Your colour and page changes are not saved. Leave without saving?",
  );

  const edit = (next: RelaySettingsDraft) => {
    setDraft(next);
    setStatus({ kind: "idle" });
  };
  const editTour = (id: string, fn: (t: DraftTour) => DraftTour) =>
    edit({ ...draft, tours: { ...draft.tours, [id]: fn(draft.tours[id]) } });

  async function save(): Promise<boolean> {
    if (!patch) {
      setStatus({ kind: "saved" });
      return true;
    }
    setStatus({ kind: "saving" });
    try {
      await saveRelayListSettings(patch);
    } catch (e) {
      setStatus({ kind: "error", text: describeError(e) });
      return false;
    }
    setStatus({ kind: "saved" });
    // 已经存上了；重读失败只是单子还没换色，父组件自己报（不能写成 Not saved）。
    await onSaved();
    return true;
  }

  const tryClose = () => {
    if (status.kind === "saving") return;
    if (dirty) setAsking(true);
    else onClose();
  };

  const tours = settings.tours ?? [];
  const isToday = (t: RelaySettingsTour) =>
    todayTourIds.has(t.manifest_id) || todayTourNames.has(t.name);
  const todays = tours.filter(isToday);
  const shown = showAll || todays.length === 0 ? tours : todays;
  const hidden = tours.length - shown.length;
  const saving = status.kind === "saving";

  return (
    <Modal
      titleId="relay-settings-title"
      onDismiss={saving ? undefined : tryClose}
      panelClassName="relative flex max-h-[92vh] max-w-[720px] flex-col overflow-hidden text-[13.5px] text-[#111] max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none"
    >
      <div data-relay-settings className="contents">
        <header className="flex items-center justify-between border-b border-black/[.08] px-[18px] py-3.5">
          <h2 id="relay-settings-title" className="text-[16px] font-bold">
            Relay list colours &amp; page
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={tryClose}
            className="cursor-pointer border-0 bg-transparent text-[20px] text-[#555]"
          >
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-black/[.06] bg-[#f8fafc] px-[18px] py-2.5 text-[13px]">
              <span>Page direction:</span>
              <button
                type="button"
                className={WHITE_BTN}
                onClick={() => edit(setAllOrientations(draft, "portrait"))}
              >
                Set all to Portrait
              </button>
              <button
                type="button"
                className={WHITE_BTN}
                onClick={() => edit(setAllOrientations(draft, "landscape"))}
              >
                Set all to Landscape
              </button>
            </div>
          ) : (
            <p className="border-b border-black/[.06] bg-[#f8fafc] px-[18px] py-2.5 text-[12.5px] text-[#475569]">
              View only. Ask someone who can edit Dispatch to change these.
            </p>
          )}

          <Section title="Summary">
            <Row label="RELAY SPLITS" data="summary">
              <span className="text-[12px] text-[#64748b]">No colour</span>
              <Orient
                value={draft.summary}
                disabled={!canEdit}
                onPick={(o) => edit({ ...draft, summary: o })}
              />
            </Row>
          </Section>

          <Section title="Relay cars">
            <p className="mb-1.5 text-[12.5px] text-[#475569]">
              A relay car that is also a tour bus has no Relay number. Set it on
              its bus row under Tour buses.
            </p>
            {Array.from({ length: RELAY_SLOTS }, (_, i) => {
              const custom =
                draft.colors[i] !== (defaults[i] ?? "").toLowerCase();
              return (
                <Row key={i} label={`Relay ${i + 1}`} data={`relay-${i + 1}`}>
                  <ColorCell
                    value={draft.colors[i]}
                    disabled={!canEdit}
                    onChange={(c) =>
                      edit({
                        ...draft,
                        colors: draft.colors.map((x, j) => (j === i ? c : x)),
                      })
                    }
                  />
                  <Meta
                    custom={custom}
                    note="Paper colour"
                    canEdit={canEdit}
                    onReset={() =>
                      edit({
                        ...draft,
                        colors: draft.colors.map((x, j) =>
                          j === i && isHex(defaults[i])
                            ? defaults[i].toLowerCase()
                            : x,
                        ),
                      })
                    }
                  />
                  <Orient
                    value={draft.relay[i]}
                    disabled={!canEdit}
                    onPick={(o) =>
                      edit({
                        ...draft,
                        relay: draft.relay.map((x, j) => (j === i ? o : x)),
                      })
                    }
                  />
                </Row>
              );
            })}
            <p className="mt-1 text-[12px] text-[#64748b]">
              Relay 7 and later reuse these from Relay 1.
            </p>
          </Section>

          <Section title="Tour buses">
            {shown.length === 0 ? (
              <p className="text-[12.5px] text-[#64748b]">No tours.</p>
            ) : null}
            {shown.map((t) => {
              const id = String(t.manifest_id);
              const d = draft.tours[id];
              if (!d) return null;
              return (
                <div
                  key={id}
                  data-relay-settings-tour={t.manifest_id}
                  className="border-t border-dashed border-black/10 py-1.5 first:border-t-0"
                >
                  <div className="my-0.5 font-bold">{t.name}</div>
                  <Row label="All buses" data={`tour-${id}`} indent>
                    <ColorCell
                      value={tourAllColor(t, d)}
                      disabled={!canEdit}
                      onChange={(c) =>
                        editTour(id, (x) => ({ ...x, color: c }))
                      }
                    />
                    <Meta
                      custom={d.color !== null}
                      note="Default colour"
                      canEdit={canEdit}
                      onReset={() =>
                        editTour(id, (x) => ({ ...x, color: null }))
                      }
                    />
                    <Orient
                      value={tourOrientation(d)}
                      disabled={!canEdit}
                      onPick={(o) =>
                        editTour(id, (x) => ({ ...x, orientation: o }))
                      }
                    />
                  </Row>
                  {t.buses.map((b) => {
                    const own = d.buses[b.label];
                    const also = alsoRelay.filter(
                      (a) =>
                        (a.manifestId === t.manifest_id ||
                          (a.manifestId === null && a.tour === t.name)) &&
                        (a.label ?? "") === b.label,
                    );
                    return (
                      <Row
                        key={b.label}
                        label={`Bus ${b.label}`}
                        data={`tour-${id}-${b.label}`}
                        indent
                        sub
                        note={
                          also.length ? (
                            <div
                              data-also-relay
                              className="w-full pl-4 text-[12px] text-[#0f766e]"
                            >
                              ↳ Also a relay car today:{" "}
                              {also.map((a) => a.who).join(", ")}. Its relay
                              sheet uses this row.
                            </div>
                          ) : null
                        }
                      >
                        <ColorCell
                          value={busColor(t, d, b.label)}
                          disabled={!canEdit}
                          onChange={(c) =>
                            editTour(id, (x) => ({
                              ...x,
                              buses: {
                                ...x.buses,
                                [b.label]: { ...x.buses[b.label], color: c },
                              },
                            }))
                          }
                        />
                        <Meta
                          custom={!!own?.color}
                          note={
                            busHasOwnDefault(t, b.label)
                              ? "Default colour"
                              : "Uses All buses"
                          }
                          canEdit={canEdit}
                          onReset={() =>
                            editTour(id, (x) => ({
                              ...x,
                              buses: {
                                ...x.buses,
                                [b.label]: { ...x.buses[b.label], color: null },
                              },
                            }))
                          }
                        />
                        <Orient
                          value={busOrientation(d, b.label)}
                          follow={!own?.orientation}
                          disabled={!canEdit}
                          onPick={(o) =>
                            editTour(id, (x) => ({
                              ...x,
                              buses: {
                                ...x.buses,
                                // 选的和 All buses 一样 = 不单独设（跟着团走）。
                                [b.label]: {
                                  ...x.buses[b.label],
                                  orientation:
                                    o === tourOrientation(x) ? null : o,
                                },
                              },
                            }))
                          }
                        />
                      </Row>
                    );
                  })}
                </div>
              );
            })}
            {hidden > 0 || (showAll && todays.length > 0) ? (
              <button
                type="button"
                className={cn(LINK_BTN, "mt-1")}
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "Show only today's tours" : "Show all tours"}
              </button>
            ) : null}
          </Section>
        </div>

        <footer className="flex flex-wrap items-center gap-2.5 border-t border-black/[.08] px-[18px] py-3">
          <StatusLine status={status} />
          {canEdit ? (
            <button
              type="button"
              className={WHITE_BTN}
              disabled={saving}
              onClick={() => edit(resetColors(draft, defaults))}
            >
              Reset to paper colours
            </button>
          ) : null}
          <span className="flex-1" />
          <button
            type="button"
            className={WHITE_BTN}
            disabled={saving}
            onClick={tryClose}
          >
            {canEdit ? "Cancel" : "Close"}
          </button>
          {canEdit ? (
            <button
              type="button"
              data-relay-settings-save
              className={SAVE_BTN}
              disabled={saving}
              onClick={() => void save()}
            >
              Save
            </button>
          ) : null}
        </footer>

        {asking ? (
          <div
            data-relay-settings-ask
            className="absolute inset-0 z-10 flex items-center justify-center bg-white/[.92]"
          >
            <div className="max-w-[360px] rounded-[10px] border border-black/15 bg-white px-[18px] py-4 shadow-[0_8px_30px_rgba(0,0,0,.15)]">
              <b>You have unsaved changes.</b>
              <p className="mt-1.5 mb-3">Save them before closing?</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className={WHITE_BTN}
                  onClick={() => {
                    setAsking(false);
                    onClose();
                  }}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className={WHITE_BTN}
                  onClick={() => setAsking(false)}
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  className={SAVE_BTN}
                  onClick={async () => {
                    setAsking(false);
                    if (await save()) onClose();
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-black/[.06] px-[18px] py-3">
      <h3 className="mb-1.5 text-[13px] font-semibold tracking-[.03em] text-[#475569] uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({
  label,
  data,
  indent,
  sub,
  note,
  children,
}: {
  label: string;
  data: string;
  indent?: boolean;
  sub?: boolean;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      data-relay-settings-row={data}
      className="flex flex-wrap items-center gap-2.5 py-[3px]"
    >
      <span
        className={cn(
          "w-[150px] max-sm:w-[84px]",
          indent ? "pl-4" : "",
          sub ? "font-medium" : "font-semibold",
        )}
      >
        {label}
      </span>
      {children}
      {note}
    </div>
  );
}

/** 色块 + #rrggbb 文字框：色块直接改；文字框打到合法的 6 位才算。 */
function ColorCell({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (c: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <>
      <input
        type="color"
        aria-label="Colour"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        className="h-6 w-[34px] cursor-pointer rounded-[5px] border border-black/25 bg-transparent p-0 disabled:cursor-default"
      />
      <input
        type="text"
        aria-label="Colour code"
        value={text}
        disabled={disabled}
        maxLength={7}
        onChange={(e) => {
          const v = e.target.value.trim();
          setText(v);
          if (isHex(v)) onChange(v.toLowerCase());
        }}
        onBlur={() => setText(value)}
        className="h-[26px] w-[84px] rounded-[6px] border border-[#cbd5e1] px-1.5 font-mono text-[12.5px] disabled:bg-[#f8fafc]"
      />
    </>
  );
}

function Meta({
  custom,
  note,
  canEdit,
  onReset,
}: {
  custom: boolean;
  note: string;
  canEdit: boolean;
  onReset: () => void;
}) {
  return (
    <span className="flex min-w-[150px] items-center gap-1.5 text-[12px] whitespace-nowrap max-sm:min-w-0">
      {custom ? (
        <>
          <span className="text-[#b45309]">Changed</span>
          {canEdit ? (
            <button type="button" className={LINK_BTN} onClick={onReset}>
              Reset
            </button>
          ) : null}
        </>
      ) : (
        <span className="text-[#64748b] max-sm:hidden">{note}</span>
      )}
    </span>
  );
}

/** Portrait / Landscape 小切换；follow = 跟着 All buses（灰色显示）。 */
function Orient({
  value,
  follow,
  disabled,
  onPick,
}: {
  value: Orientation;
  follow?: boolean;
  disabled: boolean;
  onPick: (o: Orientation) => void;
}) {
  return (
    <span
      data-orient-toggle={value}
      title={follow ? "Uses the All buses row" : undefined}
      className="ml-auto inline-flex overflow-hidden rounded-[7px] border border-[#cbd5e1]"
    >
      {(["portrait", "landscape"] as const).map((o, i) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          disabled={disabled}
          onClick={() => onPick(o)}
          className={cn(
            "px-[9px] py-[3px] text-[12px] disabled:cursor-default",
            i > 0 && "border-l border-[#cbd5e1]",
            value === o
              ? follow
                ? "bg-[#e2e8f0] text-[#334155]"
                : "bg-[#1e293b] font-semibold text-white"
              : "bg-white text-[#334155]",
          )}
        >
          {o === "portrait" ? "Portrait" : "Landscape"}
        </button>
      ))}
    </span>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle") return null;
  return (
    <span
      data-relay-settings-status={status.kind}
      className={cn(
        "basis-full text-[13px] font-semibold",
        status.kind === "saving" && "text-[#475569]",
        status.kind === "saved" && "text-[#16a34a]",
        status.kind === "error" && "text-[#dc2626]",
      )}
    >
      {status.kind === "saving"
        ? "Saving…"
        : status.kind === "saved"
          ? "Saved"
          : `Not saved: ${status.text}`}
    </span>
  );
}
