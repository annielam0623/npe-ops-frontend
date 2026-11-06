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
import { byTick } from "@/lib/by-tick";
import { usePermissions } from "@/lib/staff-permissions";
import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import { fetchActionLog } from "@/lib/action-log";
import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner, Panel } from "@/components/ui/panel";
import { describeError, isStatus } from "@/lib/api-errors";
import { fetchAutoSend, saveAutoSend } from "@/lib/auto-send-api";
import { fetchTixTourTypes } from "@/lib/tix-tour-types-api";
import { fetchCurrentUser } from "@/lib/auth-api";
import { LA_TIME_ZONE, laMinuteOfDay } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import type {
  AutoSendConfig,
  AutoSendLeadGroup,
  AutoSendOption,
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
  "cursor-pointer rounded-[6px] border border-[#6b8e74] bg-[#6b8e74] text-white hover:bg-[#5d7d66] px-2.5 py-[3px] text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50";
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
  last_minute: "Last Minute (tours)",
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
    return {
      text: `${num(s.sent)} sent · ${num(s.skipped)} skipped${deferredText(s)}`,
    };
  if (r.kind === "last_minute")
    return {
      text: `${num(s.sent)} sent · ${num(s.skipped)} skipped${
        num(s.alert_failed)
          ? ` · ${num(s.alert_failed)} alert emails failed`
          : ""
      }`,
      bad: num(s.alert_failed) > 0,
    };
  if (r.kind === "tickets") {
    const report = dailyReportText(s.daily_report);
    return {
      text: `${num(s.sent)} sent · ${num(s.waiting)} not ready (no Cfm #)${deferredText(s)}${report ? ` · ${report.text}` : ""}`,
      bad: report?.bad,
    };
  }
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
 * Settings → Auto Send（只有 Super Admin，后端 auto-send G76；Annie 2026-10-15 看预览同意；
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

  // 全部按照勾选（Annie 2026-10-30 置顶 10c）：开关开着按勾（settings.auto_send，同后端接口），关着照旧；Super Admin 全过。
  const tickPerms = usePermissions();
  const tickPermsRef = useRef(tickPerms);
  tickPermsRef.current = tickPerms;
  useEffect(() => {
    // 权限读完再判断（开关开着时要按勾）。
    if (!tickPerms.ready) return;
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      try {
        const me = await fetchCurrentUser(signal);
        if (signal.aborted) return;
        // 只对 Super Admin 开放（Annie 2026-10-24，后端 GET/PUT 对其他人 403）：不是就不请求接口。
        if (
          !byTick(tickPermsRef.current, "settings.auto_send", {
            superAdmin: !!me.is_superadmin,
          })
        ) {
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
  }, [reloadKey, redirectToLogin, tickPerms.ready, tickPerms.active]);

  /** 存一份整份设置；成功后页面上的「已存」换成返回的，并重拉一次记录。 */
  async function save(config: AutoSendConfig): Promise<ActionResult> {
    try {
      const saved = await saveAutoSend(withoutRetiredKeys(config));
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
            Super Admin access required
          </p>
          <p className="mt-1">Only Super Admins can change auto-send.</p>
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
          <HowToUse
            v3={
              !!data &&
              (data.config.tickets.daily_report !== undefined ||
                data.config.tickets.lead_groups !== undefined ||
                data.config.tickets.max_per_batch !== undefined)
            }
            lastMinute={!!data?.tour_templates?.length}
          />
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
              templates={view.data.tour_templates}
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
              ticketTypes={view.data.ticket_types}
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
          <ActionLogPanel
            refreshKey={0}
            reloadOnOpen
            onUnauthorized={redirectToLogin}
            load={(before, signal) =>
              fetchActionLog(
                "/api/settings/auto-send/action-log",
                before,
                signal,
              )
            }
          />
        </>
      )}
    </main>
  );
}

/** v3 = 后端带了置顶 89 的新键（preview v3 的全文）；旧后端照以前的 6 条。 */
function HowToUse({ v3, lastMinute }: { v3: boolean; lastMinute: boolean }) {
  if (v3) return <HowToUseV3 lastMinute={lastMinute} />;
  return (
    <LegacyHowTo title="How to use — Auto Send">
      <li>
        Tour confirmations and ticket reminders each have their own switch, off
        until you turn it on. When one is on, it starts at its next send time. A
        batch that just passed is not sent again.
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
        the next day and why. Test orders are left out of the summary. Orders
        whose Cfm # doesn&apos;t match the product are skipped and listed
        together in one email after each run.
      </li>
      <li>
        Orders already sent by hand are not sent again, and the other way round.
        To send again by hand, tick Send anyway. Auto-sent messages show as
        &ldquo;scheduler&rdquo; in the Send Log.
      </li>
      <li>
        Turning one off stops every batch of that kind that hasn&apos;t started.
        A batch already sending finishes. Times are Las Vegas time.
      </li>
    </LegacyHowTo>
  );
}

/** 置顶 89 preview v3 的 How to use（Annie 2026-11-05「Auto Send 都选 A。动手」）。 */
function HowToUseV3({ lastMinute }: { lastMinute: boolean }) {
  return (
    <LegacyHowTo title="How to use — Auto Send">
      <li>
        Tour confirmations and ticket reminders each have their own switch, off
        until you turn it on. When one is on, it starts at its next send time. A
        batch that just passed is not sent again.
      </li>
      <li>
        Tour confirmations go out at each send time to bus tour orders from the
        set number of days before the tour up to the day before. Nothing goes
        out on the tour day.
      </li>
      {/* G258（后端带 tour_templates 才有）：Annie 答完 4 题「动手」，不另出 preview，合 main 时附截图。 */}
      {lastMinute ? (
        <li data-howto-last-minute>
          Message template: orders placed before the Last Minute cutoff get the
          template picked for &ldquo;Orders before the cutoff&rdquo;. Orders
          placed after the cutoff the day before the tour are checked every hour
          on the hour and sent by SMS and email with the template picked for
          &ldquo;Orders after the cutoff&rdquo;; the last check is at 12:00 AM
          on the tour day. Max per batch doesn&apos;t apply to them, and orders
          already sent by hand are not sent again.
        </li>
      ) : null}
      <li>
        Each bus product needs a tour type in Settings → Products. Orders
        without one, with a pickup time that can&apos;t be read, or with two
        lines that disagree are skipped and emailed to the people below, once
        per order.
      </li>
      <li>
        Ticket reminders go out at each send time to ticket orders that have a
        Cfm #. To start some ticket types earlier or later, add a time (Start
        sending N days before) and pick its ticket types in Add ticket type, the
        same way you pick hotels for a Morning Relay car. A ticket type can be
        in one time only; ones already picked show grey. Ticket types not picked
        anywhere use the default. The send times are the same for every ticket
        type. Click Save to keep the changes.
      </li>
      <li>
        Max per batch: each batch sends at most this many orders, the earliest
        pickups first. The last batch of the day sends everything that is left.
        An order that can&apos;t be sent yet is tried again in every batch until
        the day before the service date.
      </li>
      <li>
        Daily report: after the last batch of the day, one email lists the
        ticket orders that were due but not sent, why, and what to do (orders
        whose Cfm # doesn&apos;t match the product included). It is the only
        summary email; there is no morning summary any more. It has its own
        switch, off until you turn it on.
      </li>
      <li>
        Messages go out one guest at a time, about one second apart, so a big
        batch takes a few minutes.
      </li>
      <li>
        Orders already sent by hand are not sent again, and the other way round.
        To send again by hand, tick Send anyway. Auto-sent messages show as
        &ldquo;scheduler&rdquo; in the Send Log.
      </li>
      <li>
        Turning one off stops every batch of that kind that hasn&apos;t started.
        A batch already sending finishes. Times are Las Vegas time.
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
  templates,
  onSave,
  onToggleEnabled,
}: {
  saved: AutoSendConfig;
  readable: boolean;
  /** G258：后端带了 tour_templates 才出两行模板下拉。 */
  templates?: AutoSendOption[];
  onSave: (tour: AutoSendConfig["tour"]) => Promise<ActionResult>;
  onToggleEnabled: (enabled: boolean) => Promise<ActionResult>;
}) {
  // 字段的草稿不含 enabled（开关独立存、各自确认，互不影响；见 EnabledSwitch）：
  // savedKey 只看字段，开关单独存时字段的 savedKey 不变，草稿不会被开关的确认冲掉。
  const fieldsOf = (t: AutoSendConfig["tour"]) => ({
    times: t.times,
    days_before: t.days_before,
    alert_emails: t.alert_emails,
    // 置顶 89：后端带了才有（旧后端没有这个键 ⇒ 不出这一格、也不发回去）
    ...(t.max_per_batch !== undefined
      ? { max_per_batch: t.max_per_batch }
      : {}),
    // G258：两个模板（旧后端没有 ⇒ 不出、也不发回去）。last_minute_cutoff 不在这张卡上改，只读来写说明。
    ...(t.template_regular !== undefined
      ? { template_regular: t.template_regular }
      : {}),
    ...(t.template_last_minute !== undefined
      ? { template_last_minute: t.template_last_minute }
      : {}),
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
      onSave={() => {
        const bad = checkTour(draft);
        if (bad) return Promise.resolve({ status: "error", message: bad });
        return onSave({ ...saved.tour, ...draft, enabled: saved.tour.enabled });
      }}
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
      {draft.max_per_batch !== undefined ? (
        <MaxPerBatchField
          id="tour-max"
          value={draft.max_per_batch}
          onChange={(max_per_batch) => setDraft({ ...draft, max_per_batch })}
        />
      ) : null}
      {templates?.length &&
      draft.template_regular !== undefined &&
      draft.template_last_minute !== undefined ? (
        <TemplatesField
          options={templates}
          regular={draft.template_regular}
          lastMinute={draft.template_last_minute}
          cutoff={saved.tour.last_minute_cutoff ?? "07:00"}
          onChange={(next) => setDraft({ ...draft, ...next })}
        />
      ) : null}
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
  ticketTypes,
  onSave,
  onToggleEnabled,
}: {
  saved: AutoSendConfig;
  readable: boolean;
  /** G259：后端带的门票团清单；旧后端没有 ⇒ LeadGroupsField 自己读。 */
  ticketTypes?: AutoSendOption[];
  onSave: (tickets: AutoSendConfig["tickets"]) => Promise<ActionResult>;
  onToggleEnabled: (enabled: boolean) => Promise<ActionResult>;
}) {
  const fieldsOf = (t: AutoSendConfig["tickets"]) => ({
    times: t.times,
    days_before: t.days_before,
    // G259 起后端不再用（有 daily_report 时不显示、不发回去）
    ...(t.daily_report === undefined
      ? { summary_time: t.summary_time, summary_emails: t.summary_emails }
      : {}),
    // 置顶 89：后端带了才有（旧后端没有 ⇒ 不出、也不发回去）。daily_report 的开关点了就存（见 DailyReport），草稿只管收件人。
    ...(t.lead_groups !== undefined ? { lead_groups: t.lead_groups } : {}),
    ...(t.max_per_batch !== undefined
      ? { max_per_batch: t.max_per_batch }
      : {}),
    ...(t.daily_report !== undefined
      ? { daily_report_emails: t.daily_report.emails }
      : {}),
  });
  const hasReport = saved.tickets.daily_report !== undefined;
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
      nextRun={nextRun(
        saved.tickets.times,
        !hasReport && saved.tickets.summary_time
          ? { time: saved.tickets.summary_time }
          : undefined,
      )}
      onToggleEnabled={onToggleEnabled}
      dirty={JSON.stringify(draft) !== savedKey}
      onSave={() => {
        const bad = checkTickets(draft);
        if (bad) return Promise.resolve({ status: "error", message: bad });
        const { daily_report_emails, ...rest } = draft;
        return onSave({
          ...rest,
          enabled: saved.tickets.enabled,
          ...(saved.tickets.daily_report && daily_report_emails
            ? {
                daily_report: {
                  enabled: saved.tickets.daily_report.enabled,
                  emails: daily_report_emails,
                },
              }
            : {}),
        });
      }}
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
        label={
          draft.lead_groups !== undefined
            ? "Start sending (default)"
            : undefined
        }
        note={
          draft.lead_groups !== undefined
            ? "For ticket types not set below."
            : undefined
        }
        onChange={(days_before) => setDraft({ ...draft, days_before })}
      />
      {draft.lead_groups !== undefined ? (
        <LeadGroupsField
          options={ticketTypes}
          groups={draft.lead_groups}
          defaultDays={draft.days_before}
          onChange={(lead_groups) => setDraft({ ...draft, lead_groups })}
        />
      ) : null}
      {draft.max_per_batch !== undefined ? (
        <MaxPerBatchField
          id="tickets-max"
          value={draft.max_per_batch}
          onChange={(max_per_batch) => setDraft({ ...draft, max_per_batch })}
        />
      ) : null}
      {hasReport ? null : (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tickets-summary-time" className={LABEL}>
              Day-before summary at
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="tickets-summary-time"
                type="time"
                value={draft.summary_time ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, summary_time: e.target.value })
                }
                className={cn(
                  INLINE_INPUT_BASE,
                  "w-[120px] [color-scheme:light]",
                )}
              />
              <span className={NOTE}>
                What is still not sent for the next day, and why.
              </span>
            </div>
          </div>
          <EmailsField
            id="tickets-summary"
            label="Send the summary to"
            values={draft.summary_emails ?? []}
            onChange={(summary_emails) =>
              setDraft({ ...draft, summary_emails })
            }
          />
        </>
      )}
      {saved.tickets.daily_report && draft.daily_report_emails ? (
        <DailyReport
          enabled={saved.tickets.daily_report.enabled}
          lastTime={[...draft.times].sort().at(-1) ?? null}
          emails={draft.daily_report_emails}
          onEmails={(daily_report_emails) =>
            setDraft({ ...draft, daily_report_emails })
          }
          onToggle={(enabled) =>
            onSave({
              ...saved.tickets,
              daily_report: { ...saved.tickets.daily_report!, enabled },
            })
          }
        />
      ) : null}
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
  label = "Start sending",
  note,
  onChange,
}: {
  id: string;
  value: number;
  unit: string;
  label?: string;
  note?: string;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {label}
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

// ── 置顶 89（Annie 2026-11-05「Auto Send 都选 A。动手」，preview https://claude.ai/artifact/BYv5FXVG7FqYuQ7gFEpV1a v3）──

/** 当天最后一批之前每批最多发几单；最后一批发剩下的全部。 */
function MaxPerBatchField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-field={id}>
      <label htmlFor={id} className={LABEL}>
        Max per batch
      </label>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#1a1a1a] night:text-white/80">
        <input
          id={id}
          type="number"
          min={1}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          className={cn(INLINE_INPUT_BASE, "w-[80px] tabular-nums")}
        />
        orders
        <span className={NOTE}>
          (The last batch of the day sends everything left.)
        </span>
      </div>
    </div>
  );
}

