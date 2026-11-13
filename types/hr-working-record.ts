/**
 * Settings › Human Resource › Working Record（置顶 86，Annie「working record这里全部同意推荐，动手」）：
 * 每位司机 / 导游每天做了什么（日历，算工资用）+ 当天快照。
 * 形状照后端 18 定的（94 转，没上线）：GET /api/field-calendar、GET /api/field-snapshots/{hr_id}。
 */

export type FieldRole = "driver" | "guide" | "both";

/**
 * 这一天的来源：not_completed = 没点 Completed，每晚存的排班；completed = 点了 Completed 那一版；
 * after_edit = 存了以后又改过；live = 还没存档，按现在的 Dispatch 算（之后可能变）。
 */
export type FieldDaySource =
  "not_completed" | "completed" | "after_edit" | "live";

/** 136：那天 Dispatch 有没有点 Completed。 */
export type FieldDayStatus = "completed" | "not_completed";

export interface FieldRun {
  shift: string;
  kind: string;
  /** 段名，例如 relay 段「Hotel pickups to Treasure Island」、团车段「Bus tour South Rim」。 */
  title: string;
  manifest_id: number | null;
  tour_name: string | null;
  van: string | null;
  as: "driver" | "guide";
  start_at: string | null;
  end_at: string | null;
  /**
   * 137 留位置（Annie 2026-11-13「2个问题都同意推荐，动手」）：这一段相关的 Daily Operation Report。
   * 题 2 A：只算直接点名这个人的——投诉对象是这个司机 / 导游，或事故的司机是他；由后端算好，前端不拿名字去猜。
   * 题 1 A：现在页面不显示；后端带上以后先出 preview，Annie 同意再显示。字段名以后端最终为准。没带 = 后端还没做。
   */
  reports?: FieldRunReport[];
}

/** 137：卡上要显示的一份 Daily Operation Report 摘要（暂定形状，等后端定）。 */
export interface FieldRunReport {
  id: number;
  report_type: "complaint" | "accident" | "emergency";
  headline: string;
  status: "open" | "in_progress" | "resolved";
}

/**
 * 不做 Hours（Annie 2026-11-05 在后端 11 窗口：「不要麻烦了……因为他们上下班是打卡，所以不重要了」）：每天不带 hours。
 */
export interface FieldCalendarDay {
  date: string;
  role: FieldRole;
  source: FieldDaySource;
  /**
   * 136（后端 G290 4e91cece；Annie 2026-11-13「3个问题都是A」「动手」）：那天 Dispatch 有没有点 Completed。
   * Not completed 标签、虚线框、Export 的 Status 都只看它，不看 source（点过 Completed 的日子也会回 source live）。
   * 没带 = 旧后端，当作 completed。
   */
  status?: FieldDayStatus;
  /** 那天存了快照（📷）。 */
  snapshot: boolean;
  runs: FieldRun[];
}

export interface FieldCalendarPerson {
  hr_id: number;
  name: string;
  /** HR 的 Position（driver / guide / both / ""），分 Drivers / Guides 两节用。 */
  position: string;
  days: FieldCalendarDay[];
}

/** 不带 hr_id：所有能看的人。 */
export interface FieldCalendarAll {
  from: string;
  to: string;
  /** 136：实际给到的最后一天 = min(to, 洛杉矶今天)；之后的日子不返回，格子留空。 */
  through?: string;
  people: FieldCalendarPerson[];
}

/** 带 hr_id：只这一个人。 */
export interface FieldCalendarOne extends FieldCalendarPerson {
  from: string;
  to: string;
  through?: string;
}

export type FieldSnapshotTrigger =
  | "relay_10am"
  | "checked_out"
  | "not_checked_out"
  | "guide_time"
  | "after_completion";

export interface FieldSnapshotVersion {
  version: number;
  trigger: FieldSnapshotTrigger | string;
  created_at: string;
}

export type FieldGuestStatus = "picked_up" | "boarded" | "no_show" | null;

export interface FieldSnapshotData {
  shifts: Array<{ shift: string; title: string; van: string | null }>;
  stops: Array<{
    van: string | null;
    location_id: number | null;
    hotel: string;
    arrived_at: string | null;
    left_at: string | null;
    dwell_minutes: number | null;
  }>;
  sms: {
    sent: number;
    by: Array<{
      author: string;
      count: number;
      source?: "driver_page" | "staff";
    }>;
  };
  guests: {
    pax: number;
    picked_up: number;
    boarded: number;
    no_show: number;
    not_marked: number;
  };
  roster: Array<{
    order_number: string;
    pax: number;
    status: FieldGuestStatus;
    at: string | null;
    by: string | null;
    source: "relay" | "boarding";
  }>;
  generated_at: string;
}

export interface FieldSnapshot {
  hr_id: number;
  name: string;
  kind: "driver" | "guide";
  run_date: string;
  version: number;
  trigger: FieldSnapshotTrigger | string;
  created_at: string;
  versions: FieldSnapshotVersion[];
  data: FieldSnapshotData;
}
