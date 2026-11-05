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
}

/**
 * 当天上下班（Q5 B 要 Hours）。按「人 + 天」一对，不分到每条 run。
 * samsara = 司机 Samsara HOS；fallback = Samsara 不全，下班按 23:00 兜底（note 说缺什么）；
 * schedule = 导游按团的排定时间；none = 没有。时间是 ISO（带时区）。
 */
export interface FieldHours {
  start_at: string | null;
  end_at: string | null;
  source: "samsara" | "fallback" | "schedule" | "none";
  note: string | null;
}

export interface FieldCalendarDay {
  date: string;
  role: FieldRole;
  source: FieldDaySource;
  /** 那天存了快照（📷）。 */
  snapshot: boolean;
  runs: FieldRun[];
  /** 后端 Hours 没上线前没有这个键。 */
  hours?: FieldHours | null;
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
  people: FieldCalendarPerson[];
}

/** 带 hr_id：只这一个人。 */
export interface FieldCalendarOne extends FieldCalendarPerson {
  from: string;
  to: string;
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
