/**
 * scenario.ts — Multi-Timeframe Scenario Engine
 *
 * Consumes:
 *   - candleMap (all timeframes)
 *   - timeframeSignals (scored per TF)
 *   - marketBias (aggregated global bias)
 *   - trendlines (1H structure)
 *   - pivot context from multiple TFs
 *
 * Level selection priority:
 *   1. Confirmed swing structure (nearest SR cluster)
 *   2. Trendline interaction levels
 *   3. HTF levels (4H/1D pivot/S/R)
 *   4. Fallback: 1H pivot arithmetic
 *
 * Status policy:
 *   - pending_long/short requires touch + candle confirmation
 *   - watching when no confirmation yet
 *   - invalidated when price closes beyond invalidation level
 */

import type {
  CandleData,
  CandleMap,
  MarketScenario,
  MarketBias,
  TimeframeSignal,
  SignalStatus,
  ScenarioState,
  Symbol,
  Timeframe,
  Trendline,
  TrendContext,
  TrendAlignment,
  EntryQuality,
  TimeframeEntry,
} from "../types";
import { calcPivot, nearestSupport, nearestResistance } from "./pivot";
import { detectSwingHighs, detectSwingLows, type SwingPoint } from "./swings";
import { buildTrendlines } from "./trendlines";
import { ENTRY_QUALITY } from "./score-config";
import i18n from "../i18n";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScenarioInput = {
  candleMap: CandleMap;
  timeframeSignals: TimeframeSignal[];
  marketBias: MarketBias;
  chartTrendlines: Trendline[];
  trendContext: TrendContext;
  symbol: Symbol;
};

type Zone = "bull2" | "bull1" | "trans" | "bear1" | "bear2";

// ── SR Cluster: aggregate support/resistance from multiple sources ────────────

type SRLevel = {
  price: number;
  source: string;
  strength: number; // 0-100
};

function buildSRCluster(
  candleMap: CandleMap,
  trendlines: Trendline[],
  currentPrice: number
): { supports: SRLevel[]; resistances: SRLevel[] } {
  const supports: SRLevel[] = [];
  const resistances: SRLevel[] = [];

  // ── Swing levels from key timeframes ─────────────────────────────────────
  const keyTFs: { tf: Timeframe; weight: number }[] = [
    { tf: "1H", weight: 40 },
    { tf: "4H", weight: 70 },
    { tf: "12H", weight: 85 },
    { tf: "1D", weight: 100 },
  ];

  for (const { tf, weight } of keyTFs) {
    const candles = candleMap[tf];
    if (!candles || candles.length < 10) continue;

    const swingHighs = detectSwingHighs(candles, 3, 2);
    const swingLows = detectSwingLows(candles, 3, 2);

    for (const sh of swingHighs) {
      const level: SRLevel = { price: sh.price, source: `swing-${tf}`, strength: weight };
      if (sh.price > currentPrice) resistances.push(level);
      else supports.push(level);
    }
    for (const sl of swingLows) {
      const level: SRLevel = { price: sl.price, source: `swing-${tf}`, strength: weight };
      if (sl.price < currentPrice) supports.push(level);
      else resistances.push(level);
    }
  }

  // ── Pivot levels from HTF ────────────────────────────────────────────────
  const htfTFs: { tf: Timeframe; weight: number }[] = [
    { tf: "4H", weight: 60 },
    { tf: "1D", weight: 90 },
  ];

  for (const { tf, weight } of htfTFs) {
    const candles = candleMap[tf];
    if (!candles || candles.length < 3) continue;
    const levels = calcPivot(candles);

    for (const [label, price] of Object.entries(levels)) {
      if (typeof price !== "number") continue;
      const level: SRLevel = { price, source: `pivot-${tf}-${label}`, strength: weight };
      if (price > currentPrice) resistances.push(level);
      else if (price < currentPrice) supports.push(level);
    }
  }

  // ── Trendline projected levels ──────────────────────────────────────────
  const chartCandles = candleMap["1H"];
  if (chartCandles) {
    const lastIdx = chartCandles.length - 1;
    for (const t of trendlines) {
      if (!t.active || t.x2 === t.x1) continue;
      const slope = (t.y2 - t.y1) / (t.x2 - t.x1);
      const projected = t.y1 + slope * (lastIdx - t.x1);

      const level: SRLevel = {
        price: projected,
        source: `trendline-${t.kind}`,
        strength: t.strength,
      };
      if (projected > currentPrice) resistances.push(level);
      else supports.push(level);
    }
  }

  // ── Cluster: merge nearby levels (within 0.3% of each other) ─────────────
  const clusterMerge = (levels: SRLevel[]): SRLevel[] => {
    if (levels.length === 0) return [];
    const sorted = [...levels].sort((a, b) => a.price - b.price);
    const merged: SRLevel[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = merged[merged.length - 1];
      if (Math.abs(sorted[i].price - prev.price) / prev.price < 0.003) {
        // Merge: keep higher strength, average price
        prev.price = (prev.price * prev.strength + sorted[i].price * sorted[i].strength) /
          (prev.strength + sorted[i].strength);
        prev.strength = Math.min(100, prev.strength + sorted[i].strength * 0.3);
        prev.source += `+${sorted[i].source}`;
      } else {
        merged.push({ ...sorted[i] });
      }
    }
    return merged;
  };

  return {
    supports: clusterMerge(supports).sort((a, b) => b.price - a.price),  // nearest first
    resistances: clusterMerge(resistances).sort((a, b) => a.price - b.price), // nearest first
  };
}

