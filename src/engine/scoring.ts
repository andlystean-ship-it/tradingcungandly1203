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
 * No random noise is added here — results are fully deterministic from candles.
 */

import type { CandleData, Timeframe, TimeframeSignal, Bias } from "../types";
import { calcPivot, nearestSupport, nearestResistance } from "./pivot";

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
  // Clamp to avoid extreme outliers from expanding range.
  const rangeHigh = levels.r2;
  const rangeLow = levels.s2;
  const rangeSpan = rangeHigh - rangeLow || 1;
  const positionScore = Math.max(
    0,
    Math.min(100, ((currentPrice - rangeLow) / rangeSpan) * 100)
  );

  // ── Momentum score (0–100) ─────────────────────────────────────────────────
  // Weighted average of close-over-open for last 8 candles.
  // Recent candles count more. We map [-1, +1] onto [0, 100].
  const recentSlice = candles.slice(-8);
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < recentSlice.length; i++) {
    const c = recentSlice[i];
    const w = i + 1; // later candles have higher weight
    const bodyRange = Math.max(Math.abs(c.high - c.low), 0.0001);
    const bullishBody = (c.close - c.open) / bodyRange; // [-1, +1]
    weightedSum += bullishBody * w;
    totalWeight += w;
  }
  const momentum = weightedSum / totalWeight; // [-1, +1]
  const momentumScore = 50 + momentum * 50; // [0, 100]

  // ── Combined score (position 60% + momentum 40%) ───────────────────────────
  const rawScore = positionScore * 0.6 + momentumScore * 0.4;
  const score = Math.round(Math.max(0, Math.min(100, rawScore)));
  const bias: Bias = score > 55 ? "bullish" : score < 45 ? "bearish" : "neutral";

  // ── Bullish/bearish levels for UI card display ─────────────────────────────
  // bullishLevel = nearest resistance above price (take-profit area)
  // bearishLevel = nearest support below price (entry/stop area)
  const bullishLevel = nearestResistance(levels, currentPrice);
  const bearishLevel = nearestSupport(levels, currentPrice);

  return {
    timeframe,
    bullishLevel,
    bearishLevel,
    bullishScore: score,
    bearishScore: 100 - score,
    bias,
    strength: TF_WEIGHTS[timeframe],
  };
}
