// ── Primitives ────────────────────────────────────────────────────────────────
export type Symbol = "XAU/USDT" | "BTC/USDT";
export type Direction = "long" | "short";
export type Bias = "bullish" | "bearish" | "neutral";
export type Timeframe = "15M" | "1H" | "2H" | "4H" | "6H" | "8H" | "12H" | "1D";

// ── Signal status ─────────────────────────────────────────────────────────────
export type SignalStatus =
  | "idle"
  | "watching"
  | "pending_long"
  | "pending_short"
  | "active_long"
  | "active_short"
  | "invalidated"
  | "stale";

// ── Scenario state ─────────────────────────────────────────────────────────────
export type ScenarioState =
  | "bullish_primary"
  | "bearish_primary"
  | "neutral_transition"
  | "conflicted";

// ── Raw candle ────────────────────────────────────────────────────────────────
export type CandleData = {
  time: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
};

// ── Trendline (from swing structure) ─────────────────────────────────────────
export type Trendline = {
  id: string;
  kind: "ascending" | "descending";
  x1: number; // candle index
  y1: number; // price
  x2: number;
  y2: number;
  strength: number; // 0–100
  active: boolean;
  broken: boolean;
};

// ── Per-timeframe signal ──────────────────────────────────────────────────────
export type TimeframeSignal = {
  timeframe: Timeframe;
  bullishLevel: number; // nearest resistance above price
  bearishLevel: number; // nearest support below price
  bullishScore: number; // 0–100
  bearishScore: number; // 0–100
  bias: Bias;
  strength: number; // timeframe weight (1–6)
};

// ── Global market bias ────────────────────────────────────────────────────────
export type MarketBias = {
  bullishPercent: number;
  bearishPercent: number;
  dominantSide: Direction;
  confidence: number; // 0–100
};

// ── Directional scenario ──────────────────────────────────────────────────────
export type ScenarioSide = {
  side: Direction;
  trigger: number;
  target: number;
  rationale: string;
};

// ── Full market scenario ──────────────────────────────────────────────────────
export type MarketScenario = {
  symbol: Symbol;
  pivot: number;
  currentPrice: number;
  targetPrice: number;
  pendingLong: number;
  pendingShort: number;
  r1: number;
  s1: number;
  r2: number;
  s2: number;
  primaryScenario: ScenarioSide;
  alternateScenario: ScenarioSide;
  explanationLines: string[];
  cautionText?: string;
  invalidationLevel: number;
  scenarioState: ScenarioState;
  status: SignalStatus;
  trendlines: Trendline[];
  // ── Debug / audit fields (optional) ────────────────────────────────────────
  pendingLongReason?: string;
  pendingShortReason?: string;
  targetReason?: string;
  invalidationReason?: string;
  zone?: string; // e.g. "bull1", "trans", "bear1"
};

// ── Data freshness ────────────────────────────────────────────────────────────
export type DataStatus = {
  isStale: boolean;
  sourceStatus: "live" | "demo" | "stale" | "error";
  warning?: string;
  lastUpdated: string; // ISO
};

// ── Full engine output contract ───────────────────────────────────────────────
export type EngineOutput = {
  symbol: Symbol;
  currentPrice: number;
  lastUpdated: string;
  chartCandles: CandleData[]; // 1H candles used for chart rendering
  marketBias: MarketBias;
  timeframeSignals: TimeframeSignal[];
  trendlines: Trendline[];
  marketScenario: MarketScenario;
  dataStatus: DataStatus;
};

// ── News (secondary context layer) ───────────────────────────────────────────
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
