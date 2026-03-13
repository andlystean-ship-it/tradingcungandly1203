/**
 * trendlines.ts
 * Quality-scored trendline generation from confirmed structural swings.
 *
 * Instead of blindly connecting consecutive swing pairs, this module:
 * 1. Generates candidates from multiple valid swing combinations
 * 2. Scores each candidate on anchor quality, span, touches, violations, recency
 * 3. Applies touch/violation policy with ATR-based tolerance
 * 4. Returns only the highest-quality active lines with full metadata
 */

import type { CandleData, Trendline } from "../types";
import { detectSwingHighs, detectSwingLows, type SwingPoint, type SwingConfig, DEFAULT_SWING_CONFIG } from "./swings";

// ── Configuration ────────────────────────────────────────────────────────────

const MAX_CANDIDATES_PER_DIRECTION = 30;
const MAX_OUTPUT_LINES = 3;
const TOUCH_TOLERANCE_ATR_MULT = 0.35;
const MIN_SPAN_RATIO = 0.12; // trendline must span >= 12% of visible data
const MIN_SCORE = 25;

// ── Violation types ──────────────────────────────────────────────────────────

type ViolationSeverity = "soft" | "hard" | "broken";

type ViolationResult = {
  softCount: number;
  hardCount: number;
  severity: ViolationSeverity;
};

// ── Internal candidate type ──────────────────────────────────────────────────

type TrendlineCandidate = {
  anchor1: SwingPoint;
  anchor2: SwingPoint;
  kind: "ascending" | "descending";
  slope: number;
  span: number;
  touchCount: number;
  violations: ViolationResult;
  score: number;
  active: boolean;
  broken: boolean;
  role: "dynamic_support" | "dynamic_resistance";
  debugReason: string;
};

// ── Debug output ─────────────────────────────────────────────────────────────

