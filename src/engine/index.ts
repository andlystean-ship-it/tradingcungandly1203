/**
 * engine/index.ts
 * Main engine runner — full pipeline in dependency order:
 *
 * candles → pivot/S/R → swings → trendlines → per-TF scoring
 * → global bias → scenario → explanation text → output contract
 *
 * Entry points:
 *   runEngine(symbol)             — synchronous, deterministic candles (tests only)
 *   runEngineAsync(symbol)        — async, fetches real candles from Binance
 *   getNews(symbol)               — secondary context layer (separate)
 */

import type {
  Symbol,
  Timeframe,
  EngineOutput,
  CandleData,
  CandleMap,
  TimeframeSignal,
  DataStatus,
  TimeframeStatus,
  SourceMode,
} from "../types";
import { buildCandleMap, generateCandles } from "./candles";
import { fetchCandleMap, type ProviderInfo } from "./market-data";
import { buildTrendlines } from "./trendlines";
import { scoreTimeframe, TF_WEIGHTS, type HTFContext } from "./scoring";
import { computeBias, type BiasContext } from "./bias";
import { buildScenario, type ScenarioInput } from "./scenario";
import { buildTrendContext } from "./trend-context";
import { WINDOWS } from "./windows";
import type { SwingConfig } from "./swings";

export { getNews } from "./news";

/** User-configurable engine parameters */
export type EngineConfig = {
  minSwingDistance?: number;
  minPriceSeparationPct?: number;
};

// ── Public candle accessor (for chart rendering) ───────────────────────────────
export function getChartCandles(symbol: Symbol, count = 80): CandleData[] {
  return generateCandles(symbol, "1H", count);
}

// ── HTF / LTF split ────────────────────────────────────────────────────────────
const HTF_SET = new Set<Timeframe>(["4H", "6H", "8H", "12H", "1D"]);

// ── Shared engine pipeline (symbol-agnostic) ──────────────────────────────────
function runPipeline(
  symbol: Symbol,
  candleMap: CandleMap,
  source: "live" | "partial",
  sourceMode: SourceMode,
  warning?: string,
  perTimeframe?: Record<Timeframe, TimeframeStatus>,
  liveTfCount?: number,
  totalTfCount?: number,
  providerInfo?: ProviderInfo,
  missingTimeframes?: Timeframe[],
  timeframeCompleteness?: number,
  engineConfig?: EngineConfig,
): EngineOutput {
  const now = new Date().toISOString();

  // 1H candles — full series for structural analysis
  const allChartCandles = candleMap["1H"];
  if (!allChartCandles || allChartCandles.length === 0) {
    throw new Error("1H candles are required for engine pipeline");
  }
  const currentPrice = allChartCandles[allChartCandles.length - 1].close;

  // Structural window: deeper slice for swing/trendline detection
  const structureCandles = allChartCandles.slice(-WINDOWS.structure);

  // Chart rendering window: only what the chart shows
  const chartCandles = allChartCandles.slice(-WINDOWS.chartRender);

  // Trendlines from the structural window (not the narrow chart window)
  const swingOverrides: Partial<SwingConfig> | undefined = engineConfig
    ? {
        minSwingDistance: engineConfig.minSwingDistance,
        minPriceSeparationPct: engineConfig.minPriceSeparationPct != null
          ? engineConfig.minPriceSeparationPct / 100   // convert % to decimal
          : undefined,
      }
    : undefined;
  const trendlines = buildTrendlines(structureCandles, "1H", swingOverrides);

  // Build multi-timeframe trend context
  const trendContext = buildTrendContext(candleMap, trendlines);

  // ── Two-pass scoring: HTF first, then LTF with htfContext ─────────────────
  const timeframes = Object.keys(TF_WEIGHTS) as Timeframe[];

  // Pass 1: Score HTF (4H, 6H, 8H, 12H, 1D) — no parent context needed
  const htfSignals: TimeframeSignal[] = [];
  const htfScores: Partial<Record<Timeframe, number>> = {};

  for (const tf of timeframes) {
    if (!HTF_SET.has(tf)) continue;
    const tfCandles = candleMap[tf];
    if (!tfCandles || tfCandles.length < 3) continue; // skip missing TFs
    const signal = scoreTimeframe(tf, tfCandles);
    htfSignals.push(signal);
    htfScores[tf] = signal.bullishScore;
  }

  // Pass 2: Score LTF (15M, 1H, 2H) with HTF alignment context
  const htfContext: HTFContext = { htfScores };
  const ltfSignals: TimeframeSignal[] = [];

  for (const tf of timeframes) {
    if (HTF_SET.has(tf)) continue;
    const tfCandles = candleMap[tf];
    if (!tfCandles || tfCandles.length < 3) continue; // skip missing TFs
    const signal = scoreTimeframe(tf, tfCandles, htfContext);
    ltfSignals.push(signal);
  }

  const timeframeSignals = [...ltfSignals, ...htfSignals];

  // ── Aggregate into global bias with structure context ─────────────────────
  const biasContext: BiasContext = { chartCandles, trendlines, trendContext };
  const marketBias = computeBias(timeframeSignals, biasContext);

  // ── Build market scenario with full MTF input ─────────────────────────────
  const scenarioInput: ScenarioInput = {
    candleMap,
    timeframeSignals,
    marketBias,
    chartTrendlines: trendlines,
    trendContext,
    symbol,
  };
  const marketScenario = buildScenario(scenarioInput);

  const dataStatus: DataStatus = {
    isStale: false,
    sourceStatus: source,
    sourceMode,
    warning:
      source === "live" && !missingTimeframes?.length
        ? providerInfo?.proxyWarning
        : warning,
    lastUpdated: now,
    perTimeframe,
    liveTfCount,
    totalTfCount,
    provider: providerInfo?.provider,
    actualPair: providerInfo?.actualPair,
    proxyWarning: providerInfo?.proxyWarning,
    proxyMode: !!providerInfo?.proxyWarning,
    timeframeCompleteness: timeframeCompleteness ?? 100,
    missingTimeframes: missingTimeframes?.length ? missingTimeframes : undefined,
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
    trendContext,
    marketScenario,
    dataStatus,
  };
}

// ── Synchronous engine (tests only — generated candles) ───────────────────────
export function runEngine(symbol: Symbol): EngineOutput {
  const candleMap = buildCandleMap(symbol);
  return runPipeline(symbol, candleMap, "live", "live");
}

// ── Async engine (real Binance candles) ────────────────────────────────────────
export async function runEngineAsync(symbol: Symbol, config?: EngineConfig): Promise<EngineOutput> {
  const {
    candleMap, source, sourceMode, warning, perTimeframe,
    liveTfCount, totalTfCount, providerInfo,
    missingTimeframes, timeframeCompleteness,
  } = await fetchCandleMap(symbol);
  return runPipeline(
    symbol, candleMap, source, sourceMode, warning, perTimeframe,
    liveTfCount, totalTfCount, providerInfo,
    missingTimeframes, timeframeCompleteness, config,
  );
}
