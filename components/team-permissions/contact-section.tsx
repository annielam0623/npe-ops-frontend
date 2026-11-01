"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Edit 框 / Add person 最上面的「Contact」：Email + Mobile（staff 联络方式，Annie 2026-10-29「4项全部动手」，
 * preview https://claude.ai/artifact/83D67jt2oNb5V1TPkteEt9 Q1–Q7 全按推荐）。
 * 都不必填；格式不对红字写在格子下面、Save 灰（由父组件看 {@link contactErrors}）；email 和别人重了是后端说，
 * 父组件把它放进 `serverError`。关联了 HR 的 driver / guide：Mobile 显示 HR 的号、这里改不了（Q3 A）。
 */
export interface ContactDraft {
  email: string;
  phone: string;
}

export const EMPTY_CONTACT: ContactDraft = { email: "", phone: "" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 10 位（美国号，括号 / 空格 / - / . 随便写），或者 + 国家码开头 8–15 位。 */
export function phoneLooksRight(raw: string): boolean {
  const text = raw.trim();
  const digits = text.replace(/\D/g, "");
  if (!/^[+\d\s().-]+$/.test(text)) return false;
  if (text.startsWith("+")) return digits.length >= 8 && digits.length <= 15;
  return digits.length === 10 || (digits.length === 11 && digits[0] === "1");
}

export const EMAIL_WRONG = "Email address looks wrong.";
export const PHONE_WRONG =
  "Phone number looks wrong. Use 10 digits, or + and the country code.";

/** 格式错（空的不算错）。 */
export function contactErrors(
  c: ContactDraft,
  phoneLocked: boolean,
): { email?: string; phone?: string } {
  const out: { email?: string; phone?: string } = {};
  if (c.email.trim() && !EMAIL_RE.test(c.email.trim())) out.email = EMAIL_WRONG;
  if (!phoneLocked && c.phone.trim() && !phoneLooksRight(c.phone))
    out.phone = PHONE_WRONG;
  return out;
}

const SECTION_TITLE =
  "m-0 text-[14px] font-bold text-[#1a1a1a] night:text-white/90";
const LABEL = "mb-1 block text-[12.5px] text-[#374151]";
const INPUT =
  "box-border w-full rounded-[8px] border border-[#ddd] bg-paper px-3 py-2 text-[14px] text-black focus:border-[#1f4e79] focus:outline-none";
const BAD = "border-[#dc2626] bg-[#fef2f2]";
const ERR = "mt-1 block text-[12px] text-[#b91c1c]";

export function ContactSection({
  value,
  onChange,
  hrPhone,
  serverError,
  optional,
  disabled,
}: {
  value: ContactDraft;
  onChange: (next: ContactDraft) => void;
  /** 有 HR 档案的 driver / guide：HR 里的号（只显示）。没有 = undefined。 */
  hrPhone?: string | null;
  /** 后端说的错（例如 email 重了），写在那一格下面。 */
  serverError?: { field: "email" | "phone"; message: string } | null;
  /** Add person：标题旁写 Optional。 */
  optional?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const locked = hrPhone !== undefined && hrPhone !== null;
  // 打字时不马上标红：离开格子（或已有错的值）才显示。
  const [touched, setTouched] = useState({ email: false, phone: false });
  const errs = contactErrors(value, locked);
  const emailErr =
    (touched.email && errs.email) ||
    (serverError?.field === "email" ? serverError.message : null);
  const phoneErr =
    (touched.phone && errs.phone) ||
    (serverError?.field === "phone" ? serverError.message : null);
  return (
    <section data-contact>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2.5">
        <h3 className={SECTION_TITLE}>Contact</h3>
        <span className="text-[12px] text-[#4b5563]">
          {optional ? "Optional" : "Used for notifications and to reach them"}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-3 gap-y-2.5">
        <div>
          <label htmlFor={`${id}-email`} className={LABEL}>
            Email
          </label>
          <input
            id={`${id}-email`}
            type="email"
            autoComplete="off"
            placeholder="name@example.com"
            value={value.email}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, email: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            aria-invalid={emailErr ? true : undefined}
            className={cn(INPUT, emailErr && BAD)}
          />
          {emailErr ? (
            <span role="alert" data-contact-error="email" className={ERR}>
              {emailErr}
            </span>
          ) : null}
        </div>
        <div>
          <label htmlFor={`${id}-phone`} className={LABEL}>
            Mobile
          </label>
          {locked ? (
            <>
              <input
                id={`${id}-phone`}
                type="tel"
                readOnly
                value={hrPhone ?? ""}
                className={cn(INPUT, "bg-[#f3f4f6] text-[#374151]")}
              />
              <span className="mt-1 block text-[11.5px] text-[#6b7280]">
                From Human Resource.{" "}
                <Link
                  href="/settings/hr"
                  className="text-[#1f4e79] underline"
                  data-hr-link
                >
                  Edit in Human Resource →
                </Link>
              </span>
            </>
          ) : (
            <>
              <input
                id={`${id}-phone`}
                type="tel"
                autoComplete="off"
                placeholder="(702) 555-0100"
                value={value.phone}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, phone: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                aria-invalid={phoneErr ? true : undefined}
                className={cn(INPUT, phoneErr && BAD)}
              />
              {phoneErr ? (
                <span role="alert" data-contact-error="phone" className={ERR}>
                  {phoneErr}
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
