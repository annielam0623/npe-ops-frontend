"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorBanner } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchDispatchImports, pullFromDiscord } from "@/lib/dispatch-api";
import { isYmd, LA_TIME_ZONE } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type {
  DispatchImport,
  DispatchImportLine,
  DispatchImports,
} from "@/types";

type LoadState =
  | { kind: "loading"; previous: DispatchImports | null }
  | { kind: "forbidden" }
  | { kind: "error"; message: string; previous: DispatchImports | null }
  | { kind: "ready"; data: DispatchImports };

type PullNote = { ok: boolean; text: string } | null;

// 样子照旧后台 admin/dispatch_imports.html（Annie 2026-10-07：和旧版一模一样）。
/** .empty：白底圆角块。 */
const EMPTY = "rounded-xl bg-white p-6 text-center text-[12px] text-[#999]";
/** .ok / .fail：直接写在深色底上，旧色 #3B6D11 / #A32D2D 看不清，换成同色系的浅色。 */
const OK_ON_DARK = "text-[#86efac]";
const FAIL_ON_DARK = "text-[#f87171]";

const LA_STAMP = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

/** ISO → 洛杉矶 "10/04 02:13 PM"（同旧页面 `_la()`）。 */
function fmtStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(
    LA_STAMP.formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.month}/${p.day} ${p.hour}:${p.minute} ${String(p.dayPeriod).toUpperCase()}`;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-10-05" → "Mon 10/05"（不经过 new Date(str)，按 UTC 解析会差一天）。 */
function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow} ${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
}

function sinceFromUrl(): string | null {
  const v = new URLSearchParams(window.location.search).get("since");
  return isYmd(v) ? v : null;
}

export function DispatchImportsView() {
  /** null = 服务端默认（今天往前 7 天）。 */
  const [since, setSince] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<LoadState>({
    kind: "loading",
    previous: null,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [pullNote, setPullNote] = useState<PullNote>(null);
  /** Pull 回来的「上次成功」（服务端已按洛杉矶格式化好）；比列表里的新。 */
  const [lastOkText, setLastOkText] = useState<string | null>(null);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    setSince(sinceFromUrl());
  }, []);

  useEffect(() => {
    if (since === undefined) return;
    const controller = new AbortController();
    setState((s) => ({
      kind: "loading",
      previous:
        s.kind === "ready"
          ? s.data
          : s.kind === "loading" || s.kind === "error"
            ? s.previous
            : null,
    }));
    fetchDispatchImports(since, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ kind: "ready", data });
        setDraft(data.since);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setState({ kind: "forbidden" });
        else
          setState((s) => ({
            kind: "error",
            message:
              error instanceof TypeError
                ? "Could not reach the server. Check your connection and try again."
                : describeError(error),
            previous:
              s.kind === "loading" || s.kind === "error" ? s.previous : null,
          }));
      });
    return () => controller.abort();
  }, [since, reloadKey, redirectToLogin]);

  function show() {
    if (!isYmd(draft)) return;
    const url = new URL(window.location.href);
    url.searchParams.set("since", draft);
    window.history.replaceState(null, "", url);
    if (draft === since) setReloadKey((k) => k + 1);
    else setSince(draft);
  }

  async function pull() {
    setPulling(true);
    setPullNote(null);
    try {
      const res = await pullFromDiscord("manual");
      const ok = res.status !== "failed" && res.status !== "busy";
      setPullNote({ ok, text: res.message || "Pull failed." });
      if (res.last_ok) setLastOkText(res.last_ok);
      // 有新东西：重拉列表（旧页面是 2 秒后整页刷新，结果那句话就看不到了）。
      if (res.status === "new" || res.status === "revision")
        setReloadKey((k) => k + 1);
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return;
      }
      setPullNote({
        ok: false,
        text:
          error instanceof TypeError
            ? "Pull failed: could not reach the server. Check your connection and try again."
            : `Pull failed: ${describeError(error)}`,
      });
    } finally {
      setPulling(false);
    }
  }

  const data =
    state.kind === "ready"
      ? state.data
      : state.kind === "loading" || state.kind === "error"
        ? state.previous
        : null;
  const lastOk = lastOkText ?? (data ? fmtStamp(data.last_ok) : "");

  if (state.kind === "forbidden") {
    return (
      <Shell>
        <div className={EMPTY}>
          <p className="font-medium">Staff access required</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* .page-header */}
      <header className="mb-[18px] flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-[#f8fafc]">
          📥 Dispatch Imports
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {/* .pull-meta 旧色 #666 在深色底上看不清，用旧后台的灰 #94a3b8。 */}
          <span className="text-[12px] text-[#94a3b8]" data-testid="last-pull">
            {data || lastOkText
              ? lastOk
                ? `Last pull: ${lastOk}`
                : "Not pulled yet"
              : ""}
          </span>
          <button
            type="button"
            disabled={pulling}
            onClick={() => void pull()}
            className="cursor-pointer rounded-[7px] border-none bg-[#1a1a1a] px-[18px] py-2 text-[13px] font-semibold whitespace-nowrap text-white hover:bg-[#333] disabled:cursor-default disabled:bg-[#888]"
          >
            {pulling ? "Pulling..." : "Pull from Discord"}
          </button>
        </div>
      </header>

      {/* .pull-result */}
      <div className="mb-3.5 min-h-4 text-[12px]">
        {pullNote ? (
          <p role="status" className={pullNote.ok ? OK_ON_DARK : FAIL_ON_DARK}>
            {pullNote.text}
          </p>
        ) : data?.last_error ? (
          <p className={FAIL_ON_DARK}>
            Last attempt failed at {fmtStamp(data.last_failed)}:{" "}
            {data.last_error}
          </p>
        ) : null}
      </div>

      <HowToUse />

      {/* .filter：旧色 #666 在深色底上看不清，用 #94a3b8。 */}
      <form
        className="mb-3.5 flex items-center gap-2 text-[12px] text-[#94a3b8]"
        onSubmit={(e) => {
          e.preventDefault();
          show();
        }}
      >
        <label htmlFor="since">Show days from</label>
        <input
          id="since"
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="rounded-md border-[0.5px] border-black/25 bg-white px-2 py-1 text-[12px] text-[#1a1a1a]"
        />
        <button
          type="submit"
          disabled={!isYmd(draft)}
          className="cursor-pointer rounded-md border-[0.5px] border-black/25 bg-white px-3 py-1 text-[12px] text-[#1a1a1a] disabled:cursor-default disabled:opacity-60"
        >
          Show
        </button>
        {state.kind === "loading" && data ? <span>Loading…</span> : null}
      </form>

      {state.kind === "error" ? (
        <div className="mb-4">
          <ErrorBanner
            actionLabel="Retry"
            onAction={() => setReloadKey((k) => k + 1)}
          >
            Could not load the imports: {state.message}
          </ErrorBanner>
        </div>
      ) : null}

      {!data ? (
        state.kind === "loading" ? (
          <div className={EMPTY}>Loading…</div>
        ) : null
      ) : (
        <div className={cn(state.kind !== "ready" && "opacity-60")}>
          {data.imports.length === 0 ? (
            <div className={EMPTY}>
              No CCL schedules imported for these days yet. Click Pull from
              Discord.
            </div>
          ) : (
            data.imports.map((imp) => <ImportCard key={imp.id} imp={imp} />)
          )}
        </div>
      )}
    </Shell>
  );
}

const STATUS_PILL: Record<DispatchImport["status"], string> = {
  pending: "bg-[#e8f3fc] text-[#185FA5]",
  applied: "bg-[#e6f4ec] text-[#1e6b43]",
  superseded: "bg-[#f0f0ee] text-[#777]",
};

/** .pill */
const PILL =
  "inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap";

function ImportCard({ imp }: { imp: DispatchImport }) {
  const superseded = imp.status === "superseded";
  return (
    <article
      aria-label={`${fmtDay(imp.service_date)} ${imp.title}`}
      data-import={imp.id}
      className={cn(
        "mb-4 overflow-hidden rounded-xl border-[0.5px] border-black/10 bg-white",
        superseded && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b-[0.5px] border-black/[.08] bg-[#f9f9f7] px-4 py-3">
        <span className="text-[14px] font-semibold text-[#1a1a1a]">
          {fmtDay(imp.service_date)}
        </span>
        <span className={cn(PILL, STATUS_PILL[imp.status])}>
          {imp.status.charAt(0).toUpperCase() + imp.status.slice(1)}
        </span>
        {imp.is_revision ? (
          <span className={cn(PILL, "bg-[#fdf6e7] text-[#8a5a00]")}>
            Revision
          </span>
        ) : null}
        {imp.failed_count ? (
          <span className={cn(PILL, "bg-[#fde8e8] text-[#A32D2D]")}>
            {imp.failed_count} line{imp.failed_count === 1 ? "" : "s"} not read
          </span>
        ) : null}
        <span className="text-[12px] text-[#444]">{imp.title}</span>
        <span className="ml-auto text-[11px] text-[#888]">
          {imp.vehicle_count} vehicle{imp.vehicle_count === 1 ? "" : "s"} ·
          posted {fmtStamp(imp.posted_at)}
          {imp.edited_at ? ` · edited ${fmtStamp(imp.edited_at)}` : ""}
        </span>
      </div>
      <details className="border-b-[0.5px] border-black/[.06] px-4 py-2 text-[12px] text-[#444]">
        <summary className="cursor-pointer text-[#185FA5]">
          Show original message
        </summary>
        <pre className="mt-2 font-[inherit] break-words whitespace-pre-wrap text-[#1a1a1a]">
          {imp.raw_content}
        </pre>
      </details>
      {imp.closures.length ? (
        <div className="flex flex-col gap-1.5 border-b-[0.5px] border-black/[.06] px-4 py-2.5">
          {imp.closures.map((c) => (
            <div
              key={c.line_no}
              className="flex flex-wrap items-baseline gap-2 text-[12px]"
            >
              <span className="font-semibold text-[#1a1a1a]">
                {c.tour_name || c.ccl_section}
              </span>
              <span
                className={cn(
                  PILL,
                  "bg-[#f0f0ee] whitespace-normal text-[#444]",
                )}
              >
                {c.note || "Closed"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {imp.lines.length ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#f9f9f7] text-left text-[11px] font-semibold whitespace-nowrap text-[#888]">
                {[
                  "Section",
                  "Bus",
                  "Driver",
                  "Vehicle",
                  "Guide",
                  "Label",
                  "CCL note",
                  "Read",
                ].map((h) => (
                  <th
                    key={h}
                    className="border-b-[0.5px] border-black/[.08] px-3 py-[7px] font-semibold"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {imp.lines.map((ln) => (
                <LineRow key={ln.line_no} ln={ln} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  );
}

const MATCH = "text-[11px] text-[#3B6D11]";
const NOMATCH = "text-[11px] font-semibold text-[#A32D2D]";
const MUTED = "text-[#999]";

/** 名字一格：CCL 原文 + 现在对上的人 / No match（分不清时列候选）。读不出的行只写原文。 */
function NameCell({
  text,
  match,
  choices,
  parsed,
}: {
  text: string | null;
  match: string | null;
  choices: string;
  parsed: boolean;
}) {
  if (!text) return <span className={MUTED}>—</span>;
  return (
    <>
      <span className="font-semibold text-[#1a1a1a]">{text}</span>
      {parsed ? (
        match ? (
          <div className={MATCH}>→ {match}</div>
        ) : (
          <div className={NOMATCH}>
            No match{choices ? ` - ${choices}?` : ""}
          </div>
        )
      ) : null}
    </>
  );
}

function LineRow({ ln }: { ln: DispatchImportLine }) {
  const sectionSub =
    ln.tour_name ||
    (ln.shift === "relay"
      ? "Morning Relay · 1st Round"
      : ln.shift === "private_tour"
        ? "Private Tour"
        : "");
  return (
    <tr
      className={cn(
        "border-b-[0.5px] border-black/5 align-top text-[#444] last:border-b-0",
        !ln.parse_ok && "bg-[#fff6f6]",
      )}
      data-line={ln.line_no}
    >
      <td className="px-3 py-2">
        {ln.ccl_section || "—"}
        {sectionSub ? <div className={MUTED}>{sectionSub}</div> : null}
      </td>
      <td className="px-3 py-2">{ln.bus_label || ""}</td>
      <td className="px-3 py-2">
        <NameCell
          text={ln.driver_text}
          match={ln.driver_match}
          choices={ln.driver_choices}
          parsed={ln.parse_ok}
        />
      </td>
      <td className="px-3 py-2">
        {ln.vehicle_text ? (
          <>
            <span className="font-semibold text-[#1a1a1a]">
              {ln.vehicle_text}
            </span>
            {ln.parse_ok ? (
              ln.vehicle_match ? (
                <div className={MATCH}>
                  → {ln.vehicle_match}
                  {ln.vehicle_inactive ? " (inactive)" : ""}
                </div>
              ) : (
                <div className={NOMATCH}>No match</div>
              )
            ) : null}
          </>
        ) : (
          <span className={MUTED}>—</span>
        )}
      </td>
      <td className="px-3 py-2">
        {ln.is_driver_guide ? (
          "Driver Guide"
        ) : (
          <NameCell
            text={ln.guide_text}
            match={ln.guide_match}
            choices={ln.guide_choices}
            parsed={ln.parse_ok}
          />
        )}
      </td>
      <td className="px-3 py-2">{ln.route_label || ""}</td>
      <td className="px-3 py-2">
        {ln.ccl_note ? (
          <span className="text-[11px] text-[#8a5a00]">{ln.ccl_note}</span>
        ) : null}
      </td>
      <td className="px-3 py-2">
        {ln.parse_ok ? (
          <span className={MATCH}>OK</span>
        ) : (
          <>
            <div className={NOMATCH}>{ln.parse_error}</div>
            <div className={MUTED}>{ln.raw_line}</div>
          </>
        )}
      </td>
    </tr>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="text-stone-800">{children}</main>;
}

function HowToUse() {
  return (
    // 旧页这里是蓝框 details（默认收起），不是全站那种浅绿框。
    <details className="mb-5 rounded-[10px] border border-[#b5d4f4] bg-[#e8f3fc] px-5 py-3.5 text-[12px] leading-[1.8] text-[#0c3a6b]">
      <summary className="cursor-pointer font-semibold text-[#185FA5]">
        📖 How to use — Dispatch Imports
      </summary>
      <ol className="list-decimal pl-[18px]">
        <li>
          This page shows the schedules CCL posts in Discord #bus-assignments
          (messages that start with &quot;NPE month/day:&quot;). It only shows
          them. Nothing here changes the Dispatch page. The Dispatch page fills
          in CCL&rsquo;s vehicles from these messages and marks one applied when
          its day is saved.
        </li>
        <li>
          Click Pull from Discord to read new messages now. The system also
          checks Discord on its own every 30 minutes. The line under the button
          tells you what happened: new schedules, revisions, nothing new, or why
          the pull failed. New schedules appear in the list right away.
        </li>
        <li>
          Each day shows CCL&rsquo;s message with one row per vehicle. Revision
          means CCL posted a revision or edited the message. Superseded (greyed
          out) means a newer message for the same day replaced it.
        </li>
        <li>
          When CCL writes CLOSED under a tour, that tour shows Closed next to
          its name, or CCL&rsquo;s own words when they gave a reason. No vehicle
          is expected for it that day.
        </li>
        <li>
          A name matches when it is someone&rsquo;s nickname in Human Resource,
          or the first word of exactly one person&rsquo;s nickname (FREDDY
          matches Freddy L). Capitals do not matter. Red &quot;No match&quot;
          means no one matched, or two people share that first name (then it
          lists them, e.g. &quot;No match - Bruce O or Bruce W?&quot;; staff
          pick one on the Dispatch page every time). When someone picks or types
          a name that matches no one, the same spelling matches on its own next
          time; &quot;(typed, not in HR)&quot; means it matches a name typed
          there that is not in Human Resource yet. For vehicles, red means the
          number is not in Vehicles. Red rows are lines the system could not
          read. The original text is kept, so check it against Show original
          message.
        </li>
        <li>
          If the pull fails with &quot;missing ...&quot; or &quot;Message
          Content Intent&quot;, tell Max. Those are settings, not something to
          fix on this page.
        </li>
      </ol>
    </details>
  );
}
