/**
 * score-config.ts
 * Centralized scoring weights and configuration.
 *
 * All scoring component weights live here so they can be tuned in one place,
 * used consistently across scoring + calibration fixtures, and eventually
 * exposed for backtesting.
 */

// ── Scoring component weights (must sum to 1.0) ─────────────────────────────

export type ScoreWeights = {
  structure: number;
  pivot: number;
  srReaction: number;
  trendline: number;
  ema: number;
  candlePattern: number;
  momentum: number;
  volatility: number;
  htfAlignment: number;
};

export const DEFAULT_WEIGHTS: Readonly<ScoreWeights> = {
  structure: 0.17,
  pivot: 0.10,
  srReaction: 0.12,
  trendline: 0.12,
  ema: 0.12,
  candlePattern: 0.08,
  momentum: 0.15,
  volatility: 0.04,
  htfAlignment: 0.10,
};

// ── Score breakdown: per-component output for audit / debug ──────────────────

export type ScoreBreakdown = {
  structure: number;
  pivot: number;
  srReaction: number;
  trendline: number;
  ema: number;
  candlePattern: number;
  momentum: number;
  volatility: number;
  htfAlignment: number;
  position?: number;
  pivotReclaim?: number;
  support?: number;
  resistance?: number;
  breakRetest?: number;
  /** Final weighted score 0–100 */
  total: number;
};

// ── Entry quality thresholds ─────────────────────────────────────────────────

export const ENTRY_QUALITY = {
  /** Minimum R:R ratio to consider a setup tradeable */
  minRewardRisk: 1.8,
  /** Minimum quality score (0–100) to promote from watching → pending */
  minQualityScore: 40,
  /** Minimum number of confluences required for pending status */
  minConfluences: 3,
  /** Score threshold: scores between 45–55 are "no-trade zone" */
  neutralZoneLow: 45,
  neutralZoneHigh: 55,
  /** Minimum structure quality at entry level */
  minStructureQuality: 30,
  /** Factor weights for quality score (must sum to 1.0) */
  factorWeights: {
    structureQuality: 0.25,
    trendAlignment: 0.20,
    htfPressure: 0.20,
    distanceToInvalidation: 0.10,
    distanceToTarget: 0.05,
    rewardRisk: 0.20,
  },
} as const;

// ── Bias thresholds ──────────────────────────────────────────────────────────

export const BIAS_THRESHOLDS = {
  bullish: 55,
  bearish: 45,
} as const;

/** Validate that weights sum to 1.0 (±0.001 tolerance) */
export function validateWeights(w: ScoreWeights): boolean {
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1.0) < 0.001;
}
