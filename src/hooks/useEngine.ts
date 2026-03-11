/**
 * useEngine.ts
 * React hook that manages the async engine lifecycle:
 *   - Fetches real Binance candles on mount and symbol change
 *   - Falls back to deterministic demo candles on network failure
 *   - Exposes loading, error, and live/demo source status
 *   - Auto-refreshes every 60 seconds to pick up new candle closes
 */

import { useState, useEffect, useRef } from "react";
import type { Symbol, EngineOutput } from "../types";
import { runEngine, runEngineAsync } from "../engine/index";

export type EngineState = {
  output: EngineOutput;
  loading: boolean;
  /** true on the very first load (no data shown yet) */
  initializing: boolean;
  error: string | null;
};

/** How often to refresh live candle data (ms) */
const REFRESH_INTERVAL_MS = 60_000;

export function useEngine(symbol: Symbol): EngineState {
  // Seed with synchronous demo engine so the UI renders immediately
  const [output, setOutput] = useState<EngineOutput>(() => runEngine(symbol));
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track current symbol in a ref so the stale-closure in setInterval
  // always reads the latest value without needing to re-register the interval
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      setLoading(true);
      try {
        const result = await runEngineAsync(symbolRef.current);
        if (!cancelled) {
          setOutput(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          // Keep last valid output; just surface the error
          setError(err instanceof Error ? err.message : "Engine error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setInitializing(false);
        }
      }
    }

    // Immediately refresh demo output with real data
    setInitializing(true);
    // Reset to fresh demo output for the new symbol right away
    setOutput(runEngine(symbol));
    void refresh();

    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  return { output, loading, initializing, error };
}
