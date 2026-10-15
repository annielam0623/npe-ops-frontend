"use client";

import { useEffect, useState } from "react";

import { MorningResults } from "@/components/morning-send/morning-results";
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

import {
  ADDVAN,
  DARK_ERR,
  HOWTO_OL,
  HOWTO_SUMMARY,
  MONO,
  RP_HOWTO,
  RP_PAD,
  TD,
  TH,
} from "./legacy-styles";
import { StepBox } from "./step-box";

/** 两轮的键和按钮字；轮名和时间段由接口的 round_labels 给（后端 dispatch.SHIFTS，同旧页面）。 */
const ROUNDS: readonly [string, string][] = [
  ["relay", "Send 1st Round"],
  ["relay_2", "Send 2nd Round"],
];

type RoundResult = Awaited<ReturnType<typeof sendRelayRound>>;

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
      /** 勾选的司机 key，原样传给后端（只发这些）。 */
      keys: string[];
      /** 能发、但这次取消勾选的人数。 */
      skipped: number;
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
    d.people.map((p) => [p.key, p.name, p.phone, p.can_send, p.why, p.cars]),
  );
}

/** 能发、又没被取消勾选的人（按 key 认人，不按下标——同旧页面 `8cdacda`）。 */
function pickedPeople(d: DriverNotice, skipped: ReadonlySet<string>) {
  return d.people.filter((p) => p.can_send && !skipped.has(p.key));
}

/**
 * 收起状态下的一行提示（旧 `renderDriverHint()`，后端 2026-10-10）：有发不了的人就橙字数一下，
 * 否则显示上次发送情况。
 */
function DriverHint({ d }: { d: DriverNotice }) {
  if (!d.people.length) {
    return (
      <p className={cn(RP_HINT, "m-0")}>
        No drivers on the schedule for this day yet.
      </p>
    );
  }
  const bad = d.people.filter((p) => !p.can_send).length;
  if (bad) {
    return (
      <p className={cn(RP_HINT, "m-0 text-[#fbbf6a]")}>
        <b className="font-[650]">
          {plural(bad, "driver")} can&rsquo;t be texted
        </b>{" "}
        — no mobile number or no login in HR.
      </p>
    );
  }
  return (
    <p className={cn(RP_HINT, "m-0")}>
      {lastSentText(d) ?? "Not sent yet for this day."}
    </p>
  );
}

/** 旧 `.rp-btn`：深底上的亮蓝（Pull from manifests / Send to driver）。 */
const RP_BTN =
  "h-[30px] rounded-lg border border-[#3b82f6] bg-[#3b82f6] px-3 text-[12.5px] font-semibold whitespace-nowrap text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b82f6] disabled:cursor-not-allowed disabled:opacity-50";
/** 旧 `.rp-box .rp-btn.green`：白框里的发送键，跟 Step 1 / 2 同一个尺寸。 */
const RP_BTN_GREEN =
  "h-8 rounded-[7px] border border-[#16a34a] bg-[#16a34a] px-3 text-[13px] font-semibold whitespace-nowrap text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b82f6] disabled:cursor-not-allowed disabled:opacity-50";
