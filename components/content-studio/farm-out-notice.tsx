"use client";

import { useEffect, useRef, useState } from "react";

import { describeError, isStatus } from "@/lib/api-errors";
import { fetchPartners } from "@/lib/farm-out-api";
import { cn } from "@/lib/utils";
import type { FarmOutPartner } from "@/types/farm-out";

import { type FarmOutField, FO_DEFAULTS, foFields, foKey } from "./fields";
import { type Studio, TextFieldCard } from "./studio-cards";

type Tab = "Email" | "SMS";

type Partners =
  | { kind: "loading" }
  | { kind: "ready"; list: FarmOutPartner[]; note: string | null };

const TAB_FIELDS: Record<Tab, FarmOutField[]> = {
  Email: ["email_subject", "email_body"],
  SMS: ["sms_body"],
};

/**
 * Farm out Notice 模块（Annie 2026-10-15 预览同意）：每家合作公司一份，Default + 各家公司的小药丸；
 * 读写走 Content Studio 现成的通用模板接口（键 tmpl__farmout__<slug>__<字段>，只能改已有的键）。
 * 后端还没上线（没有这些键 / 合作公司接口 404）时只写一句安静的说明，不报错。
 */
export function FarmOutNoticePanel({
  studio,
  tab,
  onUnauthorized,
}: {
  studio: Studio;
  tab: Tab;
  onUnauthorized: () => void;
}) {
  const [partners, setPartners] = useState<Partners>({ kind: "loading" });
  const [slug, setSlug] = useState("default");
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    let cancelled = false;
    fetchPartners()
      .then((list) => {
        if (!cancelled)
          setPartners({
            kind: "ready",
            list: list.filter((p) => p.is_active),
            note: null,
          });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isStatus(error, 401)) onUnauthorizedRef.current();
        // 404 = 后端还没上线：只剩 Default。
        setPartners({
          kind: "ready",
          list: [],
          note: isStatus(error, 404)
            ? null
            : `Could not load the partner list: ${describeError(error)}`,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const defaultKeys = (
    ["email_subject", "email_body", "sms_body"] as const
  ).map((f) => foKey("default", f));
  const available = defaultKeys.every((k) => k in studio.saved);

  // Default 还是空的（后端建了键但没写值）：把原文放进编辑框当草稿，点 Save 才生效。
  useEffect(() => {
    if (!available) return;
    for (const f of Object.keys(FO_DEFAULTS) as FarmOutField[]) {
      const k = foKey("default", f);
      if (!studio.savedValue(k) && !studio.draft(k)) {
        studio.setDraft(k, FO_DEFAULTS[f]);
      }
    }
    // 只在模板读进来时补一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  if (partners.kind === "loading") {
    return (
      <div className="py-5 text-[13px] text-[#888] night:text-white/55">
        Loading…
      </div>
    );
  }
  if (!available) {
    return (
      <div className="py-5 text-[13px] text-[#888] night:text-white/55">
        Farm out isn&apos;t available yet
      </div>
    );
  }

  const versions = [
    { slug: "default", name: "Default" },
    ...partners.list.map((p) => ({ slug: p.slug, name: p.name })),
  ];
  const current = versions.find((v) => v.slug === slug) ?? versions[0];
  const fields = TAB_FIELDS[tab];

  /** 这家这个标签页的文字和 Default 完全一样（按已保存的值比）。 */
  const sameAsDefault = (s: string) =>
    fields.every(
      (f) =>
        studio.savedValue(foKey(s, f)) ===
        studio.savedValue(foKey("default", f)),
    );
  const hasKeys = (s: string) =>
    fields.every((f) => foKey(s, f) in studio.saved);

  return (
    <>
      <div className="mb-0.5 text-[14px] font-bold text-[#c07830]">
        Farm out Notice — {tab}
      </div>
      <div className="mb-3 text-[11px] leading-[1.5] text-[#6B5E57] night:text-white/65">
        Select a version to edit. Changes only apply to that partner. New
        partners start with a copy of Default.{" "}
        {tab === "Email"
          ? "The SMS tab has its own text."
          : "Keep it short: the counter shows the length with today’s sample values."}
      </div>
      {partners.note ? (
        <p className="mb-2 text-[11px] text-[#dc2626] night:text-red-300">
          {partners.note}
        </p>
      ) : null}
      <div
        role="group"
        aria-label="Version"
        className="mb-3.5 flex flex-wrap items-start gap-1.5"
      >
        {versions.map((v) => (
          <button
            key={v.slug}
            type="button"
            aria-pressed={current.slug === v.slug}
            onClick={() => {
              setSlug(v.slug);
              studio.setActive(null);
            }}
            className={cn(
              "cursor-pointer rounded-[20px] border px-[11px] py-1 text-[11px] font-medium transition-all",
              current.slug === v.slug
                ? "border-[#915a1e] bg-[#915a1e] text-white"
                : "border-black/15 bg-paper text-[#1a1a1a] hover:border-[#1a1a1a] hover:text-[#1a1a1a] night:border-white/10 night:bg-white/[.04] night:text-white/75 night:hover:border-white/40 night:hover:text-white/90",
            )}
          >
            {v.name}
            {v.slug !== "default" &&
            hasKeys(v.slug) &&
            sameAsDefault(v.slug) ? (
              <span className="font-normal opacity-75"> · same as Default</span>
            ) : null}
          </button>
        ))}
      </div>

      {!hasKeys(current.slug) ? (
        <p className="py-3 text-[13px] text-[#888] night:text-white/55">
          No {tab === "Email" ? "email" : "SMS"} text has been set up for{" "}
          {current.name} yet.
        </p>
      ) : (
        <>
          {current.slug !== "default" ? (
            <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={sameAsDefault(current.slug)}
                title="Fill the boxes below with the Default text (press Save on each card to keep it)"
                onClick={() => {
                  for (const f of fields) {
                    studio.setDraft(
                      foKey(current.slug, f),
                      studio.savedValue(foKey("default", f)),
                    );
                  }
                }}
                className="cursor-pointer rounded-[6px] border border-[#d3d1c7] bg-paper px-3 py-1 text-[11px] font-medium text-[#1a1a1a] hover:enabled:border-[#a8a49b] disabled:cursor-default disabled:opacity-40 night:bg-white/[.04] night:text-white/75"
              >
                Copy from Default
              </button>
              <span className="text-[11px] text-[#6B5E57] night:text-white/55">
                {sameAsDefault(current.slug)
                  ? `Same as Default — edit to give ${current.name} its own wording.`
                  : `${current.name} has its own wording.`}
              </span>
            </div>
          ) : null}
          {foFields(current.slug, tab).map((f) => (
            <TextFieldCard key={f.key} field={f} studio={studio} />
          ))}
        </>
      )}
    </>
  );
}
