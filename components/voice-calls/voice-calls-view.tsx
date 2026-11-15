"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { HowToUse } from "@/components/ui/how-to-use";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { PhoneOneLine, usePhoneInfo } from "@/components/ui/phone";
import {
  BTN_RESET,
  FILTER_BAR,
  LegacySearch,
  LegacySelect,
  RECORDS_COUNT,
  TABLE_CARD,
} from "@/components/send-log/legacy";
import { describeError, isStatus } from "@/lib/api-errors";
import { laToday, shiftYmd } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import {
  fetchVoiceCalls,
  phoneDigits,
  searchVoiceCalls,
  VOICE_CALL_LIMIT,
  VOICE_PHONE_MIN_DIGITS,
} from "@/lib/voice-calls-api";
import type {
  VoiceCall,
  VoiceCallEndpoint,
  VoiceCallLog,
} from "@/types/voice-calls";

/**
 * 145 Phone AI Calls（后端 G178 ③；Annie 2026-11-15「推荐的结果完全符合后端的要求就可以了，直接动手」⇒ Q1–Q11 全按推荐 A；
 * preview https://claude.ai/artifact/SWJNSeTaSt9EPro9VtnAKy v4，25 核过 PASS）。只 superadmin（侧栏 Settings 组最后）。
 *
 * ⚠️ 号码（Q11 A：输到 3 位就搜全部 30 天）只走 POST search 的 body：不进网址、不存进浏览器，刷新后号码框是空的。
 */

/** 记录从哪天开始有（f4：要等表里出现第一行才能定，到了改这里）。 */
const RECORDING_FROM = "Nov 14, 2026";

/** 只留 30 天（后端自动删）。 */
const KEEP_DAYS = 30;

/** Q5 A：Request 写看得懂的英文，筛选下拉同名。 */
const REQUEST_LABEL: Record<VoiceCallEndpoint, string> = {
  lookup: "Look up by phone",
  "lookup-by-order": "Look up by order #",
  message: "Message",
  complaint: "Complaint",
};
const REQUEST_OPTIONS = Object.entries(REQUEST_LABEL) as [
  VoiceCallEndpoint,
  string,
][];

/** 带格线的表格（Annie：表格要有格线）。 */
const TH =
  "border-[0.5px] border-black/[.08] bg-[#ebe9e1] px-2.5 py-2 text-left text-[11px] font-semibold whitespace-nowrap text-[#444] night:border-white/10 night:bg-white/[.06] night:text-white/55";
const TD =
  "border-[0.5px] border-black/[.08] px-2.5 py-[7px] align-top whitespace-nowrap night:border-white/10";
const DIM = "text-[#6b6b6b] night:text-white/40";
const BAD = "font-semibold text-[#A32D2D] night:text-red-300";

const DATE_INPUT =
  "rounded-[7px] border-[0.5px] border-black/20 bg-paper px-2.5 py-1 font-[inherit] text-[13px] text-[#1a1a1a] focus:border-[#1a1a1a] focus:outline-none night:border-white/10 night:bg-white/[.04] night:text-white/90";

type LoadState =
  | { kind: "idle" }
  | { kind: "loading"; previous: VoiceCallLog | null }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: VoiceCallLog };

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-11-17" → "Nov 17"（按日历日读）。 */
function shortDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : ymd;
}

/** "2026-11-14" → "Sat, Nov 14"。 */
function dayLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  return new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  ).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** called_at_la "2026-11-14 03:11:00 PM" → "3:11:00 PM"；withDay ⇒ "Nov 14, 3:11:00 PM"。 */
export function callTime(la: string, withDay: boolean): string {
  const m =
    /^(\d{4}-\d{2}-\d{2})\s+0?(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)$/i.exec(
      la.trim(),
    );
  if (!m) return la;
  return withDay ? `${shortDay(m[1])}, ${m[2]}` : m[2];
}

