import { apiFetch } from "@/lib/api-client";
import type {
  DispatchCopyResult,
  DispatchDay,
  DispatchEditTiming,
  DispatchImports,
  DispatchPrefill,
  DispatchPrivateMatchResult,
  DispatchPullResult,
  DispatchRow,
  DispatchSaveResult,
  DispatchSectionSaveResult,
  DispatchSeating,
  SeatingMoveResult,
  MorningSendResult,
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
    // Farm out（G40）：只有 Farm out 车才带这两个字段（普通车不带，后端没上线时请求和以前一模一样）。
    // 点了 Back to our bus 的车明确送 false，免得后端留着旧的 Farm out。
    ...(r.farm_out
      ? { farm_out: true, partner_id: r.partner_id ?? null }
      : r.farm_out === false
        ? { farm_out: false, partner_id: null }
        : {}),
    // G82：undefined 时 JSON 不带这个键（后端没上线）；有了就必须原样送回，漏送订单号会丢。
    order_number: r.order_number,
    order_number_set_by_staff: r.order_number_set_by_staff,
    // 临时调座位数：同上，undefined 不送；有了必须原样送回，漏送 = 调整被静默清零。
    seat_adjustment: r.seat_adjustment,
  }));
}

/**
 * G82：把页面上当前的 Private 车送去配订单（无状态）。key 是页面给每行起的标识，原样带回；
 * 座位数服务端按 vehicle_id 查。staff 选的（set_by_staff）行原样保留。
 */
export function matchPrivateOrders(
  date: string,
  rows: {
    key: string;
    vehicle_id: number;
    order_number: string | null;
    order_number_set_by_staff: boolean;
  }[],
): Promise<DispatchPrivateMatchResult> {
  return apiFetch<DispatchPrivateMatchResult>(`${API}/private-match`, {
    method: "POST",
    body: { date, rows },
  });
}

/** 存这一天。`editToken` = 占住编辑拿到的（G71）；存成功后服务器自动放开这一天。别人占着 ⇒ 409。 */
export function saveDispatchDay(
  date: string,
  rows: DispatchRow[],
  cclImportId: number | null,
  editToken: string | null,
): Promise<DispatchSaveResult> {
  return apiFetch<DispatchSaveResult>(`${API}/day`, {
    method: "POST",
    body: {
      date,
      rows: postRows(rows),
      ccl_import_id: cclImportId,
      edit_token: editToken,
    },
  });
}

/**
 * 只存一个单元（relay / tour:<manifest_id> / private_tour）：`rows` 是这一块的全部车，整块替换；
 * 别的块和它们的行 id 不动。带 `edit_token`，不放锁、不改 Completed。
 */
export function saveDispatchSection(
  date: string,
  unit: string,
  rows: DispatchRow[],
  editToken: string | null,
): Promise<DispatchSectionSaveResult> {
  return apiFetch<DispatchSectionSaveResult>(`${API}/section`, {
    method: "POST",
    body: {
      date,
      unit,
      rows: postRows(rows),
      edit_token: editToken,
    },
  });
}

/** 照抄另一天：**直接写库**（不经过 Save）。同 Save 带 `edit_token`（G71）。 */
export function copyDispatchDay(
  date: string,
  from: string,
  editToken: string | null,
): Promise<DispatchCopyResult> {
  return apiFetch<DispatchCopyResult>(`${API}/copy`, {
    method: "POST",
    body: { date, from, edit_token: editToken },
  });
}

// ── 同一天同时只能一个人编辑（后端 G71，Annie 2026-10-15）────────────────────────

/**
 * 第一次动手改之前占住这一天。`stale: true` = 打开之后别人存过（先重读再改）；别人在改 ⇒ 409（detail 一句话）。
 * 只能占今天 −7 … +365 天。
 */
export function acquireEditLock(
  date: string,
  version: string | null,
): Promise<{
  token: string;
  stale: boolean;
  version: string;
  edit_timing?: DispatchEditTiming;
}> {
  return apiFetch(`${API}/edit-lock`, {
    method: "POST",
    body: { date, version },
  });
}

/** 占住期间定时心跳；`edited` = 上一次心跳以来动没动过手。409 ⇒ 编辑已结束（超时 / 重启 / 别的标签页接走）。 */
export function editLockHeartbeat(
  date: string,
  token: string,
  edited: boolean,
): Promise<{ ok: boolean }> {
  return apiFetch(`${API}/edit-lock/heartbeat`, {
    method: "POST",
    body: { date, token, edited },
  });
}

/** 不保存就放开（Discard / Exit / 换日期）。 */
export function releaseEditLock(
  date: string,
  token: string,
): Promise<{ released: boolean }> {
  return apiFetch(`${API}/edit-lock/release`, {
    method: "POST",
    body: { date, token },
  });
}

/** 关页面 / 离开时放开：keepalive 让请求在页面卸载后照样发出去（同源，带 cookie）。 */
export function releaseEditLockOnLeave(date: string, token: string): void {
  try {
    void fetch(`${API}/edit-lock/release`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, token }),
    }).catch(() => {});
  } catch {
    // 放不开也没关系：心跳断了服务器 3 分钟后自己放开。
  }
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
  /** 酒店在 pickup_locations 里的 id（后端 2026-10-19）；认不出是哪家酒店 = null。旧后端没有这个字段。 */
  location_id?: number | null;
  /** 官方酒店名；location_id 为 null 时是 ""。 */
  hotel?: string;
  tour: string;
  /** 这一天已经发过早班短信（send_log 有成功记录）。 */
  sent: boolean;
  /** 最近一次发出去的时间（ISO）；没发过 = null（后端 G61）。 */
  sent_at?: string | null;
  /** 最近一次谁发的；没发过 = ""。 */
  sent_by?: string;
  /** 司机在酒店标的：no_show / 空。 */
  relay_status: string;
  /** 发过之后又改了的地方（接客时间、酒店、车）；不会自动重发。 */
  changed: string[];
}

