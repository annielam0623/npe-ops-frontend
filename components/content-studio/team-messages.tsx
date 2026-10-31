"use client";

import { type ReactNode, useRef, useState } from "react";

import { gsmLength, nonGsmChars } from "@/lib/sms-gsm";
import { cn } from "@/lib/utils";

import {
  CardFooter,
  CardShell,
  editedLine,
  InsertBar,
  type SaveState,
  type Studio,
} from "./studio-cards";

/**
 * Content Studio「Team Messages」（G228，Annie 2026-10-30「23 全按推荐 动手」「2 content studio那个同意你的推荐。动手」，
 * 置顶 24「要」；preview https://claude.ai/artifact/MoGjKubqRq3bZks9zvTNSC ）。
 * 发给我们自己人和合作方的三类文字：司机 / 导游短信、改餐发餐厅、排班邮件。一张卡、三个标签页，每个键一张小卡、一个 Save。
 * 后端 4e 的设计（PROGRESS「G228 … 后端设计」）：读写沿用 /api/template-settings，23 个 tmpl__global__ 键；
 * 存的时候后端再查一次（必填、变量、GSM-7、{link} 一次、160 字），400 的 detail 原样标红。
 * 页面上的检查只是提前提示，最后以后端为准。
 */

export const TEAM_TABS = [
  "Driver & Guide SMS",
  "Restaurant",
  "Schedule Email",
] as const;
export type TeamTab = (typeof TEAM_TABS)[number];

const PREFIX = "tmpl__global__";
const SMS_LIMIT = 160;

interface TeamField {
  /** 去掉 tmpl__global__ 的部分。 */
  id: string;
  label: string;
  /** 必填：清空不让存（后端「<Label> can't be blank.」）。 */
  required?: boolean;
  /** 能插的变量（Insert 按钮）。 */
  insert: string[];
  /** 后端允许的变量（不在里面的红字）。 */
  allowed: string[];
  /** 司机 / 导游短信：GSM-7、{link} 正好一个、按真实链接量 ≤160。 */
  sms?: "driver" | "guide";
  /** 餐厅那几行也走短信：只提示 GSM-7。 */
  plain?: boolean;
  hint?: string;
}

const SCHED_SUBJECT = ["{week}"];
const SCHED_TEXT = ["{name}", "{week}"];

const SMS_FIELDS: TeamField[] = [
  {
    id: "field_driver_sms",
    label: "Driver text",
    required: true,
    insert: ["{date}", "{link}"],
    allowed: ["{date}", "{link}"],
    sms: "driver",
    hint: '{date} looks like "Sat, Oct 31". {link} is each driver\'s own link (about 95 characters, works for 12 hours) and must appear exactly once.',
  },
  {
    id: "field_guide_sms",
    label: "Guide text",
    required: true,
    insert: ["{date}", "{link}"],
    allowed: ["{date}", "{link}"],
    sms: "guide",
    hint: '{date} looks like "Sat Oct 31". {link} must appear exactly once. The note staff add on the Send page goes after this text, so a longer text leaves less room for the note.',
  },
];

const REST_FIELDS: TeamField[] = [
  {
    id: "rest_title",
    label: "First line",
    required: true,
    insert: ["{date}"],
    allowed: ["{date}"],
    plain: true,
  },
  {
    id: "rest_total_label",
    label: "Word before the total",
    insert: [],
    allowed: [],
    plain: true,
    hint: 'Shown as "Roast Beef 8 / Turkey 6 / Veggie 2 - total 16". Leave empty to show only the number.',
  },
  {
    id: "rest_changed_label",
    label: "Changes line label",
    insert: [],
    allowed: [],
    plain: true,
    hint: "Only shown when the order changed today. Leave empty to drop the label.",
  },
  {
    id: "rest_questions",
    label: "Questions line",
    insert: ["{guide}", "{guide_phone}"],
    allowed: ["{guide}", "{guide_phone}"],
    plain: true,
    hint: "Only shown when the guide has a phone number. Leave empty to drop this line.",
  },
  {
    id: "rest_email_subject",
    label: "Email subject",
    required: true,
    insert: ["{tour}"],
    allowed: ["{tour}"],
    plain: true,
  },
];

const subject = (id: string, label: string): TeamField => ({
  id,
  label,
  required: true,
  insert: SCHED_SUBJECT,
  allowed: SCHED_SUBJECT,
});
const sentence = (
  id: string,
  label: string,
  insert = SCHED_TEXT.slice(1),
  extra: Partial<TeamField> = {},
): TeamField => ({ id, label, insert, allowed: SCHED_TEXT, ...extra });

