"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  CARD_CLASS,
  CARD_HEADER_CLASS,
  CARD_TITLE_CLASS,
  INLINE_INPUT_BASE,
  LegacyHowTo,
  LegacyPageHeader,
  resultClass,
  TBODY_CLASS,
  TD_CLASS,
  TH_CLASS,
  TR_CLASS,
} from "@/components/pickup-locations/legacy-ui";
import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchAutoSend, saveAutoSend } from "@/lib/auto-send-api";
import { fetchCurrentUser } from "@/lib/auth-api";
import { LA_TIME_ZONE, laMinuteOfDay } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type {
  AutoSendConfig,
  AutoSendRun,
  AutoSendSettings,
} from "@/types/auto-send";

type View =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: AutoSendSettings };

/** 白卡片上的提交键（Annie 2026-10-11：蓝色只给提交）。 */
const SAVE_BTN =
  "h-9 cursor-pointer rounded-[7px] bg-[#3b82f6] px-5 text-[13px] font-semibold whitespace-nowrap text-white hover:bg-[#2f76e8] disabled:cursor-not-allowed disabled:opacity-60";
const ADD_BTN =
  "cursor-pointer rounded-[6px] border border-dashed border-black/30 bg-paper px-2.5 py-[3px] text-[12px] text-[#1a1a1a] hover:bg-[#f5f5f3] disabled:cursor-not-allowed disabled:opacity-50 night:border-white/20 night:bg-white/[.04] night:text-white/80";
const CHIP =
  "inline-flex items-center gap-1 rounded-[6px] border-[0.5px] border-black/20 bg-[#fafaf9] py-0.5 pr-1 pl-2 font-mono text-[12px] text-[#1a1a1a] night:border-white/15 night:bg-white/[.06] night:text-white/85";
const LABEL = "text-[12px] font-semibold text-[#1a1a1a] night:text-white/85";
const NOTE = "text-[11.5px] text-[#1a1a1a] night:text-white/50";

const WHEN = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const fmt = (iso: string | null) =>
  iso ? WHEN.format(new Date(iso)).replace(/\s/g, " ") : "—";

/** "18:00" → "6:00 PM"。 */
function clock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * 这张卡自己开着时下一批是哪个时间点（洛杉矶时间）。两个开关拆开后（2026-10-16），
 * 每张卡只看自己这节的时间；门票卡把汇总邮件的时间也算进去，标一下是汇总。
 */
function nextRun(times: string[], summary?: { time: string }): string | null {
  const now = laMinuteOfDay();
  const all = [
    ...times.map((t) => ({ t, label: undefined as string | undefined })),
    ...(summary ? [{ t: summary.time, label: "summary" }] : []),
  ]
    .filter((x) => /^\d{1,2}:\d{2}$/.test(x.t))
    .sort((a, b) => toMinutes(a.t) - toMinutes(b.t));
  if (!all.length) return null;
  const today = all.find((x) => toMinutes(x.t) > now);
  const pick = today ?? all[0];
  return `Next: ${today ? "today" : "tomorrow"} ${clock(pick.t)}${pick.label ? ` · ${pick.label}` : ""}`;
}

const KIND_LABEL: Record<AutoSendRun["kind"], string> = {
  tour: "Tour confirmations",
  tickets: "Ticket reminders",
  tickets_summary: "Ticket summary email",
};

const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** 一批的结果写成一句话（summary 的形状按种类不同，见 types/auto-send.ts）。 */
function runResult(r: AutoSendRun): { text: string; bad?: boolean } {
  const s = r.summary ?? {};
  if (r.status === "off") return { text: "Auto-send was off" };
  if (r.status === "failed")
    return { text: String(s.error ?? "Failed"), bad: true };
  if (r.status === "running")
    return r.stale
      ? {
          text: "Started over 2 hours ago. Unsent orders go out in the next run.",
          bad: true,
        }
      : { text: "Sending…" };
  if (r.kind === "tour")
    return { text: `${num(s.sent)} sent · ${num(s.skipped)} skipped` };
  if (r.kind === "tickets")
    return {
      text: `${num(s.sent)} sent · ${num(s.waiting)} not ready (no Cfm #)`,
    };
  switch (s.status) {
    case "sent":
      return { text: `Emailed · ${num(s.unsent)} not sent yet for the day` };
    case "email_failed":
      return { text: "The summary email could not be sent", bad: true };
    case "no_tickets":
      return { text: "No tickets that day" };
    default:
      return { text: "Already emailed" };
  }
}

