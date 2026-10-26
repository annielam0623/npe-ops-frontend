"use client";

import { useEffect, useId, useState } from "react";

import { Modal } from "@/components/ui/modal";
import { PageLink } from "@/components/ui/page-link";
import { describeError, isStatus } from "@/lib/api-errors";
import { LA_TIME_ZONE, laToday } from "@/lib/la-date";
import { fetchNotices, type ApiNotice } from "@/lib/notices-api";
import { cn } from "@/lib/utils";

import {
  formatNoticeWhen,
  noticeKindLabel,
  noticeLinkLabel,
} from "./notice-panel";

/** 历史只看最近 30 天（Annie 2026-10-25 同意预览：弹窗、最近 30 天）。 */
const HISTORY_DAYS = 30;
/** 后端单次最多 200 条，也没有按日期取 / 翻页：在这 200 条里取最近 30 天。 */
const HISTORY_LIMIT = 200;

const DAY_HEADING = new Intl.DateTimeFormat("en-US", {
  timeZone: LA_TIME_ZONE,
  month: "short",
  day: "numeric",
});

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; notices: ApiNotice[] };

/**
 * Notice 右上角「Check history」点开的弹窗（Annie 2026-10-25 同意的预览方案 B）：
 * 竖排、按天分组（洛杉矶日期）、最新在最前；红点 = 没读，绿点 = 读过（全站规则）；没读的可以在这里 Got it。
 * 只列通知，不列交接（Annie：「交接就是24小时内的」，交接只在默认视图里）。
 */
export function NoticeHistory({
  onClose,
  onGotIt,
  onUnauthorized,
}: {
  onClose: () => void;
  /** 和面板里的 Got it 同一个动作（标已读、从面板拿掉）。 */
  onGotIt: (notice: ApiNotice) => void;
  onUnauthorized: () => void;
}) {
  const titleId = useId();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const list = await fetchNotices(controller.signal, {
          includeRead: true,
          limit: HISTORY_LIMIT,
        });
        if (controller.signal.aborted) return;
        const since = Date.now() - HISTORY_DAYS * 24 * 3600 * 1000;
        setState({
          kind: "ready",
          notices: list
            .filter((n) => Date.parse(n.created_at) >= since)
            .sort(
              (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
            ),
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isStatus(error, 401)) onUnauthorized();
        else setState({ kind: "error", message: describeError(error) });
      }
    })();
    return () => controller.abort();
  }, [onUnauthorized]);

  function gotIt(notice: ApiNotice) {
    onGotIt(notice);
    setState((s) =>
      s.kind === "ready"
        ? {
            ...s,
            notices: s.notices.map((n) =>
              n.id === notice.id ? { ...n, is_read: true } : n,
            ),
          }
        : s,
    );
  }

  const today = laToday();
  const groups: { day: string; label: string; notices: ApiNotice[] }[] = [];
  if (state.kind === "ready") {
    for (const n of state.notices) {
      const date = new Date(n.created_at);
      const day = laToday(date);
      let g = groups[groups.length - 1];
      if (!g || g.day !== day) {
        const label = DAY_HEADING.format(date);
        g = {
          day,
          label: day === today ? `Today · ${label}` : label,
          notices: [],
        };
        groups.push(g);
      }
      g.notices.push(n);
    }
  }

  return (
    <Modal
      titleId={titleId}
      onDismiss={onClose}
      panelClassName="flex max-h-[calc(100vh-32px)] max-w-[620px] flex-col !rounded-[14px] border border-white/20 !bg-[#0d1726] !text-[#f8fafc] shadow-[0_16px_48px_rgba(0,0,0,.55)]"
    >
      <div
        data-notice-history
        className="flex min-h-0 flex-col px-[18px] pt-4 pb-3"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={titleId} className="text-[15px] font-bold">
            Notice history
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="cursor-pointer text-[18px] leading-none text-white/80 hover:text-white"
          >
            ×
          </button>
        </div>

        <div className="mt-1 min-h-0 [scrollbar-width:thin] overflow-y-auto pr-1">
          {state.kind === "loading" ? (
            <p className="py-3 text-[12.5px] text-white/60">Loading…</p>
          ) : state.kind === "error" ? (
            <p role="alert" className="py-3 text-[12.5px] text-[#f87171]">
              Could not load the history: {state.message}
            </p>
          ) : groups.length === 0 ? (
            <p className="py-3 text-[12.5px] text-white/60">
              No notices in the last {HISTORY_DAYS} days.
            </p>
          ) : (
            groups.map((g) => (
              <section key={g.day} data-history-day={g.day}>
                <h3 className="mt-3 mb-1 border-b border-white/[.12] pb-1 text-[11px] font-bold tracking-[.07em] text-white/55 uppercase">
                  {g.label}
                </h3>
                <ul className="list-none">
                  {g.notices.map((n) => (
                    <HistoryRow key={n.id} notice={n} onGotIt={gotIt} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        {state.kind === "ready" ? (
          <p className="mt-2 text-[11.5px] text-white/55">
            Showing the last {HISTORY_DAYS} days.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function HistoryRow({
  notice,
  onGotIt,
}: {
  notice: ApiNotice;
  onGotIt: (notice: ApiNotice) => void;
}) {
  return (
    <li
      data-history-item={notice.id}
      className="grid grid-cols-[10px_minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 border-b border-white/[.06] py-[7px] text-[12.5px]"
    >
      <span
        aria-hidden
        data-status-dot={notice.is_read ? "handled" : "unhandled"}
        className={cn(
          "mt-1.5 size-2 rounded-full",
          notice.is_read ? "bg-[#28a745]" : "bg-[#dc3545]",
        )}
      />
      <b className="min-w-0 font-semibold">{notice.title}</b>
      <span className="text-[12px] whitespace-nowrap text-white/75 tabular-nums">
        {formatNoticeWhen(notice.created_at)}
      </span>
      <span className="col-start-2 col-end-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-white/70">
        <span>{noticeKindLabel(notice)}</span>
        {notice.body ? (
          <span className="whitespace-pre-line">· {notice.body}</span>
        ) : null}
        {notice.link ? (
          <PageLink
            href={notice.link}
            className="font-semibold text-[#38bdf8] no-underline hover:text-[#7dd3fc]"
          >
            {noticeLinkLabel(notice)}
          </PageLink>
        ) : null}
        {!notice.is_read && notice.actions.length === 0 ? (
          <button
            type="button"
            onClick={() => onGotIt(notice)}
            className="cursor-pointer rounded-md border border-white/25 px-2 py-px text-[12px] font-semibold hover:border-white/45"
          >
            Got it
          </button>
        ) : null}
      </span>
    </li>
  );
}
