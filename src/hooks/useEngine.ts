/**
 * useEngine.ts
 * React hook that manages the async engine lifecycle:
 *   - Fetches real Binance candles on mount and symbol change
 *   - Last-good-snapshot: keeps previous valid output during refresh/symbol-change
 *   - Marks data as stale if refresh fails instead of falling back to demo
 *   - Auto-refreshes every 60 seconds to pick up new candle closes
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { Symbol, EngineOutput } from "../types";
import { runEngineAsync } from "../engine/index";

export type EngineState = {
  output: EngineOutput | null;
  loading: boolean;
  /** true on the very first load (no data yet) */
  initializing: boolean;
  error: string | null;
  /** true when we're showing stale data because latest refresh failed */
  isStale: boolean;
};

/** How often to refresh live candle data (ms) */
const REFRESH_INTERVAL_MS = 60_000;

export function useEngine(symbol: Symbol): EngineState {
  const [output, setOutput] = useState<EngineOutput | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  const refresh = useCallback(async (isInitial: boolean) => {
    setLoading(true);
    try {
      const result = await runEngineAsync(symbolRef.current);
      // Only apply if symbol hasn't changed while we were fetching
      if (result.symbol === symbolRef.current) {
        setOutput(result);
        setError(null);
        setIsStale(false);
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
      setLoading(false);
      if (isInitial) setInitializing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Reset state for new symbol — keep last output visible (last-good-snapshot)
    setInitializing(output === null || output.symbol !== symbol);
    setLoading(true);
    setError(null);
    setIsStale(false);

    const doRefresh = async (isInitial: boolean) => {
      if (cancelled) return;
      await refresh(isInitial);
    };

    void doRefresh(true);

    const interval = setInterval(() => {
      if (!cancelled) void doRefresh(false);
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  return { output, loading, initializing, error, isStale };
}
