"use client";

import { useEffect, useRef, useState } from "react";

import {
  DARK_ERR,
  HOWTO_OL,
  MUTED,
  TM_BTN,
  TM_BTN_BLUE,
} from "@/components/dispatch/legacy-styles";
import { StepBox } from "@/components/dispatch/step-box";
import { BusIcon } from "@/components/dispatch/icons";
import { describeError, isStatus } from "@/lib/api-errors";
import {
  fetchManifestCards,
  fetchPending,
  markGuestListsDone,
  markPendingHandled,
} from "@/lib/dispatch-manifest-api";
import { PendingChanges } from "@/components/dispatch-manifest/pending-changes";
import { LA_TIME_ZONE } from "@/lib/la-date";
import { cn } from "@/lib/utils";
import { PageLink } from "@/components/ui/page-link";
import type {
  DispatchPendingItem,
  DispatchSyncResult,
  GuestListsDone,
  ManifestCard,
} from "@/types";

/** 排车页最近一次名单同步（G35）：成功的结果，或失败原因。 */
export type SyncInfo =
  | { date: string; result: DispatchSyncResult; error?: undefined }
  | { date: string; error: string; result?: undefined };

type CardsState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      cards: ManifestCard[];
      guestListsDone: GuestListsDone | null;
    };

const DONE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  dateStyle: "short",
  timeStyle: "medium",
});

/**
 * 显示顺序（Annie 2026-10-12，名单改成同步以后；取代旧页面「没传的在前、传完的排最后」）：
 * 有客人、还要处理（团名下有橙字，例如要排车）的在最前；有客人、没问题的其次；没客人的（多半这天没单）排最后。
 * 同一组里维持原顺序（排车页的块顺序）。只排一份副本，不改原数组。
 */
function displayOrder(
  cards: ManifestCard[],
  pendingByTour: ReadonlyMap<number, number>,
): ManifestCard[] {
  // Completed 之后有变化的团（G56）也算「还要处理」。
  const rank = (c: ManifestCard) =>
    pendingByTour.get(c.manifest_id) ? 0 : !c.uploaded ? 2 : warnState(c) ? 0 : 1;
  return cards.slice().sort((a, b) => rank(a) - rank(b));
}

// 卡上只放车数和人数，照旧版 _tour_manifests_panel.html（Annie 2026-10-08 再确认：「不需要放餐之类的详情」）：
// 午餐、订单数、谁传的都不放；要留意的事只进右上角小标签。
function busText(n: number) {
  return n === 0
    ? "No bus assigned"
    : `${n} bus${n === 1 ? "" : "es"} assigned`;
}

/**
 * 排车页的 Step 1 Guest lists：每个 bus tour 一张卡。名单从主 Manifest 同步（G35，Annie 2026-10-12：
 * 排车页打开 / 换天时由排车页先调同步，这里只读卡片）；ops 不再上传 Rezdy CSV，旧网站的手动上传留作后备。
 * 车数来自排车页**已保存**的排车（同旧页面 _tour_manifests_panel.html）。
 */
