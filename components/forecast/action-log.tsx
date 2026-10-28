"use client";

import { ActionLogPanel } from "@/components/action-log/action-log-panel";
import { fetchForecastLog } from "@/lib/forecast-api";

import { formatLongDate } from "./config";

const PAGE_SIZE = 50;

/**
 * 表底部的 Action Log（G81，G203 换成共用面板）：默认收起，展开才去拉；最近 50 条新的在上，Show more 往前翻。
 * 本版只记按天改的开关团和每档上限（手写格子、导游排班不在里面）。团名和日子并进 What 一格。
 * refreshKey 变了（表上刚存了一处）且已展开 ⇒ 重新拉第一页。
 */
export function ActionLog({ refreshKey }: { refreshKey: number }) {
  return (
    <ActionLogPanel
      refreshKey={refreshKey}
      emptyText="Nothing has been changed yet."
      load={async (before, signal) => {
        const page = await fetchForecastLog(before, PAGE_SIZE, signal);
        return {
          next_cursor: page.next_cursor,
          entries: page.items.map((item) => ({
            at: item.at,
            by: item.by,
            action: "",
            label: item.date
              ? `${item.tour} · ${formatLongDate(item.date)}`
              : item.tour,
            what: item.what,
            from: item.from || null,
            to: item.to || null,
          })),
        };
      }}
    />
  );
}
