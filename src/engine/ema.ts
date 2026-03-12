import type { CandleData, EMAState } from "../types";
import { calcEMA, lastEMA } from "./candles";

function slopeOf(arr: number[], lookback = 3): number {
  if (arr.length <= lookback) return 0;
  return arr[arr.length - 1] - arr[arr.length - 1 - lookback];
}

export function computeEMAState(candles: CandleData[]): EMAState {
  const ema20Series = calcEMA(candles, 20);
  const ema50Series = calcEMA(candles, 50);
  const ema200Series = calcEMA(candles, 200);

  const ema20 = ema20Series.at(-1) ?? NaN;
  const ema50 = candles.length >= 50 ? lastEMA(candles, 50) : NaN;
  const ema200 = candles.length >= 200 ? lastEMA(candles, 200) : NaN;

  const slope20 = slopeOf(ema20Series);
  const slope50 = slopeOf(ema50Series);
  const slope200 = slopeOf(ema200Series);

  let direction: EMAState["direction"] = "neutral";
  if (!Number.isNaN(ema50) && !Number.isNaN(ema200)) {
    if (ema50 > ema200 && slope50 >= 0) direction = "bullish";
    else if (ema50 < ema200 && slope50 <= 0) direction = "bearish";
  }

  return { ema20, ema50, ema200, slope20, slope50, slope200, direction };
}