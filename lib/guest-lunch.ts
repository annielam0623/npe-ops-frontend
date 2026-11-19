import { lunchText } from "@/lib/order-lifecycle";
import type { LunchCounts } from "@/types";

/**
 * G364（Annie 2026-11-19「动手」，preview 第 7 版）：客人在确认页选的餐跟 Rezdy 的 Special requirements 不一样时的橙字。
 * 「不一样」只看后端的 guest_lunch_differs，前端不自己比。提醒的意思是让 staff 去 Rezdy 查、改（Annie：
 * 「我们的提醒是让他们去查去落实，不是让他们去写出来」），所以只显示，不存、不印。
 */

/** Main manifest（Bus 标签 · Special requirements 格下面）：不提 Bus manifest（Annie：Rezdy 改了一系列都改了）。 */
export function mainManifestGuestLunchNote(guest: LunchCounts): string {
  return `Guest picked ${lunchText(guest) || "no sandwiches"} in the tour confirmation — check Rezdy`;
}

/** Bus Manifest 的写法：B / T / V（同 Lunch 格的三个位置），0 份不写。例「1 T 1 V」。 */
export function lunchShort(c: LunchCounts): string {
  return (
    [
      [c.beef, "B"],
      [c.turkey, "T"],
      [c.veggie, "V"],
    ] as const
  )
    .filter(([n]) => Number(n || 0) > 0)
    .map(([n, k]) => `${Number(n)} ${k}`)
    .join(" ");
}

/** Bus Manifest（Special Requirements 格里）：例「Guest picked: 1 T 1 V — check Rezdy」。 */
export function busManifestGuestLunchNote(guest: LunchCounts): string {
  return `Guest picked: ${lunchShort(guest) || "none"} — check Rezdy`;
}
