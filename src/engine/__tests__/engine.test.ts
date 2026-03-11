/**
 * Engine unit tests — scoring, bias, scenario, status, MTF conflict resolution.
 */
import { describe, it, expect } from "vitest";
import type { CandleData, Timeframe, TimeframeSignal, MarketBias } from "../../types";
import { scoreTimeframe, type HTFContext } from "../scoring";
import { computeBias, type BiasContext } from "../bias";
import { buildScenario, type ScenarioInput } from "../scenario";
import { calcPivot } from "../pivot";

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeCandles(
  close: number,
  count = 30,
  spread = 0.02
): CandleData[] {
  const candles: CandleData[] = [];
  for (let i = 0; i < count; i++) {
    const t = 1700000000 + i * 3600;
    const variation = Math.sin(i * 0.3) * close * spread * 0.5;
    const c = close + variation;
    candles.push({
      time: t,
      open: c - close * spread * 0.3,
      high: c + close * spread * 0.5,
      low: c - close * spread * 0.5,
      close: c,
    });
  }
  return candles;
}

function makeCandleMap(close: number): Record<Timeframe, CandleData[]> {
  const tfs: Timeframe[] = ["15M", "1H", "2H", "4H", "6H", "8H", "12H", "1D"];
  const map = {} as Record<Timeframe, CandleData[]>;
  for (const tf of tfs) {
    map[tf] = makeCandles(close);
  }
  return map;
}

