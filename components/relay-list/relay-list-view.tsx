"use client";

import "./relay-list.css";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { ErrorBanner } from "@/components/ui/panel";
import { PageLink } from "@/components/ui/page-link";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchRelayPull,
  type RelayGuest,
  type RelayPull,
} from "@/lib/dispatch-api";
import { isYmd } from "@/lib/la-date";
import {
  busBar,
  busLegend,
  busName,
  buildRound,
  hotelText,
  newGroup,
  RELAY_LIST_ROUNDS,
  type RelayCarSheet,
  type RelayRoundList,
  relayDates,
  tourText,
} from "@/lib/relay-list";
import { buildLegacyLoginRedirectUrl } from "@/lib/safe-redirect";

type ViewState =
  | { kind: "loading" }
  | { kind: "bad-link" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: RelayPull };

/** .mf-nav a.back（同 Bus Manifest 页的返回键）。 */
const NAV_LINK =
  "inline-flex h-7 items-center rounded-lg border border-[rgba(147,197,253,.35)] px-[11px] text-[13px] text-[#93c5fd] no-underline hover:bg-white/[.07]";
/** 白底键（Print 不是提交键，不用蓝色）。 */
const WHITE_BTN =
  "inline-flex h-8 cursor-pointer items-center rounded-[8px] border border-black/25 bg-paper px-3.5 text-[13px] font-bold text-[#111]";

/**
 * Relay list：Dispatch › Morning Relay「📋 Relay list」打开（Annie：「排完relay并保存了以后，应该加一个按键显示这些relay的list」）。
 * 地址 `?date=YYYY-MM-DD`；带 `&car=<排车行 id>` = 只看 / 只印这一台（车头的 Print）。显示的是已保存的排车。
 * 一轮一张 RELAY SPLITS 总表 + 每台有客人的车一张，屏幕上看、按 Print 打印（A4 竖向，一张一页）。
 */
export function RelayListView() {
  const [params, setParams] = useState<{
    date: string;
    car: number | null;
  } | null>(null);
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (!redirectingRef.current) {
      redirectingRef.current = true;
      window.location.href = buildLegacyLoginRedirectUrl(window.location.href);
    }
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const date = q.get("date");
    const car = Number(q.get("car"));
    if (!isYmd(date)) {
      setView({ kind: "bad-link" });
      return;
    }
    setParams({ date, car: Number.isInteger(car) && car > 0 ? car : null });
  }, []);

  useEffect(() => {
    if (!params) return;
    let alive = true;
    setView({ kind: "loading" });
    fetchRelayPull(params.date)
      .then((data) => {
        if (alive) setView({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (!alive) return;
        if (isStatus(error, 401)) redirectToLogin();
        else if (isStatus(error, 403)) setView({ kind: "forbidden" });
        else setView({ kind: "error", message: describeError(error) });
      });
    return () => {
      alive = false;
    };
  }, [params, reloadKey, redirectToLogin]);

  const backHref = params ? `/dispatch?date=${params.date}` : "/dispatch";

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 py-5 sm:px-6 print:max-w-none print:p-0">
      <div className="rl-screen-only mb-4 flex flex-wrap items-center gap-3">
        <PageLink href={backHref} className={NAV_LINK}>
          ← Dispatch
        </PageLink>
        {view.kind === "ready" ? (
          <button
            type="button"
            data-relay-print
            onClick={() => window.print()}
            className={WHITE_BTN}
          >
            🖨 Print
          </button>
        ) : null}
        <span className="text-[12.5px] text-[#cbd5e1]">
          Shows the saved Dispatch schedule. Changed something? Save it on
          Dispatch, then reload this page.
        </span>
      </div>
      {view.kind === "loading" ? (
        <p className="text-[13px] text-[#94a3b8]">Loading…</p>
      ) : view.kind === "bad-link" ? (
        <p className="text-[13px] text-[#cbd5e1]">
          This link is missing the date. Open the Relay list from Dispatch.
        </p>
      ) : view.kind === "forbidden" ? (
        <p className="text-[13px] text-[#cbd5e1]">
          You don&apos;t have access to Dispatch.
        </p>
      ) : view.kind === "error" ? (
        <ErrorBanner
          actionLabel="Retry"
          onAction={() => setReloadKey((k) => k + 1)}
        >
          Could not load the relay list: {view.message}
        </ErrorBanner>
      ) : params ? (
        // A4 宽 210mm：手机上这一块自己左右滑，整页不晃（手机版规则）。
        <div className="overflow-x-auto print:overflow-visible">
          <Sheets data={view.data} date={params.date} onlyCar={params.car} />
        </div>
      ) : null}
    </main>
  );
}

