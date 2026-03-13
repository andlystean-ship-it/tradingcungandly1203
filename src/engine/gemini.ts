/**
 * ai-providers.ts (gemini.ts)
 * Multi-provider AI integration for independent market analysis & news.
 *
 * Supported providers (all free tier):
 *   1. Google Gemini 2.0 Flash — 15 RPM, 1M tokens/day
 *   2. Groq (Llama 3.3 70B)   — 30 RPM, 14.4K req/day
 *
 * System auto-falls back between providers if one fails or is rate-limited.
 */

import type {
  CandleData,
  CandleMap,
  NewsItem,
  Symbol,
  Bias,
} from "../types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AIProvider = "gemini" | "groq";

export type AIKeys = {
  gemini: string;
  groq: string;
};

export type GeminiAnalysis = {
  summary: string;
  timestamp: string;
  model: string;
};

type GeminiResponse = {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
  error?: { message: string; code: number };
};

type GroqResponse = {
  choices?: { message?: { content?: string } }[];
  error?: { message: string };
};

// ── Provider configs ──────────────────────────────────────────────────────────

const PROVIDERS: Record<AIProvider, {
  model: string;
  buildUrl: (key: string) => string;
  buildBody: (prompt: string) => unknown;
  extractText: (data: unknown) => string;
}> = {
  gemini: {
    model: "gemini-2.0-flash",
    buildUrl: (key) =>
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
    buildBody: (prompt) => ({
      contents: [{ parts: [{ text: prompt }] }],
    }),
    extractText: (data) => {
      const d = data as GeminiResponse;
      if (d.error) throw new Error(`Gemini: ${d.error.message}`);
      return d.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    },
  },
  groq: {
    model: "llama-3.3-70b-versatile",
    buildUrl: () => "https://api.groq.com/openai/v1/chat/completions",
    buildBody: (prompt) => ({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2048,
    }),
    extractText: (data) => {
      const d = data as GroqResponse;
      if (d.error) throw new Error(`Groq: ${d.error.message}`);
      return d.choices?.[0]?.message?.content ?? "";
    },
  },
};

// ── Rate limiting (per provider) ──────────────────────────────────────────────

const lastRequestByProvider: Record<string, number> = {};
const MIN_INTERVAL_MS = 12_000;

// ── Cache ─────────────────────────────────────────────────────────────────────

let cachedAnalysis: GeminiAnalysis | null = null;
let cachedSymbol: Symbol | null = null;

