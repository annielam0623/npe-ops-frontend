"use client";

import { useMemo, useState } from "react";

import { Modal } from "@/components/ui/modal";
import { describeError } from "@/lib/api-errors";
import {
  buildLayoutPatch,
  countChanges,
  effectivePalette,
  resetAll,
  savePrintLayout,
  setSection,
  type PrintLayoutResponse,
  type PrintLayoutSettings,
} from "@/lib/print-layout";
import {
  buildPatch,
  type DraftTour,
  type RelayListSettings,
  type RelaySettingsDraft,
  saveRelayListSettings,
  toDraft,
} from "@/lib/relay-list-settings-api";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { cn } from "@/lib/utils";
import type { ManifestVersion } from "@/types";

import { BUS_MANIFEST_BOXES } from "../print-layout/boxes";
import {
  BoxRows,
  CHANGED,
  ColorField,
  LINK_BTN,
  PagePanel,
  PaletteEditor,
  SectionTitle,
  TabBar,
  TextPanel,
  TicketRules,
} from "../print-layout/layout-panels";
import {
  BUS_MANIFEST_TEXT_LAYOUTS,
  busManifestTextElements,
} from "../print-layout/text-elements";

const SAVE_BTN =
  "h-8 cursor-pointer rounded-[8px] bg-[#3b82f6] px-[18px] text-[13px] font-bold text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60";
const WHITE_BTN =
  "h-8 cursor-pointer rounded-[8px] border border-black/25 bg-white px-3.5 text-[13px] font-semibold text-[#111] hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-60";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; text: string };

/** 车抬头的颜色存在 Relay list 设置里（Relay list 色条、司机页、Bus Manifest 车抬头三处一起变，置顶 73）。 */
export function relayHeaderColor(
  relay: RelayListSettings | null,
  draft: RelaySettingsDraft | null,
  tourId: number,
  busKey: string,
): string | null {
  if (!relay || !draft) return null;
  const t = relay.tours?.find((x) => x.manifest_id === tourId);
  const d = draft.tours[String(tourId)];
  if (!t || !d) return null;
  const b = t.buses.find((x) => x.label === busKey);
  return (
    d.buses[busKey]?.color ??
    d.color ??
    b?.header_default_color ??
    t.header_default_color ??
    null
  );
}

/**
 * Bus Manifest ›「⚙ Colours & page」（置顶 92 第 1 批：Colours + Page；Text 第 2 批再加）。
 * 暂存的两份（版式设置、车抬头所在的 Relay list 设置）放在页面上，改了后面的单子马上跟着变；Save 才存。
 */
