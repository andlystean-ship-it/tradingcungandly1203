/**
 * market-data.ts
 * Binance public REST adapter — no API key required.
 *
 * Fetches real OHLCV candles (klines) for each timeframe.
 * Falls back to deterministic generated candles on network failure.
 *
 * Symbol mapping:
 *   XAU/USDT  → XAUUSDT  (Binance gold spot)
 *   BTC/USDT  → BTCUSDT  (Binance BTC spot)
 *
 * Binance kline response per element:
 *   [0]  openTime (ms)
 *   [1]  open
 *   [2]  high
 *   [3]  low
 *   [4]  close
 *   [5]  volume
 *   [6]  closeTime (ms)
 *   ...  (ignored)
 */

import type { CandleData, CandleMap, Symbol, Timeframe, TimeframeStatus, SourceMode } from "../types";
import { FETCH_COUNTS } from "./windows";

// ── Constants ─────────────────────────────────────────────────────────────────
const BINANCE_BASE = "https://api.binance.com/api/v3";
const CANDLE_LIMIT = 100; // candles per request
const FETCH_TIMEOUT_MS = 8000;

// ── Symbol → Binance pair ─────────────────────────────────────────────────────
// XAU uses PAXGUSDT (Pax Gold, 1:1 gold-backed token on Binance spot).
// True XAUUSD spot would require a forex/metals API (e.g., MetalpriceAPI).
// TODO: If a metals API provider is added, route XAU through it instead.
const BINANCE_SYMBOL: Record<string, string> = {
  "XAU/USDT": "PAXGUSDT",
  "BTC/USDT": "BTCUSDT",
  "ETH/USDT": "ETHUSDT",
  "SOL/USDT": "SOLUSDT",
  "BNB/USDT": "BNBUSDT",
  "XRP/USDT": "XRPUSDT",
  "ADA/USDT": "ADAUSDT",
  "DOGE/USDT": "DOGEUSDT",
  "DOT/USDT": "DOTUSDT",
  "AVAX/USDT": "AVAXUSDT",
  "LINK/USDT": "LINKUSDT",
  "SUI/USDT": "SUIUSDT",
};

/** Resolve symbol → Binance pair. Falls back to stripping "/" for dynamic symbols. */
function toBinancePair(symbol: Symbol): string {
  return BINANCE_SYMBOL[symbol] ?? symbol.replace("/", "");
}

// ── Provider info — honest labeling about what data we actually show ──────────
export type ProviderInfo = {
  provider: string;
  actualPair: string;
  proxyWarning?: string;
};

const PROVIDER_INFO: Record<string, ProviderInfo> = {
  "XAU/USDT": {
    provider: "Binance PAXG proxy",
    actualPair: "PAXGUSDT",
    proxyWarning: "This is Pax Gold (PAXG), not true XAU spot. Prices may deviate from London spot gold.",
  },
  "BTC/USDT": { provider: "Binance Spot", actualPair: "BTCUSDT" },
  "ETH/USDT": { provider: "Binance Spot", actualPair: "ETHUSDT" },
  "SOL/USDT": { provider: "Binance Spot", actualPair: "SOLUSDT" },
  "BNB/USDT": { provider: "Binance Spot", actualPair: "BNBUSDT" },
  "XRP/USDT": { provider: "Binance Spot", actualPair: "XRPUSDT" },
  "ADA/USDT": { provider: "Binance Spot", actualPair: "ADAUSDT" },
  "DOGE/USDT": { provider: "Binance Spot", actualPair: "DOGEUSDT" },
  "DOT/USDT": { provider: "Binance Spot", actualPair: "DOTUSDT" },
  "AVAX/USDT": { provider: "Binance Spot", actualPair: "AVAXUSDT" },
  "LINK/USDT": { provider: "Binance Spot", actualPair: "LINKUSDT" },
  "SUI/USDT": { provider: "Binance Spot", actualPair: "SUIUSDT" },
};

export function getProviderInfo(symbol: Symbol): ProviderInfo {
  return PROVIDER_INFO[symbol] ?? {
    provider: "Binance Spot",
    actualPair: toBinancePair(symbol),
  };
}

// ── Timeframe → Binance interval ──────────────────────────────────────────────
const BINANCE_INTERVAL: Record<Timeframe, string> = {
  "15M": "15m",
  "1H": "1h",
  "2H": "2h",
  "4H": "4h",
  "6H": "6h",
  "8H": "8h",
  "12H": "12h",
  "1D": "1d",
};

// ── Raw Binance kline row ─────────────────────────────────────────────────────
type BinanceKline = [
  number,  // 0  openTime ms
  string,  // 1  open
  string,  // 2  high
  string,  // 3  low
  string,  // 4  close
  string,  // 5  volume
  number,  // 6  closeTime ms
  ...unknown[]
];

