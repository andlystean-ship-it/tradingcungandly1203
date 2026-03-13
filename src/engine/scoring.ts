/**
 * scoring.ts
 * Structure-based per-timeframe signal scoring.
 */

import type {
  CandleData,
  Timeframe,
  TimeframeSignal,
  Bias,
  LevelMeta,
  CandlePattern,
  VolumeMetrics,
} from "../types";
import { calcPivot, nearestSupport, nearestResistance } from "./pivot";
import { buildTrendlines } from "./trendlines";
import { buildSRZones, nearestZone } from "./sr-cluster";
import { computeEMAState } from "./ema";
import { detectCandlePatterns } from "./candles";
import { DEFAULT_WEIGHTS, BIAS_THRESHOLDS, type ScoreBreakdown } from "./score-config";
import { deriveSwingStructureScore, type StructureState } from "./structure";

export const TF_WEIGHTS: Record<Timeframe, number> = {
  "15M": 1,
  "1H": 2,
  "2H": 3,
  "4H": 4,
  "6H": 5,
  "8H": 5,
  "12H": 6,
  "1D": 7,
  "1W": 8,
};

const HTF_PARENT: Partial<Record<Timeframe, Timeframe>> = {
  "15M": "1H",
  "1H": "4H",
  "2H": "6H",
  "4H": "12H",
  "6H": "1D",
  "8H": "1D",
  "12H": "1W",
  "1D": "1W",
};

