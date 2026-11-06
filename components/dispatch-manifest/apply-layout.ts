import { createContext, useContext } from "react";

import {
  effectivePlus,
  effectiveRules,
  resolveBox,
  ticketColorBy,
  type PrintLayoutDefaults,
  type PrintLayoutSettings,
} from "@/lib/print-layout";
import type { ManifestSection, ManifestView as ManifestData } from "@/types";

import { BUS_MANIFEST_BOXES, columnOfBox } from "../print-layout/boxes";

/**
 * 版式设置（置顶 92）套到 Bus Manifest 页面数据上：弹窗里暂存的一改，后面的单子马上跟着变。
 * 没设的格一律用后端给的颜色（= 现在纸本的样子），所以没有设置 / 后端没上线时页面一模一样。
 * 打印页和 Excel 是后端照存好的设置画，前端只管屏幕。
 *
 * 关掉的格：表头类（车抬头、节标题）变白底，格子类变透明（= 不上色）。
 */
const OFF_HEAD = "#ffffff";
const OFF_CELL = "transparent";

/** 数据里放不下的那几样（列标题、自定格、隔组标色、餐不符、整列上色），用 context 给到表格。 */
export interface ManifestLook {
  hotelGroup: boolean;
  /** 隔组标色的颜色；null = 用节色（07）。 */
  hotelGroupColor: string | null;
  columnTitles: string | null;
  footCustom: string | null;
  lunchMismatch: { on: boolean; color: string | null };
  /** 列键 ⇒ 整列底色（开了的才有）。 */
  columnFill: Record<string, string>;
  lunchTotalRow: string | null;
  sandwichHead: string | null;
}

export const DEFAULT_LOOK: ManifestLook = {
  hotelGroup: true,
  hotelGroupColor: null,
  columnTitles: null,
  footCustom: null,
  lunchMismatch: { on: true, color: null },
  columnFill: {},
  lunchTotalRow: null,
  sandwichHead: null,
};

export const ManifestLookContext = createContext<ManifestLook>(DEFAULT_LOOK);
export const useManifestLook = () => useContext(ManifestLookContext);

export function applyLayout(
  data: ManifestData,
  s: PrintLayoutSettings,
  d: PrintLayoutDefaults,
  /** 车抬头：车字母 ⇒ staff 设的颜色（Relay list 设置那份，含暂存）；没设 = null（用后端的）。 */
  busHeader: (busKey: string) => string | null,
): { data: ManifestData; look: ManifestLook } {
  const tourId = String(data.tour.id);
  const box = (key: string) => resolveBox(s, d, key, tourId);
  /** 这一格：关了 ⇒ off；设了颜色 ⇒ 用它；没设 ⇒ 后端给的 fallback。 */
  const pick = (key: string, fallback: string | undefined, off: string) => {
    const b = box(key);
    if (!b.on) return off;
    const own =
      s.colours.tours[tourId]?.boxes?.[key]?.color ?? s.colours.all[key]?.color;
    return own ?? fallback;
  };

  const header = box("bus_header");
  const section = box("section");
  const sectionMap = s.colours.tours[tourId]?.sections ?? {};
  const shuttle = {
    outbound:
      pick("shuttle_out", data.shuttle_colors.outbound, OFF_HEAD) ??
      data.shuttle_colors.outbound,
    inbound:
      pick("shuttle_in", data.shuttle_colors.inbound, OFF_HEAD) ??
      data.shuttle_colors.inbound,
  };
  const rulesCustom =
    s.ticket_rules !== null || !!s.colours.all.ticket_plus;
  const rules = effectiveRules(s, d);
  const plus = effectivePlus(s, d);

  const fixSection = (sec: ManifestSection): ManifestSection => {
    let color = sec.color;
    if (sec.kind === "tour") {
      if (!section.on) color = OFF_HEAD;
      else color = sectionMap[sec.title.trim().toLowerCase()] ?? color;
    } else {
      color = shuttle[sec.kind];
    }
    const guests = rulesCustom
      ? sec.guests.map((g) => ({
          ...g,
          ticket_color: ticketColorBy(rules, plus, g.ticket || g.quantities),
        }))
      : sec.guests;
    return { ...sec, color, guests };
  };

  const paper = data.paper_colors ?? {};
  const out: ManifestData = {
    ...data,
    tour: {
      ...data.tour,
      band_color: header.on ? data.tour.band_color : OFF_HEAD,
      section_color: section.on ? data.tour.section_color : OFF_HEAD,
    },
    shuttle_colors: shuttle,
    extra_row_color: pick("extra_row", data.extra_row_color, OFF_CELL),
    paper_colors: {
      ...paper,
      notes: pick("notes", paper.notes, OFF_CELL),
      confirm_box: pick("confirm_box", paper.confirm_box, OFF_CELL),
      foot_head: pick("foot_head", paper.foot_head, OFF_CELL),
      lunch_bar: pick("lunch_bar", paper.lunch_bar, OFF_CELL),
      lunch_notes: pick("lunch_notes", paper.lunch_notes, OFF_CELL),
      lunch_default_row: pick(
        "lunch_default_row",
        paper.lunch_default_row,
        OFF_CELL,
      ),
    },
    blocks: data.blocks.map((b) => ({
      ...b,
      band_color: !header.on
        ? OFF_HEAD
        : (busHeader(b.bus_key) ?? b.band_color),
      sections: b.sections.map(fixSection),
    })),
    unplaced: {
      ...data.unplaced,
      sections: data.unplaced.sections.map(fixSection),
    },
    ...(data.affiliate
      ? {
          affiliate: {
            ...data.affiliate,
            sections: data.affiliate.sections.map(fixSection),
          },
        }
      : {}),
  };

  const columnFill: Record<string, string> = {};
  for (const def of BUS_MANIFEST_BOXES) {
    const col = columnOfBox(def.key);
    if (!col) continue;
    const b = box(def.key);
    if (b.on && b.color) columnFill[col] = b.color;
  }
  const titles = box("column_titles");
  const custom = box("foot_custom");
  const mismatch = box("lunch_mismatch");
  const look: ManifestLook = {
    hotelGroup: box("hotel_group").on,
    hotelGroupColor: box("hotel_group").color,
    columnTitles: titles.on ? titles.color : OFF_CELL,
    footCustom: custom.on ? custom.color : OFF_CELL,
    lunchMismatch: { on: mismatch.on, color: mismatch.color },
    columnFill,
    lunchTotalRow: pick("lunch_total_row", undefined, OFF_CELL) ?? null,
    sandwichHead: pick("sandwich_head", undefined, OFF_CELL) ?? null,
  };
  return { data: out, look };
}
