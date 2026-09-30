"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";

import { isStatus } from "@/lib/api-errors";
import { fetchUnhandledMessages } from "@/lib/dashboard-api";
import { cn } from "@/lib/utils";
import type { MessageLane, UnhandledMessage, UnhandledMessages } from "@/types";

import {
  CLOCK_TICK_MS,
  formatLaDay,
  formatLocalClock,
  LANE_ACCENT,
  LANE_EMPTY_TEXT,
  LANE_LABEL,
  LANES,
  POLL_INTERVAL_MS,
  STALE_AFTER_FAILURES,
} from "./config";
import { MessageCard } from "./message-card";

interface PollState {
  data: UnhandledMessages | null;
  /** 连续失败的轮数，成功一次清零。 */
  failures: number;
  lastSuccessAt: number | null;
}

/**
 * 每 60 秒拉一次 /api/notifications/unhandled。
 * 拉不到数据绝不能长得像「没有未处理消息」：保留上一轮的数据，同时由调用方显示故障提示。
 */
function useUnhandledMessages(onUnauthorized: () => void): PollState {
  const [state, setState] = useState<PollState>({
    data: null,
    failures: 0,
    lastSuccessAt: null,
  });
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    // 401 后置为 true：之后每轮直接返回，不再请求（页面正在跳登录）。
    let stopped = false;

    async function load() {
      // 上一轮还没回来就跳过，不叠请求。
      if (inFlight || stopped) {
        return;
      }
      inFlight = true;
      try {
        const data = await fetchUnhandledMessages(controller.signal);
        setState({ data, failures: 0, lastSuccessAt: Date.now() });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        if (isStatus(error, 401)) {
          stopped = true;
          onUnauthorizedRef.current();
          return;
        }
        setState((prev) => ({ ...prev, failures: prev.failures + 1 }));
      } finally {
        inFlight = false;
      }
    }

    void load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      controller.abort();
    };
  }, []);

  return state;
}

/** WhatsApp 倒计时 / 等待时长自己走，不等 60 秒一轮的拉取；纯前端计时，不发请求。 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function statusLine(state: PollState): string {
  const { data, failures, lastSuccessAt } = state;
  if (failures >= STALE_AFTER_FAILURES && lastSuccessAt !== null) {
    return `Not updating — last updated ${formatLocalClock(lastSuccessAt)}. Retrying every minute.`;
  }
  if (!data) {
    return failures > 0 ? "Could not load messages. Retrying…" : "Loading…";
  }
  // ⚠️ 这句话是后端排序规则的书面版本，后端改排序就必须改它。
  return (
    `${formatLaDay(data.today)} · Guests still waiting on a reply, plus anyone who asked to change` +
    " their date. Aim to clear this panel before the end of the day." +
    " A guest's WhatsApp message can only be answered freely for 24 hours" +
    " after they send it, so WhatsApp and date-change requests share the" +
    " top of every window, newest first — handle those before anything" +
    " else. Everything below them is ordered by departure, soonest first." +
    " Today's Pickup is this morning's send list; Tour and Tickets run" +
    " from today onward."
  );
}

export function MessagesSection({
  onUnauthorized,
}: {
  onUnauthorized: () => void;
}) {
  const state = useUnhandledMessages(onUnauthorized);
  // 新数据到了立刻按当前时刻算，不等下一次 30 秒的 tick。
  const now = Math.max(useNow(), state.lastSuccessAt ?? 0);
  // 刻意不记忆折叠状态：每次进来都展开（Annie 2026-09-12 定）。轮询不受折叠影响。
  const [collapsed, setCollapsed] = useState(false);

  const { data } = state;
  const stale = state.failures >= STALE_AFTER_FAILURES;

  return (
    <section aria-labelledby="messages-title" className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="messages-title"
          className="inline-flex items-center gap-2 text-lg font-semibold text-stone-900"
        >
          Messages
          {/* 红胶囊永远是「未处理的数量」；0 时不挂（下面是绿色的全部处理完）。 */}
          {data && data.count > 0 ? <CountPill count={data.count} /> : null}
        </h2>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls="messages-windows"
          onClick={() => setCollapsed((c) => !c)}
          className="inline-flex items-center gap-1.5 rounded px-0.5 py-1 text-sm font-semibold text-sky-600 hover:text-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
        >
          <span
            aria-hidden
            className={cn("transition-transform", collapsed && "-rotate-90")}
          >
            ⌄
          </span>
          {collapsed ? "Show" : "Collapse"}
        </button>
      </div>

      {/* 两行分工不同：第一行是状态（故障时变黄），第二行是使用说明，永远可见。 */}
      <div className="mt-1 mb-4 flex flex-col gap-1.5 text-[12.5px] text-stone-600">
        <p role="status" className={cn(stale && "font-medium text-amber-600")}>
          {statusLine(state)}
        </p>
        <p>
          Only the first few fit in each window — scroll inside one to see the
          rest. Click a message to open the tracking page it belongs to and
          handle it there. If it needs no reply, use Take action — the message
          drops off this dashboard, and comes back on its own if the guest
          writes again.
        </p>
      </div>

      <div id="messages-windows">
        {data ? (
          data.count > 0 ? (
            <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-3">
              {LANES.map((lane) => (
                <LaneWindow
                  key={lane}
                  lane={lane}
                  items={data.lanes[lane] ?? []}
                  today={data.today}
                  windowEnd={data.window_end}
                  collapsed={collapsed}
                  now={now}
                />
              ))}
            </div>
          ) : collapsed ? null : (
            <AllClear />
          )
        ) : null}
      </div>
    </section>
  );
}