interface SchedGroup {
  title: string;
  /** 右边预览画哪一封。 */
  email?: "week" | "changed" | "confirm" | "weekly";
  /** 灰字说明（Notice 标题不在这里改，Annie 第 3 题 A）。 */
  lock?: string;
  fields: TeamField[];
}

const SCHED_GROUPS: SchedGroup[] = [
  {
    title: "Shared by all schedule emails",
    fields: [sentence("sched_greeting", "Greeting", ["{name}"])],
  },
  {
    title: "First publish / full week",
    email: "week",
    fields: [
      subject("sched_week_subject", "Email subject"),
      sentence("sched_week_intro", "Intro"),
      sentence("sched_week_empty", "When they have no shifts", []),
      sentence("sched_week_link_text", "Link text", [], { required: true }),
    ],
  },
  {
    title: "Publish again (changes)",
    email: "changed",
    lock: 'The Dashboard Notice keeps its own title ("Your schedule changed — week of …"). Changing the email subject here does not change the Notice.',
    fields: [
      subject("sched_changed_subject", "Email subject — staff"),
      subject("sched_edited_subject", "Email subject — schedule editors"),
      sentence("sched_changed_intro", "Intro — staff"),
      sentence("sched_edited_intro", "Intro — schedule editors"),
      sentence("sched_changed_footer", "Footer", []),
    ],
  },
  {
    title: "Send to confirm (changes)",
    email: "confirm",
    fields: [
      subject("sched_confirm_changes_subject", "Email subject"),
      sentence("sched_confirm_changes_intro", "Intro"),
      sentence("sched_confirm_changes_ask", "Ask", []),
      sentence(
        "sched_confirm_link_text",
        "Link text (also used by the Wednesday email)",
        [],
        { required: true },
      ),
    ],
  },
  {
    title: "Wednesday: confirm the week",
    email: "weekly",
    fields: [
      subject("sched_weekly_confirm_subject", "Email subject"),
      sentence("sched_weekly_confirm_intro", "Intro"),
    ],
  },
];

/** 全部 23 个键（找标签、算未存改动用）。 */
export const TEAM_FIELDS: TeamField[] = [
  ...SMS_FIELDS,
  ...REST_FIELDS,
  ...SCHED_GROUPS.flatMap((g) => g.fields),
];
export const TEAM_KEYS = TEAM_FIELDS.map((f) => PREFIX + f.id);

// ── 示例值（预览、量短信长度用；{week} 照 Annie 第 2 题 A 写成「Sun, Nov 1」）──
const pad = (s: string, n: number) => s + "x".repeat(Math.max(0, n - s.length));
const SAMPLE: Record<string, string> = {
  "{date}": "Sat, Oct 31",
  "{link}": pad(
    "https://confirm.nationalparkexpress.com/driver?date=2026-10-31&t=",
    95,
  ),
  "{guide}": "Lankun W",
  "{guide_phone}": "702-555-0142",
  "{tour}": "Grand Canyon West Rim",
  "{name}": "Maria",
  "{week}": "Sun, Nov 1",
};
const GUIDE_SAMPLE: Record<string, string> = {
  ...SAMPLE,
  "{date}": "Sat Oct 31",
  "{link}": pad(
    "https://confirm.nationalparkexpress.com/guide?date=2026-10-31&t=",
    95,
  ),
};
const fill = (t: string, s: Record<string, string>) =>
  t.replace(/\{[a-z_]+\}/g, (v) => s[v] ?? v);

/** 一张卡现在的问题（英文，给 staff 看）；空数组 = 能存。 */
function problems(f: TeamField, value: string): string[] {
  const out: string[] = [];
  if (f.required && !value.trim()) out.push("Can't be empty.");
  const unknown = [
    ...new Set(
      (value.match(/\{[^}]*\}/g) ?? []).filter((v) => !f.allowed.includes(v)),
    ),
  ];
  if (unknown.length)
    out.push(
      `Not a variable we know: ${unknown.join(" ")}. ${f.allowed.length ? `You can use: ${f.allowed.join(", ")}.` : "This text has no variables."}`,
    );
  if (f.sms || f.plain) {
    const bad = nonGsmChars(value.replace(/\n/g, ""));
    if (bad.length)
      out.push(
        `SMS can't use these characters: ${bad.join(" ")}. Remove them before saving.`,
      );
  }
  if (f.sms) {
    const n = (value.match(/\{link\}/g) ?? []).length;
    if (n !== 1)
      out.push(
        n
          ? "{link} can only appear once."
          : "{link} is missing. Drivers and guides need it to open their page.",
      );
    const len = smsLen(f, value);
    if (len > SMS_LIMIT)
      out.push(
        `Too long for one text (${len} / ${SMS_LIMIT} with the link filled in). Shorten it before saving.`,
      );
  }
  return out;
}

