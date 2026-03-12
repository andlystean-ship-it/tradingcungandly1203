/**
 * news-api.ts
 * Dynamic news fetcher with keyword-based sentiment scoring.
 *
 * Primary source: CryptoPanic API (free tier, no key required for public feed)
 * Shared helper module for sentiment scoring and lightweight live fetch.
 *
 * Sentiment is scored deterministically from weighted phrases.
 * Pure technical-location words like support/resistance are not directional by themselves.
 *   - Score range: 0–100 (50 = neutral)
 */

import type { NewsItem, Symbol, Bias } from "../types";

const CRYPTOPANIC_BASE = "https://cryptopanic.com/api/free/v1/posts/";

type WeightedPhrase = { phrase: string; weight: number };

const BULLISH_PHRASES: WeightedPhrase[] = [
  { phrase: "bullish", weight: 2.0 },
  { phrase: "surge", weight: 1.4 },
  { phrase: "rally", weight: 1.4 },
  { phrase: "pump", weight: 1.2 },
  { phrase: "breakout", weight: 1.8 },
  { phrase: "accumulation", weight: 1.5 },
  { phrase: "inflows", weight: 1.5 },
  { phrase: "buy", weight: 1.0 },
  { phrase: "upside", weight: 1.1 },
  { phrase: "gain", weight: 1.0 },
  { phrase: "higher", weight: 0.9 },
  { phrase: "upgrade", weight: 1.0 },
  { phrase: "adoption", weight: 1.4 },
  { phrase: "approval", weight: 1.5 },
  { phrase: "etf inflows", weight: 2.0 },
  { phrase: "institutional adoption", weight: 2.0 },
  { phrase: "holds support", weight: 1.2 },
  { phrase: "reclaims support", weight: 1.6 },
  { phrase: "breaks resistance", weight: 1.8 },
  { phrase: "tăng", weight: 1.1 },
  { phrase: "tích cực", weight: 1.4 },
  { phrase: "hỗ trợ", weight: 0.6 },
  { phrase: "tích lũy", weight: 1.4 },
  { phrase: "mua", weight: 1.0 },
  { phrase: "tăng giá", weight: 1.5 },
  { phrase: "đột phá", weight: 1.8 },
];

const BEARISH_PHRASES: WeightedPhrase[] = [
  { phrase: "bearish", weight: 2.0 },
  { phrase: "crash", weight: 1.8 },
  { phrase: "dump", weight: 1.6 },
  { phrase: "sell", weight: 1.0 },
  { phrase: "selloff", weight: 1.6 },
  { phrase: "sell-off", weight: 1.6 },
  { phrase: "outflows", weight: 1.5 },
  { phrase: "liquidation", weight: 1.7 },
  { phrase: "decline", weight: 1.2 },
  { phrase: "drop", weight: 1.2 },
  { phrase: "breaks support", weight: 1.9 },
  { phrase: "rejected at resistance", weight: 1.7 },
  { phrase: "fails at resistance", weight: 1.6 },
  { phrase: "lower", weight: 0.9 },
  { phrase: "giảm", weight: 1.2 },
  { phrase: "tiêu cực", weight: 1.4 },
  { phrase: "sụt", weight: 1.2 },
  { phrase: "bán", weight: 1.0 },
  { phrase: "kháng cự", weight: 0.6 },
  { phrase: "rủi ro", weight: 1.0 },
  { phrase: "ban", weight: 1.3 },
  { phrase: "hack", weight: 1.5 },
  { phrase: "exploit", weight: 1.5 },
  { phrase: "regulation", weight: 1.2 },
  { phrase: "crackdown", weight: 1.6 },
];

const NEUTRAL_TECHNICAL_PHRASES = [
  "tests support",
  "near support",
  "at support",
  "tests resistance",
  "near resistance",
  "at resistance",
  "kháng cự quan trọng",
  "kiểm tra hỗ trợ",
];

function countOccurrences(text: string, phrase: string): number {
  if (!phrase) return 0;
  return text.split(phrase).length - 1;
}

