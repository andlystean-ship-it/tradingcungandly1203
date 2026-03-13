/**
 * candles.ts
 * Deterministic per-timeframe OHLCV candle generation.
 *
 * In production this module would be replaced by a real market data adapter
 * that fetches candles from an exchange API. Until then we use a seeded
 * pseudo-random walk so that the engine output is deterministic (same symbol
 * + same session timestamp → same price series, no flicker on re-render).
 */

import type { CandleData, Timeframe, Symbol, CandlePattern } from "../types";
import { FETCH_COUNTS } from "./windows";

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
const SYMBOL_CFG: Record<string, { seed: number; basePrice: number; volatility: number }> = {
  "XAU/USDT": { seed: 42, basePrice: 5180, volatility: 15 },
  "BTC/USDT": { seed: 77, basePrice: 70000, volatility: 650 },
  "ETH/USDT": { seed: 101, basePrice: 2070, volatility: 40 },
  "SOL/USDT": { seed: 113, basePrice: 87, volatility: 3 },
  "BNB/USDT": { seed: 127, basePrice: 650, volatility: 12 },
  "XRP/USDT": { seed: 139, basePrice: 1.39, volatility: 0.04 },
  "ADA/USDT": { seed: 151, basePrice: 0.26, volatility: 0.008 },
  "DOGE/USDT": { seed: 163, basePrice: 0.094, volatility: 0.003 },
  "DOT/USDT": { seed: 173, basePrice: 1.54, volatility: 0.05 },
  "AVAX/USDT": { seed: 187, basePrice: 9.7, volatility: 0.3 },
  "LINK/USDT": { seed: 199, basePrice: 9.1, volatility: 0.25 },
  "SUI/USDT": { seed: 211, basePrice: 0.99, volatility: 0.03 },
};

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
  "1W": 604800,
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
  const cfg = SYMBOL_CFG[symbol] ?? { seed: 999, basePrice: 100, volatility: 2 };
  const tfMul = TF_SECONDS[timeframe] / 900; // 15M = 1, 1H = 4, 1D = 96
  const rng = seededRng(cfg.seed + tfMul * 13);

  // Scale volatility up for longer timeframes
  const vol = cfg.volatility * Math.sqrt(tfMul);
  const baseVolume = 1000 + cfg.seed * 25 + tfMul * 40;
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
    const relativeMove = Math.abs(change) / Math.max(vol, 0.0001);
    const volumeNoise = 0.8 + rng() * 0.5;
    const volume = baseVolume * volumeNoise * (1 + relativeMove * 0.6);

    candles.push({
      time: startTime + i * interval,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume: +volume.toFixed(2),
    });
    price = close;
  }
  return candles;
}

/**
 * Build a full multi-timeframe candle map for a symbol.
 * Uses FETCH_COUNTS from the window policy so each TF gets the depth it needs.
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
    "1W",
  ];
  const map = {} as Record<Timeframe, CandleData[]>;
  for (const tf of timeframes) {
    map[tf] = generateCandles(symbol, tf, FETCH_COUNTS[tf]);
  }
  return map;
}

// ── EMA (Exponential Moving Average) ──────────────────────────────────────────

/**
 * Calculate EMA on close prices.
 * Returns the full EMA array (same length as input, first value = first close).
 */
export function calcEMA(candles: CandleData[], period: number): number[] {
  if (candles.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [candles[0].close];
  for (let i = 1; i < candles.length; i++) {
    ema.push(candles[i].close * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

/**
 * Return the last EMA value for the given period, or NaN if insufficient data.
 */
export function lastEMA(candles: CandleData[], period: number): number {
  if (candles.length < period) return NaN;
  const arr = calcEMA(candles, period);
  return arr[arr.length - 1];
}

function candleBody(c: CandleData): number {
  return Math.abs(c.close - c.open);
}

function candleRange(c: CandleData): number {
  return Math.max(0.0001, c.high - c.low);
}

function upperWick(c: CandleData): number {
  return c.high - Math.max(c.open, c.close);
}

function lowerWick(c: CandleData): number {
  return Math.min(c.open, c.close) - c.low;
}

function isBullish(c: CandleData): boolean {
  return c.close > c.open;
}

function isBearish(c: CandleData): boolean {
  return c.close < c.open;
}

function pushPattern(
  patterns: CandlePattern[],
  timeframe: Timeframe,
  candleIndex: number,
  name: CandlePattern["name"],
  direction: CandlePattern["direction"],
  reliability: number,
): void {
  patterns.push({
    name,
    direction,
    reliability,
    candleIndex,
    timeframe,
    label: `${timeframe} ${name}`,
  });
}

export function detectCandlePatterns(candles: CandleData[], timeframe: Timeframe): CandlePattern[] {
  const patterns: CandlePattern[] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const b = candles[i - 1];
    const c = candles[i];

    const cBody = candleBody(c);
    const cRange = candleRange(c);
    const dojiThreshold = cRange * 0.1;

    if (cBody <= dojiThreshold) {
      pushPattern(patterns, timeframe, i, "Doji", "neutral", 45);
    }

    if (isBullish(c) && lowerWick(c) >= cBody * 2 && upperWick(c) <= cBody * 0.5) {
      pushPattern(patterns, timeframe, i, "Hammer", "bullish", 68);
    }
    if (isBullish(c) && upperWick(c) >= cBody * 2 && lowerWick(c) <= cBody * 0.5) {
      pushPattern(patterns, timeframe, i, "Inverted Hammer", "bullish", 58);
    }
    if (isBearish(c) && upperWick(c) >= cBody * 2 && lowerWick(c) <= cBody * 0.5) {
      pushPattern(patterns, timeframe, i, "Shooting Star", "bearish", 70);
    }

    const prev = candles[i - 1];
    if (isBearish(prev) && isBullish(c) && c.open <= prev.close && c.close >= prev.open && candleBody(c) > candleBody(prev) * 0.9) {
      pushPattern(patterns, timeframe, i, "Bullish Engulfing", "bullish", 74);
    }
    if (isBullish(prev) && isBearish(c) && c.open >= prev.close && c.close <= prev.open && candleBody(c) > candleBody(prev) * 0.9) {
      pushPattern(patterns, timeframe, i, "Bearish Engulfing", "bearish", 74);
    }

    if (isBearish(a) && candleBody(b) <= candleRange(b) * 0.25 && isBullish(c) && c.close >= a.open - candleBody(a) * 0.3) {
      pushPattern(patterns, timeframe, i, "Morning Star", "bullish", 82);
    }
    if (isBullish(a) && candleBody(b) <= candleRange(b) * 0.25 && isBearish(c) && c.close <= a.open + candleBody(a) * 0.3) {
      pushPattern(patterns, timeframe, i, "Evening Star", "bearish", 82);
    }

    if (i >= 2) {
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];
      if (isBullish(c1) && isBullish(c2) && isBullish(c3) && c2.close > c1.close && c3.close > c2.close) {
        pushPattern(patterns, timeframe, i, "Three White Soldiers", "bullish", 86);
      }
      if (isBearish(c1) && isBearish(c2) && isBearish(c3) && c2.close < c1.close && c3.close < c2.close) {
        pushPattern(patterns, timeframe, i, "Three Black Crows", "bearish", 86);
      }
    }
  }

  const deduped = new Map<string, CandlePattern>();
  for (const pattern of patterns) {
    const key = `${pattern.candleIndex}-${pattern.name}`;
    const existing = deduped.get(key);
    if (!existing || existing.reliability < pattern.reliability) {
      deduped.set(key, pattern);
    }
  }
  return [...deduped.values()];
}
