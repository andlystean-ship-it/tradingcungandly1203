/**
 * scenario.ts
 * Scenario engine and explanation text generator.
 *
 * Produces:
 * - primaryScenario  (dominant directional bias)
 * - alternateScenario (opposite side hedge)
 * - pivot / target / pendingLong / pendingShort
 * - explanationText (template-based, deterministic)
 * - cautionText
 * - invalidationLevel
 * - signal status
 *
 * This is ENTIRELY derived from pivot levels and current price.
 * No random values. No chat-style text.
 */

import type {
  CandleData,
  MarketScenario,
  SignalStatus,
  ScenarioState,
  Symbol,
  Trendline,
} from "../types";
import { calcPivot } from "./pivot";

// ── Signal status derivation ───────────────────────────────────────────────────
function deriveStatus(
  currentPrice: number,
  pendingLong: number,
  pendingShort: number,
  pivot: number
): SignalStatus {
  const threshold = Math.abs(pivot - pendingLong) * 0.05; // 5% of distance
  if (Math.abs(currentPrice - pendingLong) <= threshold) return "pending_long";
  if (Math.abs(currentPrice - pendingShort) <= threshold) return "pending_short";
  if (currentPrice > pivot) return "watching";
  return "watching";
}

// ── Scenario state derivation ─────────────────────────────────────────────────
function deriveScenarioState(
  currentPrice: number,
  pivot: number,
  r1: number,
  s1: number
): ScenarioState {
  if (currentPrice > r1) return "bullish_primary";
  if (currentPrice < s1) return "bearish_primary";
  if (Math.abs(currentPrice - pivot) < Math.abs(r1 - s1) * 0.1)
    return "neutral_transition";
  if (currentPrice > pivot) return "bullish_primary";
  return "bearish_primary";
}

// ── Explanation text templates ─────────────────────────────────────────────────
function buildExplanationLines(
  currentPrice: number,
  pivot: number,
  r1: number,
  s1: number,
  targetPrice: number,
  pendingLong: number,
  pendingShort: number,
  fmt: (n: number) => string
): string[] {
  const abovePivot = currentPrice > pivot;
  const atPivot = Math.abs(currentPrice - pivot) < Math.abs(r1 - s1) * 0.05;

  if (atPivot) {
    return [
      `Giá đang ở Pivot Point (${fmt(pivot)})`,
      `chờ xác nhận phá vỡ để xác định hướng tiếp theo`,
      `long trên ${fmt(pivot + (r1 - pivot) * 0.1)} hướng đến ${fmt(r1)}`,
      `short dưới ${fmt(pivot - (pivot - s1) * 0.1)} hướng đến ${fmt(s1)}`,
    ];
  }

  if (abovePivot) {
    return [
      `Giá đang ở phía trên Pivot (${fmt(pivot)})`,
      `ưu tiên LONG — target gần nhất ${fmt(targetPrice)}`,
      `canh long tại ${fmt(pendingLong)} khi giá retest pivot`,
      `entry short tại ${fmt(pendingShort)} nếu giá bác R1`,
    ];
  }

  return [
    `Giá đang ở phía dưới Pivot (${fmt(pivot)})`,
    `có xu hướng tiến về Pivot`,
    `canh long tại ${fmt(pendingLong)} khi giá retest vùng hỗ trợ`,
    `entry short nếu giá bác pivot tại ${fmt(pendingShort)}`,
  ];
}

// ── Main scenario builder ─────────────────────────────────────────────────────
export function buildScenario(
  candles: CandleData[],
  chartTrendlines: Trendline[],
  symbol: Symbol
): MarketScenario {
  const levels = calcPivot(candles);
  const { pivot, r1, s1, r2, s2 } = levels;
  const currentPrice = candles[candles.length - 1].close;

  const abovePivot = currentPrice >= pivot;

  // Target, pending long, pending short
  let targetPrice: number;
  let pendingLong: number;
  let pendingShort: number;

  if (abovePivot) {
    targetPrice = r1;
    pendingLong = pivot;
    pendingShort = r1;
  } else {
    targetPrice = pivot;
    pendingLong = s1;
    pendingShort = pivot;
  }

  const fmt = (n: number) => (Math.abs(n) >= 10000 ? n.toFixed(0) : n.toFixed(2));

  const explanationLines = buildExplanationLines(
    currentPrice,
    pivot,
    r1,
    s1,
    targetPrice,
    pendingLong,
    pendingShort,
    fmt
  );

  // Primary scenario:
  // - Above pivot → lean LONG toward R1
  // - Below pivot but above S1 → lean LONG (expect mean reversion toward pivot)
  // - Below S1 → lean SHORT (price broke below structure, target S2)
  const belowS1 = currentPrice < s1;
  const primarySide: "long" | "short" = belowS1 ? "short" : "long";
  const primaryScenario = {
    side: primarySide,
    trigger: primarySide === "long" ? pendingLong : pendingShort,
    target: primarySide === "long" ? targetPrice : s2,
    rationale: abovePivot
      ? `Giá trên Pivot (${fmt(pivot)}), duy trì long đến R1 ${fmt(r1)}`
      : belowS1
        ? `Giá dưới S1 (${fmt(s1)}), ưu tiên SHORT về S2 ${fmt(s2)}`
        : `Giá dưới Pivot (${fmt(pivot)}), canh long retest S1 hướng đến Pivot`,
  };

  // Alternate scenario (always the opposite side of primary)
  const alternateSide: "long" | "short" = primarySide === "long" ? "short" : "long";
  const alternateScenario = {
    side: alternateSide,
    trigger: alternateSide === "short" ? pendingShort : pendingLong,
    target: alternateSide === "short" ? (abovePivot ? pivot : s2) : targetPrice,
    rationale: abovePivot
      ? `Nếu giá bác R1 tại ${fmt(r1)}, switch short về Pivot`
      : belowS1
        ? `Nếu giá hồi về S1 (${fmt(s1)}), canh long về Pivot`
        : `Nếu giá xuyên S1 tại ${fmt(s1)}, switch short về S2 ${fmt(s2)}`,
  };

  // Caution
  const cautionText =
    Math.abs(currentPrice - pivot) < (r1 - s1) * 0.08
      ? `Giá quá gần Pivot — cần xác nhận hướng trước khi entry`
      : undefined;

  // Invalidation
  const invalidationLevel = abovePivot ? s1 : r1;

  const scenarioState = deriveScenarioState(currentPrice, pivot, r1, s1);
  const status = deriveStatus(currentPrice, pendingLong, pendingShort, pivot);

  return {
    symbol,
    pivot: +fmt(pivot),
    currentPrice: +fmt(currentPrice),
    targetPrice: +fmt(targetPrice),
    pendingLong: +fmt(pendingLong),
    pendingShort: +fmt(pendingShort),
    r1: +fmt(r1),
    s1: +fmt(s1),
    r2: +fmt(r2),
    s2: +fmt(s2),
    primaryScenario,
    alternateScenario,
    explanationLines,
    cautionText,
    invalidationLevel: +fmt(invalidationLevel),
    scenarioState,
    status,
    trendlines: chartTrendlines,
  };
}
