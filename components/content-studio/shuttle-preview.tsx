"use client";

import type { ReactNode } from "react";

import type {
  ShuttleProduct,
  ShuttleProductsData,
} from "@/lib/shuttle-products-api";

import {
  isWebLink,
  SHUTTLE_LABEL_KEYS,
  SHUTTLE_SAMPLE,
  shuttleRoutePart,
} from "./fields";
import { sharedField, type ShuttleTab } from "./shuttle-products-panel";
import type { Studio } from "./studio-cards";

/** 变量换成示例数据，换上去的部分标黄（同 preview）。 */
function filled(text: string): ReactNode[] {
  return text.split(/(\{[a-z_]+\})/g).map((part, i) =>
    SHUTTLE_SAMPLE[part] ? (
      <span key={i} className="rounded-[3px] bg-[#fef3c7] px-0.5">
        {SHUTTLE_SAMPLE[part]}
      </span>
    ) : (
      part
    ),
  );
}

const DETAIL_ROWS: [string, string][] = [
  ["📋 Order #", "RZ-50120"],
  ["📅 Date", "October 28, 2026"],
  ["⏰ Pickup Time", "5:30 AM"],
  ["📍 Pickup Spot", "Excalibur Tour Lobby"],
];

function Details({ guests = false }: { guests?: boolean }) {
  const rows = guests
    ? [DETAIL_ROWS[0], ["👥 Guests", "1"] as [string, string], ...DETAIL_ROWS.slice(1)]
    : DETAIL_ROWS;
  return (
    <table className="my-2.5 w-full border-collapse bg-[#f0f5ff] text-[12px]">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className="w-[40%] bg-[#e8f0ff] px-2.5 py-1.5 font-bold text-[#666]">
              {k}
            </td>
            <td className="px-2.5 py-1.5">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Content Studio → Shuttle 右边的 Preview（Q2：打开）：示例数据 + 选中那条线的追加。
 * 只是示意（「Preview only — not actual rendering」），真正的邮件 / 客人页由后端出。
 */
export function ShuttlePreview({
  tab,
  data,
  studio,
  route,
}: {
  tab: ShuttleTab;
  data: ShuttleProductsData;
  studio: Studio;
  route: ShuttleProduct | null;
}) {
  const text = (w: "sms" | "email" | "guest") => {
    const f = sharedField(data, w);
    return f ? studio.draft(f.key) : "";
  };
  const label = (k: keyof typeof SHUTTLE_LABEL_KEYS) => {
    const f = data.shared.text_fields.find(
      (t) => t.key === SHUTTLE_LABEL_KEYS[k],
    );
    return (f ? studio.draft(f.key).trim() : "") || f?.default || "";
  };
  const part = (p: string) => {
    const f = route?.fields.find((x) => shuttleRoutePart(x.key) === p);
    return f ? studio.draft(f.key) : "";
  };
  const lines = part("route_info")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const links = (
    [
      ["maps_url", label("maps"), "📍"],
      ["apple_maps_url", label("apple"), "🗺️"],
    ] as const
  ).filter(([p]) => isWebLink(part(p)));
  const photo = isWebLink(part("location_photo"));
  const hasExtras = lines.length > 0 || links.length > 0 || photo;
  const routeName = route?.product_name ?? "Shuttle";

  const extras = (where: "mail" | "page") =>
    hasExtras ? (
      <div
        data-preview-extras={where}
        className="my-2.5 rounded-[8px] border border-[#f0d77a] bg-[#fffbea] px-3 py-2"
      >
        <b className="mb-1 block text-[12.5px] text-[#5b4500]">
          {label("heading")}
        </b>
        {lines.length ? (
          <ul className="m-0 list-disc pl-[18px] text-[12.5px]">
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        ) : null}
        {where === "mail" ? (
          links.length || photo ? (
            <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-[#1d4ed8] underline">
              {links.map(([p, l]) => (
                <span key={p}>{l}</span>
              ))}
              {photo ? <span>{label("photo")}</span> : null}
            </div>
          ) : null
        ) : (
          <>
            {links.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {links.map(([p, l, icon]) => (
                  <span
                    key={p}
                    className="rounded-[8px] border border-[#cbd5e1] bg-[#f8fafc] px-3 py-1 text-[12px] text-[#1a1a1a]"
                  >
                    {icon} {l}
                  </span>
                ))}
              </div>
            ) : null}
            {photo ? (
              <div className="mt-2 flex h-[90px] items-end rounded-[8px] bg-[linear-gradient(135deg,#d6c3a5,#b98b5e)] px-2 py-1.5 text-[11px] text-white">
                {label("photo")}
              </div>
            ) : null}
          </>
        )}
      </div>
    ) : null;

  const body = (t: string, empty: string) =>
    t.trim() ? (
      <div className="whitespace-pre-wrap text-[#444]">{filled(t)}</div>
    ) : (
      <i className="text-[#bbb]">{empty}</i>
    );

  const mail = (
    <div
      data-preview="email"
      className="rounded-[12px] bg-[#f4f6f8] p-3 font-[Arial,sans-serif] text-[13px] text-[#333]"
    >
      <div className="mb-2.5 rounded-[8px] border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[12px]">
        Subject:{" "}
        <b>
          Shuttle Confirmation — {routeName} — October 28, 2026 [RZ-50120]
        </b>
      </div>
      <div className="rounded-t-[10px] bg-[#1a3a5c] p-4 text-center font-bold text-white">
        National Park Express
      </div>
      <div className="bg-white px-4 py-3.5">
        <h4 className="m-0 mb-0.5 text-[16px] text-[#1a3a5c]">
          Shuttle Confirmation
        </h4>
        <p className="m-0 mb-2.5 text-[12px] text-[#7f9cbc]">{routeName}</p>
        <p className="m-0 mb-2">
          Hi <b>Dev</b>,
        </p>
        {body(text("email"), "(empty)")}
        <Details guests />
        {extras("mail")}
        <div className="mt-3 mb-1 text-center">
          <span className="inline-block rounded-[8px] bg-[#1a3a5c] px-6 py-2 font-bold text-white">
            ✅ Confirm My Shuttle
          </span>
        </div>
      </div>
      <div className="rounded-b-[10px] bg-[#f0f0f0] p-2.5 text-center text-[11px] text-[#999]">
        National Park Express — Thank you for choosing us! 🏞️
      </div>
    </div>
  );

  const page = (
    <div
      data-preview="guest"
      className="rounded-[12px] bg-white px-4 py-3.5 font-[Arial,sans-serif] text-[13px] text-[#333]"
    >
      <div className="mb-2.5 rounded-[8px] bg-[#dcfce7] px-3 py-2 font-bold text-[#166534]">
        ✅ Thank you, your shuttle is confirmed.
      </div>
      <Details />
      {body(text("guest"), "(empty: shuttle confirmations are on hold)")}
      {extras("page")}
      <p className="mt-2.5 mb-1 font-bold">
        📝 Notes <span className="font-normal text-[#999]">(optional)</span>
      </p>
      <div className="min-h-[52px] rounded-[8px] border border-[#ddd] p-2.5 text-[#aaa]">
        Special requests, questions…
      </div>
    </div>
  );

  const sms = (
    <div
      data-preview="sms"
      className="mx-auto w-full max-w-[260px] rounded-[14px] bg-[#1a1a2e] px-3 py-[18px]"
    >
      <div className="min-h-[160px] rounded-[10px] bg-[#f2f2f7] px-2.5 py-3">
        <div className="mb-2 text-center text-[10px] text-[#1a1a1a]">
          National Park Express
        </div>
        <div className="rounded-[14px_14px_14px_4px] bg-[#e5e5ea] px-3 py-[9px] text-[12px] leading-[1.6] [overflow-wrap:anywhere] whitespace-pre-wrap text-[#1a1a1a]">
          {text("sms").trim() ? filled(text("sms")) : <i>(empty)</i>}
        </div>
      </div>
    </div>
  );

  const short = route?.product_name ?? "—";
  return (
    <aside className="flex flex-col gap-2.5">
      <p className="text-[11px] font-semibold text-[#1a1a1a] night:text-white/65">
        {tab === "Routes"
          ? "Route extras"
          : tab === "SMS"
            ? "SMS body"
            : tab === "Guest Page"
              ? "Guest page"
              : "Email"}{" "}
        · sample route: {short}
      </p>
      {tab === "SMS" ? sms : null}
      {tab === "Email" ? mail : null}
      {tab === "Guest Page" ? page : null}
      {tab === "Routes" ? (
        <>
          {hasExtras ? null : (
            <p className="text-[11.5px] text-[#888] italic night:text-white/50">
              All boxes are empty: guests get the shared text only. Nothing is
              held.
            </p>
          )}
          {mail}
          {page}
        </>
      ) : null}
      <p className="text-[11px] text-[#1a1a1a] night:text-white/50">
        Variables are filled with sample data (Dev, October 28, 2026, Excalibur
        Tour Lobby, …).
      </p>
    </aside>
  );
}
