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
import type { Symbol, EngineOutput } from "../types";
import { runEngineAsync, type EngineConfig as CoreEngineConfig } from "../engine/index";
import { recordSignal } from "../engine/signal-history";

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

export function useEngine(symbol: Symbol, config?: EngineConfig): EngineState {
  const refreshInterval = Math.max(1, config?.refreshIntervalSec ?? DEFAULT_REFRESH_SEC) * 1000;

  const [output, setOutput] = useState<EngineOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  const isRefreshingRef = useRef(false);

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
      const result = await runEngineAsync(symbolRef.current, coreConfig);
      // Only apply if symbol hasn't changed while we were fetching
      if (result.symbol === symbolRef.current) {
        setOutput(result);
        setError(null);
        setIsStale(false);

        // Record signal snapshot for history
        recordSignal(result.symbol, result.marketScenario, result.marketBias);
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
  }, [symbol, refreshInterval]);

  return { output, loading, initializing, error, isStale };
}
