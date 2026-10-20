"use client";

import { Fragment, useEffect, useState } from "react";

import { MorningResults } from "@/components/morning-send/morning-results";
import {
  DUP_BADGE,
  RED_BOX,
  SEND_ANYWAY_ALL,
  SEND_ANYWAY_LABEL,
  TABLE as SEND_TABLE,
  TABLE_WRAP as SEND_TABLE_WRAP,
  TD as SEND_TD,
  TH as SEND_TH,
  TR as SEND_TR,
  YELLOW_BOX,
} from "@/components/tickets-send/legacy-ui";
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
  // 点了先弹确认框、框里再点才真发，所以键名不写 Send（Annie 2026-10-18：「send 1st round 给人的感觉就是点了就发送了」）。
  ["relay", "Preview & send"],
  ["relay_2", "Preview & send"],
];

type RoundResult = Awaited<ReturnType<typeof sendRelayRound>>;

/** 确认框里逐单名单的一行。 */
interface ConfirmGuest {
  order: string;
  name: string;
  pax: number | null;
  pickup: string;
  car: string;
  /** 发过、勾了 Send anyway 重发的。 */
  again: boolean;
}

type Confirm =
  | {
      kind: "round";
      code: string;
      title: string;
      /** 这次发的订单号（没发过的 + Send anyway 的）。 */
      orders: string[];
      /** 会发给谁（同 orders，带名字 / 接客点 / 车）。 */
      sendRows: ConfirmGuest[];
      /** 不会发的车（缺司机 / 没排接客站点）和勾了的、在这些车上的客人。 */
      blocked: { car: string; problems: string[]; rows: ConfirmGuest[] }[];
      /** 其中勾了 Send anyway 重发的。 */
      again: string[];
      /** 发过、没勾 Send anyway、这次跳过的单数。 */
      alreadySent: number;
      /** 页面上还是没发过、但拉名单之后别人已经发了的（服务端会跳过）。 */
      sentSincePull: string[];
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

/** 能勾的客人：No show 不发（同以前）。 */
const pickable = (g: RelayGuest) => g.relay_status !== "no_show";

/** 发过的那一行的标签「Sent by 谁 on 时间」（同全站发送表格）。 */
function sentLabel(g: RelayGuest): string {
  if (!g.sent_at) return "Sent";
  const at = new Date(g.sent_at);
  const when = Number.isNaN(at.getTime())
    ? g.sent_at
    : LAST_FORMAT.format(at).replace(/\s/g, " ");
  return `Sent by ${g.sent_by || "staff"} on ${when}`;
}

const uniq = (list: string[]) => [...new Set(list)];

/** 一行的勾选：没发过的默认勾（记取消的），发过的勾 Send anyway 才发（记勾了的）。按订单号认人。 */
interface Pick {
  chosen: (g: RelayGuest) => boolean;
  again: (g: RelayGuest) => boolean;
  setChosen: (list: RelayGuest[], on: boolean) => void;
  setAgain: (list: RelayGuest[], on: boolean) => void;
}

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

type DriverPerson = DriverNotice["people"][number];

/** 开 Morning Relay 车的人（shift 是 relay / relay_2）；既开 relay 又开 Tour 的也算。 */
const runsRelay = (p: DriverPerson) =>
  p.cars.some((c) => c.shift.startsWith("relay"));

/**
 * 列出名单时默认不勾的人：只开 Tour / Private 车的（Annie 2026-10-18：「早班自动勾选 relay，出现的清单是当天全部排了班的司机」）。
 * 那天一台 relay 车都没有就回到全勾（不然一个都没勾）。
 */
function defaultSkipped(people: DriverPerson[]): Set<string> {
  if (!people.some(runsRelay)) return new Set();
  return new Set(people.filter((p) => !runsRelay(p)).map((p) => p.key));
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

/** 把短信里的网址变成可点的链接（新标签页打开），其余原样。 */
function linkify(text: string) {
  return text.split(/(https?:\/\/\S+)/).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="break-all text-[#7dd3fc] underline"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

/**
 * 发给司机 / 导游的原文，打开这一天就显示，不用先点 Check the list（Annie 2026-10-15：「还是要显示一下发给司机和导游的内容是什么」）。
 * 司机的原文是后端拼好的（`GET /api/dispatch/driver-notice` 的 text，链接在最后）；导游现在不发（后端：导游账号还没建）。
 */
function OutgoingTexts({ text }: { text: string }) {
  return (
    <div data-outgoing-texts className="mb-3 grid gap-2 sm:grid-cols-2">
      <div className="rounded-lg border border-white/10 bg-white/[.04] px-3 py-2">
        <div className="mb-1 text-[12px] font-semibold text-[#cbd5e1]">
          Text to drivers
        </div>
        <p
          data-driver-text
          className="m-0 text-[13px] leading-relaxed text-[#e2e8f0]"
        >
          {linkify(text)}
        </p>
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[.04] px-3 py-2">
        <div className="mb-1 text-[12px] font-semibold text-[#cbd5e1]">
          Text to guides
        </div>
        <p
          data-guide-text
          className="m-0 text-[13px] leading-relaxed text-[#94a3b8]"
        >
          Guides don&rsquo;t get a text yet — guide logins aren&rsquo;t set up.
        </p>
      </div>
    </div>
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
  // G129：确认框里「被挡的车」上勾了 Send anyway 的订单号（每次打开确认框都从全不勾开始）。
  const [blockAny, setBlockAny] = useState<Set<string>>(() => new Set());
  /** Send to driver 在自己那一块，出错写在那一块里（不写进早班发送那一块，人看不到）。 */
  const [driverError, setDriverError] = useState<string | null>(null);
  /** 收起状态那一行提示用的名单：打开这一天就自动拉一次（不用点 Check the list），点开 / 发完跟着更新。 */
  const [hint, setHint] = useState<DriverNotice | null>(null);
  /**
   * 这次取消勾选的司机 key。记「没勾的」而不是「勾了的」：默认全勾，重读名单后新出现的能发的人
   * 也是勾上的（同旧页面每次渲染都从全勾开始）。
   */
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  /** Morning Relay：没发过、这次取消勾选的订单号。 */
  const [guestOff, setGuestOff] = useState<ReadonlySet<string>>(new Set());
  /** Morning Relay：发过、勾了 Send anyway 的订单号。 */
  const [guestAgain, setGuestAgain] = useState<ReadonlySet<string>>(new Set());

  const toggleSet =
    (set: typeof setGuestOff) => (list: RelayGuest[], add: boolean) =>
      set((prev) => {
        const next = new Set(prev);
        for (const g of list)
          if (add) next.add(g.order_number);
          else next.delete(g.order_number);
        return next;
      });
  const guestPick: Pick = {
    chosen: (g) =>
      pickable(g) &&
      (g.sent ? guestAgain.has(g.order_number) : !guestOff.has(g.order_number)),
    again: (g) => pickable(g) && g.sent && guestAgain.has(g.order_number),
    setChosen: (list, on) => toggleSet(setGuestOff)(list, !on),
    setAgain: toggleSet(setGuestAgain),
  };

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
      // 每次拉名单都从默认开始：没发过的全勾、Send anyway 全不勾（同其他发送页每次预览）。
      setGuestOff(new Set());
      setGuestAgain(new Set());
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

  /**
   * 先问服务端现在谁已经发过（拉名单之后别人可能发了），再按勾的人确认一次。
   * 只发勾的单；发过的只有勾了 Send anyway 才发。
   */
  async function askRound(code: string) {
    const guests = (data?.rounds[code] ?? []).flatMap((b) => b.guests);
    const fresh = uniq(
      guests
        .filter((g) => !g.sent && guestPick.chosen(g))
        .map((g) => g.order_number),
    );
    const again = uniq(
      guests.filter((g) => guestPick.again(g)).map((g) => g.order_number),
    );
    if (!fresh.length && !again.length) {
      setError("Tick at least one guest.");
      return;
    }
    setChecking(code);
    setError(null);
    try {
      const p = await fetchRelaySendPreview(date, code);
      const sentNow = new Set(p.already_sent_orders ?? []);
      const sentSincePull = fresh.filter((o) => sentNow.has(o));
      const wanted = [...fresh.filter((o) => !sentNow.has(o)), ...again];
      // 缺司机 / 没站点的车整车不发（后端 G108）：这些车上的客人不进「会发」，单独列在「不会发」里。
      const blockedOrders = new Set(
        (p.blocked_cars ?? []).flatMap((c) => c.orders),
      );
      const orders = wanted.filter((o) => !blockedOrders.has(o));
      const info = new Map<string, ConfirmGuest>();
      for (const b of data?.rounds[code] ?? [])
        for (const g of b.guests)
          info.set(g.order_number, {
            order: g.order_number,
            name: g.name,
            pax: g.pax,
            pickup: [g.pickup_time, g.pickup_location]
              .filter(Boolean)
              .join(" · "),
            car:
              [b.car.van, b.car.driver].filter(Boolean).join(" · ") ||
              "No vehicle",
            again: again.includes(g.order_number),
          });
      const rowOf = (o: string): ConfirmGuest =>
        info.get(o) ?? {
          order: o,
          name: "",
          pax: null,
          pickup: "",
          car: "",
          again: false,
        };
      const blocked = (p.blocked_cars ?? []).map((c) => ({
        car: c.car,
        problems: c.problems,
        rows: c.orders.filter((o) => wanted.includes(o)).map(rowOf),
      }));
      // 勾的客人全在被挡的车上：不弹确认框，写原因（Annie 2026-10-19「还是保留以前的写法吧」，没有 Send anyway 的入口）。
      if (!orders.length) {
        setError(
          blocked.length
            ? `None of the ticked guests in ${roundTitle(code)} can be texted. ${blocked
                .map((c) => `${c.car}: ${c.problems.join("; ")}.`)
                .join(" ")} Fix the cars on the Assign tab, then pull again.`
            : `The ticked guests in ${roundTitle(code)} were already sent by someone else. Pull again to see who sent them.`,
        );
        return;
      }
      const sentOrders = uniq(
        guests.filter((g) => g.sent && pickable(g)).map((g) => g.order_number),
      );
      setBlockAny(new Set());
      setConfirm({
        kind: "round",
        code,
        title: roundTitle(code),
        orders,
        sendRows: orders.map(rowOf),
        blocked,
        again: again.filter((o) => !blockedOrders.has(o)),
        alreadySent: sentOrders.length - again.length,
        sentSincePull,
      });
    } catch (e) {
      fail(e, "Could not check the round");
    } finally {
      setChecking(null);
    }
  }

  async function sendRound(
    code: string,
    orders: string[],
    again: string[],
    /** G129：勾了 Send anyway 的、被挡的车上的订单号（也在 orders 里）；anyAgain = 其中以前发过的。 */
    overridden: string[] = [],
    anyAgain: string[] = [],
  ): Promise<ActionResult> {
    try {
      // Send anyway 只重发「最近一次发送不晚于拉名单那一刻」的（拉名单之后别人又发过的照样跳过）。
      const resend = again.length && data?.checked_at ? again : [];
      const sendAnyway = uniq([...resend, ...overridden]);
      const res = await sendRelayRound(date, code, {
        order_numbers: orders,
        ...(sendAnyway.length
          ? {
              send_anyway: sendAnyway,
              ...((resend.length || anyAgain.length) && data?.checked_at
                ? { preview_at: data.checked_at }
                : {}),
            }
          : {}),
      });
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
      // 每次列出名单（点 Check the list、发完重拉）都从默认开始：开 relay 车的人勾上、只开 Tour / Private 的不勾；
      // 只有 Send texts now 前的那次重读（askDrivers）保留这次的勾选。
      setSkipped(defaultSkipped(d.people));
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
      // 重读后新出现的人按默认勾（别的人保留这次的勾选）。
      const known = new Set(drivers.people.map((p) => p.key));
      const dflt = defaultSkipped(fresh.people);
      const skipNow = new Set(skipped);
      for (const p of fresh.people)
        if (!known.has(p.key) && dflt.has(p.key)) skipNow.add(p.key);
      setSkipped(skipNow);
      const picked = pickedPeople(fresh, skipNow);
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

  // G129：确认框里被挡的车上勾了 Send anyway 的客人（会跟着发出去）。
  const anyRows =
    confirm?.kind === "round"
      ? confirm.blocked
          .flatMap((c) => c.rows)
          .filter((r) => blockAny.has(r.order))
      : [];

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
              from this step. Click Check the list to see who will get it before
              anything is sent.
            </p>
          </>
        }
      >
        {hint ? <OutgoingTexts text={hint.text} /> : null}
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
              Click Check the list, then Send texts now. Drivers with a Morning
              Relay car are ticked; tick or untick anyone.
            </li>
            <li>
              A driver with no mobile number or no login is listed with the
              reason. Fix it in Human Resource, then Check the list again.
            </li>
            <li>You can only send for today or tomorrow.</li>
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
              ? "Assign is not saved yet - Pull uses the saved schedule."
              : "Pull uses the Morning Relay cars and hotels saved on the Assign tab."}
          </span>
        </div>

        <details className={RP_HOWTO}>
          <summary className={HOWTO_SUMMARY}>
            📖 How to use — Morning Relay
          </summary>
          <ol className={HOWTO_OL}>
            <li>
              Click Pull from manifests, check Need a look, then Preview & send
              for the 1st or 2nd Round. A car needs a driver and at least one
              pickup stop, or its guests are not texted.
            </li>
            <li>
              Need a look: no car stops at that hotel, the hotel name was not
              recognised, or the Rezdy time could not be read. Fix it on the
              Assign tab and pull again.
            </li>
            <li>
              Guests who already got the text are skipped. Tick Send anyway to
              text them again (for example Changed after sent).
            </li>
            <li>
              Under each car, guests are grouped by hotel. Use the button on a
              hotel&rsquo;s bar to select or deselect everyone not sent yet at
              that hotel. For guests already sent at that hotel, Send anyway
              (all) ticks them all to text them again. Select all never ticks
              guests who were already sent.
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
              const badCars = cars.filter((b) => b.car.problems?.length);
              const waiting = all.filter((g) => !g.sent).length;
              const fresh = all.filter((g) => pickable(g) && !g.sent);
              const done = all.filter((g) => pickable(g) && g.sent);
              const ticked = all.some((g) => guestPick.chosen(g));
              const allFresh =
                fresh.length > 0 && fresh.every((g) => guestPick.chosen(g));
              const allAgain =
                done.length > 0 && done.every((g) => guestPick.again(g));
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
                          !ticked || checking !== null || disabled || dirty
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
                    <div
                      role="status"
                      className="border-b-[0.5px] border-black/[.08] px-4 pt-3"
                    >
                      {/* 整轮只有被挡的车时 sent 是 0、results 空：不画「0 位」的结果卡，只写没发的车。 */}
                      {res.results?.length || !res.blocked_cars?.length ? (
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
                      ) : null}
                      {res.blocked_cars?.length ? (
                        <div
                          data-relay-blocked
                          className={cn(RED_BOX, "max-w-none")}
                        >
                          <b className="block">
                            {res.results?.length
                              ? "These cars were not sent"
                              : "Nothing was sent for these cars"}
                          </b>
                          {res.blocked_cars.map((c) => (
                            <div key={c.car_id}>
                              {c.car}: {c.problems.join("; ")} —{" "}
                              {c.orders.length
                                ? `orders ${c.orders.join(", ")}`
                                : "no guests"}
                            </div>
                          ))}
                          <div className="text-[11.5px]">
                            Fix the car on the Assign tab, pull again, then send
                            this round.
                          </div>
                          {!res.results?.length ? (
                            <button
                              type="button"
                              onClick={() =>
                                setResults((r) => {
                                  const next = { ...r };
                                  delete next[code];
                                  return next;
                                })
                              }
                              className="mt-1 text-[12px] underline"
                            >
                              Dismiss
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {res.failed ? (
                        <p className="-mt-2 mb-3 text-[12px] text-[#b3261e]">
                          The booking team gets an email about the failed ones.
                        </p>
                      ) : null}
                      {res.already_sent_orders?.length || res.resent?.length ? (
                        <div data-relay-skipped className={YELLOW_BOX}>
                          {res.already_sent_orders?.length ? (
                            <div>
                              Skipped, already sent:{" "}
                              {res.already_sent_orders.join(", ")}.
                            </div>
                          ) : null}
                          {res.resent?.length ? (
                            <div>
                              Sent again (Send anyway): {res.resent.join(", ")}.
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {res.not_on_round?.length ? (
                        <div
                          data-relay-not-on-round
                          className={cn(RED_BOX, "max-w-none")}
                        >
                          Not on this round any more, not sent:{" "}
                          {res.not_on_round.join(", ")}.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {cars.length ? (
                    <Table
                      head={GUEST_HEAD}
                      lead={
                        <input
                          type="checkbox"
                          aria-label={`Select all not sent in ${roundTitle(code)}`}
                          checked={allFresh}
                          disabled={!fresh.length}
                          onChange={(e) =>
                            guestPick.setChosen(fresh, e.target.checked)
                          }
                        />
                      }
                      tail={
                        done.length ? (
                          <label className={SEND_ANYWAY_ALL}>
                            <input
                              type="checkbox"
                              aria-label={`Send anyway to everyone already sent in ${roundTitle(code)}`}
                              checked={allAgain}
                              onChange={(e) =>
                                guestPick.setAgain(done, e.target.checked)
                              }
                            />
                            Send anyway (all)
                          </label>
                        ) : (
                          ""
                        )
                      }
                    >
                      {cars.map((b) => (
                        <CarRows
                          key={b.car.id}
                          car={b.car}
                          guests={b.guests}
                          pick={guestPick}
                        />
                      ))}
                    </Table>
                  ) : (
                    <p className={RP_EMPTY}>No cars in this round.</p>
                  )}
                  {badCars.length ? (
                    <p
                      data-relay-blocked-note
                      className="m-0 px-[18px] py-2 text-[12.5px] text-[#b3261e]"
                    >
                      {plural(badCars.length, "car")} blocked (
                      {badCars
                        .map((b) => b.car.van || `#${b.car.id}`)
                        .join(", ")}
                      ): their guests will not be texted. Fix them on the Assign
                      tab and pull again.
                    </p>
                  ) : null}
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
          title={`Preview & send · ${confirm.title}`}
          confirmLabel={`Send to ${plural(confirm.orders.length + anyRows.length, "guest")}`}
          busyLabel="Sending…"
          wide
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            sendRound(
              confirm.code,
              [...confirm.orders, ...anyRows.map((r) => r.order)],
              confirm.again,
              anyRows.map((r) => r.order),
              anyRows.filter((r) => r.again).map((r) => r.order),
            )
          }
        >
          <p>
            Send the Morning Pickup text for <b>{date}</b>. Check who gets it:
          </p>
          <div data-will-send>
            <b className="mb-1 block text-[#14532d]">
              Will be sent ·{" "}
              {plural(confirm.sendRows.length + anyRows.length, "guest")}
            </b>
            <ConfirmTable rows={confirm.sendRows} showCar />
          </div>
          {confirm.blocked.length ? (
            <div data-will-not-send className={cn(RED_BOX, "max-w-none")}>
              <b className="block">
                Will NOT be sent ·{" "}
                {plural(
                  confirm.blocked.reduce((n, c) => n + c.rows.length, 0) -
                    anyRows.length,
                  "guest",
                )}{" "}
                ({plural(confirm.blocked.length, "car")} blocked)
              </b>
              {confirm.blocked.map((c, i) => (
                <div key={i} className="mt-1.5">
                  <div className="font-semibold">
                    {c.car}: {c.problems.join("; ")}
                  </div>
                  {c.rows.length ? (
                    <ConfirmTable
                      rows={c.rows}
                      anyway={{
                        checked: blockAny,
                        onChange: (orders, on) =>
                          setBlockAny((s) => {
                            const n = new Set(s);
                            for (const o of orders) {
                              if (on) n.add(o);
                              else n.delete(o);
                            }
                            return n;
                          }),
                      }}
                    />
                  ) : (
                    <div className="text-[11.5px]">No guests on this car.</div>
                  )}
                </div>
              ))}
            </div>
          ) : null}
          {anyRows.length ? (
            <div data-send-anyway-note className={cn(YELLOW_BOX, "max-w-none")}>
              <b>{plural(anyRows.length, "guest")}</b> will go out even though
              their car is blocked:{" "}
              {confirm.blocked
                .flatMap((c) => {
                  const orders = c.rows
                    .filter((r) => blockAny.has(r.order))
                    .map((r) => r.order);
                  return orders.length
                    ? [
                        `${c.car}: ${c.problems.join("; ")} (${orders.join(", ")})`,
                      ]
                    : [];
                })
                .join(" · ")}
              . This is recorded in Send Log.
            </div>
          ) : null}
          {confirm.again.length ? (
            <p>
              {confirm.orders.length - confirm.again.length} not sent yet ·{" "}
              <b>{confirm.again.length} again</b> (Send anyway:{" "}
              {confirm.again.join(", ")}).
            </p>
          ) : null}
          {confirm.alreadySent ? (
            <p>{confirm.alreadySent} already sent before will be skipped.</p>
          ) : null}
          {confirm.sentSincePull.length ? (
            <p className="font-medium text-[#8a5a00]">
              Sent by someone else since you pulled, skipped:{" "}
              {confirm.sentSincePull.join(", ")}.
            </p>
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
  "Status",
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
  tail,
  children,
}: {
  head: string[];
  /** 表头最前面的一格（全选框）；没有就不加这一列。 */
  lead?: React.ReactNode;
  /** 表头最后一格（Send anyway (all)）；undefined 就不加这一列，"" = 有这一列但表头空着。 */
  tail?: React.ReactNode;
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
            {tail !== undefined ? (
              <th className={cn(TH, "py-1.5 normal-case")}>{tail}</th>
            ) : null}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** 确认框里的逐单名单（会发 / 不会发共用，格式同全站发送页的表）。 */
function ConfirmTable({
  rows,
  showCar = false,
  anyway,
}: {
  rows: ConfirmGuest[];
  showCar?: boolean;
  /** G129：「不会发」表里每单旁的 Send anyway 勾选；没有就不加这一列。 */
  anyway?: {
    checked: Set<string>;
    onChange: (orders: string[], on: boolean) => void;
  };
}) {
  const head = [
    "Order #",
    "Guest",
    "Pax",
    "Pickup",
    ...(showCar ? ["Car"] : []),
  ];
  const allOn = !!anyway && rows.every((r) => anyway.checked.has(r.order));
  return (
    <div className={SEND_TABLE_WRAP}>
      <table className={SEND_TABLE}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className={SEND_TH}>
                {h}
              </th>
            ))}
            {anyway ? (
              <th className={SEND_TH}>
                <label className={SEND_ANYWAY_ALL}>
                  <input
                    type="checkbox"
                    data-send-anyway-all
                    checked={allOn}
                    onChange={(e) =>
                      anyway.onChange(
                        rows.map((r) => r.order),
                        e.target.checked,
                      )
                    }
                  />
                  Send anyway (all)
                </label>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.order}
              data-confirm-order={r.order}
              // 发过、勾了 Send anyway 重发的整行淡黄（同全站发送表格）；被挡的车上勾了 Send anyway 的也是。
              className={cn(
                SEND_TR,
                (r.again || anyway?.checked.has(r.order)) && "bg-[#fff8e1]",
              )}
            >
              <td className={cn(SEND_TD, MONO)}>{r.order}</td>
              <td className={SEND_TD}>{r.name}</td>
              <td className={SEND_TD}>{r.pax ?? ""}</td>
              <td className={SEND_TD}>{r.pickup}</td>
              {showCar ? (
                <td className={SEND_TD}>
                  {r.car}
                  {r.again ? (
                    <span className={cn(DUP_BADGE, "ml-1.5 inline-block")}>
                      Sent before, sending again
                    </span>
                  ) : null}
                </td>
              ) : null}
              {anyway ? (
                <td className={SEND_TD}>
                  <label className={SEND_ANYWAY_LABEL}>
                    <input
                      type="checkbox"
                      data-send-anyway={r.order}
                      checked={anyway.checked.has(r.order)}
                      onChange={(e) =>
                        anyway.onChange([r.order], e.target.checked)
                      }
                    />
                    Send anyway
                  </label>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 酒店小组的键和标题（后端 2026-10-19，Annie「relay 酒店可以动手」）：有 location_id 就按它分（同一家酒店 Rezdy 里可能写成好几种），
 * 没有（null / 旧后端）退回原始 pickup_location 文字，空的写 Unknown。分组只在一台车里面做，不改车头。
 */
function hotelOf(g: RelayGuest): { key: string; title: string } {
  const raw = (g.pickup_location ?? "").trim();
  if (g.location_id != null) {
    return { key: `id:${g.location_id}`, title: g.hotel || raw || "Unknown" };
  }
  return { key: `raw:${raw.toLowerCase()}`, title: raw || "Unknown" };
}

/** 一台车里的客人按酒店分组（组按第一次出现的顺序，组内保持原顺序）。 */
function groupByHotel(guests: RelayGuest[]) {
  const groups: { key: string; title: string; guests: RelayGuest[] }[] = [];
  const at = new Map<string, number>();
  for (const g of guests) {
    const h = hotelOf(g);
    const i = at.get(h.key);
    if (i === undefined) {
      at.set(h.key, groups.length);
      groups.push({ ...h, guests: [g] });
    } else {
      groups[i].guests.push(g);
    }
  }
  return groups;
}

/** 整组按钮：黑描边（蓝色只给提交键）；Send anyway 沿用现有橙色。 */
const HOTEL_BTN =
  "rounded-[5px] border-[0.5px] bg-white px-2.5 py-[3px] text-[11px] whitespace-nowrap hover:bg-[#f3f4f6]";

/**
 * 酒店小组头（夹在车头和客人行之间）。左边整组勾选只管这一组没发过的人（同旧 Morning 发送页：Select all 选不中已发过的）；
 * 右边 Send anyway (all N) 只管这一组已发过的人，绝不碰没发过的。
 */
function HotelRow({
  title,
  guests,
  pick,
}: {
  title: string;
  guests: RelayGuest[];
  pick: Pick;
}) {
  const fresh = guests.filter((g) => pickable(g) && !g.sent);
  const done = guests.filter((g) => pickable(g) && g.sent);
  const fc = fresh.filter((g) => pick.chosen(g)).length;
  const dc = done.filter((g) => pick.again(g)).length;
  return (
    <tr data-hotel-group={title}>
      <td
        colSpan={9}
        className={cn(
          TD,
          "border-t-[0.5px] border-black/[.06] bg-[#f7f9fc] px-4 py-1.5",
        )}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="flex-1 text-[12px] font-semibold text-[#334155]">
            📍 {title}{" "}
            <small className="font-medium text-[#1a1a1a]">
              · {plural(guests.length, "order")}
              {fresh.length !== guests.length
                ? ` · ${fresh.length} not sent`
                : ""}
            </small>
          </span>
          {fresh.length ? (
            <button
              type="button"
              data-hotel-toggle
              onClick={() => pick.setChosen(fresh, fc === 0)}
              className={cn(
                HOTEL_BTN,
                fc === 0
                  ? "border-[#bbb] text-[#6b7280]"
                  : "border-black/30 text-[#1a1a1a]",
              )}
            >
              {fc === 0
                ? "Select all"
                : fc === fresh.length
                  ? "Deselect all"
                  : `${fc}/${fresh.length} selected`}
            </button>
          ) : null}
          {done.length ? (
            <button
              type="button"
              data-hotel-anyway
              onClick={() => pick.setAgain(done, dc === 0)}
              className={cn(
                HOTEL_BTN,
                "border-[#BA7517] text-[#BA7517] hover:bg-[#FAEEDA]",
              )}
            >
              {dc === 0
                ? `Send anyway (all ${done.length})`
                : dc === done.length
                  ? `Cancel all ${done.length}`
                  : `${dc}/${done.length} will resend`}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function CarRows({
  car,
  guests,
  pick,
}: {
  car: {
    van: string | null;
    driver: string | null;
    problems?: string[];
  };
  guests: RelayGuest[];
  pick: Pick;
}) {
  // 缺司机 / 没排接客站点：这台车整车不发（后端 G108），车头标红写原因。
  const bad = !!car.problems?.length;
  return (
    <>
      <tr data-car-blocked={bad ? "" : undefined}>
        <td
          colSpan={9}
          className={cn(
            TD,
            RP_PAD,
            "font-[650]",
            bad ? "bg-[#fdeceb] text-[#b3261e]" : "bg-[#eef4fb]",
          )}
        >
          {car.van || "No vehicle"} · {car.driver || "No driver"} ·{" "}
          {plural(guests.length, "order")}, {paxOf(guests)} pax
          {bad ? (
            <span className="block text-[12px] font-medium">
              {car.problems?.join(" · ")}
            </span>
          ) : null}
        </td>
      </tr>
      {guests.length ? (
        groupByHotel(guests).map((h) => (
          <Fragment key={h.key}>
            <HotelRow title={h.title} guests={h.guests} pick={pick} />
            {h.guests.map((g, i) => (
              <GuestRow key={i} g={g} pick={pick} />
            ))}
          </Fragment>
        ))
      ) : (
        <tr>
          <td
            colSpan={9}
            className={cn(TD, "px-4 py-2.5 text-[12.5px] text-[#1a1a1a]")}
          >
            No guests for this car.
          </td>
        </tr>
      )}
    </>
  );
}

/** Need a look 的行没有 pick（不发，最后一格写原因）；两轮的行有勾选框和 Send anyway。 */
function GuestRow({
  g,
  why,
  pick,
}: {
  g: RelayGuest;
  why?: string;
  pick?: Pick;
}) {
  const sent = !!pick && g.sent && pickable(g);
  return (
    <tr
      data-order={g.order_number}
      // 发过的整行淡黄（同全站发送表格）。
      className={sent ? "bg-[#fff8e1]" : undefined}
    >
      {pick ? (
        <td className={cn(TD, RP_PAD, CHK_CELL)}>
          <input
            type="checkbox"
            data-pick={g.order_number}
            aria-label={`Text ${g.order_number}`}
            checked={pick.chosen(g)}
            // 发过的由 Send anyway 决定，这个框只跟着显示；No show 不发。
            disabled={g.sent || !pickable(g)}
            onChange={(e) => pick.setChosen([g], e.target.checked)}
          />
        </td>
      ) : null}
      <td className={cn(TD, RP_PAD, MONO)}>{g.order_number}</td>
      <td className={cn(TD, RP_PAD, MONO)}>{g.pickup_time}</td>
      <td className={cn(TD, RP_PAD)}>{g.pickup_location}</td>
      <td className={cn(TD, RP_PAD)}>{g.name}</td>
      <td className={cn(TD, RP_PAD, "text-right")}>{g.pax ?? ""}</td>
      <td className={cn(TD, RP_PAD)}>{g.tour}</td>
      {why !== undefined ? (
        <td className={cn(TD, RP_PAD, "text-[12px] text-[#8a5a00]")}>{why}</td>
      ) : (
        <td className={cn(TD, RP_PAD)}>
          <Status g={g} />
        </td>
      )}
      {pick ? (
        <td className={cn(TD, RP_PAD)}>
          {sent ? (
            <label className={SEND_ANYWAY_LABEL}>
              <input
                type="checkbox"
                data-again={g.order_number}
                checked={pick.again(g)}
                onChange={(e) => pick.setAgain([g], e.target.checked)}
              />
              Send anyway
            </label>
          ) : null}
        </td>
      ) : null}
    </tr>
  );
}

/** 旧 `.rp-pill`（只剩 No show 用）。 */
const PILL =
  "inline-block rounded-full px-2 py-px text-[11px] font-[650] whitespace-nowrap";

/** 没发过的空着；发过的用全站发送表格的黄标签「Sent by 谁 on 时间」，发过之后改了的下面橙字写改了什么。 */
function Status({ g }: { g: RelayGuest }) {
  if (g.relay_status === "no_show") {
    return (
      <span className={cn(PILL, "bg-[#fdeceb] text-[#b3261e]")}>No show</span>
    );
  }
  if (!g.sent) return null;
  return (
    <>
      <span data-sent-label className={cn(DUP_BADGE, "inline-block")}>
        {sentLabel(g)}
      </span>
      {g.changed?.length ? (
        <span data-changed className="mt-0.5 block text-[11px] text-[#8a5a00]">
          Changed after sent: {g.changed.join("; ")}
        </span>
      ) : null}
    </>
  );
}
