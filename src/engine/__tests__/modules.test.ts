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
import { detectSwingHighs, detectSwingLows } from "../swings";
import type { CandleData } from "../../types";

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
    const looseHighs = detectSwingHighs(candles, { minSwingDistance: 3, minPriceSeparationPct: 0.001 });
    const strictHighs = detectSwingHighs(candles, { minSwingDistance: 10, minPriceSeparationPct: 0.05 });
    // Looser config should find at least as many swings
    expect(looseHighs.length).toBeGreaterThanOrEqual(strictHighs.length);
  });
});

// ── Candle fallback for dynamic symbols ───────────────────────────────────────
import { generateCandles } from "../candles";

describe("generateCandles fallback", () => {
  it("generates candles for a known symbol", () => {
    const candles = generateCandles("BTC/USDT" as any, "1H", 20);
    expect(candles).toHaveLength(20);
    expect(candles[0].open).toBeGreaterThan(0);
  });

  it("generates candles for an unknown dynamic symbol without crashing", () => {
    const candles = generateCandles("PEPE/USDT" as any, "1H", 20);
    expect(candles).toHaveLength(20);
    expect(candles[0].open).toBeGreaterThan(0);
  });
});
