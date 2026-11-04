import type { SpreadsheetTable } from "@/lib/spreadsheet";

/**
 * 置顶 74 上传 waiver links 的文件（Annie 题 3 A）：两列——订单号、链接。
 * 先按表头认（Order / Order # / Order number…；Waiver / Link / URL…）；表头认不出来 ⇒ 当没有表头：
 * 第一行也是数据，第 1 列订单号、第 2 列链接。对单、校验都在后端（apply=false 先看）。
 */

const ORDER_ALIASES = [
  "order",
  "order#",
  "order #",
  "order no",
  "order no.",
  "order number",
  "order id",
  "chd",
  "chd#",
  "chd #",
  "booking",
  "booking #",
  "booking number",
];

const LINK_ALIASES = [
  "waiver",
  "waiver link",
  "waiver url",
  "waiver form",
  "link",
  "url",
];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function find(headers: string[], aliases: string[]): string | null {
  const wanted = new Set(aliases.map(norm));
  return headers.find((h) => wanted.has(norm(h))) ?? null;
}

export interface WaiverFileRow {
  /** 文件里第几行（有表头时数据从第 2 行起）。 */
  line: number;
  order_number: string;
  waiver_link: string;
}

export interface ParsedWaiverFile {
  /** true = 按表头认出来了；false = 当没有表头（第 1 列订单号、第 2 列链接）。 */
  hasHeader: boolean;
  rows: WaiverFileRow[];
}

export class WaiverFileError extends Error {}

export function parseWaiverFile(table: SpreadsheetTable): ParsedWaiverFile {
  const orderCol = find(table.headers, ORDER_ALIASES);
  const linkCol = find(table.headers, LINK_ALIASES);
  if (orderCol && linkCol) {
    return {
      hasHeader: true,
      rows: table.rows
        .map((r, i) => ({
          line: i + 2,
          order_number: (r[orderCol] ?? "").trim(),
          waiver_link: (r[linkCol] ?? "").trim(),
        }))
        .filter((r) => r.order_number || r.waiver_link),
    };
  }
  const [first, second] = table.headers;
  if (!first || !second)
    throw new WaiverFileError(
      "The file needs two columns: the order number and the waiver link.",
    );
  return {
    hasHeader: false,
    rows: [
      { line: 1, order_number: first, waiver_link: second },
      ...table.rows.map((r, i) => ({
        line: i + 2,
        order_number: (r[first] ?? "").trim(),
        waiver_link: (r[second] ?? "").trim(),
      })),
    ].filter((r) => r.order_number || r.waiver_link),
  };
}
