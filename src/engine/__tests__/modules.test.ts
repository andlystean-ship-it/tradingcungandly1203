/**
 * Module-level tests for: sentiment scoring, notifier system, dynamic symbols,
 * engine config threading, and market-data fallback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Sentiment scoring ─────────────────────────────────────────────────────────
import { scoreSentiment } from "../news-api";

describe("scoreSentiment", () => {
  it("returns neutral 50 for text with no keywords", () => {
    const { score, label } = scoreSentiment("The weather is nice today.");
    expect(score).toBe(50);
    expect(label).toBe("neutral");
  });

  it("returns bullish for text with multiple bullish keywords", () => {
    const { score, label } = scoreSentiment(
      "Bitcoin breakout rally surge with institutional adoption and ETF approval"
    );
    expect(score).toBeGreaterThan(50);
    expect(label).toBe("bullish");
  });

  it("returns bearish for text with multiple bearish keywords", () => {
    const { score, label } = scoreSentiment(
      "Crypto crash dump with massive liquidation, exploit hack, sell-off decline"
    );
    expect(score).toBeLessThan(50);
    expect(label).toBe("bearish");
  });

  it("returns neutral when bullish and bearish keywords cancel out", () => {
    const { score, label } = scoreSentiment("bullish crash rally dump");
    expect(score).toBe(50);
    expect(label).toBe("neutral");
  });

  it("handles Vietnamese keywords", () => {
    const { score: s1 } = scoreSentiment("giá tăng mạnh tích cực");
    expect(s1).toBeGreaterThan(50);

    const { score: s2 } = scoreSentiment("giảm mạnh tiêu cực rủi ro");
    expect(s2).toBeLessThan(50);
  });

  it("is case-insensitive", () => {
    const { label } = scoreSentiment("BULLISH SURGE RALLY BREAKOUT PUMP ACCUMULATION");
    expect(label).toBe("bullish");
  });

  it("treats plain support or resistance location headlines as neutral", () => {
    const support = scoreSentiment("Bitcoin tests support near $82k as traders wait for confirmation");
    const resistance = scoreSentiment("Ethereum trades near resistance ahead of CPI release");
    expect(support.label).toBe("neutral");
    expect(resistance.label).toBe("neutral");
  });

  it("still detects directional technical phrases when context is explicit", () => {
    const bullish = scoreSentiment("Bitcoin breaks resistance after ETF inflows and institutional adoption");
    const bearish = scoreSentiment("Solana breaks support after liquidation and outflows accelerate");
    expect(bullish.label).toBe("bullish");
    expect(bearish.label).toBe("bearish");
  });
});

// ── Notifier system ───────────────────────────────────────────────────────────
import {
  BrowserNotifier,
  TelegramNotifier,
  registerNotifier,
  getNotifiers,
  notifyAll,
  type NotificationPayload,
} from "../notifier";

const makePayload = (): NotificationPayload => ({
  title: "Price Alert — BTC",
  body: "Price crossed above 100000",
  symbol: "BTC/USDT",
  price: 100000,
  direction: "above",
  timestamp: new Date().toISOString(),
});

describe("BrowserNotifier", () => {
  it("has name 'browser'", () => {
    const n = new BrowserNotifier();
    expect(n.name).toBe("browser");
  });

  it("send() does not throw when Notification API is unavailable", async () => {
    const n = new BrowserNotifier();
    await expect(n.send(makePayload())).resolves.toBeUndefined();
  });
});

describe("TelegramNotifier", () => {
  it("has name 'telegram'", () => {
    const n = new TelegramNotifier("token", "chatid");
    expect(n.name).toBe("telegram");
  });

  it("send() skips when botToken is empty", async () => {
    const n = new TelegramNotifier("", "chatid");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await n.send(makePayload());
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("send() skips when chatId is empty", async () => {
    const n = new TelegramNotifier("token", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await n.send(makePayload());
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("Notifier registry", () => {
  it("starts with BrowserNotifier", () => {
    const all = getNotifiers();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all[0].name).toBe("browser");
  });

  it("registerNotifier prevents duplicate names", () => {
    const before = getNotifiers().length;
    registerNotifier(new BrowserNotifier());
    expect(getNotifiers().length).toBe(before);
  });

  it("notifyAll does not throw when no channels succeed", async () => {
    await expect(notifyAll(makePayload())).resolves.toBeUndefined();
  });
});

// ── Dynamic symbols ───────────────────────────────────────────────────────────
import { KNOWN_SYMBOLS } from "../symbols";

describe("KNOWN_SYMBOLS", () => {
  it("contains 12 symbols", () => {
    expect(KNOWN_SYMBOLS).toHaveLength(12);
  });

  it("all symbols end with /USDT", () => {
    for (const s of KNOWN_SYMBOLS) {
      expect(s).toMatch(/\/USDT$/);
    }
  });

  it("includes BTC/USDT and ETH/USDT", () => {
    expect(KNOWN_SYMBOLS).toContain("BTC/USDT");
    expect(KNOWN_SYMBOLS).toContain("ETH/USDT");
  });
});

// ── Engine config threading ───────────────────────────────────────────────────
import { buildTrendlines } from "../trendlines";
import { DEFAULT_SWING_CONFIG, detectSwingHighs } from "../swings";
import type { CandleData, Symbol } from "../../types";

describe("Engine config threading", () => {
  function makeCandles(count: number, basePrice = 100): CandleData[] {
    const candles: CandleData[] = [];
    for (let i = 0; i < count; i++) {
      const t = 1700000000 + i * 3600;
      // Zigzag pattern for clear swings
      const swing = Math.sin(i * 0.5) * basePrice * 0.05;
      const c = basePrice + swing;
      candles.push({
        time: t,
        open: c - 0.5,
        high: c + basePrice * 0.01,
        low: c - basePrice * 0.01,
        close: c,
      });
    }
    return candles;
  }

  it("buildTrendlines accepts swingOverrides without crashing", () => {
    const candles = makeCandles(50);
    const result = buildTrendlines(candles, undefined, {
      minSwingDistance: 5,
      minPriceSeparationPct: 0.01,
    });
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it("different swing configs produce different swing counts", () => {
    const candles = makeCandles(80, 100);
    const looseHighs = detectSwingHighs(candles, {
      ...DEFAULT_SWING_CONFIG,
      minSwingDistance: 3,
      minPriceSeparationPct: 0.001,
    });
    const strictHighs = detectSwingHighs(candles, {
      ...DEFAULT_SWING_CONFIG,
      minSwingDistance: 10,
      minPriceSeparationPct: 0.05,
    });
    // Looser config should find at least as many swings
    expect(looseHighs.length).toBeGreaterThanOrEqual(strictHighs.length);
  });
});

// ── Candle fallback for dynamic symbols ───────────────────────────────────────
import { generateCandles } from "../candles";

describe("generateCandles fallback", () => {
  it("generates candles for a known symbol", () => {
    const candles = generateCandles("BTC/USDT" as Symbol, "1H", 20);
    expect(candles).toHaveLength(20);
    expect(candles[0].open).toBeGreaterThan(0);
    expect(candles[0].volume).toBeGreaterThan(0);
  });

  it("generates candles for an unknown dynamic symbol without crashing", () => {
    const candles = generateCandles("PEPE/USDT" as unknown as Symbol, "1H", 20);
    expect(candles).toHaveLength(20);
    expect(candles[0].open).toBeGreaterThan(0);
    expect(candles[0].volume).toBeGreaterThan(0);
  });
});

// ── EMA calculation ───────────────────────────────────────────────────────────
import { calcEMA, lastEMA } from "../candles";
import { fetchNewsFromApi, getNewsAsync, resetNewsCacheForTests } from "../news";
import { calcPivot } from "../pivot";
import { scoreTimeframe } from "../scoring";

describe("calcEMA", () => {
  function makeFlatCandles(price: number, count: number): CandleData[] {
    return Array.from({ length: count }, (_, i) => ({
      time: 1700000000 + i * 3600,
      open: price,
      high: price + 1,
      low: price - 1,
      close: price,
    }));
  }

  it("returns array same length as input", () => {
    const candles = makeFlatCandles(100, 30);
    const ema = calcEMA(candles, 10);
    expect(ema).toHaveLength(30);
  });

  it("converges to price for flat series", () => {
    const candles = makeFlatCandles(50, 100);
    const ema = calcEMA(candles, 20);
    // After 100 candles of constant price, EMA should be very close to 50
    expect(ema[ema.length - 1]).toBeCloseTo(50, 5);
  });

  it("lastEMA returns NaN for insufficient data", () => {
    const candles = makeFlatCandles(100, 5);
    expect(lastEMA(candles, 10)).toBeNaN();
  });

  it("lastEMA returns a number for sufficient data", () => {
    const candles = makeFlatCandles(100, 50);
    const val = lastEMA(candles, 20);
    expect(val).not.toBeNaN();
    expect(val).toBeCloseTo(100, 2);
  });
});

describe("calcPivot", () => {
  it("returns zeroed pivot levels for empty candles", () => {
    expect(calcPivot([])).toEqual({
      pivot: 0,
      r1: 0,
      r2: 0,
      r3: 0,
      s1: 0,
      s2: 0,
      s3: 0,
    });
  });
});

describe("scoreTimeframe", () => {
  function makeDirectionalCandles(direction: "up" | "down", count: number, basePrice: number): CandleData[] {
    const candles: CandleData[] = [];
    let price = basePrice;
    for (let i = 0; i < count; i++) {
      const drift = direction === "up" ? 0.9 : -0.9;
      const wave = Math.sin(i * 0.35) * basePrice * 0.004;
      const open = price;
      const close = price + drift + wave;
      const high = Math.max(open, close) + basePrice * 0.01;
      const low = Math.min(open, close) - basePrice * 0.008;
      candles.push({
        time: 1700000000 + i * 3600,
        open,
        high,
        low,
        close,
      });
      price = close;
    }
    return candles;
  }

  it("scores a sustained uptrend as bullish", () => {
    const signal = scoreTimeframe("4H", makeDirectionalCandles("up", 220, 100));
    expect(signal.bullishScore).toBeGreaterThan(55);
    expect(signal.bias).toBe("bullish");
  });

  it("scores a sustained downtrend as bearish", () => {
    const signal = scoreTimeframe("4H", makeDirectionalCandles("down", 220, 100));
    expect(signal.bullishScore).toBeLessThan(45);
    expect(signal.bias).toBe("bearish");
  });

  it("captures expanding volume in timeframe metrics", () => {
    const candles = makeDirectionalCandles("up", 220, 100).map((candle, index, list) => ({
      ...candle,
      volume: index === list.length - 1 ? 3200 : 1400 + index * 3,
    }));
    const signal = scoreTimeframe("4H", candles);
    expect(signal.volumeMetrics).toBeDefined();
    expect(signal.volumeMetrics!.volumeState).toBe("expanding");
    expect(signal.volumeMetrics!.score).toBeGreaterThan(50);
  });
});

// ── Per-timeframe entries ─────────────────────────────────────────────────────
import { getEntryForTimeframe } from "../scenario";
import type { CandleMap, MarketBias, TimeframeSignal, TrendContext } from "../../types";

describe("getEntryForTimeframe", () => {
  const bullishBias: MarketBias = {
    bullishPercent: 62,
    bearishPercent: 38,
    dominantSide: "long",
    confidence: 62,
  };
  const bearishBias: MarketBias = {
    bullishPercent: 35,
    bearishPercent: 65,
    dominantSide: "short",
    confidence: 65,
  };
  const bullishTrendContext: TrendContext = {
    shortTerm: { direction: "bullish", activeTrendlines: [], dominantLine: null, strength: 60 },
    mediumTerm: { direction: "bullish", activeTrendlines: [], dominantLine: null, strength: 65 },
    higherTimeframe: { direction: "bullish", activeTrendlines: [], dominantLine: null, strength: 70 },
    alignment: "aligned_bullish",
    emaCrossover: { direction: "bullish", ema50: 101, ema200: 99 },
  };
  const bearishTrendContext: TrendContext = {
    shortTerm: { direction: "bearish", activeTrendlines: [], dominantLine: null, strength: 60 },
    mediumTerm: { direction: "bearish", activeTrendlines: [], dominantLine: null, strength: 65 },
    higherTimeframe: { direction: "bearish", activeTrendlines: [], dominantLine: null, strength: 70 },
    alignment: "aligned_bearish",
    emaCrossover: { direction: "bearish", ema50: 99, ema200: 101 },
  };

  function makeTfCandles(count: number, basePrice: number): CandleData[] {
    const candles: CandleData[] = [];
    for (let i = 0; i < count; i++) {
      const swing = Math.sin(i * 0.3) * basePrice * 0.03;
      const c = basePrice + swing;
      candles.push({
        time: 1700000000 + i * 3600,
        open: c - basePrice * 0.005,
        high: c + basePrice * 0.01,
        low: c - basePrice * 0.01,
        close: c,
      });
    }
    return candles;
  }

  it("returns null for missing timeframe", () => {
    const candleMap: CandleMap = {};
    expect(getEntryForTimeframe("15M", candleMap, bullishBias, bullishTrendContext)).toBeNull();
  });

  it("returns null for insufficient candles", () => {
    const candleMap: CandleMap = { "1H": makeTfCandles(5, 100) };
    expect(getEntryForTimeframe("1H", candleMap, bullishBias, bullishTrendContext)).toBeNull();
  });

  it("returns valid entry for sufficient candles (long side)", () => {
    const candleMap: CandleMap = { "1H": makeTfCandles(50, 100) };
    const entry = getEntryForTimeframe("1H", candleMap, bullishBias, bullishTrendContext);
    expect(entry).not.toBeNull();
    expect(entry!.tf).toBe("1H");
    expect(entry!.longEntry).toBeGreaterThan(0);
    expect(entry!.shortEntry).toBeGreaterThan(0);
    expect(entry!.target).toBeGreaterThan(0);
    expect(entry!.invalidation).toBeGreaterThan(0);
    expect(entry!.pendingLong).toBe(entry!.longEntry);
    expect(entry!.targetPrice).toBe(entry!.target);
    // Long entry should be below current price (support)
    const lastPrice = candleMap["1H"]![49].close;
    expect(entry!.longEntry).toBeLessThanOrEqual(lastPrice + lastPrice * 0.05);
  });

  it("returns valid entry for short side", () => {
    const candleMap: CandleMap = { "4H": makeTfCandles(50, 200) };
    const entry = getEntryForTimeframe("4H", candleMap, bearishBias, bearishTrendContext);
    expect(entry).not.toBeNull();
    expect(entry!.tf).toBe("4H");
    expect(entry!.shortEntry).toBeGreaterThan(0);
  });

  it("supports higher dashboard timeframes like 12H and 1D", () => {
    const candleMap: CandleMap = {
      "12H": makeTfCandles(80, 100),
      "1D": makeTfCandles(80, 100),
    };
    const entry12h = getEntryForTimeframe("12H", candleMap, bullishBias, bullishTrendContext);
    const entry1d = getEntryForTimeframe("1D", candleMap, bullishBias, bullishTrendContext);
    expect(entry12h).not.toBeNull();
    expect(entry1d).not.toBeNull();
    expect(entry12h!.tf).toBe("12H");
    expect(entry1d!.tf).toBe("1D");
  });

  it("uses timeframe signal bias when it clearly conflicts with global bias", () => {
    const candleMap: CandleMap = { "1H": makeTfCandles(60, 100) };
    const globalBullishBias: MarketBias = {
      bullishPercent: 64,
      bearishPercent: 36,
      dominantSide: "long",
      confidence: 61,
    };
    const localBearishSignal: TimeframeSignal = {
      timeframe: "1H",
      bullishLevel: 101,
      bearishLevel: 99,
      bullishScore: 40,
      bearishScore: 60,
      bias: "bearish",
      strength: 2,
    };

    const entry = getEntryForTimeframe("1H", candleMap, globalBullishBias, bullishTrendContext, localBearishSignal);
    expect(entry).not.toBeNull();
    expect(entry!.preferredSide).toBe("short");
  });
});

// ── buildTrendContext with slope-weighted scoring ─────────────────────────────
import { buildTrendContext } from "../trend-context";

describe("buildTrendContext slope-weighted", () => {
  function makeTrendCandles(count: number, basePrice: number): CandleData[] {
    const candles: CandleData[] = [];
    for (let i = 0; i < count; i++) {
      const swing = Math.sin(i * 0.4) * basePrice * 0.04;
      const c = basePrice + swing + i * 0.1; // slight uptrend
      candles.push({
        time: 1700000000 + i * 3600,
        open: c - basePrice * 0.005,
        high: c + basePrice * 0.015,
        low: c - basePrice * 0.015,
        close: c,
      });
    }
    return candles;
  }

  it("returns a valid TrendContext structure", () => {
    const candleMap: CandleMap = {
      "1H": makeTrendCandles(80, 100),
      "4H": makeTrendCandles(80, 100),
      "12H": makeTrendCandles(40, 100),
      "1D": makeTrendCandles(30, 100),
    };
    const ctx = buildTrendContext(candleMap);
    expect(ctx.shortTerm).toBeDefined();
    expect(ctx.mediumTerm).toBeDefined();
    expect(ctx.higherTimeframe).toBeDefined();
    expect(["aligned_bullish", "aligned_bearish", "mixed", "neutral"]).toContain(ctx.alignment);
  });

  it("includes pressure field", () => {
    const candleMap: CandleMap = {
      "1H": makeTrendCandles(80, 100),
      "4H": makeTrendCandles(80, 100),
    };
    const ctx = buildTrendContext(candleMap);
    expect(ctx.pressure).toBeDefined();
    expect(typeof ctx.pressure!.netPressure).toBe("number");
  });
});

describe("news API integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetNewsCacheForTests();
  });

  it("maps API news into NewsItem with Hanoi time and sentiment", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 1,
            title: "Bitcoin breakout rally toward $90k",
            source: { title: "CryptoPanic" },
            published_at: "2026-03-12T01:00:00.000Z",
            currencies: [{ code: "BTC" }],
          },
        ],
      }),
    } as Response);

    const items = await fetchNewsFromApi("BTC/USDT");
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("CryptoPanic");
    expect(items[0].sourceAttribution).toBe("via CryptoPanic");
    expect(items[0].sourceProvider).toBe("cryptopanic");
    expect(items[0].publishedAt).toContain("GMT+7");
    expect(items[0].sentimentLabel).toBe("bullish");
    expect(items[0].sourceMode).toBe("live");
  });

  it("caches live news by symbol", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 2,
            title: "Bitcoin support holds despite volatility",
            source: { title: "CryptoPanic" },
            published_at: "2026-03-12T02:00:00.000Z",
            currencies: [{ code: "BTC" }],
          },
        ],
      }),
    } as Response);

    const first = await getNewsAsync("BTC/USDT");
    const second = await getNewsAsync("BTC/USDT");

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to explicit unavailable placeholder when live API fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));

    const items = await getNewsAsync("BTC/USDT");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].id.startsWith("fallback-")).toBe(true);
    expect(items[0].sourceMode).toBe("fallback");
    expect(items[0].sourceProvider).toBe("system");
    expect(items[0].sentimentLabel).toBe("neutral");
    expect(items[0].hasTargetPrice).toBe(false);
  });

  it("retries live fetch sooner when fallback cache expires", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 3,
              title: "Bitcoin breakout with ETF inflows",
              source: { title: "CryptoPanic" },
              published_at: "2026-03-12T03:00:00.000Z",
              currencies: [{ code: "BTC" }],
            },
          ],
        }),
      } as Response);

    const first = await getNewsAsync("BTC/USDT");
    expect(first[0].sourceMode).toBe("fallback");

    vi.advanceTimersByTime(31_000);
    const second = await getNewsAsync("BTC/USDT");
    expect(second[0].sourceMode).toBe("live");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