// ── ATR approximation ─────────────────────────────────────────────────────────
function approxATR(candles: CandleData[], n = 14): number {
  const slice = candles.slice(-n);
  if (slice.length === 0) return 0;
  return slice.reduce((acc, c) => acc + (c.high - c.low), 0) / slice.length;
}

// ── Zone identification ────────────────────────────────────────────────────────
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

// ── Determine primary side from MTF consensus + trend context ──────────────────
function determinePrimarySide(
  zone: Zone,
  marketBias: MarketBias,
  htfSignals: TimeframeSignal[],
  trendContext: TrendContext
): "long" | "short" | "neutral" {
  const htfBullish = htfSignals.filter(s => s.bias === "bullish").length;
  const htfBearish = htfSignals.filter(s => s.bias === "bearish").length;

  // ── Hard neutral gate ──────────────────────────────────────────────────────
  // If bias is neutral (confidence < 20 or 47–53 bullish%), don't force a side
  if (marketBias.dominantSide === "neutral") return "neutral";

  // If confidence is low AND trend context is mixed/neutral, stay neutral
  if (marketBias.confidence < 25 && (trendContext.alignment === "mixed" || trendContext.alignment === "neutral")) {
    return "neutral";
  }

  // If HTF is conflicting with local zone AND confidence not strong, stay neutral
  const zoneLong = zone === "bull2" || zone === "bull1" || zone === "trans";
  if (marketBias.confidence < 30) {
    if ((zoneLong && htfBearish > htfBullish) || (!zoneLong && htfBullish > htfBearish)) {
      return "neutral";
    }
  }

  // ── Directional determination (only when confidence is sufficient) ─────────
  // If HTF strongly disagrees with zone, defer to HTF
  if (zoneLong && htfBearish > htfBullish && marketBias.confidence > 30) {
    return "short";
  }
  if (!zoneLong && htfBullish > htfBearish && marketBias.confidence > 30) {
    return "long";
  }

  // Trend alignment can resolve transition zone ambiguity
  if (zone === "trans") {
    if (trendContext.alignment === "aligned_bearish" && htfBearish >= htfBullish) return "short";
    if (trendContext.alignment === "aligned_bullish" && htfBullish >= htfBearish) return "long";
    // Trans zone with no alignment → neutral
    if (trendContext.alignment === "mixed" || trendContext.alignment === "neutral") return "neutral";
  }

  // Strong directional zone with sufficient confidence
  return zoneLong ? "long" : "short";
}

// ── Confirmation-based signal status (P6) ──────────────────────────────────────
function deriveStatus(
  candles: CandleData[],
  pendingLong: number,
  pendingShort: number,
  invalidationLevel: number,
  primarySide: "long" | "short" | "neutral"
): SignalStatus {
  // Neutral primary side → always watching
  if (primarySide === "neutral") return "watching";

  const recent = candles.slice(-5);
  if (recent.length < 2) return "watching";

  const currentPrice = recent[recent.length - 1].close;
  const atr = recent.reduce((s, c) => s + (c.high - c.low), 0) / recent.length;
  const touchZone = atr * 0.4;

  // Check invalidation first
  if (primarySide === "long" && currentPrice < invalidationLevel) return "invalidated";
  if (primarySide === "short" && currentPrice > invalidationLevel) return "invalidated";

  // Check for touch + candle close confirmation at pending levels
  for (let i = 0; i < recent.length - 1; i++) {
    const c = recent[i];
    const nextC = recent[i + 1];

    if (c.low <= pendingLong + touchZone && c.low >= pendingLong - touchZone) {
      if (nextC.close > pendingLong) return "pending_long";
    }
    if (c.high >= pendingShort - touchZone && c.high <= pendingShort + touchZone) {
      if (nextC.close < pendingShort) return "pending_short";
    }
  }

  // Check for break/reclaim in last candle
  const lastCandle = recent[recent.length - 1];
  const prevCandle = recent[recent.length - 2];

  if (prevCandle.close < pendingLong && lastCandle.close > pendingLong) return "pending_long";
  if (prevCandle.close > pendingShort && lastCandle.close < pendingShort) return "pending_short";

  return "watching";
}

// ── Scenario state ────────────────────────────────────────────────────────────
function deriveScenarioState(
  zone: Zone,
  primarySide: "long" | "short" | "neutral",
  marketBias: MarketBias
): ScenarioState {
  // Neutral primary OR neutral bias → neutral_transition or conflicted
  if (primarySide === "neutral" || marketBias.dominantSide === "neutral") {
    if (marketBias.confidence < 10) return "conflicted";
    return "neutral_transition";
  }

  const zoneIsBullish = zone === "bull2" || zone === "bull1";
  const zoneIsBearish = zone === "bear1" || zone === "bear2";

  if ((zoneIsBullish && marketBias.dominantSide === "short") ||
      (zoneIsBearish && marketBias.dominantSide === "long")) {
    return "conflicted";
  }

  if (zone === "trans") return "neutral_transition";
  if (primarySide === "long") return "bullish_primary";
  return "bearish_primary";
}

