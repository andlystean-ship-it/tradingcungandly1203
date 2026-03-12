import type { CandleMap, SRZone, Timeframe, Trendline } from "../types";
import { calcPivot } from "./pivot";
import { detectSwingHighs, detectSwingLows } from "./swings";

type RawLevel = {
  price: number;
  timeframe: Timeframe | "multi";
  kind: "support" | "resistance";
  tag: string;
  strength: number;
};

const TF_WEIGHTS: Record<Timeframe, number> = {
  "15M": 20,
  "1H": 35,
  "2H": 45,
  "4H": 60,
  "6H": 68,
  "8H": 74,
  "12H": 85,
  "1D": 95,
  "1W": 100,
};

export function buildSRZones(
  candleMap: CandleMap,
  trendlines: Trendline[],
  currentPrice: number,
): SRZone[] {
  const levels: RawLevel[] = [];
  const timeframes = Object.keys(candleMap) as Timeframe[];

  for (const tf of timeframes) {
    const candles = candleMap[tf];
    if (!candles || candles.length < 6) continue;
    const weight = TF_WEIGHTS[tf] ?? 30;
    const pivots = calcPivot(candles);
    for (const [label, price] of Object.entries(pivots)) {
      if (!price) continue;
      levels.push({
        price,
        timeframe: tf,
        kind: price <= currentPrice ? "support" : "resistance",
        tag: `pivot-${tf}-${label}`,
        strength: weight * (label === "pivot" ? 0.7 : 1),
      });
    }

    for (const swing of detectSwingHighs(candles, 3, 2)) {
      levels.push({ price: swing.price, timeframe: tf, kind: "resistance", tag: `swing-high-${tf}`, strength: weight * (swing.significance / 100) });
    }
    for (const swing of detectSwingLows(candles, 3, 2)) {
      levels.push({ price: swing.price, timeframe: tf, kind: "support", tag: `swing-low-${tf}`, strength: weight * (swing.significance / 100) });
    }
  }

  for (const line of trendlines.filter(line => line.active)) {
    const candles = candleMap[line.sourceTimeframe as Timeframe] ?? candleMap["1H"];
    if (!candles || candles.length === 0 || line.x2 === line.x1) continue;
    const lastIdx = candles.length - 1;
    const projected = line.y1 + ((line.y2 - line.y1) / (line.x2 - line.x1)) * (lastIdx - line.x1);
    levels.push({
      price: projected,
      timeframe: (line.sourceTimeframe as Timeframe) ?? "1H",
      kind: projected <= currentPrice ? "support" : "resistance",
      tag: `trendline-${line.kind}-${line.sourceTimeframe ?? "1H"}`,
      strength: line.strength,
    });
  }

  const sorted = levels.sort((a, b) => a.price - b.price);
  const zones: SRZone[] = [];
  for (const level of sorted) {
    const tolerance = Math.max(level.price * 0.003, 0.01);
    const existing = zones.find(zone => zone.kind === level.kind && Math.abs(zone.center - level.price) <= tolerance);
    if (existing) {
      const mergedStrength = existing.strengthScore + level.strength;
      existing.center = (existing.center * existing.strengthScore + level.price * level.strength) / Math.max(1, mergedStrength);
      existing.top = Math.max(existing.top, level.price + tolerance * 0.5);
      existing.bottom = Math.min(existing.bottom, level.price - tolerance * 0.5);
      existing.strengthScore = Math.min(100, Math.round(mergedStrength));
      if (!existing.sourceTags.includes(level.tag)) existing.sourceTags.push(level.tag);
      if (existing.timeframe !== level.timeframe) existing.timeframe = "multi";
    } else {
      zones.push({
        id: `${level.kind}-${level.timeframe}-${Math.round(level.price * 100)}`,
        timeframe: level.timeframe,
        kind: level.kind,
        center: level.price,
        top: level.price + tolerance * 0.5,
        bottom: level.price - tolerance * 0.5,
        sourceTags: [level.tag],
        strengthScore: Math.min(100, Math.round(level.strength)),
      });
    }
  }

  return zones
    .filter(zone => zone.strengthScore >= 20)
    .sort((a, b) => Math.abs(a.center - currentPrice) - Math.abs(b.center - currentPrice));
}

export function nearestZone(zones: SRZone[], price: number, kind: "support" | "resistance"): SRZone | null {
  const candidates = zones.filter(zone => zone.kind === kind && (kind === "support" ? zone.center <= price : zone.center >= price));
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => Math.abs(a.center - price) - Math.abs(b.center - price))[0] ?? null;
}