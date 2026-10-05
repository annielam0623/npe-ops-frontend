import { apiFetch } from "@/lib/api-client";
import type {
  DispatchCopyResult,
  DispatchDay,
  DispatchImports,
  DispatchPrefill,
  DispatchPullResult,
  DispatchRow,
  DispatchSaveResult,
} from "@/types";

/**
 * Dispatch → Assignments。全部 require_staff。
 * ⚠️ 保存是**整天覆盖**、后存的赢（没有版本检查）；保存后司机手机页和 manifest 立刻读到新排车。
 * 保存不发短信；手填了 HR 里没有的人时，服务端给 Annie 发一封邮件（每个名字一次）。
 */
const API = "/api/dispatch";

/** date 不传 = 服务端默认（洛杉矶明天）。 */
export function fetchDispatchDay(
  date: string | null,
  signal?: AbortSignal,
): Promise<DispatchDay> {
  return apiFetch<DispatchDay>(`${API}/day`, {
    cache: "no-store",
    signal,
    query: date ? { date } : undefined,
  });
}

/** 送去保存的行：去掉只用来显示的名字和 CCL 原文，只送 CCL 是哪一行。 */
function postRows(rows: DispatchRow[]) {
  return rows.map((r) => ({
    id: r.id,
    shift: r.shift,
    driver_hr_id: r.driver_hr_id,
    driver_typed_name: r.driver_typed_name,
    vehicle_id: r.vehicle_id,
    manifest_id: r.manifest_id,
    custom_tour_name: r.custom_tour_name,
    guide_hr_id: r.guide_hr_id,
    guide_typed_name: r.guide_typed_name,
    bus_label: r.bus_label,
    note: r.note,
    location_ids: r.location_ids,
    ccl_line_id: r.ccl ? r.ccl.line_id : null,
  }));
}

export function saveDispatchDay(
  date: string,
  rows: DispatchRow[],
  cclImportId: number | null,
): Promise<DispatchSaveResult> {
  return apiFetch<DispatchSaveResult>(`${API}/day`, {
    method: "POST",
    body: { date, rows: postRows(rows), ccl_import_id: cclImportId },
  });
}

/** 照抄另一天：**直接写库**（不经过 Save）。 */
export function copyDispatchDay(
  date: string,
  from: string,
): Promise<DispatchCopyResult> {
  return apiFetch<DispatchCopyResult>(`${API}/copy`, {
    method: "POST",
    body: { date, from },
  });
}

/** CCL 当前这一版（预填 / 改版 / 关闭的线）。拿不到就当没有。 */
export async function fetchDispatchPrefill(
  date: string,
): Promise<DispatchPrefill | null> {
  const result = await apiFetch<{ prefill: DispatchPrefill | null }>(
    `${API}/imports/day`,
    { cache: "no-store", query: { date } },
  );
  return result.prefill;
}

/**
 * Dispatch Imports：CCL 消息的导入记录（只读）。since 不传 = 服务端默认（今天往前 7 天）；读不懂 400。
 * 名字 / 车按**现在**的 HR 重新匹配（不给导入那一刻的 id 快照）。
 */
export function fetchDispatchImports(
  since: string | null,
  signal?: AbortSignal,
): Promise<DispatchImports> {
  return apiFetch<DispatchImports>(`${API}/imports`, {
    cache: "no-store",
    signal,
    query: since ? { since } : undefined,
  });
}

/** 从 Discord 拉 CCL 的消息（读 Discord、写导入表，不动排车）。服务端自带锁和 5 秒冷却；永远 200。 */
export function pullFromDiscord(
  trigger: "page" | "manual",
): Promise<DispatchPullResult> {
  return apiFetch<DispatchPullResult>(`${API}/imports/pull`, {
    method: "POST",
    body: { trigger },
  });
}

// ── Morning Relay guests（后端 relay_pull，2026-10-04 合进 main）────────────────

export interface RelayGuest {
  id: number;
  order_number: string;
  name: string;
  pax: number | null;
  pickup_time: string;
  pickup_location: string;
  tour: string;
  /** 这一天已经发过早班短信（send_log 有成功记录）。 */
  sent: boolean;
  /** 司机在酒店标的：no_show / 空。 */
  relay_status: string;
  /** 发过之后又改了的地方（接客时间、酒店、车）；不会自动重发。 */
  changed: string[];
}

export interface RelayPull {
  run_date: string;
  round_labels: Record<string, { name: string; when: string }>;
  rounds: Record<
    string,
    {
      car: { id: number; van: string | null; driver: string | null };
      guests: RelayGuest[];
    }[]
  >;
  need_a_look: (RelayGuest & { reason: string })[];
  /** 在团车出发点（Tour bus departure）上车、不进 relay 的单数。 */
  departure: number;
}

/** 当天两轮 + Need a look（只读：按已保存的排车和当天上传的 manifest 算，不写库、不发东西）。 */
export function fetchRelayPull(date: string): Promise<RelayPull> {
  return apiFetch<RelayPull>(`${API}/relay-pull`, {
    cache: "no-store",
    query: { date },
  });
}

/** 发某一轮之前：这次会发几位、已经发过几位（服务端重算，只读）。 */
export function fetchRelaySendPreview(
  date: string,
  round: string,
): Promise<{ to_send: number; already_sent: number }> {
  return apiFetch(`${API}/relay-send/preview`, {
    cache: "no-store",
    query: { date, round },
  });
}

/**
 * ⚠️ 真实发送：给这一轮还没发过的客人发早班短信（同 Morning Pickup 发送页的消息）。
 * 服务端自己重算名单、跳过发过的；同一轮同时只能一个人发（409）；只能发今天 / 明天（或全是测试单的测试日）。
 */
export function sendRelayRound(
  date: string,
  round: string,
): Promise<{
  round: string;
  sent: number;
  failed: number;
  already_sent: number;
}> {
  return apiFetch(`${API}/relay-send`, {
    method: "POST",
    body: { date, round },
    cache: "no-store",
  });
}

export interface DriverNotice {
  run_date: string;
  /** 发给司机的那句短信（只有链接）。 */
  text: string;
  last_sent: { at: string; by: string; label: string } | null;
  people: {
    name: string;
    phone: string;
    can_send: boolean;
    /** 发不了的原因（没手机号、HR 没连登录账号等）。 */
    why: string;
    cars: { shift: string; van: string | null; tour: string | null }[];
  }[];
}

/** Send to driver 会发给谁、发什么（只读）。 */
export function fetchDriverNotice(date: string): Promise<DriverNotice> {
  return apiFetch<DriverNotice>(`${API}/driver-notice`, {
    cache: "no-store",
    query: { date },
  });
}

/** ⚠️ 真实发送：给这一天排了车、能发的司机发短信（他们页面的链接）。同一天同时只能一个人发（409）。 */
export function sendDriverNotice(
  date: string,
): Promise<{ sent: string[]; failed: { name: string; error: string }[] }> {
  return apiFetch(`${API}/driver-notice/send`, {
    method: "POST",
    body: { date },
    cache: "no-store",
  });
}