export type HTFContext = {
  htfScores: Partial<Record<Timeframe, number>>;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function calcATR(candles: CandleData[], period = 14): number {
  const slice = candles.slice(-Math.min(period, candles.length));
  if (slice.length === 0) return 0;
  return slice.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / slice.length;
}

function scorePivot(price: number, pivot: number, r1: number, s1: number, candles: CandleData[]): number {
  const recent = candles.slice(-4);
  const atr = calcATR(candles, 14) || Math.max(Math.abs(r1 - s1), 0.0001);
  const aboveCount = recent.filter(candle => candle.close > pivot).length;
  let score = 20 + (aboveCount / Math.max(1, recent.length)) * 60;
  const last = recent[recent.length - 1];
  if (last) {
    if (last.close > pivot && last.low <= pivot + atr * 0.15) score += 10;
    if (last.close < pivot && last.high >= pivot - atr * 0.15) score -= 10;
    if (Math.abs(price - pivot) / atr < 0.2) score -= 5;
  }
  return clampScore(score);
}

function scoreSRReaction(candles: CandleData[], supportLevel: number, resistanceLevel: number): number {
  const recent = candles.slice(-6);
  if (recent.length === 0) return 50;
  const atr = calcATR(recent, recent.length) || 0.0001;
  const zone = atr * 0.5;
  let bullish = 0;
  let bearish = 0;

  for (const candle of recent) {
    if (candle.low <= supportLevel + zone && candle.close > supportLevel) bullish += 1.1;
    if (candle.close < supportLevel - zone) bearish += 1.3;
    if (candle.high >= resistanceLevel - zone && candle.close < resistanceLevel) bearish += 1.1;
    if (candle.close > resistanceLevel + zone) bullish += 1.3;
  }

  const total = bullish + bearish || 1;
  return clampScore(50 + ((bullish - bearish) / total) * 50);
}

function scoreTrendline(candles: CandleData[]): number {
  const trendlines = buildTrendlines(candles);
  if (trendlines.length === 0) return 50;
  const price = candles[candles.length - 1].close;
  const lastIdx = candles.length - 1;
  let bullish = 0;
  let bearish = 0;

  for (const line of trendlines.filter(line => line.active)) {
    if (line.x2 === line.x1) continue;
    const projected = line.y1 + ((line.y2 - line.y1) / (line.x2 - line.x1)) * (lastIdx - line.x1);
    const distancePct = Math.abs(price - projected) / Math.max(price, 0.0001);
    const proximity = Math.max(0.25, 1 - distancePct * 25);
    const weight = (line.strength / 100) * proximity;
    if (line.kind === "ascending") {
      if (price >= projected) bullish += weight;
      else bearish += weight * 1.15;
    } else {
      if (price <= projected) bearish += weight;
      else bullish += weight * 1.15;
    }
  }

  const total = bullish + bearish || 1;
  return clampScore(50 + ((bullish - bearish) / total) * 45);
}

function scorePatterns(patterns: CandlePattern[]): number {
  if (patterns.length === 0) return 50;
  let bullish = 0;
  let bearish = 0;
  for (const pattern of patterns.slice(-3)) {
    const weight = pattern.reliability / 100;
    if (pattern.direction === "bullish") bullish += weight;
    if (pattern.direction === "bearish") bearish += weight;
  }
  const total = bullish + bearish || 1;
  return clampScore(50 + ((bullish - bearish) / total) * 45);
}

function scoreMomentum(candles: CandleData[]): number {
  const slice = candles.slice(-8);
  if (slice.length === 0) return 50;
  let bullish = 0;
  let bearish = 0;
  for (let index = 0; index < slice.length; index++) {
    const candle = slice[index];
    const weight = (index + 1) / slice.length;
    const range = Math.max(candle.high - candle.low, 0.0001);
    const body = candle.close - candle.open;
    const closePosition = (candle.close - candle.low) / range;
    if (body > 0) bullish += (body / range + closePosition * 0.5) * weight;
    if (body < 0) bearish += (Math.abs(body) / range + (1 - closePosition) * 0.5) * weight;
  }
  const total = bullish + bearish || 1;
  return clampScore(50 + ((bullish - bearish) / total) * 50);
}

function scoreVolatility(candles: CandleData[]): number {
  const recentATR = calcATR(candles.slice(-5), 5);
  const longATR = calcATR(candles.slice(-20), 20);
  if (!recentATR || !longATR) return 50;
  const ratio = recentATR / longATR;
  if (ratio > 1.8) return 35;
  if (ratio < 0.6) return 55;
  return 50;
}

function averageVolume(candles: CandleData[], period: number): number {
  const volumes = candles
    .slice(-Math.min(period, candles.length))
    .map((candle) => candle.volume)
    .filter((volume): volume is number => typeof volume === "number" && Number.isFinite(volume));
  if (volumes.length === 0) return 0;
  return volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length;
}

function scoreVolume(candles: CandleData[]): VolumeMetrics {
  const latest = candles[candles.length - 1];
  const currentVolume = latest?.volume;
  if (typeof currentVolume !== "number" || !Number.isFinite(currentVolume)) {
    return {
      currentVolume: 0,
      averageVolume20: 0,
      averageVolume50: 0,
      volumeRatio: 1,
      volumeState: "neutral",
      directionalBias: "neutral",
      score: 50,
      confirmsMove: false,
    };
  }

  const averageVolume20 = averageVolume(candles, 20) || currentVolume;
  const averageVolume50 = averageVolume(candles, 50) || averageVolume20;
  const volumeRatio = currentVolume / Math.max(averageVolume20, 0.0001);
  const volumeState = volumeRatio >= 1.15
    ? "expanding"
    : volumeRatio <= 0.85
      ? "contracting"
      : "neutral";

  const recent = candles.slice(-5);
  let weightedPressure = 0;
  let totalWeight = 0;
  recent.forEach((candle, index) => {
    const weight = (index + 1) / recent.length;
    const range = Math.max(candle.high - candle.low, 0.0001);
    const body = candle.close - candle.open;
    weightedPressure += (body / range) * weight;
    totalWeight += weight;
  });

  const normalizedPressure = totalWeight > 0
    ? Math.max(-1, Math.min(1, weightedPressure / totalWeight))
    : 0;
  const directionalBias: Bias = normalizedPressure > 0.12
    ? "bullish"
    : normalizedPressure < -0.12
      ? "bearish"
      : "neutral";

  let score = 50 + normalizedPressure * 22;
  if (volumeState === "expanding") {
    score += normalizedPressure * 18 + Math.min(12, Math.max(0, (volumeRatio - 1) * 18));
  } else if (volumeState === "contracting") {
    score += normalizedPressure * 8 - Math.min(10, Math.max(0, (1 - volumeRatio) * 30));
  }

  return {
    currentVolume: Math.round(currentVolume * 100) / 100,
    averageVolume20: Math.round(averageVolume20 * 100) / 100,
    averageVolume50: Math.round(averageVolume50 * 100) / 100,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    volumeState,
    directionalBias,
    score: Math.round(clampScore(score)),
    confirmsMove: directionalBias !== "neutral" && volumeRatio >= 1.05,
  };
}

function scoreHTFAlignment(timeframe: Timeframe, htfContext?: HTFContext): number {
  const parent = HTF_PARENT[timeframe];
  if (!parent || !htfContext) return 50;
  return htfContext.htfScores[parent] ?? 50;
}

function deriveReasoningTags(
  structureState: StructureState,
  pivotScore: number,
  trendlineScore: number,
  emaScore: number,
  patterns: CandlePattern[],
  volumeMetrics: VolumeMetrics,
): string[] {
  const tags: string[] = [];
  if (structureState === "bullish") tags.push("HH/HL structure");
  if (structureState === "bearish") tags.push("LH/LL structure");
  if (pivotScore >= 60) tags.push("above pivot");
  if (pivotScore <= 40) tags.push("below pivot");
  if (trendlineScore >= 60) tags.push("active support respected");
  if (trendlineScore <= 40) tags.push("active resistance respected");
  if (emaScore >= 60) tags.push("EMA trend bullish");
  if (emaScore <= 40) tags.push("EMA trend bearish");
  if (volumeMetrics.volumeState === "expanding" && volumeMetrics.directionalBias === "bullish") tags.push("bullish volume expansion");
  if (volumeMetrics.volumeState === "expanding" && volumeMetrics.directionalBias === "bearish") tags.push("bearish volume expansion");
  if (volumeMetrics.volumeState === "contracting") tags.push("volume contraction");
  for (const pattern of patterns.slice(-2)) tags.push(pattern.name);
  return tags;
}

export function scoreTimeframe(
  timeframe: Timeframe,
  candles: CandleData[],
  htfContext?: HTFContext,
): TimeframeSignal {
  const levels = calcPivot(candles);
  const currentPrice = candles[candles.length - 1].close;
  const trendlines = buildTrendlines(candles, timeframe);
  const zones = buildSRZones({ [timeframe]: candles }, trendlines, currentPrice);
  const patterns = detectCandlePatterns(candles, timeframe);
  const emaState = computeEMAState(candles);
  const structure = deriveSwingStructureScore(candles);

  const supportZone = nearestZone(zones, currentPrice, "support");
  const resistanceZone = nearestZone(zones, currentPrice, "resistance");
  const bearishLevel = supportZone?.center ?? nearestSupport(levels, currentPrice);
  const bullishLevel = resistanceZone?.center ?? nearestResistance(levels, currentPrice);

  const sStructure = structure.score;
  const sPivot = scorePivot(currentPrice, levels.pivot, levels.r1, levels.s1, candles);
  const sSrReaction = scoreSRReaction(candles, bearishLevel, bullishLevel);
  const sTrendline = scoreTrendline(candles);
  const sEma = emaState.direction === "bullish" ? 80 : emaState.direction === "bearish" ? 20 : 50;
  const sPattern = scorePatterns(patterns);
  const sMomentum = scoreMomentum(candles);
  const sVolatility = scoreVolatility(candles);
  const sHtf = scoreHTFAlignment(timeframe, htfContext);
  const volumeMetrics = scoreVolume(candles);
  const sVolume = volumeMetrics.score;

  const w = DEFAULT_WEIGHTS;
  const rawScore =
    sStructure * w.structure +
    sPivot * w.pivot +
    sSrReaction * w.srReaction +
    sTrendline * w.trendline +
    sEma * w.ema +
    sPattern * w.candlePattern +
    sMomentum * w.momentum +
    sVolatility * w.volatility +
    sHtf * w.htfAlignment +
    sVolume * w.volume;

  const directionalBoost = (sMomentum - 50) * 0.18 + (sEma - 50) * 0.16 + (sTrendline - 50) * 0.12;
  const bullishScore = Math.round(clampScore(rawScore + directionalBoost));
  const bearishScore = 100 - bullishScore;
  const bias: Bias = bullishScore > BIAS_THRESHOLDS.bullish ? "bullish" : bullishScore < BIAS_THRESHOLDS.bearish ? "bearish" : "neutral";

  const scoreBreakdown: ScoreBreakdown = {
    structure: Math.round(sStructure),
    pivot: Math.round(sPivot),
    srReaction: Math.round(sSrReaction),
    trendline: Math.round(sTrendline),
    ema: Math.round(sEma),
    candlePattern: Math.round(sPattern),
    momentum: Math.round(sMomentum),
    volatility: Math.round(sVolatility),
    htfAlignment: Math.round(sHtf),
    volume: Math.round(sVolume),
    position: Math.round(sStructure),
    pivotReclaim: Math.round(sPivot),
    support: Math.round(sSrReaction),
    resistance: Math.round(100 - sSrReaction),
    breakRetest: Math.round(sPattern),
    total: bullishScore,
  };

  const bullishLevelMeta: LevelMeta = {
    selectedFrom: resistanceZone ? `zone-${timeframe}` : `pivot-${timeframe}`,
    selectionReason: resistanceZone ? `nearest resistance zone from ${resistanceZone.sourceTags.join(", ")}` : "fallback to pivot resistance",
    levelQuality: resistanceZone?.strengthScore ?? 35,
  };

  const bearishLevelMeta: LevelMeta = {
    selectedFrom: supportZone ? `zone-${timeframe}` : `pivot-${timeframe}`,
    selectionReason: supportZone ? `nearest support zone from ${supportZone.sourceTags.join(", ")}` : "fallback to pivot support",
    levelQuality: supportZone?.strengthScore ?? 35,
  };

  return {
    timeframe,
    bullishLevel: Math.round(bullishLevel * 100) / 100,
    bearishLevel: Math.round(bearishLevel * 100) / 100,
    bullishScore,
    bearishScore,
    bias,
    strength: TF_WEIGHTS[timeframe],
    scoreBreakdown,
    bullishLevelMeta,
    bearishLevelMeta,
    reasoningTags: deriveReasoningTags(structure.state, sPivot, sTrendline, sEma, patterns, volumeMetrics),
    emaState,
    volumeMetrics,
    candlePatterns: patterns.slice(-3),
    srZones: zones.slice(0, 6),
  };
}
