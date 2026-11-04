"use client";

import { Fragment, useState } from "react";

import { cn } from "@/lib/utils";
import type { PickupLocation, ShuttleRoute, ShuttleSeason } from "@/types";

import {
  ALIASES_MAX,
  DIRECTION_OPTIONS,
  type LocationDraft,
  safeHref,
  SHORT_MAX,
  shortenUrl,
  splitMapImages,
  URL_MAX,
} from "./config";
import {
  BTN_ADD_SMALL_CLASS,
  BTN_DELETE_CLASS,
  BTN_EDIT_CLASS,
  BTN_OFF_CLASS,
  BTN_ON_CLASS,
  INLINE_INPUT_CLASS,
  TD_CLASS,
  TH_CLASS,
  TBODY_CLASS,
  TR_CLASS,
  TR_HOVER,
} from "./legacy-ui";
import { MapImageInputs } from "./location-fields";
import { AlsoTag, TypeChecks } from "./location-type";
import { TimesCell, TimesEditor } from "./shuttle-times";

/** 一行正在编辑的状态：草稿、保存中、保存失败的原因。 */
export interface EditState {
  draft: LocationDraft;
  saving: boolean;
  error: string | null;
  /** 打开编辑时的样子：和 draft 不一样 = 有没存的改动（时刻表写「Not saved yet」、离开页面先问）。 */
  original?: LocationDraft;
}

/**
 * 表格用在哪一块（preview v3）：all = 后端还没有类别时照旧一张 All Locations；
 * tour = Tour bus 那块（有「Tour bus departure」勾）；shuttle = Shuttle 那块（没有那个勾，多一列 Times，Edit 下面展开时刻表）。
 */
export type TableVariant = "all" | "tour" | "shuttle";

/** Shuttle 块要的：正在看哪一季、还没结束的季节、线路下拉和线路名。 */
export interface ShuttleTableProps {
  seasonId: number | null;
  seasons: ShuttleSeason[];
  routes: ShuttleRoute[];
  names: Map<number, string>;
}

/** .loc-tbl thead td：表头字色（旧模板 #999，2026-10-14 改 #1a1a1a）。 */
const TH = cn(TH_CLASS, "text-[#1a1a1a] night:text-white/35");
/** Short / Details / Aliases 三列：12px（旧模板行内 #666，2026-10-14 改 #1a1a1a）。 */
const TD_SOFT = cn(
  TD_CLASS,
  "text-[#1a1a1a] night:text-white/55 [overflow-wrap:anywhere]",
);
/** .url-link */
const URL_LINK =
  "text-[11px] text-[#378ADD] night:text-sky-300 no-underline [overflow-wrap:anywhere] hover:underline";

