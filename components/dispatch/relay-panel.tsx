"use client";

import { useState } from "react";

import type { ActionResult } from "@/components/ui/action-result";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  type DriverNotice,
  fetchDriverNotice,
  fetchRelayPull,
  fetchRelaySendPreview,
  type RelayGuest,
  type RelayPull,
  sendDriverNotice,
  sendRelayRound,
} from "@/lib/dispatch-api";
import { LA_TIME_ZONE } from "@/lib/la-date";
import { cn } from "@/lib/utils";

import { StepBox } from "./step-box";

/** 两轮的键和按钮字；轮名和时间段由接口的 round_labels 给（后端 dispatch.SHIFTS，同旧页面）。 */
const ROUNDS: readonly [string, string][] = [
  ["relay", "Send 1st Round"],
  ["relay_2", "Send 2nd Round"],
];

type RoundResult = { sent: number; failed: number; already_sent: number };

type Confirm =
  | {
      kind: "round";
      code: string;
      title: string;
      toSend: number;
      alreadySent: number;
    }
  | {
      kind: "drivers";
      names: string[];
      lastText: string | null;
      /** 点 Send texts now 时重读的名单和页面上显示的不一样（期间存过排车）。 */
      changed: boolean;
    }
  | null;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const paxOf = (list: RelayGuest[]) =>
  list.reduce((n, g) => n + (g.pax || 0), 0);

const LAST_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function lastSentText(d: DriverNotice): string | null {
  return d.last_sent
    ? `Last sent ${LAST_FORMAT.format(new Date(d.last_sent.at))}${d.last_sent.by ? ` by ${d.last_sent.by}` : ""}${d.last_sent.label ? ` (${d.last_sent.label})` : ""}.`
    : null;
}

/** 比名单变没变：谁、号码、能不能发、开哪几台车。 */
function driversKey(d: DriverNotice): string {
  return JSON.stringify(
    d.people.map((p) => [p.name, p.phone, p.can_send, p.why, p.cars]),
  );
}

const BTN =
  "rounded-md px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";

/**
 * 排车页 Send 标签的两步（后端 _relay_pull_panel.html，2026-10-04；10-05 G29 分成两步；
 * Annie 2026-10-07 定拆 Assign / Send：Step 1 Send to drivers、Step 2 早班发送 = 原 Morning Relay）：
 * Pull from manifests（只读）把当天 manifest 里的酒店客人按接客时间分进两轮、对到停那家酒店的车；
 * 每轮一个发送键（⚠️ 真发早班短信，服务端重算名单、跳过发过的）；Send to driver（⚠️ 真发，给司机发他们页面的链接）。
 * 换一天、每次重读这一天（存好 / 复制之后）都由父组件用 key 重建：名单和结果都按服务端最新的重来。
 */
