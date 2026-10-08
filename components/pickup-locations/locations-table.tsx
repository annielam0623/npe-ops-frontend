"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import type { PickupLocation } from "@/types";

import {
  ALIASES_MAX,
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

/** 一行正在编辑的状态：草稿、保存中、保存失败的原因。 */
export interface EditState {
  draft: LocationDraft;
  saving: boolean;
  error: string | null;
}

/** .loc-tbl thead td：表头字色 #999。 */
const TH = cn(TH_CLASS, "text-[#999]");
/** Short / Details / Aliases 三列：12px #666（旧模板行内 style）。 */
const TD_SOFT = cn(TD_CLASS, "text-[#666] [overflow-wrap:anywhere]");
/** .url-link */
const URL_LINK =
  "text-[11px] text-[#378ADD] no-underline [overflow-wrap:anywhere] hover:underline";

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
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className={cn(TH, "w-[13%]")}>Hotel Name</th>
            <th className={cn(TH, "w-[16%]")}>Photo URL</th>
            <th
              className={cn(TH, "w-[15%]")}
              title="The picture itself, shown inline to the guest. Not the same as Photo URL, which is a page they click."
            >
              Map image
            </th>
            <th className={cn(TH, "w-[15%]")}>Short (for SMS)</th>
            <th className={cn(TH, "w-[20%]")}>
              Details (email &amp; guest page)
            </th>
            <th
              className={cn(TH, "w-[9%]")}
              title="Internal spellings that resolve to this hotel. Never shown to a guest."
            >
              Aliases
            </th>
            <th className={cn(TH, "w-[12%]")}>Actions</th>
          </tr>
        </thead>
        <tbody className={TBODY_CLASS}>
          {placeholder ? (
            <tr>
              <td colSpan={7} className="p-5 text-center text-[#ccc]">
                {placeholder}
              </td>
            </tr>
          ) : (
            locations.map((loc) =>
              edits[loc.id] ? (
                <EditRow
                  key={loc.id}
                  edit={edits[loc.id]}
                  onChange={(draft) => onDraftChange(loc.id, draft)}
                  onSave={() => onSave(loc.id)}
                  onCancel={() => onCancel(loc.id)}
                />
              ) : (
                <ViewRow
                  key={loc.id}
                  loc={loc}
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
  return <span className="text-[#ccc]">—</span>;
}

function ViewRow({
  loc,
  busy,
  onEdit,
  onToggleActive,
  onTourDeparture,
  onDelete,
}: {
  loc: PickupLocation;
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
          <span className="ml-1.5 inline-block rounded-full bg-[#f0f0ee] px-[7px] py-px align-middle text-[10px] font-semibold text-[#777]">
            Inactive
          </span>
        ) : null}
        <label
          title="Guests picked up here board the tour bus directly and are not in the Morning Relay."
          className="mt-1 flex items-center gap-[5px] text-[11px] whitespace-nowrap text-[#555]"
        >
          <input
            type="checkbox"
            checked={!!loc.is_tour_departure}
            disabled={busy}
            onChange={(e) => onTourDeparture(e.target.checked)}
          />
          Tour bus departure
        </label>
      </td>
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
          className="mb-1 block h-[60px] w-auto max-w-[180px] rounded-[4px] border border-black/15"
        />
      ) : (
        <div className="mb-1 text-[11px] text-[#A32D2D]">⚠ cannot load</div>
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
  edit,
  onChange,
  onSave,
  onCancel,
}: {
  edit: EditState;
  onChange: (draft: LocationDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { draft, saving, error } = edit;
  const set = <K extends keyof LocationDraft>(
    key: K,
    value: LocationDraft[K],
  ) => onChange({ ...draft, [key]: value });
  return (
    <tr className={cn(TR_CLASS, TR_HOVER)}>
      <td className={TD_CLASS}>
        <input
          type="text"
          aria-label="Hotel name"
          value={draft.hotel_name}
          disabled={saving}
          onChange={(event) => set("hotel_name", event.target.value)}
          className={INLINE_INPUT_CLASS}
        />
      </td>
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
            className="mt-1.5 text-[11px] [overflow-wrap:anywhere] text-[#A32D2D]"
          >
            {error}
          </p>
        ) : null}
      </td>
    </tr>
  );
}
