import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/types";

/**
 * Staff Schedule › Period › Share with staff（Annie 2026-11-08 preview HnBVL6wANcCZYs1r1enq3W ②，后端 33
 * `task/schedule-period-share` 的形状，2026-11-08 晚）：
 * `POST /api/schedule/period/share {start, weeks, dry_run}`。
 *  - dry_run = true：确认框用，不发、不写。
 *  - 真发：有没发布的周 ⇒ 409 `{detail: {detail, code: "unpublished", weeks}}`；邮件文字缺 / 链接坏 ⇒ 503，一封都不发。
 * 权限：schedule.publish 的勾，并且 schedule_period 对他可见；start 早于本周日或晚于本周日 + 4 周 ⇒ 400（英文原话）。
 */

export interface PeriodPerson {
  employee_id: number;
  name: string;
}

export interface PeriodNotReached extends PeriodPerson {
  /** "no email" / "email could not be sent" / "link could not be made"。 */
  reason: string;
}

export interface PeriodSharePreview {
  start: string;
  /** 最后一周的周六。 */
  end: string;
  weeks: number;
  week_starts: string[];
  /** 还没发布的周（非空 ⇒ 不能发）。 */
  unpublished: string[];
  recipients: PeriodPerson[];
  not_reached: PeriodNotReached[];
  /** 置顶 109 W4 第二段（后端 f30d895a）：没邮箱的人，why = "No email"。没带 = 旧后端，按 not_reached 拆。 */
  no_contact?: PeriodNoContact[];
  /** 有邮箱、发不出 / 链接做不出（reason "email could not be sent" / "link could not be made"）。 */
  failed?: PeriodNotReached[];
  /** 同一个 start + weeks 以前发过的。 */
  already_shared: { at: string; by: string }[];
}

export interface PeriodNoContact extends PeriodPerson {
  why: string;
}

export interface PeriodShareResult {
  start: string;
  end: string;
  weeks: number;
  notified: (PeriodPerson & { channels: string[] })[];
  not_reached: PeriodNotReached[];
  no_contact?: PeriodNoContact[];
  failed?: PeriodNotReached[];
}

/**
 * 没收到的人拆成两份（置顶 109：没联系方式灰字、不算失败；发失败红字）。后端带 no_contact / failed 就用；
 * 旧后端只有 not_reached，reason "no email" = 没联系方式。
 */
export function splitMissed(r: {
  not_reached?: PeriodNotReached[];
  no_contact?: PeriodNoContact[];
  failed?: PeriodNotReached[];
}): { noContact: PeriodNoContact[]; failed: PeriodNotReached[] } {
  if (r.no_contact || r.failed)
    return { noContact: r.no_contact ?? [], failed: r.failed ?? [] };
  const all = r.not_reached ?? [];
  return {
    noContact: all
      .filter((p) => p.reason.toLowerCase() === "no email")
      .map((p) => ({
        employee_id: p.employee_id,
        name: p.name,
        why: "No email",
      })),
    failed: all.filter((p) => p.reason.toLowerCase() !== "no email"),
  };
}

export function previewPeriodShare(
  start: string,
  weeks: number,
): Promise<PeriodSharePreview> {
  return apiFetch<PeriodSharePreview>("/api/schedule/period/share", {
    method: "POST",
    body: { start, weeks, dry_run: true },
  });
}

export function sendPeriodShare(
  start: string,
  weeks: number,
): Promise<PeriodShareResult> {
  return apiFetch<PeriodShareResult>("/api/schedule/period/share", {
    method: "POST",
    body: { start, weeks, dry_run: false },
  });
}

/** 409 unpublished 的 detail 是一层对象：取里面的英文原话和周。 */
export function shareErrorOf(error: unknown): {
  message: string | null;
  weeks: string[];
} {
  if (error instanceof ApiError) {
    const body = error.body as { detail?: unknown } | null;
    const d = body?.detail;
    if (d && typeof d === "object") {
      const o = d as { detail?: unknown; weeks?: unknown };
      return {
        message: typeof o.detail === "string" ? o.detail : null,
        weeks: Array.isArray(o.weeks)
          ? o.weeks.filter((w): w is string => typeof w === "string")
          : [],
      };
    }
  }
  return { message: null, weeks: [] };
}
