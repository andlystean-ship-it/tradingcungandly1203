// ── Primitives ────────────────────────────────────────────────────────────────
export type Symbol =
  | "XAU/USDT"
  | "BTC/USDT"
  | "ETH/USDT"
  | "SOL/USDT"
  | "BNB/USDT"
  | "XRP/USDT"
  | "ADA/USDT"
  | "DOGE/USDT"
  | "DOT/USDT"
  | "AVAX/USDT"
  | "LINK/USDT"
  | "SUI/USDT";
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
  | "low_quality_setup"
  | "stale";

// ── Scenario state ─────────────────────────────────────────────────────────────
export type ScenarioState =
  | "bullish_primary"
  | "bearish_primary"
  | "neutral_transition"
  | "conflicted"
  | "low_quality_setup";

// ── Raw candle ────────────────────────────────────────────────────────────────
export type CandleData = {
  time: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
};

/** Candle map — may be partial if some TFs failed to fetch */
export type CandleMap = Partial<Record<Timeframe, CandleData[]>>;

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
  // ── Extended fields (from trend refactor) ──────────────────────────────────
  slope?: number;
  span?: number;
  touchCount?: number;
  violationCount?: number;
  role?: "dynamic_support" | "dynamic_resistance";
  sourceTimeframe?: string;
};

// ── Multi-timeframe trend context ────────────────────────────────────────────
export type TrendDirection = "bullish" | "bearish" | "neutral";
export type TrendAlignment =
  | "aligned_bullish"
  | "aligned_bearish"
  | "mixed"
  | "neutral";

export type TrendLayer = {
  direction: TrendDirection;
  activeTrendlines: Trendline[];
  dominantLine: Trendline | null;
  strength: number; // 0–100
};

export type TrendContext = {
  shortTerm: TrendLayer;
  mediumTerm: TrendLayer;
  higherTimeframe: TrendLayer;
  alignment: TrendAlignment;
  /** Aggregate trend pressure near current price (P4) */
  pressure?: TrendPressure;
  /** EMA crossover signal per timeframe (50/200) */
  emaCrossover?: {
    direction: TrendDirection;
    ema50: number;
    ema200: number;
  };
};

// ── Trend pressure model (P4) ────────────────────────────────────────────────
export type TrendPressure = {
  /** -100 (strong bearish) to +100 (strong bullish) */
  netPressure: number;
  /** How many active trendlines are within 1.5 ATR of price */
  nearbyLineCount: number;
  /** Recent trendline break direction, if any */
  recentBreak?: { direction: TrendDirection; recency: number };
  /** Recent retest of a broken level */
  recentRetest?: { direction: TrendDirection; held: boolean };
  /** Dominant pressure source description */
  dominantSource: string;
  /** HTF-only pressure component (-100 to +100) */
  htfPressure: number;
  /** Near-price support/resistance pressure from projected trendlines */
  nearPricePressure: number;
  /** Momentum-derived pressure from candle structure */
  momentumPressure: number;
  /** Summary dominant direction */
  dominantPressureDirection: TrendDirection;
  /** Overall pressure strength 0–100 */
  pressureStrength: number;
  /** Human-readable reason for the current pressure state */
  pressureReason: string;
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
  /** Per-component score breakdown */
  scoreBreakdown?: import("./engine/score-config").ScoreBreakdown;
  /** Metadata about bullish level selection */
  bullishLevelMeta?: LevelMeta;
  /** Metadata about bearish level selection */
  bearishLevelMeta?: LevelMeta;
};

export type LevelMeta = {
  selectedFrom: string;   // e.g. "swing-4H", "pivot-1D-r1"
  selectionReason: string;
  levelQuality: number;   // 0–100
};

// ── Bias debug metadata ───────────────────────────────────────────────────────
export type BiasDebug = {
  ltfBullishAvg: number;
  htfBullishAvg: number;
  conflictLevel: number;
  pivotProximityPenalty: number;
  trendPressurePenalty: number;
  trendlineAdjustment: number;
  neutralReason?: string;
};

// ── Global market bias ────────────────────────────────────────────────────────
export type MarketBias = {
  bullishPercent: number;
  bearishPercent: number;
  dominantSide: Direction | "neutral";
  confidence: number; // 0–100
  /** Debug metadata for audit / scenario consumption */
  debug?: BiasDebug;
};

