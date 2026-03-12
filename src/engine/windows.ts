/**
 * windows.ts
 * Candle window policy — different engine steps use distinctly sized windows.
 *
 * The trendline / swing engine needs a deeper structural window than the
 * visible chart so that adding more candles improves structural context
 * instead of just adding noise.
 */

import type { Timeframe } from "../types";

/** Explicit window sizes for each engine analysis step */
export const WINDOWS = {
  /** Candles rendered on the visible chart */
  chartRender: 120,
  /** Candles used for swing / support-resistance / trendline structure detection */
  structure: 200,
  /** Candles used for short-term momentum calculations */
  momentum: 14,
  /** Candles used for higher-timeframe trend context layers */
  htfContext: 100,
} as const;

/**
 * Per-timeframe candle generation / fetch counts.
 * Must be >= the deepest window that will ever read from that TF.
 */
export const FETCH_COUNTS: Record<Timeframe, number> = {
  "15M": 100,
  "1H":  250,   // structure(200) + lookback margin
  "2H":  150,
  "4H":  120,   // HTF context + scoring
  "6H":  100,
  "8H":  100,
  "12H": 100,
  "1D":  100,
};
