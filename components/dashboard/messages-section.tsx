"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";

import { isStatus } from "@/lib/api-errors";
import { fetchUnhandledMessages } from "@/lib/dashboard-api";
import { cn } from "@/lib/utils";
import type { MessageLane, UnhandledMessage, UnhandledMessages } from "@/types";

import {
  CLOCK_TICK_MS,
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
  // 成功时不写（旧页面 2026-10-02 Annie 定：日期和口径都拿掉，口径已在 How to use 里）。
  return "";
}

// 使用说明，Annie 2026-10-01 定稿：子弹列表、不加粗。
// ⚠️ 第 2、3 条是后端排序规则的书面版本，后端改排序就必须改它们。
const HELP_ITEMS = [
  "Clear pending replies and date-change requests by the end of the day.",
  "Priority: WhatsApp and date-change requests appear first, newest first. Reply to WhatsApp within 24 hours of the guest’s message.",
  "Other messages are sorted by departure, soonest first.",
  "Today’s Pickup: This morning’s send list. Tour & Tickets: Today onward.",
  "Scroll within each panel to see more. Click a message to handle it on its tracking page.",
  "No reply needed? Select Take action to remove it. It reappears if the guest messages again.",
];

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
  // 📖 How to use 默认收起、不记忆（同旧页面 2026-10-02）。
  const [howtoOpen, setHowtoOpen] = useState(false);
  const status = statusLine(state);

  const { data } = state;
  const stale = state.failures >= STALE_AFTER_FAILURES;

  return (
    <section aria-labelledby="messages-title" className="mb-3.5 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-[9px]">
          <h2
            id="messages-title"
            className="inline-flex items-center gap-[9px] text-[17px] font-bold tracking-[-.01em]"
          >
            Messages
            {/* 红胶囊永远是「未处理的数量」；0 时不挂（下面是绿色的全部处理完）。 */}
            {data && data.count > 0 ? <CountPill count={data.count} /> : null}
          </h2>
          <button
            type="button"
            aria-expanded={howtoOpen}
            aria-controls="messages-howto"
            title="How to use Messages"
            onClick={() => setHowtoOpen((o) => !o)}
            className={cn(
              "inline-flex items-center gap-[5px] rounded-full border border-[#38bdf8]/45 py-0.5 pr-[9px] pl-[7px] text-xs font-semibold text-[#38bdf8] hover:border-[#7dd3fc] hover:text-[#7dd3fc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#38bdf8]",
              howtoOpen && "bg-[#38bdf8]/[.14]",
            )}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              className="size-3.5 fill-none stroke-current stroke-2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" />
              <path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" />
            </svg>
            How to use
          </button>
        </span>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls="messages-windows"
          onClick={() => setCollapsed((c) => !c)}
          className="inline-flex items-center gap-1.5 rounded px-0.5 py-1 text-[13px] font-semibold text-[#38bdf8] hover:text-[#7dd3fc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#38bdf8]"
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

      {/* 两行分工不同：第一行是状态（成功时为空不占地方，故障时变黄），
          第二行是使用说明，点标题旁的 How to use 才展开（不跟着 Collapse 收）。 */}
      <div className="mt-[5px] mb-4 flex flex-col gap-[7px] text-[12.5px] text-white">
        <p
          role="status"
          className={cn(!status && "hidden", stale && "text-[#fbbf24]")}
        >
          {status}
        </p>
        <ul
          id="messages-howto"
          hidden={!howtoOpen}
          className="flex list-disc flex-col gap-[7px] rounded-[10px] border border-white/10 bg-white/[.03] py-3 pr-4 pl-[34px] leading-[1.6] font-light tracking-[.01em]"
        >
          {HELP_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div id="messages-windows">
        {data ? (
          data.count > 0 ? (
            <div className="grid grid-cols-1 items-start gap-3.5 min-[981px]:grid-cols-3">
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
      className="flex min-w-0 flex-col rounded-[18px] border border-[color-mix(in_srgb,var(--ac)_38%,rgba(255,255,255,.08))] bg-white/[.032] p-4"
    >
      {/* 折叠只收起卡片列表，栏头留着：折起来仍看得见每栏还欠几条。 */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-[9px]",
          !collapsed && "mb-[13px]",
        )}
      >
        <span className="rounded-md border border-[color-mix(in_srgb,var(--ac)_38%,transparent)] bg-[color-mix(in_srgb,var(--ac)_12%,transparent)] px-[9px] py-[3px] text-[10.5px] font-bold tracking-[.07em] whitespace-nowrap text-[var(--ac)] uppercase">
          {LANE_LABEL[lane]}
        </span>
        {items.length > 0 ? <CountPill count={items.length} /> : null}
        {lane === "morning" && windowEnd ? (
          <span className="text-[11.5px] font-semibold text-white/40 tabular-nums">
            before {windowEnd}
          </span>
        ) : null}
        <span className="ml-auto text-[12.5px] font-bold text-white/40 tabular-nums">
          {items.length}
        </span>
      </div>
      {collapsed ? null : (
        <div className="-mr-1.5 flex max-h-[460px] [scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--ac)_55%,transparent)_transparent] flex-col gap-[9px] overflow-y-auto overscroll-contain pr-1.5 min-[981px]:max-h-[600px]">
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
            <div className="rounded-xl border border-dashed border-white/10 px-[15px] py-5 text-center text-[12.5px] text-white/40">
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
    <div className="flex items-center justify-center gap-[11px] rounded-[18px] border border-[#4ade80]/30 bg-[#4ade80]/[.06] px-[18px] py-[30px] text-center text-sm font-semibold text-[#4ade80]">
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
