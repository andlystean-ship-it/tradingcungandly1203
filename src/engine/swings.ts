/**
 * swings.ts
 * Structural swing high / swing low detection with de-noising and significance scoring.
 *
 * Anti-repaint: swings require right-side confirmation candles.
 * De-noising: near-duplicate swings are merged, micro-swings in tight ranges rejected.
 * Significance: each swing gets a strength & significance score based on local range context.
 */

import type { CandleData } from "../types";

// ── Configuration ────────────────────────────────────────────────────────────

export type SwingConfig = {
  leftWindow: number;
  rightConfirmationWindow: number;
  minSwingDistance: number;         // minimum index gap between accepted swings
  minPriceSeparationPct: number;   // minimum % price difference between accepted swings
};

export const DEFAULT_SWING_CONFIG: SwingConfig = {
  leftWindow: 5,
  rightConfirmationWindow: 3,
  minSwingDistance: 5,
  minPriceSeparationPct: 0.002, // 0.2%
};

// ── Swing point with enriched metadata ────────────────────────────────────────

export type SwingPoint = {
  index: number;
  price: number;
  time: number;
  confirmed: boolean;
  strength: number;           // 0–100: how dominant vs local range
  significance: number;       // 0–100: composite quality score
  localRangeContext: number;  // ATR-relative height/depth of the swing
};

// ── Debug output ──────────────────────────────────────────────────────────────

export type SwingDebug = {
  rawCount: number;
  filteredCount: number;
  discardReasons: string[];
};

// ── Internal: local ATR over a window ─────────────────────────────────────────

function localATR(candles: CandleData[], center: number, halfWindow: number): number {
  const start = Math.max(0, center - halfWindow);
  const end = Math.min(candles.length, center + halfWindow + 1);
  let sum = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    sum += candles[i].high - candles[i].low;
    count++;
  }
  return count > 0 ? sum / count : 1;
}

// ── Raw swing detection ───────────────────────────────────────────────────────

function detectRawSwingHighs(
  candles: CandleData[],
  left: number,
  right: number
): SwingPoint[] {
  const result: SwingPoint[] = [];
  for (let i = left; i < candles.length - right; i++) {
    const h = candles[i].high;
    let leftOk = true;
    for (let j = i - left; j < i; j++) {
      if (candles[j].high >= h) { leftOk = false; break; }
    }
    if (!leftOk) continue;

    let rightOk = true;
    for (let j = i + 1; j <= i + right; j++) {
      if (candles[j].high >= h) { rightOk = false; break; }
    }
    if (!rightOk) continue;

    const atr = localATR(candles, i, left + right);
    const windowSlice = candles.slice(Math.max(0, i - left), Math.min(candles.length, i + right + 1));
    const avgHigh = windowSlice.reduce((s, c) => s + c.high, 0) / windowSlice.length;
    const dominance = atr > 0 ? ((h - avgHigh) / atr) * 100 : 50;
    const strength = Math.max(0, Math.min(100, 50 + dominance));

    result.push({
      index: i,
      price: h,
      time: candles[i].time,
      confirmed: true,
      strength: Math.round(strength),
      significance: 0, // computed after de-noising
      localRangeContext: atr > 0 ? (h - avgHigh) / atr : 0,
    });
  }
  return result;
}

function detectRawSwingLows(
  candles: CandleData[],
  left: number,
  right: number
): SwingPoint[] {
  const result: SwingPoint[] = [];
  for (let i = left; i < candles.length - right; i++) {
    const l = candles[i].low;
    let leftOk = true;
    for (let j = i - left; j < i; j++) {
      if (candles[j].low <= l) { leftOk = false; break; }
    }
    if (!leftOk) continue;

    let rightOk = true;
    for (let j = i + 1; j <= i + right; j++) {
      if (candles[j].low <= l) { rightOk = false; break; }
    }
    if (!rightOk) continue;

    const atr = localATR(candles, i, left + right);
    const windowSlice = candles.slice(Math.max(0, i - left), Math.min(candles.length, i + right + 1));
    const avgLow = windowSlice.reduce((s, c) => s + c.low, 0) / windowSlice.length;
    const dominance = atr > 0 ? ((avgLow - l) / atr) * 100 : 50;
    const strength = Math.max(0, Math.min(100, 50 + dominance));

    result.push({
      index: i,
      price: l,
      time: candles[i].time,
      confirmed: true,
      strength: Math.round(strength),
      significance: 0,
      localRangeContext: atr > 0 ? (avgLow - l) / atr : 0,
    });
  }
  return result;
}

// ── De-noising: merge near-duplicates ─────────────────────────────────────────

function denoiseSwings(
  swings: SwingPoint[],
  config: SwingConfig,
  debugReasons: string[]
): SwingPoint[] {
  if (swings.length <= 1) return swings;

  const merged: SwingPoint[] = [swings[0]];
  for (let i = 1; i < swings.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = swings[i];
    const indexDist = curr.index - prev.index;
    const priceDist = Math.abs(curr.price - prev.price) / Math.max(prev.price, 0.0001);

    // Too close in index or price → merge (keep the stronger one)
    if (indexDist < config.minSwingDistance || priceDist < config.minPriceSeparationPct) {
      if (curr.strength > prev.strength) {
        merged[merged.length - 1] = curr;
        debugReasons.push(`merged swing@${prev.index} into @${curr.index} (stronger)`);
      } else {
        debugReasons.push(`discarded swing@${curr.index} (too close to @${prev.index})`);
      }
      continue;
    }
    merged.push(curr);
  }
  return merged;
}