// ── Build explanation lines from full context ──────────────────────────────────
function buildExplanationLines(
  zone: Zone,
  primarySide: "long" | "short" | "neutral",
  marketBias: MarketBias,
  htfSignals: TimeframeSignal[],
  pivot: number,
  targetPrice: number,
  pendingLong: number,
  pendingShort: number,
  invalidationLevel: number,
  status: SignalStatus,
  trendContext: TrendContext,
  fmt: (n: number) => string,
  entryQuality: EntryQuality,
  isActionable: boolean,
): string[] {
  const biasDir = marketBias.dominantSide === "long" ? t("scenario.biasUp") :
                  marketBias.dominantSide === "short" ? t("scenario.biasDown") : t("scenario.biasNeutral");
  const lines: string[] = [];

  const htfStr = htfSignals.map(s =>
    `${s.timeframe}:${s.bias === "bullish" ? "↑" : s.bias === "bearish" ? "↓" : "—"}`
  ).join(" ");
  lines.push(t("scenario.mtfLine", {
    bias: biasDir,
    bullish: marketBias.bullishPercent,
    confidence: marketBias.confidence,
    htf: htfStr,
  }));

  const zoneKeys: Record<Zone, string> = {
    bull2: "scenario.zoneBull2",
    bull1: "scenario.zoneBull1",
    trans: "scenario.zoneTrans",
    bear1: "scenario.zoneBear1",
    bear2: "scenario.zoneBear2",
  };
  lines.push(t("scenario.zoneLine", {
    zone,
    desc: t(zoneKeys[zone]),
    pivot: fmt(pivot),
  }));

  // ── Trend context line ─────────────────────────────────────────────────────
  const alignKeys: Record<TrendAlignment, string> = {
    aligned_bullish: "scenario.trendAlignedBull",
    aligned_bearish: "scenario.trendAlignedBear",
    mixed: "scenario.trendMixed",
    neutral: "scenario.trendNeutral",
  };
  const trendLine = `Trend: ${t(alignKeys[trendContext.alignment])}`;
  const trendParts: string[] = [trendLine];

  if (trendContext.shortTerm.dominantLine) {
    const dl = trendContext.shortTerm.dominantLine;
    trendParts.push(
      dl.kind === "ascending"
        ? t("scenario.trendSupportAsc")
        : t("scenario.trendResistDesc")
    );
  }
  if (trendContext.higherTimeframe.direction !== "neutral") {
    trendParts.push(
      trendContext.higherTimeframe.direction === "bullish"
        ? t("scenario.htfBullSupport")
        : t("scenario.htfBearPressure")
    );
  }
  lines.push(trendParts.join(" — "));

  if (primarySide === "neutral") {
    lines.push(t("scenario.neutralScenario"));
    if (marketBias.debug?.neutralReason) {
      lines.push(t("scenario.neutralReason", { reason: marketBias.debug.neutralReason }));
    }
    if (trendContext.alignment === "mixed") {
      lines.push(t("scenario.mixedWarning"));
    }
  } else if (primarySide === "long") {
    if (isActionable) {
      lines.push(t("scenario.longActionable", { entry: fmt(pendingLong), target: fmt(targetPrice) }));
    } else {
      lines.push(t("scenario.longRef", { entry: fmt(pendingLong), quality: entryQuality.qualityScore }));
    }
    if (trendContext.higherTimeframe.direction === "bearish") {
      lines.push(t("scenario.longHtfWarn"));
    }
  } else {
    if (isActionable) {
      lines.push(t("scenario.shortActionable", { entry: fmt(pendingShort), target: fmt(targetPrice) }));
    } else {
      lines.push(t("scenario.shortRef", { entry: fmt(pendingShort), quality: entryQuality.qualityScore }));
    }
    if (trendContext.higherTimeframe.direction === "bullish") {
      lines.push(t("scenario.shortHtfWarn"));
    }
  }

  const statusKeys: Record<SignalStatus, string> = {
    idle: "scenario.statusIdle",
    watching: "scenario.statusWatching",
    pending_long: "scenario.statusPendingLong",
    pending_short: "scenario.statusPendingShort",
    active_long: "scenario.statusActiveLong",
    active_short: "scenario.statusActiveShort",
    invalidated: "scenario.statusInvalidated",
    low_quality_setup: "scenario.statusLowQuality",
    stale: "scenario.statusStale",
  };
  lines.push(t("scenario.invalidationLine", {
    level: fmt(invalidationLevel),
    status: t(statusKeys[status]),
  }));

  return lines;
}

// ── Entry quality assessment (P2) ──────────────────────────────────────────────

function scoreStructureQuality(
  srCluster: { supports: SRLevel[]; resistances: SRLevel[] },
  entry: number,
  primarySide: "long" | "short",
  atr: number,
): number {
  // How strong is the SR level at the entry point?
  const levels = primarySide === "long" ? srCluster.supports : srCluster.resistances;
  if (levels.length === 0) return 10;

  // Find closest level to entry
  let bestMatch = levels[0];
  let bestDist = Math.abs(levels[0].price - entry);
  for (const l of levels) {
    const d = Math.abs(l.price - entry);
    if (d < bestDist) { bestDist = d; bestMatch = l; }
  }

  const distanceInATR = atr > 0 ? bestDist / atr : 10;
  if (distanceInATR > 1.5) return 10; // entry is far from any structure

  // Quality from level strength + number of confluent sources
  const sourceCount = bestMatch.source.split("+").length;
  const proximityBonus = Math.max(0, 1 - distanceInATR) * 30;
  return Math.round(Math.min(100,
    bestMatch.strength * 0.6 + sourceCount * 10 + proximityBonus
  ));
}

