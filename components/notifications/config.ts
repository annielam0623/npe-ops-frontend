import { LA_TIME_ZONE } from "@/lib/la-date";
import type {
  NotificationSample,
  NotificationSwitch,
} from "@/types/notification-switches";

/** 周三排班确认、定时自动发送的开关不在 notification-switches 的存储里，页面里按这两个 key 特殊处理。 */
export const SCHEDULE_CONFIRM_KEY = "schedule_confirm";
export const AUTO_SEND_KEY = "auto_send";

/** 卡片顺序（Annie 2026-10-24 看过 preview 定稿）；不认识的新项排在后面，按后端给的顺序。 */
const ORDER = [
  "daily_task_reminders",
  "daily_task_shift_end_alert",
  "operation_report_notify",
  SCHEDULE_CONFIRM_KEY,
  AUTO_SEND_KEY,
];

export function sortSwitches(
  items: NotificationSwitch[],
): NotificationSwitch[] {
  const rank = (key: string) => {
    const i = ORDER.indexOf(key);
    return i === -1 ? ORDER.length : i;
  };
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item.key) - rank(b.item.key) || a.index - b.index)
    .map((x) => x.item);
}

/**
 * 后端列表里没带这两项时的兜底文字（正式文字以后端的 label / description / trigger / recipients / sample 为准，
 * 有就用后端的）。样稿 https://claude.ai/artifact/HMF3ZUz2M4zYMd23gJTv7t。
 */
export const FALLBACK_SCHEDULE_CONFIRM: NotificationSwitch = {
  key: SCHEDULE_CONFIRM_KEY,
  group: "Schedule",
  label: "Weekly schedule confirmation",
  description:
    "Every Wednesday, asks each employee to confirm next week’s schedule (Accept or request changes). While this is off, nothing is sent and the confirmation step does not start.",
  enabled: false,
  trigger: "Wednesdays at the time set below (Los Angeles time).",
  recipients:
    "Every employee who has shifts next week and a linked account or email.",
  sample: {
    subject: "Please confirm your schedule for Oct 25 – Oct 31",
    body: "Open the schedule and tap Accept or Change.",
  },
};

export const FALLBACK_AUTO_SEND: NotificationSwitch = {
  key: AUTO_SEND_KEY,
  group: "Messages to guests",
  label: "Scheduled auto-send",
  description:
    "Sends tour confirmations and ticket reminders on a schedule, without anyone pressing Send. Each has its own switch on the Auto Send page.",
  enabled: false,
  managed_elsewhere: true,
  trigger: "The times set on the Auto Send page.",
  recipients:
    "Guests on the orders selected there; the ticket summary email goes to the addresses set there.",
  sample: {
    subject: "Tour confirmation",
    body: "Same wording as Send Tour Confirmation, sent automatically.",
  },
};

/** 打开前的确认文字（Annie 2026-10-24 看过 preview；每日任务提醒三点经 7d 定）。 */
const CONFIRM: Record<string, string[]> = {
  daily_task_reminders: [
    "Who gets reminders: the person a task is assigned to; for shared tasks, people on today’s schedule whose shift overlaps the task. People not linked to a system account receive nothing.",
    "Every reminder also sends an email to reservations@.",
    "No catch-up: tasks already overdue when you turn this on are never reminded, now or later. A task due in under 30 minutes still gets one “30 minutes left” reminder. End-of-shift alerts only cover shifts that end after you turn this on.",
  ],
  operation_report_notify: [
    "Saving an incident will notify the people in charge (or supervisors and reservations@ if none are set up).",
  ],
  [SCHEDULE_CONFIRM_KEY]: [
    "Next Wednesday at the set time, every scheduled employee will be asked to confirm next week’s schedule.",
  ],
};

export function confirmText(key: string): string[] {
  return (
    CONFIRM[key] ?? [
      "The system will start sending these messages by itself. Turn this on only when the people who receive them are set up.",
    ]
  );
}

export function normalizeSample(
  sample: NotificationSwitch["sample"],
): NotificationSample | null {
  if (!sample) return null;
  if (typeof sample === "string")
    return sample.trim() ? { body: sample } : null;
  if (typeof sample !== "object") return null;
  const { subject, body } = sample;
  if (!subject && !body) return null;
  return { subject, body };
}

const SINCE = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "Oct 24, 5:42 PM"（洛杉矶时间）；读不懂就返回空串。 */
export function formatSince(iso: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : SINCE.format(at);
}
