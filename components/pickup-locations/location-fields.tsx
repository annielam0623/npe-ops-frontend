"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import {
  ALIASES_MAX,
  type LocationDraft,
  MAP_IMAGE_MAX_COUNT,
  SHORT_MAX,
  URL_MAX,
} from "./config";

export const INPUT_CLASS =
  "w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none disabled:bg-stone-50";

const MAP_IMAGE_TITLE =
  "The picture itself (.png/.jpg), shown inline in the email and on the guest page. Not the same as Photo URL, which is a page the guest clicks.";

/** 地图图片：一行一个地址，＋ 加第二张，第二张有 ✕。最多 2 张。 */
export function MapImageInputs({
  images,
  disabled,
  onChange,
  idPrefix,
}: {
  images: string[];
  disabled?: boolean;
  onChange: (images: string[]) => void;
  idPrefix: string;
}) {
  const full = images.length >= MAP_IMAGE_MAX_COUNT;
  return (
    <div className="flex flex-col gap-1.5">
      {images.map((value, index) => (
        <div key={index} className="flex gap-1.5">
          <input
            id={index === 0 ? `${idPrefix}-map` : undefined}
            type="text"
            value={value}
            maxLength={URL_MAX}
            disabled={disabled}
            title={MAP_IMAGE_TITLE}
            aria-label={index === 0 ? "Map image" : "Second map image"}
            placeholder={
              index === 0
                ? "https://nationalparkexpress.com/.../pickup-map.png"
                : "second picture (optional)"
            }
            onChange={(event) =>
              onChange(
                images.map((v, i) => (i === index ? event.target.value : v)),
              )
            }
            className={INPUT_CLASS}
          />
          {index === 0 ? (
            <button
              type="button"
              disabled={disabled || full}
              title={full ? "Up to 2 pictures" : "Add a second picture"}
              aria-label="Add a second picture"
              onClick={() => onChange([...images, ""])}
              className="rounded-md border border-stone-300 px-2.5 text-stone-600 hover:bg-stone-50 disabled:opacity-40"
            >
              ＋
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled}
              title="Remove this picture"
              aria-label="Remove this picture"
              onClick={() => onChange(images.filter((_, i) => i !== index))}
              className="rounded-md border border-stone-300 px-2.5 text-stone-600 hover:bg-stone-50 disabled:opacity-40"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-stone-600">
        {label}
      </label>
      {children}
      {hint ? (
        <p className="text-[11.5px] leading-relaxed text-stone-500">{hint}</p>
      ) : null}
    </div>
  );
}

/** 新增表单的 6 个字段（标签、占位、提示照旧页面）。 */
export function LocationFields({
  draft,
  disabled,
  onChange,
  idPrefix,
}: {
  draft: LocationDraft;
  disabled?: boolean;
  onChange: (draft: LocationDraft) => void;
  idPrefix: string;
}) {
  const set = <K extends keyof LocationDraft>(
    key: K,
    value: LocationDraft[K],
  ) => onChange({ ...draft, [key]: value });
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Field label="Hotel Name *" htmlFor={`${idPrefix}-name`}>
        <input
          id={`${idPrefix}-name`}
          type="text"
          value={draft.hotel_name}
          disabled={disabled}
          placeholder="e.g. MGM Grand"
          onChange={(event) => set("hotel_name", event.target.value)}
          className={INPUT_CLASS}
        />
      </Field>
      <Field label="Photo URL" htmlFor={`${idPrefix}-url`}>
        <input
          id={`${idPrefix}-url`}
          type="text"
          value={draft.photo_url}
          maxLength={URL_MAX}
          disabled={disabled}
          placeholder="https://nationalparkexpress.com/..."
          onChange={(event) => set("photo_url", event.target.value)}
          className={INPUT_CLASS}
        />
      </Field>
      <Field
        label="Map image — shown directly, no click"
        htmlFor={`${idPrefix}-map`}
        hint={
          <>
            Paste the <b>image</b> address (ends in .png / .jpg), not a web
            page. It is displayed inside &ldquo;Head to your pickup
            location&rdquo; on the guest page and in the confirmation email.
            Leave blank for no picture.
            <br />
            Click <b>＋</b> to add a second picture — the two are shown{" "}
            <b>in this order</b>, one under the other.
          </>
        }
      >
        <MapImageInputs
          images={draft.map_images}
          disabled={disabled}
          onChange={(images) => set("map_images", images)}
          idPrefix={idPrefix}
        />
      </Field>
      <Field label="Short (for SMS)" htmlFor={`${idPrefix}-short`}>
        <input
          id={`${idPrefix}-short`}
          type="text"
          value={draft.instruction_short}
          maxLength={SHORT_MAX}
          disabled={disabled}
          placeholder="e.g. Rear Rotunda tour lobby"
          onChange={(event) => set("instruction_short", event.target.value)}
          className={INPUT_CLASS}
        />
      </Field>
      <Field label="Details (email & guest page)" htmlFor={`${idPrefix}-inst`}>
        <input
          id={`${idPrefix}-inst`}
          type="text"
          value={draft.instruction}
          disabled={disabled}
          placeholder="Please arrive at..."
          onChange={(event) => set("instruction", event.target.value)}
          className={INPUT_CLASS}
        />
      </Field>
      <Field
        label="Aliases — internal only, never shown to a guest"
        htmlFor={`${idPrefix}-aliases`}
        hint={
          <>
            Only needed when the spreadsheet spelling shares <b>no word</b> with
            the hotel name above — <code>ResortsWLD</code> is the one we have.
            <br />
            Spellings like <code>Horseshoe Las Vegas</code> or{" "}
            <code>MGM Grand Hotel</code> already match on their own; they do{" "}
            <b>not</b> need an alias.
            <br />
            Separate several with commas. Upper/lower case and surrounding
            spaces are ignored, but everything else must match exactly —{" "}
            <code>Resorts WLD</code> will <b>not</b> match{" "}
            <code>ResortsWLD</code>. An alias that already points to another
            hotel is refused.
          </>
        }
      >
        <input
          id={`${idPrefix}-aliases`}
          type="text"
          value={draft.aliases}
          maxLength={ALIASES_MAX}
          disabled={disabled}
          placeholder="e.g. ResortsWLD, RWLV"
          onChange={(event) => set("aliases", event.target.value)}
          className={INPUT_CLASS}
        />
      </Field>
    </div>
  );
}
