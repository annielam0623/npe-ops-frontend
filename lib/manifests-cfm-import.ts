/**
 * Manifests 的 Cfm # 批量上传（Max 2026-10-08 定的做法，没有后端接口 —— 匹配和写入全在前端）：
 * 上传一份供应商/巴士公司给的确认单列表（例如 Ken's Tours 的 "CHD #" + "Confirmation#"），
 * 按 CHD #（订单号）在当天的 Manifests 里找对应行，核对人数，符合的才写 Cfm #；
 * 找不到的标 "缺失"，人数对不上或同一订单号在系统里不止一行的标「不合符」（都不自动写，留给人工处理）。
 */
import type { ManifestMatchCandidate } from "@/types";

import { describeError, isStatus } from "./api-errors";
import { saveManifestCfm } from "./manifests-api";
import type { SpreadsheetTable } from "./spreadsheet";

/** 表头按别名找列，不认位置；大小写、空格、标点都不敏感。 */
function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findColumn(headers: string[], aliases: string[]): string | null {
  const wanted = new Set(aliases.map(normalizeHeader));
  for (const h of headers) {
    if (wanted.has(normalizeHeader(h))) return h;
  }
  return null;
}

const ORDER_NUMBER_ALIASES = [
  "chd#",
  "chd #",
  "chd",
  "order#",
  "order #",
  "order no",
  "order no.",
  "order number",
  "booking number",
  "booking no",
];
const CONFIRMATION_ALIASES = [
  "confirmation#",
  "confirmation #",
  "confirmation",
  "confirmation no",
  "confirmation no.",
  "confirmation number",
  "cfm#",
  "cfm #",
  "cfm no",
];
const PAX_ALIASES = [
  "no of pax",
  "no. of pax",
  "pax",
  "party size",
  "guests",
  "number of pax",
  "pax count",
];
const SERVICE_DATE_ALIASES = [
  "service date",
  "date",
  "tour date",
  "travel date",
];
const LEAD_NAME_ALIASES = [
  "lead name",
  "name",
  "guest name",
  "customer",
  "customer name",
];

export function normalizeOrderNumber(s: string): string {
  return s.trim().toUpperCase();
}

/** 数字列里常见的 "2 Adults"、"2 adult, 1 child" 这类文字：只取里面出现的数字加总；纯数字直接用。 */
function parsePax(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const nums = text.match(/\d+/g);
  if (!nums) return null;
  return nums.reduce((sum, n) => sum + Number(n), 0);
}

export interface CfmImportFileRow {
  /** 文件里的行号（表头算第 1 行，第一条数据是第 2 行），纯用来在预览里指给用户看。 */
  line: number;
  orderNumber: string;
  confirmationNo: string;
  pax: number | null;
  serviceDate: string;
  leadName: string;
  /** 原始整行（表头原文做键），预览表要照原样显示其余列时用。 */
  raw: Record<string, string>;
}

export interface ParsedCfmImportFile {
  headers: string[];
  rows: CfmImportFileRow[];
  /** 其余列（原表头原文，去掉已经认领的那几列），预览表按这个顺序显示。 */
  extraColumns: string[];
}

/** 表头里缺订单号列或确认号列：没法继续，调用方直接把这个消息显示出来。 */
export class CfmImportColumnsError extends Error {}

export function parseCfmImportFile(table: SpreadsheetTable): ParsedCfmImportFile {
  const orderCol = findColumn(table.headers, ORDER_NUMBER_ALIASES);
  const cfmCol = findColumn(table.headers, CONFIRMATION_ALIASES);
  if (!orderCol || !cfmCol) {
    const missing = [
      !orderCol ? "an order number column (e.g. \"CHD #\")" : null,
      !cfmCol ? "a confirmation number column (e.g. \"Confirmation#\")" : null,
    ].filter((x): x is string => x !== null);
    throw new CfmImportColumnsError(
      `Could not find ${missing.join(" and ")} in the file's header row.`,
    );
  }
  const paxCol = findColumn(table.headers, PAX_ALIASES);
  const dateCol = findColumn(table.headers, SERVICE_DATE_ALIASES);
  const nameCol = findColumn(table.headers, LEAD_NAME_ALIASES);
  const claimed = new Set([orderCol, cfmCol, paxCol, dateCol, nameCol].filter(Boolean));
  const extraColumns = table.headers.filter((h) => !claimed.has(h));

  const rows: CfmImportFileRow[] = table.rows.map((raw, i) => ({
    line: i + 2,
    orderNumber: (raw[orderCol] ?? "").trim(),
    confirmationNo: (raw[cfmCol] ?? "").trim(),
    pax: paxCol ? parsePax(raw[paxCol] ?? "") : null,
    serviceDate: dateCol ? (raw[dateCol] ?? "").trim() : "",
    leadName: nameCol ? (raw[nameCol] ?? "").trim() : "",
    raw,
  }));
  return { headers: table.headers, rows, extraColumns };
}