// ── Fetch with timeout ────────────────────────────────────────────────────────
async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Parse Binance kline array → CandleData ────────────────────────────────────
function parseKlines(rows: BinanceKline[]): CandleData[] {
  return rows.map((row) => ({
    time: Math.floor(row[0] / 1000), // ms → seconds
    open: parseFloat(row[1]),
    high: parseFloat(row[2]),
    low: parseFloat(row[3]),
    close: parseFloat(row[4]),
  }));
}

/**
 * Fetch OHLCV candles for one (symbol, timeframe) pair from Binance.
 * Throws on network error or non-200 response.
 */
export async function fetchBinanceCandles(
  symbol: Symbol,
  timeframe: Timeframe,
  count = FETCH_COUNTS[timeframe]
): Promise<CandleData[]> {
  const pair = toBinancePair(symbol);
  const interval = BINANCE_INTERVAL[timeframe];
  const url = `${BINANCE_BASE}/klines?symbol=${pair}&interval=${interval}&limit=${count}`;

  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`Binance ${pair}/${interval}: HTTP ${res.status}`);
  }
  const rows: BinanceKline[] = await res.json();
  const candles = parseKlines(rows);
  if (candles.length < 2) {
    throw new Error(`Binance ${pair}/${interval}: insufficient candle data`);
  }
  return candles;
}

export type FetchResult = {
  candleMap: CandleMap;
  source: "live" | "partial";
  /** Granular source classification */
  sourceMode: SourceMode;
  warning?: string;
  /** Per-timeframe fetch status */
  perTimeframe: Record<Timeframe, TimeframeStatus>;
  /** How many TFs fetched live */
  liveTfCount: number;
  totalTfCount: number;
  /** Provider info for honest labeling */
  providerInfo: ProviderInfo;
  /** Timeframe completeness 0–100 */
  timeframeCompleteness: number;
  /** TFs that failed and are missing from candleMap */
  missingTimeframes: Timeframe[];
};

const ALL_TIMEFRAMES: Timeframe[] = [
  "15M", "1H", "2H", "4H", "6H", "8H", "12H", "1D",
];

/**
 * Fetch a complete multi-timeframe candle map for a symbol.
 *
 * Strategy:
 * - Try all timeframes concurrently from Binance.
 * - Per-TF: if fetch succeeds → "live", if fetch fails → "failed" (excluded from candleMap)
 * - If ALL succeed → source = "live"
 * - If SOME succeed → source = "partial" (missing TFs excluded, clearly labeled)
 * - If ALL fail → throws (useEngine keeps last-good-snapshot)
 *
 * Failed TFs are NOT replaced with generated candles.
 * The engine pipeline must tolerate missing TFs.
 */
export async function fetchCandleMap(symbol: Symbol): Promise<FetchResult> {
  const perTimeframe = {} as Record<Timeframe, TimeframeStatus>;
  const candleMap = {} as CandleMap;
  const warnings: string[] = [];
  const missingTimeframes: Timeframe[] = [];
  let liveTfCount = 0;

  const settled = await Promise.allSettled(
    ALL_TIMEFRAMES.map(async (tf) => {
      const candles = await fetchBinanceCandles(symbol, tf, FETCH_COUNTS[tf]);
      return { tf, candles };
    })
  );

  for (const result of settled) {
    if (result.status === "fulfilled") {
      const { tf, candles } = result.value;
      candleMap[tf] = candles;
      perTimeframe[tf] = "live";
      liveTfCount++;
    } else {
      const idx = settled.indexOf(result);
      const tf = ALL_TIMEFRAMES[idx];
      const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      warnings.push(`${tf}: ${errMsg}`);
      perTimeframe[tf] = "failed";
      missingTimeframes.push(tf);
      // No generated fallback — TF is excluded from candleMap
    }
  }

  const totalTfCount = ALL_TIMEFRAMES.length;
  const timeframeCompleteness = Math.round((liveTfCount / totalTfCount) * 100);
  let source: "live" | "partial";
  let warning: string | undefined;

  if (liveTfCount === totalTfCount) {
    source = "live";
  } else if (liveTfCount === 0) {
    throw new Error(`All ${totalTfCount} timeframes failed. ${warnings.join("; ")}`);
  } else {
    source = "partial";
    warning = `${liveTfCount}/${totalTfCount} TFs live. Missing: ${missingTimeframes.join(", ")}. ${warnings.join("; ")}`;
  }

  const providerInfo = getProviderInfo(symbol);
  const sourceMode: SourceMode = providerInfo.proxyWarning ? "proxy" : source === "live" ? "live" : "partial";

  return {
    candleMap, source, sourceMode, warning, perTimeframe,
    liveTfCount, totalTfCount, providerInfo,
    timeframeCompleteness, missingTimeframes,
  };
}
