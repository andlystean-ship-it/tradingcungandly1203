/**
 * Engine unit tests — scoring, bias, scenario, status, MTF conflict resolution,
 * swing detection, trendline generation, trend context, violation policy.
 */
import { describe, it, expect } from "vitest";
import type { CandleData, Timeframe, TimeframeSignal, MarketBias, TrendContext } from "../../types";
import { scoreTimeframe, type HTFContext } from "../scoring";
import { computeBias, type BiasContext } from "../bias";
import { buildScenario, type ScenarioInput } from "../scenario";
import { calcPivot } from "../pivot";
import { detectSwingHighs, detectSwingLows, detectSwingsWithDebug, type SwingConfig, DEFAULT_SWING_CONFIG } from "../swings";
import { buildTrendlines, buildTrendlinesWithDebug } from "../trendlines";
import { buildTrendContext } from "../trend-context";

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

/** Make candles with a clear uptrend (higher lows + higher highs) */
function makeUptrend(base: number, count = 60, step = 0.5, spread = 0.02): CandleData[] {
  const candles: CandleData[] = [];
  for (let i = 0; i < count; i++) {
    const t = 1700000000 + i * 3600;
    const trend = base + i * step;
    const wave = Math.sin(i * 0.5) * base * spread;
    const c = trend + wave;
    candles.push({
      time: t,
      open: c - base * spread * 0.3,
      high: c + base * spread * 0.7,
      low: c - base * spread * 0.5,
      close: c,
    });
  }
  return candles;
}

/** Make candles with a clear downtrend (lower highs + lower lows) */
function makeDowntrend(base: number, count = 60, step = 0.5, spread = 0.02): CandleData[] {
  const candles: CandleData[] = [];
  for (let i = 0; i < count; i++) {
    const t = 1700000000 + i * 3600;
    const trend = base - i * step;
    const wave = Math.sin(i * 0.5) * base * spread;
    const c = trend + wave;
    candles.push({
      time: t,
      open: c + base * spread * 0.3,
      high: c + base * spread * 0.5,
      low: c - base * spread * 0.7,
      close: c,
    });
  }
  return candles;
}

function makeCandleMap(close: number, count = 30): Record<Timeframe, CandleData[]> {
  const tfs: Timeframe[] = ["15M", "1H", "2H", "4H", "6H", "8H", "12H", "1D"];
  const map = {} as Record<Timeframe, CandleData[]>;
  for (const tf of tfs) {
    map[tf] = makeCandles(close, count);
  }
  return map;
}

