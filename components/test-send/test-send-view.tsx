"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  inputClass,
  LIGHT_BUTTON,
  PREVIEW_CARD,
  previewHeaderClass,
  RESULT_CARD,
  RESULT_SUMMARY,
  ResultStat,
  SEND_ICON,
  sendButtonClass,
  SendErrorText,
  SendHowTo,
  TABLE,
  TABLE_WRAP,
  TD,
  TH,
  TR,
} from "@/components/tickets-send/legacy-ui";
import { Panel } from "@/components/ui/panel";
import { usePhoneInfo } from "@/components/ui/phone";
import { describeError, isStatus } from "@/lib/api-errors";
import { laToday, shiftYmd } from "@/lib/la-date";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";
import {
  fetchTestSendOptions,
  previewTestSend,
  sendTestSend,
} from "@/lib/test-send-api";
import { cn } from "@/lib/utils";
import { ApiError } from "@/types";
import type {
  TestSendChannel,
  TestSendChannelResult,
  TestSendOptions,
  TestSendPreview,
  TestSendResult,
} from "@/types/test-send";

/**
 * Settings › Test send（Annie 2026-11-18 原话「我要新增加一个做测试订单的功能，就做很简单的……收件人默认是登陆人，发送默认sms和email」；
 * 样稿 https://claude.ai/artifact/TQtiH36e5qQvGHUBLJrL5j ，Annie「1A 2A 3A 4A 5A，How to use 照用，动手」）：
 * 放在 Settings 里 Content Studio 下面；不必先 Preview；Preview 白键、Send 照发送页统一的蓝 btn-send；不留 Last sent；手机能用。
 * 结果照发送页统一的 Send Results 卡（legacy-ui）。后端 8e a88e43f6：只有 admin / Super Admin。
 */

const CHANNEL_LABEL: Record<TestSendChannel, string> = {
  sms: "SMS",
  email: "Email",
};

const LABEL = "grid gap-1 text-[12px] font-semibold text-[#1a1a1a]";

/** 发出去以后断了线：可能已经发了（同发送页的 maybe-sent，测试只发给自己，一句话就够）。 */
const MAYBE_SENT =
  "The page lost contact with the server. The test may have been sent. Check your phone and email before you send again.";