function Sheets({
  data,
  date,
  onlyCar,
}: {
  data: RelayPull;
  date: string;
  onlyCar: number | null;
}) {
  const dates = relayDates(date);
  const rounds = RELAY_LIST_ROUNDS.map((r) => buildRound(data, r)).filter(
    (r): r is RelayRoundList => !!r && r.cars.length > 0,
  );
  if (onlyCar !== null) {
    const car = rounds.flatMap((r) => r.cars).find((c) => c.carId === onlyCar);
    return car ? (
      <CarSheet car={car} dateShort={dates.short} />
    ) : (
      <p className="text-[13px] text-[#cbd5e1]">
        This car is not on the saved Morning Relay for this day.
      </p>
    );
  }
  if (!rounds.length)
    return (
      <p className="text-[13px] text-[#cbd5e1]">
        No relay cars are saved for this day yet.
      </p>
    );
  const unplaced = data.need_a_look ?? [];
  return (
    <>
      {rounds.map((r) => (
        <Fragment key={r.round}>
          <TotalSheet
            round={r}
            dateLong={dates.long}
            many={rounds.length > 1}
          />
          {r.cars
            .filter((c) => c.rows.length > 0)
            .map((c) => (
              <CarSheet key={c.key} car={c} dateShort={dates.short} />
            ))}
        </Fragment>
      ))}
      {unplaced.length ? <Unplaced guests={unplaced} /> : null}
    </>
  );
}

const TOTAL_HEAD = [
  "Pick up Time",
  "Pick up Location",
  "Quantities",
  "Customer name",
  "Customer Phone",
  "Tour",
  "Order Number",
];