const smsLen = (f: TeamField, value: string) =>
  gsmLength(fill(value.trim(), f.sms === "guide" ? GUIDE_SAMPLE : SAMPLE));

/** 一个键一张卡：文本框、Insert、短信字数、红字、Cancel / Save（Saving… / Saved ✓ / 红字后端原话）。 */
function TeamCard({ field, studio }: { field: TeamField; studio: Studio }) {
  const key = PREFIX + field.id;
  const value = studio.draft(key);
  const dirty = value !== studio.savedValue(key);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const issues = problems(field, value);
  const len = field.sms ? smsLen(field, value) : 0;

  function insert(v: string) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setError(null);
    studio.setDraft(key, value.slice(0, start) + v + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + v.length, start + v.length);
    });
  }

  async function save() {
    // 页面查出来的问题已经红字写在框下面了：不发请求。
    if (issues.length) return;
    setError(null);
    setState("saving");
    const result = await studio.save([key]);
    // 后端 400 的 detail 原样标红（describeError 给的就是后端原话）。
    if (result.failed.length) {
      setState("error");
      setError(result.failed[0].message);
    } else setState("saved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setState("idle"),
      result.failed.length ? 2500 : 2000,
    );
  }

  return (
    <div data-team-card={field.id}>
      <CardShell
        label={field.label}
        keyName={key}
        hint={field.hint}
        varWarn={field.insert.length > 0}
      >
        <textarea
          ref={ref}
          aria-label={field.label}
          value={value}
          rows={field.sms ? 2 : 1}
          onFocus={() => studio.setActive(key)}
          onChange={(e) => {
            // 改了字，上次后端的红字就不算了。
            setError(null);
            // 短信不能换行（同别的短信卡）。
            studio.setDraft(
              key,
              field.sms || field.plain
                ? e.target.value.replace(/\r?\n/g, " ")
                : e.target.value,
            );
          }}
          className="box-border min-h-[44px] w-full resize-y rounded-[7px] border border-[#e5e7eb] bg-paper px-2.5 py-2 text-[12px] leading-[1.6] text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-none night:border-white/10 night:bg-white/[.03] night:text-white/90 night:focus:border-white/40"
        />
        {field.insert.length ? (
          <InsertBar vars={field.insert} onInsert={insert} />
        ) : null}
        {field.sms ? (
          <div className="mt-1.5" data-team-sms-meter>
            <div className="h-[5px] overflow-hidden rounded-[3px] bg-[#eceae2] night:bg-white/10">
              <div
                className={cn(
                  "h-full",
                  len > SMS_LIMIT
                    ? "bg-[#c0392b]"
                    : len >= 140
                      ? "bg-[#d99a1c]"
                      : "bg-[#1a7f4b]",
                )}
                style={{ width: `${Math.min(100, (len / SMS_LIMIT) * 100)}%` }}
              />
            </div>
            <p
              data-team-sms-len
              className={cn(
                "mt-0.5 text-[10px] tabular-nums",
                len > SMS_LIMIT
                  ? "font-semibold text-[#c0392b] night:text-red-300"
                  : "text-[#1a1a1a] night:text-white/50",
              )}
            >
              ≈ {len} / {SMS_LIMIT} chars (with the date and the real link
              filled in)
            </p>
            {field.sms === "guide" ? (
              <GuideNoteLeft left={Math.max(0, SMS_LIMIT - len - 1)} />
            ) : null}
          </div>
        ) : null}
        {issues.length && !error ? (
          <p
            data-team-issues
            className="mt-1.5 text-[11px] font-semibold text-[#dc2626] night:text-red-300"
          >
            {issues.join(" ")}
          </p>
        ) : null}
        <CardFooter
          dirty={dirty}
          state={state}
          meta={editedLine(studio.saved[key])}
          extraError={error}
          onCancel={() => {
            studio.setDraft(key, studio.savedValue(key));
            setError(null);
          }}
          onSave={() => void save()}
        />
      </CardShell>
    </div>
  );
}

