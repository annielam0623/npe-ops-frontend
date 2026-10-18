"use client";

import { cn } from "@/lib/utils";

import {
  HR_CARD_CLASS,
  HR_CARD_HEADER_CLASS,
  HR_CARD_TITLE_CLASS,
} from "./legacy-ui";

/**
 * 4 周排班参考样稿（Annie 2026-10-17：放在 Human Resource，主管排班时对着看）。
 * ⚠️ 固定的参考，不是系统排出来的：规则和自动排班引擎要后端做（PROGRESS 的「需要后端」）；
 * 引擎上线后这里改成显示系统按 Rules 实际排出来的未来 4 周。
 * 每个人 7 个字符，从周日到周六：O = Open、M = Mid、C = Close、- = 休息。
 */
const WEEKS: Record<string, string>[] = [
  {
    Veronica: "-OOOOO-",
    Lizzie: "OCM-MM-",
    Nadia: "C-CCCC-",
    Jing: "-CMMC-O",
    Anita: "-MCM-MC",
  },
  {
    Veronica: "-OOOOO-",
    Lizzie: "-CC-CMC",
    Nadia: "OMCM-C-",
    Jing: "CM-MMC-",
    Anita: "-CMCC-O",
  },
  {
    Veronica: "-OOOOO-",
    Lizzie: "-MCCM-O",
    Nadia: "-MCC-MC",
    Jing: "OC-MCC-",
    Anita: "CCM-CC-",
  },
  {
    Veronica: "-OOOOO-",
    Lizzie: "CCCC-M-",
    Nadia: "-MMCM-O",
    Jing: "--CMCCC",
    Anita: "OM-MCC-",
  },
];

const PEOPLE = ["Veronica", "Lizzie", "Nadia", "Jing", "Anita"] as const;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
/** 示例的第一个周日（2026-10-18）；只用来写日期，不跟今天走。 */
const FIRST_SUNDAY = Date.UTC(2026, 9, 18);

const SHIFT = {
  O: {
    label: "Open",
    time: "2:00 AM – 12:00 PM",
    cls: "border-emerald-600/40 bg-emerald-50 text-emerald-900 night:border-emerald-400/40 night:bg-emerald-400/[.12] night:text-emerald-300",
  },
  M: {
    label: "Mid",
    time: "11:30 AM – 5:00 PM",
    cls: "border-sky-600/40 bg-sky-50 text-sky-900 night:border-sky-400/40 night:bg-sky-400/[.12] night:text-sky-300",
  },
  C: {
    label: "Close",
    time: "11:30 AM – 9:30 PM",
    cls: "border-purple-600/40 bg-purple-50 text-purple-900 night:border-purple-400/50 night:bg-purple-400/[.16] night:text-purple-200",
  },
} as const;