export function LocationsTable({
  locations,
  edits,
  busyId,
  placeholder,
  onEdit,
  onDraftChange,
  onSave,
  onCancel,
  onToggleActive,
  onTourDeparture,
  onDelete,
  variant = "all",
  shuttle,
  showDirection = false,
}: {
  locations: PickupLocation[];
  /** 打开编辑的行（按 id）；搜索时草稿保留。 */
  edits: Record<number, EditState>;
  /** 正在停用 / 恢复 / 删除的行。 */
  busyId: number | null;
  placeholder: string | null;
  onEdit: (loc: PickupLocation) => void;
  onDraftChange: (id: number, draft: LocationDraft) => void;
  onSave: (id: number) => void;
  onCancel: (id: number) => void;
  onToggleActive: (loc: PickupLocation) => void;
  onTourDeparture: (loc: PickupLocation, on: boolean) => void;
  onDelete: (loc: PickupLocation) => void;
  variant?: TableVariant;
  /** variant = shuttle 时给。 */
  shuttle?: ShuttleTableProps;
  /** 出 Direction 列（后端有了才出，Shuttle 块不出；置顶 72）。 */
  showDirection?: boolean;
}) {
  const isShuttle = variant === "shuttle";
  const cols = (isShuttle ? 8 : 7) + (showDirection ? 1 : 0);
  const seasonName = shuttle?.seasons.find(
    (x) => x.id === shuttle.seasonId,
  )?.name;
  return (
    <div className="overflow-x-auto">
      {/* 手机上表格不挤成一字一行：给个最小宽度，左右滑着看。 */}
      <table className="w-full border-collapse text-[12px] max-sm:min-w-[760px]">
        <thead>
          <tr>
            <th className={cn(TH, "w-[13%]")}>
              {isShuttle ? "Stop" : "Hotel Name"}
            </th>
            {showDirection ? (
              <th
                className={cn(TH, "w-[8%]")}
                title="Used by Auto on Dispatch → Seat guests to split guests between buses. Not set counts as Flexible."
              >
                Direction
              </th>
            ) : null}
            {isShuttle ? (
              <th className={cn(TH, "w-[19%] bg-amber-300/10")}>
                Times{seasonName ? ` — ${seasonName}` : ""}
              </th>
            ) : null}
            <th
              className={cn(
                TH,
                isShuttle ? "w-[12%]" : showDirection ? "w-[13%]" : "w-[16%]",
              )}
            >
              Photo URL
            </th>
            <th
              className={cn(TH, "w-[15%]")}
              title="The picture itself, shown inline to the guest. Not the same as Photo URL, which is a page they click."
            >
              Map image
            </th>
            <th className={cn(TH, "w-[15%]")}>Short (for SMS)</th>
            <th className={cn(TH, showDirection ? "w-[15%]" : "w-[20%]")}>
              Details (email &amp; guest page &amp; AI Agent)
            </th>
            <th
              className={cn(TH, "w-[9%]")}
              title="Internal spellings that resolve to this hotel. Never shown to a guest."
            >
              Aliases
              {/* Bus Manifest 印酒店简称用第一个 alias（Annie 10-28 定 7，preview 第 8 版 ①）。 */}
              <span
                data-aliases-hint
                className="block text-[10px] font-normal normal-case"
              >
                First one is printed on the Bus Manifest
              </span>
            </th>
            <th className={cn(TH, "w-[12%]")}>Actions</th>
          </tr>
        </thead>
        <tbody className={TBODY_CLASS}>
          {placeholder ? (
            <tr>
              <td
                colSpan={cols}
                className="p-5 text-center text-[#1a1a1a] night:text-white/35"
              >
                {placeholder}
              </td>
            </tr>
          ) : (
            locations.map((loc) =>
              edits[loc.id] ? (
                <EditRow
                  key={loc.id}
                  id={loc.id}
                  edit={edits[loc.id]}
                  onChange={(draft) => onDraftChange(loc.id, draft)}
                  onSave={() => onSave(loc.id)}
                  onCancel={() => onCancel(loc.id)}
                  variant={variant}
                  shuttle={shuttle}
                  cols={cols}
                  showDirection={showDirection}
                />
              ) : (
                <ViewRow
                  key={loc.id}
                  loc={loc}
                  variant={variant}
                  shuttle={shuttle}
                  showDirection={showDirection}
                  busy={busyId === loc.id}
                  onEdit={() => onEdit(loc)}
                  onToggleActive={() => onToggleActive(loc)}
                  onTourDeparture={(on) => onTourDeparture(loc, on)}
                  onDelete={() => onDelete(loc)}
                />
              ),
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

function Dash() {
  return <span className="text-[#1a1a1a] night:text-white/35">—</span>;
}

function ViewRow({
  loc,
  variant,
  shuttle,
  showDirection,
  busy,
  onEdit,
  onToggleActive,
  onTourDeparture,
  onDelete,
}: {
  loc: PickupLocation;
  variant: TableVariant;
  shuttle?: ShuttleTableProps;
  showDirection: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onTourDeparture: (on: boolean) => void;
  onDelete: () => void;
}) {
  const photoHref = safeHref(loc.photo_url);
  const images = splitMapImages(loc.map_image_url);
  return (
    <tr className={cn(TR_CLASS, TR_HOVER, !loc.is_active && "opacity-55")}>
      <td className={cn(TD_CLASS, "[overflow-wrap:anywhere]")}>
        <strong className="text-[12px]">{loc.hotel_name}</strong>
        {!loc.is_active ? (
          <span className="ml-1.5 inline-block rounded-full bg-[#f0f0ee] px-[7px] py-px align-middle text-[10px] font-semibold text-[#1a1a1a] night:bg-white/[.03] night:text-white/55">
            Inactive
          </span>
        ) : null}
        {variant === "tour" && loc.is_shuttle ? (
          <AlsoTag>also Shuttle</AlsoTag>
        ) : null}
        {variant === "shuttle" && loc.is_tour_bus ? (
          <AlsoTag>also Tour bus</AlsoTag>
        ) : null}
        {/* 「Tour bus departure」只跟团车有关，Shuttle 块不出（v2 Q3）。 */}
        {variant !== "shuttle" ? (
          <label
            title="Guests picked up here board the tour bus directly and are not in the Morning Relay."
            className="mt-1 flex items-center gap-[5px] text-[11px] whitespace-nowrap text-[#1a1a1a] night:text-white/75"
          >
            <input
              type="checkbox"
              checked={!!loc.is_tour_departure}
              disabled={busy}
              onChange={(e) => onTourDeparture(e.target.checked)}
            />
            Tour bus departure
          </label>
        ) : null}
      </td>
      {showDirection ? (
        <td className={TD_CLASS} data-direction={loc.direction ?? ""}>
          <DirectionText value={loc.direction ?? null} />
        </td>
      ) : null}
      {variant === "shuttle" && shuttle ? (
        <td className={cn(TD_CLASS, "bg-amber-300/[.06] text-[12px]")}>
          <TimesCell
            loc={loc}
            seasonId={shuttle.seasonId}
            seasons={shuttle.seasons}
            names={shuttle.names}
          />
        </td>
      ) : null}
      <td className={cn(TD_CLASS, "[overflow-wrap:anywhere]")}>
        {loc.photo_url ? (
          photoHref ? (
            <a
              href={photoHref}
              target="_blank"
              rel="noopener noreferrer"
              className={URL_LINK}
            >
              {shortenUrl(loc.photo_url)}
            </a>
          ) : (
            // 不是 http(s) 的不做成链接，照原样显示，方便发现填错了。
            <span>{loc.photo_url}</span>
          )
        ) : (
          <Dash />
        )}
      </td>
      <td className={TD_CLASS}>
        {images.length ? (
          <div className="flex flex-col gap-1.5">
            {images.map((url, i) => (
              <MapThumb key={i} url={url} />
            ))}
          </div>
        ) : (
          <Dash />
        )}
      </td>
      <td className={TD_SOFT}>{loc.instruction_short || <Dash />}</td>
      {/* 旧模板 Details 空的时候是同色的 —，不是浅灰。 */}
      <td className={TD_SOFT}>{loc.instruction || "—"}</td>
      <td className={TD_SOFT}>{loc.aliases || <Dash />}</td>
      <td className={TD_CLASS}>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            className={cn(BTN_EDIT_CLASS, "whitespace-nowrap")}
          >
            ✏ Edit
          </button>
          <button
            type="button"
            onClick={onToggleActive}
            disabled={busy}
            className={cn(
              loc.is_active ? BTN_OFF_CLASS : BTN_ON_CLASS,
              "whitespace-nowrap",
            )}
          >
            {loc.is_active ? "Deactivate" : "Reactivate"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className={BTN_DELETE_CLASS}
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

/** Direction 一格：彩色小点 + 文字（点的颜色照 Annie 的酒店三色表）；没设 = 灰色 Not set。 */
function DirectionText({ value }: { value: LocationDraft["direction"] }) {
  const opt = DIRECTION_OPTIONS.find((o) => o.value === value);
  if (!opt) {
    return (
      <span className="text-[12px] whitespace-nowrap text-[#888780] italic night:text-white/40">
        Not set
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap">
      <span
        aria-hidden
        className="inline-block size-2 rounded-full"
        style={{ background: opt.dot }}
      />
      {opt.label}
    </span>
  );
}

/** 缩略图；加载不出来时写明 cannot load 并给出地址（多半是填成了网页而不是图片）。 */
function MapThumb({ url }: { url: string }) {
  const [broken, setBroken] = useState(false);
  const href = safeHref(url);
  return (
    <div>
      {!broken && href ? (
        // eslint-disable-next-line @next/next/no-img-element -- 外部任意图片地址，不走 next/image
        <img
          src={href}
          alt="Pickup map"
          onError={() => setBroken(true)}
          className="mb-1 block h-[60px] w-auto max-w-[180px] rounded-[4px] border border-black/15 night:border-white/10"
        />
      ) : (
        <div className="mb-1 text-[11px] text-[#A32D2D] night:text-red-300">
          ⚠ cannot load
        </div>
      )}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={URL_LINK}
        >
          {shortenUrl(url)}
        </a>
      ) : (
        <span className="text-[11px] [overflow-wrap:anywhere]">{url}</span>
      )}
    </div>
  );
}

function EditRow({
  id,
  edit,
  onChange,
  onSave,
  onCancel,
  variant,
  shuttle,
  cols,
  showDirection,
}: {
  id: number;
  edit: EditState;
  onChange: (draft: LocationDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  variant: TableVariant;
  shuttle?: ShuttleTableProps;
  cols: number;
  showDirection: boolean;
}) {
  const { draft, saving, error } = edit;
  const set = <K extends keyof LocationDraft>(
    key: K,
    value: LocationDraft[K],
  ) => onChange({ ...draft, [key]: value });
  const showTimes = variant === "shuttle" && !!shuttle && draft.is_shuttle;
  const timesDirty =
    !!edit.original &&
    JSON.stringify(draft.times) !== JSON.stringify(edit.original.times);
  return (
    <Fragment>
      <tr className={cn(TR_CLASS, TR_HOVER)} data-edit-row={id}>
        <td className={TD_CLASS}>
          <input
            type="text"
            aria-label="Hotel name"
            value={draft.hotel_name}
            disabled={saving}
            onChange={(event) => set("hotel_name", event.target.value)}
            className={INLINE_INPUT_CLASS}
          />
          {variant !== "all" ? (
            <div className="mt-1.5">
              <TypeChecks
                compact
                idPrefix={`edit-${variant}-${id}`}
                tourBus={draft.is_tour_bus}
                shuttle={draft.is_shuttle}
                disabled={saving}
                onChange={(t) => onChange({ ...draft, ...t })}
              />
            </div>
          ) : null}
        </td>
        {showDirection ? (
          <td className={TD_CLASS}>
            <select
              aria-label="Direction"
              data-direction-select
              value={draft.direction ?? ""}
              disabled={saving}
              onChange={(event) =>
                set(
                  "direction",
                  (event.target.value || null) as LocationDraft["direction"],
                )
              }
              className={INLINE_INPUT_CLASS}
            >
              <option value="">Not set</option>
              {DIRECTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </td>
        ) : null}
        {variant === "shuttle" ? (
          <td className={cn(TD_CLASS, "bg-amber-300/[.06]")}>
            {showTimes ? (
              <span className="text-[12px] font-semibold text-[#2563eb] night:text-sky-300">
                Editing below ↓
              </span>
            ) : null}
          </td>
        ) : null}
        <td className={TD_CLASS}>
          <input
            type="text"
            aria-label="Photo URL"
            value={draft.photo_url}
            maxLength={URL_MAX}
            disabled={saving}
            onChange={(event) => set("photo_url", event.target.value)}
            className={INLINE_INPUT_CLASS}
          />
        </td>
        <td className={TD_CLASS}>
          <MapImageInputs
            images={draft.map_images}
            disabled={saving}
            onChange={(images) => set("map_images", images)}
            idPrefix="edit"
            inline
          />
        </td>
        <td className={TD_CLASS}>
          <input
            type="text"
            aria-label="Short (for SMS)"
            value={draft.instruction_short}
            maxLength={SHORT_MAX}
            disabled={saving}
            onChange={(event) => set("instruction_short", event.target.value)}
            className={INLINE_INPUT_CLASS}
          />
        </td>
        <td className={TD_CLASS}>
          <input
            type="text"
            aria-label="Details"
            value={draft.instruction}
            disabled={saving}
            onChange={(event) => set("instruction", event.target.value)}
            className={INLINE_INPUT_CLASS}
          />
        </td>
        <td className={TD_CLASS}>
          <input
            type="text"
            aria-label="Aliases"
            value={draft.aliases}
            maxLength={ALIASES_MAX}
            disabled={saving}
            placeholder="comma-separated"
            title="Internal spellings that should resolve to this hotel. Never shown to a guest. Only needed when the spelling shares no word with the hotel name."
            onChange={(event) => set("aliases", event.target.value)}
            className={INLINE_INPUT_CLASS}
          />
        </td>
        <td className={TD_CLASS}>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className={BTN_ADD_SMALL_CLASS}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className={BTN_EDIT_CLASS}
            >
              Cancel
            </button>
          </div>
          {error ? (
            <p
              role="alert"
              className="mt-1.5 text-[11px] [overflow-wrap:anywhere] text-[#A32D2D] night:text-red-300"
            >
              {error}
            </p>
          ) : null}
        </td>
      </tr>
      {showTimes ? (
        <tr className="bg-blue-500/[.05]" data-times-row={id}>
          <td colSpan={cols} className="px-4 pt-1 pb-3.5">
            <TimesEditor
              rows={draft.times}
              seasons={shuttle!.seasons}
              routes={shuttle!.routes}
              names={shuttle!.names}
              disabled={saving}
              dirty={timesDirty}
              onChange={(times) => set("times", times)}
            />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}
