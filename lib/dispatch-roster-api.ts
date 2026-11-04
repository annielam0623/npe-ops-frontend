import { apiFetch } from "@/lib/api-client";

/**
 * G192 Dispatch 司机 / 导游名单（后端 2e `app/routers/dispatch_roster.py`，Annie 2026-10-26「ok」按 preview 全 A）。
 * 名单就是 HR profiles 里 position 是 driver / guide / both 的人（和排车下拉同一份）；Driver + Guide 的人两边都出现。
 * 看要 dispatch.view、加要 dispatch.edit，都在开关 `dispatch_roster` 后面（partner 勾了也能用）。
 */
export type RosterType = "driver" | "guide" | "both";

export interface RosterPerson {
  id: number;
  /** nickname，没有就 legal_name（同下拉）。 */
  name: string;
  phone: string | null;
  type: RosterType;
}

export interface Roster {
  drivers: RosterPerson[];
  guides: RosterPerson[];
  /**
   * 名单能改（后端有 PUT 且当前账号有 dispatch.edit）。没有这个键 = 后端还没上线，不出 Edit 键。
   */
  can_edit?: boolean;
}

/** 改名单上一个人的结果。 */
export interface RosterEditResult extends RosterPerson {
  /** 改了名字时加进这个人 HR「Other spellings」的旧名字；没加（没改名 / 已经有 / 是别人的写法）为 null。 */
  old_name_added: string | null;
}

export function fetchRoster(signal?: AbortSignal): Promise<Roster> {
  return apiFetch<Roster>("/api/dispatch/roster", {
    cache: "no-store",
    signal,
  });
}

/**
 * 加一个人（只填名字 + 电话）。400 = 名字空 / 电话太短太长；409 = 电话已经在名单上（后端原话带着那个人的名字）。
 * 每次添加后端都记进 Settings › Human Resource 的日志。
 */
export function addRosterPerson(body: {
  name: string;
  phone: string;
  type: "driver" | "guide";
}): Promise<RosterPerson> {
  return apiFetch<RosterPerson>("/api/dispatch/roster", {
    method: "POST",
    body,
  });
}

/**
 * 改一个人的名字和电话（Annie 2026-11-03「Dispatch名单编辑-动手」，题 1–4 按推荐 A）。
 * 名字写进 HR 的 Nickname；改了名字后端把旧名字加进 Other spellings。409 = 电话已经是别人的（后端原话）。
 * 每次改动后端记进 Settings › Human Resource 的日志（电话只记「改了电话」）。
 */
export function updateRosterPerson(
  id: number,
  body: { name: string; phone: string },
): Promise<RosterEditResult> {
  return apiFetch<RosterEditResult>(`/api/dispatch/roster/${id}`, {
    method: "PUT",
    body,
  });
}

/** 只比数字（同后端判重）。 */
export function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}