// ── Directional scenario ──────────────────────────────────────────────────────
export type ScenarioSide = {
  side: Direction | "neutral";
  trigger: number;
  target: number;
  rationale: string;
};

// ── Per-timeframe entry (distinct entry/target/invalidation per TF) ───────────
export type TimeframeEntry = {
  tf: Timeframe;
  longEntry: number;
  shortEntry: number;
  target: number;
  invalidation: number;
  longReason: string;
  shortReason: string;
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
  // ── Debug / audit fields ───────────────────────────────────────────────────
  pendingLongReason?: string;
  pendingShortReason?: string;
  targetReason?: string;
  invalidationReason?: string;
  zone?: string; // e.g. "bull1", "trans", "bear1"
  /** Entry quality gate result for primary side */
  entryQuality?: EntryQuality;
  /** Entry quality gate result for alternate side */
  alternateQuality?: EntryQuality;
  /** Whether the primary scenario is actionable (passes quality + RR + confluence gates) */
  primaryScenarioIsActionable: boolean;
  /** Why the primary scenario was rejected, if not actionable */
  primaryRejectReason?: string;
  /** Per-timeframe entries with distinct S/R levels */
  entriesByTF?: TimeframeEntry[];
};

// ── Data freshness ────────────────────────────────────────────────────────────
export type TimeframeStatus = "live" | "stale" | "failed";

export type SourceMode = "live" | "partial" | "stale" | "unavailable" | "proxy";

export type DataStatus = {
  isStale: boolean;
  sourceStatus: "live" | "partial" | "stale" | "error";
  /** Granular source classification */
  sourceMode: SourceMode;
  warning?: string;
  lastUpdated: string; // ISO
  /** Per-timeframe fetch status — only present when some TFs failed */
  perTimeframe?: Partial<Record<Timeframe, TimeframeStatus>>;
  /** Count of live vs total timeframes */
  liveTfCount?: number;
  totalTfCount?: number;
  /** Provider label for honest data attribution */
  provider?: string;
  /** Actual trading pair used (e.g. PAXGUSDT for XAU) */
  actualPair?: string;
  /** Proxy warning if data source is an approximation */
  proxyWarning?: string;
  /** Whether data is from a proxy instrument (e.g. PAXG for XAU) */
  proxyMode?: boolean;
  /** Timeframe completeness 0–100 */
  timeframeCompleteness?: number;
  /** TFs that did not have live data and were excluded from analysis */
  missingTimeframes?: Timeframe[];
  /** ISO timestamp of last fully successful live fetch */
  lastSuccessfulLiveFetch?: string;
};

// ── Entry quality assessment (P2) ────────────────────────────────────────────
export type EntryQuality = {
  /** Is the setup good enough to show as pending? */
  tradeable: boolean;
  /** Reward-to-risk ratio */
  rewardRisk: number;
  /** Number of confluent factors supporting the entry */
  confluences: number;
  /** Individual confluence labels for explanation */
  confluenceLabels: string[];
  /** Overall quality 0–100 */
  qualityScore: number;
  /** Why the setup was rejected, if not tradeable */
  rejectReason?: string;
  /** Per-factor quality breakdown */
  factors: {
    structureQuality: number;    // 0–100: swing/SR quality at entry level
    trendAlignment: number;      // 0–100: how well trend supports trade
    htfPressure: number;         // 0–100: HTF directional support
    distanceToInvalidation: number; // 0–100: wider = better (room to breathe)
    distanceToTarget: number;    // 0–100: not too far, not too close
    rewardRisk: number;          // 0–100: R:R contribution
  };
};

// ── Full engine output contract ───────────────────────────────────────────────
export type EngineOutput = {
  symbol: Symbol;
  currentPrice: number;
  lastUpdated: string;
  chartCandles: CandleData[]; // 1H candles used for chart rendering
  candleMap: CandleMap; // all timeframe candles (may be partial)
  marketBias: MarketBias;
  timeframeSignals: TimeframeSignal[];
  trendlines: Trendline[];
  trendContext: TrendContext;
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
