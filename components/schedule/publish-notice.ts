import type { SchedulePublishResult } from "@/types";

/**
 * 发布后的提示（Annie 2026-10-30 置顶 15「同意」「以上内容全都动手」）：列出谁没收到。
 * 后端 ef task/republish-recipients-by-perm：notified 只列真发出的，not_reached 是没收到的人和原因。
 * - 都收到：「Published. Notified 6 people.」（照旧）
 * - 有人没收到：「Published. Notified 4 people. 2 couldn't be reached: Jing, Anita (no email or login).」，没收到那段红字；
 *   两种原因混着时按原因分组。
 * - 都没收到：「Published, but no one was notified: Nadia, Veronica have no email or login. Add their email in Employees.」整句红字。
 * - Publish again 同样写法，「Notified N staff and M schedule editors」照 62 的写法。
 */
export interface PublishNotice {
  /** 绿字那段（都没收到时是空串）。 */
  ok: string;
  /** 红字那段：谁没收到；没有就是 null。 */
  unreached: string | null;
  /** 一个都没通知到：整句红字。 */
  allFailed: boolean;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** 按原因分组：「Jing, Anita (no email or login); Nadia (email could not be sent)」。 */
function groupByReason(
  list: NonNullable<SchedulePublishResult["not_reached"]>,
): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const p of list)
    groups.set(p.reason, [...(groups.get(p.reason) ?? []), p.name]);
  return [...groups.entries()];
}

export function publishNotice(result: SchedulePublishResult): PublishNotice {
  const n = result.notified.length;
  const m = result.notified_supervisors?.length ?? 0;
  const missed = result.not_reached ?? [];
  const again = !!result.republished;

  if (again && n === 0 && m === 0 && missed.length === 0)
    return {
      ok: "Published again. No one's shifts or time off changed, so no one was notified.",
      unreached: null,
      allFailed: false,
    };

  if (n === 0 && m === 0 && missed.length) {
    const groups = groupByReason(missed);
    const parts = groups.map(([reason, names]) =>
      reason === "no email or login"
        ? `${names.join(", ")} ${names.length === 1 ? "has" : "have"} no email or login`
        : `${names.join(", ")}: ${reason}`,
    );
    const addEmail = groups.some(([r]) => r === "no email or login")
      ? " Add their email in Employees."
      : "";
    return {
      ok: "",
      unreached: `${again ? "Published again" : "Published"}, but no one was notified: ${parts.join("; ")}.${addEmail}`,
      allFailed: true,
    };
  }

  const ok = again
    ? n === 0
      ? `Published again. Notified ${plural(m, "schedule editor", "schedule editors")}.`
      : `Published again. Notified ${plural(n, "staff member", "staff")}${m ? ` and ${plural(m, "schedule editor", "schedule editors")}` : ""}.`
    : `Published. Notified ${plural(n, "person", "people")}.`;
  if (!missed.length) return { ok, unreached: null, allFailed: false };
  const groups = groupByReason(missed)
    .map(([reason, names]) => `${names.join(", ")} (${reason})`)
    .join("; ");
  return {
    ok,
    unreached: `${missed.length} couldn't be reached: ${groups}.`,
    allFailed: false,
  };
}
