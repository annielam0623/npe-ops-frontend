"use client";

import { type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";
import type {
  LiveGuideRun,
  LiveInboxThread,
  LiveManifest,
  LivePerson,
  LiveRelayGuest,
  LiveSegment,
  LiveTourGuest,
} from "@/types";

import { formatMarkTime } from "./config";

/**
 * Live drivers 页签（司机实时页，Annie 2026-11-02「把各个司机的手机页面都显示出来，并列在页面上」，preview
 * TwJJ32NCdbTEnqxQcCX6MN 第 3 版「其他都同意推荐，动手」）：一人一列，每列就是他手机上的司机页 / 导游页
 * （driver_home.html / guide_home.html 照搬，后端给同一份数据），只读——Picked up / Boarded / No show 照画、灰掉，
 * 标了的那个保持绿 / 红，后面写几点标的（④ A）。Call 灰掉；Text 能点：打开 Tracking 的回复框回客人（⑨）。
 */

/** 回复客人：按单号打开回复框（view 用 Tracking 那一行的 id / 电话 / 邮箱）。 */
export type OpenGuest = (orderNumber: string, guestName: string) => void;

interface Marks {
  pax: number;
  done: number;
  noShow: number;
  notMarked: number;
  /** relay 段写 picked up，团车写 boarded。 */
  word: string;
}

function relayName(g: LiveRelayGuest): string {
  return `${g.first_name ?? ""} ${g.last_name ?? ""}`.trim();
}

function tourGuests(m: LiveManifest | null | undefined): LiveTourGuest[] {
  return (m?.blocks ?? []).flatMap((b) => b.guests);
}

/** 这一列页面上能标的客人：relay 段 + 有名单的团车（有单独导游的团车司机页只有数字，不算）。 */
export function marksOf(p: LivePerson): Marks {
  let pax = 0;
  let done = 0;
  let noShow = 0;
  let relay = false;
  const add = (n: number, s: string | null | undefined) => {
    pax += n;
    if (s === "no_show") noShow += n;
    else if (s) done += n;
  };
  for (const seg of p.segments ?? []) {
    for (const b of seg.relay_blocks ?? []) {
      relay = true;
      for (const g of b.guests) add(g.pax, g.relay_status);
    }
    if (!seg.tour_compact)
      for (const g of tourGuests(seg.manifest)) add(g.pax, g.boarding);
  }
  for (const run of p.runs ?? [])
    for (const g of tourGuests(run.manifest)) add(g.pax, g.boarding);
  return {
    pax,
    done,
    noShow,
    notMarked: pax - done - noShow,
    word: relay ? "picked up" : "boarded",
  };
}

/** 列头：每段一行「车 · 哪一趟 · 时间」。 */
function vehicleLines(p: LivePerson): string[] {
  if (p.kind === "guide")
    return (p.runs ?? []).map((r) =>
      [r.van, r.bus_label ? `Bus ${r.bus_label}` : "", r.tour]
        .filter(Boolean)
        .join(" · "),
    );
  return (p.segments ?? []).map((s) =>
    [s.van, s.kind, s.title, s.when].filter(Boolean).join(" · "),
  );
}

export function LiveDriversBoard({
  people,
  search,
  onOpenGuest,
}: {
  people: LivePerson[];
  search: string;
  onOpenGuest: OpenGuest;
}) {
  if (!people.length)
    return (
      <p className="rounded-[12px] border border-white/[.08] bg-[#1a2f4a] p-7 text-center text-[13px] text-[#4a6a8a]">
        No drivers or guides scheduled for this date.
      </p>
    );
  const q = search.trim().toLowerCase();
  return (
    <div
      data-live-board
      className="flex items-start gap-3.5 overflow-x-auto pb-2 max-sm:flex-col max-sm:items-stretch max-sm:overflow-visible"
    >
      {people.map((p) => (
        <PersonColumn
          key={`${p.kind}-${p.hr_id}`}
          person={p}
          search={q}
          onOpenGuest={onOpenGuest}
        />
      ))}
    </div>
  );
}

function PersonColumn({
  person,
  search,
  onOpenGuest,
}: {
  person: LivePerson;
  search: string;
  onOpenGuest: OpenGuest;
}) {
  const [tab, setTab] = useState<"routes" | "messages">("routes");
  const k = marksOf(person);
  const guide = person.kind === "guide";
  const first = person.name.split(/\s+/)[0] || person.name;
  const unread = person.inbox?.unread_total ?? 0;
  return (
    <section
      data-live-person={`${person.kind}-${person.hr_id}`}
      className="w-[360px] shrink-0 overflow-hidden rounded-2xl border border-white/20 bg-[#06101c] text-[#f8fafc] max-sm:w-full"
    >
      <header className="border-b border-sky-400/40 bg-[#0f2744] px-3 py-2">
        <div className="text-[14.5px] font-bold">
          {person.name}
          {guide ? " — guide" : ""}
        </div>
        {vehicleLines(person).map((line, i) => (
          <div key={i} className="text-[12px] text-[#b8c2d6]">
            {line}
          </div>
        ))}
        {k.pax ? (
          <div data-live-counts className="mt-0.5 text-[12px] text-[#cbd5e1]">
            {k.done} {k.word} ·{" "}
            <span className={cn(k.noShow && "font-bold text-[#fca5a5]")}>
              {k.noShow} no show
            </span>{" "}
            · {k.notMarked} not marked · {k.pax} pax
          </div>
        ) : null}
      </header>
      <div className="max-h-[760px] overflow-y-auto max-sm:max-h-none">
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[.02] px-3.5 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[18px] font-black tracking-[-.05em]">
              NPE
            </span>
            <span className="text-[10px] font-bold tracking-[.09em] text-sky-400 uppercase">
              {guide ? "Guide" : "Driver"}
            </span>
          </div>
        </div>
        <div className="px-3 pt-3.5 pb-4">
          <h3 className="text-[20px] font-bold tracking-[-.02em]">
            {guide ? "Hello" : "Good morning"}, {first}
          </h3>
          {person.error ? (
            <p className="mt-3 rounded-lg bg-red-500/15 px-3 py-2 text-[12.5px] text-red-300">
              Could not load this page. Try ↻ Refresh, or call the driver.
            </p>
          ) : guide ? (
            <GuidePage
              runs={person.runs ?? []}
              search={search}
              onOpenGuest={onOpenGuest}
            />
          ) : (
            <>
              <div className="my-2.5 flex gap-2">
                {(["routes", "messages"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    data-live-tab={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "flex min-h-[38px] flex-1 cursor-pointer items-center justify-center rounded-[10px] border text-[13px] font-semibold",
                      tab === t
                        ? "border-sky-400/50 bg-[#0f2744] text-white"
                        : "border-white/15 text-[#94a3b8]",
                    )}
                  >
                    {t === "routes" ? "Routes" : "Messages"}
                    {t === "messages" && unread ? (
                      <b className="ml-1.5 inline-block h-[18px] min-w-[18px] rounded-[9px] bg-red-500 px-1 text-center text-[11px] leading-[18px] text-white">
                        {unread}
                      </b>
                    ) : null}
                  </button>
                ))}
              </div>
              {tab === "routes" ? (
                <DriverRoutes
                  segments={person.segments ?? []}
                  search={search}
                  onOpenGuest={onOpenGuest}
                  inbox={person.inbox?.threads ?? []}
                />
              ) : (
                <Inbox
                  threads={person.inbox?.threads ?? []}
                  onOpenGuest={onOpenGuest}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ── 司机页 ───────────────────────────────────────────────────────────────────

function DriverRoutes({
  segments,
  search,
  onOpenGuest,
  inbox,
}: {
  segments: LiveSegment[];
  search: string;
  onOpenGuest: OpenGuest;
  inbox: LiveInboxThread[];
}) {
  if (!segments.length)
    return (
      <p className="mt-6 rounded-[14px] border border-dashed border-white/15 p-6 text-center text-[14px] font-semibold">
        Nothing scheduled today
      </p>
    );
  const multi = segments.length > 1;
  const unreadByOrder = new Map(inbox.map((t) => [t.order_number, t]));
  return (
    <div className="flex flex-col gap-2.5">
      {segments.map((seg) => (
        <div
          key={seg.id}
          className={cn(
            !(seg.manifest?.blocks?.length || seg.tour_compact) &&
              "overflow-hidden rounded-xl border border-white/10 bg-[#1a2f4a]",
          )}
        >
          {multi || seg.tour_unset ? (
            <div className="flex flex-wrap items-baseline gap-2 px-3.5 pt-2.5 pb-2">
              {seg.kind ? (
                <span className="text-[9.5px] font-bold tracking-[.09em] text-[#7ab3e0] uppercase">
                  {seg.kind}
                </span>
              ) : null}
              <span
                className={cn(
                  "text-[15px] font-bold",
                  seg.tour_unset && "text-[13.5px] text-amber-400",
                )}
              >
                {seg.title}
              </span>
              {seg.when ? (
                <span className="ml-auto text-[12px] font-semibold text-amber-400">
                  {seg.when}
                </span>
              ) : null}
            </div>
          ) : null}
          {seg.tour_compact ? (
            <CompactTour
              seg={seg}
              title={multi || seg.tour_unset ? "" : seg.title}
            />
          ) : seg.manifest ? (
            <TourList
              manifest={seg.manifest}
              van={seg.van}
              title={multi || seg.tour_unset ? "" : seg.title}
              search={search}
              onOpenGuest={onOpenGuest}
              withText
            />
          ) : seg.relay_guests ? (
            <RelayList
              seg={seg}
              search={search}
              onOpenGuest={onOpenGuest}
              unreadByOrder={unreadByOrder}
            />
          ) : (
            <p className="border-t border-white/5 px-3.5 py-2.5 text-[12.5px] text-[#64748b]">
              {seg.relay_guests === null && seg.relay_blocks === undefined
                ? "Guest list not uploaded yet."
                : "No guests for this vehicle yet."}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

const STN = ["bg-[#081920]", "bg-[#06101c]"];

function StationHead({
  time,
  hotel,
  spot,
  label,
  kind,
  pax,
  bookings,
  arrived_at,
  left_at,
}: {
  time: string;
  hotel: string | null;
  spot?: string | null;
  label?: string;
  kind?: string;
  pax: number;
  bookings: number;
  arrived_at?: string | null;
  left_at?: string | null;
}) {
  // Samsara 到站（preview TwJJ32NCdbTEnqxQcCX6MN 预留的样子）：到了没走绿色，走了灰色；没记到不出。
  const arrived = formatMarkTime(arrived_at);
  const left = arrived ? formatMarkTime(left_at) : "";
  return (
    <div className="flex items-start gap-2.5 px-3.5 pt-2.5 pb-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          {time ? (
            <span className="text-[13px] font-bold whitespace-nowrap text-amber-400">
              {time}
            </span>
          ) : null}
          <span className="text-[15px] font-bold text-amber-400">
            {hotel || "Pickup not set"}
          </span>
          {label ? (
            <span
              className={cn(
                "rounded px-1.5 text-[10px] font-bold tracking-[.07em] uppercase",
                kind === "outbound"
                  ? "bg-[rgba(248,201,160,.2)] text-[#f8c9a0]"
                  : kind === "inbound"
                    ? "bg-[rgba(185,211,240,.2)] text-[#b9d3f0]"
                    : "bg-blue-500/20 text-[#9fc5f5]",
              )}
            >
              {label}
            </span>
          ) : null}
          {arrived ? (
            <span
              data-arrival={left ? "left" : "arrived"}
              className={cn(
                "rounded px-1.5 text-[10.5px] font-bold whitespace-nowrap",
                left
                  ? "bg-white/[.08] text-[#cbd5e1]"
                  : "bg-green-500/[.16] text-[#86efac]",
              )}
            >
              Arrived {arrived}
              {left ? ` · Left ${left}` : ""}
            </span>
          ) : null}
        </div>
        {spot ? (
          <div className="mt-0.5 text-[12px] text-[#94a3b8]">{spot}</div>
        ) : null}
      </div>
      <div className="shrink-0 rounded-lg border border-white/15 bg-white/[.04] px-2.5 py-0.5 text-center">
        <b className="block text-[20px] leading-[1.1]">{pax}</b>
        <span className="text-[10px] text-[#94a3b8]">
          {bookings} booking{bookings === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

/** 只读按钮：照 Super Admin 预览的样子灰掉；标了的那个保持绿 / 红（⑩ A）。Text 能点（⑨）。 */
function Buttons({
  state,
  onWord,
  onText,
  dot,
  call = true,
}: {
  state: string | null | undefined;
  onWord: string;
  onText?: () => void;
  dot?: boolean;
  call?: boolean;
}) {
  const on = state === "picked_up" || state === "boarded";
  const ns = state === "no_show";
  const grey =
    "flex min-h-[40px] flex-1 items-center justify-center rounded-[10px] border border-white/15 text-[13.5px] font-semibold text-[#94a3b8] opacity-45";
  return (
    <div className="mt-2 flex gap-2">
      {call ? (
        <span className={cn(grey, "flex-none basis-[52px] text-[#7ab3e0]")}>
          Call
        </span>
      ) : null}
      {onText ? (
        <button
          type="button"
          data-live-text
          onClick={onText}
          title="Reply to this guest (from the company number)"
          className="relative flex min-h-[40px] flex-none basis-[52px] cursor-pointer items-center justify-center rounded-[10px] border border-white/15 bg-white/[.04] text-[13.5px] font-semibold text-[#e5edf7] hover:border-sky-400/60"
        >
          Text
          {dot ? (
            <span className="absolute top-[7px] right-[10px] size-2 rounded-full bg-red-500" />
          ) : null}
        </button>
      ) : null}
      <span
        data-mark-btn={on ? "on" : undefined}
        className={cn(
          grey,
          on && "border-green-500 bg-green-500 text-[#04210f] opacity-100",
        )}
      >
        {on ? "✓ " : ""}
        {onWord}
      </span>
      <span
        data-mark-btn={ns ? "ns" : undefined}
        className={cn(
          grey,
          ns && "border-red-500 bg-red-500 text-white opacity-100",
        )}
      >
        {ns ? "✗ " : ""}No show
      </span>
    </div>
  );
}

function MarkTime({
  state,
  at,
  word,
}: {
  state: string | null | undefined;
  at: string | null | undefined;
  word: string;
}) {
  if (!state) return null;
  const t = formatMarkTime(at);
  const ns = state === "no_show";
  return (
    <div
      data-mark-time
      className={cn(
        "mt-1 text-[11.5px] tabular-nums",
        ns ? "text-[#fca5a5]" : "text-[#86efac]",
      )}
    >
      {ns ? "✗ No show" : `✓ ${word}`}
      {t ? ` ${t}` : ""}
    </div>
  );
}

function hit(search: string, ...values: (string | null | undefined)[]) {
  return (
    !!search && values.some((v) => (v ?? "").toLowerCase().includes(search))
  );
}

function RelayList({
  seg,
  search,
  onOpenGuest,
  unreadByOrder,
}: {
  seg: LiveSegment;
  search: string;
  onOpenGuest: OpenGuest;
  unreadByOrder: Map<string, LiveInboxThread>;
}) {
  const s = seg.relay_summary;
  return (
    <>
      {s ? (
        <div className="px-3.5 pt-2 pb-1">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-[#94a3b8]">
            <span>
              <b className="text-white">{s.pax}</b> pax
            </span>
            <span>
              <b className="text-white">{s.pickups}</b> pickup
              {s.pickups === 1 ? "" : "s"}
            </span>
            {s.first ? (
              <span>
                {s.first}
                {s.last && s.last !== s.first ? ` – ${s.last}` : ""}
              </span>
            ) : null}
            {seg.van ? (
              <span className="rounded-md border border-blue-500/35 bg-blue-500/20 px-2 text-[12px] font-semibold text-white">
                {seg.van}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 pb-1.5 text-[12px] text-[#94a3b8]">
            Picked up {s.picked_up}/{s.pax} · {s.no_show} no show
          </div>
        </div>
      ) : null}
      {(seg.relay_blocks ?? []).map((b, i) => (
        <section key={i} className={cn("border-t border-white/10", STN[i % 2])}>
          <StationHead {...b} />
          {b.guests.map((g) => {
            const name = relayName(g);
            const msg = unreadByOrder.get(g.order_number);
            return (
              <div
                key={g.id}
                data-live-guest={g.order_number}
                className={cn(
                  "border-t border-white/5 px-3.5 py-2.5",
                  hit(search, g.order_number, name) &&
                    "bg-yellow-400/15 ring-2 ring-yellow-400 ring-inset",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[14.5px] font-semibold text-white">
                        {name}
                      </span>
                      <span className="rounded-md bg-white/[.08] px-1.5 text-[13px] font-bold">
                        {g.pax} pax
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-[#64748b]">
                      {g.order_number}
                    </div>
                  </div>
                  <div className="flex flex-col items-end text-right whitespace-nowrap">
                    <span
                      className={cn(
                        "text-[11px]",
                        g.checked_in_at ? "text-green-500" : "text-[#64748b]",
                      )}
                    >
                      {g.checked_in_at ? "Checked in" : "Not checked in"}
                    </span>
                    <span
                      className={cn(
                        "text-[13px] font-semibold",
                        g.checked_in_at ? "text-white" : "text-[#94a3b8]",
                      )}
                    >
                      {g.checked_in_at || "–"}
                    </span>
                  </div>
                </div>
                {msg?.unread && msg.last_guest_text ? (
                  <div className="mt-2 rounded-lg bg-white px-2.5 py-1.5 text-[13px] leading-[1.4] text-[#0b1220]">
                    <i className="mr-1.5 text-[10px] font-bold tracking-[.08em] text-[#475569] not-italic">
                      GUEST
                    </i>
                    {msg.last_guest_text}
                  </div>
                ) : null}
                <Buttons
                  state={g.relay_status}
                  onWord="Picked up"
                  onText={() => onOpenGuest(g.order_number, name)}
                  dot={!!msg?.unread}
                />
                <MarkTime
                  state={g.relay_status}
                  at={g.relay_status_at}
                  word="Picked up"
                />
              </div>
            );
          })}
        </section>
      ))}
      {seg.relay_farm_out_guests?.length ? (
        <div className="border-t-2 border-amber-500/40 px-3.5 py-2.5 text-[12px] text-amber-400">
          Farm out — hand off, not our bus ·{" "}
          {seg.relay_farm_out_guests.reduce((a, g) => a + g.pax, 0)} to pick up
        </div>
      ) : null}
    </>
  );
}

/** title：一天只有这一段时写在车号旁边（同 driver_home.html 的 tc-tour）；几段时段头已经写了，传空。 */
function CompactTour({ seg, title }: { seg: LiveSegment; title: string }) {
  const tc = seg.tour_compact!;
  const stat = (n: number, label: string, red = false) => (
    <div className="rounded-[9px] bg-white/[.06] px-1 py-1.5 text-center">
      <b className={cn("block text-[19px]", red && "text-[#fca5a5]")}>{n}</b>
      <small className="block text-[10px] leading-[1.25] text-[#94a3b8]">
        {label}
      </small>
    </div>
  );
  return (
    <div>
      {/* 同司机手机页（driver_home.html 的 tc.not_split / tc.unplaced）。 */}
      {tc.not_split ? (
        <Warn>
          Dispatch has not split this tour between buses yet. Call dispatch.
        </Warn>
      ) : tc.unplaced ? (
        <Warn>
          {tc.unplaced} order{tc.unplaced === 1 ? "" : "s"} on this tour{" "}
          {tc.unplaced === 1 ? "has" : "have"} no bus yet and{" "}
          {tc.unplaced === 1 ? "is" : "are"} not counted here. Call dispatch.
        </Warn>
      ) : null}
      <div className="mb-2.5 rounded-[14px] border border-blue-500/45 bg-[#10243b] p-3.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <b className="text-[28px] leading-none">{tc.total}</b>
          <span className="text-[13px] text-[#94a3b8]">pax on this bus</span>
          {tc.first ? (
            <em className="ml-auto text-[13px] font-bold text-amber-400 not-italic">
              {tc.first}
            </em>
          ) : null}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2.5 text-[12.5px] text-[#94a3b8]">
          {seg.van ? (
            <span className="rounded-md border border-blue-500/35 bg-blue-500/20 px-2 font-semibold text-white">
              {seg.van}
            </span>
          ) : null}
          {title ? <span>{title}</span> : null}
          {tc.guide ? <span>Guide: {tc.guide}</span> : null}
        </div>
        <div className="mt-2.5 grid grid-cols-[repeat(auto-fit,minmax(70px,1fr))] gap-1.5">
          {tc.my_relay
            ? stat(tc.my_relay, "Already on board from your relay")
            : null}
          {stat(tc.ti, "Board at Treasure Island")}
          {stat(
            tc.other_relay,
            tc.my_relay ? "From other relay cars" : "Brought to TI by relay",
          )}
          {stat(tc.no_show, "No show (from guide)", true)}
        </div>
      </div>
      <p className="rounded-[10px] border border-dashed border-white/15 px-2.5 py-2 text-[12px] text-[#94a3b8]">
        The guide{tc.guide ? ` ${tc.guide}` : ""} has the guest list and
        contacts the guests.
      </p>
      {/* shuttle 去程 / 回程：只有接人点、时间、人数，不带客人（同 driver_home.html 的 tc.shuttles）。 */}
      {tc.shuttles?.map((b, i) => (
        <section
          key={i}
          data-compact-shuttle
          className={cn(
            "mt-2 overflow-hidden rounded-xl border border-white/10",
            STN[i % 2],
          )}
        >
          <StationHead
            time={b.time}
            hotel={b.hotel}
            spot={b.product}
            label={b.label}
            kind={b.kind}
            pax={b.pax}
            bookings={b.bookings}
          />
        </section>
      ))}
    </div>
  );
}

function TourList({
  manifest: m,
  van,
  title,
  search,
  onOpenGuest,
  withText,
  guide = false,
  relayNoShow,
}: {
  manifest: LiveManifest;
  van: string | null | undefined;
  title: string;
  search: string;
  onOpenGuest: OpenGuest;
  withText: boolean;
  guide?: boolean;
  relayNoShow?: LiveGuideRun["relay_no_show"];
}) {
  const s = m.summary;
  const lunch: { n: number; label: string }[] = m.guide_lunch_bar
    ? m.guide_lunch_bar
    : Object.entries(m.lunch_bar ?? {}).map(([label, n]) => ({ n, label }));
  return (
    <div>
      {s && m.blocks.length ? (
        <div className="mb-2.5 rounded-[14px] border border-blue-500/45 bg-[#10243b] p-3.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <b className="text-[28px] leading-none">{s.pax}</b>
            <span className="text-[13px] text-[#94a3b8]">
              pax · {s.pickups} pickup stop{s.pickups === 1 ? "" : "s"}
            </span>
            {s.first ? (
              <em className="ml-auto text-[13px] font-bold text-amber-400 not-italic">
                {s.first}
                {s.last && s.last !== s.first ? ` – ${s.last}` : ""}
              </em>
            ) : null}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2.5 text-[12.5px] text-[#94a3b8]">
            {van ? (
              <span className="rounded-md border border-blue-500/35 bg-blue-500/20 px-2 font-semibold text-white">
                {van}
              </span>
            ) : null}
            {title ? <span>{title}</span> : null}
          </div>
          {guide ? (
            <div className="mt-2.5 flex items-baseline gap-2 border-t border-white/10 pt-2.5">
              <b className="text-[22px] leading-none text-[#86efac]">
                On board {s.picked_up} / {s.pax}
              </b>
              <span className="text-[12.5px] text-[#94a3b8]">
                · {s.no_show} no show
              </span>
            </div>
          ) : null}
          {lunch.length ? (
            <div className="mt-2.5 flex gap-1.5">
              {lunch.map((x) => (
                <span
                  key={x.label}
                  className="flex-1 rounded-lg bg-white/[.06] px-0.5 py-1 text-center text-[11px] text-[#94a3b8]"
                >
                  <b className="block text-[16px] text-white">{x.n}</b>
                  {x.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {!guide && s ? (
        <div className="flex px-2 pb-2 text-[11px] font-bold tracking-[.1em] text-[#94a3b8] uppercase">
          Guests
          <span className="ml-auto font-normal tracking-normal text-green-500 normal-case tabular-nums">
            Boarded {s.picked_up} / {s.pax} · {s.no_show} no show
          </span>
        </div>
      ) : null}
      {m.not_split ? (
        <Warn>Dispatch has not split this tour between buses yet.</Warn>
      ) : m.unplaced ? (
        <Warn>
          {m.unplaced} order{m.unplaced === 1 ? "" : "s"} on this tour have no
          bus yet.
        </Warn>
      ) : null}
      {relayNoShow?.length ? (
        <div className="mb-2.5 rounded-[10px] border border-red-500/40 bg-red-500/[.14] px-2.5 py-1.5">
          <div className="text-[12px] font-bold text-[#fca5a5]">
            Not picked up at the hotel · {relayNoShow.length} — look out for
            them at TI
          </div>
          {relayNoShow.map((g, i) => (
            <div key={i} className="text-[12px] text-white">
              <b>{g.guide_name}</b>{" "}
              <span className="text-[#94a3b8]">
                {g.pax} pax{g.pickup_location ? ` · ${g.pickup_location}` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {m.blocks.map((b, i) => (
        <section
          key={i}
          className={cn(
            "mb-2.5 overflow-hidden rounded-xl border border-[rgba(122,160,210,.3)]",
            STN[i % 2],
            i % 2 === 0 && "border-[rgba(45,212,191,.28)]",
          )}
        >
          <StationHead {...b} />
          {b.guests.map((g) => {
            const name =
              (guide ? g.guide_name : g.name) || g.name || g.guide_name || "";
            const lunchText = g.guide_lunch?.text || g.lunch_text;
            return (
              <div
                key={g.id}
                data-live-guest={g.order_number}
                className={cn(
                  "border-t border-white/[.14] px-3 py-2.5",
                  hit(search, g.order_number, name) &&
                    "bg-yellow-400/15 ring-2 ring-yellow-400 ring-inset",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14.5px] font-semibold text-white">
                    {name}
                  </span>
                  <span className="rounded-md bg-white/[.08] px-1.5 text-[12px] font-bold">
                    {g.pax} pax
                  </span>
                  {guide && g.relay_status === "picked_up" ? (
                    <span className="rounded-md border border-green-500/45 bg-green-500/15 px-2 text-[12px] font-bold text-[#86efac]">
                      ✓ On board
                    </span>
                  ) : guide && g.relay_status === "no_show" ? (
                    <span className="rounded-md border border-red-500/45 bg-red-500/15 px-2 text-[12px] font-bold text-[#fca5a5]">
                      ✗ No show
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-[#94a3b8]">
                  {lunchText ? (
                    <span
                      className={cn(
                        "rounded-full bg-white/[.09] px-2 text-white",
                        g.guide_lunch?.bad && "bg-red-500/20 text-[#fca5a5]",
                      )}
                    >
                      {lunchText}
                    </span>
                  ) : null}
                  <span className="text-[#64748b]">{g.order_number}</span>
                </div>
                {g.relay_status === "no_show" ? (
                  <div className="mt-1.5 text-[12px] font-bold text-[#fca5a5]">
                    Not picked up at hotel
                  </div>
                ) : null}
                <Buttons
                  state={g.boarding}
                  onWord="Boarded"
                  onText={
                    withText || guide
                      ? () => onOpenGuest(g.order_number, name)
                      : undefined
                  }
                />
                <MarkTime
                  state={g.boarding}
                  at={g.boarding_at}
                  word="Boarded"
                />
              </div>
            );
          })}
        </section>
      ))}
      {!m.blocks.length ? (
        <p className="px-0.5 py-2.5 text-[13px] text-[#94a3b8]">
          No guests on this bus.
        </p>
      ) : null}
    </div>
  );
}

function Warn({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2.5 rounded-[10px] bg-amber-500/[.14] px-3 py-2 text-[12.5px] text-amber-400">
      {children}
    </p>
  );
}

// ── 导游页 ───────────────────────────────────────────────────────────────────

function GuidePage({
  runs,
  search,
  onOpenGuest,
}: {
  runs: LiveGuideRun[];
  search: string;
  onOpenGuest: OpenGuest;
}) {
  if (!runs.length)
    return (
      <p className="mt-4 rounded-[14px] border border-dashed border-white/15 p-5 text-center text-[14px] font-semibold text-[#94a3b8]">
        No bus today
      </p>
    );
  return (
    <div className="mt-3">
      {runs.map((run) => (
        <div key={run.id} className="mb-4">
          {runs.length > 1 || !run.manifest ? (
            <div className="flex items-baseline gap-2.5 px-0.5 pb-2">
              <span className="text-[16px] font-bold">{run.tour}</span>
              <span className="ml-auto text-[12.5px] text-[#94a3b8]">
                {[run.bus_label ? `Bus ${run.bus_label}` : "", run.van]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          ) : null}
          {run.manifest ? (
            <TourList
              manifest={run.manifest}
              van={[run.bus_label ? `Bus ${run.bus_label}` : "", run.van]
                .filter(Boolean)
                .join(" · ")}
              title={run.tour}
              search={search}
              onOpenGuest={onOpenGuest}
              withText={false}
              guide
              relayNoShow={run.relay_no_show}
            />
          ) : (
            <p className="px-0.5 py-2.5 text-[13px] text-[#94a3b8]">
              Guest list not uploaded yet.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Messages 页签（司机页同一份收件箱；点一位客人打开回复框）──────────────────────

function Inbox({
  threads,
  onOpenGuest,
}: {
  threads: LiveInboxThread[];
  onOpenGuest: OpenGuest;
}) {
  if (!threads.length)
    return (
      <p className="px-2 py-3.5 text-[13px] text-[#94a3b8]">
        No messages from these guests yet.
      </p>
    );
  return (
    <div data-live-inbox>
      <div className="px-2 py-1.5 text-[11px] font-bold tracking-[.1em] text-[#94a3b8] uppercase">
        Newest first · this driver&apos;s run
      </div>
      {threads.map((t) => (
        <button
          key={t.order_number}
          type="button"
          data-live-thread={t.order_number}
          onClick={() => onOpenGuest(t.order_number, t.guest_name)}
          className={cn(
            "mb-2 block w-full cursor-pointer rounded-xl border border-sky-400/35 bg-[#0f2744] px-3 py-2.5 text-left",
            t.unread && "shadow-[inset_3px_0_0_#ef4444]",
          )}
        >
          <div className="flex items-baseline gap-2">
            {t.unread ? (
              <span className="inline-block size-2 rounded-full bg-red-500" />
            ) : null}
            <b className="text-[15px] text-white">{t.guest_name}</b>
            <span className="ml-auto text-[11.5px] text-[#94a3b8]">
              {t.last?.time ?? ""}
            </span>
          </div>
          <div className="text-[12px] text-[#94a3b8]">
            {t.pax} pax{t.pickup_location ? ` · ${t.pickup_location}` : ""}
          </div>
          {t.last ? (
            <div className="mt-1.5 text-[13.5px] text-[#e5edf7]">
              {t.last.text}
            </div>
          ) : null}
        </button>
      ))}
      <p className="px-1 text-[11.5px] text-[#64748b]">
        Opening a conversation here does not mark it read for the driver.
      </p>
    </div>
  );
}