function GuideNoteLeft({ left }: { left: number }) {
  return (
    <p
      data-team-note-left
      className={cn(
        "mt-0.5 text-[11px] font-semibold",
        left === 0
          ? "text-[#c0392b] night:text-red-300"
          : left < 25
            ? "text-[#b36b00] night:text-amber-300"
            : "text-[#1a1a1a] night:text-white/75",
      )}
    >
      Characters left for the staff note: {left}
    </p>
  );
}

const TAB_HINT: Record<TeamTab, string> = {
  "Driver & Guide SMS":
    "Sent from Dispatch › Send. Each text must fit in one SMS (160 characters), counted with the real link filled in. SMS can only use plain characters (no emoji, no curly quotes).",
  Restaurant:
    "Sent to the restaurant after a guide changes the lunch order. The same text goes out as an SMS and as the email body. Sandwich names, counts and line order come from the system and are not edited here.",
  "Schedule Email":
    "Emails sent from Schedule. The list of shifts and the link address come from the system. Here you edit the subject and the sentences around them.",
};

/** 左边：这个标签页的卡片。 */
export function TeamMessagesPanel({
  tab,
  studio,
}: {
  tab: TeamTab;
  studio: Studio;
}) {
  return (
    <div data-team-panel={tab}>
      <p className="mb-3 text-[12px] text-[#cbd5e1] night:text-white/65">
        {TAB_HINT[tab]}
      </p>
      {tab === "Driver & Guide SMS"
        ? SMS_FIELDS.map((f) => (
            <TeamCard key={f.id} field={f} studio={studio} />
          ))
        : tab === "Restaurant"
          ? REST_FIELDS.map((f) => (
              <TeamCard key={f.id} field={f} studio={studio} />
            ))
          : SCHED_GROUPS.map((g) => (
              <section key={g.title} data-team-group={g.title}>
                <h3 className="mt-[18px] mb-2 text-[10px] font-bold tracking-[.07em] text-[#9B8F88] uppercase">
                  {g.title}
                </h3>
                {g.lock ? (
                  <p className="mb-3 text-[11px] text-[#fbbf24]">🔒 {g.lock}</p>
                ) : null}
                {g.fields.map((f) => (
                  <TeamCard key={f.id} field={f} studio={studio} />
                ))}
              </section>
            ))}
    </div>
  );
}

// ── 右边：发出去的样子（示例数据；用草稿，没存的改动也看得到）──

const LABEL =
  "mb-2 text-[10px] font-bold tracking-[.07em] text-[#93c5fd] uppercase";
const BOX =
  "mb-[18px] rounded-[10px] border border-white/[.12] bg-[#0b1a2b] px-3.5 py-3";
const MAIL = "rounded-[8px] bg-white px-4 py-3 text-[13px] text-[#111]";
const FIXED =
  "my-1.5 rounded-[6px] border border-dashed border-[#cbd5e1] bg-[#f3f4f6] px-2.5 py-1.5 text-[12px] text-[#6b7280]";

function Line({ text }: { text: string }) {
  return text ? <p className="my-1.5">{text}</p> : null;
}

function ShiftList() {
  return (
    <div className={FIXED}>
      • Mon 11/2 — Office 8:00 AM – 4:00 PM
      <br />• Wed 11/4 — Dispatch 6:00 AM – 2:00 PM
      <br />
      <i>(list of shifts — made by the system, not edited here)</i>
    </div>
  );
}

