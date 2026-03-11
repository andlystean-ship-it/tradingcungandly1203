/**
 * trendlines.ts
 * Trendline generation from confirmed swing structure.
 *
 * Rules:
 * - Ascending trendline: connects two consecutive validated swing lows
 *   where the second low is strictly higher than the first.
 * - Descending trendline: connects two consecutive validated swing highs
 *   where the second high is strictly lower than the first.
 * - Strength is based on the number of candles between the two touch points
 *   (longer span = stronger historical context).
 * - A trendline is marked `broken` if the current price has traded through it.
 */

import type { CandleData, Trendline } from "../types";
import { detectSwingHighs, detectSwingLows } from "./swings";

/**
 * Extrapolate a trendline to a target x index.
 */
function extrapolate(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number
): number {
  if (x2 === x1) return y1;
  return y1 + ((y2 - y1) / (x2 - x1)) * (x - x1);
}

export function buildTrendlines(candles: CandleData[]): Trendline[] {
  const swingHighs = detectSwingHighs(candles);
  const swingLows = detectSwingLows(candles);
  const lines: Trendline[] = [];

  // ── Descending trendlines (from swing highs) ────────────────────────────────
  for (let i = 0; i + 1 < swingHighs.length; i++) {
    const a = swingHighs[i];
    const b = swingHighs[i + 1];
    if (b.price >= a.price) continue; // must be lower highs

    const span = b.index - a.index;
    const strength = Math.min(100, Math.round((span / candles.length) * 200));

    // Check if any of the NEXT 15 candles after the second touch closed above the line
    let broken = false;
    const checkEnd = Math.min(candles.length, b.index + 16);
    for (let k = b.index + 1; k < checkEnd; k++) {
      const lineY = extrapolate(a.index, a.price, b.index, b.price, k);
      if (candles[k].close > lineY) {
        broken = true;
        break;
      }
    }

    lines.push({
      id: `desc-${a.index}-${b.index}`,
      kind: "descending",
      x1: a.index,
      y1: a.price,
      x2: b.index,
      y2: b.price,
      strength,
      active: !broken,
      broken,
    });
  }

  // ── Ascending trendlines (from swing lows) ───────────────────────────────────
  for (let i = 0; i + 1 < swingLows.length; i++) {
    const a = swingLows[i];
    const b = swingLows[i + 1];
    if (b.price <= a.price) continue; // must be higher lows

    const span = b.index - a.index;
    const strength = Math.min(100, Math.round((span / candles.length) * 200));

    // Check if any of the NEXT 15 candles after the second touch closed below the line
    let broken = false;
    const checkEnd = Math.min(candles.length, b.index + 16);
    for (let k = b.index + 1; k < checkEnd; k++) {
      const lineY = extrapolate(a.index, a.price, b.index, b.price, k);
      if (candles[k].close < lineY) {
        broken = true;
        break;
      }
    }

    lines.push({
      id: `asc-${a.index}-${b.index}`,
      kind: "ascending",
      x1: a.index,
      y1: a.price,
      x2: b.index,
      y2: b.price,
      strength,
      active: !broken,
      broken,
    });
  }

  // Return active lines first, then broken, up to 6 total
  lines.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return b.strength - a.strength;
  });
  return lines.slice(0, 6);
}
