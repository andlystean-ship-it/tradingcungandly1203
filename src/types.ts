export type Symbol = "XAU/USDT" | "BTC/USDT";
export type Direction = "long" | "short";
export type Bias = "bullish" | "bearish" | "neutral";
export type Timeframe = "15M" | "1H" | "2H" | "4H" | "6H" | "8H" | "12H" | "1D";

export type MarketBias = {
  bullishPercent: number;
  bearishPercent: number;
  dominantSide: Direction;
};

export type TimeframeSignal = {
  timeframe: Timeframe;
  bullishLevel: number;
  bearishLevel: number;
  bias: Bias;
  score: number;
};

export type Trendline = {
  id: string;
  kind: "ascending" | "descending";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  active: boolean;
};

export type MarketScenario = {
  symbol: Symbol;
  pivot: number;
  currentPrice: number;
  targetPrice: number;
  pendingLong: number;
  pendingShort: number;
  explanation: string;
  explanationLines: string[];
  trendlines: Trendline[];
};

export type NewsItem = {
  id: string;
  source: string;
  publishedAt: string;
  title: string;
  summary: string;
  relatedCoins: string[];
  sentimentLabel: Bias;
  sentimentScore: number;
  hasTargetPrice: boolean;
};

export type CandleData = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};
