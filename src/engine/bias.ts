/**
 * bias.ts
 * Weighted global bias aggregation from per-timeframe signals.
 *
 * Lower timeframes have smaller weight; higher timeframes dominate.
 * Output: bullishPercent [0,100], bearishPercent [0,100], dominantSide, confidence.
 */

import type { TimeframeSignal, MarketBias } from "../types";
import { TF_WEIGHTS } from "./scoring";

export function computeBias(signals: TimeframeSignal[]): MarketBias {
  let totalWeight = 0;
  let bullishWeighted = 0;

  for (const s of signals) {
    const w = TF_WEIGHTS[s.timeframe];
    totalWeight += w;
    bullishWeighted += (s.bullishScore / 100) * w;
  }

  const bullishFrac = totalWeight > 0 ? bullishWeighted / totalWeight : 0.5;
  const bullishPercent = Math.round(bullishFrac * 100);
  const bearishPercent = 100 - bullishPercent;

  // Confidence = how far from 50/50 we are (0 = tied, 100 = fully one-sided)
  const confidence = Math.round(Math.abs(bullishPercent - 50) * 2);

  return {
    bullishPercent,
    bearishPercent,
    dominantSide: bullishPercent >= 50 ? "long" : "short",
    confidence,
  };
}
