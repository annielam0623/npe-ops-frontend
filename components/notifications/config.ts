import { LA_TIME_ZONE } from "@/lib/la-date";
import type {
  NotificationSample,
  NotificationSwitch,
} from "@/types/notification-switches";

/** 页面上把 auto_send_tour / auto_send_tickets 合成一张「定时自动发送」卡（Annie 看过的 preview 就是一张）。 */
export const AUTO_SEND_KEY = "auto_send";
export const AUTO_SEND_PREFIX = "auto_send_";
export const SCHEDULE_CONFIRM_KEY = "schedule_confirm";

/** 卡片顺序（Annie 2026-10-24 看过 preview 定稿）；不认识的新项排在后面，按后端给的顺序。 */
const ORDER = [
  "daily_task_reminders",
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
 * 兜底文案：后端的开关只有 label / description，没有 trigger / recipients / sample（后端也不打算加），
 * 所以 Details 里的「什么时候发 / 发给谁 / 内容样例」按 key 在前端写死（Annie 2026-10-24 看过的 preview
 * https://claude.ai/artifact/HMF3ZUz2M4zYMd23gJTv7t 里的文字）。后端以后若返回这三项就优先用后端的。
 * ⚠️ 这是人写的文字，不是服务器读出来的：对应的发送逻辑改了，要回来改这里。
 */
interface FallbackText {
  trigger: string;
  recipients: string;
  sample: NotificationSample;
}

const FALLBACK_TEXT: Record<string, FallbackText> = {
  daily_task_reminders: {
    trigger:
      "Every few minutes while the system runs: a task is 30 minutes from its due time; a task is past due and not done; a shift has ended with tasks left.",
    recipients:
      "The person a task is assigned to. Shared tasks with nobody assigned go to everyone on today’s schedule whose shift overlaps the task time. People on the schedule list who are not linked to a system account receive nothing. Every reminder also sends one email to reservations@. End-of-shift alerts go to supervisors.",
    sample: {
      subject: "Task due in 30 minutes",
      body: "Send last minute confirmations is due at 2:00 PM.\nOpen Dashboard → My tasks to mark it done.",
    },
  },
  operation_report_notify: {
    trigger: "Right after an incident is saved from “+ Log an incident”.",
    recipients:
      "The people in charge of that type (Complaints; Accidents & Emergencies) from the Team setup. If nobody is set up yet: supervisors and reservations@. The person who logged it is not notified.",
    sample: {
      subject: "[NPE] Accident logged — Bus 3",
      body: "Accident logged by Annie at 7:05 AM.\nMinor scrape in the hotel driveway. Photos taken by driver.\nOpen Daily Operation Report to follow up.",
    },
  },
  [SCHEDULE_CONFIRM_KEY]: {
    trigger: "Wednesdays at the time set below (Los Angeles time).",
    recipients:
      "Every employee who has shifts next week and a linked account or email.",
    sample: {
      subject: "Please confirm your schedule for Oct 25 – Oct 31",
      body: "Open the schedule and tap Accept or Change.",
    },
  },
  [AUTO_SEND_KEY]: {
    trigger: "The times set on the Auto Send page.",
    recipients:
      "Guests on the orders selected there; the ticket summary email goes to the addresses set there.",
    sample: {
      subject: "Tour confirmation",
      body: "Same wording as Send Tour Confirmation, sent automatically.",
    },
  },
};

/** 后端没返回的 trigger / recipients / sample 用兜底文案补上（后端有就用后端的）。 */
export function withFallbackText(item: NotificationSwitch): NotificationSwitch {
  const fb = FALLBACK_TEXT[item.key];
  if (!fb) return item;
  return {
    ...item,
    trigger: item.trigger || fb.trigger,
    recipients: item.recipients || fb.recipients,
    sample: item.sample || fb.sample,
  };
}

/** 定时自动发送那张合成卡的文字（后端是两项 auto_send_tour / auto_send_tickets，各有自己的 label）。 */
export const AUTO_SEND_CARD: NotificationSwitch = withFallbackText({
  key: AUTO_SEND_KEY,
  group: "Messages to guests",
  label: "Scheduled auto-send",
  description:
    "Sends tour confirmations and ticket reminders on a schedule, without anyone pressing Send. Each has its own switch on the Auto Send page.",
  enabled: false,
  managed_elsewhere: true,
  can_edit: false,
});

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
