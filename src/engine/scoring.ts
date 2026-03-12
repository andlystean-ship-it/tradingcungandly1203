/**
 * scoring.ts
 * Structure-based per-timeframe signal scoring.
 *
 * Scoring components (weighted):
 *   1. Price vs Pivot position    (20%)  — where price sits in S2→R2 range
 *   2. Pivot reclaim/loss         (15%)  — did price close above/below pivot?
 *   3. Momentum (8 candles)       (15%)  — weighted body direction
 *   4. Support reaction           (10%)  — bounce off nearest support
 *   5. Resistance rejection       (10%)  — rejection at nearest resistance
 *   6. Trendline interaction      (10%)  — price above ascending / below descending
 *   7. Break/retest confirmation  (10%)  — recent S/R break with retest hold
 *   8. Volatility filter          (5%)   — low vol = neutral; high vol = amplify
 *   9. HTF alignment bonus/penalty(5%)   — alignment with higher timeframe bias
 *
 * bullishLevel / bearishLevel from confirmed swing structure per TF.
 */

import type { CandleData, Timeframe, TimeframeSignal, Bias, Trendline, LevelMeta } from "../types";
import { calcPivot, nearestSupport, nearestResistance } from "./pivot";
import { detectSwingHighs, detectSwingLows } from "./swings";
import { buildTrendlines } from "./trendlines";
import { DEFAULT_WEIGHTS, BIAS_THRESHOLDS, type ScoreBreakdown } from "./score-config";

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

/** HTF alignment map: which timeframe is the "parent" for alignment checks */
const HTF_PARENT: Partial<Record<Timeframe, Timeframe>> = {
  "15M": "1H",
  "1H": "4H",
  "2H": "4H",
  "4H": "1D",
  "6H": "1D",
  "8H": "1D",
  "12H": "1D",
};

// ── Component scorers (each returns 0–100, 0=bearish, 100=bullish) ────────────

function scorePosition(price: number, s2: number, r2: number): number {
  const span = r2 - s2 || 1;
  return Math.max(0, Math.min(100, ((price - s2) / span) * 100));
}

function scorePivotReclaim(candles: CandleData[], pivot: number): number {
  // Check last 3 candle closes relative to pivot
  const recent = candles.slice(-3);
  let above = 0;
  for (const c of recent) {
    if (c.close > pivot) above++;
  }
  // 3/3 above = 85, 2/3 = 65, 1/3 = 35, 0/3 = 15
  return 15 + (above / 3) * 70;
}

function scoreMomentum(candles: CandleData[]): number {
  const slice = candles.slice(-8);
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    const w = i + 1;
    const bodyRange = Math.max(c.high - c.low, 0.0001);
    const bullishBody = (c.close - c.open) / bodyRange;
    weightedSum += bullishBody * w;
    totalWeight += w;
  }
  return 50 + (weightedSum / totalWeight) * 50;
}

function scoreSupportReaction(candles: CandleData[], supportLevel: number): number {
  // Check if price recently touched support and bounced (last 5 candles)
  const recent = candles.slice(-5);
  const atr = recent.reduce((s, c) => s + (c.high - c.low), 0) / recent.length;
  const touchZone = atr * 0.5;

  for (const c of recent) {
    if (c.low <= supportLevel + touchZone && c.close > supportLevel) {
      // Bounced off support — bullish
      return 80;
    }
    if (c.close < supportLevel - touchZone) {
      // Broke support — bearish
      return 20;
    }
  }
  return 50; // no interaction
}

function scoreResistanceRejection(candles: CandleData[], resistanceLevel: number): number {
  const recent = candles.slice(-5);
  const atr = recent.reduce((s, c) => s + (c.high - c.low), 0) / recent.length;
  const touchZone = atr * 0.5;

  for (const c of recent) {
    if (c.high >= resistanceLevel - touchZone && c.close < resistanceLevel) {
      // Rejected at resistance — bearish
      return 20;
    }
    if (c.close > resistanceLevel + touchZone) {
      // Broke resistance — bullish
      return 80;
    }
  }
  return 50; // no interaction
}