/** Q10 A：不到 1 秒灰字毫秒；1 秒以上红字秒；旧行没有 ⇒ —。 */
function Took({ ms }: { ms: number | null | undefined }) {
  if (ms === null || ms === undefined) return <span className={DIM}>—</span>;
  if (ms < 1000) return <span className={DIM}>{ms} ms</span>;
  return (
    <span className={BAD}>{(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s</span>
  );
}

function CallRow({ call, withDay }: { call: VoiceCall; withDay: boolean }) {
  const ok = call.status_code >= 200 && call.status_code < 300;
  // 400 / 422：请求读不出来，根本没查 ⇒ Found 写 —。
  const notLooked = call.status_code === 400 || call.status_code === 422;
  const details = [
    call.request_order ? `Asked for ${call.request_order}` : "",
    call.action ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <tr data-call-id={call.id}>
      <td className={cn(TD, "tabular-nums")}>
        {callTime(call.called_at_la, withDay)}
      </td>
      <td className={TD}>
        {REQUEST_LABEL[call.endpoint as VoiceCallEndpoint] ?? call.endpoint}
      </td>
      <td className={cn(TD, "font-mono text-[12px]")} data-phone-cell>
        {call.phone ? (
          call.phone
        ) : call.phone_last4 ? (
          <span className={DIM} title="Saved before full numbers were kept">
            •••• {call.phone_last4}
          </span>
        ) : (
          <span className={DIM}>—</span>
        )}
      </td>
      <td className={cn(TD, "text-right tabular-nums")} data-status-cell>
        {ok ? (
          call.status_code
        ) : (
          <span className={BAD}>{call.status_code}</span>
        )}
      </td>
      <td className={cn(TD, "text-right tabular-nums")} data-took-cell>
        <Took ms={call.duration_ms} />
      </td>
      <td className={cn(TD, "text-right tabular-nums")} data-found-cell>
        {notLooked || call.found_count === null ? (
          <span className={DIM}>—</span>
        ) : call.found_count === 0 ? (
          <span className={DIM}>0</span>
        ) : (
          call.found_count
        )}
      </td>
      <td className={TD} data-orders-cell>
        {call.results.length ? (
          call.results.map((r, i) => (
            <div key={`${r.order_number}-${i}`}>
              <a
                href={`/orders/${encodeURIComponent(r.order_number)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[12px] font-medium text-[#185FA5] hover:underline night:text-sky-300"
              >
                {r.order_number}
              </a>{" "}
              <span className={DIM}>
                · {shortDay(r.tour_date)} ·{" "}
                {r.pickup_time || r.pickup_location
                  ? [r.pickup_time, r.pickup_location]
                      .filter(Boolean)
                      .join(" · ")
                  : "—"}
              </span>
            </div>
          ))
        ) : (
          <span className={DIM}>—</span>
        )}
      </td>
      <td
        className={cn(
          TD,
          "min-w-[160px] whitespace-normal text-[#444] night:text-white/65",
        )}
      >
        {details}
      </td>
    </tr>
  );
}

export function VoiceCallsView() {
  const [today, setToday] = useState("");
  const [date, setDate] = useState("");
  const [endpoint, setEndpoint] = useState<VoiceCallEndpoint | "">("");
  // 号码只在这个 state 里，不写进网址 / localStorage。
  const [phoneDraft, setPhoneDraft] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);
  const info = usePhoneInfo("About this page");

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  // 洛杉矶的今天在浏览器里算。
  useEffect(() => {
    const t = laToday();
    setToday(t);
    setDate(t);
  }, []);

  // 号码边打边查：停 400ms 才发请求。
  useEffect(() => {
    const t = setTimeout(() => setPhone(phoneDigits(phoneDraft)), 400);
    return () => clearTimeout(t);
  }, [phoneDraft]);

  const byPhone = phone.length >= VOICE_PHONE_MIN_DIGITS;
  const oldest = today ? shiftYmd(today, -KEEP_DAYS) : "";
  const tooOld = !byPhone && !!date && !!oldest && date < oldest;

  useEffect(() => {
    if (!date || tooOld) {
      setState({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({
      kind: "loading",
      previous:
        prev.kind === "ready"
          ? prev.data
          : prev.kind === "loading"
            ? prev.previous
            : null,
    }));
    (byPhone
      ? searchVoiceCalls({ phone, endpoint }, controller.signal)
      : fetchVoiceCalls({ date, endpoint }, controller.signal)
    )
      .then((data) => setState({ kind: "ready", data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setState({ kind: "forbidden" });
        else setState({ kind: "error", message: describeError(error) });
      });
    return () => controller.abort();
  }, [date, endpoint, phone, byPhone, tooOld, reloadKey, redirectToLogin]);

  const data =
    state.kind === "ready"
      ? state.data
      : state.kind === "loading"
        ? state.previous
        : null;
  const draftDigits = phoneDigits(phoneDraft).length;

  function clear() {
    setPhoneDraft("");
    setPhone("");
    setEndpoint("");
    setDate(today);
  }

  if (state.kind === "forbidden") {
    return (
      <main className="text-stone-800 night:text-white/90">
        <Panel>
          <p className="font-medium text-stone-800 night:text-white/90">
            Only a Super Admin can see phone AI calls.
          </p>
        </Panel>
      </main>
    );
  }

  const emptyText = tooOld
    ? `Calls older than ${KEEP_DAYS} days are deleted. Pick a date within the last ${KEEP_DAYS} days.`
    : state.kind === "loading"
      ? "Loading…"
      : state.kind === "error"
        ? "Failed to load."
        : byPhone
          ? `No calls in the last ${KEEP_DAYS} days from a number that contains ${phone}.`
          : `No calls on ${dayLabel(date)} match these filters.`;

  return (
    <main className="text-stone-800 night:text-white/90">
      <h2 className="sr-only">Phone AI Calls</h2>
      <p className="mb-3 text-[12.5px] text-white/55 night:text-white/55">
        {info.button}
        <span className={cn(info.hide, "max-sm:mt-1 max-sm:block")}>
          Every time the phone AI looked something up or left a note in our
          system. Kept for {KEEP_DAYS} days.
        </span>
      </p>

      <div className={cn(FILTER_BAR, "mb-3")} data-voice-filters>
        <label className="inline-flex items-center">
          <span className="mr-1 text-[12px] text-[#1a1a1a] night:text-white/55">
            Date
          </span>
          {byPhone ? (
            <span
              data-any-day
              className="rounded-[7px] border-[0.5px] border-dashed border-black/20 bg-[#ecebe5] px-2.5 py-1 text-[13px] text-[#6b6b6b] night:border-white/15 night:bg-white/[.03] night:text-white/40"
            >
              Any day (last {KEEP_DAYS} days)
            </span>
          ) : (
            <input
              type="date"
              aria-label="Date"
              value={date}
              min={oldest || undefined}
              max={today || undefined}
              onChange={(e) => setDate(e.target.value || today)}
              className={DATE_INPUT}
            />
          )}
        </label>
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          <label
            htmlFor="voice-phone"
            className="text-[12px] text-[#1a1a1a] night:text-white/55"
          >
            Phone
          </label>
          <LegacySearch
            id="voice-phone"
            label="Phone number (at least 3 digits, any day in the last 30 days)"
            placeholder="At least 3 digits"
            value={phoneDraft}
            onChange={setPhoneDraft}
            className="w-[170px]"
          />
          {draftDigits > 0 && draftDigits < VOICE_PHONE_MIN_DIGITS ? (
            <span data-phone-hint className={cn("text-[11.5px]", DIM)}>
              Type at least {VOICE_PHONE_MIN_DIGITS} digits.
            </span>
          ) : null}
        </span>
        <LegacySelect
          label="Request"
          value={endpoint}
          onChange={(v) => setEndpoint(v as VoiceCallEndpoint | "")}
        >
          <option value="">All</option>
          {REQUEST_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </LegacySelect>
        <button type="button" onClick={clear} className={BTN_RESET}>
          Clear
        </button>
        <span className={cn(RECORDS_COUNT, "max-sm:ml-0 max-sm:w-full")}>
          {data && !tooOld
            ? `${data.count} call${data.count === 1 ? "" : "s"}`
            : "— calls"}
        </span>
      </div>

      <p className="mb-3 rounded-[10px] border-[0.5px] border-[#f0d58c] bg-[#FEF3C7] px-4 py-2 text-[12px] text-[#7c4a00] night:bg-amber-400/10 night:text-amber-200">
        <PhoneOneLine>
          Calls are kept for {KEEP_DAYS} days. Older calls are deleted
          automatically.
        </PhoneOneLine>
      </p>

      {data && data.count >= VOICE_CALL_LIMIT && !tooOld ? (
        <p
          data-limit-note
          className="mb-3 text-[12px] text-white/65 night:text-white/65"
        >
          Showing the latest {VOICE_CALL_LIMIT.toLocaleString("en-US")} calls.
          Type a phone number to narrow it down.
        </p>
      ) : null}

      {state.kind === "error" ? (
        <div className="mb-3">
          <ErrorBanner
            actionLabel="Retry"
            onAction={() => setReloadKey((k) => k + 1)}
          >
            Could not load phone AI calls: {state.message}
          </ErrorBanner>
        </div>
      ) : null}

      <section className={TABLE_CARD}>
        <div className="overflow-x-auto">
          <table
            className={cn(
              "w-full border-collapse text-[12.5px] text-[#1a1a1a] night:text-white/75",
              state.kind === "loading" && data && "opacity-60",
            )}
          >
            <thead>
              <tr>
                <th className={TH}>Time (LA)</th>
                <th className={TH}>Request</th>
                <th className={TH}>Phone</th>
                <th className={TH}>Status</th>
                <th className={TH}>Took</th>
                <th className={TH}>Found</th>
                <th className={TH}>Orders · tour date · pickup</th>
                <th className={TH}>Details</th>
              </tr>
            </thead>
            <tbody>
              {!data || tooOld || data.calls.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    data-empty
                    className="p-6 text-center text-[13px] text-[#6b6b6b] night:text-white/40"
                  >
                    {emptyText}
                  </td>
                </tr>
              ) : (
                data.calls.map((c) => (
                  <CallRow key={c.id} call={c} withDay={byPhone} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <HowToUse
        title="How to use — Phone AI Calls"
        items={[
          "Pick the date of the call (Los Angeles time). Today is shown first.",
          `Type the guest's phone number, or any part of it (at least ${VOICE_PHONE_MIN_DIGITS} digits), to find their calls on any day in the last ${KEEP_DAYS} days. Spaces, dashes and + are ignored.`,
          "Calls from before full numbers were saved show only the last 4 digits (for example •••• 0971). The Phone filter does not find them; look them up by date.",
          "Each row is one time the phone AI asked our system something. Request shows what it asked, Found shows how many bookings we sent back.",
          "Orders shows the booking number, tour date, pickup time and pickup location we gave the AI. Click a booking number to open the order in a new tab.",
          `Calls after ${RECORDING_FROM} are recorded here. If a call is not listed, the phone AI most likely did not ask our system anything during that call. Calls before ${RECORDING_FROM} were not recorded.`,
          "If the AI told a guest something different from what is shown here, the AI did not repeat what our system gave it.",
          "Took shows how long our system took to answer. Answers that took 1 second or more are in red.",
          "A red Status means nothing was looked up: 400 or 422 = the phone platform sent a request we could not read; 503 = our system could not answer at that moment.",
          `Calls are kept for ${KEEP_DAYS} days.`,
        ]}
      />
    </main>
  );
}