export function TeamMessagesPreview({
  tab,
  studio,
}: {
  tab: TeamTab;
  studio: Studio;
}) {
  const v = (id: string) => fill(studio.draft(PREFIX + id).trim(), SAMPLE);
  const link = (text: string) => (
    <p className="my-1.5">
      <span className="text-[#2563eb] underline">{text}</span>
    </p>
  );
  let body: ReactNode;
  if (tab === "Driver & Guide SMS") {
    body = (
      <>
        <div className={BOX} data-team-preview="driver">
          <div className={LABEL}>What the driver gets (sample)</div>
          <div className="max-w-[420px] rounded-[16px] bg-[#e5e5ea] px-3 py-2.5 text-[13px] break-all whitespace-pre-wrap text-[#111]">
            {v("field_driver_sms")}
          </div>
        </div>
        <div className={BOX} data-team-preview="guide">
          <div className={LABEL}>
            What the guide gets (sample, with a staff note)
          </div>
          <div className="max-w-[420px] rounded-[16px] bg-[#e5e5ea] px-3 py-2.5 text-[13px] break-all whitespace-pre-wrap text-[#111]">
            {fill(
              studio.draft(PREFIX + "field_guide_sms").trim(),
              GUIDE_SAMPLE,
            )}{" "}
            <span className="rounded-[3px] bg-[#fde68a]">
              Meet at the TI lobby 6:30.
            </span>
          </div>
        </div>
      </>
    );
  } else if (tab === "Restaurant") {
    const lines = [
      v("rest_title"),
      "Grand Canyon West Rim - Bus A (2415) - Guide Lankun W",
      `Roast Beef 8 / Turkey 6 / Veggie 2 - ${[v("rest_total_label"), "16"].filter(Boolean).join(" ")}`,
      [v("rest_changed_label"), "Turkey 5 to 6"].filter(Boolean).join(" "),
      v("rest_questions"),
    ].filter(Boolean);
    const text = lines.join("\n");
    const n = gsmLength(text);
    body = (
      <div className={BOX} data-team-preview="restaurant">
        <div className={LABEL}>What the restaurant gets (sample)</div>
        <div className={MAIL}>
          <div className="mb-2.5 border-b border-[#e5e7eb] pb-1.5 font-bold">
            Subject: {v("rest_email_subject")}
          </div>
          <pre className="m-0 font-mono text-[13px] leading-[1.5] whitespace-pre-wrap">
            {text}
          </pre>
        </div>
        <p className="mt-1.5 text-[10px] text-[#cbd5e1]">
          As a text: {n} characters
          {n > SMS_LIMIT
            ? ` — sends as ${Math.ceil(n / 153)} texts (same as today).`
            : "."}
        </p>
      </div>
    );
  } else {
    const greet = v("sched_greeting");
    body = (
      <>
        <div className={BOX} data-team-preview="week">
          <div className={LABEL}>First publish (sample)</div>
          <div className={MAIL}>
            <div className="mb-2.5 border-b border-[#e5e7eb] pb-1.5 font-bold">
              Subject: {v("sched_week_subject")}
            </div>
            <Line text={greet} />
            <Line text={v("sched_week_intro")} />
            <ShiftList />
            {link(v("sched_week_link_text"))}
            <div className={FIXED}>
              <i>If they have no shifts, the list is replaced by:</i>{" "}
              {v("sched_week_empty")}
            </div>
          </div>
        </div>
        <div className={BOX} data-team-preview="changed">
          <div className={LABEL}>Publish again (sample)</div>
          <div className={MAIL}>
            <div className="mb-2.5 border-b border-[#e5e7eb] pb-1.5 font-bold">
              Subject: {v("sched_changed_subject")}{" "}
              <span className="font-normal text-[#6b7280]">(staff)</span>
              <br />
              Subject: {v("sched_edited_subject")}{" "}
              <span className="font-normal text-[#6b7280]">
                (schedule editors)
              </span>
            </div>
            <Line text={greet} />
            <Line text={v("sched_changed_intro")} />
            <ShiftList />
            <Line text={v("sched_changed_footer")} />
          </div>
        </div>
        <div className={BOX} data-team-preview="confirm">
          <div className={LABEL}>Send to confirm (sample)</div>
          <div className={MAIL}>
            <div className="mb-2.5 border-b border-[#e5e7eb] pb-1.5 font-bold">
              Subject: {v("sched_confirm_changes_subject")}
            </div>
            <Line text={greet} />
            <Line text={v("sched_confirm_changes_intro")} />
            <ShiftList />
            <Line text={v("sched_confirm_changes_ask")} />
            {link(v("sched_confirm_link_text"))}
          </div>
        </div>
        <div className={BOX} data-team-preview="weekly">
          <div className={LABEL}>Wednesday confirm (sample)</div>
          <div className={MAIL}>
            <div className="mb-2.5 border-b border-[#e5e7eb] pb-1.5 font-bold">
              Subject: {v("sched_weekly_confirm_subject")}
            </div>
            <Line text={greet} />
            <Line text={v("sched_weekly_confirm_intro")} />
            <ShiftList />
            {link(v("sched_confirm_link_text"))}
          </div>
        </div>
      </>
    );
  }
  return (
    <div className="px-6 py-5" data-team-preview-pane>
      <h2 className="mb-3 text-[13px] font-semibold text-white">Preview</h2>
      {body}
    </div>
  );
}