function scoreTrendlineInteraction(candles: CandleData[], trendlines: Trendline[]): number {
  if (trendlines.length === 0) return 50;

  const price = candles[candles.length - 1].close;
  let bullishSignals = 0;
  let bearishSignals = 0;
  let activeCount = 0;

  for (const t of trendlines) {
    if (!t.active) continue;
    activeCount++;

    // Extrapolate trendline to current candle index
    const lastIdx = candles.length - 1;
    if (t.x2 === t.x1) continue;
    const slope = (t.y2 - t.y1) / (t.x2 - t.x1);
    const projectedPrice = t.y1 + slope * (lastIdx - t.x1);

    if (t.kind === "ascending") {
      // Price above ascending trendline = bullish support
      if (price > projectedPrice) bullishSignals++;
      else bearishSignals++; // broke ascending = bearish
    } else {
      // Price below descending trendline = bearish resistance
      if (price < projectedPrice) bearishSignals++;
      else bullishSignals++; // broke descending = bullish
    }
  }

  if (activeCount === 0) return 50;
  const netBullish = bullishSignals - bearishSignals;
  return Math.max(0, Math.min(100, 50 + (netBullish / activeCount) * 40));
}

function scoreBreakRetest(candles: CandleData[], pivot: number, s1: number, r1: number): number {
  // Check last 10 candles for break/retest pattern
  const recent = candles.slice(-10);
  if (recent.length < 5) return 50;

  const atr = recent.reduce((s, c) => s + (c.high - c.low), 0) / recent.length;
  const retestZone = atr * 0.3;

  // Check R1 break + retest
  const brokeR1 = recent.slice(0, 5).some(c => c.close > r1);
  const retestR1 = recent.slice(-3).some(c =>
    c.low <= r1 + retestZone && c.low >= r1 - retestZone && c.close > r1
  );
  if (brokeR1 && retestR1) return 80; // bullish break/retest

  // Check S1 break + retest
  const brokeS1 = recent.slice(0, 5).some(c => c.close < s1);
  const retestS1 = recent.slice(-3).some(c =>
    c.high >= s1 - retestZone && c.high <= s1 + retestZone && c.close < s1
  );
  if (brokeS1 && retestS1) return 20; // bearish break/retest

  return 50;
}

function scoreVolatility(candles: CandleData[]): number {
  // Compare recent ATR to longer-term ATR
  const recent = candles.slice(-5);
  const longer = candles.slice(-20);
  if (longer.length < 10) return 50;

  const recentATR = recent.reduce((s, c) => s + (c.high - c.low), 0) / recent.length;
  const longerATR = longer.reduce((s, c) => s + (c.high - c.low), 0) / longer.length;
  const ratio = longerATR > 0 ? recentATR / longerATR : 1;

  // High vol (ratio > 1.5) = amplify existing direction
  // Low vol (ratio < 0.5) = push toward neutral
  // Normal = 50
  if (ratio < 0.5) return 50; // low vol = neutral
  if (ratio > 1.5) {
    // High vol: check direction of last candle
    const last = candles[candles.length - 1];
    return last.close > last.open ? 70 : 30;
  }
  return 50;
}

/**
 * HTF context passed from the pipeline to scoring.
 * If htfBias is undefined for a timeframe, no alignment adjustment is made.
 */
export type HTFContext = {
  /** Per-TF bullish score from a pre-computed parent TF */
  htfScores: Partial<Record<Timeframe, number>>;
};

function scoreHTFAlignment(
  timeframe: Timeframe,
  htfContext: HTFContext | undefined
): number {
  if (!htfContext) return 50;
  const parent = HTF_PARENT[timeframe];
  if (!parent) return 50; // 1D has no parent
  const parentScore = htfContext.htfScores[parent];
  if (parentScore === undefined) return 50;
  // If parent is bullish (>60), add bullish bonus; if bearish (<40), add bearish penalty
  return parentScore;
}

/**
 * Score a single timeframe from its candle series, with full structure context.
 */