function assessEntryQuality(
  primarySide: "long" | "short",
  entry: number,
  target: number,
  invalidation: number,
  marketBias: MarketBias,
  trendContext: TrendContext,
  htfSignals: TimeframeSignal[],
  srCluster: { supports: SRLevel[]; resistances: SRLevel[] },
  atr: number,
): EntryQuality {
  const confluenceLabels: string[] = [];
  const w = ENTRY_QUALITY.factorWeights;

  // ── R:R calculation ────────────────────────────────────────────────────────
  const risk = Math.abs(entry - invalidation);
  const reward = Math.abs(target - entry);
  const rewardRisk = risk > 0 ? reward / risk : 0;

  // ── Factor 1: Structure quality at entry level ────────────────────────────
  const structureQuality = scoreStructureQuality(srCluster, entry, primarySide, atr);
  if (structureQuality >= 50) confluenceLabels.push("strong structure");

  // ── Factor 2: Trend alignment ─────────────────────────────────────────────
  let trendAlignment = 50; // neutral default
  if ((primarySide === "long" && trendContext.alignment === "aligned_bullish") ||
      (primarySide === "short" && trendContext.alignment === "aligned_bearish")) {
    trendAlignment = 90;
    confluenceLabels.push("trend aligned");
  } else if (trendContext.alignment === "mixed") {
    trendAlignment = 25;
  } else if ((primarySide === "long" && trendContext.alignment === "aligned_bearish") ||
             (primarySide === "short" && trendContext.alignment === "aligned_bullish")) {
    trendAlignment = 10;
  }
  // Pressure reinforcement
  if (trendContext.pressure) {
    const pressureAligned =
      (primarySide === "long" && trendContext.pressure.netPressure > 20) ||
      (primarySide === "short" && trendContext.pressure.netPressure < -20);
    if (pressureAligned) {
      trendAlignment = Math.min(100, trendAlignment + 15);
      confluenceLabels.push("pressure supports");
    }
  }

  // ── Factor 3: HTF pressure ────────────────────────────────────────────────
  let htfPressureFactor = 50;
  const htfBullish = htfSignals.filter(s => s.bias === "bullish").length;
  const htfBearish = htfSignals.filter(s => s.bias === "bearish").length;
  const htfTotal = htfSignals.length || 1;

  if (primarySide === "long") {
    htfPressureFactor = Math.round((htfBullish / htfTotal) * 100);
  } else {
    htfPressureFactor = Math.round((htfBearish / htfTotal) * 100);
  }
  // Boost from trend pressure HTF component
  if (trendContext.pressure) {
    const htfP = trendContext.pressure.htfPressure;
    if ((primarySide === "long" && htfP > 15) || (primarySide === "short" && htfP < -15)) {
      htfPressureFactor = Math.min(100, htfPressureFactor + 15);
      confluenceLabels.push("HTF trend support");
    }
  }
  if (htfPressureFactor >= 60) confluenceLabels.push("HTF majority");

  // ── Factor 4: Distance to invalidation (room to breathe) ─────────────────
  const riskInATR = atr > 0 ? risk / atr : 0;
  // 0.5–2.0 ATR is ideal; too tight = bad, too wide = also questionable
  let distToInv = 50;
  if (riskInATR >= 0.5 && riskInATR <= 2.5) distToInv = 80;
  else if (riskInATR < 0.3) distToInv = 15; // too tight, likely to get stopped out
  else if (riskInATR > 3.5) distToInv = 30; // too wide, large loss on failure

  // ── Factor 5: Distance to target ──────────────────────────────────────────
  const rewardInATR = atr > 0 ? reward / atr : 0;
  let distToTarget = 50;
  if (rewardInATR >= 1.0 && rewardInATR <= 5.0) distToTarget = 80;
  else if (rewardInATR < 0.5) distToTarget = 20;
  else if (rewardInATR > 8.0) distToTarget = 30; // unrealistically far

  // ── Factor 6: Reward/Risk score ───────────────────────────────────────────
  let rrFactor = 0;
  if (rewardRisk >= 3.0) rrFactor = 100;
  else if (rewardRisk >= ENTRY_QUALITY.minRewardRisk) rrFactor = Math.round(50 + (rewardRisk - ENTRY_QUALITY.minRewardRisk) * 30);
  else rrFactor = Math.round(rewardRisk / ENTRY_QUALITY.minRewardRisk * 40);

  if (rewardRisk >= ENTRY_QUALITY.minRewardRisk) {
    confluenceLabels.push(`R:R ${rewardRisk.toFixed(1)}`);
  }

  // Bias alignment check
  if ((primarySide === "long" && marketBias.dominantSide === "long" && marketBias.confidence >= 30) ||
      (primarySide === "short" && marketBias.dominantSide === "short" && marketBias.confidence >= 30)) {
    confluenceLabels.push("bias aligned");
  }

  // ── Composite quality score ───────────────────────────────────────────────
  const factors = {
    structureQuality,
    trendAlignment,
    htfPressure: htfPressureFactor,
    distanceToInvalidation: distToInv,
    distanceToTarget: distToTarget,
    rewardRisk: rrFactor,
  };

  const qualityScore = Math.round(Math.min(100,
    factors.structureQuality * w.structureQuality +
    factors.trendAlignment * w.trendAlignment +
    factors.htfPressure * w.htfPressure +
    factors.distanceToInvalidation * w.distanceToInvalidation +
    factors.distanceToTarget * w.distanceToTarget +
    factors.rewardRisk * w.rewardRisk
  ));

  const confluences = confluenceLabels.length;

  // ── Tradeable gate — stricter than before ─────────────────────────────────
  let tradeable = true;
  let rejectReason: string | undefined;

  if (rewardRisk < ENTRY_QUALITY.minRewardRisk) {
    tradeable = false;
    rejectReason = `R:R quá thấp (${rewardRisk.toFixed(1)} < ${ENTRY_QUALITY.minRewardRisk})`;
  } else if (confluences < ENTRY_QUALITY.minConfluences) {
    tradeable = false;
    rejectReason = `Chưa đủ confluence (${confluences} < ${ENTRY_QUALITY.minConfluences})`;
  } else if (qualityScore < ENTRY_QUALITY.minQualityScore) {
    tradeable = false;
    rejectReason = `Chất lượng setup thấp (${qualityScore} < ${ENTRY_QUALITY.minQualityScore})`;
  } else if (structureQuality < ENTRY_QUALITY.minStructureQuality) {
    tradeable = false;
    rejectReason = `Cấu trúc S/R yếu tại entry (${structureQuality} < ${ENTRY_QUALITY.minStructureQuality})`;
  }

  return { tradeable, rewardRisk, confluences, confluenceLabels, qualityScore, rejectReason, factors };
}