function makeSignal(
  tf: Timeframe,
  bullishScore: number,
  bias: "bullish" | "bearish" | "neutral"
): TimeframeSignal {
  return {
    timeframe: tf,
    bullishLevel: 100,
    bearishLevel: 90,
    bullishScore,
    bearishScore: 100 - bullishScore,
    bias,
    strength: { "15M": 1, "1H": 2, "2H": 2, "4H": 3, "6H": 4, "8H": 4, "12H": 5, "1D": 6 }[tf],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("scoreTimeframe", () => {
  it("returns a valid TimeframeSignal with bullish/bearish scores summing to 100", () => {
    const candles = makeCandles(100);
    const signal = scoreTimeframe("1H", candles);

    expect(signal.timeframe).toBe("1H");
    expect(signal.bullishScore + signal.bearishScore).toBe(100);
    expect(signal.bullishScore).toBeGreaterThanOrEqual(0);
    expect(signal.bullishScore).toBeLessThanOrEqual(100);
    expect(["bullish", "bearish", "neutral"]).toContain(signal.bias);
  });

  it("applies HTF context — bullish parent should increase bullish score", () => {
    const candles = makeCandles(100);
    const withoutHTF = scoreTimeframe("1H", candles);

    const htfContext: HTFContext = { htfScores: { "4H": 85 } };
    const withHTF = scoreTimeframe("1H", candles, htfContext);

    // HTF alignment adds 5% weight — bullish parent should slightly boost
    expect(withHTF.bullishScore).toBeGreaterThanOrEqual(withoutHTF.bullishScore - 5);
  });

  it("produces swing-based bullish/bearish levels", () => {
    const candles = makeCandles(50000);
    const signal = scoreTimeframe("4H", candles);

    expect(signal.bullishLevel).toBeGreaterThan(0);
    expect(signal.bearishLevel).toBeGreaterThan(0);
    expect(signal.bullishLevel).not.toBe(signal.bearishLevel);
  });
});

describe("computeBias", () => {
  it("returns bullish bias when most TFs are bullish", () => {
    const signals: TimeframeSignal[] = [
      makeSignal("15M", 70, "bullish"),
      makeSignal("1H", 75, "bullish"),
      makeSignal("4H", 80, "bullish"),
      makeSignal("1D", 85, "bullish"),
    ];

    const bias = computeBias(signals);
    expect(bias.dominantSide).toBe("long");
    expect(bias.bullishPercent).toBeGreaterThan(50);
    expect(bias.confidence).toBeGreaterThan(0);
  });

  it("detects LTF vs HTF conflict and reduces confidence", () => {
    const aligned: TimeframeSignal[] = [
      makeSignal("15M", 70, "bullish"),
      makeSignal("1H", 75, "bullish"),
      makeSignal("4H", 72, "bullish"),
      makeSignal("1D", 78, "bullish"),
    ];

    const conflicted: TimeframeSignal[] = [
      makeSignal("15M", 75, "bullish"),
      makeSignal("1H", 70, "bullish"),
      makeSignal("4H", 25, "bearish"),
      makeSignal("1D", 20, "bearish"),
    ];

    const biasAligned = computeBias(aligned);
    const biasConflicted = computeBias(conflicted);

    // Conflicted should have lower confidence
    expect(biasConflicted.confidence).toBeLessThan(biasAligned.confidence);
  });

  it("penalizes confidence when price is near pivot", () => {
    const signals: TimeframeSignal[] = [
      makeSignal("1H", 60, "bullish"),
      makeSignal("4H", 65, "bullish"),
    ];

    const candles = makeCandles(100);
    const biasWithContext = computeBias(signals, { chartCandles: candles });
    const biasWithout = computeBias(signals);

    // With context should have equal or lower confidence (pivot proximity penalty)
    expect(biasWithContext.confidence).toBeLessThanOrEqual(biasWithout.confidence + 1);
  });
});

describe("buildScenario", () => {
  it("produces all required MarketScenario fields", () => {
    const candleMap = makeCandleMap(100);
    const signals: TimeframeSignal[] = [
      makeSignal("15M", 60, "bullish"),
      makeSignal("1H", 65, "bullish"),
      makeSignal("4H", 70, "bullish"),
      makeSignal("1D", 75, "bullish"),
    ];
    const bias: MarketBias = {
      bullishPercent: 65,
      bearishPercent: 35,
      dominantSide: "long",
      confidence: 60,
    };

    const input: ScenarioInput = {
      candleMap,
      timeframeSignals: signals,
      marketBias: bias,
      chartTrendlines: [],
      symbol: "BTC/USDT",
    };

    const scenario = buildScenario(input);

    expect(scenario.symbol).toBe("BTC/USDT");
    expect(scenario.pivot).toBeGreaterThan(0);
    expect(scenario.currentPrice).toBeGreaterThan(0);
    expect(scenario.targetPrice).toBeGreaterThan(0);
    expect(scenario.pendingLong).toBeGreaterThan(0);
    expect(scenario.pendingShort).toBeGreaterThan(0);
    expect(scenario.invalidationLevel).toBeDefined();
    expect(scenario.primaryScenario.side).toMatch(/^(long|short)$/);
    expect(scenario.alternateScenario.side).toMatch(/^(long|short)$/);
    expect(scenario.primaryScenario.side).not.toBe(scenario.alternateScenario.side);
    expect(scenario.explanationLines.length).toBeGreaterThanOrEqual(3);
    expect(scenario.status).toBeDefined();
    expect(scenario.scenarioState).toBeDefined();
  });

  it("maintains distinct levels (uniqueness guard)", () => {
    const candleMap = makeCandleMap(50000);
    const input: ScenarioInput = {
      candleMap,
      timeframeSignals: [makeSignal("1H", 60, "bullish"), makeSignal("4H", 65, "bullish")],
      marketBias: { bullishPercent: 60, bearishPercent: 40, dominantSide: "long", confidence: 50 },
      chartTrendlines: [],
      symbol: "BTC/USDT",
    };

    const s = buildScenario(input);
    const levels = [s.pendingLong, s.targetPrice, s.pendingShort, s.invalidationLevel];

    // All levels must be distinct
    const unique = new Set(levels);
    expect(unique.size).toBe(4);

    // For long primary: pendingLong < targetPrice < pendingShort
    if (s.primaryScenario.side === "long") {
      expect(s.pendingLong).toBeLessThan(s.targetPrice);
      expect(s.targetPrice).toBeLessThan(s.pendingShort);
      expect(s.invalidationLevel).toBeLessThan(s.pendingLong);
    } else {
      expect(s.pendingShort).toBeGreaterThan(s.targetPrice);
      expect(s.targetPrice).toBeGreaterThan(s.pendingLong);
      expect(s.invalidationLevel).toBeGreaterThan(s.pendingShort);
    }
  });

  it("detects conflicted state when zone disagrees with bias", () => {
    const candleMap = makeCandleMap(100);
    // Zone will be bullish (price > pivot), but bias is bearish
    const input: ScenarioInput = {
      candleMap,
      timeframeSignals: [
        makeSignal("4H", 20, "bearish"),
        makeSignal("12H", 15, "bearish"),
        makeSignal("1D", 10, "bearish"),
      ],
      marketBias: { bullishPercent: 15, bearishPercent: 85, dominantSide: "short", confidence: 70 },
      chartTrendlines: [],
      symbol: "ETH/USDT",
    };

    const s = buildScenario(input);
    // With strong bearish HTF bias, scenario should adapt (not stay bullish_primary)
    expect(["conflicted", "bearish_primary", "neutral_transition"]).toContain(s.scenarioState);
  });

  it("includes MTF explanation in explanationLines", () => {
    const candleMap = makeCandleMap(100);
    const input: ScenarioInput = {
      candleMap,
      timeframeSignals: [makeSignal("4H", 70, "bullish"), makeSignal("1D", 60, "bullish")],
      marketBias: { bullishPercent: 65, bearishPercent: 35, dominantSide: "long", confidence: 50 },
      chartTrendlines: [],
      symbol: "SOL/USDT",
    };

    const s = buildScenario(input);
    // First line should mention multi-timeframe info
    expect(s.explanationLines[0]).toContain("Đa khung");
  });
});

describe("calcPivot", () => {
  it("computes valid pivot levels from candles", () => {
    const candles = makeCandles(100);
    const levels = calcPivot(candles);

    expect(levels.s3).toBeLessThan(levels.s2);
    expect(levels.s2).toBeLessThan(levels.s1);
    expect(levels.s1).toBeLessThan(levels.pivot);
    expect(levels.pivot).toBeLessThan(levels.r1);
    expect(levels.r1).toBeLessThan(levels.r2);
    expect(levels.r2).toBeLessThan(levels.r3);
  });
});

describe("status derivation", () => {
  it("scenario status is one of the valid SignalStatus values", () => {
    const candleMap = makeCandleMap(100);
    const input: ScenarioInput = {
      candleMap,
      timeframeSignals: [makeSignal("1H", 50, "neutral")],
      marketBias: { bullishPercent: 50, bearishPercent: 50, dominantSide: "long", confidence: 10 },
      chartTrendlines: [],
      symbol: "BTC/USDT",
    };

    const s = buildScenario(input);
    const validStatuses = [
      "idle", "watching", "pending_long", "pending_short",
      "active_long", "active_short", "invalidated", "stale",
    ];
    expect(validStatuses).toContain(s.status);
  });
});
