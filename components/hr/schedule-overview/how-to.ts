// G382 总览 How to use（系统文字英文；原文照 preview v3 第 1 节 / 第 1b 节，Annie 2026-11-26 同意）。

export const HOW_TO_USE: readonly string[] = [
  "This is the live schedule for several weeks in a row, one week under another. Pick 2, 4, 6 or 8 weeks. When the window is narrow, the times get smaller so each week still fits.",
  "Drag a shift to another person or day (also across weeks). Click an empty cell to add a shift or leave. Nothing is saved until you press Save.",
  "Leave requests: click one to approve, reject, or change the date, hours or type first. For all-day leave, give that day’s shifts to someone or delete them in the same box. For leave by the hour in a published week, pick who covers those hours before you approve.",
  "Gaps: times with nobody on. Click Fill to pick someone who is free and doesn’t break a rule.",
  "Rule problems are checked across weeks (for example Saturday Close then Sunday morning). A change that makes a new problem can’t be saved; fix the shifts and save again.",
  "Publish each week from its title bar. After changing a published week, use Send to confirm.",
];

/** K3 A：只给 Super Admin 看（preview v3 第 6 节）。 */
export const HOW_TO_USE_TAKE_OVER: readonly string[] = [
  "Super Admin: if someone else is editing a week, press Take over in the red message to edit it yourself. Their changes that weren’t saved are lost, and they see a message within a minute.",
];

export const HOW_TO_USE_APPROVER: readonly string[] = [
  "If you can only approve leave, you see the whole schedule but can’t change shifts. Click a leave request to approve or reject it.",
];
