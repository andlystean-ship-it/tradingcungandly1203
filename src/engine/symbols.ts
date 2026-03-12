/**
 * symbols.ts — Dynamic symbol list from Binance exchange info.
 *
 * Provides the full list of USDT spot trading pairs from Binance.
 * Used to let users choose from a broader set than the hardcoded 12.
 * Falls back to the static KNOWN_SYMBOLS list on network error.
 */

import type { Symbol } from "../types";

/** All symbols hardcoded in the type system */
export const KNOWN_SYMBOLS: Symbol[] = [
  "XAU/USDT", "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT",
  "ADA/USDT", "DOGE/USDT", "DOT/USDT", "AVAX/USDT", "LINK/USDT", "SUI/USDT",
];

/** Popular USDT pairs fetched dynamically from Binance */
let cachedExtraSymbols: string[] | null = null;
let fetchPromise: Promise<string[]> | null = null;

/**
 * Fetch USDT trading pairs from Binance exchange info.
 * Caches result for the lifetime of the page.
 * Returns only the pairs NOT already in KNOWN_SYMBOLS.
 */
export async function fetchExtraSymbols(): Promise<string[]> {
  if (cachedExtraSymbols !== null) return cachedExtraSymbols;

  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const resp = await fetch(
        "https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT",
        { signal: controller.signal },
      );
      clearTimeout(timeout);

      if (!resp.ok) {
        cachedExtraSymbols = [];
        return [];
      }

      const data = await resp.json() as {
        symbols?: { symbol: string; status: string; quoteAsset: string }[];
      };

      if (!data.symbols) {
        cachedExtraSymbols = [];
        return [];
      }

      const knownSet = new Set(KNOWN_SYMBOLS.map(s => s.replace("/", "")));

      // Filter: USDT quote, trading status, not already known
      const extras = data.symbols
        .filter(s =>
          s.quoteAsset === "USDT" &&
          s.status === "TRADING" &&
          !knownSet.has(s.symbol)
        )
        .map(s => {
          const base = s.symbol.replace("USDT", "");
          return `${base}/USDT`;
        })
        .sort();

      cachedExtraSymbols = extras;
      return extras;
    } catch {
      cachedExtraSymbols = [];
      return [];
    }
  })();

  return fetchPromise;
}

/**
 * Get the full list: known symbols first, then dynamic extras.
 */
export async function getAllSymbols(): Promise<string[]> {
  const extras = await fetchExtraSymbols();
  return [...KNOWN_SYMBOLS, ...extras];
}