function CountPill({ count }: { count: number }) {
  return (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#e74c3c] px-1.5 text-[10px] leading-none font-bold whitespace-nowrap text-white tabular-nums">
      {count}
    </span>
  );
}

function LaneWindow({
  lane,
  items,
  today,
  windowEnd,
  collapsed,
  now,
}: {
  lane: MessageLane;
  items: UnhandledMessage[];
  today: string;
  windowEnd: string;
  collapsed: boolean;
  now: number;
}) {
  const accent = LANE_ACCENT[lane];
  const showDeparture = lane !== "morning";
  return (
    <div
      style={{ "--ac": accent } as CSSProperties}
      className="flex min-w-0 flex-col rounded-2xl border border-[color-mix(in_srgb,var(--ac)_35%,#e7e5e4)] bg-white p-4"
    >
      {/* 折叠只收起卡片列表，栏头留着：折起来仍看得见每栏还欠几条。 */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-2",
          !collapsed && "mb-3",
        )}
      >
        <span className="rounded-md border border-[color-mix(in_srgb,var(--ac)_38%,transparent)] bg-[color-mix(in_srgb,var(--ac)_10%,transparent)] px-2 py-0.5 text-[10.5px] font-extrabold tracking-wider whitespace-nowrap text-[color-mix(in_srgb,var(--ac)_80%,#1c1917)] uppercase">
          {LANE_LABEL[lane]}
        </span>
        {items.length > 0 ? <CountPill count={items.length} /> : null}
        {lane === "morning" && windowEnd ? (
          <span className="text-[11.5px] font-semibold text-stone-400 tabular-nums">
            before {windowEnd}
          </span>
        ) : null}
        <span className="ml-auto text-[12.5px] font-bold text-stone-400 tabular-nums">
          {items.length}
        </span>
      </div>
      {collapsed ? null : (
        <div className="-mr-1.5 flex max-h-[460px] [scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--ac)_55%,transparent)_transparent] flex-col gap-2 overflow-y-auto overscroll-contain pr-1.5 lg:max-h-[600px]">
          {items.length > 0 ? (
            items.map((item, i) => (
              // 同一单的改期卡可能出现两张（两趟不同的行程），订单号不唯一，拼上团期和序号。
              <MessageCard
                key={`${item.order_number}-${item.tour_date}-${i}`}
                item={item}
                today={today}
                showDeparture={showDeparture}
                now={now}
              />
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-stone-200 px-4 py-5 text-center text-[12.5px] text-stone-400">
              {LANE_EMPTY_TEXT[lane]}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AllClear() {
  return (
    <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-green-300 bg-green-50 px-4 py-8 text-center text-sm font-semibold text-green-700">
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="size-[19px] shrink-0 fill-none stroke-current stroke-[2.2]"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
      No unhandled messages
    </div>
  );
}
