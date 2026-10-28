"use client";

import { useEffect, useState } from "react";

import { formatHeaderDate, greetingName } from "@/components/dashboard/config";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { ForecastView } from "@/components/forecast/forecast-view";
import { fetchCurrentUser } from "@/lib/auth-api";
import { usePermissions } from "@/lib/staff-permissions";
import type { CurrentUser } from "@/types";

/** /dashboard：partner 看 partner 首页，其他人照旧看员工的 Dashboard（Q1 A、Q5 A：不看 dashboard.view）。 */
export function DashboardEntry() {
  return usePermissions().partnerView ? <PartnerHome /> : <DashboardView />;
}

/**
 * partner 首页（Annie 2026-10-27「动手」，preview https://claude.ai/artifact/A3ia5c3Lw9aQv7Fo9UYTJC）：
 * 问候语 + 日期，下面整张 7 Days Forecast（同 /forecast：60 天往右滑；partner 只能看，Refresh 和改格子都不出）。
 * 没有卡片（Q2 B）、没有员工的 My shortcuts / Notice / 统计 / 排班 / 留言。没勾 forecast.view 只写一句话。
 */
function PartnerHome() {
  const perms = usePermissions();
  const [me, setMe] = useState<CurrentUser | null>(null);
  // 日期只在浏览器里算（服务端和浏览器时刻不同会 hydration 不一致）。
  const [today, setToday] = useState("");

  useEffect(() => setToday(formatHeaderDate(new Date())), []);

  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentUser(controller.signal)
      .then(setMe)
      .catch(() => {
        // 读不到名字只是不写问候语；Forecast 自己处理没登录 / 没权限。
      });
    return () => controller.abort();
  }, []);

  return (
    <div data-partner-home-page className="flex flex-col gap-5">
      <p className="flex flex-wrap items-baseline gap-x-3 text-white">
        <span className="text-[20px] font-semibold">
          {me
            ? `Good morning, ${greetingName(me.display_name, me.username)}`
            : " "}
        </span>
        {today ? (
          <span className="text-[13px] text-[#94a3b8]">{today}</span>
        ) : null}
      </p>
      {/* 没勾 forecast.view：后端 Forecast 回 403，不去请求，只写一句（原来照 Forecast 页报错）。 */}
      {perms.ready && !perms.can("forecast.view") ? (
        <p data-partner-no-forecast className="text-[13px] text-[#94a3b8]">
          The 7 Days Forecast is not turned on for your account. Use the links
          at the top.
        </p>
      ) : (
        <ForecastView />
      )}
    </div>
  );
}
