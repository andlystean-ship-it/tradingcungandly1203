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
} from "../types";
import { calcPivot, nearestSupport, nearestResistance } from "./pivot";
import { detectSwingHighs, detectSwingLows } from "./swings";

// ── Types ─────────────────────────────────────────────────────────────────────

type CandleMap = Record<Timeframe, CandleData[]>;

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
): "long" | "short" {
  const htfBullish = htfSignals.filter(s => s.bias === "bullish").length;
  const htfBearish = htfSignals.filter(s => s.bias === "bearish").length;

  // Zone-based default
  const zoneLong = zone === "bull2" || zone === "bull1" || zone === "trans";

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
  }

  return zoneLong ? "long" : "short";
}

// ── Confirmation-based signal status (P6) ──────────────────────────────────────
function deriveStatus(
  candles: CandleData[],
  pendingLong: number,
  pendingShort: number,
  invalidationLevel: number,
  primarySide: "long" | "short"
): SignalStatus {
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
  primarySide: "long" | "short",
  marketBias: MarketBias
): ScenarioState {
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
  primarySide: "long" | "short",
  marketBias: MarketBias,
  htfSignals: TimeframeSignal[],
  pivot: number,
  targetPrice: number,
  pendingLong: number,
  pendingShort: number,
  invalidationLevel: number,
  status: SignalStatus,
  trendContext: TrendContext,
  fmt: (n: number) => string
): string[] {
  const biasDir = marketBias.dominantSide === "long" ? "TĂNG" : "GIẢM";
  const lines: string[] = [];

  lines.push(
    `Đa khung: ${biasDir} ${marketBias.bullishPercent}% (confidence ${marketBias.confidence}%) — ` +
    `HTF ${htfSignals.map(s => `${s.timeframe}:${s.bias === "bullish" ? "↑" : s.bias === "bearish" ? "↓" : "—"}`).join(" ")}`
  );

  const zoneVi: Record<Zone, string> = {
    bull2: "trên R1, xu hướng tăng mạnh",
    bull1: "trên Pivot, xu hướng tăng",
    trans: "vùng chuyển tiếp, chờ xác nhận",
    bear1: "dưới S1, xu hướng giảm",
    bear2: "dưới S2, áp lực bán lớn",
  };
  lines.push(`Zone: ${zone} — ${zoneVi[zone]}. Pivot ${fmt(pivot)}`);

  // ── Trend context line ─────────────────────────────────────────────────────
  const alignVi: Record<TrendAlignment, string> = {
    aligned_bullish: "xu hướng đồng thuận TĂNG",
    aligned_bearish: "xu hướng đồng thuận GIẢM",
    mixed: "xu hướng trái chiều",
    neutral: "chưa có xu hướng rõ",
  };
  const trendLine = `Trend: ${alignVi[trendContext.alignment]}`;
  const trendParts: string[] = [trendLine];

  if (trendContext.shortTerm.dominantLine) {
    const dl = trendContext.shortTerm.dominantLine;
    trendParts.push(
      dl.kind === "ascending"
        ? "trendline hỗ trợ tăng đang active"
        : "trendline kháng cự giảm đang active"
    );
  }
  if (trendContext.higherTimeframe.direction !== "neutral") {
    trendParts.push(
      trendContext.higherTimeframe.direction === "bullish"
        ? "HTF trend tăng hỗ trợ"
        : "HTF trend giảm gây áp lực"
    );
  }
  lines.push(trendParts.join(" — "));

  if (primarySide === "long") {
    lines.push(`Kịch bản chính: LONG entry ${fmt(pendingLong)} → target ${fmt(targetPrice)}`);
    if (trendContext.higherTimeframe.direction === "bearish") {
      lines.push("⚠ HTF trend giảm — long chỉ mang tính chiến thuật ngắn hạn");
    }
  } else {
    lines.push(`Kịch bản chính: SHORT entry ${fmt(pendingShort)} → target ${fmt(targetPrice)}`);
    if (trendContext.higherTimeframe.direction === "bullish") {
      lines.push("⚠ HTF trend tăng — short chỉ mang tính chiến thuật ngắn hạn");
    }
  }

  const statusVi: Record<SignalStatus, string> = {
    idle: "chờ",
    watching: "theo dõi",
    pending_long: "chờ xác nhận LONG",
    pending_short: "chờ xác nhận SHORT",
    active_long: "đang LONG",
    active_short: "đang SHORT",
    invalidated: "BỊ HỦY",
    stale: "hết hạn",
  };
  lines.push(
    `Invalidation: ${fmt(invalidationLevel)} | Trạng thái: ${statusVi[status]}`
  );

  return lines;
}

