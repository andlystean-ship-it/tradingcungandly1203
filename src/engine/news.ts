/**
 * news.ts
 * News and sentiment as a SECONDARY context layer.
 *
 * Rules:
 * - News does not generate core signals
 * - News may adjust display context / caution text
 * - Primary source: CryptoPanic API (via news-api.ts)
 * - Fallback: static news arrays below
 * - Sentiment values are deterministic (no random)
 */

import type { NewsItem, Symbol } from "../types";
import { fetchNews as fetchLiveNews } from "./news-api";

const XAU_NEWS: NewsItem[] = [
  {
    id: "xau-1",
    source: "Reuters",
    publishedAt: "2 giờ trước",
    title: "Vàng tăng mạnh nhờ lo ngại địa chính trị",
    summary:
      "Giá vàng giao ngay tiến gần mốc $3,150/oz khi căng thẳng ở Trung Đông leo thang, nhà đầu tư chuyển sang tài sản trú ẩn an toàn.",
    relatedCoins: ["XAU", "USD"],
    sentimentLabel: "bullish",
    sentimentScore: 72,
    hasTargetPrice: true,
  },
  {
    id: "xau-2",
    source: "Bloomberg",
    publishedAt: "4 giờ trước",
    title: "Fed giữ lãi suất, USD suy yếu hỗ trợ vàng",
    summary:
      "Cục Dự trữ Liên bang giữ nguyên lãi suất, đồng USD giảm nhẹ, tạo điều kiện thuận lợi cho vàng duy trì đà tăng trong ngắn hạn.",
    relatedCoins: ["XAU", "USD", "DXY"],
    sentimentLabel: "bullish",
    sentimentScore: 65,
    hasTargetPrice: false,
  },
  {
    id: "xau-3",
    source: "Kitco News",
    publishedAt: "6 giờ trước",
    title: "Kỹ thuật vàng: Ngưỡng kháng cự quan trọng tại $3,200",
    summary:
      "Phân tích kỹ thuật cho thấy vàng đang tiếp cận vùng kháng cự $3,200. Cần break rõ ràng để xác nhận xu hướng tăng tiếp theo.",
    relatedCoins: ["XAU"],
    sentimentLabel: "neutral",
    sentimentScore: 50,
    hasTargetPrice: true,
  },
  {
    id: "xau-4",
    source: "FXStreet",
    publishedAt: "8 giờ trước",
    title: "Nhu cầu vàng từ ngân hàng trung ương tiếp tục tăng",
    summary:
      "Các ngân hàng trung ương trên thế giới tiếp tục mua vàng để đa dạng hóa dự trữ, hỗ trợ nhu cầu cơ bản cho kim loại quý này.",
    relatedCoins: ["XAU"],
    sentimentLabel: "bullish",
    sentimentScore: 68,
    hasTargetPrice: false,
  },
];

const BTC_NEWS: NewsItem[] = [
  {
    id: "btc-1",
    source: "CoinDesk",
    publishedAt: "1 giờ trước",
    title: "Bitcoin consolidates near $84K as ETF inflows continue",
    summary:
      "Bitcoin duy trì vùng $84,000 với dòng tiền ETF vẫn tích cực. Các nhà phân tích kỳ vọng BTC sẽ tái kiểm tra $90,000 trong tuần tới.",
    relatedCoins: ["BTC", "ETH"],
    sentimentLabel: "bullish",
    sentimentScore: 70,
    hasTargetPrice: true,
  },
  {
    id: "btc-2",
    source: "The Block",
    publishedAt: "3 giờ trước",
    title: "Whale accumulation detected at $82K support",
    summary:
      "On-chain data cho thấy các địa chỉ lớn (whale) đang tích lũy BTC mạnh tại vùng $82,000-$83,000, tín hiệu tích cực cho xu hướng trung hạn.",
    relatedCoins: ["BTC"],
    sentimentLabel: "bullish",
    sentimentScore: 75,
    hasTargetPrice: false,
  },
  {
    id: "btc-3",
    source: "Cointelegraph",
    publishedAt: "5 giờ trước",
    title: "BTC miners selling pressure eases after halving",
    summary:
      "Áp lực bán từ thợ đào Bitcoin giảm dần sau halving, điều này lịch sử cho thấy thường trùng với giai đoạn tăng giá trung hạn.",
    relatedCoins: ["BTC"],
    sentimentLabel: "neutral",
    sentimentScore: 55,
    hasTargetPrice: false,
  },
  {
    id: "btc-4",
    source: "Decrypt",
    publishedAt: "7 giờ trước",
    title: "Macro outlook: Rate cuts to benefit risk assets including BTC",
    summary:
      "Triển vọng cắt giảm lãi suất của Fed trong Q3 được kỳ vọng sẽ hỗ trợ các tài sản rủi ro bao gồm Bitcoin trong nửa cuối năm.",
    relatedCoins: ["BTC", "ETH", "SOL"],
    sentimentLabel: "bullish",
    sentimentScore: 62,
    hasTargetPrice: true,
  },
];

const GENERIC_NEWS: NewsItem[] = [
  {
    id: "gen-1",
    source: "CoinDesk",
    publishedAt: "1 giờ trước",
    title: "Thị trường crypto đang trong giai đoạn tích lũy",
    summary: "Phần lớn các altcoin đang consolidation trong biên độ hẹp, chờ tín hiệu breakout rõ ràng từ BTC.",
    relatedCoins: ["BTC", "ETH", "ALT"],
    sentimentLabel: "neutral",
    sentimentScore: 50,
    hasTargetPrice: false,
  },
  {
    id: "gen-2",
    source: "The Block",
    publishedAt: "3 giờ trước",
    title: "Dòng tiền DeFi tăng trở lại trong tuần qua",
    summary: "TVL trên các protocol DeFi tăng 8% so với tuần trước, cho thấy tín hiệu risk-on đang quay lại thị trường.",
    relatedCoins: ["ETH", "SOL", "AVAX"],
    sentimentLabel: "bullish",
    sentimentScore: 62,
    hasTargetPrice: false,
  },
  {
    id: "gen-3",
    source: "Cointelegraph",
    publishedAt: "5 giờ trước",
    title: "Phân tích kỹ thuật: Altcoin season có thể bắt đầu",
    summary: "Chỉ số Altcoin Season Index đạt 60/100, cho thấy altcoin đang bắt đầu outperform BTC trong ngắn hạn.",
    relatedCoins: ["ALT", "ETH", "SOL"],
    sentimentLabel: "bullish",
    sentimentScore: 65,
    hasTargetPrice: false,
  },
];

/** Synchronous static news fallback */
export function getNews(symbol: Symbol): NewsItem[] {
  if (symbol === "XAU/USDT") return XAU_NEWS;
  if (symbol === "BTC/USDT") return BTC_NEWS;
  return GENERIC_NEWS;
}

/**
 * Async news fetcher — tries CryptoPanic API first, falls back to static.
 * Results are cached for 5 minutes per symbol to avoid quota exhaustion.
 */
const newsCache = new Map<string, { items: NewsItem[]; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getNewsAsync(symbol: Symbol): Promise<NewsItem[]> {
  const cached = newsCache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.items;
  }

  try {
    const items = await fetchLiveNews(symbol);
    newsCache.set(symbol, { items, ts: Date.now() });
    return items;
  } catch {
    return getNews(symbol);
  }
}