function dateLabel(week: number, day: number): string {
  const d = new Date(FIRST_SUNDAY + (week * 7 + day) * 86_400_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function countOf(code: string, ch: string): number {
  return [...code].filter((c) => c === ch).length;
}

export function ScheduleExample() {
  const totals = PEOPLE.map((p) => {
    const all = WEEKS.map((w) => w[p]).join("");
    return {
      person: p,
      open: countOf(all, "O"),
      mid: countOf(all, "M"),
      close: countOf(all, "C"),
    };
  });
  return (
    <div data-schedule-example>
      <section className={HR_CARD_CLASS}>
        <div className={HR_CARD_HEADER_CLASS}>
          <h2 className={HR_CARD_TITLE_CLASS}>
            Schedule example — 4 weeks (reference)
          </h2>
          <span className="text-[11.5px] text-[#1a1a1a] night:text-white/55">
            A fixed example for supervisors to follow when scheduling. It is not
            the live schedule.
          </span>
        </div>
        <ul className="list-disc space-y-1 px-8 py-3 text-[12.5px] text-[#1a1a1a] night:text-white/90">
          <li>
            Veronica works Open Monday to Friday (5 days). Not on weekends.
          </li>
          <li>Everyone works exactly 5 days a week.</li>
          <li>
            Weekend rotation: the other four each take one weekend shift a week
            — over 4 weeks each person gets Sat Open, Sat Close, Sun Open and
            Sun Close once.
          </li>
          <li>At least 12 hours between the end of one shift and the next.</li>
          <li>
            Every day has at least one Open and one Close. Extra people work
            Mid.
          </li>
        </ul>
      </section>

      {WEEKS.map((week, wi) => (
        <section key={wi} className={HR_CARD_CLASS}>
          <div className={HR_CARD_HEADER_CLASS}>
            <h2 className={HR_CARD_TITLE_CLASS}>
              Week {wi + 1} · {dateLabel(wi, 0)} – {dateLabel(wi, 6)}
            </h2>
          </div>
          <div className="overflow-x-auto p-3">
            <div className="grid min-w-[900px] grid-cols-[110px_repeat(7,minmax(104px,1fr))] gap-[2px]">
              <div className="px-2 pb-1.5 text-[11px] font-bold tracking-[.06em] text-[#1a1a1a] uppercase night:text-white/90">
                Staff
              </div>
              {DAYS.map((d, di) => (
                <div
                  key={d}
                  className="pb-1.5 text-center text-[#1a1a1a] night:text-white/90"
                >
                  <div className="text-[11px] font-bold tracking-[.06em] uppercase">
                    {d}
                  </div>
                  <div className="font-mono text-[10px]">
                    {dateLabel(wi, di)}
                  </div>
                </div>
              ))}
              {PEOPLE.map((p) => (
                <ExampleRow key={p} person={p} code={week[p]} />
              ))}
            </div>
          </div>
        </section>
      ))}

      <section className={HR_CARD_CLASS}>
        <div className={HR_CARD_HEADER_CLASS}>
          <h2 className={HR_CARD_TITLE_CLASS}>Over the 4 weeks</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[12.5px] text-[#1a1a1a] night:text-white/90">
            <thead>
              <tr className="text-left text-[11px] tracking-[.04em] uppercase">
                <th className="px-4 py-2">Who</th>
                <th className="px-4 py-2">Open</th>
                <th className="px-4 py-2">Mid</th>
                <th className="px-4 py-2">Close</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((t) => (
                <tr
                  key={t.person}
                  className="border-t-[0.5px] border-black/[.08] night:border-white/10"
                >
                  <td className="px-4 py-2 font-semibold">{t.person}</td>
                  <td className="px-4 py-2">{t.open}</td>
                  <td className="px-4 py-2">{t.mid}</td>
                  <td className="px-4 py-2">{t.close}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ExampleRow({ person, code }: { person: string; code: string }) {
  return (
    <>
      <div className="flex items-center px-2 py-1.5 text-[13px] font-bold text-[#1a1a1a] night:text-white">
        {person}
      </div>
      {[...code].map((ch, i) => {
        const shift = ch === "-" ? null : SHIFT[ch as keyof typeof SHIFT];
        return (
          <div key={i} className="flex min-h-[46px] flex-col">
            {shift ? (
              <div
                className={cn(
                  "flex flex-1 flex-col justify-center rounded-[6px] border px-2 py-1 leading-tight",
                  shift.cls,
                )}
              >
                <b className="text-[12.5px]">{shift.label}</b>
                <span className="font-mono text-[10.5px] font-semibold whitespace-nowrap">
                  {shift.time}
                </span>
              </div>
            ) : (
              <div className="flex flex-1 items-center rounded-[6px] border border-yellow-600/40 bg-yellow-100 px-2 py-1 text-[12.5px] leading-tight font-bold text-yellow-900 night:border-[rgba(250,204,21,.5)] night:bg-[rgba(253,224,71,.14)] night:text-[#fde68a]">
                Off
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
