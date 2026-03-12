/**
 * bias.ts
 * Weighted global bias aggregation with conflict detection and structure context.
 *
 * Improvements over simple weighted average:
 * - Detects inter-timeframe conflict (LTF vs HTF divergence)
 * - Penalizes confidence when near pivot (awaiting confirmation)
 * - Considers trendline alignment
 * - Integrates trend pressure into confidence
 * - Reports full debug metadata for scenario / UI consumption
 * - Hard neutral gate when conditions are genuinely conflicted
 */

import type { TimeframeSignal, MarketBias, BiasDebug, CandleData, Trendline, TrendContext } from "../types";
import { TF_WEIGHTS } from "./scoring";
import { calcPivot } from "./pivot";

export type BiasContext = {
  chartCandles?: CandleData[];
  trendlines?: Trendline[];
  trendContext?: TrendContext;
};

export function computeBias(
  signals: TimeframeSignal[],
  context?: BiasContext
): MarketBias {
  let totalWeight = 0;
  let bullishWeighted = 0;

  for (const s of signals) {
    const w = TF_WEIGHTS[s.timeframe];
    totalWeight += w;
    bullishWeighted += (s.bullishScore / 100) * w;
  }

  const bullishFrac = totalWeight > 0 ? bullishWeighted / totalWeight : 0.5;
  let bullishPercent = Math.round(bullishFrac * 100);

  // ── Conflict detection ─────────────────────────────────────────────────────
  const ltfSignals = signals.filter(s =>
    s.timeframe === "15M" || s.timeframe === "1H" || s.timeframe === "2H"
  );
  const htfSignals = signals.filter(s =>
    s.timeframe === "4H" || s.timeframe === "6H" || s.timeframe === "8H" ||
    s.timeframe === "12H" || s.timeframe === "1D"
  );

  const ltfBullishAvg = ltfSignals.length > 0
    ? ltfSignals.reduce((s, sig) => s + sig.bullishScore, 0) / ltfSignals.length
    : 50;
  const htfBullishAvg = htfSignals.length > 0
    ? htfSignals.reduce((s, sig) => s + sig.bullishScore, 0) / htfSignals.length
    : 50;

  const conflictLevel = Math.abs(ltfBullishAvg - htfBullishAvg);
  const hasConflict = conflictLevel > 25;

  // ── Confidence calculation ──────────────────────────────────────────────────
  let confidence = Math.round(Math.abs(bullishPercent - 50) * 2);

  // Penalty 1: inter-timeframe conflict
  let conflictPenalty = 0;
  if (hasConflict) {
    conflictPenalty = Math.round(conflictLevel * 0.4);
    confidence = Math.max(0, confidence - conflictPenalty);
  }

  // Penalty 2: price near pivot
  let pivotProximityPenalty = 0;
  if (context?.chartCandles && context.chartCandles.length >= 2) {
    const levels = calcPivot(context.chartCandles);
    const price = context.chartCandles[context.chartCandles.length - 1].close;
    const pivotRange = Math.abs(levels.r1 - levels.s1) || 1;
    const pivotProximity = Math.abs(price - levels.pivot) / pivotRange;
    if (pivotProximity < 0.1) {
      pivotProximityPenalty = 20;
    } else if (pivotProximity < 0.25) {
      pivotProximityPenalty = 10;
    }
    confidence = Math.max(0, confidence - pivotProximityPenalty);
  }

  // Adjustment 3: trendline alignment
  let trendlineAdjustment = 0;
  if (context?.trendlines) {
    const activeTrends = context.trendlines.filter(t => t.active);
    const ascActive = activeTrends.filter(t => t.kind === "ascending").length;
    const descActive = activeTrends.filter(t => t.kind === "descending").length;

    if (ascActive > 0 && bullishPercent > 50) {
      trendlineAdjustment = 5;
    } else if (descActive > 0 && bullishPercent < 50) {
      trendlineAdjustment = 5;
    } else if ((ascActive > 0 && bullishPercent < 45) || (descActive > 0 && bullishPercent > 55)) {
      trendlineAdjustment = -8;
    }
    confidence = Math.max(0, Math.min(100, confidence + trendlineAdjustment));
  }

  // Adjustment 4: trend pressure integration
  let trendPressurePenalty = 0;
  if (context?.trendContext?.pressure) {
    const tp = context.trendContext.pressure;
    if ((bullishPercent > 50 && tp.netPressure > 25) ||
        (bullishPercent < 50 && tp.netPressure < -25)) {
      confidence = Math.min(100, confidence + 8);
    }
    if ((bullishPercent > 55 && tp.netPressure < -15) ||
        (bullishPercent < 45 && tp.netPressure > 15)) {
      trendPressurePenalty = 10;
      confidence = Math.max(0, confidence - trendPressurePenalty);
    }
    // Extra penalty: mixed TF alignment with weak momentum → amplify doubt
    if (context.trendContext.alignment === "mixed" && Math.abs(tp.momentumPressure) < 15) {
      trendPressurePenalty += 8;
      confidence = Math.max(0, confidence - 8);
    }
  }

  // Penalty 5: LTF vs HTF on opposite sides of 50 + weak convergence
  if ((ltfBullishAvg > 55 && htfBullishAvg < 45) || (ltfBullishAvg < 45 && htfBullishAvg > 55)) {
    confidence = Math.max(0, confidence - 12);
  }

  // Clamp
  bullishPercent = Math.max(0, Math.min(100, bullishPercent));
  const bearishPercent = 100 - bullishPercent;
  confidence = Math.max(0, Math.min(100, confidence));

  // ── Neutral dominance gate ─────────────────────────────────────────────────
  let dominantSide: "long" | "short" | "neutral";
  let neutralReason: string | undefined;

  if (confidence < 20) {
    dominantSide = "neutral";
    neutralReason = `confidence quá thấp (${confidence}%)`;
  } else if (bullishPercent >= 47 && bullishPercent <= 53) {
    dominantSide = "neutral";
    neutralReason = `bullish/bearish gần bằng nhau (${bullishPercent}/${bearishPercent})`;
  } else if (hasConflict && conflictLevel > 30 && context?.trendContext?.alignment === "mixed") {
    dominantSide = "neutral";
    neutralReason = `LTF/HTF xung đột lớn (${conflictLevel.toFixed(0)}) + trend trái chiều`;
  } else {
    dominantSide = bullishPercent > 53 ? "long" : bullishPercent < 47 ? "short" : "neutral";
    if (dominantSide === "neutral") {
      neutralReason = "bullish/bearish trong vùng trung lập";
    }
  }

  const debug: BiasDebug = {
    ltfBullishAvg: Math.round(ltfBullishAvg),
    htfBullishAvg: Math.round(htfBullishAvg),
    conflictLevel: Math.round(conflictLevel),
    pivotProximityPenalty,
    trendPressurePenalty,
    trendlineAdjustment,
    neutralReason,
  };

  return {
    bullishPercent,
    bearishPercent,
    dominantSide,
    confidence,
    debug,
  };
}
