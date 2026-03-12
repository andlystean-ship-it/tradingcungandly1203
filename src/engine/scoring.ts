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
import { calcEMA, lastEMA } from "./candles";

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function calcATR(candles: CandleData[], period = 14): number {
  const slice = candles.slice(-Math.min(period, candles.length));
  if (slice.length === 0) return 0;
  return slice.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / slice.length;
}

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
  const floor = Math.min(s2, r2);
  const ceiling = Math.max(s2, r2);
  const span = ceiling - floor || Math.max(Math.abs(price), 1);
  return clampScore(((price - floor) / span) * 100);
}

function scorePivotReclaim(candles: CandleData[], pivot: number): number {
  const recent = candles.slice(-4);
  if (recent.length === 0) return 50;

  const aboveCount = recent.filter(candle => candle.close > pivot).length;
  const last = recent[recent.length - 1];
  const prev = recent.length > 1 ? recent[recent.length - 2] : last;
  const atr = calcATR(candles, 10) || Math.max(last.high - last.low, 0.0001);

  let score = 20 + (aboveCount / recent.length) * 60;
  if (prev.close <= pivot && last.close > pivot && last.low <= pivot + atr * 0.15) score += 12;
  if (prev.close >= pivot && last.close < pivot && last.high >= pivot - atr * 0.15) score -= 12;

  const distance = Math.abs(last.close - pivot) / atr;
  if (distance < 0.2) score -= 8;
  return clampScore(score);
}

function scoreEMAContext(candles: CandleData[]): number {
  if (candles.length < 20) return 50;

  const ema20 = lastEMA(candles, 20);
  const ema50 = candles.length >= 50 ? lastEMA(candles, 50) : NaN;
  const ema200 = candles.length >= 200 ? lastEMA(candles, 200) : NaN;
  const ema20Series = calcEMA(candles, 20);
  const ema20Slope = ema20Series.length >= 4 ? ema20Series[ema20Series.length - 1] - ema20Series[ema20Series.length - 4] : 0;
  const price = candles[candles.length - 1].close;

  let bullish = 0;
  let bearish = 0;

  if (price > ema20) bullish += 1; else bearish += 1;
  if (ema20Slope > 0) bullish += 0.8; else if (ema20Slope < 0) bearish += 0.8;

  if (!Number.isNaN(ema50)) {
    if (price > ema50) bullish += 1; else bearish += 1;
    if (ema20 > ema50) bullish += 1; else bearish += 1;
  }

  if (!Number.isNaN(ema200)) {
    if (price > ema200) bullish += 1.2; else bearish += 1.2;
    if (!Number.isNaN(ema50) && ema50 > ema200) bullish += 1.4;
    else if (!Number.isNaN(ema50)) bearish += 1.4;
  }

  const total = bullish + bearish || 1;
  return clampScore(50 + ((bullish - bearish) / total) * 50);
}

function scoreMomentum(candles: CandleData[]): number {
  const slice = candles.slice(-8);
  if (slice.length === 0) return 50;

  let bullishPressure = 0;
  let bearishPressure = 0;
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    const prev = i > 0 ? slice[i - 1] : undefined;
    const weight = (i + 1) / slice.length;
    const range = Math.max(c.high - c.low, 0.0001);
    const body = c.close - c.open;
    const bodyRatio = Math.abs(body) / range;
    const closeLocation = (c.close - c.low) / range;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    const bullishComponent = Math.max(0, body) / range + closeLocation * 0.6 + Math.max(0, lowerWick - upperWick) / range * 0.25;
    const bearishComponent = Math.max(0, -body) / range + (1 - closeLocation) * 0.6 + Math.max(0, upperWick - lowerWick) / range * 0.25;

    bullishPressure += bullishComponent * Math.max(0.35, bodyRatio) * weight;
    bearishPressure += bearishComponent * Math.max(0.35, bodyRatio) * weight;

    if (prev) {
      if (c.high > prev.high && c.low > prev.low) bullishPressure += 0.25 * weight;
      if (c.high < prev.high && c.low < prev.low) bearishPressure += 0.25 * weight;
    }
  }

  const total = bullishPressure + bearishPressure || 1;
  const priceActionScore = clampScore(50 + ((bullishPressure - bearishPressure) / total) * 50);
  const emaScore = scoreEMAContext(candles);
  return clampScore(priceActionScore * 0.65 + emaScore * 0.35);
}

function scoreSupportReaction(candles: CandleData[], supportLevel: number): number {
  const recent = candles.slice(-6);
  if (recent.length === 0) return 50;
  const atr = calcATR(recent, recent.length) || 0.0001;
  const touchZone = atr * 0.5;

  let touchCount = 0;
  let breakCount = 0;
  let bullishCloseCount = 0;
  for (const c of recent) {
    if (c.low <= supportLevel + touchZone) touchCount++;
    if (c.close < supportLevel - touchZone) breakCount++;
    if (c.close > c.open && c.close > supportLevel) bullishCloseCount++;
  }

  if (breakCount >= 2) return 18;
  if (touchCount > 0) {
    return clampScore(58 + touchCount * 7 + bullishCloseCount * 4 - breakCount * 12);
  }
  return 50;
}

