import type { SchedulePublishResult } from "@/types";

/**
 * 发布后的提示（Annie 2026-10-30 置顶 15「同意」「以上内容全都动手」）：列出谁没收到。
 * 置顶 109（Annie「全 A」「动手」，W4 第二段）：没收到的分两种，和客人发送同一个口径——
 * - 发失败（failed，有地址、这次没发成）= 红字「1 couldn't be reached: Nadia (email could not be sent).」；
 * - 没联系方式（no_contact，没邮箱也没登录）= 灰字「No email or login: Jing, Anita.」，不算失败。
 * - 都收到：「Published. Notified 6 people.」（照旧）
 * - 都没收到：「Published, but no one was notified: Nadia, Veronica have no email or login. Add their email in Employees.」整句红框（照旧：
 *   一个都没通知到，要提醒发送人）。
 * - Publish again 同样写法，「Notified N staff and M schedule editors」照 62 的写法。
 * 后端带 no_contact / failed 就用它们；旧后端只有 not_reached，按 reason 拆（"no email or login" / "no email" = 没联系方式）。
 */
export interface PublishNotice {
  /** 绿字那段（都没收到时是空串）。 */
  ok: string;
  /** 红字那段：发失败的人；都没收到时是整句提示；没有就是 null。 */
  unreached: string | null;
  /** 灰字那段：没联系方式的人（不算失败）；没有就是 null。 */
  noContact: string | null;
  /** 一个都没通知到：整句红字。 */
  allFailed: boolean;
}

interface Missed {
  name: string;
  /** 没联系方式（灰）还是发失败（红）。 */
  noContact: boolean;
  /** 显示用的原因（小写，同旧 reason）。 */
  reason: string;
}

const NO_CONTACT_REASONS = new Set(["no email or login", "no email"]);

/** 后端的新两份优先（先 failed 后 no_contact）；旧后端只有 not_reached 时按 reason 拆、保持原顺序。 */
export function missedPeople(result: SchedulePublishResult): Missed[] {
  if (result.no_contact || result.failed)
    return [
      ...(result.failed ?? []).map((p) => ({
        name: p.name,
        noContact: false,
        reason: p.reason,
      })),
      ...(result.no_contact ?? []).map((p) => ({
        name: p.name,
        noContact: true,
        reason: p.why.toLowerCase(),
      })),
    ];
  return (result.not_reached ?? []).map((p) => ({
    name: p.name,
    noContact: NO_CONTACT_REASONS.has(p.reason.toLowerCase()),
    reason: p.reason,
  }));
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** 按原因分组：[["no email or login", ["Jing", "Anita"]], ["email could not be sent", ["Nadia"]]]。 */
function groupByReason(list: Missed[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const p of list)
    groups.set(p.reason, [...(groups.get(p.reason) ?? []), p.name]);
  return [...groups.entries()];
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function publishNotice(result: SchedulePublishResult): PublishNotice {
  const n = result.notified.length;
  const m = result.notified_supervisors?.length ?? 0;
  const missed = missedPeople(result);
  const again = !!result.republished;
  const quiet = { unreached: null, noContact: null, allFailed: false };

  // 整周一点没变（后端 82 nothing_changed；Annie 2026-10-30「那你要提醒发送人这个班一点都没有变啊，不能静默处理」）
  if (result.nothing_changed)
    return {
      ok: "Nothing has changed since the last publish, so no one was notified.",
      ...quiet,
    };

  if (again && n === 0 && m === 0 && missed.length === 0)
    return {
      ok: "Published again. No one's shifts or time off changed, so no one was notified.",
      ...quiet,
    };

  if (n === 0 && m === 0 && missed.length) {
    const parts = groupByReason(missed).map(([reason, names]) =>
      NO_CONTACT_REASONS.has(reason)
        ? `${names.join(", ")} ${names.length === 1 ? "has" : "have"} ${reason}`
        : `${names.join(", ")}: ${reason}`,
    );
    const addEmail = missed.some((p) => p.noContact)
      ? " Add their email in Employees."
      : "";
    return {
      ok: "",
      unreached: `${again ? "Published again" : "Published"}, but no one was notified: ${parts.join("; ")}.${addEmail}`,
      noContact: null,
      allFailed: true,
    };
  }

  const ok = again
    ? n === 0
      ? `Published again. Notified ${plural(m, "schedule editor", "schedule editors")}.`
      : `Published again. Notified ${plural(n, "staff member", "staff")}${m ? ` and ${plural(m, "schedule editor", "schedule editors")}` : ""}.`
    : `Published. Notified ${plural(n, "person", "people")}.`;
  const failed = missed.filter((p) => !p.noContact);
  const noContact = missed.filter((p) => p.noContact);
  return {
    ok,
    unreached: failed.length
      ? `${failed.length} couldn't be reached: ${groupByReason(failed)
          .map(([reason, names]) => `${names.join(", ")} (${reason})`)
          .join("; ")}.`
      : null,
    noContact: noContact.length
      ? `${groupByReason(noContact)
          .map(
            ([reason, names]) => `${capitalize(reason)}: ${names.join(", ")}`,
          )
          .join("; ")}.`
      : null,
    allFailed: false,
  };
}