export function TestSendView() {
  const [options, setOptions] = useState<TestSendOptions | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [moduleKey, setModuleKey] = useState("");
  const [choice, setChoice] = useState("");
  const [date, setDate] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [channels, setChannels] = useState<TestSendChannel[]>([]);

  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TestSendPreview | null>(null);
  const [result, setResult] = useState<{
    sent: TestSendResult;
    phone: string;
    email: string;
    title: string;
  } | null>(null);

  const info = usePhoneInfo("About this page");
  const redirectingRef = useRef(false);
  const toLogin = useCallback(() => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
  }, []);

  useEffect(() => {
    // 默认明天（洛杉矶）：测的多半是明天的团。
    setDate(shiftYmd(laToday(), 1));
    const ac = new AbortController();
    fetchTestSendOptions(ac.signal)
      .then((o) => {
        setOptions(o);
        setPhone(o.recipient.phone ?? "");
        setEmail(o.recipient.email ?? "");
        const first = o.modules[0];
        if (first) {
          setModuleKey(first.key);
          setChannels([...first.channels]);
        }
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        if (isStatus(e, 401)) toLogin();
        else if (isStatus(e, 403)) setForbidden(true);
        else setLoadErr(describeError(e));
      });
    return () => ac.abort();
  }, [toLogin]);

  const mod = useMemo(
    () => options?.modules.find((m) => m.key === moduleKey) ?? null,
    [options, moduleKey],
  );

  /** 每换一次要发什么就加 1：还在路上的旧 Preview 回来时对不上，丢掉（不把旧预览贴回来）。 */
  const targetRef = useRef(0);

  /** 换了要发什么（模块 / 选项 / 日期）：旧的预览、结果、报错都不再对得上，清掉。 */
  function resetOutput() {
    targetRef.current += 1;
    setPreview(null);
    setResult(null);
    setError(null);
  }

  function pickModule(key: string) {
    setModuleKey(key);
    setChoice("");
    const m = options?.modules.find((x) => x.key === key);
    setChannels(m ? [...m.channels] : []);
    resetOutput();
  }

  function toggleChannel(c: TestSendChannel, on: boolean) {
    setChannels((prev) =>
      on ? [...new Set([...prev, c])] : prev.filter((x) => x !== c),
    );
    setError(null);
  }

  const target = { module: moduleKey, choice, date };
  const choiceText =
    mod?.choices.find((c) => c.value === choice)?.label ?? "";
  const title = [mod?.label, choiceText, date].filter(Boolean).join(" · ");

  async function doPreview() {
    if (busy) return;
    setBusy("preview");
    setError(null);
    const asked = targetRef.current;
    try {
      const p = await previewTestSend(target);
      if (asked === targetRef.current) setPreview(p);
    } catch (e) {
      if (isStatus(e, 401)) return toLogin();
      if (asked !== targetRef.current) return;
      setPreview(null);
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  async function doSend() {
    if (busy) return;
    setBusy("send");
    setError(null);
    setResult(null);
    const to = { phone: phone.trim(), email: email.trim() };
    // 只发勾了的渠道，顺序固定 SMS 在前。
    const picked = (["sms", "email"] as const).filter((c) =>
      channels.includes(c),
    );
    try {
      const sent = await sendTestSend({ ...target, ...to, channels: picked });
      setResult({ sent, ...to, title });
    } catch (e) {
      if (isStatus(e, 401)) return toLogin();
      // 422 / 403 是服务器在发之前就拒了，原文照显示；别的错误（断线、500）可能已经发了。
      setError(
        e instanceof ApiError && e.status < 500 ? describeError(e) : MAYBE_SENT,
      );
    } finally {
      setBusy(null);
    }
  }

  if (forbidden) {
    return (
      <main className="text-stone-800 night:text-white/90">
        <Panel>
          <p className="font-medium">Only Admins can use Test send.</p>
        </Panel>
      </main>
    );
  }
  if (!options) {
    return (
      <main className="text-stone-800 night:text-white/90">
        <Panel>
          {loadErr ? (
            <span role="alert" className="text-[#A32D2D]">
              {loadErr}
            </span>
          ) : (
            "Loading…"
          )}
        </Panel>
      </main>
    );
  }

  const theme = "blue" as const;
  const field = cn(inputClass(theme), "w-full min-w-0");

  return (
    <main className="text-stone-800 night:text-white/90" data-test-send>
      <h2 className="sr-only">Test send</h2>

      <section className={PREVIEW_CARD} data-ts-form>
        <div className={previewHeaderClass(theme)}>
          <h3 className="text-[13.5px] font-semibold text-[#185FA5]">
            Test send
            {info.button}
          </h3>
          <span
            className={cn("text-[12px] text-[#1a1a1a]", info.hide)}
            data-ts-intro
          >
            Sends one sample message to you. No order is made.
          </span>
        </div>
        <div className="grid gap-3 px-4 py-3.5 max-sm:px-3">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 max-sm:grid-cols-1">
            <label className={LABEL}>
              Module
              <select
                id="ts-module"
                data-ts="module"
                className={field}
                value={moduleKey}
                onChange={(e) => pickModule(e.target.value)}
              >
                {options.modules.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            {mod?.choice_label ? (
              <label className={LABEL}>
                {mod.choice_label}
                <select
                  id="ts-choice"
                  data-ts="choice"
                  className={field}
                  value={choice}
                  onChange={(e) => {
                    setChoice(e.target.value);
                    resetOutput();
                  }}
                >
                  <option value="">
                    Pick a {mod.choice_label.toLowerCase()}…
                  </option>
                  {mod.choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className={LABEL}>
              {mod?.date_label || "Date"}
              <input
                id="ts-date"
                data-ts="date"
                type="date"
                className={field}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  resetOutput();
                }}
              />
            </label>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 max-sm:grid-cols-1">
            <label className={LABEL}>
              Phone
              <input
                id="ts-phone"
                data-ts="phone"
                type="tel"
                autoComplete="off"
                className={field}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setError(null);
                }}
              />
              <span className="text-[11px] font-normal text-[#555]">
                Starts with yours. Change it to send to someone else.
              </span>
            </label>
            <label className={LABEL}>
              Email
              <input
                id="ts-email"
                data-ts="email"
                type="email"
                autoComplete="off"
                className={field}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {(mod?.channels ?? []).map((c) => (
              <label
                key={c}
                className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-[#1a1a1a]"
              >
                <input
                  type="checkbox"
                  data-ts-channel={c}
                  className="h-4 w-4 cursor-pointer accent-[#185FA5]"
                  checked={channels.includes(c)}
                  onChange={(e) => toggleChannel(c, e.target.checked)}
                />
                {CHANNEL_LABEL[c]}
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              data-ts-preview
              className={LIGHT_BUTTON}
              disabled={!!busy}
              onClick={() => void doPreview()}
            >
              {busy === "preview" ? "Loading…" : "Preview"}
            </button>
            <button
              type="button"
              data-ts-send
              className={sendButtonClass(theme)}
              disabled={!!busy}
              onClick={() => void doSend()}
            >
              {SEND_ICON.combined} {busy === "send" ? "Sending…" : "Send test"}
            </button>
            {error ? (
              <span data-ts-error>
                <SendErrorText>{error}</SendErrorText>
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {preview ? <PreviewCard preview={preview} title={title} /> : null}

      {result ? (
        <ResultCard
          title={result.title}
          result={result.sent}
          phone={result.phone}
          email={result.email}
          onAgain={() => setResult(null)}
        />
      ) : null}

      <SendHowTo tone="blue" title="How to use — Test send">
        <li>
          Pick a Module. They are the same as in Content Studio: Tour
          Confirmation, Last Minute, Shuttle, Tickets Reminder, Morning Pickup,
          Farm out guest notice and Broadcasting.
        </li>
        <li>
          Pick a Tour type (Product for Shuttle, Partner for Farm out guest
          notice, Template for Broadcasting). Morning Pickup has no list.
        </li>
        <li>
          Pick a date. The message uses this date and a sample guest. No order
          is made.
        </li>
        <li>
          Phone and Email start with your own. Change them to send the test to
          someone else.
        </li>
        <li>
          SMS and Email are both ticked. Untick one to send only the other.
        </li>
        <li>
          Click Preview to see the text exactly as a guest gets it. Click Send
          test to send it.
        </li>
        <li>
          Send Results shows each channel: Sent in green, Failed in red with
          the reason. If one fails, the other is still sent.
        </li>
        <li>
          Links in the message open a sample guest page, not a real order.
        </li>
        <li>
          Every test send is kept in the Action Log. Only Admins and Super
          Admins can open this page.
        </li>
      </SendHowTo>
    </main>
  );
}

function PreviewCard({
  preview,
  title,
}: {
  preview: TestSendPreview;
  title: string;
}) {
  return (
    <section className={PREVIEW_CARD} data-ts-preview-card>
      <div className={previewHeaderClass("blue")}>
        <h3 className="text-[13.5px] font-semibold text-[#185FA5]">Preview</h3>
        <span className="text-[12px] text-[#1a1a1a]">{title}</span>
      </div>
      <div className="grid gap-3 px-4 py-3.5 text-[#1a1a1a] max-sm:px-3">
        <div className="grid gap-3.5 md:grid-cols-[1fr_1.4fr]">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-bold tracking-[.03em] uppercase">
              SMS
            </p>
            {preview.sms !== null ? (
              <>
                <p
                  data-ts-sms
                  className="rounded-[14px] bg-[#f2f3f5] px-3 py-2.5 text-[12.5px] leading-[1.5] break-words whitespace-pre-wrap"
                >
                  {preview.sms}
                </p>
                <p className="mt-1 text-[11.5px] text-[#555] tabular-nums">
                  {preview.sms.length} characters
                </p>
              </>
            ) : (
              <p data-ts-sms-none className="text-[12px] text-[#555]">
                This module has no text message.
              </p>
            )}
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-bold tracking-[.03em] uppercase">
              Email
              {preview.email_subject ? (
                <span
                  data-ts-subject
                  className="font-normal tracking-normal normal-case"
                >
                  {" "}
                  · Subject: {preview.email_subject}
                </span>
              ) : null}
            </p>
            {preview.email_html ? (
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={preview.email_html}
                data-ts-email
                className="h-[320px] w-full rounded-lg border border-black/10 bg-paper max-sm:h-[260px]"
              />
            ) : (
              <p data-ts-email-none className="text-[12px] text-[#555]">
                This module has no email.
              </p>
            )}
          </div>
        </div>
        {preview.sample_note ? (
          <p data-ts-note className="text-[11.5px] text-[#555]">
            {preview.sample_note}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ResultCard({
  title,
  result,
  phone,
  email,
  onAgain,
}: {
  title: string;
  result: TestSendResult;
  phone: string;
  email: string;
  onAgain: () => void;
}) {
  const rows = (["sms", "email"] as const)
    .map((c) => ({ c, r: result[c] }))
    .filter((x): x is { c: TestSendChannel; r: TestSendChannelResult } =>
      Boolean(x.r),
    );
  const sent = rows.filter((x) => x.r.ok).length;
  const failed = rows.length - sent;
  const both = rows.map((x) => CHANNEL_LABEL[x.c]).join(" + ");
  return (
    <section className={RESULT_CARD} data-ts-result>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-[#1a1a1a]">
          📬 Send Results
        </h2>
        <span className="text-[12px] text-[#1a1a1a]">
          {title}
          {both ? ` · ${both}` : ""}
        </span>
      </div>
      <div className={RESULT_SUMMARY}>
        <ResultStat label="Sent" value={sent} className="text-[#3B6D11]" />
        <ResultStat label="Failed" value={failed} className="text-[#A32D2D]" />
      </div>
      <div className={TABLE_WRAP}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Channel</th>
              <th className={TH}>To</th>
              <th className={TH}>Status</th>
              <th className={TH}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, r }) => (
              <tr key={c} className={TR} data-ts-row={c}>
                <td className={TD}>{CHANNEL_LABEL[c]}</td>
                <td className={TD}>{c === "sms" ? phone : email}</td>
                <td
                  className={cn(
                    TD,
                    "font-semibold",
                    r.ok ? "text-[#3B6D11]" : "text-[#A32D2D]",
                  )}
                  data-ts-status
                >
                  {r.ok ? "Sent" : "Failed"}
                </td>
                <td
                  className={cn(TD, "whitespace-normal text-[#A32D2D]")}
                  data-ts-detail
                >
                  {r.ok ? "" : r.error}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4">
        <button type="button" className={LIGHT_BUTTON} onClick={onAgain}>
          ↩ Send another
        </button>
      </div>
    </section>
  );
}
