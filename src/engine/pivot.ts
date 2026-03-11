/**
 * pivot.ts
 * Classic pivot point calculation: (H + L + C) / 3
 * with full S1/S2/S3 and R1/R2/R3.
 *
 * Anti-repaint: always computed from the PREVIOUS completed candle
 * (index length-2), never from the live/open candle.
 */

import type { CandleData } from "../types";

export type PivotLevels = {
  pivot: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
};

export function calcPivot(candles: CandleData[]): PivotLevels {
  if (candles.length < 2) {
    const c = candles[0];
    const p = (c.high + c.low + c.close) / 3;
    return { pivot: p, r1: p, r2: p, r3: p, s1: p, s2: p, s3: p };
  }
  // Previous completed candle (anti-repaint: never use the last open candle)
  const prev = candles[candles.length - 2];
  const pivot = (prev.high + prev.low + prev.close) / 3;
  const range = prev.high - prev.low;
  const r1 = 2 * pivot - prev.low;
  const s1 = 2 * pivot - prev.high;
  const r2 = pivot + range;
  const s2 = pivot - range;
  const r3 = prev.high + 2 * (pivot - prev.low);
  const s3 = prev.low - 2 * (prev.high - pivot);

  const fix = (n: number) => Math.round(n * 100) / 100;
  return {
    pivot: fix(pivot),
    r1: fix(r1),
    r2: fix(r2),
    r3: fix(r3),
    s1: fix(s1),
    s2: fix(s2),
    s3: fix(s3),
  };
}

/**
 * Return the nearest support level below `price` from the pivot cluster.
 */
export function nearestSupport(levels: PivotLevels, price: number): number {
  const supports = [levels.s1, levels.s2, levels.s3, levels.pivot].filter(
    (v) => v < price
  );
  if (supports.length === 0) return levels.s1;
  return Math.max(...supports);
}

/**
 * Return the nearest resistance level above `price` from the pivot cluster.
 */
export function nearestResistance(levels: PivotLevels, price: number): number {
  const resistances = [levels.r1, levels.r2, levels.r3, levels.pivot].filter(
    (v) => v > price
  );
  if (resistances.length === 0) return levels.r1;
  return Math.min(...resistances);
}
