/**
 * swings.ts
 * Swing high / swing low detection.
 *
 * A swing high at index i is confirmed when the next `confirm` candles
 * all have a strictly lower high than candles[i].high (anti-repaint).
 * Same logic inverted for swing lows.
 */

import type { CandleData } from "../types";

export type SwingPoint = {
  index: number;
  price: number;
  time: number;
};

/**
 * Detect swing highs.
 * `lookback`  – candles to the left that must be lower
 * `confirm`   – candles to the right that must be lower (confirmation)
 */
export function detectSwingHighs(
  candles: CandleData[],
  lookback = 3,
  confirm = 2
): SwingPoint[] {
  const result: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - confirm; i++) {
    const h = candles[i].high;
    const leftOk = candles
      .slice(i - lookback, i)
      .every((c) => c.high < h);
    const rightOk = candles
      .slice(i + 1, i + 1 + confirm)
      .every((c) => c.high < h);
    if (leftOk && rightOk) {
      result.push({ index: i, price: h, time: candles[i].time });
    }
  }
  return result;
}

/**
 * Detect swing lows.
 */
export function detectSwingLows(
  candles: CandleData[],
  lookback = 3,
  confirm = 2
): SwingPoint[] {
  const result: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - confirm; i++) {
    const l = candles[i].low;
    const leftOk = candles
      .slice(i - lookback, i)
      .every((c) => c.low > l);
    const rightOk = candles
      .slice(i + 1, i + 1 + confirm)
      .every((c) => c.low > l);
    if (leftOk && rightOk) {
      result.push({ index: i, price: l, time: candles[i].time });
    }
  }
  return result;
}
