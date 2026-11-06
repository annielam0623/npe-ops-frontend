import { BASE_PX, HEAD_PX } from "@/components/dispatch-manifest/text-size";
import type { ManifestVersion } from "@/types";

/**
 * 版式设置 Text 页（置顶 92 第 2 批，Q4 A「每天的起点」）：每种字的前端默认大小 / 粗细（= 现在的样子）。
 * 存的是相对这里的加减 d（07 的形状），所以前端默认改了，staff 设的加减照样叠上去。
 */
export interface TextElement {
  key: string;
  label: string;
  px: number;
  bold: boolean;
}

export const BUS_MANIFEST_TEXT_LAYOUTS: { key: ManifestVersion; label: string }[] =
  [
    { key: "general", label: "General" },
    { key: "lankun", label: "Lankun" },
    { key: "marcello", label: "Marcello" },
    { key: "west", label: "West Rim" },
  ];

export function busManifestTextElements(v: ManifestVersion): TextElement[] {
  const b = BASE_PX[v] ?? BASE_PX.general;
  const h = HEAD_PX[v] ?? HEAD_PX.general;
  return [
    { key: "table_text", label: "Table text", px: b.cell, bold: true },
    { key: "pax", label: "Pax", px: b.pax, bold: true },
    { key: "section_titles", label: "Section titles", px: h.section, bold: true },
    { key: "column_titles", label: "Column titles", px: h.th, bold: true },
  ];
}

export const RELAY_TEXT_LAYOUTS = [
  { key: "summary", label: "RELAY SPLITS (summary)" },
  { key: "car", label: "Car sheet" },
] as const;

/** 同 relay-list.css 现在的字号。 */
export function relayTextElements(layout: string): TextElement[] {
  return layout === "summary"
    ? [
        { key: "table_text", label: "Table text", px: 12.5, bold: true },
        { key: "legend", label: "Legend", px: 10.5, bold: true },
        { key: "column_titles", label: "Column titles", px: 9, bold: true },
      ]
    : [
        { key: "header", label: "Header", px: 24, bold: true },
        { key: "table_text", label: "Table text", px: 15, bold: true },
        { key: "total_pax", label: "Total Pax", px: 20, bold: true },
        { key: "bus_bars", label: "Bus bars", px: 18, bold: true },
      ];
}
