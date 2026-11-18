"use client";

import {
  badCharCount,
  badCharsHead,
  canMakePlain,
  explainSmsChars,
  isSmsChar,
  SMS_CHAR_LIMIT,
  showSmsChar,
  tooLongText,
} from "@/lib/sms-limit";
import { cn } from "@/lib/utils";

/**
 * SMS 灰掉时输入框下面那块（Annie 2026-11-17「同意全部推荐，动手」，样稿 KnNXFz77T9jQerCUYBMrNz v2 题 1 A / 1b A）：
 * 有坏字 ⇒ 第一句 + 照抄一份消息（坏字淡红底红字）+ 每种字一句原因 + 「Replace with plain characters」（有能换的才出）；
 * 超字数 ⇒ 超了多少、为什么有限制；tail = 没邮箱客人的那行。三个入口共用，原文都在 lib/sms-limit.ts。
 */
export function SmsProblem({
  typed,
  length,
  bad,
  counted,
  noEmail = false,
  tail,
  onReplace,
  dark = false,
}: {
  /** staff 写的原文（照抄、标红用这个）。 */
  typed: string;
  /** 计费字数（群发 / Main manifest 是展开名字、签名后的）。 */
  length: number;
  bad: readonly string[];
  counted?: string;
  noEmail?: boolean;
  tail?: string | null;
  onReplace?: () => void;
  /** 深色弹窗（Tickets 群发、Morning 对话框）。 */
  dark?: boolean;
}) {
  const long = length > SMS_CHAR_LIMIT;
  if (!bad.length && !long) return null;
  const mark = dark
    ? "rounded-[3px] bg-red-400/25 px-0.5 font-bold text-red-200 outline outline-1 outline-red-300/60"
    : "rounded-[3px] bg-[#fbd5d1] px-0.5 font-bold text-[#9b1c1c] outline outline-1 outline-[#e8a39b]";
  return (
    <div
      role="alert"
      data-sms-problem
      className={cn(
        "mt-1 text-[12px] leading-[1.45] font-semibold",
        dark ? "text-red-300" : "text-[#c0392b]",
      )}
    >
      {bad.length ? (
        <>
          <p data-sms-bad-head>{badCharsHead(badCharCount(typed), noEmail)}</p>
          <div
            data-sms-mirror
            className={cn(
              "mt-1 max-h-[110px] overflow-auto rounded-md border px-2 py-1.5 text-[12.5px] leading-[1.55] font-normal [overflow-wrap:anywhere] whitespace-pre-wrap",
              dark
                ? "border-red-300/30 bg-white/[.06] text-white"
                : "border-[#f1c0bb] bg-white text-[#1a1a1a]",
            )}
          >
            {Array.from(typed).map((ch, i) =>
              isSmsChar(ch) ? (
                ch
              ) : (
                <mark key={i} data-sms-bad-char className={mark}>
                  {showSmsChar(ch)}
                </mark>
              ),
            )}
          </div>
          <ul className="mt-1 list-disc pl-[18px] font-normal">
            {explainSmsChars(bad).map((l) => (
              <li key={l.chars.join("")} data-sms-why-line>
                {l.chars.map((c, i) => (
                  <span key={c}>
                    {i ? " " : null}
                    <code className={cn("font-mono", mark)}>
                      {showSmsChar(c)}
                    </code>
                  </span>
                ))}{" "}
                {l.text}
              </li>
            ))}
          </ul>
          {onReplace && canMakePlain(bad) ? (
            <button
              type="button"
              data-sms-replace
              onClick={onReplace}
              className={cn(
                "mt-1.5 cursor-pointer rounded-md border px-2.5 py-1 text-[12px] font-semibold",
                dark
                  ? "border-red-300 bg-transparent text-red-200"
                  : "border-[#c0392b] bg-white text-[#c0392b]",
              )}
            >
              Replace with plain characters
            </button>
          ) : null}
        </>
      ) : null}
      {long ? (
        <p data-sms-too-long className={bad.length ? "mt-1.5" : undefined}>
          {tooLongText(length, counted, noEmail)}
        </p>
      ) : null}
      {tail ? <p className="mt-1">{tail}</p> : null}
    </div>
  );
}
