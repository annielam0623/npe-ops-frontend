"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { FORM_INPUT_CLASS, INLINE_INPUT_CLASS } from "./legacy-ui";

import {
  ALIASES_MAX,
  type LocationDraft,
  MAP_IMAGE_MAX_COUNT,
  SHORT_MAX,
  URL_MAX,
} from "./config";

/** .mapimg-btn：表单里 30×32，表格行里（inline）26×26。 */
const MAPIMG_BTN =
  "flex shrink-0 cursor-pointer items-center justify-center rounded-[7px] bg-white leading-none disabled:cursor-not-allowed disabled:opacity-35";

const MAP_IMAGE_TITLE =
  "The picture itself (.png/.jpg), shown inline in the email and on the guest page. Not the same as Photo URL, which is a page the guest clicks.";

/** 地图图片：一行一个地址，＋ 加第二张，第二张有 ✕。最多 2 张。 */
export function MapImageInputs({
  images,
  disabled,
  onChange,
  idPrefix,
  inline,
}: {
  images: string[];
  disabled?: boolean;
  onChange: (images: string[]) => void;
  idPrefix: string;
  /** 表格编辑行里：输入框用 .inline-input，按钮小一号。 */
  inline?: boolean;
}) {
  const full = images.length >= MAP_IMAGE_MAX_COUNT;
  const size = inline
    ? "h-[26px] w-[26px] text-[12px]"
    : "h-8 w-[30px] text-[14px]";
  return (
    <div className="flex flex-col gap-1.5">
      {images.map((value, index) => (
        <div key={index} className="flex items-center gap-1.5">
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
            className={cn(
              inline ? INLINE_INPUT_CLASS : FORM_INPUT_CLASS,
              "min-w-0 flex-1",
            )}
          />
          {index === 0 ? (
            <button
              type="button"
              disabled={disabled || full}
              title={full ? "Up to 2 pictures" : "Add a second picture"}
              aria-label="Add a second picture"
              onClick={() => onChange([...images, ""])}
              className={cn(
                MAPIMG_BTN,
                size,
                "border-[0.5px] border-black/25 font-semibold text-[#1a1a1a] hover:enabled:bg-[#f5f5f3]",
              )}
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
              className={cn(
                MAPIMG_BTN,
                size,
                "border-[0.5px] border-[#A32D2D] text-[#A32D2D] hover:bg-[#fff5f5]",
              )}
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** .form-group：label 12px #888，hint 11px #aaa。 */
function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-[5px]">
      <label htmlFor={htmlFor} className="text-[12px] font-medium text-[#888]">
        {label}
      </label>
      {children}
      {hint ? (
        <div className="text-[11px] leading-[1.5] text-[#aaa]">{hint}</div>
      ) : null}
    </div>
  );
}

/**
 * 新增表单的 6 个字段（标签、占位、提示照旧页面）。只出 6 个格子，外面那层 grid（4 列，最后一列 auto，
 * 和 Add 键排在一起）由页面给，同旧页面 .add-form。
 */
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
    <>
      <Field label="Hotel Name *" htmlFor={`${idPrefix}-name`}>
        <input
          id={`${idPrefix}-name`}
          type="text"
          value={draft.hotel_name}
          disabled={disabled}
          placeholder="e.g. MGM Grand"
          onChange={(event) => set("hotel_name", event.target.value)}
          className={FORM_INPUT_CLASS}
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
          className={FORM_INPUT_CLASS}
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
          className={FORM_INPUT_CLASS}
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
          className={FORM_INPUT_CLASS}
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
          className={FORM_INPUT_CLASS}
        />
      </Field>
    </>
  );
}