/** 旧 `.rp-sub`。 */
const RP_SUB = "text-[12.5px] text-[#94a3b8]";
/** 旧 `.rp-empty`（白框里）。 */
const RP_EMPTY = "m-0 px-4 py-2.5 text-[12.5px] text-[#1a1a1a]";
/** 旧 `.rp-hint`（深底上，`--muted`）；`.warn` 换橙字。 */
const RP_HINT = "text-[12.5px] text-[#94a3b8]";
/** 旧 `.rp-t th.chk, .rp-t td.chk`。 */
const CHK_CELL = "w-7 text-center";

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
  onCopyFirstRound,
}: {
  date: string;
  /** 排车页正在换天 / 保存：这时点了会对上一天操作，先关着。 */
  disabled?: boolean;
  /** 排车页有没存的改动：Pull 读的是已保存的排车，要提醒；两个发送键关着，先回 Assign 存。 */
  dirty: boolean;
  onUnauthorized: () => void;
  /** 第 2 轮还没排车（没有车或只有空车）时才传：复制第 1 轮的车，切回 Assign 等人 Save。 */
  onCopyFirstRound?: () => void;
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
  /** 收起状态那一行提示用的名单：打开这一天就自动拉一次（不用点 Check the list），点开 / 发完跟着更新。 */
  const [hint, setHint] = useState<DriverNotice | null>(null);
  /**
   * 这次取消勾选的司机 key。记「没勾的」而不是「勾了的」：默认全勾，重读名单后新出现的能发的人
   * 也是勾上的（同旧页面每次渲染都从全勾开始）。
   */
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());

  // 换天由父组件用 key 重建这个组件，所以挂载时拉一次就是「换天自动刷新提示」。
  // 出错就不显示提示，等点 Check the list 再报错（同旧 `loadDriverHint()`）。
  useEffect(() => {
    let alive = true;
    fetchDriverNotice(date)
      .then((d) => {
        if (alive) setHint(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [date]);

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
      const d = await fetchDriverNotice(date);
      setDrivers(d);
      setHint(d);
      // 每次列出名单（点 Check the list、发完重拉）都从全勾开始，同旧页面 renderDrivers()；
      // 只有 Send texts now 前的那次重读（askDrivers）保留这次的取消勾选。
      setSkipped(new Set());
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
      setHint(fresh);
      const canSend = fresh.people.filter((p) => p.can_send).length;
      if (!canSend) {
        setDriverError(
          changed
            ? "The driver list changed and no driver can be texted now. Check the table."
            : "No driver can be texted for this day.",
        );
        return;
      }
      const picked = pickedPeople(fresh, skipped);
      if (!picked.length) {
        setDriverError("No drivers selected.");
        return;
      }
      setConfirm({
        kind: "drivers",
        names: picked.map((p) => p.name),
        keys: picked.map((p) => p.key),
        skipped: canSend - picked.length,
        lastText: lastSentText(fresh),
        changed,
      });
    } catch (e) {
      fail(e, "Could not check the drivers", setDriverError);
    } finally {
      setCheckingDrivers(false);
    }
  }

  async function sendDrivers(keys: string[]): Promise<ActionResult> {
    try {
      const res = await sendDriverNotice(date, keys);
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
  const picked = drivers ? pickedPeople(drivers, skipped) : [];
  const allPicked = canText.length > 0 && picked.length === canText.length;

  function toggleDriver(key: string, on: boolean) {
    setSkipped((s) => {
      const next = new Set(s);
      if (on) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** 表头全选：只动能发的人（发不了的那几格本来就灰着、不勾）。 */
  function toggleAll(on: boolean) {
    setSkipped(on ? new Set() : new Set(canText.map((p) => p.key)));
  }

  return (
    <>
      <StepBox
        n={1}
        title="Send to drivers"
        desc={
          <>
            <p>
              <b>What the driver gets:</b> one text message with a link. The
              link opens <b>their own manifest on their phone</b> (they log in
              first): the bus they drive and the guests on it for this day.
            </p>
            <p>
              Relay drivers and tour bus drivers both get it. Guests get nothing
              from this step. Click Check the list to see the exact text and who
              will get it before anything is sent.
            </p>
          </>
        }
      >
        <div className="flex flex-wrap items-baseline gap-3">
          {/* 旧页面 2026-10-10 改名（`8cdacda`）：点了只是列出名单，真正发送是下面的 Send texts now。 */}
          <button
            type="button"
            disabled={loadingDrivers || disabled}
            onClick={() => void loadDrivers()}
            className={RP_BTN}
          >
            Check the list
          </button>
        </div>
        {hint ? <DriverHint d={hint} /> : null}

        <details className={RP_HOWTO}>
          <summary className={HOWTO_SUMMARY}>
            📖 How to use — Send to drivers
          </summary>
          <ol className={HOWTO_OL}>
            <li>
              Save the schedule on the Assign tab first. The list comes from the
              saved schedule.
            </li>
            <li>
              Click Check the list to see which drivers will get a text with the
              link to their page, then Send texts now. It asks once before
              sending.
            </li>
            <li>
              Uncheck a driver to skip them this time; the checkbox at the top
              of the list selects or clears everyone.
            </li>
            <li>
              A driver with no mobile number or no login in HR is listed with
              the reason and is not texted. Fix it in Human Resource, then click
              Check the list again.
            </li>
            <li>
              You can only send for today or tomorrow, or for a test day where
              every guest is a test order.
            </li>
          </ol>
        </details>

        {driverError ? (
          <p role="alert" className={cn(DARK_ERR, "m-0")}>
            {driverError}
          </p>
        ) : null}

        {drivers ? (
          <Box
            label="Send to driver"
            title="Send to driver"
            sub={`${plural(picked.length, "driver")} selected. ${lastText ?? "Not sent yet for this day."}`}
            action={
              <button
                type="button"
                disabled={
                  !picked.length || checkingDrivers || disabled || dirty
                }
                onClick={() => void askDrivers()}
                className={RP_BTN_GREEN}
              >
                {checkingDrivers ? "Checking…" : "Send texts now"}
              </button>
            }
          >
            <p className={RP_EMPTY}>
              <b>Text each driver gets:</b> {drivers.text}
            </p>
            {drivers.people.length ? (
              <Table
                head={["Driver", "Mobile", "Runs", "Can text?"]}
                lead={
                  <input
                    type="checkbox"
                    aria-label="Select all drivers"
                    checked={allPicked}
                    disabled={!canText.length}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                }
              >
                {drivers.people.map((p) => (
                  <tr
                    key={p.key}
                    data-key={p.key}
                    // 旧 `.rp-t tr.off td`：发不了的那行灰字。
                    className={p.can_send ? "" : "text-[#9ca3af]"}
                  >
                    <td className={cn(TD, RP_PAD, CHK_CELL)}>
                      <input
                        type="checkbox"
                        aria-label={`Text ${p.name}`}
                        checked={p.can_send && !skipped.has(p.key)}
                        disabled={!p.can_send}
                        onChange={(e) => toggleDriver(p.key, e.target.checked)}
                      />
                    </td>
                    <td className={cn(TD, RP_PAD)}>{p.name}</td>
                    <td className={cn(TD, RP_PAD, MONO)}>{p.phone || "—"}</td>
                    <td className={cn(TD, RP_PAD)}>
                      {p.cars.map((c, j) => (
                        <div key={j}>
                          {[c.shift, c.tour, c.van].filter(Boolean).join(" · ")}
                        </div>
                      ))}
                    </td>
                    <td
                      className={cn(
                        TD,
                        p.can_send ? "" : "text-[12px] text-[#8a5a00]",
                      )}
                    >
                      {p.can_send ? "Yes" : p.why}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <p className={RP_EMPTY}>
                No drivers on the schedule for this day.
              </p>
            )}
          </Box>
        ) : null}
      </StepBox>

      <StepBox
        n={2}
        title="Morning Relay — text guests"
        desc="Text hotel guests their morning pickup. Guests go to the 1st or 2nd Round by their tour, on the car that stops at their hotel."
      >
        <div className="flex flex-wrap items-baseline gap-3">
          <button
            type="button"
            disabled={pulling || disabled}
            onClick={() => void pull()}
            className={RP_BTN}
          >
            {pulling ? "Pulling…" : "Pull from manifests"}
          </button>
          <span className={RP_SUB}>
            {dirty
              ? "This day has unsaved changes — Pull uses the saved schedule. Save first."
              : "Save the Morning Relay cars and hotels on the Assign tab first, then pull."}
          </span>
        </div>

        <details className={RP_HOWTO}>
          <summary className={HOWTO_SUMMARY}>
            📖 How to use — Morning Relay
          </summary>
          <ol className={HOWTO_OL}>
            <li>
              On the Assign tab, check that each tour&rsquo;s guest list is in
              Step 1 (it comes from the main manifest), and save the Morning
              Relay cars and hotels for both rounds in Step 2.
            </li>
            <li>
              Click Pull from manifests. Each guest goes to the round of their
              tour (set for each tour in Settings → Products → Bus Manifest
              setup, Morning Relay round), on the car that stops at their hotel.
              The times on each round are only a guide.
            </li>
            <li>
              Guests on a tour with no round (for example Hoover Dam) are not in
              the relay: their tour bus picks them up.
            </li>
            <li>
              The pickup time shown and texted is the Rezdy time minus 15
              minutes.
            </li>
            <li>
              Check Need a look: no car stops at that hotel in that round, the
              hotel name was not recognised, or the time in Rezdy could not be
              read. Fix it and pull again.
            </li>
            <li>
              Keep the Rezdy times as they are; do not take 15 minutes off
              yourself. The pickup time on the manifest, the driver page and the
              Morning Relay text is worked out as the Rezdy time minus 15
              minutes.
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
          <p role="alert" className={cn(DARK_ERR, "m-0")}>
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
                    <span className="flex flex-wrap items-center gap-2.5">
                      {code === "relay_2" && onCopyFirstRound ? (
                        // 第 2 轮还没排车：同 Assign 那里的 Copy 1st Round（白键，不是提交）。
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={onCopyFirstRound}
                          className={ADDVAN}
                        >
                          Copy 1st Round
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={
                          !waiting || checking !== null || disabled || dirty
                        }
                        onClick={() => void askRound(code)}
                        className={RP_BTN_GREEN}
                      >
                        {checking === code ? "Checking…" : label}
                      </button>
                    </span>
                  }
                >
                  {res ? (
                    // 发送结果照全站发送页的格式（同 Morning Pickup 发送页：结果数字 + 逐单表）。
                    <div role="status" className="border-b-[0.5px] border-black/[.08] px-4 pt-3">
                      <MorningResults
                        sending={false}
                        sendType="sms"
                        orders={(res.results ?? []).map((r) => r.order)}
                        results={res.results ?? []}
                        alreadySent={res.already_sent}
                        label={`${roundTitle(code)} · ${date}`}
                        stop={null}
                        onClose={() =>
                          setResults((r) => {
                            const next = { ...r };
                            delete next[code];
                            return next;
                          })
                        }
                      />
                      {res.failed ? (
                        <p className="-mt-2 mb-3 text-[12px] text-[#b3261e]">
                          The booking team gets an email about the failed ones.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {cars.length ? (
                    <Table head={GUEST_HEAD}>
                      {cars.map((b) => (
                        <CarRows key={b.car.id} car={b.car} guests={b.guests} />
                      ))}
                    </Table>
                  ) : (
                    <p className={RP_EMPTY}>No cars in this round.</p>
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
                <p className={RP_EMPTY}>Nothing to check.</p>
              )}
            </Box>
            {data.departure ? (
              <p className={cn(RP_SUB, "m-0")}>
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
          onConfirm={() => sendDrivers(confirm.keys)}
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
          {confirm.skipped ? (
            <p>
              {confirm.skipped} selected driver(s) will NOT receive this
              message.
            </p>
          ) : null}
          {confirm.lastText ? (
            <p>{confirm.lastText} They will get it again.</p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}

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
      // 旧 `.rp-box`：白框，头 = 粗体标题 + 灰字 + 右边按钮。
      className="max-w-full overflow-hidden rounded-xl border-[0.5px] border-black/10 bg-paper text-[#1a1a1a]"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-[#e5e7eb] bg-paper px-[18px] py-3">
        <b className="text-[15px] text-[#111827]">{title}</b>
        <span className="text-[12.5px] text-[#1a1a1a]">{sub}</span>
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Table({
  head,
  lead,
  children,
}: {
  head: string[];
  /** 表头最前面的一格（司机名单的全选框）；没有就不加这一列。 */
  lead?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-[13px] tabular-nums">
        <thead>
          <tr>
            {lead ? (
              <th className={cn(TH, "py-1.5", CHK_CELL)}>{lead}</th>
            ) : null}
            {head.map((h) => (
              <th
                key={h}
                className={cn(TH, "py-1.5", h === "Pax" && "text-right")}
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
      <tr>
        <td colSpan={7} className={cn(TD, RP_PAD, "bg-[#eef4fb] font-[650]")}>
          {car.van || "No vehicle"} · {car.driver || "No driver"} ·{" "}
          {plural(guests.length, "order")}, {paxOf(guests)} pax
        </td>
      </tr>
      {guests.length ? (
        guests.map((g, i) => <GuestRow key={i} g={g} />)
      ) : (
        <tr>
          <td
            colSpan={7}
            className={cn(TD, "px-4 py-2.5 text-[12.5px] text-[#1a1a1a]")}
          >
            No guests for this car.
          </td>
        </tr>
      )}
    </>
  );
}

function GuestRow({ g, why }: { g: RelayGuest; why?: string }) {
  return (
    <tr data-order={g.order_number}>
      <td className={cn(TD, RP_PAD, MONO)}>{g.order_number}</td>
      <td className={cn(TD, RP_PAD, MONO)}>{g.pickup_time}</td>
      <td className={cn(TD, RP_PAD)}>{g.pickup_location}</td>
      <td className={cn(TD, RP_PAD)}>{g.name}</td>
      <td className={cn(TD, RP_PAD, "text-right")}>{g.pax ?? ""}</td>
      <td className={cn(TD, RP_PAD)}>{g.tour}</td>
      {why !== undefined ? (
        <td className={cn(TD, RP_PAD, "text-[12px] text-[#8a5a00]")}>{why}</td>
      ) : (
        <td className={cn(TD, RP_PAD, "whitespace-nowrap")}>
          <StatusPill g={g} />
        </td>
      )}
    </tr>
  );
}

/** 旧 `.rp-pill`。 */
const PILL =
  "inline-block rounded-full px-2 py-px text-[11px] font-[650] whitespace-nowrap";

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
