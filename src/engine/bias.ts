/**
 * bias.ts
 * Weighted global bias aggregation with conflict detection and structure context.
 *
 * Improvements over simple weighted average:
 * - Detects inter-timeframe conflict (LTF vs HTF divergence)
 * - Penalizes confidence when near pivot (awaiting confirmation)
 * - Considers trendline alignment
 * - Reports conflict level for scenario engine consumption
 */

import type { TimeframeSignal, MarketBias, CandleData, Trendline } from "../types";
import { TF_WEIGHTS } from "./scoring";
import { calcPivot } from "./pivot";

export type BiasContext = {
  chartCandles?: CandleData[];
  trendlines?: Trendline[];
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
  // Split signals into LTF (15M, 1H, 2H) vs HTF (4H, 6H, 8H, 12H, 1D)
  const ltfSignals = signals.filter(s =>
    s.timeframe === "15M" || s.timeframe === "1H" || s.timeframe === "2H"
  );
  const htfSignals = signals.filter(s =>
    s.timeframe === "4H" || s.timeframe === "6H" || s.timeframe === "8H" ||
    s.timeframe === "12H" || s.timeframe === "1D"
  );

  const ltfAvg = ltfSignals.length > 0
    ? ltfSignals.reduce((s, sig) => s + sig.bullishScore, 0) / ltfSignals.length
    : 50;
  const htfAvg = htfSignals.length > 0
    ? htfSignals.reduce((s, sig) => s + sig.bullishScore, 0) / htfSignals.length
    : 50;

  // Conflict = LTF and HTF disagree significantly
  const conflictLevel = Math.abs(ltfAvg - htfAvg);
  const hasConflict = conflictLevel > 25; // >25 point divergence

  // ── Confidence calculation ──────────────────────────────────────────────────
  // Base confidence from deviation from 50/50
  let confidence = Math.round(Math.abs(bullishPercent - 50) * 2);

  // Penalty 1: inter-timeframe conflict
  if (hasConflict) {
    confidence = Math.max(0, confidence - Math.round(conflictLevel * 0.4));
  }

  // Penalty 2: price near pivot (awaiting confirmation)
  if (context?.chartCandles && context.chartCandles.length >= 2) {
    const levels = calcPivot(context.chartCandles);
    const price = context.chartCandles[context.chartCandles.length - 1].close;
    const pivotRange = Math.abs(levels.r1 - levels.s1) || 1;
    const pivotProximity = Math.abs(price - levels.pivot) / pivotRange;
    if (pivotProximity < 0.1) {
      // Very close to pivot — heavily penalize confidence
      confidence = Math.max(0, confidence - 20);
    } else if (pivotProximity < 0.25) {
      confidence = Math.max(0, confidence - 10);
    }
  }

  // Bonus: trendline alignment
  if (context?.trendlines) {
    const activeTrends = context.trendlines.filter(t => t.active);
    const ascActive = activeTrends.filter(t => t.kind === "ascending").length;
    const descActive = activeTrends.filter(t => t.kind === "descending").length;

    if (ascActive > 0 && bullishPercent > 50) {
      confidence = Math.min(100, confidence + 5);
    } else if (descActive > 0 && bullishPercent < 50) {
      confidence = Math.min(100, confidence + 5);
    } else if ((ascActive > 0 && bullishPercent < 45) || (descActive > 0 && bullishPercent > 55)) {
      // Trendline contradicts bias — penalize
      confidence = Math.max(0, confidence - 8);
    }
  }

  // Clamp
  bullishPercent = Math.max(0, Math.min(100, bullishPercent));
  const bearishPercent = 100 - bullishPercent;

  return {
    bullishPercent,
    bearishPercent,
    dominantSide: bullishPercent >= 50 ? "long" : "short",
    confidence: Math.max(0, Math.min(100, confidence)),
  };
}