// ── Per-timeframe entry computation ───────────────────────────────────────────

const ENTRY_TFS: Timeframe[] = ["15M", "1H", "2H", "4H", "6H", "8H", "12H", "1D", "1W"];

function resolveEntryBias(
  marketBias: MarketBias,
  trendContext: TrendContext,
): "long" | "short" {
  if (marketBias.dominantSide === "long" || marketBias.dominantSide === "short") {
    return marketBias.dominantSide;
  }

  if (trendContext.emaCrossover?.direction === "bullish") return "long";
  if (trendContext.emaCrossover?.direction === "bearish") return "short";

  if (trendContext.alignment === "aligned_bullish") return "long";
  if (trendContext.alignment === "aligned_bearish") return "short";

  const layers = [
    trendContext.shortTerm.direction,
    trendContext.mediumTerm.direction,
    trendContext.higherTimeframe.direction,
  ];
  const bullishVotes = layers.filter(direction => direction === "bullish").length;
  const bearishVotes = layers.filter(direction => direction === "bearish").length;
  return bullishVotes >= bearishVotes ? "long" : "short";
}

/**
 * Compute entry levels (long/short) for a single timeframe using that
 * timeframe's own pivot, swing, and trendline structure.
 *
 * Lower timeframes produce tighter entries (closer support/resistance),
 * while higher timeframes produce wider entries from stronger structure.
 */
export function getEntryForTimeframe(
  tf: Timeframe,
  candleMap: CandleMap,
  marketBias: MarketBias,
  trendContext: TrendContext,
): TimeframeEntry | null {
  const candles = candleMap[tf];
  if (!candles || candles.length < 10) return null;

  const preferredSide = resolveEntryBias(marketBias, trendContext);

  const currentPrice = candles[candles.length - 1].close;
  const levels = calcPivot(candles);
  const minGap = currentPrice * 0.003;

  // Swings from THIS timeframe only
  const swingHighs = detectSwingHighs(candles, 3, 2);
  const swingLows = detectSwingLows(candles, 3, 2);

  // Trendlines from THIS timeframe
  const tfTrendlines = buildTrendlines(candles, tf);

  // Build local supports/resistances from swings
  const supports = swingLows
    .filter(s => s.price < currentPrice)
    .sort((a, b) => b.price - a.price); // nearest first
  const resistances = swingHighs
    .filter(s => s.price > currentPrice)
    .sort((a, b) => a.price - b.price); // nearest first

  // Trendline projections
  const lastIdx = candles.length - 1;
  for (const tl of tfTrendlines) {
    if (!tl.active || tl.x2 === tl.x1) continue;
    const slope = (tl.y2 - tl.y1) / (tl.x2 - tl.x1);
    const projected = tl.y1 + slope * (lastIdx - tl.x1);
    const projectedPoint: SwingPoint = {
      index: lastIdx,
      price: projected,
      time: candles[lastIdx]?.time ?? 0,
      confirmed: true,
      strength: tl.strength,
      significance: tl.strength,
      localRangeContext: 0,
    };
    if (projected < currentPrice) {
      supports.push(projectedPoint);
    } else {
      resistances.push(projectedPoint);
    }
  }

  const fix = (n: number) => Math.round(n * 100) / 100;

  let longEntry: number;
  let shortEntry: number;
  let target: number;
  let invalidation: number;
  let longReason: string;
  let shortReason: string;

  if (preferredSide === "long") {
    longEntry = supports.length > 0 ? supports[0].price : nearestSupport(levels, currentPrice);
    longReason = supports.length > 0 ? `swing-${tf}` : `pivot-${tf}`;

    target = resistances.length > 0 ? resistances[0].price : nearestResistance(levels, currentPrice);
    target = Math.max(target, longEntry + minGap * 3);

    shortEntry = resistances.length > 1
      ? Math.max(resistances[1].price, target + minGap * 3)
      : levels.r2;
    shortReason = resistances.length > 1 ? `swing-${tf}` : `pivot-${tf}-R2`;

    const deepSupport = supports.length > 1 ? supports[1].price : levels.s2;
    invalidation = Math.min(deepSupport, longEntry - minGap * 2);
  } else {
    shortEntry = resistances.length > 0 ? resistances[0].price : nearestResistance(levels, currentPrice);
    shortReason = resistances.length > 0 ? `swing-${tf}` : `pivot-${tf}`;

    target = supports.length > 0 ? supports[0].price : nearestSupport(levels, currentPrice);
    target = Math.min(target, shortEntry - minGap * 3);

    longEntry = supports.length > 1
      ? Math.min(supports[1].price, target - minGap * 3)
      : levels.s2;
    longReason = supports.length > 1 ? `swing-${tf}` : `pivot-${tf}-S2`;

    const deepResistance = resistances.length > 1 ? resistances[1].price : levels.r2;
    invalidation = Math.max(deepResistance, shortEntry + minGap * 2);
  }

  return {
    tf,
    longEntry: fix(longEntry),
    shortEntry: fix(shortEntry),
    target: fix(target),
    invalidation: fix(invalidation),
    pendingLong: fix(longEntry),
    pendingShort: fix(shortEntry),
    targetPrice: fix(target),
    invalidationLevel: fix(invalidation),
    preferredSide,
    qualityScore: 0,
    actionable: false,
    reasons: [],
    longReason,
    shortReason,
  };
}

