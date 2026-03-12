/**
 * trend-context.ts
 * Multi-timeframe trend context layer.
 *
 * Layer direction is determined by strength-weighted scoring, not line counting.
 * Pressure model uses proximity, momentum, recent breaks/retests, and HTF dominance.
 */

import type { CandleData, Trendline, Timeframe, TrendPressure } from "../types";
import { buildTrendlines } from "./trendlines";
import { lastEMA } from "./candles";

// ── Types ────────────────────────────────────────────────────────────────────

export type TrendDirection = "bullish" | "bearish" | "neutral";
export type TrendAlignment =
  | "aligned_bullish"
  | "aligned_bearish"
  | "mixed"
  | "neutral";

export type TrendLayer = {
  direction: TrendDirection;
  activeTrendlines: Trendline[];
  dominantLine: Trendline | null;
  strength: number; // 0–100
};

export type TrendContext = {
  shortTerm: TrendLayer;
  mediumTerm: TrendLayer;
  higherTimeframe: TrendLayer;
  alignment: TrendAlignment;
  /** Aggregate trend pressure near current price (P4) */
  pressure?: TrendPressure;
  /** EMA crossover signal (50/200) on 1H candles */
  emaCrossover?: {
    direction: TrendDirection;
    ema50: number;
    ema200: number;
  };
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a trend layer using slope × span × strength weighted scoring.
 * A strong, long ascending line with steep slope outweighs multiple weak short ones.
 */
function buildLayer(trendlines: Trendline[]): TrendLayer {
  const active = trendlines.filter(t => t.active);

  if (active.length === 0) {
    return { direction: "neutral", activeTrendlines: [], dominantLine: null, strength: 0 };
  }

  // Slope × span × strength weighted directional scoring
  let ascScore = 0;
  let descScore = 0;
  for (const t of active) {
    const s = t.strength;
    // Weight by touch count (more touches = more reliable)
    const touchBonus = Math.min(20, (t.touchCount ?? 1) * 5);
    // Penalize lines with violations
    const violationPenalty = Math.min(30, (t.violationCount ?? 0) * 10);

    // Slope magnitude: steeper = stronger directional signal
    const slopeMag = Math.abs(t.slope ?? 0);
    const slopeFactor = Math.min(2.0, 0.5 + slopeMag * 500); // clamp at 2x

    // Span: longer lines are more reliable
    const spanFactor = Math.min(2.0, 0.5 + (t.span ?? 10) / 30);

    const effectiveStrength = Math.max(0, (s + touchBonus - violationPenalty) * slopeFactor * spanFactor);

    if (t.kind === "ascending") ascScore += effectiveStrength;
    else descScore += effectiveStrength;
  }

  const totalScore = ascScore + descScore || 1;
  const ascRatio = ascScore / totalScore;
  const descRatio = descScore / totalScore;

  let direction: TrendDirection = "neutral";
  // Require >60% dominance to declare directional (not just majority)
  if (ascRatio > 0.6) direction = "bullish";
  else if (descRatio > 0.6) direction = "bearish";
  else if (ascScore > 0 && descScore > 0) direction = "neutral"; // contested

  const dominant = active.reduce((best, t) => (t.strength > best.strength ? t : best));
  const strength = Math.round(Math.max(ascScore, descScore) / active.length);

  return { direction, activeTrendlines: active, dominantLine: dominant, strength };
}

function computeAlignment(
  short: TrendLayer,
  medium: TrendLayer,
  higher: TrendLayer
): TrendAlignment {
  const dirs = [short.direction, medium.direction, higher.direction];
  const nonNeutral = dirs.filter(d => d !== "neutral");

  if (nonNeutral.length === 0) return "neutral";

  const bullishCount = nonNeutral.filter(d => d === "bullish").length;
  const bearishCount = nonNeutral.filter(d => d === "bearish").length;

  // Require unanimity or strong majority for "aligned"
  if (bullishCount === nonNeutral.length) return "aligned_bullish";
  if (bearishCount === nonNeutral.length) return "aligned_bearish";
  if (bullishCount > 0 && bearishCount > 0) return "mixed";

  // Partial: some directional + some neutral — only aligned if HTF agrees
  if (higher.direction === "bullish" && bullishCount > bearishCount) return "aligned_bullish";
  if (higher.direction === "bearish" && bearishCount > bullishCount) return "aligned_bearish";
  if (bullishCount > bearishCount) return "aligned_bullish";
  if (bearishCount > bullishCount) return "aligned_bearish";
  return "neutral";
}

// ── Trend pressure calculation ───────────────────────────────────────────────

function computeTrendPressure(
  candleMap: Partial<Record<Timeframe, CandleData[]>>,
  allTrendlines: Trendline[],
  htfLayer: TrendLayer,
): TrendPressure {
  const candles1H = candleMap["1H"];
  if (!candles1H || candles1H.length < 14) {
    return {
      netPressure: 0, nearbyLineCount: 0, dominantSource: "insufficient data",
      htfPressure: 0, nearPricePressure: 0, momentumPressure: 0,
      dominantPressureDirection: "neutral", pressureStrength: 0,
      pressureReason: "insufficient data for pressure calculation",
    };
  }

  const currentPrice = candles1H[candles1H.length - 1].close;
  const atr = candles1H.slice(-14).reduce((s, c) => s + (c.high - c.low), 0) / 14;
  const lastIdx = candles1H.length - 1;

  // ═══ Component 1: Near-price trendline pressure ═══════════════════════════
  let nearBullish = 0;
  let nearBearish = 0;
  let nearbyLineCount = 0;
  let dominantSource = "none";
  let maxContrib = 0;

  for (const t of allTrendlines) {
    if (t.x2 === t.x1) continue;

    const slope = (t.y2 - t.y1) / (t.x2 - t.x1);
    const projected = t.y1 + slope * (lastIdx - t.x1);
    const distance = Math.abs(currentPrice - projected);
    const distanceInATR = atr > 0 ? distance / atr : Infinity;

    if (distanceInATR > 1.5) continue; // tighter radius than before
    nearbyLineCount++;

    // Proximity: exponential decay — much stronger when very close
    const proximityFactor = Math.exp(-distanceInATR * 1.5);
    const touchQuality = Math.min(1.5, 0.5 + (t.touchCount ?? 1) * 0.25);
    const violationPenalty = 1 - Math.min(0.6, (t.violationCount ?? 0) * 0.15);
    const contribution = proximityFactor * (t.strength / 100) * touchQuality * violationPenalty * 50;

    if (t.active) {
      if (t.kind === "ascending") {
        if (currentPrice > projected) nearBullish += contribution; // support below
        else nearBearish += contribution * 1.2; // broken support = stronger bearish
      } else {
        if (currentPrice < projected) nearBearish += contribution; // resistance above
        else nearBullish += contribution * 1.2; // broken resistance = stronger bullish
      }
    } else if (t.broken) {
      // Broken lines still exert residual pressure (role reversal)
      if (t.kind === "ascending") nearBearish += contribution * 0.4; // broken support → resistance
      else nearBullish += contribution * 0.4; // broken resistance → support
    }

    if (contribution > maxContrib) {
      maxContrib = contribution;
      const tfLabel = t.sourceTimeframe ?? "1H";
      dominantSource = `${t.kind} ${tfLabel} (${distanceInATR.toFixed(1)} ATR, ${t.touchCount ?? 0} touches)`;
    }
  }

  const nearPricePressure = Math.round(Math.max(-100, Math.min(100, nearBullish - nearBearish)));

  // ═══ Component 2: Momentum pressure from candle structure ═════════════════
  const recentCandles = candles1H.slice(-8);
  let momentumPressure = 0;
  if (recentCandles.length >= 4) {
    let bullBodies = 0;
    let bearBodies = 0;
    for (let i = 0; i < recentCandles.length; i++) {
      const c = recentCandles[i];
      const bodySize = Math.abs(c.close - c.open);
      const range = c.high - c.low || 0.0001;
      const bodyRatio = bodySize / range;
      const weight = (i + 1) / recentCandles.length; // recent candles weighted more
      if (c.close > c.open) bullBodies += bodyRatio * weight;
      else bearBodies += bodyRatio * weight;
    }
    const total = bullBodies + bearBodies || 1;
    momentumPressure = Math.round(((bullBodies - bearBodies) / total) * 60);
  }

  // ═══ Component 3: HTF dominant trend pressure ═════════════════════════════
  let htfPressure = 0;
  if (htfLayer.direction === "bullish") {
    htfPressure = Math.round(htfLayer.strength * 0.8);
  } else if (htfLayer.direction === "bearish") {
    htfPressure = -Math.round(htfLayer.strength * 0.8);
  }
  // Boost if HTF dominant line has many touches
  if (htfLayer.dominantLine && (htfLayer.dominantLine.touchCount ?? 0) >= 3) {
    htfPressure = Math.round(htfPressure * 1.3);
  }
  htfPressure = Math.max(-100, Math.min(100, htfPressure));

  // ═══ Component 4: Recent break / retest detection ═════════════════════════
  let recentBreak: TrendPressure["recentBreak"];
  let recentRetest: TrendPressure["recentRetest"];
  const lookback = candles1H.slice(-7);

  for (const t of allTrendlines) {
    if (t.x2 === t.x1) continue;
    const slope = (t.y2 - t.y1) / (t.x2 - t.x1);

    for (let ri = 0; ri < lookback.length - 1; ri++) {
      const candleIdx = lastIdx - lookback.length + 1 + ri;
      const projA = t.y1 + slope * (candleIdx - t.x1);
      const projB = t.y1 + slope * (candleIdx + 1 - t.x1);
      const priceA = lookback[ri].close;
      const priceB = lookback[ri + 1].close;
      const recency = lookback.length - 1 - ri;

      // Break detection
      if (t.kind === "ascending" && priceA > projA && priceB < projB) {
        recentBreak = { direction: "bearish", recency };
      } else if (t.kind === "descending" && priceA < projA && priceB > projB) {
        recentBreak = { direction: "bullish", recency };
      }

      // Retest detection: price approached a previously broken level and bounced
      if (t.broken) {
        const retestDistance = atr > 0 ? Math.abs(lookback[ri + 1].low - projB) / atr : Infinity;
        if (retestDistance < 0.3) {
          if (t.kind === "ascending" && priceB > projB) {
            // Broken ascending retested from above → role reversal held as support = bullish
            recentRetest = { direction: "bullish", held: true };
          } else if (t.kind === "ascending" && priceB < projB) {
            recentRetest = { direction: "bearish", held: false };
          } else if (t.kind === "descending" && priceB < projB) {
            recentRetest = { direction: "bearish", held: true };
          } else if (t.kind === "descending" && priceB > projB) {
            recentRetest = { direction: "bullish", held: false };
          }
        }
      }
    }
  }

  // Apply break/retest to pressure
  let breakAdjustment = 0;
  if (recentBreak) {
    const recencyFactor = Math.max(0.3, 1 - recentBreak.recency * 0.15);
    breakAdjustment = recentBreak.direction === "bullish" ? 20 * recencyFactor : -20 * recencyFactor;
  }
  if (recentRetest?.held) {
    breakAdjustment += recentRetest.direction === "bullish" ? 15 : -15;
  }

  // ═══ Composite: weighted blend ═════════════════════════════════════════════
  const netPressure = Math.round(Math.max(-100, Math.min(100,
    nearPricePressure * 0.35 +
    momentumPressure * 0.20 +
    htfPressure * 0.30 +
    breakAdjustment * 0.15
  )));

  // ═══ Derived summary fields ═══════════════════════════════════════════════
  const dominantPressureDirection: TrendDirection =
    netPressure > 15 ? "bullish" : netPressure < -15 ? "bearish" : "neutral";
  const pressureStrength = Math.abs(netPressure);

  const parts: string[] = [];
  if (Math.abs(nearPricePressure) > 10) {
    parts.push(nearPricePressure > 0 ? "near-price support" : "near-price resistance");
  }
  if (Math.abs(htfPressure) > 15) {
    parts.push(htfPressure > 0 ? "HTF bullish trend" : "HTF bearish trend");
  }
  if (Math.abs(momentumPressure) > 10) {
    parts.push(momentumPressure > 0 ? "bullish momentum" : "bearish momentum");
  }
  if (recentBreak) {
    parts.push(`recent ${recentBreak.direction} break`);
  }
  if (recentRetest?.held) {
    parts.push(`${recentRetest.direction} retest held`);
  }
  const pressureReason = parts.length > 0 ? parts.join(" + ") : "no dominant pressure";

  return {
    netPressure, nearbyLineCount, recentBreak, recentRetest, dominantSource,
    htfPressure, nearPricePressure, momentumPressure,
    dominantPressureDirection, pressureStrength, pressureReason,
  };
}

// ── Main builder ─────────────────────────────────────────────────────────────

export function buildTrendContext(
  candleMap: Partial<Record<Timeframe, CandleData[]>>,
  chartTrendlines?: Trendline[]
): TrendContext {
  // Short term: 1H trendlines (use provided chart trendlines or rebuild)
  const shortTermLines =
    chartTrendlines ?? buildTrendlines(candleMap["1H"] ?? [], "1H");
  const shortTerm = buildLayer(shortTermLines);

  // Medium term: 4H trendlines
  const mediumTermCandles = candleMap["4H"];
  const mediumTermLines =
    mediumTermCandles && mediumTermCandles.length >= 15
      ? buildTrendlines(mediumTermCandles, "4H")
      : [];
  const mediumTerm = buildLayer(mediumTermLines);

  // Higher timeframe: 12H + 1D trendlines combined
  const htfLines: Trendline[] = [];
  const candles12H = candleMap["12H"];
  if (candles12H && candles12H.length >= 15) {
    htfLines.push(...buildTrendlines(candles12H, "12H"));
  }
  const candles1D = candleMap["1D"];
  if (candles1D && candles1D.length >= 15) {
    htfLines.push(...buildTrendlines(candles1D, "1D"));
  }
  const higherTimeframe = buildLayer(htfLines);

  const alignment = computeAlignment(shortTerm, mediumTerm, higherTimeframe);

  // Combine all trendlines for pressure calculation
  const allLines = [...shortTermLines, ...mediumTermLines, ...htfLines];
  const pressure = computeTrendPressure(candleMap, allLines, higherTimeframe);

  // ── EMA crossover on 1H candles (EMA50 vs EMA200) ────────────────────────
  const candles1H = candleMap["1H"];
  let emaCrossover: TrendContext["emaCrossover"];
  if (candles1H && candles1H.length >= 200) {
    const ema50 = lastEMA(candles1H, 50);
    const ema200 = lastEMA(candles1H, 200);
    if (!isNaN(ema50) && !isNaN(ema200)) {
      const diff = (ema50 - ema200) / ema200;
      const direction: TrendDirection =
        diff > 0.002 ? "bullish" : diff < -0.002 ? "bearish" : "neutral";
      emaCrossover = { direction, ema50, ema200 };
    }
  }

  // ── Refine alignment with EMA confirmation ────────────────────────────────
  let finalAlignment = alignment;
  if (emaCrossover && alignment === "mixed") {
    // If EMA agrees with majority direction, upgrade from mixed
    const bullCount = [shortTerm, mediumTerm, higherTimeframe]
      .filter(l => l.direction === "bullish").length;
    const bearCount = [shortTerm, mediumTerm, higherTimeframe]
      .filter(l => l.direction === "bearish").length;
    if (emaCrossover.direction === "bullish" && bullCount >= bearCount) {
      finalAlignment = "aligned_bullish";
    } else if (emaCrossover.direction === "bearish" && bearCount >= bullCount) {
      finalAlignment = "aligned_bearish";
    }
  }

  return { shortTerm, mediumTerm, higherTimeframe, alignment: finalAlignment, pressure, emaCrossover };
}
