"use client";

import { useState, type ReactNode } from "react";

import { laToday } from "@/lib/la-date";
import { seasonOn } from "@/lib/shuttle-seasons";
import { downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import type { PickupLocation, ShuttleRoute, ShuttleSeason } from "@/types";

import {
  buildPickupLocationsCsv,
  type LocationDraft,
  pickupLocationsCsvFilename,
} from "./config";
import {
  BTN_ADD_SMALL_CLASS,
  BTN_EXPORT,
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_TITLE_CLASS,
  HEADER_SEARCH_CLASS,
  TD_CLASS,
  TH_CLASS,
  TR_CLASS,
} from "./legacy-ui";
import { TypeChecks } from "./location-type";
import { type EditState, LocationsTable } from "./locations-table";
import {
  currentSeasons,
  routeNames,
  SeasonGapWarning,
  SeasonsEditor,
  SeasonTabs,
} from "./shuttle-times";

/** 存好的一句绿字（「✓ Saved St George – Main St · 3 times」），出在这个点所在的块。 */
export type SavedNote = { id: number; text: string } | null;

interface Props {
  /** 全部（含停用）；分块、计数用。 */
  locations: PickupLocation[];
  /** 搜索后剩下的。 */
  visible: PickupLocation[];
  search: string;
  onSearch: (q: string) => void;
  loading: boolean;
  edits: Record<number, EditState>;
  busyId: number | null;
  onEdit: (loc: PickupLocation) => void;
  onDraftChange: (id: number, draft: LocationDraft) => void;
  onSave: (id: number) => void;
  onCancel: (id: number) => void;
  onToggleActive: (loc: PickupLocation) => void;
  onTourDeparture: (loc: PickupLocation, on: boolean) => void;
  onDelete: (loc: PickupLocation) => void;
  /** 后端已经有类别（GET 带 is_tour_bus / is_shuttle）：分 Tour bus / Shuttle 两块；否则照旧一张 All Locations。 */
  typesSupported: boolean;
  seasons: ShuttleSeason[];
  routes: ShuttleRoute[];
  onSeasonsSaved: (seasons: ShuttleSeason[]) => void;
  onSeasonsDirty: (dirty: boolean) => void;
  /** Needs a type 黄条里勾好按 Save；失败返回原因。 */
  onClassify: (
    loc: PickupLocation,
    types: { is_tour_bus: boolean; is_shuttle: boolean },
  ) => Promise<string | null>;
  savedNote: SavedNote;
  onUnauthorized: () => void;
}

/**
 * Pickup Locations 的列表部分（preview v3 https://claude.ai/artifact/HTezuw3d3VnNSyo63VJEzN ，
 * Annie 2026-10-29「shuttle改完Q8」「就可以动手了」）：
 * Needs a type 黄条（只在有没归类的点时出）→ Tour bus → Shuttle（季节键 + Times 列 + Edit 下的时刻表）。
 * 同一页上下两块，一个搜索框两块一起搜（v2 Q1 A）；两种都是的点两块都出现（Q5 A）。
 */
export function LocationSections(props: Props) {
  const {
    locations,
    visible,
    search,
    onSearch,
    loading,
    typesSupported,
    savedNote,
  } = props;

  const header = (title: ReactNode, extra?: ReactNode) => (
    <div className={CARD_HEADER_CLASS}>
      <h2 className={CARD_TITLE_CLASS}>{title}</h2>
      {extra}
    </div>
  );
  const tools = (
    <div className="flex items-center gap-2.5">
      {search.trim() && !loading ? (
        <span className="text-[11px] whitespace-nowrap text-[#1a1a1a] tabular-nums night:text-white/35">
          {visible.length} of {locations.length}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => {
          const csv = buildPickupLocationsCsv(locations);
          downloadCsv(pickupLocationsCsvFilename(), csv.headers, csv.rows);
        }}
        disabled={!locations.some((loc) => loc.is_active)}
        title="CSV of the active hotels (opens in Excel)"
        className={BTN_EXPORT}
      >
        ⬇ Export
      </button>
      <input
        type="text"
        inputMode="search"
        autoComplete="off"
        spellCheck={false}
        aria-label="Search"
        value={search}
        placeholder="Search…"
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && search) onSearch("");
        }}
        className={HEADER_SEARCH_CLASS}
      />
    </div>
  );
  const placeholderFor = (list: PickupLocation[]) =>
    loading ? "Loading…" : list.length === 0 ? "No locations found." : null;
  const table = (
    list: PickupLocation[],
    variant: "all" | "tour" | "shuttle",
    extra?: object,
  ) => (
    <LocationsTable
      locations={list}
      edits={props.edits}
      busyId={props.busyId}
      placeholder={placeholderFor(list)}
      onEdit={props.onEdit}
      onDraftChange={props.onDraftChange}
      onSave={props.onSave}
      onCancel={props.onCancel}
      onToggleActive={props.onToggleActive}
      onTourDeparture={props.onTourDeparture}
      onDelete={props.onDelete}
      variant={variant}
      {...extra}
    />
  );

  if (!typesSupported) {
    return (
      <section className={CARD_CLASS}>
        {header("All Locations", tools)}
        {table(visible, "all")}
      </section>
    );
  }

  const unclassified = locations.filter((l) => !l.is_tour_bus && !l.is_shuttle);
  const tour = visible.filter((l) => l.is_tour_bus);
  const shuttle = visible.filter((l) => l.is_shuttle);
  const note = (list: PickupLocation[]) =>
    savedNote && list.some((l) => l.id === savedNote.id) ? (
      <span
        role="status"
        data-saved-note
        className="ml-3 text-[12.5px] font-semibold text-[#15803d] night:text-emerald-300"
      >
        {savedNote.text}
      </span>
    ) : null;
  const count = (n: number, one: string, many: string) => (
    <span className="ml-2 text-[12px] font-normal text-[#6b7280] night:text-white/45">
      {n} {n === 1 ? one : many}
    </span>
  );

  return (
    <>
      {unclassified.length ? (
        <NeedsType locations={unclassified} onClassify={props.onClassify} />
      ) : null}

      <section className={CARD_CLASS} data-block="tour">
        {header(
          <>
            Tour bus
            {count(
              locations.filter((l) => l.is_tour_bus).length,
              "location",
              "locations",
            )}
            {note(tour)}
          </>,
          tools,
        )}
        {table(tour, "tour")}
      </section>

      <ShuttleBlock
        {...props}
        list={shuttle}
        count={count}
        note={note(shuttle)}
        table={table}
      />
    </>
  );
}

