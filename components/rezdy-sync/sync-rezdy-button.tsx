"use client";

import { useEffect, useRef, useState } from "react";

import { isStatus } from "@/lib/api-errors";
import { LA_TIME_ZONE } from "@/lib/la-date";
import {
  describeRezdySyncError,
  fetchRezdyLastSynced,
  syncDispatchFromRezdy,
  syncManifestFromRezdy,
} from "@/lib/rezdy-sync-api";
import { cn } from "@/lib/utils";
import type {
  DispatchRezdySyncResult,
  RezdyLastSynced,
  RezdySyncResult,
} from "@/types";

const TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: LA_TIME_ZONE });
const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
});

/** 「7:58 AM by veronica」（洛杉矶时间）；不是今天点的再加日期，免得看成今天。 */
function lastText(last: RezdyLastSynced | null, today: string): string {
  if (!last) return "Not updated from Rezdy yet";
  const at = new Date(last.at);
  if (Number.isNaN(at.getTime())) return "Last updated from Rezdy";
  const when =
    DAY.format(at) === today
      ? TIME.format(at)
      : `${DAY_LABEL.format(at)}, ${TIME.format(at)}`;
  // 新版 ICU 在 AM / PM 前用窄不换行空格（U+202F），换成普通空格。
  return `Last updated from Rezdy: ${when.replace(/\s/g, " ")}${last.by ? ` by ${last.by}` : ""}`;
}

function changesText(r: RezdySyncResult): string {
  const parts = [
    `${r.new.length} new`,
    `${r.cancelled.length} cancelled`,
    `${r.changed.length} changed`,
  ];
  if (r.failed.length) parts.push(`${r.failed.length} failed`);
  return parts.join(" · ");
}

/** 同步的双箭头圈（同预览第 3 版）。 */
function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn(spinning && "animate-spin motion-reduce:animate-none")}
    >
      <path d="M21 12a9 9 0 0 1-15.5 6.2" />
      <path d="M3 12A9 9 0 0 1 18.5 5.8" />
      <polyline points="18.5 1.8 18.5 5.8 14.5 5.8" />
      <polyline points="5.5 22.2 5.5 18.2 9.5 18.2" />
    </svg>
  );
}

type Props = {
  date: string;
  /** 洛杉矶今天（YYYY-MM-DD）：比它早的日子按键灰掉（Annie 2026-10-15）。 */
  today: string;
  onUnauthorized: () => void;
  className?: string;
  /**
   * start：键紧跟在标题后面、字写在键右边（Dispatch Step 1，Annie 2026-10-15「应该在 Guest lists 旁边」）；
   * 默认 end：靠右，字在键左边（Main Manifest 顶部一排）。
   */
  align?: "start" | "end";
} & (
  | { kind: "manifests"; onSynced: (r: RezdySyncResult) => void }
  | { kind: "dispatch"; onSynced: (r: DispatchRezdySyncResult) => void }
);

/**
 * Sync Rezdy 按键（后端 G70，Annie 2026-10-15，预览第 3 版）：只有 Rezdy logo + 同步圈两个图标，不写字；
 * 左边一行字写上次从 Rezdy 更新的时间和人，点完再加几单新 / 取消 / 改了。同步中图标转圈、不能点；
 * 出错红字写后端的原话（什么都没改）。放在深色外框上（Main Manifest 顶部一排、Dispatch Step 1 标题行）。
 */
export function SyncRezdyButton(props: Props) {
  const { date, today, onUnauthorized, className, align = "end" } = props;
  const start = align === "start";
  const [last, setLast] = useState<RezdyLastSynced | null | undefined>();
  const [changes, setChanges] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Main manifest 已更新、只有 Dispatch 团名单那步没成（后端原话，G74）。 */
  const [listsWarn, setListsWarn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dateRef = useRef(date);
  dateRef.current = date;
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    setLast(undefined);
    setChanges(null);
    setError(null);
    setListsWarn(null);
    if (!date) return;
    const controller = new AbortController();
    fetchRezdyLastSynced(date, controller.signal)
      .then(setLast)
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (isStatus(e, 401)) unauthorizedRef.current();
        // 读不到上次时间不挡按键，只是不写那行字。
        else setLast(undefined);
      });
    return () => controller.abort();
  }, [date]);

  const past = !!date && !!today && date < today;

  async function sync() {
    if (busy || past || !date) return;
    const at = date;
    setBusy(true);
    setError(null);
    setListsWarn(null);
    try {
      if (props.kind === "dispatch") {
        const r = await syncDispatchFromRezdy(at);
        if (dateRef.current !== at) return;
        setLast(r.last_synced);
        setChanges(changesText(r));
        props.onSynced(r);
      } else {
        const r = await syncManifestFromRezdy(at);
        if (dateRef.current !== at) return;
        setLast(r.last_synced);
        setChanges(changesText(r));
        setListsWarn(r.guest_lists_error || null);
        props.onSynced(r);
      }
    } catch (e) {
      if (isStatus(e, 401)) {
        unauthorizedRef.current();
        return;
      }
      if (dateRef.current !== at) return;
      setChanges(null);
      setError(describeRezdySyncError(e));
    } finally {
      setBusy(false);
    }
  }

  const line = last === undefined ? null : lastText(last, today);

  return (
    <span
      data-rezdy-sync
      className={cn(
        "inline-flex max-w-full min-w-0 flex-wrap items-center gap-2",
        start ? "justify-start" : "ml-auto justify-end",
        className,
      )}
    >
      <span
        aria-live="polite"
        className={cn(
          "min-w-0 text-[12.5px] text-[#cbd5e1]",
          start ? "order-last text-left" : "text-right",
        )}
      >
        {error ? (
          <span role="alert" className="text-[#fca5a5]">
            {error}
            {line ? ` (${line})` : ""}
          </span>
        ) : line ? (
          <span data-rezdy-last>
            {line}
            {changes ? ` · ${changes}` : ""}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        aria-label="Sync Rezdy"
        title={past ? "Past days cannot be synced" : "Sync Rezdy"}
        aria-busy={busy}
        disabled={busy || past || !date}
        onClick={sync}
        className="inline-flex h-9 flex-none items-center justify-center gap-[5px] rounded-[10px] border border-[#3b82f6]/70 bg-white/[.04] px-2 text-white transition hover:bg-white/[.08] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 18px 的小图标，不需要 next/image */}
        <img
          src="/icons/rezdy.png"
          alt=""
          width={18}
          height={18}
          className="size-[18px] rounded-full"
        />
        <SyncIcon spinning={busy} />
      </button>
      {listsWarn ? (
        <span
          role="status"
          data-rezdy-lists-warn
          className={cn(
            "order-last basis-full text-[12.5px] text-[#fbbf6a]",
            start ? "text-left" : "text-right",
          )}
        >
          {listsWarn}
        </span>
      ) : null}
    </span>
  );
}