function buildStepByStepSignal(
  marketBias: MarketBias,
  trendContext: TrendContext,
  primarySide: "long" | "short" | "neutral",
  status: SignalStatus,
  entryQuality: EntryQuality,
  pendingLong: number,
  pendingShort: number,
  targetPrice: number,
  invalidationLevel: number,
): string[] {
  const steps: string[] = [];
  steps.push(`Bias ${marketBias.dominantSide} ${marketBias.confidence}% | HTF agreement ${marketBias.htfAgreement ?? 50}%`);
  steps.push(`Trend ${trendContext.alignment} | pressure ${trendContext.pressure?.dominantPressureDirection ?? "neutral"}`);
  if (primarySide === "neutral") {
    steps.push("Wait for directional confirmation before taking any setup.");
  } else if (primarySide === "long") {
    steps.push(`Watch reaction near long entry ${pendingLong.toFixed(2)} and require close-back-above confirmation.`);
  } else {
    steps.push(`Watch reaction near short entry ${pendingShort.toFixed(2)} and require close-back-below confirmation.`);
  }
  steps.push(`Target ${targetPrice.toFixed(2)} | invalidation ${invalidationLevel.toFixed(2)} | status ${status}`);
  steps.push(`Setup quality ${entryQuality.qualityScore}/100 with ${entryQuality.confluences} confluences.`);
  return steps;
}