function runStatus(r: AutoSendRun): { label: string; className: string } {
  if (r.status === "running" && r.stale)
    return {
      label: "Stuck",
      className: "text-[#b45309] night:text-amber-300",
    };
  return {
    done: { label: "Done", className: "text-[#15803d] night:text-emerald-300" },
    failed: { label: "Failed", className: "text-[#b91c1c] night:text-red-300" },
    off: { label: "Off", className: "text-[#57534e] night:text-white/50" },
    running: {
      label: "Running",
      className: "text-[#b45309] night:text-amber-300",
    },
  }[r.status];
}

/**
 * Settings → Auto Send（admin，后端 auto-send G76；Annie 2026-10-15 看预览同意；
 * 2026-10-16 后端把总开关拆成巴士团 / 门票各自一个，`config.enabled` 没了）：
 * 巴士团确认和门票提醒两张卡片，各自标题区一个开关（点了先确认、确认就存，和字段的 Save 分开）、各自 Save。
 */
export function AutoSendView() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      try {
        const me = await fetchCurrentUser(signal);
        if (signal.aborted) return;
        if (!me.is_admin) {
          setView({ kind: "forbidden" });
          return;
        }
        const data = await fetchAutoSend(signal);
        if (!signal.aborted) setView({ kind: "ready", data });
      } catch (error) {
        if (signal.aborted) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setView({ kind: "forbidden" });
        else setView({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [reloadKey, redirectToLogin]);

  /** 存一份整份设置；成功后页面上的「已存」换成返回的，并重拉一次记录。 */
  async function save(config: AutoSendConfig): Promise<ActionResult> {
    try {
      const saved = await saveAutoSend(config);
      setView((v) =>
        v.kind === "ready"
          ? {
              kind: "ready",
              data: { ...v.data, config: saved, readable: true },
            }
          : v,
      );
      fetchAutoSend()
        .then((data) =>
          setView((v) => (v.kind === "ready" ? { kind: "ready", data } : v)),
        )
        .catch(() => {});
      return { status: "ok" };
    } catch (error) {
      if (isStatus(error, 401)) {
        redirectToLogin();
        return { status: "redirecting" };
      }
      return { status: "error", message: describeError(error) };
    }
  }

  const data = view.kind === "ready" ? view.data : null;
  /** 没读出来当关处理（同旧的「readable」判据），哪个开关都不给点开。 */
  const readable = !!data?.readable;

  return (
    <main className="text-stone-800 night:text-white/90">
      <LegacyPageHeader title="⏱️ Auto Send" />
      {view.kind === "loading" ? (
        <Panel>Loading…</Panel>
      ) : view.kind === "forbidden" ? (
        <Panel>
          <p className="font-medium text-stone-800 night:text-white/90">
            Admin access required
          </p>
          <p className="mt-1">Only admins can change auto-send.</p>
        </Panel>
      ) : view.kind === "error" ? (
        <ErrorBanner
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Could not load auto-send settings: {view.message}
        </ErrorBanner>
      ) : (
        <>
          <HowToUse />
          {!view.data.readable ? (
            <p
              role="alert"
              data-unreadable
              className="mb-5 rounded-xl border-[0.5px] border-[rgba(138,90,0,.25)] bg-[#fdf1dd] px-4 py-[11px] text-[13px] text-[#8a5a00]"
            >
              Settings could not be read, so auto-send is treated as off. Save
              once to fix it.
            </p>
          ) : null}

          <div className="grid items-start gap-x-5 lg:grid-cols-2">
            <TourCard
              saved={view.data.config}
              readable={readable}
              onSave={(tour) => save({ ...view.data.config, tour })}
              onToggleEnabled={(enabled) =>
                save({
                  ...view.data.config,
                  tour: { ...view.data.config.tour, enabled },
                })
              }
            />
            <TicketsCard
              saved={view.data.config}
              readable={readable}
              onSave={(tickets) => save({ ...view.data.config, tickets })}
              onToggleEnabled={(enabled) =>
                save({
                  ...view.data.config,
                  tickets: { ...view.data.config.tickets, enabled },
                })
              }
            />
          </div>

          <Runs runs={view.data.runs} />
        </>
      )}
    </main>
  );
}

function HowToUse() {
  return (
    <LegacyHowTo title="How to use — Auto Send">
      <li>
        Tour confirmations and ticket reminders each have their own switch, off
        until you turn it on. When one is on, it starts at its next send time.
        A batch that just passed is not sent again.
      </li>
      <li>
        Tour confirmations go out at each send time to bus tour orders from the
        set number of days before the tour up to the day before. Nothing goes
        out on the tour day.
      </li>
      <li>
        Each bus product needs a tour type in Settings → Products. Orders
        without one, with a pickup time that can&apos;t be read, or with two
        lines that disagree are skipped and emailed to the people below, once
        per order.
      </li>
      <li>
        Ticket reminders go out at each send time to ticket orders that have a
        Cfm #. The day before, a summary email lists what is still not sent for
        the next day and why. Test orders are left out of the summary.
      </li>
      <li>
        Orders already sent by hand are not sent again, and the other way round.
        To send again by hand, tick Send anyway. Auto-sent messages show as
        &ldquo;scheduler&rdquo; in the Send Log.
      </li>
      <li>
        Turning one off stops every batch of that kind that hasn&apos;t
        started. A batch already sending finishes. Times are Las Vegas time.
      </li>
    </LegacyHowTo>
  );
}

/** 一张设置卡片的外壳：抬头、内容、底下的 Save 和结果。 */
/**
 * 卡片标题区的开关（2026-10-16：原来页面顶部的总开关拆成这两张卡各自一个）：
 * 开 = 绿、关 = 灰，不用蓝色（蓝色只给提交键，Annie 2026-10-11）；点了先确认，确认就存，和下面字段的 Save 分开、各自独立。
 */
function EnabledSwitch({
  enabled,
  label,
  nextRun: next,
  onToggle,
}: {
  enabled: boolean;
  label: string;
  nextRun: string | null;
  onToggle: (next: boolean) => Promise<ActionResult>;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        data-auto-switch
        onClick={() => setConfirming(true)}
        className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/12 bg-[#0c1a2b] py-1 pr-3 pl-1 text-left"
      >
        <span
          aria-hidden
          className={cn(
            "relative h-5 w-9 flex-none rounded-full transition-colors",
            enabled ? "bg-[#16a34a]" : "bg-[#475569]",
          )}
        >
          <span
            className={cn(
              "absolute top-[2.5px] size-[15px] rounded-full bg-white transition-[left]",
              enabled ? "left-[19px]" : "left-[2.5px]",
            )}
          />
        </span>
        <b className="text-[12px] text-white">{enabled ? "ON" : "OFF"}</b>
        {enabled && next ? (
          <span data-next-run className="text-[11.5px] text-[#94a3b8]">
            {next}
          </span>
        ) : null}
      </button>
      {confirming ? (
        <ConfirmDialog
          title={enabled ? `Turn off ${label}?` : `Turn on ${label}?`}
          confirmLabel={enabled ? "Turn off" : "Turn on"}
          busyLabel="Saving…"
          danger={enabled}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            const r = await onToggle(!enabled);
            if (r.status === "ok") setConfirming(false);
            return r;
          }}
        >
          {enabled ? (
            <p>
              Batches that haven&apos;t started won&apos;t go out. A batch that
              is sending right now finishes.
            </p>
          ) : (
            <p>
              It starts at the next send time. A batch that just passed is not
              sent.
            </p>
          )}
        </ConfirmDialog>
      ) : null}
    </>
  );
}