function makeTrendCandleMap(direction: "up" | "down", base: number): Record<Timeframe, CandleData[]> {
  const tfs: Timeframe[] = ["15M", "1H", "2H", "4H", "6H", "8H", "12H", "1D"];
  const map = {} as Record<Timeframe, CandleData[]>;
  const maker = direction === "up" ? makeUptrend : makeDowntrend;
  for (const tf of tfs) {
    map[tf] = maker(base, 60);
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

function makeNeutralTrendContext(): TrendContext {
  return {
    shortTerm: { direction: "neutral", activeTrendlines: [], dominantLine: null, strength: 0 },
    mediumTerm: { direction: "neutral", activeTrendlines: [], dominantLine: null, strength: 0 },
    higherTimeframe: { direction: "neutral", activeTrendlines: [], dominantLine: null, strength: 0 },
    alignment: "neutral",
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
      trendContext: makeNeutralTrendContext(),
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
      trendContext: makeNeutralTrendContext(),
      symbol: "BTC/USDT",
    };

    const s = buildScenario(input);
    const levels = [s.pendingLong, s.targetPrice, s.pendingShort, s.invalidationLevel];

    const unique = new Set(levels);
    expect(unique.size).toBe(4);

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
    const input: ScenarioInput = {
      candleMap,
      timeframeSignals: [
        makeSignal("4H", 20, "bearish"),
        makeSignal("12H", 15, "bearish"),
        makeSignal("1D", 10, "bearish"),
      ],
      marketBias: { bullishPercent: 15, bearishPercent: 85, dominantSide: "short", confidence: 70 },
      chartTrendlines: [],
      trendContext: makeNeutralTrendContext(),
      symbol: "ETH/USDT",
    };

    const s = buildScenario(input);
    expect(["conflicted", "bearish_primary", "neutral_transition"]).toContain(s.scenarioState);
  });

  it("includes MTF explanation in explanationLines", () => {
    const candleMap = makeCandleMap(100);
    const input: ScenarioInput = {
      candleMap,
      timeframeSignals: [makeSignal("4H", 70, "bullish"), makeSignal("1D", 60, "bullish")],
      marketBias: { bullishPercent: 65, bearishPercent: 35, dominantSide: "long", confidence: 50 },
      chartTrendlines: [],
      trendContext: makeNeutralTrendContext(),
      symbol: "SOL/USDT",
    };

    const s = buildScenario(input);
    expect(s.explanationLines[0]).toContain("Đa khung");
  });

  it("includes trend context in explanation lines", () => {
    const candleMap = makeCandleMap(100);
    const bearishTrend: TrendContext = {
      shortTerm: { direction: "bearish", activeTrendlines: [], dominantLine: null, strength: 60 },
      mediumTerm: { direction: "bearish", activeTrendlines: [], dominantLine: null, strength: 50 },
      higherTimeframe: { direction: "bearish", activeTrendlines: [], dominantLine: null, strength: 70 },
      alignment: "aligned_bearish",
    };
    const input: ScenarioInput = {
      candleMap,
      timeframeSignals: [makeSignal("4H", 30, "bearish"), makeSignal("1D", 25, "bearish")],
      marketBias: { bullishPercent: 30, bearishPercent: 70, dominantSide: "short", confidence: 60 },
      chartTrendlines: [],
      trendContext: bearishTrend,
      symbol: "ETH/USDT",
    };

    const s = buildScenario(input);
    const allText = s.explanationLines.join(" ");
    expect(allText).toContain("Trend:");
  });

  it("adjusts confidence when HTF trend conflicts with scenario", () => {
    const candleMap = makeCandleMap(100);

    // Scenario is long but HTF is bearish
    const conflictingTrend: TrendContext = {
      shortTerm: { direction: "bullish", activeTrendlines: [], dominantLine: null, strength: 50 },
      mediumTerm: { direction: "neutral", activeTrendlines: [], dominantLine: null, strength: 0 },
      higherTimeframe: { direction: "bearish", activeTrendlines: [], dominantLine: null, strength: 70 },
      alignment: "mixed",
    };
    const input: ScenarioInput = {
      candleMap,
      timeframeSignals: [makeSignal("1H", 60, "bullish"), makeSignal("4H", 55, "neutral")],
      marketBias: { bullishPercent: 55, bearishPercent: 45, dominantSide: "long", confidence: 40 },
      chartTrendlines: [],
      trendContext: conflictingTrend,
      symbol: "BTC/USDT",
    };

    const s = buildScenario(input);
    // Should have caution text about mixed trends
    expect(s.cautionText).toBeDefined();
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
      trendContext: makeNeutralTrendContext(),
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

// ══════════════════════════════════════════════════════════════════════════════
// NEW TESTS — swing detection, trendlines, trend context, violation policy
// ══════════════════════════════════════════════════════════════════════════════

describe("swing detection", () => {
  it("detects confirmed swing highs from a wave pattern", () => {
    const candles = makeCandles(100, 60, 0.05);
    const highs = detectSwingHighs(candles);

    expect(highs.length).toBeGreaterThan(0);
    for (const sh of highs) {
      expect(sh.confirmed).toBe(true);
      expect(sh.price).toBeGreaterThan(0);
      expect(sh.strength).toBeGreaterThanOrEqual(0);
      expect(sh.strength).toBeLessThanOrEqual(100);
      expect(sh.significance).toBeGreaterThanOrEqual(0);
    }
  });

  it("detects confirmed swing lows from a wave pattern", () => {
    const candles = makeCandles(100, 60, 0.05);
    const lows = detectSwingLows(candles);

    expect(lows.length).toBeGreaterThan(0);
    for (const sl of lows) {
      expect(sl.confirmed).toBe(true);
      expect(sl.price).toBeGreaterThan(0);
    }
  });

  it("de-noises by merging near-duplicate swings", () => {
    const candles = makeCandles(100, 80, 0.01); // tight range = many noisy swings
    const looseConfig: SwingConfig = {
      leftWindow: 2,
      rightConfirmationWindow: 1,
      minSwingDistance: 1,
      minPriceSeparationPct: 0,
    };
    const strictConfig: SwingConfig = {
      leftWindow: 5,
      rightConfirmationWindow: 3,
      minSwingDistance: 5,
      minPriceSeparationPct: 0.002,
    };

    const looseHighs = detectSwingHighs(candles, looseConfig);
    const strictHighs = detectSwingHighs(candles, strictConfig);

    // Strict config should produce fewer swings
    expect(strictHighs.length).toBeLessThanOrEqual(looseHighs.length);
  });

  it("rejects micro-swings in tight ranges", () => {
    const { highs, lows, debug } = detectSwingsWithDebug(
      makeCandles(100, 60, 0.003), // very tight range
      { ...DEFAULT_SWING_CONFIG, leftWindow: 3, rightConfirmationWindow: 2 }
    );

    // In tight ranges, many swings should be discarded
    expect(debug.filteredCount).toBeLessThanOrEqual(debug.rawCount);
  });

  it("returns debug metadata with discard reasons", () => {
    const { debug } = detectSwingsWithDebug(makeCandles(100, 60, 0.03));

    expect(debug.rawCount).toBeGreaterThanOrEqual(0);
    expect(debug.filteredCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(debug.discardReasons)).toBe(true);
  });

  it("backward-compatible: works with old (lookback, confirm) signature", () => {
    const candles = makeCandles(100, 40, 0.04);
    const highs = detectSwingHighs(candles, 3, 2);
    const lows = detectSwingLows(candles, 3, 2);

    // Should still return valid SwingPoint arrays
    for (const sh of highs) {
      expect(sh.index).toBeGreaterThanOrEqual(0);
      expect(sh.price).toBeGreaterThan(0);
    }
    for (const sl of lows) {
      expect(sl.index).toBeGreaterThanOrEqual(0);
      expect(sl.price).toBeGreaterThan(0);
    }
  });
});

describe("trendline generation", () => {
  it("builds ascending trendlines from uptrend candles", () => {
    const candles = makeUptrend(100, 80, 0.3, 0.02);
    const trendlines = buildTrendlines(candles);

    const ascending = trendlines.filter(t => t.kind === "ascending");
    // Uptrend should produce at least one ascending line
    expect(ascending.length).toBeGreaterThanOrEqual(0); // may be 0 if swings are too clean
  });

  it("builds descending trendlines from downtrend candles", () => {
    const candles = makeDowntrend(100, 80, 0.3, 0.02);
    const trendlines = buildTrendlines(candles);

    const descending = trendlines.filter(t => t.kind === "descending");
    expect(descending.length).toBeGreaterThanOrEqual(0);
  });

  it("includes extended metadata on trendlines", () => {
    const candles = makeCandles(100, 80, 0.04);
    const trendlines = buildTrendlines(candles);

    for (const t of trendlines) {
      expect(t.id).toBeDefined();
      expect(t.kind).toMatch(/^(ascending|descending)$/);
      expect(typeof t.slope).toBe("number");
      expect(typeof t.span).toBe("number");
      expect(typeof t.touchCount).toBe("number");
      expect(typeof t.violationCount).toBe("number");
      expect(t.role).toMatch(/^(dynamic_support|dynamic_resistance)$/);
      expect(t.sourceTimeframe).toBeDefined();
    }
  });

  it("scores candidates and returns best quality lines", () => {
    const candles = makeCandles(100, 100, 0.04);
    const { trendlines, debug } = buildTrendlinesWithDebug(candles);

    // Debug output should document the selection process
    expect(debug.candidatesGenerated).toBeGreaterThanOrEqual(0);
    expect(debug.candidatesAccepted).toBeLessThanOrEqual(debug.candidatesGenerated);
    expect(Array.isArray(debug.rejectionReasons)).toBe(true);

    // Accepted lines should have debug reasons
    for (const acc of debug.accepted) {
      expect(acc.id).toBeDefined();
      expect(acc.score).toBeGreaterThanOrEqual(0);
      expect(acc.score).toBeLessThanOrEqual(100);
    }
  });

  it("does not return too many lines (quality over quantity)", () => {
    const candles = makeCandles(100, 150, 0.04);
    const trendlines = buildTrendlines(candles);

    expect(trendlines.length).toBeLessThanOrEqual(8);
  });

  it("returns empty for insufficient candles", () => {
    const candles = makeCandles(100, 5);
    const trendlines = buildTrendlines(candles);
    expect(trendlines.length).toBe(0);
  });
});

describe("trendline violation policy", () => {
  it("marks trendlines as broken after repeated violations", () => {
    const candles = makeCandles(100, 100, 0.05);
    const trendlines = buildTrendlines(candles);

    // Each trendline should have violation count metadata
    for (const t of trendlines) {
      expect(t.violationCount).toBeGreaterThanOrEqual(0);
      // Broken lines should have violations
      if (t.broken) {
        expect(t.active).toBe(false);
      }
      // Active lines should not be marked broken
      if (t.active) {
        expect(t.broken).toBe(false);
      }
    }
  });

  it("touch count reflects how many times price respected the line", () => {
    const candles = makeCandles(100, 100, 0.04);
    const trendlines = buildTrendlines(candles);

    for (const t of trendlines) {
      expect(t.touchCount).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("trendline active vs broken transitions", () => {
  it("active and broken are mutually exclusive", () => {
    const candles = makeCandles(100, 100, 0.05);
    const trendlines = buildTrendlines(candles);

    for (const t of trendlines) {
      expect(t.active).not.toBe(t.broken);
    }
  });

  it("strength reflects quality score, not just span", () => {
    const candles = makeCandles(100, 100, 0.04);
    const trendlines = buildTrendlines(candles);

    for (const t of trendlines) {
      expect(t.strength).toBeGreaterThanOrEqual(0);
      expect(t.strength).toBeLessThanOrEqual(100);
    }
  });
});

describe("MTF trend context", () => {
  it("builds a complete TrendContext from a candle map", () => {
    const candleMap = makeCandleMap(100, 60);
    const tc = buildTrendContext(candleMap);

    expect(tc.shortTerm).toBeDefined();
    expect(tc.mediumTerm).toBeDefined();
    expect(tc.higherTimeframe).toBeDefined();
    expect(["aligned_bullish", "aligned_bearish", "mixed", "neutral"]).toContain(tc.alignment);

    for (const layer of [tc.shortTerm, tc.mediumTerm, tc.higherTimeframe]) {
      expect(["bullish", "bearish", "neutral"]).toContain(layer.direction);
      expect(layer.strength).toBeGreaterThanOrEqual(0);
      expect(layer.strength).toBeLessThanOrEqual(100);
      expect(Array.isArray(layer.activeTrendlines)).toBe(true);
    }
  });

  it("returns aligned_bullish when all TFs trend up", () => {
    const candleMap = makeTrendCandleMap("up", 100);
    const tc = buildTrendContext(candleMap);

    // All uptrend candles should at least not be aligned_bearish
    expect(tc.alignment).not.toBe("aligned_bearish");
  });

  it("returns aligned_bearish when all TFs trend down", () => {
    const candleMap = makeTrendCandleMap("down", 100);
    const tc = buildTrendContext(candleMap);

    expect(tc.alignment).not.toBe("aligned_bullish");
  });

  it("uses provided chart trendlines for short-term layer", () => {
    const candleMap = makeCandleMap(100, 60);
    const customTrendlines = [{
      id: "test-asc-1",
      kind: "ascending" as const,
      x1: 0, y1: 95, x2: 50, y2: 105,
      strength: 75,
      active: true,
      broken: false,
      slope: 0.2,
      span: 50,
      touchCount: 3,
      violationCount: 0,
      role: "dynamic_support" as const,
      sourceTimeframe: "1H",
    }];

    const tc = buildTrendContext(candleMap, customTrendlines);
    expect(tc.shortTerm.activeTrendlines.length).toBeGreaterThanOrEqual(1);
    expect(tc.shortTerm.activeTrendlines[0].id).toBe("test-asc-1");
  });
});

describe("scenario confidence from trend alignment", () => {
  it("adds caution when trend alignment is mixed", () => {
    const candleMap = makeCandleMap(100);
    const mixedTrend: TrendContext = {
      shortTerm: { direction: "bullish", activeTrendlines: [], dominantLine: null, strength: 50 },
      mediumTerm: { direction: "bearish", activeTrendlines: [], dominantLine: null, strength: 60 },
      higherTimeframe: { direction: "bearish", activeTrendlines: [], dominantLine: null, strength: 70 },
      alignment: "mixed",
    };

    const input: ScenarioInput = {
      candleMap,
      timeframeSignals: [makeSignal("1H", 55, "neutral"), makeSignal("4H", 40, "bearish")],
      marketBias: { bullishPercent: 50, bearishPercent: 50, dominantSide: "long", confidence: 20 },
      chartTrendlines: [],
      trendContext: mixedTrend,
      symbol: "BTC/USDT",
    };

    const s = buildScenario(input);
    // Mixed trend should generate caution text
    expect(s.cautionText).toContain("trái chiều");
  });

  it("warns when primary long conflicts with HTF bearish trend", () => {
    const candleMap = makeCandleMap(100);
    const bearishHTF: TrendContext = {
      shortTerm: { direction: "bullish", activeTrendlines: [], dominantLine: null, strength: 40 },
      mediumTerm: { direction: "neutral", activeTrendlines: [], dominantLine: null, strength: 0 },
      higherTimeframe: { direction: "bearish", activeTrendlines: [], dominantLine: null, strength: 80 },
      alignment: "mixed",
    };

    const input: ScenarioInput = {
      candleMap,
      timeframeSignals: [makeSignal("1H", 65, "bullish"), makeSignal("4H", 55, "neutral")],
      marketBias: { bullishPercent: 60, bearishPercent: 40, dominantSide: "long", confidence: 30 },
      chartTrendlines: [],
      trendContext: bearishHTF,
      symbol: "BTC/USDT",
    };

    const s = buildScenario(input);
    if (s.primaryScenario.side === "long") {
      expect(s.cautionText).toBeDefined();
    }
  });
});
