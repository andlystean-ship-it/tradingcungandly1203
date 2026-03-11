/**
 * scenario.ts — Role-based scenario engine (refactored)
 *
 * Level roles (strictly separated, never collapse by design):
 *
 *   pivot           = reference / balance level (from classic pivot calc)
 *   pendingLong     = nearest support: bounce / retest / long entry trigger
 *                     Rule: always below targetPrice
 *   pendingShort    = nearest resistance: rejection / short entry trigger
 *                     Rule: always above targetPrice
 *   targetPrice     = next tactical objective (between pendingLong and pendingShort)
 *   invalidationLevel = explicit fail point (outside both triggers)
 *
 * Zone map — each zone assigns DISTINCT levels (no two roles share a value):
 *
 *   bull2   price > r1         pendingLong=r1    target=r2   short=r3   inv=pivot
 *   bull1   pivot<price≤r1     pendingLong=pivot  target=r1   short=r2   inv=s1
 *   trans   s1<price≤pivot     pendingLong=s1    target=r1   short=r2   inv=s2
 *   bear1   s2<price≤s1        pendingShort=s1   target=s2   long=s3    inv=pivot
 *   bear2   price≤s2           pendingShort=s2   target=s3   long=s1    inv=r1
 *
 * Swing refinement: swap arithmetic levels for nearest confirmed swing
 *   high/low when one exists within 1 ATR of the arithmetic level.
 *
 * Uniqueness guard: enforce minimum 0.3% price gap between every pair of levels.
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
import { detectSwingHighs, detectSwingLows } from "./swings";

// ── Zone identification ────────────────────────────────────────────────────────
type Zone = "bull2" | "bull1" | "trans" | "bear1" | "bear2";

function identifyZone(
  price: number,
  pivot: number,
  r1: number,
  s1: number,
  s2: number
): Zone {
  if (price > r1) return "bull2";
  if (price > pivot) return "bull1";
  if (price > s1) return "trans";
  if (price > s2) return "bear1";
  return "bear2";
}

// ── ATR approximation from recent candles ─────────────────────────────────────
function approxATR(candles: CandleData[], n = 14): number {
  const slice = candles.slice(-n);
  if (slice.length === 0) return 0;
  const sum = slice.reduce((acc, c) => acc + (c.high - c.low), 0);
  return sum / slice.length;
}

// ── Nearest swing high above price within maxDist ─────────────────────────────
function nearestSwingHighAbove(
  candles: CandleData[],
  price: number,
  fallback: number,
  maxDist: number
): number {
  const highs = detectSwingHighs(candles, 3, 2)
    .filter((sh) => sh.price > price && sh.price <= price + maxDist)
    .sort((a, b) => a.price - b.price);
  return highs.length > 0 ? highs[0].price : fallback;
}

// ── Nearest swing low below price within maxDist ──────────────────────────────
function nearestSwingLowBelow(
  candles: CandleData[],
  price: number,
  fallback: number,
  maxDist: number
): number {
  const lows = detectSwingLows(candles, 3, 2)
    .filter((sl) => sl.price < price && sl.price >= price - maxDist)
    .sort((a, b) => b.price - a.price);
  return lows.length > 0 ? lows[0].price : fallback;
}

// ── Signal status ─────────────────────────────────────────────────────────────
function deriveStatus(
  price: number,
  pendingLong: number,
  pendingShort: number
): SignalStatus {
  const gap = Math.abs(pendingShort - pendingLong) || 1;
  const thresh = gap * 0.04; // within 4% of the level gap
  if (Math.abs(price - pendingLong) <= thresh) return "pending_long";
  if (Math.abs(price - pendingShort) <= thresh) return "pending_short";
  return "watching";
}

// ── Scenario state ────────────────────────────────────────────────────────────
function deriveScenarioState(
  zone: Zone,
  price: number,
  pivot: number,
  r1: number,
  s1: number
): ScenarioState {
  if (zone === "bull2" || zone === "bull1") return "bullish_primary";
  if (zone === "bear1" || zone === "bear2") return "bearish_primary";
  // trans zone: near pivot
  if (Math.abs(price - pivot) < (r1 - s1) * 0.08) return "neutral_transition";
  return "bullish_primary"; // trans still leans bullish
}

// ── Explanation lines ─────────────────────────────────────────────────────────
function buildExplanationLines(
  zone: Zone,
  pivot: number,
  r1: number,
  s1: number,
  s2: number,
  targetPrice: number,
  pendingLong: number,
  pendingShort: number,
  fmt: (n: number) => string
): string[] {
  switch (zone) {
    case "bull2":
      return [
        `Giá trên R1 (${fmt(r1)}), động lực tăng mạnh`,
        `mục tiêu R2 tại ${fmt(targetPrice)}`,
        `hỗ trợ R1 cũ tại ${fmt(pendingLong)}, canh long khi retest`,
        `entry short alternate tại R3 (${fmt(pendingShort)}) nếu giá bác mạnh`,
      ];
    case "bull1":
      return [
        `Giá trên Pivot (${fmt(pivot)}), xu hướng tăng`,
        `mục tiêu R1 tại ${fmt(targetPrice)}`,
        `canh long retest Pivot tại ${fmt(pendingLong)}`,
        `entry short alternate tại R2 (${fmt(pendingShort)}) nếu giá bác R1`,
      ];
    case "trans":
      return [
        `Giá đang ở phía dưới Pivot (${fmt(pivot)}), có xu hướng hồi phục`,
        `mục tiêu R1 tại ${fmt(targetPrice)} sau khi vượt Pivot`,
        `canh long tại S1 (${fmt(pendingLong)}) khi giá retest hỗ trợ`,
        `entry short alternate tại R2 (${fmt(pendingShort)}) nếu giá bác R1`,
      ];
    case "bear1":
      return [
        `Giá dưới S1 (${fmt(s1)}), xu hướng giảm`,
        `mục tiêu S2 tại ${fmt(targetPrice)}`,
        `sẽ tăng về entry short tại S1 (${fmt(pendingShort)}) khi giá bật lên`,
        `hỗ trợ sâu alternate tại ${fmt(pendingLong)} nếu giá giảm tiếp`,
      ];
    case "bear2":
      return [
        `Giá dưới S2 (${fmt(s2)}), áp lực bán lớn`,
        `mục tiêu S3 tại ${fmt(targetPrice)}`,
        `kháng cự S2 cũ tại ${fmt(pendingShort)}, canh short khi giá bật`,
        `hồi phục mạnh về S1 (${fmt(pendingLong)}) sẽ đảo hướng`,
      ];
  }
}

// ── Main scenario builder ─────────────────────────────────────────────────────
export function buildScenario(
  candles: CandleData[],
  chartTrendlines: Trendline[],
  symbol: Symbol
): MarketScenario {
  const levels = calcPivot(candles);
  const { pivot, r1, r2, r3, s1, s2, s3 } = levels;
  const currentPrice = candles[candles.length - 1].close;

  const atr = approxATR(candles);
  // Allow swing refinement within 2 ATRs of the arithmetic level
  const swingWindow = atr * 2 || (pivot * 0.015);

  // ── Zone identification ──────────────────────────────────────────────────────
  const zone = identifyZone(currentPrice, pivot, r1, s1, s2);

  // ── Raw level assignment by zone ─────────────────────────────────────────────
  let rawLong: number;
  let rawTarget: number;
  let rawShort: number;
  let rawInvalidation: number;
  let primarySide: "long" | "short";
  let longReason: string;
  let shortReason: string;
  let targetReason: string;
  let invReason: string;

  switch (zone) {
    case "bull2":
      primarySide = "long";
      rawLong = r1;
      rawTarget = r2;
      rawShort = r3;
      rawInvalidation = pivot;
      longReason = "R1 reclaim — former resistance becomes support retest zone";
      shortReason = "R3 alternate rejection trigger above R2 target";
      targetReason = "R2 — next resistance objective in uptrend";
      invReason = "Pivot — reclaim failure below Pivot invalidates bullish structure";
      break;
    case "bull1":
      primarySide = "long";
      rawLong = pivot;
      rawTarget = r1;
      rawShort = r2;
      rawInvalidation = s1;
      longReason = "Pivot retest — balance level as long entry trigger";
      shortReason = "R2 alternate rejection trigger; above R1 target";
      targetReason = "R1 — nearest resistance; first upside objective";
      invReason = "S1 — breach below S1 invalidates bullish scenario";
      break;
    case "trans":
      primarySide = "long"; // lean long — mean reversion toward R1
      rawLong = s1;
      rawTarget = r1; // extended target — NOT pivot (avoids collapse with pivot)
      rawShort = r2;
      rawInvalidation = s2;
      longReason = "S1 support zone — confirmed bounce / retest trigger";
      shortReason = "R2 alternate rejection; above R1 target; bias flips short only beyond R2";
      targetReason = "R1 — next resistance after pivot reclaim; pivot is waypoint not target";
      invReason = "S2 — breach below S2 invalidates recovery thesis";
      break;
    case "bear1":
      primarySide = "short";
      rawShort = s1; // former support = new resistance; sell bounce here
      rawTarget = s2;
      rawLong = s3;
      rawInvalidation = pivot;
      longReason = "S3 deep support — alternate long only at extreme extension";
      shortReason = "S1 rejection zone — former support now resistance; primary sell trigger";
      targetReason = "S2 — next support; short target in bearish leg";
      invReason = "Pivot — recovery above Pivot invalidates bearish scenario";
      break;
    case "bear2":
    default:
      primarySide = "short";
      rawShort = s2;
      rawTarget = s3;
      rawLong = s1;
      rawInvalidation = r1;
      longReason = "S1 recovery level — alternate long trigger if price reclaims S1";
      shortReason = "S2 rejection zone — former support now resistance; primary sell trigger";
      targetReason = "S3 — extended bearish target below S2";
      invReason = "R1 — recovery above R1 fully invalidates bearish leg";
      break;
  }

  // ── Swing refinement ─────────────────────────────────────────────────────────
  // Try to replace arithmetic levels with nearest confirmed swing structure.
  // Only substitute when a swing exists within `swingWindow` of the arithmetic level.
  if (primarySide === "long") {
    const swingLong = nearestSwingLowBelow(candles, currentPrice, rawLong, swingWindow * 1.5);
    if (Math.abs(swingLong - rawLong) < swingWindow) {
      rawLong = swingLong;
      longReason += " (refined to nearest swing low)";
    }
    const swingShort = nearestSwingHighAbove(candles, rawTarget, rawShort, swingWindow * 2);
    if (Math.abs(swingShort - rawShort) < swingWindow) {
      rawShort = swingShort;
      shortReason += " (refined to nearest swing high)";
    }
  } else {
    const swingShort = nearestSwingHighAbove(candles, currentPrice, rawShort, swingWindow * 1.5);
    if (Math.abs(swingShort - rawShort) < swingWindow) {
      rawShort = swingShort;
      shortReason += " (refined to nearest swing high)";
    }
    const swingLong = nearestSwingLowBelow(candles, rawTarget, rawLong, swingWindow * 2);
    if (Math.abs(swingLong - rawLong) < swingWindow) {
      rawLong = swingLong;
      longReason += " (refined to nearest swing low)";
    }
  }

  // ── Uniqueness guard ──────────────────────────────────────────────────────────
  // Minimum gap = 0.3 % of price (keeps levels distinct but not absurd)
  const minGap = currentPrice * 0.003;

  let pendingLong = rawLong;
  let targetPrice = rawTarget;
  let pendingShort = rawShort;
  let invalidationLevel = rawInvalidation;

  if (primarySide === "long") {
    // Ordering: pendingLong < pivot < ... < targetPrice < pendingShort
    // 1. targetPrice must be above pendingLong + minGap
    targetPrice = Math.max(targetPrice, pendingLong + minGap * 3);
    // 2. pendingShort must be above targetPrice + minGap
    pendingShort = Math.max(pendingShort, targetPrice + minGap * 3);
    // 3. invalidationLevel must be below pendingLong − minGap
    invalidationLevel = Math.min(invalidationLevel, pendingLong - minGap * 2);
    // 4. pivot must not equal targetPrice
    if (Math.abs(targetPrice - pivot) < minGap) {
      targetPrice = pivot + minGap * 3;
    }
    // 5. targetPrice must not equal pendingShort
    if (Math.abs(pendingShort - targetPrice) < minGap) {
      pendingShort = targetPrice + minGap * 3;
    }
  } else {
    // Ordering: pendingLong < targetPrice < ... < pendingShort
    // (for short: price is between targetPrice below and pendingShort above)
    // 1. targetPrice must be below pendingShort − minGap
    targetPrice = Math.min(targetPrice, pendingShort - minGap * 3);
    // 2. pendingLong must be below targetPrice − minGap
    pendingLong = Math.min(pendingLong, targetPrice - minGap * 3);
    // 3. invalidationLevel must be above pendingShort + minGap
    invalidationLevel = Math.max(invalidationLevel, pendingShort + minGap * 2);
    // 4. pivot must not equal targetPrice
    if (Math.abs(targetPrice - pivot) < minGap) {
      targetPrice = pivot - minGap * 3;
    }
    // 5. targetPrice must not equal pendingShort
    if (Math.abs(pendingShort - targetPrice) < minGap) {
      targetPrice = pendingShort - minGap * 3;
    }
  }

  // Round to 2 decimal places
  const fix = (n: number) => Math.round(n * 100) / 100;
  pendingLong      = fix(pendingLong);
  targetPrice      = fix(targetPrice);
  pendingShort     = fix(pendingShort);
  invalidationLevel = fix(invalidationLevel);

  const fmt = (n: number) => n.toFixed(2);

  // ── Explanation lines ─────────────────────────────────────────────────────────
  const explanationLines = buildExplanationLines(
    zone, pivot, r1, s1, s2,
    targetPrice, pendingLong, pendingShort, fmt
  );

  // ── Primary scenario (dominant direction) ────────────────────────────────────
  const primaryScenario = {
    side: primarySide,
    trigger: primarySide === "long" ? pendingLong : pendingShort,
    target: targetPrice,
    rationale: primarySide === "long"
      ? `Long từ ${fmt(pendingLong)} → target ${fmt(targetPrice)}, inv ${fmt(invalidationLevel)}`
      : `Short từ ${fmt(pendingShort)} → target ${fmt(targetPrice)}, inv ${fmt(invalidationLevel)}`,
  };

  // ── Alternate scenario (opposite, conditional) ───────────────────────────────
  // For long primary: short only triggers at pendingShort (above target) — NOT equal-weighted
  // For short primary: long only triggers at pendingLong (below target) — NOT equal-weighted
  const alternateSide: "long" | "short" = primarySide === "long" ? "short" : "long";
  const alternateScenario = {
    side: alternateSide,
    trigger: alternateSide === "short" ? pendingShort : pendingLong,
    target: alternateSide === "short" ? pendingLong : pendingShort,
    rationale: alternateSide === "short"
      ? `Alternate Short nếu giá bác ${fmt(pendingShort)} — không phải kịch bản chính`
      : `Alternate Long nếu giá về ${fmt(pendingLong)} và xác nhận hỗ trợ`,
  };

  // ── Caution text ─────────────────────────────────────────────────────────────
  const rangeSpan = r1 - s1 || 1;
  const cautionText =
    Math.abs(currentPrice - pivot) < rangeSpan * 0.06
      ? `Giá sát Pivot — chờ xác nhận phá vỡ trước khi entry`
      : undefined;

  const scenarioState = deriveScenarioState(zone, currentPrice, pivot, r1, s1);
  const status = deriveStatus(currentPrice, pendingLong, pendingShort);

  return {
    symbol,
    pivot:             fix(pivot),
    currentPrice:      fix(currentPrice),
    targetPrice,
    pendingLong,
    pendingShort,
    r1:                fix(r1),
    s1:                fix(s1),
    r2:                fix(r2),
    s2:                fix(s2),
    primaryScenario,
    alternateScenario,
    explanationLines,
    cautionText,
    invalidationLevel,
    scenarioState,
    status,
    trendlines: chartTrendlines,
    // Debug fields
    pendingLongReason:   longReason,
    pendingShortReason:  shortReason,
    targetReason,
    invalidationReason:  invReason,
    zone,
  };
}
