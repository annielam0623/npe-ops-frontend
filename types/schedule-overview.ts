/*
 * G382 排班总览（Settings › Human Resource › Schedule）的接口形状。
 * 契约：后端 npe-confirmation-service task/g382-hr-schedule @ 77404fa0 docs/g382-hr-schedule/interface.md（2.1 / 2.2）。
 * 字段只加不删；version 是字符串（schedule_weeks.updated_at 的 ISO 文本），存的时候原样当 base_version 带回。
 */
import type { LeaveCategory, OverviewLeaveRequest, TimeOffOp } from "@/lib/schedule-leave-api";
import type { WeekConfirmations } from "@/lib/schedule-confirm-api";

import type {
  ScheduleGap,
  ScheduleSlot,
  ScheduleTimeOff,
  ScheduleViolation,
  ScheduleWeekChangesResult,
  ScheduleWeekOp,
  ScheduleWeekStatus,
} from "./schedule";

export type { LeaveCategory };

/** 2.1 weeks_info 一行。 */
export interface OverviewWeekInfo {
  week_start: string;
  status: ScheduleWeekStatus;
  /** 还没建的周 = null。 */
  version: string | null;
  published_with_gaps: boolean;
}

/** 2.1 employees 一行（已按 sort_order、名字排好，含停用的人）。 */
export interface OverviewEmployee {
  id: number;
  name: string;
  is_active: boolean;
}

/** 2.1 change_requests 每周一项 = GET weeks/{w}/confirmations 那一份 + week_start。 */
export type OverviewChangeRequests = WeekConfirmations & { week_start: string };

/** GET /api/schedule/range?from=&weeks= 的回包。 */
export interface ScheduleRange {
  from: string;
  weeks: number;
  can_edit: boolean;
  can_publish: boolean;
  can_manage_leave_types: boolean;
  weeks_info: OverviewWeekInfo[];
  employees: OverviewEmployee[];
  slots: ScheduleSlot[];
  time_off: ScheduleTimeOff[];
  gaps: ScheduleGap[];
  violations: ScheduleViolation[];
  leave_requests: OverviewLeaveRequest[];
  /** can_edit=false 时 []。 */
  change_requests: OverviewChangeRequests[];
}

/** range/changes 的 op = 班的 op + 录 / 删假。 */
export type RangeOp = ScheduleWeekOp | TimeOffOp;

/** POST /api/schedule/range/changes 的请求体。只录 / 删假的周也要列（不查锁和版本）。 */
export interface RangeChangesBody {
  weeks: {
    week_start: string;
    lock_token: string | null;
    base_version: string | null;
  }[];
  ops: RangeOp[];
}

/** 2.2 成功回包；weeks 只含有班 op 的周。 */
export interface RangeChangesResult {
  weeks: Record<string, ScheduleWeekChangesResult>;
  time_off: ScheduleTimeOff[];
  /** 还存在的旧违规。 */
  violations: ScheduleViolation[];
}
