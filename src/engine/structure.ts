import type { CandleData, TrendLayer } from "../types";
import { detectSwingHighs, detectSwingLows } from "./swings";

export type StructureState = NonNullable<TrendLayer["structureState"]>;

export function deriveSwingStructureState(candles: CandleData[]): StructureState {
  const highs = detectSwingHighs(candles, 3, 2).slice(-3);
  const lows = detectSwingLows(candles, 3, 2).slice(-3);
  if (highs.length < 2 || lows.length < 2) return "neutral";

  const lastHigh = highs[highs.length - 1].price;
  const prevHigh = highs[highs.length - 2].price;
  const lastLow = lows[lows.length - 1].price;
  const prevLow = lows[lows.length - 2].price;

  if (lastHigh > prevHigh && lastLow > prevLow) return "bullish";
  if (lastHigh < prevHigh && lastLow < prevLow) return "bearish";
  return "mixed";
}

export function deriveSwingStructureScore(candles: CandleData[]): { state: StructureState; score: number } {
  const state = deriveSwingStructureState(candles);
  if (state === "bullish") return { state, score: 78 };
  if (state === "bearish") return { state, score: 22 };
  return { state, score: 50 };
}