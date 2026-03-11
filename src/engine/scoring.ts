/**
 * scoring.ts
 * Per-timeframe signal scoring from candle structure.
 *
 * For each timeframe we:
 * 1. Compute classic pivot (H + L + C) / 3 from the previous completed candle
 * 2. Evaluate where the current price sits relative to pivot/S1/R1
 * 3. Compute momentum from the last N candles (more recent candles weighted more)
 * 4. Combine into a [0, 100] bullish score (0 = max bearish, 100 = max bullish)
 *
 * bullishLevel / bearishLevel are derived from confirmed swing structure of
 * each timeframe's own candles (not uniform pivot arithmetic), so they are
 * naturally distinct across 15M / 1H / 4H / 1D.
 * Falls back to pivot R1/S1 when no relevant swings exist.
 */

import type { CandleData, Timeframe, TimeframeSignal, Bias } from "../types";
import { calcPivot, nearestSupport, nearestResistance } from "./pivot";
import { detectSwingHighs, detectSwingLows } from "./swings";

/** Timeframe weight for global bias aggregation (higher = more influential) */
export const TF_WEIGHTS: Record<Timeframe, number> = {
  "15M": 1,
  "1H": 2,
  "2H": 2,
  "4H": 3,
  "6H": 4,
  "8H": 4,
  "12H": 5,
  "1D": 6,
};

/**
 * Score a single timeframe from its candle series.
 */
export function scoreTimeframe(
  timeframe: Timeframe,
  candles: CandleData[]
): TimeframeSignal {
  const levels = calcPivot(candles);
  const currentPrice = candles[candles.length - 1].close;

  // ── Price position score (0–100) ────────────────────────────────────────────
  // Map position relative to [S2, R2] onto [0, 100].
  const rangeHigh = levels.r2;
  const rangeLow  = levels.s2;
  const rangeSpan = rangeHigh - rangeLow || 1;
  const positionScore = Math.max(
    0,
    Math.min(100, ((currentPrice - rangeLow) / rangeSpan) * 100)
  );

  // ── Momentum score (0–100) ─────────────────────────────────────────────────
  const recentSlice = candles.slice(-8);
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < recentSlice.length; i++) {
    const c = recentSlice[i];
    const w = i + 1;
    const bodyRange = Math.max(Math.abs(c.high - c.low), 0.0001);
    const bullishBody = (c.close - c.open) / bodyRange; // [-1, +1]
    weightedSum += bullishBody * w;
    totalWeight += w;
  }
  const momentum      = weightedSum / totalWeight;
  const momentumScore = 50 + momentum * 50;

  // ── Combined score (position 60% + momentum 40%) ───────────────────────────
  const rawScore = positionScore * 0.6 + momentumScore * 0.4;
  const score    = Math.round(Math.max(0, Math.min(100, rawScore)));
  const bias: Bias = score > 55 ? "bullish" : score < 45 ? "bearish" : "neutral";

  // ── Swing-based bullish / bearish levels ────────────────────────────────────
  // Use the nearest confirmed swing HIGH above price as the resistance target
  // (bullishLevel) and nearest confirmed swing LOW below price as support
  // (bearishLevel).  Each TF has its own swing structure, so these values are
  // naturally distinct across timeframes.  Fall back to pivot arithmetic when
  // no relevant swing exists within 3 × average bar range.
  const avgBarRange =
    candles.slice(-14).reduce((s, c) => s + (c.high - c.low), 0) /
    Math.max(candles.slice(-14).length, 1);
  const searchWindow = avgBarRange * 6;

  const swingHighsAbove = detectSwingHighs(candles, 3, 2)
    .filter((sh) => sh.price > currentPrice && sh.price <= currentPrice + searchWindow)
    .sort((a, b) => a.price - b.price);

  const swingLowsBelow = detectSwingLows(candles, 3, 2)
    .filter((sl) => sl.price < currentPrice && sl.price >= currentPrice - searchWindow)
    .sort((a, b) => b.price - a.price);

  const bullishLevel =
    swingHighsAbove.length > 0
      ? swingHighsAbove[0].price
      : nearestResistance(levels, currentPrice);

  const bearishLevel =
    swingLowsBelow.length > 0
      ? swingLowsBelow[0].price
      : nearestSupport(levels, currentPrice);

  return {
    timeframe,
    bullishLevel: Math.round(bullishLevel * 100) / 100,
    bearishLevel: Math.round(bearishLevel * 100) / 100,
    bullishScore: score,
    bearishScore: 100 - score,
    bias,
    strength: TF_WEIGHTS[timeframe],
  };
}
