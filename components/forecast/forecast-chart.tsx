"use client";

import { useId, useState } from "react";

import { cn } from "@/lib/utils";
import type { ForecastDay } from "@/types";

import { formatLong, formatShort, niceMax } from "./config";

const VIEW_W = 840;
const VIEW_H = 220;
const PLOT_LEFT = 38;
const PLOT_RIGHT = 8;
const PLOT_TOP = 26;
const PLOT_BOTTOM = 26;
const PLOT_W = VIEW_W - PLOT_LEFT - PLOT_RIGHT;
const PLOT_H = VIEW_H - PLOT_TOP - PLOT_BOTTOM;
const BAR_MAX_WIDTH = 24;

// 旧后台没有这一页（见 PROGRESS「30 Days Forecast」），全新页面照 CLAUDE.md 的决定走深色风格，
// 配色跟 dashboard 已经定下的 sky 蓝一致（components/dashboard/dashboard-view.tsx 的径向渐变）。
const BAR_FILL = "#0ea5e9";
const BAR_FILL_TODAY = "#38bdf8";

export function ForecastChart({
  days,
  peakIndex,
}: {
  days: ForecastDay[];
  peakIndex: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const titleId = useId();

  if (!days.length) {
    return null;
  }

  const slot = PLOT_W / days.length;
  const barWidth = Math.min(BAR_MAX_WIDTH, slot - 2);
  const max = niceMax(Math.max(...days.map((d) => d.pax)));
  const ticks = [0, max / 2, max];
  // 每 5 天一个刻度，加上第一天（今天）和最后一天，避免 30 个标签挤在一起。
  const labelIndexes = new Set<number>([0, days.length - 1]);
  for (let i = 5; i < days.length; i += 5) labelIndexes.add(i);

  const yFor = (pax: number) => PLOT_TOP + PLOT_H * (1 - pax / max);
  const xFor = (i: number) => PLOT_LEFT + i * slot + (slot - barWidth) / 2;

  const hoveredDay = hovered !== null ? days[hovered] : null;
  const tooltipLeftPct = hovered !== null ? ((xFor(hovered) + barWidth / 2) / VIEW_W) * 100 : 0;
  const tooltipTopPct = hoveredDay ? (yFor(hoveredDay.pax) / VIEW_H) * 100 : 0;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>
          Daily pax forecast, {formatShort(days[0].date)} to{" "}
          {formatShort(days[days.length - 1].date)}
        </title>

        {ticks.map((t) => (
          <line
            key={t}
            x1={PLOT_LEFT}
            x2={VIEW_W - PLOT_RIGHT}
            y1={yFor(t)}
            y2={yFor(t)}
            stroke="#ffffff"
            strokeOpacity={0.1}
            strokeWidth={1}
          />
        ))}
        {ticks.map((t) => (
          <text
            key={t}
            x={PLOT_LEFT - 6}
            y={yFor(t)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={10}
            className="fill-white/40 tabular-nums"
          >
            {Math.round(t).toLocaleString()}
          </text>
        ))}

        {days.map((day, i) => {
          const x = xFor(i);
          const barHeight = day.pax > 0 ? Math.max((day.pax / max) * PLOT_H, 3) : 0;
          const y = PLOT_TOP + PLOT_H - barHeight;
          const isToday = i === 0;
          const isPeak = i === peakIndex;
          const isHovered = hovered === i;
          const radius = Math.min(4, barHeight / 2);

          return (
            <g key={day.date}>
              {/* 命中区域比可见的柱子宽（含间隙），方便悬停 / 键盘聚焦。 */}
              <rect
                x={PLOT_LEFT + i * slot}
                y={PLOT_TOP}
                width={slot}
                height={PLOT_H}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`${formatLong(day.date)}: ${day.pax.toLocaleString()} pax`}
                onPointerEnter={() => setHovered(i)}
                onPointerLeave={() => setHovered((h) => (h === i ? null : h))}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered((h) => (h === i ? null : h))}
                className="cursor-pointer outline-none"
              />
              {barHeight > 0 ? (
                <>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    rx={radius}
                    fill={isToday ? BAR_FILL_TODAY : BAR_FILL}
                    opacity={isHovered ? 1 : 0.88}
                    pointerEvents="none"
                  />
                  {/* 把底部方正：圆角矩形叠一块不圆角的，盖住底边的圆角（同色，不是描边）。 */}
                  {radius > 0 ? (
                    <rect
                      x={x}
                      y={PLOT_TOP + PLOT_H - radius}
                      width={barWidth}
                      height={radius}
                      fill={isToday ? BAR_FILL_TODAY : BAR_FILL}
                      opacity={isHovered ? 1 : 0.88}
                      pointerEvents="none"
                    />
                  ) : null}
                </>
              ) : null}
              {isPeak ? (
                <text
                  x={x + barWidth / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  className="fill-white/70 tabular-nums"
                  pointerEvents="none"
                >
                  {day.pax.toLocaleString()}
                </text>
              ) : null}
              {labelIndexes.has(i) ? (
                <text
                  x={x + barWidth / 2}
                  y={VIEW_H - 8}
                  textAnchor="middle"
                  fontSize={10}
                  className={cn(
                    isToday ? "fill-white/85 font-semibold" : "fill-white/40",
                  )}
                  pointerEvents="none"
                >
                  {isToday ? "Today" : formatShort(day.date)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {hoveredDay ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-white/10 bg-[#0b1626] px-3 py-2 text-xs whitespace-nowrap shadow-lg"
          style={{ left: `${tooltipLeftPct}%`, top: `${tooltipTopPct}%` }}
        >
          <div className="text-white/50">{formatLong(hoveredDay.date)}</div>
          <div className="font-semibold text-white tabular-nums">
            {hoveredDay.pax.toLocaleString()} pax
          </div>
        </div>
      ) : null}
    </div>
  );
}
