import type {
  Symbol,
  CandleData,
  TimeframeSignal,
  MarketBias,
  MarketScenario,
  NewsItem,
  Trendline,
} from "./types";

// ── Seeded pseudo-random so values are deterministic per symbol ──────────────
function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

// ── Candle generation ─────────────────────────────────────────────────────────
export function generateCandles(symbol: Symbol, count = 80): CandleData[] {
  const rand = seededRand(symbol === "XAU/USDT" ? 42 : 77);
  const basePrice = symbol === "XAU/USDT" ? 3110 : 83500;
  const volatility = symbol === "XAU/USDT" ? 12 : 800;

  const candles: CandleData[] = [];
  let price = basePrice;
  const nowSec = Math.floor(Date.now() / 1000);
  const interval = 3600; // 1-hour candles

  for (let i = count; i >= 0; i--) {
    const change = (rand() - 0.49) * volatility;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + rand() * volatility * 0.4;
    const low = Math.min(open, close) - rand() * volatility * 0.4;
    candles.push({
      time: nowSec - i * interval,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
    });
    price = close;
  }
  return candles;
}

// ── Pivot calculation (Classic) ───────────────────────────────────────────────
function calcPivot(candles: CandleData[]) {
  const last = candles[candles.length - 2]; // previous completed candle
  const pivot = (last.high + last.low + last.close) / 3;
  const r1 = 2 * pivot - last.low;
  const s1 = 2 * pivot - last.high;
  const r2 = pivot + (last.high - last.low);
  const s2 = pivot - (last.high - last.low);
  return { pivot, r1, s1, r2, s2 };
}

// ── Swing detection ───────────────────────────────────────────────────────────
function detectSwings(candles: CandleData[], window = 5) {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = window; i < candles.length - window; i++) {
    const slice = candles.slice(i - window, i + window + 1);
    const maxH = Math.max(...slice.map((c) => c.high));
    const minL = Math.min(...slice.map((c) => c.low));
    if (candles[i].high === maxH) highs.push(i);
    if (candles[i].low === minL) lows.push(i);
  }
  return { highs, lows };
}

// ── Trendlines ────────────────────────────────────────────────────────────────
export function buildTrendlines(candles: CandleData[]): Trendline[] {
  const { highs, lows } = detectSwings(candles);
  const lines: Trendline[] = [];

  // Descending trendline from two swing highs
  for (let i = 0; i + 1 < highs.length; i++) {
    const a = candles[highs[i]];
    const b = candles[highs[i + 1]];
    if (b.high < a.high) {
      lines.push({
        id: `desc-${i}`,
        kind: "descending",
        x1: highs[i],
        y1: a.high,
        x2: highs[i + 1],
        y2: b.high,
        active: true,
      });
    }
  }

  // Ascending trendline from two swing lows
  for (let i = 0; i + 1 < lows.length; i++) {
    const a = candles[lows[i]];
    const b = candles[lows[i + 1]];
    if (b.low > a.low) {
      lines.push({
        id: `asc-${i}`,
        kind: "ascending",
        x1: lows[i],
        y1: a.low,
        x2: lows[i + 1],
        y2: b.low,
        active: true,
      });
    }
  }

  return lines.slice(0, 5);
}

// ── Timeframe signals ─────────────────────────────────────────────────────────
const TF_WEIGHTS: Record<string, number> = {
  "15M": 1,
  "1H": 2,
  "2H": 2,
  "4H": 3,
  "6H": 4,
  "8H": 4,
  "12H": 5,
  "1D": 6,
};

export function computeTimeframeSignals(
  candles: CandleData[],
  symbol: Symbol
): TimeframeSignal[] {
  const timeframes = ["15M", "1H", "2H", "4H", "6H", "8H", "12H", "1D"] as const;
  const rand = seededRand(symbol === "XAU/USDT" ? 99 : 55);
  const currentPrice = candles[candles.length - 1].close;
  const { pivot, r1, s1, r2, s2 } = calcPivot(candles);

  return timeframes.map((tf) => {
    const noise = (rand() - 0.5) * 0.2;
    const momentumRaw = (currentPrice - pivot) / pivot + noise;

    const score = Math.max(0, Math.min(100, 50 + momentumRaw * 300));
    const bias =
      score > 55 ? "bullish" : score < 45 ? "bearish" : "neutral";

    const spread = (r1 - s1) * 0.3 + rand() * (r2 - s2) * 0.1;
    const bullishLevel = +(pivot + spread * (0.5 + rand() * 0.5)).toFixed(2);
    const bearishLevel = +(pivot - spread * (0.5 + rand() * 0.5)).toFixed(2);

    return { timeframe: tf, bullishLevel, bearishLevel, bias, score };
  });
}

// ── Global bias ────────────────────────────────────────────────────────────────
export function computeBias(signals: TimeframeSignal[]): MarketBias {
  let totalWeight = 0;
  let bullishWeight = 0;

  for (const s of signals) {
    const w = TF_WEIGHTS[s.timeframe];
    totalWeight += w;
    bullishWeight += (s.score / 100) * w;
  }

  const bullishPercent = Math.round((bullishWeight / totalWeight) * 100);
  const bearishPercent = 100 - bullishPercent;
  return {
    bullishPercent,
    bearishPercent,
    dominantSide: bullishPercent >= 50 ? "long" : "short",
  };
}

// ── Market scenario ────────────────────────────────────────────────────────────
export function buildScenario(
  candles: CandleData[],
  symbol: Symbol
): MarketScenario {
  const { pivot, r1, s1 } = calcPivot(candles);
  const currentPrice = candles[candles.length - 1].close;
  const trendlines = buildTrendlines(candles);

  let targetPrice: number;
  let pendingLong: number;
  let pendingShort: number;
  let explanationLines: string[];

  if (currentPrice < pivot) {
    targetPrice = +pivot.toFixed(2);
    pendingLong = +s1.toFixed(2);
    pendingShort = +pivot.toFixed(2);
    explanationLines = [
      `Giá đang ở phía dưới Pivot (${pivot.toFixed(2)})`,
      `có xu hướng tiến về Pivot`,
      `canh long tại ${s1.toFixed(2)} khi giá retest vùng hỗ trợ`,
      `entry short nếu giá bác pivot tại ${pivot.toFixed(2)}`,
    ];
  } else {
    targetPrice = +r1.toFixed(2);
    pendingLong = +pivot.toFixed(2);
    pendingShort = +r1.toFixed(2);
    explanationLines = [
      `Giá đang ở phía trên Pivot (${pivot.toFixed(2)})`,
      `có xu hướng tiến về Resistance R1 (${r1.toFixed(2)})`,
      `canh long tại ${pivot.toFixed(2)} khi giá retest pivot`,
      `entry short nếu giá bác R1 tại ${r1.toFixed(2)}`,
    ];
  }

  return {
    symbol,
    pivot: +pivot.toFixed(2),
    currentPrice: +currentPrice.toFixed(2),
    targetPrice,
    pendingLong,
    pendingShort,
    explanation: explanationLines.join(". "),
    explanationLines,
    trendlines,
  };
}

// ── News ───────────────────────────────────────────────────────────────────────
export function generateNews(symbol: Symbol): NewsItem[] {
  const isGold = symbol === "XAU/USDT";

  const goldNews: NewsItem[] = [
    {
      id: "n1",
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
      id: "n2",
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
      id: "n3",
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
      id: "n4",
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

  const btcNews: NewsItem[] = [
    {
      id: "n5",
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
      id: "n6",
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
      id: "n7",
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
      id: "n8",
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

  return isGold ? goldNews : btcNews;
}