/** 总表图例：第一排接驳车，下面几排大巴（每个团一栏，同团的车叠在一起）。 */
function Legend({ round }: { round: RelayRoundList }) {
  const relayCars = round.cars.filter((c) => !c.isBus);
  const cols = Math.max(relayCars.length, 1);
  const byTour = new Map<string, typeof round.buses>();
  for (const b of round.buses)
    byTour.set(b.tour, [...(byTour.get(b.tour) ?? []), b]);
  const tours = [...byTour.values()];
  const depth = Math.max(0, ...tours.map((t) => t.length));
  const busRows: (typeof round.buses)[] = [];
  // 每 cols 个团一组；组里按「第几辆车」一排排往下叠。
  for (let start = 0; start < tours.length; start += cols) {
    const group = tours.slice(start, start + cols);
    for (let i = 0; i < depth; i++) {
      const row = group.map((t) => t[i] ?? null);
      if (row.some(Boolean)) busRows.push(row as typeof round.buses);
    }
  }
  const cell = (text: string, color: string | null, key: string) => (
    <td key={key} style={color ? { background: color } : undefined}>
      {text}
    </td>
  );
  return (
    <table className="rl-legend mt-1.5">
      <tbody>
        <tr>
          {relayCars.map((c) => [
            cell(c.title, c.color, `${c.key}-t`),
            cell(c.who, c.color, `${c.key}-w`),
          ])}
        </tr>
        {busRows.map((row, i) => (
          <tr key={i}>
            {Array.from({ length: cols }, (_, j) => {
              const b = row[j];
              return b
                ? [
                    cell(busName(b), b.color, `${i}-${j}-n`),
                    cell(busLegend(b), b.color, `${i}-${j}-w`),
                  ]
                : [<td key={`${i}-${j}-a`} />, <td key={`${i}-${j}-b`} />];
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TotalSheet({
  round,
  dateLong,
  many,
}: {
  round: RelayRoundList;
  dateLong: string;
  /** 有两轮时右上角带上是哪一轮。 */
  many: boolean;
}) {
  let prev: { guest: RelayGuest; carKey: string } | null = null;
  return (
    <section data-relay-total={round.round} className="rl-sheet rl-total">
      <div className="flex items-baseline justify-between text-[20px] font-bold">
        <span>RELAY SPLITS</span>
        <span>
          {dateLong}
          {many ? (
            <span className="ml-2 text-[13px] font-semibold">
              · {round.name}
            </span>
          ) : null}
        </span>
      </div>
      <Legend round={round} />
      <table className="mt-2">
        <thead>
          <tr>
            {TOTAL_HEAD.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {round.rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="!font-normal text-[#555]">
                No guests on a relay car yet.
              </td>
            </tr>
          ) : (
            round.rows.map(({ guest: g, car }) => {
              const cur = { guest: g, carKey: car.key };
              const gap = newGroup(prev, cur);
              prev = cur;
              return (
                <Fragment key={`${car.key}-${g.id}`}>
                  {gap ? (
                    <tr>
                      <td className="rl-gap" colSpan={7} />
                    </tr>
                  ) : null}
                  <tr data-relay-row={g.order_number}>
                    <td>{g.pickup_time}</td>
                    <td style={{ background: car.color }}>{hotelText(g)}</td>
                    <td>{g.pax ?? ""}</td>
                    <td>{g.name}</td>
                    <td>{g.phone ?? ""}</td>
                    <td>{tourText(g)}</td>
                    <td>{g.order_number}</td>
                  </tr>
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}

function CarSheet({
  car,
  dateShort,
}: {
  car: RelayCarSheet;
  dateShort: string;
}) {
  let prev: { guest: RelayGuest; carKey: string } | null = null;
  return (
    <section data-relay-car={car.key} className="rl-sheet">
      <div className="rl-head" style={{ background: car.color }}>
        <span>
          {car.title} &nbsp;{car.who}
        </span>
        <span className="whitespace-nowrap">
          Service Date: &nbsp;{dateShort}
        </span>
      </div>
      {car.problems.map((p) => (
        <p key={p} className="px-3 py-1 text-[14px] font-bold text-[#d00000]">
          {p}
        </p>
      ))}
      <table className="mt-1.5">
        <thead>
          <tr>
            <th>Time</th>
            <th>Hotel</th>
            <th>Qty</th>
            <th>Full Name</th>
            <th>Phone #</th>
            <th>Product</th>
            <th>Order #</th>
          </tr>
        </thead>
        <tbody>
          {car.rows.map((g) => {
            const cur = { guest: g, carKey: car.key };
            const gap = newGroup(prev, cur);
            prev = cur;
            return (
              <Fragment key={g.id}>
                {gap ? (
                  <tr>
                    <td className="rl-gap" colSpan={7} />
                  </tr>
                ) : null}
                <tr data-relay-row={g.order_number}>
                  <td>{g.pickup_time}</td>
                  <td style={{ background: car.color }}>{hotelText(g)}</td>
                  <td>{g.pax ?? ""}</td>
                  <td>{g.name}</td>
                  <td>{g.phone ?? ""}</td>
                  <td>{tourText(g)}</td>
                  <td>{g.order_number}</td>
                </tr>
              </Fragment>
            );
          })}
          <tr>
            <td className="rl-gap" colSpan={7} />
          </tr>
          <tr>
            <td colSpan={2} className="!text-right !text-[20px]">
              Total Pax
            </td>
            <td data-relay-total-pax className="!text-[20px]">
              {car.pax}
            </td>
            <td colSpan={4} className="!border-0" />
          </tr>
        </tbody>
      </table>
      {car.buses.length ? (
        <div className="mt-5">
          {car.buses.map((b) => (
            <div
              key={`${b.tour}-${b.label}-${b.van}`}
              data-relay-bus
              className="rl-bar"
              style={b.color ? { background: b.color } : undefined}
            >
              {busBar(b)}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** 还没上任何 relay 车的客人：只在屏幕上，给 staff 看还差谁没排（不印）。 */
function Unplaced({ guests }: { guests: (RelayGuest & { reason: string })[] }) {
  const pax = guests.reduce((s, g) => s + (g.pax ?? 0), 0);
  return (
    <section
      data-relay-unplaced
      className="rl-screen-only mx-auto mb-6 w-full max-w-[210mm] overflow-hidden rounded-[10px] bg-paper text-[#111]"
    >
      <div className="border-b border-black/10 px-4 py-2.5 text-[14px] font-bold text-[#8a5a00]">
        Not on any relay car yet — {guests.length}{" "}
        {guests.length === 1 ? "order" : "orders"}, {pax} pax
        <span className="ml-2 text-[12px] font-normal text-[#1a1a1a]">
          Not printed. Add their hotel to a relay car on Dispatch.
        </span>
      </div>
      <div className="rl-scroll">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[#f1f5f9] text-left">
              {["Time", "Hotel", "Qty", "Name", "Tour", "Order #", "Why"].map(
                (h) => (
                  <th
                    key={h}
                    className="border-b border-black/10 px-2.5 py-1.5 font-semibold"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {guests.map((g) => (
              <tr key={g.id} className="border-b border-black/[.06]">
                <td className="px-2.5 py-1.5">{g.pickup_time}</td>
                <td className="px-2.5 py-1.5">{hotelText(g)}</td>
                <td className="px-2.5 py-1.5">{g.pax ?? ""}</td>
                <td className="px-2.5 py-1.5">{g.name}</td>
                <td className="px-2.5 py-1.5">{tourText(g)}</td>
                <td className="px-2.5 py-1.5">{g.order_number}</td>
                <td className="px-2.5 py-1.5 text-[#8a5a00]">{g.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