function SettingsCard({
  title,
  sub,
  label,
  switchLabel,
  enabled,
  nextRun,
  onToggleEnabled,
  dirty,
  onSave,
  children,
}: {
  title: string;
  sub: string;
  /** 卡片的 aria-label（section 查找用，照旧跟标题一样大小写，别的套靠它找卡片）。 */
  label: string;
  /** 开关确认弹窗里念的名字（小写、接在 "Turn on/off " 后面读起来顺，和 aria-label 分开，互不影响）。 */
  switchLabel: string;
  enabled: boolean;
  nextRun: string | null;
  onToggleEnabled: (next: boolean) => Promise<ActionResult>;
  dirty: boolean;
  onSave: () => Promise<ActionResult>;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  return (
    <section aria-label={label} className={CARD_CLASS}>
      <div className={CARD_HEADER_CLASS}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={CARD_TITLE_CLASS}>{title}</span>
          <span className={NOTE}>{sub}</span>
        </div>
        <EnabledSwitch
          enabled={enabled}
          label={switchLabel}
          nextRun={nextRun}
          onToggle={onToggleEnabled}
        />
      </div>
      <div className="flex flex-col gap-3.5 px-4 py-3.5">{children}</div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t-[0.5px] border-black/[.08] px-4 py-3 night:border-white/10">
        {result ? (
          <span role="status" className={resultClass(result.tone)}>
            {result.text}
          </span>
        ) : null}
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={async () => {
            setBusy(true);
            setResult(null);
            const r = await onSave();
            setBusy(false);
            if (r.status === "ok") setResult({ tone: "ok", text: "Saved." });
            else if (r.status === "error")
              setResult({ tone: "error", text: r.message });
          }}
          className={SAVE_BTN}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

function TourCard({
  saved,
  readable,
  onSave,
  onToggleEnabled,
}: {
  saved: AutoSendConfig;
  readable: boolean;
  onSave: (tour: AutoSendConfig["tour"]) => Promise<ActionResult>;
  onToggleEnabled: (enabled: boolean) => Promise<ActionResult>;
}) {
  // 字段的草稿不含 enabled（开关独立存、各自确认，互不影响；见 EnabledSwitch）：
  // savedKey 只看字段，开关单独存时字段的 savedKey 不变，草稿不会被开关的确认冲掉。
  const fieldsOf = (t: AutoSendConfig["tour"]) => ({
    times: t.times,
    days_before: t.days_before,
    alert_emails: t.alert_emails,
  });
  const [draft, setDraft] = useState(fieldsOf(saved.tour));
  const savedKey = JSON.stringify(fieldsOf(saved.tour));
  useEffect(() => setDraft(JSON.parse(savedKey)), [savedKey]);
  return (
    <SettingsCard
      title="Tour confirmations"
      sub="Bus tours"
      label="Tour confirmations"
      switchLabel="tour confirmations"
      enabled={readable && saved.tour.enabled}
      nextRun={nextRun(saved.tour.times)}
      onToggleEnabled={onToggleEnabled}
      dirty={JSON.stringify(draft) !== savedKey}
      onSave={() => onSave({ ...draft, enabled: saved.tour.enabled })}
    >
      <TimesField
        id="tour-times"
        values={draft.times}
        onChange={(times) => setDraft({ ...draft, times })}
      />
      <DaysField
        id="tour-days"
        value={draft.days_before}
        unit="days before the tour"
        note="Up to the day before. Never on the tour day."
        onChange={(days_before) => setDraft({ ...draft, days_before })}
      />
      <EmailsField
        id="tour-alerts"
        label="Email skipped orders to"
        note="Orders skipped because of a missing tour type, a pickup time that can't be read or lines that disagree. Each order is reported once."
        values={draft.alert_emails}
        onChange={(alert_emails) => setDraft({ ...draft, alert_emails })}
      />
    </SettingsCard>
  );
}

function TicketsCard({
  saved,
  readable,
  onSave,
  onToggleEnabled,
}: {
  saved: AutoSendConfig;
  readable: boolean;
  onSave: (tickets: AutoSendConfig["tickets"]) => Promise<ActionResult>;
  onToggleEnabled: (enabled: boolean) => Promise<ActionResult>;
}) {
  const fieldsOf = (t: AutoSendConfig["tickets"]) => ({
    times: t.times,
    days_before: t.days_before,
    summary_time: t.summary_time,
    summary_emails: t.summary_emails,
  });
  const [draft, setDraft] = useState(fieldsOf(saved.tickets));
  const savedKey = JSON.stringify(fieldsOf(saved.tickets));
  useEffect(() => setDraft(JSON.parse(savedKey)), [savedKey]);
  return (
    <SettingsCard
      title="Ticket reminders"
      sub="Tickets with a Cfm #"
      label="Ticket reminders"
      switchLabel="ticket reminders"
      enabled={readable && saved.tickets.enabled}
      nextRun={nextRun(saved.tickets.times, { time: saved.tickets.summary_time })}
      onToggleEnabled={onToggleEnabled}
      dirty={JSON.stringify(draft) !== savedKey}
      onSave={() => onSave({ ...draft, enabled: saved.tickets.enabled })}
    >
      <TimesField
        id="tickets-times"
        values={draft.times}
        onChange={(times) => setDraft({ ...draft, times })}
      />
      <DaysField
        id="tickets-days"
        value={draft.days_before}
        unit="days before the service date"
        onChange={(days_before) => setDraft({ ...draft, days_before })}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tickets-summary-time" className={LABEL}>
          Day-before summary at
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="tickets-summary-time"
            type="time"
            value={draft.summary_time}
            onChange={(e) =>
              setDraft({ ...draft, summary_time: e.target.value })
            }
            className={cn(INLINE_INPUT_BASE, "w-[120px] [color-scheme:light]")}
          />
          <span className={NOTE}>
            What is still not sent for the next day, and why.
          </span>
        </div>
      </div>
      <EmailsField
        id="tickets-summary"
        label="Send the summary to"
        values={draft.summary_emails}
        onChange={(summary_emails) => setDraft({ ...draft, summary_emails })}
      />
    </SettingsCard>
  );
}

function TimesField({
  id,
  values,
  onChange,
}: {
  id: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState("");
  const add = () => {
    if (!adding || values.includes(adding)) return;
    onChange([...values, adding].sort());
    setAdding("");
  };
  return (
    <div className="flex flex-col gap-1.5" data-field={id}>
      <label htmlFor={id} className={LABEL}>
        Send times (Las Vegas time)
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((t) => (
          <span key={t} className={CHIP} data-time={t}>
            {t}
            <span className="font-sans text-[11px] text-[#57534e] night:text-white/50">
              {clock(t)}
            </span>
            <button
              type="button"
              aria-label={`Remove ${t}`}
              onClick={() => onChange(values.filter((v) => v !== t))}
              className="cursor-pointer px-1 text-[14px] leading-none text-[#78716c] hover:text-[#1a1a1a] night:text-white/50"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          type="time"
          aria-label="New send time"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          className={cn(INLINE_INPUT_BASE, "w-[120px] [color-scheme:light]")}
        />
        <button
          type="button"
          disabled={!adding || values.includes(adding)}
          onClick={add}
          className={ADD_BTN}
        >
          + Add time
        </button>
      </div>
    </div>
  );
}

function DaysField({
  id,
  value,
  unit,
  note,
  onChange,
}: {
  id: string;
  value: number;
  unit: string;
  note?: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={LABEL}>
        Start sending
      </label>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#1a1a1a] night:text-white/80">
        <input
          id={id}
          type="number"
          min={1}
          max={14}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          className={cn(INLINE_INPUT_BASE, "w-[64px] tabular-nums")}
        />
        {unit}
        {note ? <span className={NOTE}>({note})</span> : null}
      </div>
    </div>
  );
}

function EmailsField({
  id,
  label,
  note,
  values,
  onChange,
}: {
  id: string;
  label: string;
  note?: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [adding, setAdding] = useState("");
  const clean = adding.trim().toLowerCase();
  const ok =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) && !values.includes(clean);
  const add = () => {
    if (!ok) return;
    onChange([...values, clean]);
    setAdding("");
  };
  return (
    <div className="flex flex-col gap-1.5" data-field={id}>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((e) => (
          <span key={e} className={cn(CHIP, "font-sans")} data-email={e}>
            {e}
            <button
              type="button"
              aria-label={`Remove ${e}`}
              onClick={() => onChange(values.filter((v) => v !== e))}
              className="cursor-pointer px-1 text-[14px] leading-none text-[#78716c] hover:text-[#1a1a1a] night:text-white/50"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          type="email"
          aria-label={`Add to ${label}`}
          placeholder="name@nationalparkexpress.com"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className={cn(INLINE_INPUT_BASE, "w-[240px] max-w-full")}
        />
        <button type="button" disabled={!ok} onClick={add} className={ADD_BTN}>
          + Add email
        </button>
      </div>
      {note ? <p className={cn(NOTE, "m-0")}>{note}</p> : null}
    </div>
  );
}

function Runs({ runs }: { runs: AutoSendRun[] }) {
  return (
    <section aria-label="Recent runs" className={CARD_CLASS}>
      <div className={CARD_HEADER_CLASS}>
        <span className={CARD_TITLE_CLASS}>Recent runs</span>
        <span className={NOTE}>Last 30, newest first</span>
      </div>
      {runs.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-[12px] tabular-nums">
            <thead>
              <tr>
                <th className={TH_CLASS}>Started</th>
                <th className={TH_CLASS}>What</th>
                <th className={TH_CLASS}>Status</th>
                <th className={TH_CLASS}>Result</th>
              </tr>
            </thead>
            <tbody className={TBODY_CLASS}>
              {runs.map((r) => {
                const st = runStatus(r);
                const res = runResult(r);
                return (
                  <tr key={r.run_key} data-run={r.run_key} className={TR_CLASS}>
                    <td className={cn(TD_CLASS, "whitespace-nowrap")}>
                      {fmt(r.started_at)}
                    </td>
                    <td className={TD_CLASS}>{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td className={cn(TD_CLASS, "font-semibold", st.className)}>
                      {st.label}
                    </td>
                    <td
                      className={cn(
                        TD_CLASS,
                        res.bad && "text-[#b91c1c] night:text-red-300",
                      )}
                    >
                      {res.text}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="m-0 px-4 py-3 text-[12.5px] text-[#1a1a1a] night:text-white/60">
          Nothing has run yet.
        </p>
      )}
    </section>
  );
}