export function buildManifestOrderIndex(
  candidates: ManifestMatchCandidate[],
): Map<string, ManifestMatchCandidate[]> {
  const index = new Map<string, ManifestMatchCandidate[]>();
  for (const c of candidates) {
    const key = normalizeOrderNumber(c.order_number);
    const list = index.get(key);
    if (list) list.push(c);
    else index.set(key, [c]);
  }
  return index;
}

export type CfmImportStatus =
  | "match"
  | "pax_mismatch"
  | "ambiguous"
  | "duplicate_in_file"
  | "missing"
  | "no_order_number"
  | "no_confirmation";

export interface CfmImportPreviewRow {
  file: CfmImportFileRow;
  status: CfmImportStatus;
  /** 红色 / 缺失行给人看的原因；match 行为空串。 */
  reason: string;
  /** 只有 status === "match" 才有：写入 Cfm # 要用的定位信息。 */
  target: { product_code: string; tour_date: string; systemPax: number | null } | null;
}

export function matchCfmImportRows(
  rows: CfmImportFileRow[],
  index: Map<string, ManifestMatchCandidate[]>,
): CfmImportPreviewRow[] {
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (!r.orderNumber) continue;
    const key = normalizeOrderNumber(r.orderNumber);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  return rows.map((file): CfmImportPreviewRow => {
    if (!file.orderNumber) {
      return { file, status: "no_order_number", reason: "No order number in this row.", target: null };
    }
    if (!file.confirmationNo) {
      return { file, status: "no_confirmation", reason: "No confirmation number in this row.", target: null };
    }
    const key = normalizeOrderNumber(file.orderNumber);
    if ((seen.get(key) ?? 0) > 1) {
      return {
        file,
        status: "duplicate_in_file",
        reason: `${file.orderNumber} appears more than once in this file.`,
        target: null,
      };
    }
    const candidates = index.get(key);
    if (!candidates || candidates.length === 0) {
      return {
        file,
        status: "missing",
        reason: "Order number not found in this day's Manifests.",
        target: null,
      };
    }
    if (candidates.length > 1) {
      return {
        file,
        status: "ambiguous",
        reason: `This order has ${candidates.length} rows in the system for this day — pick the product manually.`,
        target: null,
      };
    }
    const match = candidates[0];
    if (file.pax !== null && match.pax !== null && file.pax !== match.pax) {
      return {
        file,
        status: "pax_mismatch",
        reason: `Pax mismatch: file says ${file.pax}, system says ${match.pax}.`,
        target: { product_code: match.product_code, tour_date: match.tour_date, systemPax: match.pax },
      };
    }
    return {
      file,
      status: "match",
      reason: "",
      target: { product_code: match.product_code, tour_date: match.tour_date, systemPax: match.pax },
    };
  });
}

export interface CfmWriteResult {
  row: CfmImportPreviewRow;
  ok: boolean;
  error?: string;
}

/**
 * 只写 status === "match" 的行，逐条调用已有的单条 Cfm # 接口（没有批量接口）。
 * 顺序执行、每条都报进度，出错继续下一条（不是「出错就停」——这些是互相独立的订单，
 * 一条失败不代表别的也会失败，和发送页「出错就停」的场景不一样）。401 整批停，
 * 调用方捕获后跳登录页；已经写成功的那几条不受影响（后端已经存了）。
 */
export async function writeCfmRows(
  matched: CfmImportPreviewRow[],
  onProgress: (done: number, total: number) => void,
): Promise<CfmWriteResult[]> {
  const results: CfmWriteResult[] = [];
  for (let i = 0; i < matched.length; i++) {
    const row = matched[i];
    if (!row.target) continue;
    try {
      await saveManifestCfm({
        order_number: row.file.orderNumber,
        product_code: row.target.product_code,
        tour_date: row.target.tour_date,
        confirmation_no: row.file.confirmationNo,
      });
      results.push({ row, ok: true });
    } catch (e) {
      if (isStatus(e, 401)) throw e;
      results.push({
        row,
        ok: false,
        error: isStatus(e, 404)
          ? "This order / product / date is no longer in Rezdy."
          : describeError(e),
      });
    }
    onProgress(i + 1, matched.length);
  }
  return results;
}
