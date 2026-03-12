/**
 * news.ts
 * News and sentiment as a SECONDARY context layer.
 *
 * Rules:
 * - News does not generate core signals
 * - News may adjust display context / caution text
 * - Primary source: CryptoPanic API (via news-api.ts)
 * - Fallback: explicit unavailable placeholder (never fake articles)
 * - Sentiment values are deterministic (no random)
 */

import type { NewsItem, Symbol } from "../types";
import { scoreSentiment } from "./news-api";

type CacheEntry = {
  items: NewsItem[];
  ts: number;
  ttlMs: number;
};

const LIVE_CACHE_TTL_MS = 5 * 60 * 1000;
const FALLBACK_CACHE_TTL_MS = 30 * 1000;

function buildFallbackNews(symbol: Symbol): NewsItem[] {
  const related = [symbolToCryptoPanicCurrency(symbol)];
  return [
    {
      id: `fallback-${symbol.replace("/", "-").toLowerCase()}`,
      source: "System",
      sourceAttribution: "fallback placeholder",
      sourceProvider: "system",
      publishedAt: "Fallback",
      title: "Live news unavailable",
      summary: "No verified live article is currently available for this symbol. News is secondary context only and is not used to generate the core technical signal.",
      relatedCoins: related,
      sentimentLabel: "neutral",
      sentimentScore: 50,
      hasTargetPrice: false,
      sourceMode: "fallback",
    },
  ];
}

/** Synchronous honest fallback used before or instead of live news. */
export function getNews(symbol: Symbol): NewsItem[] {
  return buildFallbackNews(symbol);
}

type CryptoPanicPost = {
  id: number;
  title: string;
  source?: { title?: string };
  published_at: string;
  currencies?: { code: string }[];
};

type NewsApiArticle = {
  source?: { name?: string };
  title?: string;
  description?: string;
  publishedAt?: string;
};

const HANOI_TIME_ZONE = "Asia/Bangkok";
const CRYPTOPANIC_BASE = "https://cryptopanic.com/api/free/v1/posts/";
const NEWSAPI_BASE = "https://newsapi.org/v2/everything";

function symbolToCryptoPanicCurrency(symbol: Symbol): string {
  const map: Record<Symbol, string> = {
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
  return map[symbol] ?? "BTC";
}

function symbolToNewsQuery(symbol: Symbol): string {
  const map: Record<Symbol, string> = {
    "XAU/USDT": "gold OR XAU OR PAXG",
    "BTC/USDT": "bitcoin OR BTC",
    "ETH/USDT": "ethereum OR ETH",
    "SOL/USDT": "solana OR SOL",
    "BNB/USDT": "BNB OR binance coin",
    "XRP/USDT": "XRP OR ripple",
    "ADA/USDT": "cardano OR ADA",
    "DOGE/USDT": "dogecoin OR DOGE",
    "DOT/USDT": "polkadot OR DOT",
    "AVAX/USDT": "avalanche OR AVAX",
    "LINK/USDT": "chainlink OR LINK",
    "SUI/USDT": "SUI crypto",
  };
  return map[symbol] ?? "bitcoin OR crypto market";
}

function formatPublishedAtHanoi(value?: string): string {
  if (!value) return "Gần đây";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Gần đây";

  return `${new Intl.DateTimeFormat("vi-VN", {
    timeZone: HANOI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)} GMT+7`;
}

function mapToNewsItem(
  id: string,
  source: string,
  sourceAttribution: string,
  sourceProvider: NewsItem["sourceProvider"],
  title: string,
  summary: string,
  publishedAt: string | undefined,
  relatedCoins: string[],
): NewsItem {
  const sentiment = scoreSentiment(`${title} ${summary}`);
  return {
    id,
    source,
    sourceAttribution,
    sourceProvider,
    publishedAt: formatPublishedAtHanoi(publishedAt),
    title,
    summary,
    relatedCoins,
    sentimentLabel: sentiment.label,
    sentimentScore: sentiment.score,
    hasTargetPrice: /\$\d+|\btarget\b|mốc|kháng cự|support|resistance/i.test(`${title} ${summary}`),
    sourceMode: "live",
  };
}

async function fetchFromCryptoPanic(symbol: Symbol): Promise<NewsItem[]> {
  const params = new URLSearchParams({
    currencies: symbolToCryptoPanicCurrency(symbol),
    kind: "news",
    public: "true",
  });
  const apiKey = import.meta.env.VITE_CRYPTOPANIC_API_KEY;
  if (apiKey) params.set("auth_token", apiKey);

  const response = await fetch(`${CRYPTOPANIC_BASE}?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`CryptoPanic request failed: ${response.status}`);
  }

  const data = await response.json() as { results?: CryptoPanicPost[] };
  const posts = data.results ?? [];
  return posts.slice(0, 8).map((post, index) => mapToNewsItem(
    `cp-${post.id ?? index}`,
    post.source?.title || "Unknown publisher",
    "via CryptoPanic",
    "cryptopanic",
    post.title,
    post.title,
    post.published_at,
    post.currencies?.map(currency => currency.code) ?? [symbolToCryptoPanicCurrency(symbol)],
  ));
}

async function fetchFromNewsApi(symbol: Symbol): Promise<NewsItem[]> {
  const apiKey = import.meta.env.VITE_NEWSAPI_KEY;
  if (!apiKey) return [];

  const params = new URLSearchParams({
    q: symbolToNewsQuery(symbol),
    language: "en",
    sortBy: "publishedAt",
    pageSize: "8",
    apiKey,
  });

  const response = await fetch(`${NEWSAPI_BASE}?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`NewsAPI request failed: ${response.status}`);
  }

  const data = await response.json() as { articles?: NewsApiArticle[] };
  const articles = data.articles ?? [];
  return articles
    .filter(article => article.title)
    .slice(0, 8)
    .map((article, index) => mapToNewsItem(
      `newsapi-${index}`,
      article.source?.name || "Unknown publisher",
      "via NewsAPI",
      "newsapi",
      article.title || "Untitled",
      article.description || article.title || "",
      article.publishedAt,
      [symbolToCryptoPanicCurrency(symbol)],
    ));
}

export async function fetchNewsFromApi(symbol: Symbol): Promise<NewsItem[]> {
  const cryptoPanicItems = await fetchFromCryptoPanic(symbol).catch(() => []);
  if (cryptoPanicItems.length > 0) return cryptoPanicItems;

  const newsApiItems = await fetchFromNewsApi(symbol).catch(() => []);
  if (newsApiItems.length > 0) return newsApiItems;

  throw new Error(`No live news available for ${symbol}`);
}

/**
 * Async news fetcher — tries verified live providers first, then returns an honest fallback placeholder.
 * Live items are cached for 5 minutes; fallback items are cached briefly so the app retries live news sooner.
 */
const newsCache = new Map<string, CacheEntry>();

export async function getNewsAsync(symbol: Symbol): Promise<NewsItem[]> {
  const cached = newsCache.get(symbol);
  if (cached && Date.now() - cached.ts < cached.ttlMs) {
    return cached.items;
  }

  try {
    const items = await fetchNewsFromApi(symbol);
    newsCache.set(symbol, { items, ts: Date.now(), ttlMs: LIVE_CACHE_TTL_MS });
    return items;
  } catch {
    const fallbackItems = getNews(symbol);
    newsCache.set(symbol, { items: fallbackItems, ts: Date.now(), ttlMs: FALLBACK_CACHE_TTL_MS });
    return fallbackItems;
  }
}

export function resetNewsCacheForTests(): void {
  newsCache.clear();
}