export function getCachedAnalysis(): GeminiAnalysis | null {
  return cachedAnalysis;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get available providers from keys, ordered by priority */
function getAvailableProviders(keys: AIKeys): AIProvider[] {
  const providers: AIProvider[] = [];
  if (keys.gemini) providers.push("gemini");
  if (keys.groq) providers.push("groq");
  return providers;
}

/** Call a specific provider */
async function callProvider(
  provider: AIProvider,
  apiKey: string,
  prompt: string,
): Promise<{ text: string; model: string }> {
  const cfg = PROVIDERS[provider];
  const url = cfg.buildUrl(apiKey);
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // Groq uses Bearer auth
  if (provider === "groq") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(cfg.buildBody(prompt)),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`${provider} API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const text = cfg.extractText(data);
  return { text, model: cfg.model };
}

/** Call with auto-fallback between providers */
async function callWithFallback(
  keys: AIKeys,
  prompt: string,
  rateLimitKey: string,
): Promise<{ text: string; model: string; provider: AIProvider }> {
  const providers = getAvailableProviders(keys);
  if (providers.length === 0) {
    throw new Error("No AI API keys configured");
  }

  const now = Date.now();
  const errors: string[] = [];

  for (const provider of providers) {
    // Per-provider rate limit
    const rlKey = `${rateLimitKey}-${provider}`;
    const lastReq = lastRequestByProvider[rlKey] ?? 0;
    if (now - lastReq < MIN_INTERVAL_MS) {
      errors.push(`${provider}: rate limited`);
      continue;
    }

    try {
      lastRequestByProvider[rlKey] = now;
      const key = provider === "gemini" ? keys.gemini : keys.groq;
      const result = await callProvider(provider, key, prompt);
      return { ...result, provider };
    } catch (err) {
      errors.push(`${provider}: ${err instanceof Error ? err.message : "failed"}`);
      continue;
    }
  }

  throw new Error(`All providers failed: ${errors.join(" | ")}`);
}

/** Compress candles to OHLCV CSV lines for prompt efficiency */
function candlesToCSV(candles: CandleData[], maxRows: number): string {
  const recent = candles.slice(-maxRows);
  const lines = recent.map(
    (c) => `${c.time},${c.open},${c.high},${c.low},${c.close},${c.volume ?? 0}`,
  );
  return "time,open,high,low,close,volume\n" + lines.join("\n");
}

// ── Build prompt ──────────────────────────────────────────────────────────────

function buildPrompt(
  symbol: Symbol,
  candleMap: CandleMap,
  currentPrice: number,
  language: string,
): string {
  const lang = language === "vi" ? "Vietnamese" : "English";

  // Pick key timeframes to send: 1H (short), 4H (medium), 1D (long)
  const tfPairs: { tf: string; maxRows: number }[] = [
    { tf: "1H", maxRows: 50 },
    { tf: "4H", maxRows: 30 },
    { tf: "1D", maxRows: 20 },
  ];

  const candleSections = tfPairs
    .map(({ tf, maxRows }) => {
      const candles = candleMap[tf as keyof CandleMap];
      if (!candles || candles.length === 0) return null;
      return `--- ${tf} candles (last ${Math.min(candles.length, maxRows)}) ---\n${candlesToCSV(candles, maxRows)}`;
    })
    .filter(Boolean)
    .join("\n\n");

  return `You are a senior crypto/forex technical analyst. You receive RAW OHLCV candle data and must perform your OWN independent analysis from scratch.

RESPOND IN ${lang}.

Symbol: ${symbol}
Current Price: ${currentPrice}

${candleSections}

─── YOUR TASK ───
Analyze the raw candle data above and provide:

1. **Trend Analysis**: Identify the current trend on each timeframe (1H, 4H, 1D). Are they aligned or conflicting?

2. **Key Support & Resistance**: Find the 2-3 most important S/R levels from the price action. Explain why they matter.

3. **Trendlines**: Are there any valid ascending/descending trendlines? Have any been recently broken?

4. **Trade Setup**: Based on YOUR analysis:
   - Direction: LONG / SHORT / WAIT
   - Entry price
   - Target price 
   - Stop-loss price
   - Risk:Reward ratio

5. **Setup Quality**: Rate 1-10 with brief justification.

6. **Key Risks**: 2-3 risks to watch.

Be specific with prices. Use the actual candle data to support your conclusions. Keep under 300 words. Be direct and actionable.`;
}

// ── API call ──────────────────────────────────────────────────────────────────

export async function analyzeWithGemini(
  apiKey: string,
  symbol: Symbol,
  candleMap: CandleMap,
  currentPrice: number,
  language: string,
  groqKey?: string,
): Promise<GeminiAnalysis> {
  const keys: AIKeys = { gemini: apiKey, groq: groqKey ?? "" };
  if (!keys.gemini && !keys.groq) {
    throw new Error("No AI API key configured");
  }

  const prompt = buildPrompt(symbol, candleMap, currentPrice, language);
  const { text, model, provider } = await callWithFallback(keys, prompt, "analysis");

  const analysis: GeminiAnalysis = {
    summary: text || "No response from AI.",
    timestamp: new Date().toISOString(),
    model: `${model} (${provider})`,
  };

  cachedAnalysis = analysis;
  cachedSymbol = symbol;

  return analysis;
}

/** Clear cache when symbol changes */
export function clearGeminiCache(newSymbol?: Symbol): void {
  if (newSymbol && newSymbol === cachedSymbol) return;
  cachedAnalysis = null;
  cachedSymbol = null;
}

// ── AI Trendlines ─────────────────────────────────────────────────────────────

export type AITrendlineResult = {
  trendlines: import("../types").Trendline[];
  model: string;
  timestamp: string;
};

let cachedAITrendlines: AITrendlineResult | null = null;
let cachedAITrendSymbol: Symbol | null = null;
let cachedAITrendTf: string | null = null;

export function getCachedAITrendlines(): AITrendlineResult | null {
  return cachedAITrendlines;
}

function buildTrendlinePrompt(
  symbol: Symbol,
  candles: CandleData[],
  timeframe: string,
  language: string,
): string {
  const lang = language === "vi" ? "Vietnamese" : "English";
  const maxRows = Math.min(candles.length, 80);
  const recent = candles.slice(-maxRows);
  const csv = recent.map(
    (c) => `${c.time},${c.open},${c.high},${c.low},${c.close}`,
  ).join("\n");

  return `You are an expert technical analyst specializing in trendline identification. Analyze the OHLCV candle data below and identify the most important trendlines.

Symbol: ${symbol}
Timeframe: ${timeframe}
RESPOND IN ${lang}.

time,open,high,low,close
${csv}

─── YOUR TASK ───
Identify 2-4 of the MOST IMPORTANT valid trendlines from this price action. For each trendline, find TWO anchor candles (by their "time" field) where the line is firmly supported.

Rules for valid trendlines:
- ASCENDING trendlines connect swing LOWS (use "low" price). The second anchor MUST have a HIGHER price than the first.
- DESCENDING trendlines connect swing HIGHS (use "high" price). The second anchor MUST have a HIGHER price for the first than the second.
- Anchors must be at least 5 candles apart
- The line should have at least 1 additional touch/near-touch besides the 2 anchors
- Prefer trendlines that are CURRENTLY relevant (price is near them or recently interacted)
- Do NOT draw trendlines through candle bodies — only connect wicks (lows for ascending, highs for descending)

Respond with ONLY a JSON array, no markdown, no explanation:
[
  {
    "time1": <unix timestamp of first anchor candle>,
    "price1": <price at first anchor>,
    "time2": <unix timestamp of second anchor candle>,
    "price2": <price at second anchor>,
    "kind": "ascending" or "descending",
    "strength": <1-100 quality score>,
    "reason": "<brief 1-line reason in ${lang}>"
  }
]

CRITICAL: time1 and time2 MUST exactly match "time" values from the CSV data above. Do NOT invent timestamps.`;
}

type AITrendlineRaw = {
  time1: number;
  price1: number;
  time2: number;
  price2: number;
  kind: "ascending" | "descending";
  strength: number;
  reason: string;
};

function parseAITrendlines(
  raw: string,
  candles: CandleData[],
  timeframe: string,
): import("../types").Trendline[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let items: AITrendlineRaw[];
  try {
    items = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];

  // Build time→index map for fast lookup
  const timeToIndex = new Map<number, number>();
  candles.forEach((c, i) => timeToIndex.set(c.time, i));

  return items
    .filter((it) => it.time1 && it.time2 && it.price1 && it.price2 && it.kind)
    .map((it, i) => {
      // Find closest candle index for each anchor timestamp
      let x1 = timeToIndex.get(it.time1) ?? -1;
      let x2 = timeToIndex.get(it.time2) ?? -1;

      // If exact match not found, find nearest candle
      if (x1 === -1) x1 = findNearestCandleIndex(candles, it.time1);
      if (x2 === -1) x2 = findNearestCandleIndex(candles, it.time2);

      if (x1 < 0 || x2 < 0 || x1 === x2) return null;
      if (x1 > x2) { // ensure x1 < x2
        [x1, x2] = [x2, x1];
        it.price1 = candles[x1]?.low ?? it.price1;
        it.price2 = candles[x2]?.low ?? it.price2;
      }

      const kind = (it.kind === "ascending" || it.kind === "descending") ? it.kind : "ascending" as const;
      const trendline: import("../types").Trendline = {
        id: `ai-trend-${i}`,
        kind,
        x1,
        y1: it.price1,
        x2,
        y2: it.price2,
        strength: Math.max(0, Math.min(100, it.strength ?? 50)),
        active: true,
        broken: false,
        slope: (it.price2 - it.price1) / Math.max(1, x2 - x1),
        span: x2 - x1,
        length: x2 - x1,
        touchCount: 2,
        violationCount: 0,
        role: kind === "ascending" ? "dynamic_support" : "dynamic_resistance",
        sourceTimeframe: timeframe,
      };
      return trendline;
    })
    .filter((t): t is import("../types").Trendline => t !== null)
    .slice(0, 4);
}

function findNearestCandleIndex(candles: CandleData[], timestamp: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < candles.length; i++) {
    const dist = Math.abs(candles[i].time - timestamp);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  // Only accept if within reasonable distance (2 candle periods)
  if (candles.length >= 2) {
    const avgPeriod = (candles[candles.length - 1].time - candles[0].time) / candles.length;
    if (bestDist > avgPeriod * 2) return -1;
  }
  return best;
}

export async function fetchAITrendlines(
  apiKey: string,
  symbol: Symbol,
  candles: CandleData[],
  timeframe: string,
  language: string,
  groqKey?: string,
): Promise<AITrendlineResult> {
  const keys: AIKeys = { gemini: apiKey, groq: groqKey ?? "" };
  if (!keys.gemini && !keys.groq) {
    throw new Error("No AI API key configured");
  }
  if (candles.length < 20) {
    throw new Error("Not enough candle data");
  }

  const prompt = buildTrendlinePrompt(symbol, candles, timeframe, language);
  const { text, model, provider } = await callWithFallback(keys, prompt, "trendlines");

  const trendlines = parseAITrendlines(text, candles, timeframe);

  const result: AITrendlineResult = {
    trendlines,
    model: `${model} (${provider})`,
    timestamp: new Date().toISOString(),
  };

  cachedAITrendlines = result;
  cachedAITrendSymbol = symbol;
  cachedAITrendTf = timeframe;

  return result;
}

export function clearAITrendlineCache(newSymbol?: Symbol, newTf?: string): void {
  if (newSymbol && newSymbol === cachedAITrendSymbol && newTf === cachedAITrendTf) return;
  cachedAITrendlines = null;
  cachedAITrendSymbol = null;
  cachedAITrendTf = null;
}

// ── Gemini News fetcher ───────────────────────────────────────────────────────

const NEWS_REFRESH_MS = 10 * 60 * 1000; // 10 minutes
let newsCache: { items: NewsItem[]; ts: number; symbol: Symbol | null } = {
  items: [],
  ts: 0,
  symbol: null,
};
let newsRequestInFlight = false;

function symbolToSearchTerm(symbol: Symbol): string {
  const map: Record<string, string> = {
    "XAU/USDT": "gold XAU price",
    "BTC/USDT": "Bitcoin BTC",
    "ETH/USDT": "Ethereum ETH",
    "SOL/USDT": "Solana SOL",
    "BNB/USDT": "BNB Binance",
    "XRP/USDT": "XRP Ripple",
    "ADA/USDT": "Cardano ADA",
    "DOGE/USDT": "Dogecoin DOGE",
    "DOT/USDT": "Polkadot DOT",
    "AVAX/USDT": "Avalanche AVAX",
    "LINK/USDT": "Chainlink LINK",
    "SUI/USDT": "SUI crypto",
  };
  return map[symbol] ?? "crypto market";
}

type GeminiNewsItem = {
  title: string;
  summary: string;
  sentiment: "bullish" | "bearish" | "neutral";
  sentimentScore: number;
  source: string;
  publishedAt: string;
  hasTargetPrice: boolean;
};

function buildNewsPrompt(symbol: Symbol, language: string): string {
  const term = symbolToSearchTerm(symbol);
  const lang = language === "vi" ? "Vietnamese" : "English";
  const today = new Date().toISOString().slice(0, 10);

  return `You are a financial news aggregator AI. Today's date is ${today}. Provide the latest news about ${term} in the crypto/forex market.

RESPOND IN ${lang}.

Provide exactly 5 news items. For each item, respond in this EXACT JSON format (no markdown, no code blocks, just raw JSON array):

[
  {
    "title": "headline text",
    "summary": "1-2 sentence summary of the news",
    "sentiment": "bullish" or "bearish" or "neutral",
    "sentimentScore": number from 0 to 100 (50=neutral, >50=bullish, <50=bearish),
    "source": "source name (e.g. CoinDesk, Reuters, Bloomberg)",
    "publishedAt": "${today}",
    "hasTargetPrice": true if the article mentions a specific price target
  }
]

Rules:
- Focus on news that impacts ${term} price
- Include a mix of macro, technical, and fundamental news
- ALL publishedAt dates MUST be ${today}. Do NOT use old dates
- sentimentScore: 0-30 strongly bearish, 30-45 bearish, 45-55 neutral, 55-70 bullish, 70-100 strongly bullish
- ONLY respond with the JSON array, no other text`;
}

function parseNewsResponse(raw: string, symbol: Symbol): NewsItem[] {
  let cleaned = raw.trim();
  // Strip markdown code blocks if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let items: GeminiNewsItem[];
  try {
    items = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(items)) return [];

  const coin = symbol.split("/")[0];

  const todayStr = new Date().toLocaleDateString();

  return items
    .filter((item) => item.title && item.summary)
    .slice(0, 6)
    .map((item, i): NewsItem => {
      // Force today's date — AI models don't have real-time data
      let dateLabel = todayStr;
      if (item.publishedAt) {
        const parsed = new Date(item.publishedAt);
        const now = Date.now();
        // If date is more than 7 days old, override to today
        if (!isNaN(parsed.getTime()) && now - parsed.getTime() < 7 * 86_400_000) {
          dateLabel = parsed.toLocaleDateString();
        }
      }
      return ({
      id: `ai-news-${Date.now()}-${i}`,
      source: item.source || "AI",
      sourceAttribution: "via AI",
      sourceProvider: "system",
      publishedAt: dateLabel,
      title: item.title,
      summary: item.summary,
      relatedCoins: [coin],
      sentimentLabel: (["bullish", "bearish", "neutral"].includes(item.sentiment)
        ? item.sentiment
        : "neutral") as Bias,
      sentimentScore: Math.max(0, Math.min(100, item.sentimentScore ?? 50)),
      hasTargetPrice: item.hasTargetPrice ?? false,
      sourceMode: "live",
    });
    });
}

export async function fetchGeminiNews(
  apiKey: string,
  symbol: Symbol,
  language: string,
  groqKey?: string,
): Promise<NewsItem[]> {
  const keys: AIKeys = { gemini: apiKey, groq: groqKey ?? "" };
  if (!keys.gemini && !keys.groq) return [];

  if (newsRequestInFlight) {
    return newsCache.items;
  }

  newsRequestInFlight = true;

  try {
    const prompt = buildNewsPrompt(symbol, language);
    const { text } = await callWithFallback(keys, prompt, "news");
    const items = parseNewsResponse(text, symbol);

    if (items.length > 0) {
      newsCache = { items, ts: Date.now(), symbol };
    }

    return items.length > 0 ? items : newsCache.items;
  } catch {
    return newsCache.items;
  } finally {
    newsRequestInFlight = false;
  }
}

/** Check if news cache is stale and needs refresh */
export function isNewsCacheStale(symbol: Symbol): boolean {
  if (newsCache.symbol !== symbol) return true;
  if (newsCache.items.length === 0) return true;
  return Date.now() - newsCache.ts > NEWS_REFRESH_MS;
}

/** Get cached news without fetching */
export function getCachedNews(): NewsItem[] {
  return newsCache.items;
}
