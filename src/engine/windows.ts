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
  chartRender: 2000,
  /** Candles used for swing / support-resistance / trendline structure detection */
  structure: 2000,
  /** Candles used for short-term momentum calculations */
  momentum: 14,
  /** Candles used for higher-timeframe trend context layers */
  htfContext: 2000,
} as const;

/**
 * Per-timeframe candle generation / fetch counts.
 * Must be >= the deepest window that will ever read from that TF.
 */
export const FETCH_COUNTS: Record<Timeframe, number> = {
  "15M": 2000,
  "1H": 2000,
  "2H": 2000,
  "4H": 2000,
  "6H": 2000,
  "8H": 2000,
  "12H": 2000,
  "1D": 2000,
  "1W": 2000,
};
