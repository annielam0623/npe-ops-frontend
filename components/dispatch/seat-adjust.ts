/**
 * 临时调座位数的规则（Annie 2026-10-17；后端 `dispatch.py` 保存时校验，口径同）：
 * 只改这一天这台车，不改 Vehicles 里的固定座位数。
 * - 座位数 ≥ 54（full size）：只能 0 或 +1，所以只有它显示 +；
 * - 其他车（后端 ≤ 40 只能减，41–53 其实也让加，Annie 定「除了 full size，其他车都只有 −」）：只有 −；
 * - 通用上下限 −10..+10，有效座位数最少 1；没填座位数的车不给调。
 */
export const LARGE_BUS_SEATS = 54;
export const SEAT_ADJUST_MIN = -10;
export const SEAT_ADJUST_MAX = 10;

export const isLargeBus = (base: number) => base >= LARGE_BUS_SEATS;

export function canSeatUp(base: number, adj: number): boolean {
  return isLargeBus(base) && adj < 1;
}

export function canSeatDown(base: number, adj: number): boolean {
  if (isLargeBus(base)) return adj > 0;
  return adj > SEAT_ADJUST_MIN && base + adj > 1;
}

/** 这台车今天实际能坐几位。 */
export const effectiveSeats = (base: number, adj: number) =>
  Math.max(1, base + adj);
