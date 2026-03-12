/**
 * signal-history.ts
 * Persists signal snapshots to localStorage for the "Signal History" panel.
 * Stores the last N signals per symbol, deduplicating by timestamp.
 */

import type { Symbol, MarketScenario, MarketBias } from "../types";

export type SignalSnapshot = {
  id: string;
  symbol: Symbol;
  timestamp: string;
  primarySide: "long" | "short" | "neutral";
  status: string;
  confidence: number;
  pendingLong: number;
  pendingShort: number;
  targetPrice: number;
  bullishPercent: number;
  scenarioState: string;
};

const STORAGE_KEY = "trading-signal-history";
const MAX_SIGNALS_PER_SYMBOL = 50;

function loadHistory(): SignalSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SignalSnapshot[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: SignalSnapshot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // localStorage unavailable or full
  }
}

/** Record a signal snapshot. Deduplicates by timestamp+symbol. */
export function recordSignal(
  symbol: Symbol,
  scenario: MarketScenario,
  bias: MarketBias
): void {
  const history = loadHistory();
  const timestamp = new Date().toISOString();

  // Avoid duplicate within 30 seconds
  const recentCutoff = Date.now() - 30_000;
  const isDuplicate = history.some(
    s => s.symbol === symbol && new Date(s.timestamp).getTime() > recentCutoff
  );
  if (isDuplicate) return;

  const snapshot: SignalSnapshot = {
    id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    timestamp,
    primarySide: scenario.primaryScenario.side,
    status: scenario.status,
    confidence: bias.confidence,
    pendingLong: scenario.pendingLong,
    pendingShort: scenario.pendingShort,
    targetPrice: scenario.targetPrice,
    bullishPercent: bias.bullishPercent,
    scenarioState: scenario.scenarioState,
  };

  history.unshift(snapshot);

  // Keep max per symbol
  const symbolCounts = new Map<string, number>();
  const trimmed = history.filter(s => {
    const count = (symbolCounts.get(s.symbol) || 0) + 1;
    symbolCounts.set(s.symbol, count);
    return count <= MAX_SIGNALS_PER_SYMBOL;
  });

  saveHistory(trimmed);
}

/** Get signal history for a symbol */
export function getSignalHistory(symbol: Symbol): SignalSnapshot[] {
  return loadHistory().filter(s => s.symbol === symbol);
}

/** Clear all history */
export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
