/**
 * useEngine.ts
 * React hook that manages the async engine lifecycle:
 *   - Fetches real Binance candles on mount and symbol change
 *   - Last-good-snapshot: keeps previous valid output during refresh/symbol-change
 *   - Marks data as stale if refresh fails (keeps last-good-snapshot)
 *   - Auto-refreshes on configurable interval (default 3s)
 *   - Prevents overlapping refreshes when the previous request is still running
 *   - Accepts configurable engine parameters for swing/trendline tuning
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { Symbol, EngineOutput, Timeframe, CandleData } from "../types";
import { runEngineAsync, type EngineConfig as CoreEngineConfig } from "../engine/index";
import { recordSignal } from "../engine/signal-history";
import { BinanceWsClient } from "../engine/ws-client";

export type EngineConfig = {
  /** Minimum swing distance (candle indices) — passed to engine for future use */
  minSwingDistance?: number;
  /** Minimum price separation for SR dedup (percent) */
  minPriceSeparationPct?: number;
  /** Auto-refresh interval in seconds */
  refreshIntervalSec?: number;
};

export type EngineState = {
  output: EngineOutput | null;
  loading: boolean;
  /** true on the very first load (no data yet) */
  initializing: boolean;
  error: string | null;
  /** true when we're showing stale data because latest refresh failed */
  isStale: boolean;
};

/** Default refresh interval */
const DEFAULT_REFRESH_SEC = 3;
const WS_HEALTHY_REFRESH_FLOOR_MS = 45_000;
const WS_TRIGGER_TIMEFRAMES: Timeframe[] = ["15M", "1H", "2H", "4H", "6H", "8H", "12H", "1D", "1W"];
const WS_REFRESH_COOLDOWN_MS = 1200;
const REALTIME_MAX_CANDLES_PER_TF = 2000;

function mergeRealtimeCandle(
  prev: EngineOutput,
  timeframe: Timeframe,
  candle: CandleData,
): EngineOutput {
  const tfCandles = prev.candleMap[timeframe];
  if (!tfCandles || tfCandles.length === 0) return prev;

  const nextTfCandles = [...tfCandles];
  const last = nextTfCandles[nextTfCandles.length - 1];

  if (!last) {
    nextTfCandles.push(candle);
  } else if (candle.time < last.time) {
    return prev;
  } else if (candle.time === last.time) {
    nextTfCandles[nextTfCandles.length - 1] = {
      ...last,
      open: last.open,
      high: Math.max(last.high, candle.high),
      low: Math.min(last.low, candle.low),
      close: candle.close,
      volume: candle.volume ?? last.volume,
    };
  } else {
    nextTfCandles.push(candle);
    const maxLen = Math.max(tfCandles.length, REALTIME_MAX_CANDLES_PER_TF);
    while (nextTfCandles.length > maxLen) {
      nextTfCandles.shift();
    }
  }

  const nextCandleMap = {
    ...prev.candleMap,
    [timeframe]: nextTfCandles,
  };

  const now = new Date().toISOString();
  const next: EngineOutput = {
    ...prev,
    lastUpdated: now,
    candleMap: nextCandleMap,
    dataStatus: {
      ...prev.dataStatus,
      lastUpdated: now,
    },
  };

  if (timeframe === "1H") {
    const chartLen = prev.chartCandles.length > 0 ? prev.chartCandles.length : REALTIME_MAX_CANDLES_PER_TF;
    next.chartCandles = nextTfCandles.slice(-chartLen);
    next.currentPrice = candle.close;
    next.marketScenario = {
      ...prev.marketScenario,
      currentPrice: candle.close,
    };
  }

  return next;
}