export function ManifestLayoutDialog({
  tour,
  version,
  sectionTitles,
  busKeys,
  layout,
  draft,
  onDraft,
  relay,
  relayDraft,
  onRelayDraft,
  dataColor,
  canEdit,
  onSaved,
  onClose,
}: {
  tour: { id: number; name: string };
  /** 这一页现在的版式（Text 页默认打开这一套）。 */
  version: ManifestVersion;
  sectionTitles: { title: string; color: string }[];
  busKeys: string[];
  layout: PrintLayoutResponse;
  draft: PrintLayoutSettings;
  onDraft: (next: PrintLayoutSettings) => void;
  relay: RelayListSettings | null;
  relayDraft: RelaySettingsDraft | null;
  onRelayDraft: (next: RelaySettingsDraft) => void;
  dataColor: (key: string) => string | null;
  canEdit: boolean;
  onSaved: (next: PrintLayoutResponse) => void | Promise<void>;
  /** discard = 丢掉暂存（Cancel / Discard）。 */
  onClose: (discard: boolean) => void;
}) {
  const [tab, setTab] = useState<"colours" | "text" | "page">("colours");
  const [textLayout, setTextLayout] = useState<ManifestVersion>(version);
  const [scope, setScope] = useState<"all" | "tour">("all");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [asking, setAsking] = useState(false);
  const tourKey = String(tour.id);
  const tourId = scope === "tour" ? tourKey : null;
  const base = layout.settings;
  const defaults = layout.defaults;
  const relayBase = useMemo(() => (relay ? toDraft(relay) : null), [relay]);
  const patch = buildLayoutPatch(base, draft);
  const relayPatch =
    relay && relayBase && relayDraft
      ? buildPatch(relayBase, relayDraft, relay.defaults?.colors ?? [])
      : null;
  const changes =
    countChanges(base, draft) +
    (relayPatch ? Object.keys(relayPatch.tour_colors ?? {}).length : 0);
  const dirty = canEdit && (patch !== null || relayPatch !== null);
  useLeaveGuard(
    dirty,
    "Your colour and page changes are not saved. Leave without saving?",
  );
  const palette = effectivePalette(draft, defaults);
  const saving = status.kind === "saving";

  const edit = (next: PrintLayoutSettings) => {
    onDraft(next);
    setStatus({ kind: "idle" });
  };
  const editRelayTour = (fn: (t: DraftTour) => DraftTour) => {
    if (!relayDraft?.tours[tourKey]) return;
    onRelayDraft({
      ...relayDraft,
      tours: { ...relayDraft.tours, [tourKey]: fn(relayDraft.tours[tourKey]) },
    });
    setStatus({ kind: "idle" });
  };

  async function save(): Promise<boolean> {
    if (!dirty) {
      setStatus({ kind: "saved" });
      return true;
    }
    setStatus({ kind: "saving" });
    try {
      let next = layout;
      if (patch) next = await savePrintLayout("bus_manifest", patch);
      if (relayPatch) await saveRelayListSettings(relayPatch);
      setStatus({ kind: "saved" });
      await onSaved(next);
      return true;
    } catch (e) {
      setStatus({ kind: "error", text: describeError(e) });
      return false;
    }
  }

  const tryClose = () => {
    if (saving) return;
    if (dirty) setAsking(true);
    else onClose(false);
  };

  const relayTour = relay?.tours?.find((t) => t.manifest_id === tour.id);
  const relayTourDraft = relayDraft?.tours[tourKey];

  return (
    <Modal
      titleId="manifest-layout-title"
      onDismiss={saving ? undefined : tryClose}
      panelClassName="relative flex max-h-[92vh] max-w-[860px] flex-col overflow-hidden text-[13.5px] text-[#111] max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none"
    >
      <div data-manifest-layout className="contents">
        <header className="flex items-center justify-between border-b border-black/[.08] px-[18px] py-3.5">
          <h2 id="manifest-layout-title" className="text-[16px] font-bold">
            Bus Manifest · Colours, text &amp; page
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
        <TabBar
          tabs={[
            { key: "colours", label: "Colours" },
            { key: "text", label: "Text" },
            { key: "page", label: "Page" },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-black/[.08]">
          {!canEdit ? (
            <p className="border-b border-black/[.06] bg-[#f8fafc] px-[18px] py-2.5 text-[12.5px] text-[#475569]">
              View only. Ask someone who can edit Dispatch to change these.
            </p>
          ) : null}
          {tab === "colours" ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-black/[.06] bg-[#fafafa] px-[18px] py-2.5 text-[12.5px]">
                <span>Apply to</span>
                <span
                  role="group"
                  aria-label="Apply to"
                  className="inline-flex overflow-hidden rounded-[7px] border border-[#9aa]"
                >
                  {(
                    [
                      ["all", "All tours"],
                      ["tour", tour.name],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      data-layout-scope={k}
                      aria-pressed={scope === k}
                      onClick={() => setScope(k)}
                      className="cursor-pointer border-r border-[#9aa] bg-white px-2.5 py-1 text-[12px] font-bold text-[#222] last:border-r-0 aria-pressed:bg-[#1f2937] aria-pressed:text-white"
                    >
                      {label}
                    </button>
                  ))}
                </span>
                <span className="text-[12px] text-[#64748b]">
                  A tour&apos;s own setting wins over All tours.
                </span>
              </div>
              <div className="px-[18px] py-3">
                <BoxRows
                  boxes={BUS_MANIFEST_BOXES.filter(
                  (b) =>
                    !layout.boxes.length ||
                    layout.boxes.some((x) => x.key === b.key),
                )}
                  settings={draft}
                  defaults={defaults}
                  tourId={tourId}
                  canEdit={canEdit}
                  dataColor={dataColor}
                  onChange={edit}
                  renderSpecial={(def, on) =>
                    scope === "all" ? (
                      <span className="text-[12px] text-[#64748b]">
                        Pick {tour.name} above to set its colours.
                      </span>
                    ) : def.kind === "bus_header" ? (
                      relayTour && relayTourDraft ? (
                        <span
                          data-layout-bus-letters
                          className="flex basis-full flex-col gap-1 pl-4"
                        >
                          {(busKeys.length ? busKeys : [""]).map((k) => {
                            const own = k
                              ? relayTourDraft.buses[k]?.color
                              : relayTourDraft.color;
                            return (
                              <span
                                key={k || "all"}
                                data-layout-bus-letter={k || "all"}
                                className={cn(
                                  "flex flex-wrap items-center gap-2",
                                  own && CHANGED,
                                )}
                              >
                                <span className="w-[90px]">
                                  {k ? `Bus ${k}` : "All buses"}
                                </span>
                                <ColorField
                                  value={
                                    relayHeaderColor(
                                      relay,
                                      relayDraft,
                                      tour.id,
                                      k,
                                    ) ?? "#c8cdd3"
                                  }
                                  palette={palette}
                                  disabled={!canEdit || !on}
                                  label={
                                    k
                                      ? `Bus ${k} header colour`
                                      : "Bus header colour"
                                  }
                                  onChange={(c) =>
                                    editRelayTour((t) =>
                                      k
                                        ? {
                                            ...t,
                                            buses: {
                                              ...t.buses,
                                              [k]: { ...t.buses[k], color: c },
                                            },
                                          }
                                        : { ...t, color: c },
                                    )
                                  }
                                />
                                {own && canEdit ? (
                                  <button
                                    type="button"
                                    className={LINK_BTN}
                                    onClick={() =>
                                      editRelayTour((t) =>
                                        k
                                          ? {
                                              ...t,
                                              buses: {
                                                ...t.buses,
                                                [k]: {
                                                  ...t.buses[k],
                                                  color: null,
                                                },
                                              },
                                            }
                                          : { ...t, color: null },
                                      )
                                    }
                                  >
                                    Reset
                                  </button>
                                ) : null}
                              </span>
                            );
                          })}
                          <span className="text-[12px] text-[#64748b]">
                            Also used on the Relay list and the driver page.
                          </span>
                        </span>
                      ) : (
                        <span className="text-[12px] text-[#64748b]">
                          Set on Relay list › ⚙ Colours &amp; page.
                        </span>
                      )
                    ) : (
                      <span
                        data-layout-sections
                        className="flex basis-full flex-col gap-1 pl-4"
                      >
                        {sectionTitles.map((sec) => {
                          const own =
                            draft.colours.tours[tourKey]?.sections?.[
                              sec.title.trim().toLowerCase()
                            ];
                          return (
                            <span
                              key={sec.title}
                              data-layout-section={sec.title}
                              className={cn(
                                "flex flex-wrap items-center gap-2",
                                own && CHANGED,
                              )}
                            >
                              <span className="w-[140px]">{sec.title}</span>
                              <ColorField
                                value={own ?? sec.color}
                                palette={palette}
                                disabled={!canEdit || !on}
                                label={`${sec.title} colour`}
                                onChange={(c) =>
                                  edit(setSection(draft, tourKey, sec.title, c))
                                }
                              />
                              {own && canEdit ? (
                                <button
                                  type="button"
                                  className={LINK_BTN}
                                  onClick={() =>
                                    edit(
                                      setSection(
                                        draft,
                                        tourKey,
                                        sec.title,
                                        null,
                                      ),
                                    )
                                  }
                                >
                                  Reset
                                </button>
                              ) : null}
                            </span>
                          );
                        })}
                      </span>
                    )
                  }
                />
                <SectionTitle>Ticket colours</SectionTitle>
                <TicketRules
                  settings={draft}
                  defaults={defaults}
                  canEdit={canEdit}
                  onChange={edit}
                />
                <SectionTitle>Colour choices</SectionTitle>
                <PaletteEditor
                  settings={draft}
                  defaults={defaults}
                  canEdit={canEdit}
                  onChange={edit}
                />
              </div>
            </>
          ) : tab === "text" ? (
            <div className="px-[18px] py-3">
              <TextPanel
                settings={draft}
                canEdit={canEdit}
                layouts={BUS_MANIFEST_TEXT_LAYOUTS}
                layout={textLayout}
                onLayout={(l) => setTextLayout(l as ManifestVersion)}
                elements={busManifestTextElements(textLayout)}
                note="This is where every day starts, for every tour with this layout. Aa Text size still changes one day's sheet on top of it."
                onChange={edit}
              />
            </div>
          ) : (
            <div className="px-[18px] py-3">
              <PagePanel
                settings={draft}
                defaults={defaults}
                canEdit={canEdit}
                sheets={[
                  { key: "bus", label: "Bus sheet" },
                  { key: "lunch", label: "Lunch sheet" },
                ]}
                note="Print and ⬇ Excel both use these. Smaller margins fit more rows on a page."
                marginNote="10 mm, lunch sheet 9 mm"
                onChange={edit}
              />
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2.5 border-t border-black/[.08] px-[18px] py-3">
          <StatusLine status={status} />
          {canEdit ? (
            <button
              type="button"
              className={LINK_BTN}
              data-layout-reset-all
              disabled={saving}
              onClick={() => {
                edit(resetAll());
                if (relayDraft?.tours[tourKey])
                  editRelayTour((t) => ({
                    ...t,
                    color: null,
                    buses: Object.fromEntries(
                      Object.entries(t.buses).map(([l, b]) => [
                        l,
                        { ...b, color: null },
                      ]),
                    ),
                  }));
              }}
            >
              Reset all to paper
            </button>
          ) : null}
          {dirty ? (
            <span
              data-layout-unsaved
              className="text-[12.5px] font-semibold text-[#b45309]"
            >
              {changes === 1
                ? "1 change not saved"
                : `${changes} changes not saved`}
            </span>
          ) : null}
          <span className="flex-1" />
          <button
            type="button"
            className={WHITE_BTN}
            disabled={saving}
            onClick={() => (dirty ? setAsking(true) : onClose(false))}
          >
            {canEdit ? "Cancel" : "Close"}
          </button>
          {canEdit ? (
            <button
              type="button"
              data-layout-save
              className={SAVE_BTN}
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          ) : null}
        </footer>

        {asking ? (
          <div
            data-layout-ask
            className="absolute inset-0 z-30 flex items-center justify-center bg-white/[.92]"
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
                    onClose(true);
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
                    if (await save()) onClose(false);
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

export function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle") return null;
  return (
    <span
      data-layout-status={status.kind}
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
