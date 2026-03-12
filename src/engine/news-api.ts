/**
 * news-api.ts
 * Dynamic news fetcher with keyword-based sentiment scoring.
 *
 * Primary source: CryptoPanic API (free tier, no key required for public feed)
 * Fallback: static news from news.ts
 *
 * Sentiment is scored deterministically from keyword analysis:
 *   - Positive keywords: bullish, surge, rally, pump, breakout, accumulation, support, inflows
 *   - Negative keywords: bearish, crash, dump, sell-off, resistance, outflows, liquidation
 *   - Score range: 0–100 (50 = neutral)
 */

import type { NewsItem, Symbol, Bias } from "../types";
import { getNews as getStaticNews } from "./news";

const CRYPTOPANIC_BASE = "https://cryptopanic.com/api/free/v1/posts/";

// Keyword-based sentiment analysis
const BULLISH_KEYWORDS = [
  "bullish", "surge", "rally", "pump", "breakout", "accumulation",
  "support", "inflows", "buy", "upside", "gain", "tăng", "tích cực",
  "hỗ trợ", "tích lũy", "mua", "tăng giá", "đột phá", "higher",
  "upgrade", "adoption", "approval", "etf", "institutional",
];

const BEARISH_KEYWORDS = [
  "bearish", "crash", "dump", "sell", "selloff", "sell-off",
  "resistance", "outflows", "liquidation", "decline", "drop",
  "giảm", "tiêu cực", "sụt", "bán", "kháng cự", "rủi ro",
  "ban", "hack", "exploit", "regulation", "crackdown", "lower",
];

/** Score an article's sentiment from its text (0–100, 50 = neutral) */
export function scoreSentiment(text: string): { score: number; label: Bias } {
  const lower = text.toLowerCase();
  let bullishHits = 0;
  let bearishHits = 0;

  for (const kw of BULLISH_KEYWORDS) {
    if (lower.includes(kw)) bullishHits++;
  }
  for (const kw of BEARISH_KEYWORDS) {
    if (lower.includes(kw)) bearishHits++;
  }

  const total = bullishHits + bearishHits;
  if (total === 0) return { score: 50, label: "neutral" };

  // Weighted toward 50 (neutral center)
  const rawScore = (bullishHits / total) * 100;
  // Dampen toward center: score = 50 + (raw - 50) * confidence
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
 * Falls back to static news if API is unavailable.
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
      return getStaticNews(symbol);
    }

    const data = await response.json() as { results?: CryptoPanicPost[] };

    if (!data.results || data.results.length === 0) {
      return getStaticNews(symbol);
    }

    const items: NewsItem[] = data.results.slice(0, 8).map((post, i) => {
      const sentiment = scoreSentiment(post.title);
      const publishedAt = formatRelativeTime(post.published_at);
      const coins = post.currencies?.map(c => c.code) || [currency];

      return {
        id: `live-${post.id || i}`,
        source: post.source?.title || "CryptoPanic",
        publishedAt,
        title: post.title,
        summary: post.title, // Free API doesn't include body
        relatedCoins: coins,
        sentimentLabel: sentiment.label,
        sentimentScore: sentiment.score,
        hasTargetPrice: false,
      };
    });

    return items.length > 0 ? items : getStaticNews(symbol);
  } catch {
    // Network error, CORS block, timeout — fall back to static
    return getStaticNews(symbol);
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