/** Dispatch › Morning Relay 挑酒店同一套样子（vehicle-row.tsx 的 Add hotel 下拉 + Chips；Annie「跟relay酒店一摸一样」）。 */
const ADD_TYPE =
  "h-[34px] w-full max-w-[320px] cursor-pointer appearance-none rounded-[7px] border border-dashed border-[#9ca3af] bg-paper bg-[right_11px_center] bg-no-repeat pr-7 pl-[11px] text-[13.5px] leading-none text-[#111827] hover:bg-[#f4f5f7] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#3b82f6]";
const ADD_TYPE_CARET =
  "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='7'%3E%3Cpath d='M1 1l4.5 4.5L10 1' fill='none' stroke='%23374151' stroke-width='1.6'/%3E%3C/svg%3E\")";
const TYPE_CHIP =
  "inline-flex cursor-pointer items-center gap-[7px] rounded-[7px] border-[0.5px] border-black/[.09] bg-[#eef2f7] px-[9px] py-[5px] text-[12.5px] text-[#1a1a1a] hover:bg-[#e2e8f0]";

/** 门票团清单（Content Studio 的 tix_tour_types，只要没停用的）。读不到 ⇒ null（只显示 key）。 */
function useTicketTypes(fromBackend?: AutoSendOption[]) {
  const [types, setTypes] = useState<AutoSendOption[] | null>(
    fromBackend ?? null,
  );
  useEffect(() => {
    // G259：GET /api/settings/auto-send 带了 ticket_types 就用它，不再另读（那个接口要 Content Studio 权限）。
    if (fromBackend) {
      setTypes(fromBackend);
      return;
    }
    const ac = new AbortController();
    fetchTixTourTypes(ac.signal)
      .then((r) =>
        setTypes(
          r.tour_types
            .filter((t) => t.is_active)
            .map((t) => ({ key: t.key, label: t.label })),
        ),
      )
      .catch(() => {
        if (!ac.signal.aborted) setTypes(null);
      });
    return () => ac.abort();
  }, [fromBackend]);
  return types;
}