export function scoreTimeframe(
  timeframe: Timeframe,
  candles: CandleData[],
  htfContext?: HTFContext
): TimeframeSignal {
  const levels = calcPivot(candles);
  const { pivot, r1, r2, s1, s2 } = levels;
  const currentPrice = candles[candles.length - 1].close;

  // Build trendlines for this TF's own candle series
  const tfTrendlines = buildTrendlines(candles);

  // Nearest support/resistance from pivot
  const supportLvl = nearestSupport(levels, currentPrice);
  const resistanceLvl = nearestResistance(levels, currentPrice);

  // ── 9 scoring components ──────────────────────────────────────────────────
  const s_position     = scorePosition(currentPrice, s2, r2);
  const s_pivotReclaim = scorePivotReclaim(candles, pivot);
  const s_momentum     = scoreMomentum(candles);
  const s_support      = scoreSupportReaction(candles, supportLvl);
  const s_resistance   = scoreResistanceRejection(candles, resistanceLvl);
  const s_trendline    = scoreTrendlineInteraction(candles, tfTrendlines);
  const s_breakRetest  = scoreBreakRetest(candles, pivot, s1, r1);
  const s_volatility   = scoreVolatility(candles);
  const s_htf          = scoreHTFAlignment(timeframe, htfContext);

  // ── Weighted combination (from centralized config) ──────────────────────────
  const w = DEFAULT_WEIGHTS;
  const rawScore =
    s_position     * w.position +
    s_pivotReclaim * w.pivotReclaim +
    s_momentum     * w.momentum +
    s_support      * w.support +
    s_resistance   * w.resistance +
    s_trendline    * w.trendline +
    s_breakRetest  * w.breakRetest +
    s_volatility   * w.volatility +
    s_htf          * w.htfAlignment;

  const score = Math.round(Math.max(0, Math.min(100, rawScore)));
  const bias: Bias = score > BIAS_THRESHOLDS.bullish ? "bullish"
    : score < BIAS_THRESHOLDS.bearish ? "bearish"
    : "neutral";

  // ── Score breakdown for audit ─────────────────────────────────────────────
  const scoreBreakdown: ScoreBreakdown = {
    position: Math.round(s_position),
    pivotReclaim: Math.round(s_pivotReclaim),
    momentum: Math.round(s_momentum),
    support: Math.round(s_support),
    resistance: Math.round(s_resistance),
    trendline: Math.round(s_trendline),
    breakRetest: Math.round(s_breakRetest),
    volatility: Math.round(s_volatility),
    htfAlignment: Math.round(s_htf),
    total: score,
  };

  // ── Swing-based bullish / bearish levels ────────────────────────────────────
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

  const usedSwingHigh = swingHighsAbove.length > 0;
  const bullishLevel = usedSwingHigh
    ? swingHighsAbove[0].price
    : nearestResistance(levels, currentPrice);

  const usedSwingLow = swingLowsBelow.length > 0;
  const bearishLevel = usedSwingLow
    ? swingLowsBelow[0].price
    : nearestSupport(levels, currentPrice);

  // ── Level selection metadata ──────────────────────────────────────────────
  const bullishLevelMeta: LevelMeta = {
    selectedFrom: usedSwingHigh ? `swing-${timeframe}` : `pivot-${timeframe}`,
    selectionReason: usedSwingHigh
      ? `nearest swing high within ${searchWindow.toFixed(0)} range`
      : "fallback to pivot resistance (no nearby swing high)",
    levelQuality: usedSwingHigh ? Math.min(100, 50 + TF_WEIGHTS[timeframe] * 8) : 30,
  };

  const bearishLevelMeta: LevelMeta = {
    selectedFrom: usedSwingLow ? `swing-${timeframe}` : `pivot-${timeframe}`,
    selectionReason: usedSwingLow
      ? `nearest swing low within ${searchWindow.toFixed(0)} range`
      : "fallback to pivot support (no nearby swing low)",
    levelQuality: usedSwingLow ? Math.min(100, 50 + TF_WEIGHTS[timeframe] * 8) : 30,
  };

  return {
    timeframe,
    bullishLevel: Math.round(bullishLevel * 100) / 100,
    bearishLevel: Math.round(bearishLevel * 100) / 100,
    bullishScore: score,
    bearishScore: 100 - score,
    bias,
    strength: TF_WEIGHTS[timeframe],
    scoreBreakdown,
    bullishLevelMeta,
    bearishLevelMeta,
  };
}
