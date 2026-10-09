"use client";

import type { ReactNode } from "react";

import {
  FORM_INPUT_CLASS,
  INLINE_INPUT_CLASS,
} from "@/components/ui/white-card";
import { cn } from "@/lib/utils";

import {
  ALIASES_MAX,
  type LocationDraft,
  MAP_IMAGE_MAX_COUNT,
  SHORT_MAX,
  URL_MAX,
} from "./config";

const INPUT_CLASS = cn(FORM_INPUT_CLASS, "w-full");

const MAP_IMAGE_TITLE =
  "The picture itself (.png/.jpg), shown inline in the email and on the guest page. Not the same as Photo URL, which is a page the guest clicks.";

/** 地图图片：一行一个地址，＋ 加第二张，第二张有 ✕。最多 2 张。inline = 表格里的编辑行（同旧页面，控件小一号）。 */
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
  inline?: boolean;
}) {
  const full = images.length >= MAP_IMAGE_MAX_COUNT;
  // .mapimg-btn：＋ 黑框，✕ 红框；满了 ＋ 置灰但不拿掉（拿掉输入框会忽宽忽窄）。
  const btn = cn(
    "shrink-0 cursor-pointer rounded-[7px] border-[0.5px] bg-white leading-none disabled:cursor-not-allowed",
    inline ? "h-[26px] w-[26px] text-xs" : "h-8 w-[30px] text-sm",
  );
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
            className={inline ? INLINE_INPUT_CLASS : INPUT_CLASS}
          />
          {index === 0 ? (
            <button
              type="button"
              disabled={disabled || full}
              title={full ? "Up to 2 pictures" : "Add a second picture"}
              aria-label="Add a second picture"
              onClick={() => onChange([...images, ""])}
              className={cn(
                btn,
                "border-black/25 font-semibold text-[#1a1a1a] hover:enabled:bg-[#f5f5f3] disabled:opacity-35",
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
                btn,
                "border-[#A32D2D] text-[#A32D2D] hover:bg-[#fff5f5] disabled:opacity-50",
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
    <div className={cn("flex min-w-0 flex-col gap-[5px]", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-[#888]">
        {label}
      </label>
      {children}
      {hint ? (
        <p className="text-[11px] leading-normal text-[#aaa] [&_code]:font-mono">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** 新增表单的 6 个字段（标签、占位、提示照旧页面）；children 放在网格下面（Add 键）。 */
export function LocationFields({
  draft,
  disabled,
  onChange,
  idPrefix,
  children,
}: {
  draft: LocationDraft;
  disabled?: boolean;
  onChange: (draft: LocationDraft) => void;
  idPrefix: string;
  children?: ReactNode;
}) {
  const set = <K extends keyof LocationDraft>(
    key: K,
    value: LocationDraft[K],
  ) => onChange({ ...draft, [key]: value });
  return (
    // 旧页面 .add-form 是 4 列放 7 项（1fr 1fr 1fr auto），排出来很乱；ops 用自适应网格，Add 键另起一行。
    // 这条差异在 docs/旧页面差异清单.md 里等 Annie 勾「保留 / 改回」。
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
        <Field
          label="Details (email & guest page)"
          htmlFor={`${idPrefix}-inst`}
        >
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
              Only needed when the spreadsheet spelling shares <b>no word</b>{" "}
              with the hotel name above — <code>ResortsWLD</code> is the one we
              have.
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
      {children ? <div className="mt-3">{children}</div> : null}
    </>
  );
}