function weightedHits(text: string, phrases: WeightedPhrase[]): number {
  let total = 0;
  for (const { phrase, weight } of phrases) {
    const occurrences = countOccurrences(text, phrase);
    if (occurrences > 0) total += occurrences * weight;
  }
  return total;
}

/** Score an article's sentiment from its text (0–100, 50 = neutral) */
export function scoreSentiment(text: string): { score: number; label: Bias } {
  const lower = text.toLowerCase();
  let bullishHits = weightedHits(lower, BULLISH_PHRASES);
  let bearishHits = weightedHits(lower, BEARISH_PHRASES);

  for (const phrase of NEUTRAL_TECHNICAL_PHRASES) {
    if (lower.includes(phrase)) {
      bullishHits = Math.max(0, bullishHits - 0.8);
      bearishHits = Math.max(0, bearishHits - 0.8);
    }
  }

  if (/\bsupport\b/.test(lower) && !/(holds support|reclaims support|breaks support|near support|at support|tests support)/.test(lower)) {
    bullishHits = Math.max(0, bullishHits - 0.6);
  }
  if (/\bresistance\b/.test(lower) && !/(breaks resistance|rejected at resistance|fails at resistance|near resistance|at resistance|tests resistance)/.test(lower)) {
    bearishHits = Math.max(0, bearishHits - 0.6);
  }

  const total = bullishHits + bearishHits;
  if (total === 0) return { score: 50, label: "neutral" };

  const rawScore = (bullishHits / total) * 100;
  const confidence = Math.min(total / 6, 1); // max confidence at 6+ hits
  const score = Math.round(50 + (rawScore - 50) * confidence);

  const label: Bias = score >= 60 ? "bullish" : score <= 40 ? "bearish" : "neutral";
  return { score, label };
}

/** Map our symbol to CryptoPanic currency filter */
function symbolToCurrency(symbol: Symbol): string {
  const map: Record<string, string> = {
    "XAU/USDT": "PAXG",
    "BTC/USDT": "BTC",
    "ETH/USDT": "ETH",
    "SOL/USDT": "SOL",
    "BNB/USDT": "BNB",
    "XRP/USDT": "XRP",
    "ADA/USDT": "ADA",
    "DOGE/USDT": "DOGE",
    "DOT/USDT": "DOT",
    "AVAX/USDT": "AVAX",
    "LINK/USDT": "LINK",
    "SUI/USDT": "SUI",
  };
  return map[symbol] || "BTC";
}

type CryptoPanicPost = {
  id: number;
  title: string;
  url: string;
  source: { title: string };
  published_at: string;
  currencies?: { code: string }[];
};

/**
 * Fetch live news for a symbol.
 */
export async function fetchNews(symbol: Symbol): Promise<NewsItem[]> {
  try {
    const currency = symbolToCurrency(symbol);
    const url = `${CRYPTOPANIC_BASE}?currencies=${encodeURIComponent(currency)}&kind=news&public=true`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as { results?: CryptoPanicPost[] };

    if (!data.results || data.results.length === 0) {
      return [];
    }

    const items: NewsItem[] = data.results.slice(0, 8).map((post, i) => {
      const sentiment = scoreSentiment(post.title);
      const publishedAt = formatRelativeTime(post.published_at);
      const coins = post.currencies?.map(c => c.code) || [currency];

      return {
        id: `live-${post.id || i}`,
        source: post.source?.title || "CryptoPanic",
        sourceAttribution: "via CryptoPanic",
        sourceProvider: "cryptopanic",
        publishedAt,
        title: post.title,
        summary: post.title, // Free API doesn't include body
        relatedCoins: coins,
        sentimentLabel: sentiment.label,
        sentimentScore: sentiment.score,
        hasTargetPrice: false,
        sourceMode: "live",
      };
    });

    return items;
  } catch {
    return [];
  }
}

function formatRelativeTime(isoDate: string): string {
  try {
    const published = new Date(isoDate).getTime();
    const diff = Date.now() - published;
    const minutes = Math.floor(diff / (1000 * 60));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "recently";
  }
}