function scoreResistanceRejection(candles: CandleData[], resistanceLevel: number): number {
  const recent = candles.slice(-6);
  if (recent.length === 0) return 50;
  const atr = calcATR(recent, recent.length) || 0.0001;
  const touchZone = atr * 0.5;

  let touchCount = 0;
  let breakoutCount = 0;
  let bearishCloseCount = 0;
  for (const c of recent) {
    if (c.high >= resistanceLevel - touchZone) touchCount++;
    if (c.close > resistanceLevel + touchZone) breakoutCount++;
    if (c.close < c.open && c.close < resistanceLevel) bearishCloseCount++;
  }

  if (breakoutCount >= 2) return 82;
  if (touchCount > 0) {
    return clampScore(42 - touchCount * 5 - bearishCloseCount * 4 + breakoutCount * 12);
  }
  return 50;
}

function scoreTrendlineInteraction(candles: CandleData[], trendlines: Trendline[]): number {
  if (trendlines.length === 0) return 50;

  const price = candles[candles.length - 1].close;
  let signedScore = 0;
  let totalWeight = 0;

  for (const t of trendlines) {
    if (!t.active) continue;

    const lastIdx = candles.length - 1;
    if (t.x2 === t.x1) continue;
    const slope = (t.y2 - t.y1) / (t.x2 - t.x1);
    const projectedPrice = t.y1 + slope * (lastIdx - t.x1);

    const distancePct = Math.abs(price - projectedPrice) / Math.max(price, 0.0001);
    const proximityFactor = Math.max(0.2, 1 - distancePct * 25);
    const directionSign = price >= projectedPrice
      ? (t.kind === "ascending" ? 1 : 0.6)
      : (t.kind === "descending" ? -1 : -0.6);
    const slopeSign = slope >= 0 ? 1 : -1;
    const weight = Math.max(0.2, (t.strength / 100) * proximityFactor * (1 + Math.min(1, Math.abs(slope) * 500)));

    signedScore += directionSign * slopeSign * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 50;
  return clampScore(50 + (signedScore / totalWeight) * 35);
}

function scoreBreakRetest(candles: CandleData[], supportLevel: number, resistanceLevel: number): number {
  const recent = candles.slice(-10);
  if (recent.length < 5) return 50;

  const atr = calcATR(recent, recent.length) || 0.0001;
  const retestZone = atr * 0.3;

  const brokeR1 = recent.slice(0, 5).some(c => c.close > resistanceLevel + retestZone * 0.5);
  const retestR1 = recent.slice(-3).some(c =>
    c.low <= resistanceLevel + retestZone && c.low >= resistanceLevel - retestZone && c.close > resistanceLevel
  );
  if (brokeR1 && retestR1) return 80;

  const brokeS1 = recent.slice(0, 5).some(c => c.close < supportLevel - retestZone * 0.5);
  const retestS1 = recent.slice(-3).some(c =>
    c.high >= supportLevel - retestZone && c.high <= supportLevel + retestZone && c.close < supportLevel
  );
  if (brokeS1 && retestS1) return 20;

  return 50;
}

function scoreVolatility(candles: CandleData[]): number {
  const recent = candles.slice(-5);
  const longer = candles.slice(-20);
  if (longer.length < 10) return 50;

  const recentATR = calcATR(recent, recent.length);
  const longerATR = calcATR(longer, longer.length);
  const ratio = longerATR > 0 ? recentATR / longerATR : 1;

  if (ratio < 0.5) return 50;
  if (ratio > 1.5) {
    const lastThree = candles.slice(-3);
    const directional = lastThree.reduce((sum, candle) => sum + (candle.close - candle.open), 0);
    return directional >= 0 ? 68 : 32;
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
  const tfTrendlines = buildTrendlines(candles, timeframe);

  const avgBarRange = calcATR(candles, 14);
  const searchWindow = Math.max(avgBarRange * 6, currentPrice * 0.01);

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

  const supportLvl = bearishLevel;
  const resistanceLvl = bullishLevel;

  // ── 9 scoring components ──────────────────────────────────────────────────
  const s_position     = scorePosition(currentPrice, s2, r2);
  const s_pivotReclaim = scorePivotReclaim(candles, pivot);
  const s_momentum     = scoreMomentum(candles);
  const s_support      = scoreSupportReaction(candles, supportLvl);
  const s_resistance   = scoreResistanceRejection(candles, resistanceLvl);
  const s_trendline    = scoreTrendlineInteraction(candles, tfTrendlines);
  const s_breakRetest  = scoreBreakRetest(candles, supportLvl, resistanceLvl);
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

  const directionalBoost =
    (s_momentum - 50) * 0.25 +
    (s_pivotReclaim - 50) * 0.15 +
    (s_trendline - 50) * 0.15;

  const score = Math.round(clampScore(rawScore + directionalBoost));
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