function LeadGroupsField({
  options,
  groups,
  defaultDays,
  onChange,
}: {
  options?: AutoSendOption[];
  groups: AutoSendLeadGroup[];
  defaultDays: number;
  onChange: (next: AutoSendLeadGroup[]) => void;
}) {
  const types = useTicketTypes(options);
  const nameOf = (k: string) => types?.find((t) => t.key === k)?.label ?? k;
  const all = types?.map((t) => t.key) ?? [];
  const set = (i: number, g: AutoSendLeadGroup) =>
    onChange(groups.map((x, j) => (j === i ? g : x)));
  const used = new Set(groups.flatMap((g) => g.ticket_types));
  const rest = all.filter((k) => !used.has(k));
  return (
    <div className="flex flex-col gap-1.5" data-lead-groups>
      <span className={LABEL}>Start sending, by ticket type</span>
      <span className={NOTE}>
        Pick the ticket types for each time. Send times are the same for every
        ticket type.
      </span>
      {groups.map((g, i) => {
        // 别的行已挑的：灰、点不了、后面写在哪一行（同 Relay 的「Excalibur - FREDDY」）；这一行已挑的不列。
        const takenBy = new Map<string, number>();
        groups.forEach((o, j) => {
          if (j !== i)
            for (const k of o.ticket_types) takenBy.set(k, o.days_before);
        });
        return (
          <div
            key={i}
            data-lead-row={i}
            className="grid grid-cols-[minmax(0,230px)_minmax(0,1fr)_28px] items-start gap-3.5 border-t border-[#e5e7eb] py-2.5 text-[12.5px] text-[#1a1a1a] max-sm:grid-cols-[minmax(0,1fr)_28px] night:border-white/10 night:text-white/80"
          >
            <div className="flex flex-wrap items-center gap-2 pt-1.5">
              Start sending
              <input
                type="number"
                min={1}
                max={14}
                aria-label={`Days before, time ${i + 1}`}
                value={Number.isFinite(g.days_before) ? g.days_before : ""}
                onChange={(e) =>
                  set(i, { ...g, days_before: e.target.valueAsNumber })
                }
                className={cn(INLINE_INPUT_BASE, "w-[56px] tabular-nums")}
              />
              days before
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 max-sm:col-span-2 max-sm:row-start-2">
              <select
                data-f="addtype"
                aria-label="Add ticket type"
                value=""
                onChange={(e) =>
                  e.target.value &&
                  set(i, {
                    ...g,
                    ticket_types: [...g.ticket_types, e.target.value],
                  })
                }
                className={ADD_TYPE}
                style={{ backgroundImage: ADD_TYPE_CARET }}
              >
                <option value="">Add ticket type</option>
                {all
                  .filter((k) => !g.ticket_types.includes(k))
                  .map((k) => (
                    <option
                      key={k}
                      value={k}
                      disabled={takenBy.has(k)}
                      className={takenBy.has(k) ? undefined : "text-black"}
                    >
                      {nameOf(k)}
                      {takenBy.has(k) ? ` - ${takenBy.get(k)} days before` : ""}
                    </option>
                  ))}
              </select>
              {g.ticket_types.length ? (
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {g.ticket_types.map((k) => (
                    <button
                      key={k}
                      type="button"
                      data-type-chip={k}
                      title="Remove this ticket type"
                      onClick={() =>
                        set(i, {
                          ...g,
                          ticket_types: g.ticket_types.filter((x) => x !== k),
                        })
                      }
                      className={TYPE_CHIP}
                    >
                      {nameOf(k)}{" "}
                      <span aria-hidden className="text-[11px]">
                        ✕
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              aria-label={`Remove time ${i + 1}`}
              title="Remove this time"
              onClick={() => onChange(groups.filter((_, j) => j !== i))}
              className="cursor-pointer border-0 bg-transparent pt-1.5 text-[16px] leading-none text-[#78716c] hover:text-[#1a1a1a] max-sm:col-start-2 max-sm:row-start-1"
            >
              ×
            </button>
          </div>
        );
      })}
      <div>
        <button
          type="button"
          data-add-lead
          disabled={groups.length >= MAX_LEAD_GROUPS}
          title={
            groups.length >= MAX_LEAD_GROUPS
              ? `Up to ${MAX_LEAD_GROUPS} times.`
              : undefined
          }
          onClick={() =>
            onChange([
              ...groups,
              { days_before: defaultDays, ticket_types: [] },
            ])
          }
          className={cn(ADD_BTN, "px-3.5 py-1.5 text-[13px]")}
        >
          + Add another time
        </button>
      </div>
      {types ? (
        <span className={NOTE} data-lead-default>
          {rest.length
            ? `Using the default (${defaultDays} days): ${rest.map(nameOf).join(", ")}.`
            : "Every ticket type has its own time."}
        </span>
      ) : null}
    </div>
  );
}

/** 每日报告：开关点了就存（照卡片抬头的开关，先确认）；收件人跟卡片的 Save 一起存。 */
function DailyReport({
  enabled,
  lastTime,
  emails,
  onEmails,
  onToggle,
}: {
  enabled: boolean;
  lastTime: string | null;
  emails: string[];
  onEmails: (next: string[]) => void;
  onToggle: (next: boolean) => Promise<ActionResult>;
}) {
  return (
    <div
      data-daily-report
      className="flex flex-col gap-2.5 border-t-[0.5px] border-black/[.08] pt-3 night:border-white/10"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn(LABEL, "text-[13px]")}>Daily report</span>
        <EnabledSwitch
          enabled={enabled}
          label="the daily report"
          nextRun={null}
          onToggle={onToggle}
        />
        <span className={NOTE}>Off until you turn it on.</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#1a1a1a] night:text-white/80">
        Sends after the last batch of the day
        {lastTime ? <b className="font-semibold">({clock(lastTime)})</b> : null}
        <span className={NOTE}>
          (One email a day: the orders that were due but not sent, why, and what
          to do. Orders whose Cfm # doesn&apos;t match the product are in it
          too.)
        </span>
      </div>
      <EmailsField
        id="tickets-report"
        label="Send the daily report to"
        values={emails}
        onChange={onEmails}
      />
    </div>
  );
}

// ── G258 / G259（后端 task/auto-send-limits，0f；49 转字段 2026-11-06）──

/** 后端一组最多 20 个时间。 */
const MAX_LEAD_GROUPS = 20;

/**
 * G259 起后端不再用 tickets.summary_time / summary_emails / cfm_alert_emails：
 * 新后端（带 daily_report）时不发回去；旧后端照旧发。
 */
function withoutRetiredKeys(config: AutoSendConfig): AutoSendConfig {
  if (config.tickets.daily_report === undefined) return config;
  const tickets: Record<string, unknown> = { ...config.tickets };
  delete tickets.summary_time;
  delete tickets.summary_emails;
  delete tickets.cfm_alert_emails;
  return { ...config, tickets: tickets as AutoSendConfig["tickets"] };
}

const wholeIn = (v: number, lo: number, hi: number) =>
  Number.isInteger(v) && v >= lo && v <= hi;

/** 存之前先挡（同后端的范围），挡住的写红字，不发请求。 */
function checkTour(d: {
  days_before: number;
  max_per_batch?: number;
}): string | null {
  if (!wholeIn(d.days_before, 1, 14))
    return "Start sending must be a whole number of days from 1 to 14.";
  if (d.max_per_batch !== undefined && !wholeIn(d.max_per_batch, 1, 2000))
    return "Max per batch must be a whole number from 1 to 2000.";
  return null;
}

function checkTickets(d: {
  days_before: number;
  max_per_batch?: number;
  lead_groups?: AutoSendLeadGroup[];
  daily_report_emails?: string[];
}): string | null {
  if (!wholeIn(d.days_before, 1, 14))
    return "Start sending (default) must be a whole number of days from 1 to 14.";
  if (d.lead_groups) {
    if (d.lead_groups.length > MAX_LEAD_GROUPS)
      return `Start sending, by ticket type: up to ${MAX_LEAD_GROUPS} times.`;
    if (d.lead_groups.some((g) => !wholeIn(g.days_before, 1, 14)))
      return "Start sending, by ticket type: days must be a whole number from 1 to 14.";
  }
  if (d.max_per_batch !== undefined && !wholeIn(d.max_per_batch, 1, 2000))
    return "Max per batch must be a whole number from 1 to 2000.";
  if (
    d.daily_report_emails !== undefined &&
    (d.daily_report_emails.length < 1 || d.daily_report_emails.length > 10)
  )
    return "Send the daily report to: add 1 to 10 email addresses.";
  return null;
}

/** 上限挤到下一批的单（tour / tickets 的 summary.deferred）。 */
function deferredText(s: Record<string, unknown>): string {
  const n = num(s.deferred);
  return n ? ` · ${n} left for the next batch` : "";
}

/** 当天最后一批门票的 summary.daily_report = {status, listed, email_failed}；没开 / 不是最后一批 ⇒ 没这个键。 */
function dailyReportText(v: unknown): { text: string; bad?: boolean } | null {
  if (!v || typeof v !== "object") return null;
  const r = v as { status?: unknown; listed?: unknown; email_failed?: unknown };
  const failed = Array.isArray(r.email_failed)
    ? r.email_failed.map(String)
    : [];
  if (r.status === "email_failed")
    return { text: "Daily report could not be emailed", bad: true };
  if (r.status === "already_sent")
    return { text: "Daily report already sent today" };
  const listed = num(r.listed);
  const base = listed
    ? `Daily report emailed (${listed} not sent)`
    : "Daily report emailed (all sent)";
  return failed.length
    ? { text: `${base}; not delivered to ${failed.join(", ")}`, bad: true }
    : { text: base };
}

/**
 * G258：Tour confirmations 两行模板下拉（cutoff 之前 / 之后下的单）。选项读后端 tour_templates；
 * 跟卡片其他格一起暂存，按 Save 才存。cutoff 是 config.tour.last_minute_cutoff（洛杉矶时间，缺省 07:00）。
 */
function TemplatesField({
  options,
  regular,
  lastMinute,
  cutoff,
  onChange,
}: {
  options: AutoSendOption[];
  regular: string;
  lastMinute: string;
  cutoff: string;
  onChange: (next: {
    template_regular?: string;
    template_last_minute?: string;
  }) => void;
}) {
  const select = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
  ) => (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(e) => set(e.target.value)}
      className={cn(INLINE_INPUT_BASE, "w-[200px] max-w-full cursor-pointer")}
    >
      {options.some((o) => o.key === value) ? null : (
        <option value={value}>{value}</option>
      )}
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );
  return (
    <div className="flex flex-col gap-1.5" data-field="tour-templates">
      <span className={LABEL}>Message template</span>
      <div
        data-template-row="regular"
        className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#1a1a1a] night:text-white/80"
      >
        <label htmlFor="tour-template-regular" className="w-[170px]">
          Orders before the cutoff
        </label>
        {select(
          "tour-template-regular",
          "Template for orders before the cutoff",
          regular,
          (v) => onChange({ template_regular: v }),
        )}
        <span className={NOTE}>(Sent at the send times above.)</span>
      </div>
      <div
        data-template-row="last_minute"
        className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#1a1a1a] night:text-white/80"
      >
        <label htmlFor="tour-template-last-minute" className="w-[170px]">
          Orders after the cutoff
        </label>
        {select(
          "tour-template-last-minute",
          "Template for orders after the cutoff",
          lastMinute,
          (v) => onChange({ template_last_minute: v }),
        )}
      </div>
      <p className={cn(NOTE, "m-0")} data-template-note>
        Orders placed after {clock(cutoff)} the day before the tour. Checked
        every hour on the hour; the last check is at 12:00 AM on the tour day.
        SMS and email. Max per batch doesn&apos;t apply. Orders sent by hand are
        not sent again.
      </p>
    </div>
  );
}