// ── Reject micro-swings in tight ranges ───────────────────────────────────────

function rejectMicroSwings(
  swings: SwingPoint[],
  candles: CandleData[],
  debugReasons: string[]
): SwingPoint[] {
  if (swings.length === 0) return swings;

  const globalATR =
    candles.length >= 14
      ? candles.slice(-14).reduce((s, c) => s + (c.high - c.low), 0) / 14
      : candles.reduce((s, c) => s + (c.high - c.low), 0) / Math.max(candles.length, 1);

  return swings.filter(sw => {
    if (sw.localRangeContext < 0.1 && sw.strength < 35 && globalATR > 0) {
      debugReasons.push(
        `rejected micro-swing@${sw.index} (range=${sw.localRangeContext.toFixed(3)}, str=${sw.strength})`
      );
      return false;
    }
    return true;
  });
}

// ── Compute significance scores ───────────────────────────────────────────────

function computeSignificance(swings: SwingPoint[], totalCandles: number): void {
  for (const sw of swings) {
    const recency =
      totalCandles > 0
        ? Math.max(0, Math.min(100, (sw.index / totalCandles) * 100))
        : 50;
    const rangeFactor = Math.min(100, sw.localRangeContext * 200);

    sw.significance = Math.round(
      sw.strength * 0.4 + recency * 0.3 + rangeFactor * 0.3
    );
    sw.significance = Math.max(0, Math.min(100, sw.significance));
  }
}

// ── Resolve config from overloaded arguments ─────────────────────────────────

function resolveConfig(
  lookbackOrConfig?: number | SwingConfig,
  confirm?: number
): SwingConfig {
  if (typeof lookbackOrConfig === "object") return lookbackOrConfig;
  return {
    ...DEFAULT_SWING_CONFIG,
    leftWindow: lookbackOrConfig ?? DEFAULT_SWING_CONFIG.leftWindow,
    rightConfirmationWindow: confirm ?? DEFAULT_SWING_CONFIG.rightConfirmationWindow,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect confirmed, de-noised swing highs.
 * Accepts either (candles, lookback, confirm) for backwards compat
 * or (candles, SwingConfig) for full control.
 */
export function detectSwingHighs(
  candles: CandleData[],
  lookbackOrConfig?: number | SwingConfig,
  confirm?: number
): SwingPoint[] {
  const config = resolveConfig(lookbackOrConfig, confirm);
  const raw = detectRawSwingHighs(candles, config.leftWindow, config.rightConfirmationWindow);
  const debugReasons: string[] = [];
  const denoised = denoiseSwings(raw, config, debugReasons);
  const filtered = rejectMicroSwings(denoised, candles, debugReasons);
  computeSignificance(filtered, candles.length);
  return filtered;
}

/**
 * Detect confirmed, de-noised swing lows.
 * Same overloaded signature as detectSwingHighs.
 */
export function detectSwingLows(
  candles: CandleData[],
  lookbackOrConfig?: number | SwingConfig,
  confirm?: number
): SwingPoint[] {
  const config = resolveConfig(lookbackOrConfig, confirm);
  const raw = detectRawSwingLows(candles, config.leftWindow, config.rightConfirmationWindow);
  const debugReasons: string[] = [];
  const denoised = denoiseSwings(raw, config, debugReasons);
  const filtered = rejectMicroSwings(denoised, candles, debugReasons);
  computeSignificance(filtered, candles.length);
  return filtered;
}

/**
 * Full swing detection with debug output.
 * Returns both highs and lows along with debug metadata.
 */
export function detectSwingsWithDebug(
  candles: CandleData[],
  config: SwingConfig = DEFAULT_SWING_CONFIG
): { highs: SwingPoint[]; lows: SwingPoint[]; debug: SwingDebug } {
  const rawHighs = detectRawSwingHighs(candles, config.leftWindow, config.rightConfirmationWindow);
  const rawLows = detectRawSwingLows(candles, config.leftWindow, config.rightConfirmationWindow);
  const rawCount = rawHighs.length + rawLows.length;
  const debugReasons: string[] = [];

  const denoisedHighs = denoiseSwings(rawHighs, config, debugReasons);
  const denoisedLows = denoiseSwings(rawLows, config, debugReasons);
  const filteredHighs = rejectMicroSwings(denoisedHighs, candles, debugReasons);
  const filteredLows = rejectMicroSwings(denoisedLows, candles, debugReasons);
  computeSignificance(filteredHighs, candles.length);
  computeSignificance(filteredLows, candles.length);

  return {
    highs: filteredHighs,
    lows: filteredLows,
    debug: {
      rawCount,
      filteredCount: filteredHighs.length + filteredLows.length,
      discardReasons: debugReasons,
    },
  };
}