/** 整车不发的 relay 车（缺司机 / 没排接客站点）：`orders` 是这一轮被挡下的订单号，没客人的坏车是 []。 */
export interface RelayBlockedCar {
  car_id: number;
  car: string;
  problems: string[];
  orders: string[];
  /** G129：这一次被 `send_anyway` 覆盖、照发的订单号（`orders` 现在只含仍然被挡的）；预览接口永远是 []。 */
  overridden_orders?: string[];
}

export interface RelayPull {
  run_date: string;
  round_labels: Record<string, { name: string; when: string }>;
  rounds: Record<
    string,
    {
      car: {
        id: number;
        van: string | null;
        driver: string | null;
        /** 这台车不能发的原因（英文整句）；空 / 没有 = 可以发。 */
        problems?: string[];
      };
      guests: RelayGuest[];
    }[]
  >;
  need_a_look: (RelayGuest & { reason: string })[];
  /** 在团车出发点（Tour bus departure）上车、不进 relay 的单数。 */
  departure: number;
  /** 查发送状态之前的服务器时间：勾 Send anyway 时原样带回发送键（preview_at）。 */
  checked_at?: string;
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
): Promise<{
  to_send: number;
  already_sent: number;
  already_sent_orders?: string[];
  checked_at?: string;
  /** 被挡下的车（`to_send` 不含它们的客人）；没有 = 空数组 / 老后端没这个字段。 */
  blocked_cars?: RelayBlockedCar[];
}> {
  return apiFetch(`${API}/relay-send/preview`, {
    cache: "no-store",
    query: { date, round },
  });
}

/**
 * ⚠️ 真实发送：给这一轮还没发过的客人发早班短信（同 Morning Pickup 发送页的消息）。
 * 服务端自己重算名单、跳过发过的；同一轮同时只能一个人发（409）；只能发今天 / 明天（或全是测试单的测试日）。
 * G61：`order_numbers` 只发勾的这几单；发过的要再发放进 `send_anyway`，`preview_at` 带 relay-pull 的 checked_at。
 */
export function sendRelayRound(
  date: string,
  round: string,
  pick?: {
    order_numbers: string[];
    send_anyway?: string[];
    preview_at?: string;
  },
): Promise<{
  round: string;
  sent: number;
  failed: number;
  /** 以前发过、这次跳过的个数（不在 results 里）。 */
  already_sent: number;
  already_sent_orders?: string[];
  /** 发过、这次因 Send anyway 重发的。 */
  resent?: string[];
  /** 勾了但已不在这一轮名单上（没发）。 */
  not_on_round?: string[];
  checked_at?: string;
  /** 缺司机 / 没排接客站点的车整车不发（后端 G108）；这些车上的客人不进上面任何一项，HTTP 仍是 200。 */
  blocked_cars?: RelayBlockedCar[];
  /** G129：真的发出去了的、带着车问题（被 `send_anyway` 覆盖）的订单号。 */
  overridden_orders?: string[];
  /** 这次逐位的结果，和 Morning Pickup 发送页同一个形状（后端同一个 `send_morning_row()`）。 */
  results: MorningSendResult[];
}> {
  return apiFetch(`${API}/relay-send`, {
    method: "POST",
    body: { date, round, ...pick },
    cache: "no-store",
  });
}

export interface DriverNotice {
  run_date: string;
  /** 发给司机的那句短信（只有链接）。 */
  text: string;
  last_sent: { at: string; by: string; label: string } | null;
  people: {
    /** 这一行的稳定 id（`hr:<id>` 或 `typed:<名字>`）：挑着发给谁靠它，不靠数组下标（后端 2026-10-10 `8cdacda`）。 */
    key: string;
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

/**
 * ⚠️ 真实发送：给这一天排了车、能发的司机发短信（他们页面的链接）。同一天同时只能一个人发（409）。
 * `recipients`：勾选的司机 key，只发这些（每次都传；不传后端会发给所有能发的人）。
 */
export function sendDriverNotice(
  date: string,
  recipients: string[],
): Promise<{ sent: string[]; failed: { name: string; error: string }[] }> {
  return apiFetch(`${API}/driver-notice/send`, {
    method: "POST",
    body: { date, recipients },
    cache: "no-store",
  });
}

/** Seat guests：每个巴士团每台车（已保存的排车）装了哪些订单。 */
export function fetchSeating(
  date: string,
  signal?: AbortSignal,
): Promise<DispatchSeating> {
  return apiFetch<DispatchSeating>(`${API}/seating`, {
    cache: "no-store",
    signal,
    query: { date },
  });
}

/**
 * 把一张订单（这几位客人）挪到某台车：busLabel = 字母（标成 staff 定的）；null = Auto（交回自动分车）。
 * 字母必须是这个团已保存的车，否则 400「Bus X is not on the saved schedule…」。
 * auto_skipped（后端 G56）：Completed 那天选 Auto 不自动分车，客人留在 Not on a bus，回 true。
 */
export function moveSeating(
  guestIds: number[],
  busLabel: string | null,
): Promise<SeatingMoveResult> {
  return apiFetch<SeatingMoveResult>(`${API}/seating/move`, {
    method: "POST",
    body: { guest_ids: guestIds, bus_label: busLabel ?? "" },
  });
}