export type TrendlineDebug = {
  candidatesGenerated: number;
  candidatesAccepted: number;
  rejectionReasons: string[];
  accepted: Array<{
    id: string;
    kind: string;
    anchors: [number, number];
    score: number;
    touchCount: number;
    violationCount: number;
    reason: string;
  }>;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcATR(candles: CandleData[], period = 14): number {
  const slice = candles.slice(-Math.min(period, candles.length));
  if (slice.length === 0) return 1;
  return slice.reduce((s, c) => s + (c.high - c.low), 0) / slice.length;
}

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

// ── Touch counting ───────────────────────────────────────────────────────────

function countTouches(
  candles: CandleData[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  kind: "ascending" | "descending",
  tolerance: number
): number {
  let touches = 0;
  const start = Math.max(0, x1);
  const end = candles.length;

  for (let i = start; i < end; i++) {
    if (i === x1 || i === x2) continue; // skip anchors
    const lineY = extrapolate(x1, y1, x2, y2, i);
    const c = candles[i];

    if (kind === "ascending") {
      // Touch = low approaches line, close stays above
      const dist = Math.abs(c.low - lineY);
      if (dist <= tolerance && c.close >= lineY) {
        touches++;
      } else if (dist <= tolerance * 1.5 && c.close >= lineY) {
        touches += 0.5; // near-miss
      }
    } else {
      // Touch = high approaches line, close stays below
      const dist = Math.abs(c.high - lineY);
      if (dist <= tolerance && c.close <= lineY) {
        touches++;
      } else if (dist <= tolerance * 1.5 && c.close <= lineY) {
        touches += 0.5;
      }
    }
  }
  return touches;
}

// ── Violation evaluation ─────────────────────────────────────────────────────

/** Count candle bodies that cross the line BETWEEN the two anchors */
function countIntraAnchorViolations(
  candles: CandleData[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  kind: "ascending" | "descending",
  tolerance: number,
): number {
  let count = 0;
  for (let i = x1 + 1; i < x2; i++) {
    const lineY = extrapolate(x1, y1, x2, y2, i);
    const c = candles[i];
    if (kind === "ascending" && c.close < lineY - tolerance * 0.5) {
      count++;
    } else if (kind === "descending" && c.close > lineY + tolerance * 0.5) {
      count++;
    }
  }
  return count;
}

function evaluateViolations(
  candles: CandleData[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  kind: "ascending" | "descending",
  tolerance: number
): ViolationResult {
  let softCount = 0;
  let hardCount = 0;
  const start = x2 + 1;
  const end = candles.length;

  for (let i = start; i < end; i++) {
    const lineY = extrapolate(x1, y1, x2, y2, i);
    const c = candles[i];

    if (kind === "ascending") {
      // Hard: close decisively below the line
      if (c.close < lineY - tolerance * 0.3) {
        hardCount++;
      } else if (c.low < lineY - tolerance * 0.3 && c.close >= lineY - tolerance * 0.3) {
        // Soft: wick penetrates but close holds
        softCount++;
      }
    } else {
      if (c.close > lineY + tolerance * 0.3) {
        hardCount++;
      } else if (c.high > lineY + tolerance * 0.3 && c.close <= lineY + tolerance * 0.3) {
        softCount++;
      }
    }
  }

  let severity: ViolationSeverity = "soft";
  if (hardCount >= 2) severity = "broken";
  else if (hardCount >= 1) severity = "hard";

  return { softCount, hardCount, severity };
}

// ── Candidate scoring ────────────────────────────────────────────────────────

function scoreCandidate(
  candidate: Omit<TrendlineCandidate, "score" | "debugReason">,
  totalCandles: number,
  currentPrice: number,
  atr: number
): { score: number; reason: string } {
  const reasons: string[] = [];

  // 1. Anchor quality
  const anchorQuality =
    (candidate.anchor1.significance + candidate.anchor2.significance) / 2;
  reasons.push(`anch=${anchorQuality.toFixed(0)}`);

  // 2. Slope sanity
  const slopePerBar = Math.abs(candidate.slope);
  const slopeATRRatio = atr > 0 ? slopePerBar / atr : 0;
  let slopeSanity = 80;
  if (slopeATRRatio < 0.0008) slopeSanity = 10;   // nearly flat → likely noise
  else if (slopeATRRatio < 0.002) slopeSanity = 30;
  else if (slopeATRRatio > 0.4) slopeSanity = 5;   // too steep → spike
  else if (slopeATRRatio > 0.25) slopeSanity = 30;
  reasons.push(`slp=${slopeSanity}`);

  // 3. Span (wider = better)
  const spanNorm =
    totalCandles > 0
      ? Math.min(100, (candidate.span / totalCandles) * 200)
      : 50;
  reasons.push(`spn=${spanNorm.toFixed(0)}`);

  // 4. Touch count bonus
  const touchBonus = Math.min(100, candidate.touchCount * 25);
  reasons.push(`tch=${candidate.touchCount}→${touchBonus}`);

  // 5. Violation penalty
  const violPenalty =
    candidate.violations.hardCount * 30 + candidate.violations.softCount * 10;
  const violScore = Math.max(0, 100 - violPenalty);
  reasons.push(`viol=${violScore}`);

  // 6. Recency
  const midpoint =
    (candidate.anchor1.index + candidate.anchor2.index) / 2;
  const recency =
    totalCandles > 0
      ? Math.max(0, Math.min(100, (midpoint / totalCandles) * 100))
      : 50;
  reasons.push(`rec=${recency.toFixed(0)}`);

  // 7. Proximity to current price
  const projectedY = extrapolate(
    candidate.anchor1.index,
    candidate.anchor1.price,
    candidate.anchor2.index,
    candidate.anchor2.price,
    totalCandles - 1
  );
  const distPct =
    Math.abs(projectedY - currentPrice) / Math.max(currentPrice, 0.0001);
  const proximity =
    distPct < 0.01 ? 100 : distPct < 0.03 ? 70 : distPct < 0.08 ? 40 : 10;
  reasons.push(`prox=${proximity}`);

  const score = Math.round(
    anchorQuality * 0.10 +
      slopeSanity * 0.12 +
      spanNorm * 0.13 +
      touchBonus * 0.30 +
      violScore * 0.12 +
      recency * 0.13 +
      proximity * 0.10
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    reason: reasons.join(", "),
  };
}

// ── Candidate generation ─────────────────────────────────────────────────────

function generateCandidates(
  swings: SwingPoint[],
  kind: "ascending" | "descending",
  candles: CandleData[],
  atr: number,
  currentPrice: number
): TrendlineCandidate[] {
  const candidates: TrendlineCandidate[] = [];
  const tolerance = atr * TOUCH_TOLERANCE_ATR_MULT;

  // Generate valid pairs (not just consecutive)
  const pairs: [number, number][] = [];
  for (let i = 0; i < swings.length; i++) {
    for (let j = i + 1; j < swings.length; j++) {
      const a = swings[i];
      const b = swings[j];
      if (kind === "ascending" && b.price <= a.price) continue;
      if (kind === "descending" && b.price >= a.price) continue;
      if (b.index - a.index < 5) continue; // at least 5 bars apart
      pairs.push([i, j]);
    }
  }

  // Sort by recency + span, keep best candidates
  pairs.sort((a, b) => {
    const spanA = swings[a[1]].index - swings[a[0]].index;
    const spanB = swings[b[1]].index - swings[b[0]].index;
    const recA = swings[a[1]].index;
    const recB = swings[b[1]].index;
    return recB + spanB - (recA + spanA);
  });
  const selected = pairs.slice(0, MAX_CANDIDATES_PER_DIRECTION);

  for (const [i, j] of selected) {
    const a = swings[i];
    const b = swings[j];
    const span = b.index - a.index;
    const slope = (b.price - a.price) / span;

    const touchCount = countTouches(
      candles,
      a.index,
      a.price,
      b.index,
      b.price,
      kind,
      tolerance
    );

    // Reject if too many candle bodies cross the line between anchors
    const intraViolations = countIntraAnchorViolations(
      candles, a.index, a.price, b.index, b.price, kind, tolerance
    );
    const maxIntra = Math.max(2, Math.floor(span * 0.15));
    if (intraViolations > maxIntra) continue;

    const violations = evaluateViolations(
      candles,
      a.index,
      a.price,
      b.index,
      b.price,
      kind,
      tolerance
    );

    const active = violations.severity !== "broken";
    const broken = violations.severity === "broken";
    const role =
      kind === "ascending"
        ? ("dynamic_support" as const)
        : ("dynamic_resistance" as const);

    const partial = {
      anchor1: a,
      anchor2: b,
      kind,
      slope,
      span,
      touchCount,
      violations,
      active,
      broken,
      role,
    };

    const { score, reason } = scoreCandidate(
      partial,
      candles.length,
      currentPrice,
      atr
    );
    candidates.push({ ...partial, score, debugReason: reason });
  }

  return candidates;
}

// ── Near-parallel dedup ──────────────────────────────────────────────────────

function dedupNearParallel(
  candidates: TrendlineCandidate[],
  atr: number,
  totalCandles: number,
): TrendlineCandidate[] {
  if (candidates.length <= 1) return candidates;

  const result: TrendlineCandidate[] = [];
  const midIndex = Math.floor(totalCandles / 2);

  for (const c of candidates) {
    // Project each candidate's price at the midpoint of the data
    const projMid = extrapolate(c.anchor1.index, c.anchor1.price, c.anchor2.index, c.anchor2.price, midIndex);
    const slopePerBar = c.slope;

    const isTooSimilar = result.some((existing) => {
      const existProjMid = extrapolate(
        existing.anchor1.index, existing.anchor1.price,
        existing.anchor2.index, existing.anchor2.price, midIndex,
      );
      const priceDist = Math.abs(projMid - existProjMid);
      const slopeDist = Math.abs(slopePerBar - existing.slope);
      // Lines within 0.6 ATR at midpoint AND similar slope → duplicates
      return priceDist < atr * 0.6 && slopeDist < atr * 0.05;
    });

    if (!isTooSimilar) {
      result.push(c);
    }
  }
  return result;
}

// ── Main entry points ────────────────────────────────────────────────────────

export function buildTrendlines(
  candles: CandleData[],
  sourceTimeframe?: string,
  swingOverrides?: Partial<SwingConfig>,
): Trendline[] {
  const { trendlines } = buildTrendlinesWithDebug(candles, sourceTimeframe, swingOverrides);
  return trendlines;
}

export function buildTrendlinesWithDebug(
  candles: CandleData[],
  sourceTimeframe?: string,
  swingOverrides?: Partial<SwingConfig>,
): { trendlines: Trendline[]; debug: TrendlineDebug } {
  if (candles.length < 10) {
    return {
      trendlines: [],
      debug: {
        candidatesGenerated: 0,
        candidatesAccepted: 0,
        rejectionReasons: ["insufficient candles"],
        accepted: [],
      },
    };
  }

  const atr = calcATR(candles);
  const currentPrice = candles[candles.length - 1].close;

  // Structural swing config — tighter than default for quality anchors
  const structConfig: SwingConfig = {
    ...DEFAULT_SWING_CONFIG,
    leftWindow: 5,
    rightConfirmationWindow: 3,
    minSwingDistance: swingOverrides?.minSwingDistance ?? 5,
    minPriceSeparationPct: swingOverrides?.minPriceSeparationPct ?? 0.003,
  };

  const swingHighs = detectSwingHighs(candles, structConfig);
  const swingLows = detectSwingLows(candles, structConfig);

  // Generate candidates from all valid combinations
  const descCandidates = generateCandidates(
    swingHighs,
    "descending",
    candles,
    atr,
    currentPrice
  );
  const ascCandidates = generateCandidates(
    swingLows,
    "ascending",
    candles,
    atr,
    currentPrice
  );
  const allCandidates = [...descCandidates, ...ascCandidates];
  const totalGenerated = allCandidates.length;

  // Filter out structurally weak candidates
  const rejectionReasons: string[] = [];
  const filtered = allCandidates.filter(c => {
    const slopePerBar = Math.abs(c.slope);
    const slopeATRRatio = atr > 0 ? slopePerBar / atr : 0;

    if (slopeATRRatio < 0.0008) {
      rejectionReasons.push(
        `${c.kind}@${c.anchor1.index}-${c.anchor2.index}: too flat`
      );
      return false;
    }
    if (slopeATRRatio > 0.35) {
      rejectionReasons.push(
        `${c.kind}@${c.anchor1.index}-${c.anchor2.index}: too steep`
      );
      return false;
    }
    // Verify slope direction matches kind
    if (c.kind === "ascending" && c.slope < 0) {
      rejectionReasons.push(
        `${c.kind}@${c.anchor1.index}-${c.anchor2.index}: slope contradicts direction`
      );
      return false;
    }
    if (c.kind === "descending" && c.slope > 0) {
      rejectionReasons.push(
        `${c.kind}@${c.anchor1.index}-${c.anchor2.index}: slope contradicts direction`
      );
      return false;
    }
    if (c.anchor1.significance < 25 && c.anchor2.significance < 25) {
      rejectionReasons.push(
        `${c.kind}@${c.anchor1.index}-${c.anchor2.index}: weak anchors`
      );
      return false;
    }
    if (c.span < candles.length * MIN_SPAN_RATIO) {
      rejectionReasons.push(
        `${c.kind}@${c.anchor1.index}-${c.anchor2.index}: span too short`
      );
      return false;
    }
    // Require at least one touch besides the 2 anchors for shorter trendlines
    if (c.touchCount < 0.5 && c.span < candles.length * 0.25) {
      rejectionReasons.push(
        `${c.kind}@${c.anchor1.index}-${c.anchor2.index}: no confirming touches`
      );
      return false;
    }
    // Minimum score threshold
    if (c.score < MIN_SCORE) {
      rejectionReasons.push(
        `${c.kind}@${c.anchor1.index}-${c.anchor2.index}: score ${c.score} < ${MIN_SCORE}`
      );
      return false;
    }
    return true;
  });

  // Sort by quality score
  filtered.sort((a, b) => b.score - a.score);

  // De-duplicate near-parallel lines: keep only the highest-scored line
  // in each cluster of similarly-sloped, similarly-positioned lines
  const deduped = dedupNearParallel(filtered, atr, candles.length);

  // Select best lines: prefer active over broken
  const activeLines = deduped.filter(c => c.active);
  const brokenLines = deduped.filter(c => c.broken);
  const selectedCandidates = [
    ...activeLines.slice(0, MAX_OUTPUT_LINES),
    ...brokenLines.slice(0, Math.max(0, MAX_OUTPUT_LINES - activeLines.length)),
  ].slice(0, MAX_OUTPUT_LINES);

  // Convert to public Trendline type
  const trendlines: Trendline[] = selectedCandidates.map(c => ({
    id: `${c.kind === "ascending" ? "asc" : "desc"}-${c.anchor1.index}-${c.anchor2.index}`,
    kind: c.kind,
    x1: c.anchor1.index,
    y1: c.anchor1.price,
    x2: c.anchor2.index,
    y2: c.anchor2.price,
    strength: c.score,
    active: c.active,
    broken: c.broken,
    slope: c.slope,
    span: c.span,
    length: c.span,
    touchCount: Math.round(c.touchCount),
    violationCount: c.violations.hardCount + c.violations.softCount,
    role: c.role,
    sourceTimeframe: sourceTimeframe ?? "1H",
  }));

  const debug: TrendlineDebug = {
    candidatesGenerated: totalGenerated,
    candidatesAccepted: trendlines.length,
    rejectionReasons,
    accepted: trendlines.map(t => ({
      id: t.id,
      kind: t.kind,
      anchors: [t.x1, t.x2] as [number, number],
      score: t.strength,
      touchCount: t.touchCount ?? 0,
      violationCount: t.violationCount ?? 0,
      reason:
        selectedCandidates.find(
          c => c.anchor1.index === t.x1 && c.anchor2.index === t.x2
        )?.debugReason ?? "",
    })),
  };

  return { trendlines, debug };
}
