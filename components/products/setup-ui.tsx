"use client";

import { useEffect, useRef, useState } from "react";

import { Pin, type MapZone } from "@/components/products/manifest-setup-map";
import { cn } from "@/lib/utils";

/** Bus Manifest setup 面板和它的 Forecast 设置（G63）共用的样式和外框。 */

// 旧模板 _manifest_setup_panel.html 自带的 ms- 样式（Annie 2026-10-07：和旧版一模一样）。
/** .ms-tbl input / .ms-row input[type=text] */
export const INPUT =
  "h-7 rounded-[6px] border-[0.5px] border-black/25 night:border-white/10 bg-paper night:bg-white/[.04] px-2 text-[13px] font-normal text-[#1a1a1a] night:text-white/90 focus:outline-none disabled:opacity-60";
/** .ms-tbl select */
export const SELECT =
  "h-7 rounded-[6px] border-[0.5px] border-black/25 night:border-white/10 bg-paper night:bg-white/[.04] text-[12.5px] text-[#1a1a1a] night:text-white/90";
export const BUTTON_BASE =
  "h-[30px] cursor-pointer rounded-[7px] border px-3 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50";
/** .ms-btn */
export const BUTTON = cn(
  BUTTON_BASE,
  "border-black/[.18] night:border-white/10 bg-paper night:bg-white/[.04] text-[#1a1a1a] night:text-white/90",
);
/** .ms-tbl th */
export const TH =
  "border-b border-black/10 night:border-white/10 px-1.5 py-[5px] text-left text-[11px] font-semibold text-[#1a1a1a] night:text-white/55";
/** .ms-tbl td */
export const TD =
  "border-b-[0.5px] border-black/[.07] night:border-white/10 px-1.5 py-1 align-middle";
/** .ms-hint */
export const HINT = "text-[12px] text-[#1a1a1a] night:text-white/55";
/** .ms-h */
export const SUBHEAD =
  "m-0 text-[12.5px] font-bold text-[#22324a] night:text-white/90";

export function useSavedFlag(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return [
    saved,
    () => {
      setSaved(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSaved(false), 2000);
    },
  ];
}

export function Saved({ show }: { show: boolean }) {
  return show ? (
    <span className="text-[12px] text-[#1e6b43] night:text-emerald-300">
      Saved
    </span>
  ) : null;
}

/** 左边一项设置：编号 + 标题 + 灰字说明（这项印在哪 / 用在哪）。指到或 Tab 进来时整块描橙色，右边对应位置跟着亮。 */
export function MapField({
  zone,
  active,
  onZone,
  title,
  hint,
  sub,
  children,
}: {
  zone: MapZone;
  active: MapZone | null;
  onZone: (z: MapZone | null) => void;
  title: string;
  hint: string;
  /** 并进上一项的子项（Sections 下面的 Section order、Extras）：不另给编号，右边照样指到哪亮哪。 */
  sub?: boolean;
  children: React.ReactNode;
}) {
  const on = active === zone;
  return (
    <div
      data-field={zone}
      onMouseEnter={() => onZone(zone)}
      onMouseLeave={() => onZone(null)}
      onFocus={() => onZone(zone)}
      onBlur={() => onZone(null)}
      className={cn(
        "grid grid-cols-[26px_minmax(0,1fr)] gap-2.5 rounded-[9px] border px-2.5 py-2",
        on
          ? "border-[#e8590c] bg-[#e8590c]/[.08] night:bg-[#e8590c]/[.15]"
          : "border-transparent",
      )}
    >
      {sub ? (
        <span aria-hidden className="text-center text-[13px] text-[#8a8a8a]">
          ↳
        </span>
      ) : (
        <Pin zone={zone} />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className={SUBHEAD}>{title}</h3>
        <p className={cn(HINT, "m-0 leading-[1.5]")}>{hint}</p>
        {children}
      </div>
    </div>
  );
}
