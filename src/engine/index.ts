/**
 * engine/index.ts
 * Main engine runner — full pipeline in dependency order:
 *
 * candles → pivot/S/R → swings → trendlines → per-TF scoring
 * → global bias → scenario → explanation text → output contract
 *
 * The only entry points React components should call are:
 *   runEngine(symbol)  — full output
 *   getNews(symbol)    — secondary context layer (separate)
 */

import type {
  Symbol,
  Timeframe,
  EngineOutput,
  CandleData,
} from "../types";
import { buildCandleMap, generateCandles } from "./candles";
import { buildTrendlines } from "./trendlines";
import { scoreTimeframe, TF_WEIGHTS } from "./scoring";
import { computeBias } from "./bias";
import { buildScenario } from "./scenario";

export { getNews } from "./news";

// ── Public candle accessor (for chart rendering) ───────────────────────────────
export function getChartCandles(symbol: Symbol, count = 80): CandleData[] {
  return generateCandles(symbol, "1H", count);
}

// ── Main engine pipeline ───────────────────────────────────────────────────────
export function runEngine(symbol: Symbol): EngineOutput {
  const now = new Date().toISOString();

  // 1. Build per-timeframe candle map
  const candleMap = buildCandleMap(symbol);

  // 2. Use 1H candles as the reference series for chart rendering and trendlines
  const chartCandles = candleMap["1H"];
  const currentPrice = chartCandles[chartCandles.length - 1].close;

  // 3. Build trendlines from chart candles (swing structure)
  const trendlines = buildTrendlines(chartCandles);

  // 4. Score each timeframe independently from its own candles
  const timeframes = Object.keys(TF_WEIGHTS) as Timeframe[];
  const timeframeSignals = timeframes.map((tf) =>
    scoreTimeframe(tf, candleMap[tf])
  );

  // 5. Aggregate into global bias
  const marketBias = computeBias(timeframeSignals);

  // 6. Build market scenario (pivot / target / scenarios / explanation)
  const marketScenario = buildScenario(chartCandles, trendlines, symbol);

  // 7. Data status — deterministic candles are never stale in demo mode
  const dataStatus = {
    isStale: false,
    sourceStatus: "demo" as const,
    warning: "Demo mode: using deterministic generated candles (no live feed)",
    lastUpdated: now,
  };

  return {
    symbol,
    currentPrice,
    lastUpdated: now,
    marketBias,
    timeframeSignals,
    trendlines,
    marketScenario,
    dataStatus,
  };
}