// ── Main scenario builder ─────────────────────────────────────────────────────
export function buildScenario(input: ScenarioInput): MarketScenario {
  const { candleMap, timeframeSignals, marketBias, chartTrendlines, trendContext, symbol } = input;

  const chartCandles = candleMap["1H"];
  const levels1H = calcPivot(chartCandles);
  const { pivot, r1, r2, s1, s2 } = levels1H;
  const currentPrice = chartCandles[chartCandles.length - 1].close;

  // ── HTF context ──────────────────────────────────────────────────────────────
  const htfSignals = timeframeSignals.filter(s =>
    s.timeframe === "4H" || s.timeframe === "6H" || s.timeframe === "8H" ||
    s.timeframe === "12H" || s.timeframe === "1D"
  );

  // HTF pivot levels for level enrichment
  const levels1D = candleMap["1D"]?.length >= 3 ? calcPivot(candleMap["1D"]) : null;

  // ── Build SR cluster from all sources ────────────────────────────────────────
  const srCluster = buildSRCluster(candleMap, chartTrendlines, currentPrice);

  // ── Zone identification (1H structure) ───────────────────────────────────────
  const zone = identifyZone(currentPrice, pivot, r1, s1, s2);

  // ── Primary side from MTF consensus (not just zone) ──────────────────────────
  const primarySide = determinePrimarySide(zone, marketBias, htfSignals, trendContext);

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

  if (primarySide === "long") {
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
  if (primarySide === "long") {
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
  const status = deriveStatus(chartCandles, pendingLong, pendingShort, invalidationLevel, primarySide);

  // ── Scenario state from MTF context ──────────────────────────────────────
  const scenarioState = deriveScenarioState(zone, primarySide, marketBias);

  const fmt = (n: number) => n.toFixed(2);

  // ── Explanation lines from full context ──────────────────────────────────
  const explanationLines = buildExplanationLines(
    zone, primarySide, marketBias, htfSignals,
    pivot, targetPrice, pendingLong, pendingShort, invalidationLevel,
    status, trendContext, fmt
  );

  // ── Primary + alternate scenarios ──────────────────────────────────────────
  const primaryScenario = {
    side: primarySide,
    trigger: primarySide === "long" ? pendingLong : pendingShort,
    target: targetPrice,
    rationale: primarySide === "long"
      ? `Long từ ${fmt(pendingLong)} → target ${fmt(targetPrice)}, inv ${fmt(invalidationLevel)}`
      : `Short từ ${fmt(pendingShort)} → target ${fmt(targetPrice)}, inv ${fmt(invalidationLevel)}`,
  };

  const alternateSide: "long" | "short" = primarySide === "long" ? "short" : "long";
  const alternateScenario = {
    side: alternateSide,
    trigger: alternateSide === "short" ? pendingShort : pendingLong,
    target: alternateSide === "short" ? pendingLong : pendingShort,
    rationale: alternateSide === "short"
      ? `Alternate Short nếu giá bác ${fmt(pendingShort)} — không phải kịch bản chính`
      : `Alternate Long nếu giá về ${fmt(pendingLong)} và xác nhận hỗ trợ`,
  };

  // ── Caution text ──────────────────────────────────────────────────────────
  let cautionText: string | undefined;
  const rangeSpan = r1 - s1 || 1;
  if (Math.abs(currentPrice - pivot) < rangeSpan * 0.06) {
    cautionText = "Giá sát Pivot — chờ xác nhận phá vỡ trước khi entry";
  }
  if (scenarioState === "conflicted") {
    cautionText = (cautionText ? cautionText + ". " : "") +
      "⚠ LTF và HTF đang xung đột — giảm size hoặc chờ confluence";
  }
  // Trend alignment caution
  if (trendContext.alignment === "mixed") {
    cautionText = (cautionText ? cautionText + ". " : "") +
      "⚠ Xu hướng trái chiều giữa các khung — confidence giảm";
  }
  if (primarySide === "long" && trendContext.higherTimeframe.direction === "bearish") {
    cautionText = (cautionText ? cautionText + ". " : "") +
      "HTF trend giảm — kịch bản long chỉ mang tính chiến thuật";
  }
  if (primarySide === "short" && trendContext.higherTimeframe.direction === "bullish") {
    cautionText = (cautionText ? cautionText + ". " : "") +
      "HTF trend tăng — kịch bản short chỉ mang tính chiến thuật";
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
  };
}
