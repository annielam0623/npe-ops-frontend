// 统一自动通知开关页（Settings → Notifications）。形状按后端设计稿 §11.4 和 7d 的草案：
// GET /api/settings/notification-switches → { switches: [...] }；后端是权威，7d 的最终样例出来后核对字段名。

export interface NotificationSample {
  subject?: string;
  body?: string;
}

export interface NotificationSwitch {
  key: string;
  label: string;
  /** 一句话说明，写明关着会怎样。 */
  description: string;
  enabled: boolean;
  /** 打开的时刻（ISO）；关着或没有时为 null。 */
  enabled_at?: string | null;
  group?: string;
  /** true = 开关在别的页面管（目前只有定时自动发送），这里只显示真实状态 + 链接。 */
  managed_elsewhere?: boolean;
  /** 我能不能改它。 */
  can_edit?: boolean;
  /** false = 登记了但代码里还没有地方检查这个开关：标 Not connected yet，不让点。 */
  wired?: boolean;
  trigger?: string;
  recipients?: string;
  sample?: string | NotificationSample | null;
}

export interface NotificationSwitchList {
  switches: NotificationSwitch[];
}

/** 周三排班确认的设置（GET 所有员工可读，PUT 仅 Super Admin）。 */
export interface ScheduleConfirmSettings {
  enabled: boolean;
  weekday: "wed";
  /** 洛杉矶时间 24 小时 "HH:MM"。 */
  time: string;
}
