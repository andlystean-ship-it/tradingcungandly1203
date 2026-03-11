/**
 * candles.ts
 * Deterministic per-timeframe OHLCV candle generation.
 *
 * In production this module would be replaced by a real market data adapter
 * that fetches candles from an exchange API. Until then we use a seeded
 * pseudo-random walk so that the engine output is deterministic (same symbol
 * + same session timestamp → same price series, no flicker on re-render).
 */

import type { CandleData, Timeframe, Symbol } from "../types";

// ── Seeded linear-congruential generator ──────────────────────────────────────
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223;
    s = s >>> 0;
    return s / 0x100000000;
  };
}

// ── Per-symbol base configuration ─────────────────────────────────────────────
const SYMBOL_CFG = {
  "XAU/USDT": { seed: 42, basePrice: 3110, volatility: 10 },
  "BTC/USDT": { seed: 77, basePrice: 83000, volatility: 650 },
} as const;

// ── Timeframe → candle interval in seconds ────────────────────────────────────
export const TF_SECONDS: Record<Timeframe, number> = {
  "15M": 900,
  "1H": 3600,
  "2H": 7200,
  "4H": 14400,
  "6H": 21600,
  "8H": 28800,
  "12H": 43200,
  "1D": 86400,
};

/**
 * Generate `count` OHLCV candles for a given symbol at a given timeframe.
 *
 * The seed is derived from (symbol seed) + (timeframe multiplier) so that
 * each timeframe has a distinct but reproducible price series.
 */
export function generateCandles(
  symbol: Symbol,
  timeframe: Timeframe,
  count = 80
): CandleData[] {
  const cfg = SYMBOL_CFG[symbol];
  const tfMul = TF_SECONDS[timeframe] / 900; // 15M = 1, 1H = 4, 1D = 96
  const rng = seededRng(cfg.seed + tfMul * 13);

  // Scale volatility up for longer timeframes
  const vol = cfg.volatility * Math.sqrt(tfMul);
  let price: number = cfg.basePrice;

  // Pin the series to a stable epoch: midnight UTC of a fixed reference date.
  // This means candle timestamps don't drift on every page load, which keeps
  // engine output stable (anti-repaint: prices won't shift between renders).
  const REF_EPOCH = 1741564800; // 2025-03-10 00:00:00 UTC
  const interval = TF_SECONDS[timeframe];
  const startTime = REF_EPOCH - count * interval;

  const candles: CandleData[] = [];
  for (let i = 0; i < count; i++) {
    const change = (rng() - 0.49) * vol; // slight upward drift
    const open = price;
    const close = open + change;
    const wick = rng() * vol * 0.4;
    const tail = rng() * vol * 0.4;
    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - tail;

    candles.push({
      time: startTime + i * interval,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
    });
    price = close;
  }
  return candles;
}

/**
 * Build a full multi-timeframe candle map for a symbol.
 */
export function buildCandleMap(
  symbol: Symbol
): Record<Timeframe, CandleData[]> {
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
  const map = {} as Record<Timeframe, CandleData[]>;
  for (const tf of timeframes) {
    map[tf] = generateCandles(symbol, tf);
  }
  return map;
}
