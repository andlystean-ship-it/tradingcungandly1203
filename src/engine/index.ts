/**
 * engine/index.ts
 * Main engine runner — full pipeline in dependency order:
 *
 * candles → pivot/S/R → swings → trendlines → per-TF scoring
 * → global bias → scenario → explanation text → output contract
 *
 * Entry points:
 *   runEngine(symbol)             — synchronous, uses deterministic demo candles
 *   runEngineAsync(symbol)        — async, fetches real candles from Binance
 *                                   with automatic fallback to demo
 *   getNews(symbol)               — secondary context layer (separate)
 */

import type {
  Symbol,
  Timeframe,
  EngineOutput,
  CandleData,
} from "../types";
import { buildCandleMap, generateCandles } from "./candles";
import { fetchCandleMap } from "./market-data";
import { buildTrendlines } from "./trendlines";
import { scoreTimeframe, TF_WEIGHTS } from "./scoring";
import { computeBias } from "./bias";
import { buildScenario } from "./scenario";

export { getNews } from "./news";

// ── Public candle accessor (for chart rendering) ───────────────────────────────
export function getChartCandles(symbol: Symbol, count = 80): CandleData[] {
  return generateCandles(symbol, "1H", count);
}

// ── Shared engine pipeline (symbol-agnostic) ──────────────────────────────────
function runPipeline(
  symbol: Symbol,
  candleMap: Record<Timeframe, CandleData[]>,
  source: "live" | "demo",
  warning?: string
): EngineOutput {
  const now = new Date().toISOString();

  // 1H candles are the reference series for chart rendering and trendlines
  const chartCandles = candleMap["1H"];
  const currentPrice = chartCandles[chartCandles.length - 1].close;

  // Trendlines from 1H swing structure
  const trendlines = buildTrendlines(chartCandles);

  // Score each timeframe independently from its own candles
  const timeframes = Object.keys(TF_WEIGHTS) as Timeframe[];
  const timeframeSignals = timeframes.map((tf) =>
    scoreTimeframe(tf, candleMap[tf])
  );

  // Aggregate into global bias
  const marketBias = computeBias(timeframeSignals);

  // Build market scenario
  const marketScenario = buildScenario(chartCandles, trendlines, symbol);

  const dataStatus = {
    isStale: false,
    sourceStatus: source,
    warning:
      source === "live"
        ? undefined
        : warning ?? "Demo mode: generated candles (no live feed)",
    lastUpdated: now,
  };

  return {
    symbol,
    currentPrice,
    lastUpdated: now,
    chartCandles,
    marketBias,
    timeframeSignals,
    trendlines,
    marketScenario,
    dataStatus,
  };
}

// ── Synchronous engine (demo candles) ─────────────────────────────────────────
export function runEngine(symbol: Symbol): EngineOutput {
  const candleMap = buildCandleMap(symbol);
  return runPipeline(symbol, candleMap, "demo");
}

// ── Async engine (real Binance candles, fallback to demo) ──────────────────────
export async function runEngineAsync(symbol: Symbol): Promise<EngineOutput> {
  const { candleMap, source, warning } = await fetchCandleMap(symbol);
  return runPipeline(symbol, candleMap, source, warning);
}