export function ManifestsPanel({
  date,
  version = 0,
  sync,
  onUnauthorized,
  onAssignBus,
  onSeatGuests,
  onGuestListsDone,
  onCards,
  onCompletedState,
}: {
  date: string;
  /** 变了就重读卡片（排车页每次保存 / 重读之后：车数读的是已保存的排车）。 */
  version?: number;
  /** 这一天的名单同步结果（排车页传进来）；null = 还没同步 / 不是这一天的。 */
  sync: SyncInfo | null;
  onUnauthorized: () => void;
  /** 卡片上的 Check the bus（原 Assign Bus）：滚到 Step 2 里这个团的车（卡片是排车页画的，由它滚）。 */
  onAssignBus: (manifestId: number) => void;
  /** 卡片上的 Seat guests：滚到 Step 2 里这个团的车并展开车下面的名单（ops 没有单独的 Step 3）。 */
  onSeatGuests?: (manifestId: number) => void;
  /** 点 Completed 成功：滚到 Step 2 开头（同上，由排车页滚）。 */
  onGuestListsDone: () => void;
  /** 每次读到这一天的卡片（换天、同步、保存后）：排车页据此按人数补开车窗（G29 第 3 条）。 */
  onCards?: (date: string, cards: ManifestCard[]) => void;
  /**
   * 这一天点没点过 Completed、Completed 之后新进来的单（G56）：排车页据此在车下面的名单里关掉 Auto、
   * 给新单标「New after Completed」（Completed 之后后端不再自动分车）。
   */
  onCompletedState?: (
    date: string,
    state: { completed: boolean; newOrders: string[] },
  ) => void;
}) {
  const [completing, setCompleting] = useState(false);
  const [state, setState] = useState<CardsState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const onCardsRef = useRef(onCards);
  onCardsRef.current = onCards;
  const onCompletedRef = useRef(onCompletedState);
  onCompletedRef.current = onCompletedState;
  const [pending, setPending] = useState<DispatchPendingItem[]>([]);
  // 待处理接口读到过（不是 404）= 后端 G56 已上线：那以后 Completed 的日子后端才不自动分车，车下面的名单才关掉 Auto。
  const [pendingLive, setPendingLive] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState(0);

  // 换天：丢掉上次的提示。
  useEffect(() => {
    setError(null);
  }, [date]);

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => (s.kind === "ready" ? s : { kind: "loading" }));
    fetchManifestCards(date, controller.signal)
      .then((r) => {
        setState({ kind: "ready", ...r });
        onCardsRef.current?.(date, r.cards);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 401)) onUnauthorizedRef.current();
        else setState({ kind: "error", message: describeError(e) });
      });
    return () => controller.abort();
  }, [date, reloadKey, version]);

  // Completed 之后的变化（G56）：和卡片一起重读；标过已处理再读一次。接口还没上线（404）时当没有，不报错。
  useEffect(() => {
    const controller = new AbortController();
    fetchPending(date, controller.signal)
      .then((items) => {
        setPending(items);
        setPendingLive(true);
        setPendingError(null);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 401)) onUnauthorizedRef.current();
        else if (isStatus(e, 404)) {
          setPending([]);
          setPendingLive(false);
        } else setPendingError(describeError(e));
      });
    return () => controller.abort();
  }, [date, reloadKey, version, pendingKey]);

  const completed =
    pendingLive && state.kind === "ready" && !!state.guestListsDone;
  const newOrders = pending
    .filter((p) => p.kind === "added")
    .map((p) => p.order_number)
    .join("|");
  useEffect(() => {
    if (state.kind !== "ready") return;
    onCompletedRef.current?.(date, {
      completed,
      newOrders: newOrders ? newOrders.split("|") : [],
    });
  }, [date, state.kind, completed, newOrders]);

  async function handled(which: { ids: number[] } | { all: true }) {
    try {
      await markPendingHandled(date, which);
    } catch (e) {
      if (isStatus(e, 401)) {
        onUnauthorized();
        return;
      }
      throw new Error(describeError(e));
    }
    setPendingKey((k) => k + 1);
  }

  const pendingByTour = new Map<number, number>();
  for (const p of pending)
    pendingByTour.set(p.manifest_id, (pendingByTour.get(p.manifest_id) ?? 0) + 1);

  async function complete() {
    setCompleting(true);
    setError(null);
    try {
      await markGuestListsDone(date);
      setReloadKey((k) => k + 1);
      onGuestListsDone();
    } catch (e) {
      if (isStatus(e, 401)) onUnauthorized();
      else setError(`Could not mark this complete: ${describeError(e)}`);
    } finally {
      setCompleting(false);
    }
  }

  return (
    // 样子照旧页面 _tour_manifests_panel.html：How to use 在标题行右边（`.tm-howto`），
    // 上传后的一句话跟在说明后面（`.tm-msg`），卡片两列（`.tm-grid`）。
    <StepBox
      n={1}
      title="Guest lists"
      headExtra={<HowToUse />}
      desc={
        <p className="m-0">
          Guest lists come from the Manifests page and update each time you open
          this page or change the date. The buses on each card come from the
          schedule saved in Step 2.
        </p>
      }
    >
      {error ? (
        <p role="alert" className={cn(DARK_ERR, "m-0")}>
          {error}
        </p>
      ) : null}
      <SyncNotes
        sync={sync}
        cards={state.kind === "ready" ? state.cards : []}
      />
      {pendingError ? (
        <p role="alert" className={cn(DARK_ERR, "m-0")}>
          Could not load the changes after Completed: {pendingError}
        </p>
      ) : null}
      <PendingChanges items={pending} onHandled={handled} />

      {state.kind === "loading" ? (
        <p className={cn(MUTED, "m-0 text-[13px]")}>Loading…</p>
      ) : state.kind === "error" ? (
        <p role="alert" className={cn(DARK_ERR, "m-0")}>
          Could not load the tour manifests: {state.message}{" "}
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="underline"
          >
            Retry
          </button>
        </p>
      ) : state.cards.length === 0 ? (
        <p className={cn(MUTED, "m-0 text-[13px]")}>
          No bus tour sections on this day.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
          {displayOrder(state.cards, pendingByTour).map((c, i) => (
            <Card
              key={c.manifest_id}
              card={c}
              pendingCount={pendingByTour.get(c.manifest_id) ?? 0}
              tile={i % TILE.length}
              date={date}
              onAssignBus={() => onAssignBus(c.manifest_id)}
              onSeatGuests={() => onSeatGuests?.(c.manifest_id)}
            />
          ))}
        </div>
      )}

      {/* Completed（旧 `.tm-done`，G33）= staff 标「这一天的 Dispatch 做完了」（Annie 2026-10-12），跟名单齐不齐无关：
          这一天有团就一直显示。没点过是按钮，点过显示谁、几点；没有取消键。
          之后名单再变的单列在 Step 1 顶上的「changes after Completed」里（G56，PendingChanges）。 */}
      {state.kind === "ready" && state.cards.length > 0 ? (
        <div data-guest-lists-done className="text-center">
          {state.guestListsDone ? (
            // 状态用普通文字，不用蓝色（蓝色只给提交键）。
            <span className="text-[13px] text-[#cbd5e1]">
              Dispatch completed
              {state.guestListsDone.completed_by
                ? ` by ${state.guestListsDone.completed_by}`
                : ""}
              {state.guestListsDone.completed_at
                ? ` · ${DONE_FORMAT.format(new Date(state.guestListsDone.completed_at))}`
                : ""}
            </span>
          ) : (
            <button
              type="button"
              disabled={completing}
              onClick={() => void complete()}
              className={TM_BTN_BLUE}
            >
              Completed — this day&rsquo;s dispatch is done
            </button>
          )}
        </div>
      ) : null}
    </StepBox>
  );
}

