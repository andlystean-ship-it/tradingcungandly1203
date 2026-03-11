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

import type { CandleData, Symbol, Timeframe } from "../types";
import { generateCandles } from "./candles";

// ── Constants ─────────────────────────────────────────────────────────────────
const BINANCE_BASE = "https://api.binance.com/api/v3";
const CANDLE_LIMIT = 100; // candles per request
const FETCH_TIMEOUT_MS = 8000;

// ── Symbol → Binance pair ─────────────────────────────────────────────────────
const BINANCE_SYMBOL: Record<Symbol, string> = {
  "XAU/USDT": "XAUUSDT",
  "BTC/USDT": "BTCUSDT",
};

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
  count = CANDLE_LIMIT
): Promise<CandleData[]> {
  const pair = BINANCE_SYMBOL[symbol];
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

export type CandleMap = Record<Timeframe, CandleData[]>;
export type FetchResult = {
  candleMap: CandleMap;
  source: "live" | "demo";
  warning?: string;
};

/**
 * Fetch a complete multi-timeframe candle map for a symbol.
 *
 * Strategy:
 * - Try all timeframes concurrently from Binance.
 * - If ALL succeed → source = "live"
 * - If ANY fail → fall back to fully demo (for consistency: mixing live and
 *   generated candles across timeframes would produce misleading signals).
 */
export async function fetchCandleMap(symbol: Symbol): Promise<FetchResult> {
  const timeframes: Timeframe[] = [
    "15M",
    "1H",
    "2H",
    "4H",
    "6H",
    "8H",
    "12H",
    "1D",
  ];

  try {
    const results = await Promise.all(
      timeframes.map((tf) => fetchBinanceCandles(symbol, tf))
    );
    const candleMap = {} as CandleMap;
    timeframes.forEach((tf, i) => {
      candleMap[tf] = results[i];
    });
    return { candleMap, source: "live" };
  } catch (err) {
    // Network unavailable or symbol not found — fall back to demo
    const candleMap = {} as CandleMap;
    const warning =
      err instanceof Error ? err.message : "Binance unavailable — demo mode";
    for (const tf of timeframes) {
      candleMap[tf] = generateCandles(symbol, tf);
    }
    return { candleMap, source: "demo", warning };
  }
}