function ShuttleBlock({
  list,
  locations,
  seasons,
  routes,
  onSeasonsSaved,
  onSeasonsDirty,
  onUnauthorized,
  count,
  note,
  table,
}: Props & {
  list: PickupLocation[];
  count: (n: number, one: string, many: string) => ReactNode;
  note: ReactNode;
  table: (
    list: PickupLocation[],
    variant: "shuttle",
    extra?: object,
  ) => ReactNode;
}) {
  const today = laToday();
  const current = currentSeasons(seasons, today);
  const todaySeason = seasonOn(today, seasons);
  const [picked, setPicked] = useState<number | null>(null);
  const [editingSeasons, setEditingSeasons] = useState(false);
  // 默认看今天所在的季节（v3）；今天不在任何季节里就看下一个。
  const seasonId =
    (picked != null && current.some((s) => s.id === picked) ? picked : null) ??
    todaySeason?.id ??
    current[0]?.id ??
    null;
  const names = routeNames(routes, locations);
  return (
    <section className={CARD_CLASS} data-block="shuttle">
      <div className={cn(CARD_HEADER_CLASS, "flex-wrap")}>
        <h2 className={CARD_TITLE_CLASS}>
          Shuttle
          {count(locations.filter((l) => l.is_shuttle).length, "stop", "stops")}
          <span className="ml-2 text-[12px] font-normal text-[#6b7280] night:text-white/45">
            · each stop is both the pick-up and the drop-off (Las Vegas:
            pick-up)
          </span>
          {note}
        </h2>
        <SeasonTabs
          seasons={current}
          selectedId={seasonId}
          todayId={todaySeason?.id ?? null}
          onSelect={setPicked}
          onEditSeasons={() => setEditingSeasons(true)}
        />
        <SeasonGapWarning seasons={seasons} />
      </div>
      {editingSeasons ? (
        <SeasonsEditor
          seasons={seasons}
          onSaved={(s) => {
            onSeasonsSaved(s);
            setEditingSeasons(false);
          }}
          onClose={() => setEditingSeasons(false)}
          onDirtyChange={onSeasonsDirty}
          onUnauthorized={onUnauthorized}
        />
      ) : null}
      {table(list, "shuttle", {
        shuttle: { seasonId, seasons: current, routes, names },
      })}
    </section>
  );
}