/** 图标块颜色按卡片序号轮流，只是好认，没有含义（旧 `.tm-tile.c0`–`c3`）。 */
const TILE = [
  "bg-[#e3edff] text-[#2563eb]",
  "bg-[#e3f5ea] text-[#16a34a]",
  "bg-[#f1e6ff] text-[#9333ea]",
  "bg-[#fff0de] text-[#ea7a0c]",
];

/**
 * 卡上的问题（同旧页面 `warnState`，Annie 2026-10-06 晚定、10-09 晚细化）：顺序即优先级；没传名单时不算。
 * solve = 哪个按钮能解决（那个按钮实心）。
 */
function warnState(
  c: ManifestCard,
): { text: string; solve: "check" | "seat" } | null {
  if (!c.uploaded) return null;
  if (!c.buses) return { text: "Needs saving", solve: "check" };
  if (c.mode === "unlettered")
    return { text: "Buses need letters", solve: "check" };
  if (typeof c.buses_needed === "number" && c.buses_needed > c.buses)
    return {
      text: `${c.not_on_bus ?? 0} guests need an extra bus`,
      solve: "check",
    };
  if (c.not_on_bus)
    return {
      text: `${c.not_on_bus} guests awaiting seat assignment`,
      solve: "seat",
    };
  return null;
}

