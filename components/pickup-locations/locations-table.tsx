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
import { INPUT_CLASS, MapImageInputs } from "./location-fields";

/** 一行正在编辑的状态：草稿、保存中、保存失败的原因。 */
export interface EditState {
  draft: LocationDraft;
  saving: boolean;
  error: string | null;
}

const ACTION_BUTTON =
  "rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50";

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
  onDelete: (loc: PickupLocation) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-50 text-left text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
            <th className="w-[13%] px-3 py-2.5">Hotel Name</th>
            <th className="w-[16%] px-3 py-2.5">Photo URL</th>
            <th
              className="w-[15%] px-3 py-2.5"
              title="The picture itself, shown inline to the guest. Not the same as Photo URL, which is a page they click."
            >
              Map image
            </th>
            <th className="w-[15%] px-3 py-2.5">Short (for SMS)</th>
            <th className="w-[20%] px-3 py-2.5">
              Details (email &amp; guest page)
            </th>
            <th
              className="w-[9%] px-3 py-2.5"
              title="Internal spellings that resolve to this hotel. Never shown to a guest."
            >
              Aliases
            </th>
            <th className="w-[12%] px-3 py-2.5">Actions</th>
          </tr>
        </thead>
        <tbody>
          {placeholder ? (
            <tr>
              <td colSpan={7} className="px-4 py-12 text-center text-stone-500">
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
  return <span className="text-stone-400">—</span>;
}

function ViewRow({
  loc,
  busy,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  loc: PickupLocation;
  busy: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const photoHref = safeHref(loc.photo_url);
  const images = splitMapImages(loc.map_image_url);
  return (
    <tr
      className={cn(
        "border-b border-stone-100 align-top last:border-b-0",
        !loc.is_active && "bg-stone-50",
      )}
    >
      <td className="px-3 py-2.5 [overflow-wrap:anywhere]">
        <span
          className={cn(
            "font-semibold text-stone-900",
            !loc.is_active && "text-stone-400",
          )}
        >
          {loc.hotel_name}
        </span>
        {!loc.is_active ? (
          <span className="ml-1.5 rounded-full bg-stone-200 px-2 py-0.5 text-[11px] font-semibold text-stone-600">
            Inactive
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-xs [overflow-wrap:anywhere]">
        {loc.photo_url ? (
          photoHref ? (
            <a
              href={photoHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 underline hover:text-sky-900"
            >
              {shortenUrl(loc.photo_url)}
            </a>
          ) : (
            // 不是 http(s) 的不做成链接，照原样显示，方便发现填错了。
            <span className="text-stone-700">{loc.photo_url}</span>
          )
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-3 py-2.5 text-xs">
        {images.length ? (
          <div className="flex flex-col gap-2">
            {images.map((url, i) => (
              <MapThumb key={i} url={url} />
            ))}
          </div>
        ) : (
          <Dash />
        )}
      </td>
      <td
        className={cn(
          "px-3 py-2.5 [overflow-wrap:anywhere]",
          !loc.is_active && "text-stone-400",
        )}
      >
        {loc.instruction_short || <Dash />}
      </td>
      <td
        className={cn(
          "px-3 py-2.5 [overflow-wrap:anywhere]",
          !loc.is_active && "text-stone-400",
        )}
      >
        {loc.instruction || <Dash />}
      </td>
      <td
        className={cn(
          "px-3 py-2.5 text-xs [overflow-wrap:anywhere]",
          !loc.is_active && "text-stone-400",
        )}
      >
        {loc.aliases || <Dash />}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            className={cn(
              ACTION_BUTTON,
              "border-stone-300 text-stone-700 hover:bg-stone-50",
            )}
          >
            ✏ Edit
          </button>
          <button
            type="button"
            onClick={onToggleActive}
            disabled={busy}
            className={cn(
              ACTION_BUTTON,
              loc.is_active
                ? "border-amber-400 text-amber-800 hover:bg-amber-50"
                : "border-emerald-500 text-emerald-700 hover:bg-emerald-50",
            )}
          >
            {loc.is_active ? "Deactivate" : "Reactivate"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className={cn(
              ACTION_BUTTON,
              "border-red-300 text-red-700 hover:bg-red-50",
            )}
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
    <div className="flex flex-col gap-0.5">
      {!broken && href ? (
        // eslint-disable-next-line @next/next/no-img-element -- 外部任意图片地址，不走 next/image
        <img
          src={href}
          alt="Pickup map"
          onError={() => setBroken(true)}
          className="h-[60px] max-w-[180px] rounded border border-stone-200 object-contain"
        />
      ) : (
        <span className="font-semibold text-red-600">⚠ cannot load</span>
      )}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="[overflow-wrap:anywhere] text-sky-700 underline hover:text-sky-900"
        >
          {shortenUrl(url)}
        </a>
      ) : (
        <span className="[overflow-wrap:anywhere] text-stone-700">{url}</span>
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
    <tr className="border-b border-stone-100 bg-amber-50/40 align-top">
      <td className="px-2 py-2">
        <input
          type="text"
          aria-label="Hotel name"
          value={draft.hotel_name}
          disabled={saving}
          onChange={(event) => set("hotel_name", event.target.value)}
          className={INPUT_CLASS}
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="text"
          aria-label="Photo URL"
          value={draft.photo_url}
          maxLength={URL_MAX}
          disabled={saving}
          onChange={(event) => set("photo_url", event.target.value)}
          className={INPUT_CLASS}
        />
      </td>
      <td className="px-2 py-2">
        <MapImageInputs
          images={draft.map_images}
          disabled={saving}
          onChange={(images) => set("map_images", images)}
          idPrefix="edit"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="text"
          aria-label="Short (for SMS)"
          value={draft.instruction_short}
          maxLength={SHORT_MAX}
          disabled={saving}
          onChange={(event) => set("instruction_short", event.target.value)}
          className={INPUT_CLASS}
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="text"
          aria-label="Details"
          value={draft.instruction}
          disabled={saving}
          onChange={(event) => set("instruction", event.target.value)}
          className={INPUT_CLASS}
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="text"
          aria-label="Aliases"
          value={draft.aliases}
          maxLength={ALIASES_MAX}
          disabled={saving}
          placeholder="comma-separated"
          title="Internal spellings that should resolve to this hotel. Never shown to a guest. Only needed when the spelling shares no word with the hotel name."
          onChange={(event) => set("aliases", event.target.value)}
          className={INPUT_CLASS}
        />
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className={cn(
              ACTION_BUTTON,
              "border-stone-800 bg-stone-800 text-white hover:bg-stone-700",
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className={cn(
              ACTION_BUTTON,
              "border-stone-300 text-stone-700 hover:bg-stone-50",
            )}
          >
            Cancel
          </button>
        </div>
        {error ? (
          <p
            role="alert"
            className="mt-1.5 text-xs [overflow-wrap:anywhere] text-red-700"
          >
            {error}
          </p>
        ) : null}
      </td>
    </tr>
  );
}