export function useEngine(symbol: Symbol, config?: EngineConfig): EngineState {
  const refreshInterval = Math.max(1, config?.refreshIntervalSec ?? DEFAULT_REFRESH_SEC) * 1000;

  const [output, setOutput] = useState<EngineOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [wsOnline, setWsOnline] = useState(false);

  const effectiveRefreshInterval = wsOnline
    ? Math.max(refreshInterval, WS_HEALTHY_REFRESH_FLOOR_MS)
    : refreshInterval;

  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  const isRefreshingRef = useRef(false);
  const lastWsRefreshAtRef = useRef(0);
  const lockedEntryRef = useRef<{ side: "long" | "short"; entry: number; invalidation: number } | null>(null);

  const refresh = useCallback(async (isInitial: boolean) => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    setLoading(true);
    try {
      const coreConfig: CoreEngineConfig | undefined =
        (config?.minSwingDistance != null || config?.minPriceSeparationPct != null)
          ? {
              minSwingDistance: config.minSwingDistance,
              minPriceSeparationPct: config.minPriceSeparationPct,
            }
          : undefined;
      const result = await runEngineAsync(symbolRef.current, coreConfig, lockedEntryRef.current ?? undefined);
      // Only apply if symbol hasn't changed while we were fetching
      if (result.symbol === symbolRef.current) {
        setOutput(result);
        setError(null);
        setIsStale(false);

        // Record signal snapshot for history
        recordSignal(result.symbol, result.marketScenario, result.marketBias);

        // If we just entered an active state, lock the entry so it doesn't shift
        const status = result.marketScenario.status;
        if (status === "active_long") {
          lockedEntryRef.current = {
            side: "long",
            entry: result.marketScenario.pendingLong,
            invalidation: result.marketScenario.invalidationLevel,
          };
        } else if (status === "active_short") {
          lockedEntryRef.current = {
            side: "short",
            entry: result.marketScenario.pendingShort,
            invalidation: result.marketScenario.invalidationLevel,
          };
        } else if (status === "invalidated" || status === "watching" || status === "idle") {
          lockedEntryRef.current = null;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Engine error";
      setError(msg);
      // On initial load failure: output stays null (will show loading state)
      // On refresh failure: keep last-good-snapshot, mark stale
      if (!isInitial) {
        setIsStale(true);
      }
    } finally {
      isRefreshingRef.current = false;
      setLoading(false);
      if (isInitial) setInitializing(false);
    }
  }, [config?.minSwingDistance, config?.minPriceSeparationPct]);

  useEffect(() => {
    let cancelled = false;

    // Reset state for new symbol — keep last output visible (last-good-snapshot)
    lockedEntryRef.current = null;
    setInitializing(output === null || output.symbol !== symbol);
    setLoading(true);
    setError(null);
    setIsStale(false);

    let timer: ReturnType<typeof setTimeout> | undefined;

    const doRefresh = async (isInitial: boolean) => {
      if (cancelled) return;
      await refresh(isInitial);
      if (!cancelled) {
        timer = setTimeout(() => {
          void doRefresh(false);
        }, refreshInterval);
      }
    };

    void doRefresh(true);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, effectiveRefreshInterval]);

  useEffect(() => {
    if (typeof WebSocket === "undefined") return;

    const wsClient = new BinanceWsClient({
      symbol,
      timeframes: WS_TRIGGER_TIMEFRAMES,
      onOpen: () => {
        setWsOnline(true);
      },
      onClose: () => {
        setWsOnline(false);
      },
      onUpdate: ({ timeframe, candle, isClosed }) => {
        setOutput((prev) => {
          if (!prev || prev.symbol !== symbol) return prev;
          return mergeRealtimeCandle(prev, timeframe, candle);
        });
        setIsStale(false);

        if (!isClosed) return;
        const now = Date.now();
        if (now - lastWsRefreshAtRef.current < WS_REFRESH_COOLDOWN_MS) return;
        lastWsRefreshAtRef.current = now;
        void refresh(false);
      },
      onError: () => {
        // Polling refresh remains as fallback path.
      },
    });

    wsClient.connect();
    return () => {
      wsClient.disconnect();
      setWsOnline(false);
    };
  }, [symbol, refresh]);

  return { output, loading, initializing, error, isStale };
}