// ── Main scenario builder ─────────────────────────────────────────────────────
export function buildScenario(input: ScenarioInput): MarketScenario {
  const { candleMap, timeframeSignals, marketBias, chartTrendlines, trendContext, symbol } = input;

  const chartCandles = candleMap["1H"]!; // 1H must always be present
  const levels1H = calcPivot(chartCandles);
  const { pivot, r1, r2, s1, s2 } = levels1H;
  const currentPrice = chartCandles[chartCandles.length - 1].close;

  // ── HTF context ──────────────────────────────────────────────────────────────
  const htfSignals = timeframeSignals.filter(s =>
    s.timeframe === "4H" || s.timeframe === "6H" || s.timeframe === "8H" ||
    s.timeframe === "12H" || s.timeframe === "1D"
  );

  // HTF pivot levels for level enrichment
  const candles1D = candleMap["1D"];
  const levels1D = candles1D && candles1D.length >= 3 ? calcPivot(candles1D) : null;

  // ── Build SR cluster from all sources ────────────────────────────────────────
  const srCluster = buildSRCluster(candleMap, chartTrendlines, currentPrice);

  // ── Zone identification (1H structure) ───────────────────────────────────────
  const zone = identifyZone(currentPrice, pivot, r1, s1, s2);

  // ── Primary side from MTF consensus (not just zone) ──────────────────────────
  const primarySide = determinePrimarySide(zone, marketBias, htfSignals, trendContext);

  // "lean" direction for level computation when primary is neutral
  const leanDirection: "long" | "short" = (() => {
    if (primarySide !== "neutral") return primarySide;
    // When neutral: use zone lean for level placement only
    const zoneLong = zone === "bull2" || zone === "bull1" || zone === "trans";
    return zoneLong ? "long" : "short";
  })();

  // ── Role-based level selection ───────────────────────────────────────────────
  const minGap = currentPrice * 0.003;

  let pendingLong: number;
  let pendingShort: number;
  let targetPrice: number;
  let invalidationLevel: number;
  let longReason: string;
  let shortReason: string;
  let targetReason: string;
  let invReason: string;

  if (leanDirection === "long") {
    const bestSupport = srCluster.supports[0];
    pendingLong = bestSupport ? bestSupport.price : nearestSupport(levels1H, currentPrice);
    longReason = bestSupport ? `SR cluster: ${bestSupport.source}` : "fallback pivot S/R";

    const bestResistance = srCluster.resistances[0];
    targetPrice = bestResistance ? bestResistance.price : nearestResistance(levels1H, currentPrice);
    targetReason = bestResistance ? `SR cluster: ${bestResistance.source}` : "fallback pivot R";

    const altResistance = srCluster.resistances[1] || srCluster.resistances[0];
    pendingShort = altResistance ? Math.max(altResistance.price, targetPrice + minGap * 3) : r2;
    shortReason = altResistance ? `Alternate: ${altResistance.source}` : "fallback R2";

    const deeperSupport = srCluster.supports[1] || srCluster.supports[0];
    invalidationLevel = deeperSupport
      ? Math.min(deeperSupport.price, pendingLong - minGap * 2)
      : (levels1D ? levels1D.s1 : s2);
    invReason = "deeper SR cluster / HTF support";
  } else {
    const bestResistance = srCluster.resistances[0];
    pendingShort = bestResistance ? bestResistance.price : nearestResistance(levels1H, currentPrice);
    shortReason = bestResistance ? `SR cluster: ${bestResistance.source}` : "fallback pivot R";

    const bestSupport = srCluster.supports[0];
    targetPrice = bestSupport ? bestSupport.price : nearestSupport(levels1H, currentPrice);
    targetReason = bestSupport ? `SR cluster: ${bestSupport.source}` : "fallback pivot S";

    const altSupport = srCluster.supports[1] || srCluster.supports[0];
    pendingLong = altSupport ? Math.min(altSupport.price, targetPrice - minGap * 3) : s2;
    longReason = altSupport ? `Alternate: ${altSupport.source}` : "fallback S2";

    const deeperResistance = srCluster.resistances[1] || srCluster.resistances[0];
    invalidationLevel = deeperResistance
      ? Math.max(deeperResistance.price, pendingShort + minGap * 2)
      : (levels1D ? levels1D.r1 : r2);
    invReason = "deeper SR cluster / HTF resistance";
  }

  // ── Uniqueness guard ──────────────────────────────────────────────────────────
  if (leanDirection === "long") {
    targetPrice = Math.max(targetPrice, pendingLong + minGap * 3);
    pendingShort = Math.max(pendingShort, targetPrice + minGap * 3);
    invalidationLevel = Math.min(invalidationLevel, pendingLong - minGap * 2);
    if (Math.abs(targetPrice - pivot) < minGap) targetPrice = pivot + minGap * 3;
    if (Math.abs(pendingShort - targetPrice) < minGap) pendingShort = targetPrice + minGap * 3;
  } else {
    targetPrice = Math.min(targetPrice, pendingShort - minGap * 3);
    pendingLong = Math.min(pendingLong, targetPrice - minGap * 3);
    invalidationLevel = Math.max(invalidationLevel, pendingShort + minGap * 2);
    if (Math.abs(targetPrice - pivot) < minGap) targetPrice = pivot - minGap * 3;
    if (Math.abs(pendingShort - targetPrice) < minGap) targetPrice = pendingShort - minGap * 3;
  }

  // Round
  const fix = (n: number) => Math.round(n * 100) / 100;
  pendingLong = fix(pendingLong);
  targetPrice = fix(targetPrice);
  pendingShort = fix(pendingShort);
  invalidationLevel = fix(invalidationLevel);

  // ── Confirmation-based status ──────────────────────────────────────────────
  let status = deriveStatus(chartCandles, pendingLong, pendingShort, invalidationLevel, primarySide);

  // ── Entry quality gate — assess BOTH sides ────────────────────────────────
  const atr = approxATR(chartCandles);
  const longQuality = assessEntryQuality(
    "long", pendingLong, targetPrice, invalidationLevel,
    marketBias, trendContext, htfSignals, srCluster, atr,
  );
  const shortQuality = assessEntryQuality(
    "short", pendingShort, targetPrice, invalidationLevel,
    marketBias, trendContext, htfSignals, srCluster, atr,
  );
  const entryQuality = leanDirection === "long" ? longQuality : shortQuality;
  const alternateEntryQuality = leanDirection === "long" ? shortQuality : longQuality;

  // Downgrade pending → low_quality_setup if entry quality fails gate
  if (!entryQuality.tradeable && (status === "pending_long" || status === "pending_short")) {
    status = "low_quality_setup";
  }

  // Neutral primary → force watching regardless
  if (primarySide === "neutral" && status !== "invalidated") {
    status = "watching";
  }

  // ── Actionability determination ───────────────────────────────────────────
  const primaryScenarioIsActionable = primarySide !== "neutral" && entryQuality.tradeable;
  let primaryRejectReason: string | undefined;
  if (!primaryScenarioIsActionable) {
    if (primarySide === "neutral") {
      primaryRejectReason = `Thị trường trung lập — confidence ${marketBias.confidence}%`;
      if (marketBias.debug?.neutralReason) {
        primaryRejectReason += ` (${marketBias.debug.neutralReason})`;
      }
    } else if (entryQuality.rejectReason) {
      primaryRejectReason = entryQuality.rejectReason;
    } else {
      primaryRejectReason = "Chưa đủ điều kiện chất lượng";
    }
  }

  // ── Scenario state from MTF context ──────────────────────────────────────
  let scenarioState = deriveScenarioState(zone, primarySide, marketBias);

  // Overlay low_quality_setup state when primary is directional but too weak
  if (primarySide !== "neutral" && !entryQuality.tradeable && scenarioState !== "conflicted") {
    scenarioState = "low_quality_setup";
  }

  const fmt = (n: number) => n.toFixed(2);

  // ── Explanation lines from full context ──────────────────────────────────
  const explanationLines = buildExplanationLines(
    zone, primarySide, marketBias, htfSignals,
    pivot, targetPrice, pendingLong, pendingShort, invalidationLevel,
    status, trendContext, fmt, entryQuality, primaryScenarioIsActionable
  );
  const srZones = timeframeSignals
    .flatMap(signal => signal.srZones ?? [])
    .sort((left, right) => Math.abs(left.center - currentPrice) - Math.abs(right.center - currentPrice))
    .slice(0, 8);
  const candlePatterns = timeframeSignals
    .flatMap(signal => signal.candlePatterns ?? [])
    .sort((left, right) => right.reliability - left.reliability)
    .slice(0, 6);
  const stepByStepSignal = buildStepByStepSignal(
    marketBias,
    trendContext,
    primarySide,
    status,
    entryQuality,
    pendingLong,
    pendingShort,
    targetPrice,
    invalidationLevel,
  );

  // ── Primary + alternate scenarios ──────────────────────────────────────────
  const primaryScenario: { side: "long" | "short" | "neutral"; trigger: number; target: number; rationale: string } = primarySide === "neutral"
    ? {
        side: "neutral",
        trigger: leanDirection === "long" ? pendingLong : pendingShort,
        target: targetPrice,
        rationale: `Chưa đủ điều kiện — chờ xác nhận bias (confidence ${marketBias.confidence}%)`,
      }
    : {
        side: primarySide,
        trigger: primarySide === "long" ? pendingLong : pendingShort,
        target: targetPrice,
        rationale: primarySide === "long"
          ? t("scenario.longRationale", { entry: fmt(pendingLong), target: fmt(targetPrice), inv: fmt(invalidationLevel) })
          : t("scenario.shortRationale", { entry: fmt(pendingShort), target: fmt(targetPrice), inv: fmt(invalidationLevel) }),
      };

  const alternateSide: "long" | "short" = leanDirection === "long" ? "short" : "long";
  const alternateScenario = {
    side: alternateSide,
    trigger: alternateSide === "short" ? pendingShort : pendingLong,
    target: alternateSide === "short" ? pendingLong : pendingShort,
    rationale: alternateSide === "short"
      ? t("scenario.altShort", { trigger: fmt(pendingShort) })
      : t("scenario.altLong", { trigger: fmt(pendingLong) }),
  };

  // ── Caution text ──────────────────────────────────────────────────────────
  let cautionText: string | undefined;
  const rangeSpan = r1 - s1 || 1;
  if (Math.abs(currentPrice - pivot) < rangeSpan * 0.06) {
    cautionText = t("scenario.cautionPivot");
  }
  if (scenarioState === "conflicted") {
    cautionText = (cautionText ? cautionText + ". " : "") +
      t("scenario.cautionConflict");
  }
  // Trend alignment caution
  if (trendContext.alignment === "mixed") {
    cautionText = (cautionText ? cautionText + ". " : "") +
      t("scenario.cautionMixed");
  }
  if (primarySide === "long" && trendContext.higherTimeframe.direction === "bearish") {
    cautionText = (cautionText ? cautionText + ". " : "") +
      t("scenario.cautionLongHtf");
  }
  if (primarySide === "short" && trendContext.higherTimeframe.direction === "bullish") {
    cautionText = (cautionText ? cautionText + ". " : "") +
      t("scenario.cautionShortHtf");
  }
  // Entry quality caution (P2)
  if (!entryQuality.tradeable && entryQuality.rejectReason) {
    cautionText = (cautionText ? cautionText + ". " : "") +
      t("scenario.cautionQuality", { reason: entryQuality.rejectReason });
  }

  return {
    symbol,
    pivot: fix(pivot),
    currentPrice: fix(currentPrice),
    targetPrice,
    pendingLong,
    pendingShort,
    r1: fix(r1),
    s1: fix(s1),
    r2: fix(r2),
    s2: fix(s2),
    primaryScenario,
    alternateScenario,
    explanationLines,
    cautionText,
    invalidationLevel,
    scenarioState,
    status,
    trendlines: chartTrendlines,
    pendingLongReason: longReason,
    pendingShortReason: shortReason,
    targetReason,
    invalidationReason: invReason,
    zone,
    entryQuality,
    alternateQuality: alternateEntryQuality,
    primaryScenarioIsActionable,
    primaryRejectReason,
    entriesByTF: computeEntriesByTF(candleMap, marketBias, trendContext),
    srZones,
    candlePatterns,
    stepByStepSignal,
  };
}

/** Compute per-timeframe entries for key dashboard timeframes. */
function computeEntriesByTF(
  candleMap: CandleMap,
  marketBias: MarketBias,
  trendContext: TrendContext,
): TimeframeEntry[] {
  const entries: TimeframeEntry[] = [];
  for (const tf of ENTRY_TFS) {
    const entry = getEntryForTimeframe(tf, candleMap, marketBias, trendContext);
    if (!entry) continue;
    const preferredEntry = entry.preferredSide === "short" ? entry.shortEntry : entry.longEntry;
    const qualityScore = Math.round(Math.max(20, Math.min(95, 50 + marketBias.confidence * 0.35 + (trendContext.pressure?.pressureStrength ?? 0) * 0.15)));
    entry.qualityScore = qualityScore;
    entry.actionable = marketBias.dominantSide !== "neutral" && qualityScore >= 55;
    entry.reasons = [
      `preferred ${entry.preferredSide ?? "neutral"}`,
      `entry ${preferredEntry.toFixed(2)}`,
      `target ${entry.target.toFixed(2)}`,
      `invalidation ${entry.invalidation.toFixed(2)}`,
    ];
    entries.push(entry);
  }
  return entries;
}