/** 还没归类的点：黄条，两个勾 + Save（先暂存，按 Save 才存；全部归好这块就不见）。 */
function NeedsType({
  locations,
  onClassify,
}: {
  locations: PickupLocation[];
  onClassify: Props["onClassify"];
}) {
  const [picks, setPicks] = useState<
    Record<number, { is_tour_bus: boolean; is_shuttle: boolean }>
  >({});
  const [saving, setSaving] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  return (
    <section
      className={cn(CARD_CLASS, "border-[#f0d080]")}
      data-block="needs-type"
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b border-[#f0d080] bg-[#fff8e1] px-4 py-3 text-[#7C4A00] night:bg-amber-300/10 night:text-amber-200">
        <h2 className="text-[13px] font-semibold">Needs a type</h2>
        <span className="text-[12px]">
          {locations.length} {locations.length === 1 ? "location" : "locations"}{" "}
          — tick Tour bus, Shuttle, or both, then Save
        </span>
      </div>
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {["Name", "Short (for SMS)", "Type", ""].map((h) => (
              <th
                key={h}
                className={cn(TH_CLASS, "text-[#1a1a1a] night:text-white/35")}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-[#1a1a1a] night:text-white/75">
          {locations.map((loc) => {
            const p = picks[loc.id] ?? {
              is_tour_bus: false,
              is_shuttle: false,
            };
            const ready = p.is_tour_bus || p.is_shuttle;
            return (
              <tr key={loc.id} className={TR_CLASS} data-needs-type={loc.id}>
                <td className={TD_CLASS}>
                  <strong className="text-[12px]">{loc.hotel_name}</strong>
                </td>
                <td className={TD_CLASS}>{loc.instruction_short || "—"}</td>
                <td className={TD_CLASS}>
                  <TypeChecks
                    compact
                    idPrefix={`needs-${loc.id}`}
                    tourBus={p.is_tour_bus}
                    shuttle={p.is_shuttle}
                    disabled={saving === loc.id}
                    onChange={(t) =>
                      setPicks((all) => ({ ...all, [loc.id]: t }))
                    }
                  />
                </td>
                <td className={TD_CLASS}>
                  <button
                    type="button"
                    disabled={!ready || saving === loc.id}
                    onClick={async () => {
                      setSaving(loc.id);
                      const err = await onClassify(loc, p);
                      setSaving(null);
                      setErrors((all) => {
                        const next = { ...all };
                        if (err) next[loc.id] = err;
                        else delete next[loc.id];
                        return next;
                      });
                    }}
                    className={BTN_ADD_SMALL_CLASS}
                  >
                    {saving === loc.id ? "Saving…" : "Save"}
                  </button>
                  {errors[loc.id] ? (
                    <p
                      role="alert"
                      className="mt-1 text-[11px] text-[#A32D2D] night:text-red-300"
                    >
                      {errors[loc.id]}
                    </p>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
