/**
 * trend-context.ts
 * Multi-timeframe trend context layer.
 *
 * Aggregates trendline and swing structure from multiple timeframes
 * into a structured trend summary consumed by the scenario engine.
 *
 * Does NOT render anything — this is pure analysis logic.
 */

import type { CandleData, Trendline, Timeframe } from "../types";
import { buildTrendlines } from "./trendlines";

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
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildLayer(trendlines: Trendline[]): TrendLayer {
  const active = trendlines.filter(t => t.active);
  const ascending = active.filter(t => t.kind === "ascending");
  const descending = active.filter(t => t.kind === "descending");

  let direction: TrendDirection = "neutral";

  if (ascending.length > descending.length) {
    direction = "bullish";
  } else if (descending.length > ascending.length) {
    direction = "bearish";
  } else if (ascending.length > 0 && descending.length > 0) {
    // Equal count — compare strengths
    const ascStr = ascending.reduce((s, t) => s + t.strength, 0);
    const descStr = descending.reduce((s, t) => s + t.strength, 0);
    if (ascStr > descStr * 1.2) direction = "bullish";
    else if (descStr > ascStr * 1.2) direction = "bearish";
  }

  const dominant =
    active.length > 0
      ? active.reduce((best, t) => (t.strength > best.strength ? t : best))
      : null;

  const strength =
    active.length > 0
      ? Math.round(active.reduce((s, t) => s + t.strength, 0) / active.length)
      : 0;

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

  if (bullishCount === nonNeutral.length) return "aligned_bullish";
  if (bearishCount === nonNeutral.length) return "aligned_bearish";
  if (bullishCount > 0 && bearishCount > 0) return "mixed";

  // Partial: some directional + some neutral
  if (bullishCount > bearishCount) return "aligned_bullish";
  if (bearishCount > bullishCount) return "aligned_bearish";
  return "neutral";
}

// ── Main builder ─────────────────────────────────────────────────────────────

export function buildTrendContext(
  candleMap: Record<Timeframe, CandleData[]>,
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

  return { shortTerm, mediumTerm, higherTimeframe, alignment };
}
