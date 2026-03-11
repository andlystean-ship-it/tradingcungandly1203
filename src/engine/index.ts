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
  TimeframeSignal,
} from "../types";
import { buildCandleMap, generateCandles } from "./candles";
import { fetchCandleMap } from "./market-data";
import { buildTrendlines } from "./trendlines";
import { scoreTimeframe, TF_WEIGHTS, type HTFContext } from "./scoring";
import { computeBias, type BiasContext } from "./bias";
import { buildScenario, type ScenarioInput } from "./scenario";

export { getNews } from "./news";

// ── Public candle accessor (for chart rendering) ───────────────────────────────
export function getChartCandles(symbol: Symbol, count = 80): CandleData[] {
  return generateCandles(symbol, "1H", count);
}

// ── HTF / LTF split ────────────────────────────────────────────────────────────
const HTF_SET = new Set<Timeframe>(["4H", "6H", "8H", "12H", "1D"]);

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

  // ── Two-pass scoring: HTF first, then LTF with htfContext ─────────────────
  const timeframes = Object.keys(TF_WEIGHTS) as Timeframe[];

  // Pass 1: Score HTF (4H, 6H, 8H, 12H, 1D) — no parent context needed
  const htfSignals: TimeframeSignal[] = [];
  const htfScores: Partial<Record<Timeframe, number>> = {};

  for (const tf of timeframes) {
    if (!HTF_SET.has(tf)) continue;
    const signal = scoreTimeframe(tf, candleMap[tf]);
    htfSignals.push(signal);
    htfScores[tf] = signal.bullishScore;
  }

  // Pass 2: Score LTF (15M, 1H, 2H) with HTF alignment context
  const htfContext: HTFContext = { htfScores };
  const ltfSignals: TimeframeSignal[] = [];

  for (const tf of timeframes) {
    if (HTF_SET.has(tf)) continue;
    const signal = scoreTimeframe(tf, candleMap[tf], htfContext);
    ltfSignals.push(signal);
  }

  const timeframeSignals = [...ltfSignals, ...htfSignals];

  // ── Aggregate into global bias with structure context ─────────────────────
  const biasContext: BiasContext = { chartCandles, trendlines };
  const marketBias = computeBias(timeframeSignals, biasContext);

  // ── Build market scenario with full MTF input ─────────────────────────────
  const scenarioInput: ScenarioInput = {
    candleMap,
    timeframeSignals,
    marketBias,
    chartTrendlines: trendlines,
    symbol,
  };
  const marketScenario = buildScenario(scenarioInput);

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
    candleMap,
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