export function RelayPanel({
  date,
  dirty,
  disabled = false,
  onUnauthorized,
}: {
  date: string;
  /** 排车页正在换天 / 保存：这时点了会对上一天操作，先关着。 */
  disabled?: boolean;
  /** 排车页有没存的改动：Pull 读的是已保存的排车，要提醒；两个发送键关着，先回 Assign 存。 */
  dirty: boolean;
  onUnauthorized: () => void;
}) {
  const [data, setData] = useState<RelayPull | null>(null);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, RoundResult>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<DriverNotice | null>(null);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [checkingDrivers, setCheckingDrivers] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  /** Send to driver 在自己那一块，出错写在那一块里（不写进早班发送那一块，人看不到）。 */
  const [driverError, setDriverError] = useState<string | null>(null);

  function fail(
    e: unknown,
    prefix: string,
    show: (msg: string) => void = setError,
  ) {
    if (isStatus(e, 401)) {
      onUnauthorized();
      return;
    }
    show(
      e instanceof TypeError
        ? `${prefix}: could not reach the server. Check your connection and try again.`
        : `${prefix}: ${describeError(e)}`,
    );
  }

  async function pull() {
    setPulling(true);
    setError(null);
    try {
      setData(await fetchRelayPull(date));
    } catch (e) {
      fail(e, "Could not pull the guests");
    } finally {
      setPulling(false);
    }
  }

  function roundTitle(code: string): string {
    const l = data?.round_labels[code];
    return `${(l?.name ?? code).replace(/^Morning Relay · /, "")}${l?.when ? ` · ${l.when}` : ""}`;
  }

  /** 先问服务端这次会发几位（它自己重算、跳过发过的），再确认一次。 */
  async function askRound(code: string) {
    setChecking(code);
    setError(null);
    try {
      const p = await fetchRelaySendPreview(date, code);
      if (!p.to_send) {
        setError(`Everyone in ${roundTitle(code)} has already been sent.`);
        return;
      }
      setConfirm({
        kind: "round",
        code,
        title: roundTitle(code),
        toSend: p.to_send,
        alreadySent: p.already_sent,
      });
    } catch (e) {
      fail(e, "Could not check the round");
    } finally {
      setChecking(null);
    }
  }

  async function sendRound(code: string): Promise<ActionResult> {
    try {
      const res = await sendRelayRound(date, code);
      setResults((r) => ({ ...r, [code]: res }));
      setConfirm(null);
      await pull();
      return { status: "ok" };
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return { status: "redirecting" };
      }
      // 400 / 409：服务端在发第一条之前就拒了，弹窗里写原因，可以再点。
      if (isStatus(e, 400) || isStatus(e, 409)) {
        return {
          status: "error",
          message: `${describeError(e)} Nothing was sent.`,
        };
      }
      // 断开 / 5xx：可能发了一部分。关掉弹窗、重拉一次看谁是 Sent；再发要重新点发送键（先问服务端几位）。
      setConfirm(null);
      await pull();
      setError(
        `${e instanceof TypeError ? "Lost contact with the server." : describeError(e)} Some texts may already have gone out — check which guests show Sent before sending again.`,
      );
      return { status: "ok" };
    }
  }

  /** keepError：发完重拉名单时别把「没发到谁」那句清掉。 */
  async function loadDrivers(keepError = false) {
    setLoadingDrivers(true);
    if (!keepError) setDriverError(null);
    try {
      setDrivers(await fetchDriverNotice(date));
    } catch (e) {
      fail(e, "Could not load the drivers", setDriverError);
    } finally {
      setLoadingDrivers(false);
    }
  }

  /**
   * 点 Send texts now：先重读名单（服务端按当时存好的排车发），确认框按重读的写；
   * 名单变了就把表换成新的，并在确认框里说一句。
   */
  async function askDrivers() {
    if (!drivers) return;
    setCheckingDrivers(true);
    setDriverError(null);
    try {
      const fresh = await fetchDriverNotice(date);
      const changed = driversKey(fresh) !== driversKey(drivers);
      setDrivers(fresh);
      const names = fresh.people.filter((p) => p.can_send).map((p) => p.name);
      if (!names.length) {
        setDriverError(
          changed
            ? "The driver list changed and no driver can be texted now. Check the table."
            : "No driver can be texted for this day.",
        );
        return;
      }
      setConfirm({
        kind: "drivers",
        names,
        lastText: lastSentText(fresh),
        changed,
      });
    } catch (e) {
      fail(e, "Could not check the drivers", setDriverError);
    } finally {
      setCheckingDrivers(false);
    }
  }

  async function sendDrivers(): Promise<ActionResult> {
    try {
      const res = await sendDriverNotice(date);
      setConfirm(null);
      if (res.failed.length) {
        setDriverError(
          `Not delivered to: ${res.failed.map((f) => `${f.name} (${f.error})`).join(", ")}`,
        );
      }
      await loadDrivers(true);
      return { status: "ok" };
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return { status: "redirecting" };
      }
      if (isStatus(e, 400) || isStatus(e, 409)) {
        return {
          status: "error",
          message: `${describeError(e)} Nothing was sent.`,
        };
      }
      // 断开 / 5xx：司机可能已经收到了（后端这里不查重，再点就再发一遍）。关掉弹窗、重拉名单看 Last sent。
      setConfirm(null);
      await loadDrivers(true);
      setDriverError(
        `${e instanceof TypeError ? "Lost contact with the server." : describeError(e)} Some drivers may already have been texted — check “Last sent” before sending again.`,
      );
      return { status: "ok" };
    }
  }

  const lastText = drivers ? lastSentText(drivers) : null;
  const canText = drivers?.people.filter((p) => p.can_send) ?? [];

  return (
    <>
      <StepBox
        n={1}
        title="Send to drivers"
        desc="Text each driver the link to their manifest on their phone for this day. Relay drivers and tour bus drivers both get it."
      >
        <div className="flex flex-wrap items-baseline gap-3">
          <button
            type="button"
            disabled={loadingDrivers || disabled}
            onClick={() => void loadDrivers()}
            className={cn(BTN, "bg-[#185FA5] hover:bg-[#134c85]")}
          >
            Send to driver
          </button>
        </div>

        <details className="max-w-3xl rounded-lg border border-sky-200 bg-sky-50 px-5 py-3 text-xs leading-relaxed text-sky-950">
          <summary className="cursor-pointer font-semibold text-sky-900">
            📖 How to use — Send to drivers
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Save the schedule on the Assign tab first. The list comes from the
              saved schedule.
            </li>
            <li>
              Click Send to driver to see which drivers will get a text with the
              link to their page, then Send texts now. It asks once before
              sending.
            </li>
            <li>
              A driver with no mobile number or no login in HR is listed with
              the reason and is not texted. Fix it in Human Resource, then click
              Send to driver again.
            </li>
            <li>
              You can only send for today or tomorrow, or for a test day where
              every guest is a test order.
            </li>
          </ol>
        </details>

        {driverError ? (
          <p role="alert" className="text-sm text-[#A32D2D]">
            {driverError}
          </p>
        ) : null}

        {drivers ? (
          <Box
            label="Send to driver"
            title="Send to driver"
            sub={`${canText.length} of ${drivers.people.length} can be texted. ${lastText ?? "Not sent yet for this day."}`}
            action={
              <button
                type="button"
                disabled={
                  !canText.length || checkingDrivers || disabled || dirty
                }
                onClick={() => void askDrivers()}
                className={cn(BTN, "bg-[#16a34a] hover:bg-[#15803d]")}
              >
                {checkingDrivers ? "Checking…" : "Send texts now"}
              </button>
            }
          >
            <p className="px-4 py-2 text-xs text-stone-600">
              Text: {drivers.text}
            </p>
            {drivers.people.length ? (
              <Table head={["Driver", "Mobile", "Runs", "Can text?"]}>
                {drivers.people.map((p, i) => (
                  <tr key={i} className="border-b border-stone-100 align-top">
                    <td className={TD}>{p.name}</td>
                    <td
                      className={cn(TD, "font-mono text-xs whitespace-nowrap")}
                    >
                      {p.phone || "—"}
                    </td>
                    <td className={TD}>
                      {p.cars.map((c, j) => (
                        <div key={j}>
                          {[c.shift, c.tour, c.van].filter(Boolean).join(" · ")}
                        </div>
                      ))}
                    </td>
                    <td
                      className={cn(
                        TD,
                        p.can_send ? "" : "text-xs text-[#8a5a00]",
                      )}
                    >
                      {p.can_send ? "Yes" : p.why}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <p className="px-4 py-2.5 text-xs text-stone-500">
                No drivers on the schedule for this day.
              </p>
            )}
          </Box>
        ) : null}
      </StepBox>

      <StepBox
        n={2}
        title="Morning Relay — text guests"
        desc="Text hotel guests their morning pickup. Guests go to the 1st or 2nd Round by pickup time, on the car that stops at their hotel."
      >
        <div className="flex flex-wrap items-baseline gap-3">
          <button
            type="button"
            disabled={pulling || disabled}
            onClick={() => void pull()}
            className={cn(BTN, "bg-[#185FA5] hover:bg-[#134c85]")}
          >
            {pulling ? "Pulling…" : "Pull from manifests"}
          </button>
          <span className="text-xs text-stone-500">
            {dirty
              ? "This day has unsaved changes — Pull uses the saved schedule. Save first."
              : "Save the Morning Relay cars and hotels on the Assign tab first, then pull."}
          </span>
        </div>

        <details className="max-w-3xl rounded-lg border border-sky-200 bg-sky-50 px-5 py-3 text-xs leading-relaxed text-sky-950">
          <summary className="cursor-pointer font-semibold text-sky-900">
            📖 How to use — Morning Relay
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              On the Assign tab, upload each tour&rsquo;s Rezdy CSV in Step 1,
              and save the Morning Relay cars and hotels for both rounds in Step
              2.
            </li>
            <li>
              Click Pull from manifests. Each guest goes to the 1st or 2nd Round
              by pickup time (the times are shown on each round), on the car
              that stops at their hotel.
            </li>
            <li>
              Check Need a look: the time is outside both rounds, no car stops
              at that hotel in that round, or the hotel name was not recognised.
              Fix the schedule and pull again.
            </li>
            <li>
              Guests at a tour bus departure point (ticked in Pickup Locations,
              such as Treasure Island) are not in the relay.
            </li>
            <li>
              Click Send 1st Round or Send 2nd Round when that round is ready.
              It asks once, then texts the guests the same message as Morning
              Pickup. Guests marked Sent are never texted again, so you can pull
              and send again for guests added late.
            </li>
            <li>
              Changed after sent means the pickup time, hotel or vehicle changed
              after the guest got the text. They are not texted again; contact
              them yourself.
            </li>
          </ol>
        </details>

        {error ? (
          <p role="alert" className="text-sm text-[#A32D2D]">
            {error}
          </p>
        ) : null}

        {data ? (
          <>
            {ROUNDS.map(([code, label]) => {
              const cars = data.rounds[code] ?? [];
              const all = cars.flatMap((b) => b.guests);
              const waiting = all.filter((g) => !g.sent).length;
              const res = results[code];
              return (
                <Box
                  key={code}
                  label={roundTitle(code)}
                  title={roundTitle(code)}
                  sub={`${plural(all.length, "order")}, ${paxOf(all)} pax · ${waiting} not sent yet`}
                  action={
                    <button
                      type="button"
                      disabled={
                        !waiting || checking !== null || disabled || dirty
                      }
                      onClick={() => void askRound(code)}
                      className={cn(BTN, "bg-[#16a34a] hover:bg-[#15803d]")}
                    >
                      {checking === code ? "Checking…" : label}
                    </button>
                  }
                >
                  {res ? (
                    <p
                      role="status"
                      className={cn(
                        "border-b border-stone-200 px-4 py-2 text-xs",
                        res.failed
                          ? "bg-[#fdeceb] text-[#b3261e]"
                          : "bg-[#f0f7f2] text-[#1e6b43]",
                      )}
                    >
                      Sent {plural(res.sent, "guest")}
                      {res.failed
                        ? `, ${res.failed} failed (the booking team gets an email)`
                        : ""}
                      {res.already_sent
                        ? `, ${res.already_sent} already sent before (skipped)`
                        : ""}
                      .
                    </p>
                  ) : null}
                  {cars.length ? (
                    <Table head={GUEST_HEAD}>
                      {cars.map((b) => (
                        <CarRows key={b.car.id} car={b.car} guests={b.guests} />
                      ))}
                    </Table>
                  ) : (
                    <p className="px-4 py-2.5 text-xs text-stone-500">
                      No cars in this round.
                    </p>
                  )}
                </Box>
              );
            })}
            <Box
              label="Need a look"
              title="Need a look"
              sub={plural(data.need_a_look.length, "order")}
            >
              {data.need_a_look.length ? (
                <Table head={[...GUEST_HEAD.slice(0, 6), "Why"]}>
                  {data.need_a_look.map((g, i) => (
                    <GuestRow key={i} g={g} why={g.reason} />
                  ))}
                </Table>
              ) : (
                <p className="px-4 py-2.5 text-xs text-stone-500">
                  Nothing to check.
                </p>
              )}
            </Box>
            {data.departure ? (
              <p className="text-xs text-stone-500">
                {plural(data.departure, "order")} board at the tour bus
                departure point and are not in the relay.
              </p>
            ) : null}
          </>
        ) : null}
      </StepBox>

      {confirm?.kind === "round" ? (
        <ConfirmDialog
          title={`Send ${confirm.title}?`}
          confirmLabel={`Send to ${plural(confirm.toSend, "guest")}`}
          busyLabel="Sending…"
          onClose={() => setConfirm(null)}
          onConfirm={() => sendRound(confirm.code)}
        >
          <p>
            Send the Morning Pickup text to{" "}
            <b>{plural(confirm.toSend, "guest")}</b> in {confirm.title} for{" "}
            <b>{date}</b>?
          </p>
          {confirm.alreadySent ? (
            <p>{confirm.alreadySent} already sent before will be skipped.</p>
          ) : null}
          <p>Texts go out to real guests and cannot be recalled.</p>
        </ConfirmDialog>
      ) : confirm?.kind === "drivers" ? (
        <ConfirmDialog
          title="Text the drivers?"
          confirmLabel={`Text ${plural(confirm.names.length, "driver")}`}
          busyLabel="Sending…"
          onClose={() => setConfirm(null)}
          onConfirm={sendDrivers}
        >
          {confirm.changed ? (
            <p className="font-medium text-[#8a5a00]">
              The driver list changed since it was shown (the schedule was
              saved). The table now shows the current list.
            </p>
          ) : null}
          <p>
            Text <b>{plural(confirm.names.length, "driver")}</b> the link to
            their page for <b>{date}</b>: {confirm.names.join(", ")}?
          </p>
          {confirm.lastText ? (
            <p>{confirm.lastText} They will get it again.</p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}

const TD = "px-3 py-1.5";
const GUEST_HEAD = [
  "Order #",
  "Pickup",
  "Location",
  "Guest",
  "Pax",
  "Tour",
  "Text",
];

function Box({
  label,
  title,
  sub,
  action,
  children,
}: {
  label: string;
  title: string;
  sub: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-label={label}
      role="region"
      className="overflow-hidden rounded-lg border border-stone-200 bg-white"
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b border-stone-200 bg-stone-50 px-4 py-2.5">
        <b className="text-sm text-stone-900">{title}</b>
        <span className="text-xs text-stone-600">{sub}</span>
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Table({
  head,
  children,
}: {
  head: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-[13px] tabular-nums">
        <thead>
          <tr className="border-b border-stone-200 bg-stone-100 text-left text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
            {head.map((h) => (
              <th
                key={h}
                className={cn(
                  TD,
                  "whitespace-nowrap",
                  h === "Pax" && "text-right",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function CarRows({
  car,
  guests,
}: {
  car: { van: string | null; driver: string | null };
  guests: RelayGuest[];
}) {
  return (
    <>
      <tr className="bg-[#eef4fb] font-semibold">
        <td colSpan={7} className={TD}>
          {car.van || "No vehicle"} · {car.driver || "No driver"} ·{" "}
          {plural(guests.length, "order")}, {paxOf(guests)} pax
        </td>
      </tr>
      {guests.length ? (
        guests.map((g, i) => <GuestRow key={i} g={g} />)
      ) : (
        <tr>
          <td colSpan={7} className={cn(TD, "text-xs text-stone-500")}>
            No guests for this car.
          </td>
        </tr>
      )}
    </>
  );
}

function GuestRow({ g, why }: { g: RelayGuest; why?: string }) {
  return (
    <tr
      data-order={g.order_number}
      className="border-b border-stone-100 align-top"
    >
      <td className={cn(TD, "font-mono text-xs whitespace-nowrap")}>
        {g.order_number}
      </td>
      <td className={cn(TD, "font-mono text-xs whitespace-nowrap")}>
        {g.pickup_time}
      </td>
      <td className={TD}>{g.pickup_location}</td>
      <td className={TD}>{g.name}</td>
      <td className={cn(TD, "text-right")}>{g.pax ?? ""}</td>
      <td className={TD}>{g.tour}</td>
      {why !== undefined ? (
        <td className={cn(TD, "text-xs text-[#8a5a00]")}>{why}</td>
      ) : (
        <td className={cn(TD, "whitespace-nowrap")}>
          <StatusPill g={g} />
        </td>
      )}
    </tr>
  );
}

const PILL =
  "rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap";

function StatusPill({ g }: { g: RelayGuest }) {
  if (g.relay_status === "no_show") {
    return (
      <span className={cn(PILL, "bg-[#fdeceb] text-[#b3261e]")}>No show</span>
    );
  }
  if (g.changed?.length) {
    return (
      <>
        <span className={cn(PILL, "bg-[#fdf1dd] text-[#8a5a00]")}>
          Changed after sent
        </span>
        <span className="mt-0.5 block text-[11px] whitespace-normal text-[#8a5a00]">
          {g.changed.join("; ")}
        </span>
      </>
    );
  }
  if (g.sent)
    return (
      <span className={cn(PILL, "bg-[#e6f4ec] text-[#1e6b43]")}>Sent</span>
    );
  return (
    <span className={cn(PILL, "bg-[#e8f0fd] text-[#1d4ed8]")}>Not sent</span>
  );
}