/** 旧 `.tm-card`：上 = 图标块 + 团名 + 一行小字 + 右上角小标签；下 = 按钮平分整排。 */
function Card({
  card: c,
  pendingCount,
  tile,
  date,
  onAssignBus,
  onSeatGuests,
}: {
  card: ManifestCard;
  /** Completed 之后这个团有几条没处理的变化（G56）。 */
  pendingCount: number;
  tile: number;
  date: string;
  onAssignBus: () => void;
  onSeatGuests: () => void;
}) {
  const warn = warnState(c);
  // 右上角小标签只在没问题时用：有问题时团名下面的橙字已经说了（同旧页面 cb3887d，Annie 否掉了重复的标签）。
  const pill = !c.uploaded
    ? { text: "No guests yet", cls: "bg-[#eef0f3] text-[#4b5563]" }
    : warn || pendingCount
      ? null
      : { text: "Guests loaded", cls: "bg-[#e6f4ec] text-[#1e6b43]" };
  return (
    <div
      data-card={c.manifest_id}
      className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3.5 rounded-[10px] bg-white px-[18px] py-4 text-[#111827] max-[620px]:grid-cols-[auto_minmax(0,1fr)]"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-[46px] items-center justify-center rounded-[10px]",
          TILE[tile],
        )}
      >
        <BusIcon className="size-6" />
      </span>
      <div className="min-w-0">
        <div className="text-[17px] font-[650] tracking-[-.005em]">
          {c.title}
        </div>
        {pendingCount ? (
          <div
            data-card-pending
            className="mt-[3px] text-[12.5px] font-[650] text-[#c2410c]"
          >
            {pendingCount} change{pendingCount === 1 ? "" : "s"} after Completed
          </div>
        ) : null}
        {warn ? (
          <div className="mt-[3px] text-[12.5px] font-[650] text-[#c2410c]">
            {warn.text}
          </div>
        ) : null}
        <div className="mt-[3px] text-[13.5px] leading-[1.45] text-[#6b7280]">
          {busText(c.buses)} ·{" "}
          {c.uploaded ? `${c.pax} guests loaded` : "No guests loaded"}
        </div>
      </div>
      {pill ? (
        <span
          className={cn(
            "self-start justify-self-end rounded-[5px] px-[7px] py-0.5 text-[11.5px] font-semibold whitespace-nowrap max-[620px]:col-span-full max-[620px]:justify-self-start",
            pill.cls,
          )}
        >
          {pill.text}
        </span>
      ) : (
        <span aria-hidden />
      )}
      <div className="col-span-full flex flex-wrap justify-center gap-2.5 border-t border-[#e5e7eb] pt-3.5 [&>*]:min-w-max [&>*]:flex-[1_1_0] [&>*]:justify-center">
        {c.uploaded ? (
          <PageLink
            href={`/dispatch/manifest?date=${date}&tour=${c.manifest_id}`}
            className={TM_BTN}
          >
            <DocIcon />
            Open manifest
          </PageLink>
        ) : null}
        {/* Check the bus（原 Assign Bus）：有没有名单都有；只在它能解决卡上的问题时实心（同旧页面 cb3887d）。 */}
        <button
          type="button"
          onClick={onAssignBus}
          className={warn?.solve === "check" ? TM_BTN_BLUE : TM_BTN}
        >
          Check the bus
        </button>
        {/* Seat guests：车位够、还有客人没分到车时才有；跳到 Step 2 这个团的车、展开名单。 */}
        {warn?.solve === "seat" ? (
          <button type="button" onClick={onSeatGuests} className={TM_BTN_BLUE}>
            Seat guests
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DocIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5zM9 12h6M9 16h6" />
    </svg>
  );
}

function HowToUse() {
  return (
    // 旧 `.tm-howto`：标题行右边，书本图标 + 浅蓝字链接；展开后占满一行，深底上浅色字。
    <details className="ml-auto max-w-full text-[12.5px] leading-[1.85] text-[#cbd5e1] open:ml-0 open:basis-full">
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 font-medium text-[#93c5fd] hover:text-[#bfdbfe] hover:underline hover:underline-offset-[3px] [&::-webkit-details-marker]:hidden">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-5 flex-none"
        >
          <path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13" />
        </svg>
        How to use — Guest lists
      </summary>
      <ol className={cn(HOWTO_OL, "mt-2 mb-1 max-w-[760px] pl-5")}>
        <li>
          Save the schedule in Step 2 first. The buses on each card come from
          the saved schedule. For a tour with two or more buses, give each bus a
          letter (A, B ...).
        </li>
        <li>
          Guest lists load by themselves from the Manifests page (confirmed
          bookings only) each time you open this page or change the date. A
          booking shows up under its product&rsquo;s group (Settings →
          Products). A product with no group is not on Dispatch.
        </li>
        <li>Past days are not updated: their lists stay as they were.</li>
        <li>
          Tours with guests that still need something (orange text) come first,
          then tours with guests that are ready. Tours with no guests (usually
          no orders that day) are at the bottom.
        </li>
        <li>
          Click Check the bus on a tour to jump to that tour&rsquo;s buses in
          Step 2. Orange text under a tour&rsquo;s name says what still needs
          doing, and the button that fixes it is filled in. If guests still need
          a seat, click Seat guests: it opens that tour&rsquo;s bus lists in
          Step 2.
        </li>
        <li>
          Click Open manifest to pick a bus for each guest, fill in the
          attraction confirmation, and print or download.
        </li>
        <li>
          When this day&rsquo;s dispatch is done, click Completed. This jumps
          down to Step 2 and is shared: any staff member sees who marked it and
          when, even after a refresh or the next day.
        </li>
        <li>
          Before Completed: if Rezdy changes, reload this page. New guests are
          seated automatically; bus choices and the driver&rsquo;s check-ins
          stay.
        </li>
        <li>
          After Completed: nobody is moved automatically. Each order that
          changes is listed at the top of this step (new, changed or
          cancelled, and which bus it was on). Update the Bus Manifest and tell
          the driver or guide, then click Handled, or All handled. A new order
          waits under Not on a bus in Step 2 until you pick a bus for it.
        </li>
        <li>
          An order with no number of guests is left out and listed above the
          cards. Fix it in Rezdy, then reload this page.
        </li>
        <li>
          If the lists cannot be updated (a red message above the cards), log in
          to the old site at confirm.nationalparkexpress.com and upload the
          Rezdy CSV there by hand.
        </li>
      </ol>
    </details>
  );
}

/** 同步出的问题（G35）：同步失败（名单可能是旧的），或有订单人数读不出来、没放进名单。 */
function SyncNotes({
  sync,
  cards,
}: {
  sync: SyncInfo | null;
  cards: ManifestCard[];
}) {
  if (!sync) return null;
  if (sync.error !== undefined)
    return (
      <p role="alert" className={cn(DARK_ERR, "m-0")}>
        Could not update the guest lists from the Manifests page: {sync.error}{" "}
        The lists below may be out of date. Reload the page to try again. If it
        keeps failing, log in to the old site at confirm.nationalparkexpress.com
        and upload the Rezdy CSV there.
      </p>
    );
  const title = new Map(cards.map((c) => [c.manifest_id, c.title]));
  const skipped = sync.result.tours.filter((t) => t.skipped_orders.length);
  if (!skipped.length) return null;
  return (
    <div role="alert" data-sync-skipped className={cn(DARK_ERR, "m-0")}>
      {skipped.map((t) => (
        <p key={t.manifest_id} className="m-0">
          {title.get(t.manifest_id) ?? `Tour #${t.manifest_id}`}:{" "}
          {t.skipped_orders.length} order
          {t.skipped_orders.length === 1 ? "" : "s"} could not be loaded (no
          guest count): {t.skipped_orders.join(", ")}
        </p>
      ))}
    </div>
  );
}
