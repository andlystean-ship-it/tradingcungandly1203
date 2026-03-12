/**
 * ws-client.ts
 * WebSocket-based real-time candle feed from Binance.
 *
 * Strategy:
 *   - Connects to Binance kline stream for the selected symbol+timeframe
 *   - Updates the last candle in-place on each tick
 *   - On candle close, appends a new candle and triggers callback
 *   - Auto-reconnects with exponential backoff on disconnect
 *   - Keeps last-good snapshot in memory for fallback
 */

import type { CandleData, Symbol, Timeframe } from "../types";

const BINANCE_WS = "wss://stream.binance.com:9443/ws";

// Map our symbol names to Binance stream symbols
const SYMBOL_MAP: Record<Symbol, string> = {
  "XAU/USDT": "paxgusdt",
  "BTC/USDT": "btcusdt",
  "ETH/USDT": "ethusdt",
  "SOL/USDT": "solusdt",
  "BNB/USDT": "bnbusdt",
  "XRP/USDT": "xrpusdt",
  "ADA/USDT": "adausdt",
  "DOGE/USDT": "dogeusdt",
  "DOT/USDT": "dotusdt",
  "AVAX/USDT": "avaxusdt",
  "LINK/USDT": "linkusdt",
  "SUI/USDT": "suiusdt",
};

// Map our timeframe names to Binance interval strings
const TF_MAP: Record<Timeframe, string> = {
  "15M": "15m",
  "1H": "1h",
  "2H": "2h",
  "4H": "4h",
  "6H": "6h",
  "8H": "8h",
  "12H": "12h",
  "1D": "1d",
};

type KlinePayload = {
  e: string;
  k: {
    t: number;   // open time ms
    o: string;   // open
    h: string;   // high
    l: string;   // low
    c: string;   // close
    x: boolean;  // is candle closed?
  };
};

export type CandleUpdate = {
  timeframe: Timeframe;
  candle: CandleData;
  isClosed: boolean;
};

export type WsClientOptions = {
  symbol: Symbol;
  timeframes: Timeframe[];
  onUpdate: (update: CandleUpdate) => void;
  onError?: (error: string) => void;
  onReconnect?: (attempt: number) => void;
};

const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;

export class BinanceWsClient {
  private ws: WebSocket | null = null;
  private options: WsClientOptions;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private lastSnapshot = new Map<Timeframe, CandleData>();

  constructor(options: WsClientOptions) {
    this.options = options;
  }

  connect(): void {
    if (this.disposed) return;

    const binanceSymbol = SYMBOL_MAP[this.options.symbol];
    if (!binanceSymbol) return;

    // Build combined stream for all timeframes
    const streams = this.options.timeframes
      .map(tf => `${binanceSymbol}@kline_${TF_MAP[tf]}`)
      .join("/");

    const url = `${BINANCE_WS}/${streams}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as { data?: KlinePayload } | KlinePayload;
        const payload = "data" in data && data.data ? data.data : data as KlinePayload;

        if (payload.e !== "kline" || !payload.k) return;

        const k = payload.k;

        // Find which timeframe this belongs to
        const tf = this.options.timeframes.find(
          t => `${binanceSymbol}@kline_${TF_MAP[t]}` ===
            `${binanceSymbol}@kline_${TF_MAP[t]}`
        );

        // Determine timeframe from the stream data
        const matchedTf = Object.entries(TF_MAP).find(
          ([, v]) => event.data.includes(`"i":"${v}"`)
        );

        if (!matchedTf) return;

        const timeframe = matchedTf[0] as Timeframe;
        if (!this.options.timeframes.includes(timeframe)) return;

        const candle: CandleData = {
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
        };

        this.lastSnapshot.set(timeframe, candle);

        this.options.onUpdate({
          timeframe,
          candle,
          isClosed: k.x,
        });
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      if (!this.disposed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.options.onError?.("WebSocket connection error");
      this.ws?.close();
    };
  }

  /** Get last known candle for a timeframe (fallback snapshot) */
  getLastSnapshot(tf: Timeframe): CandleData | undefined {
    return this.lastSnapshot.get(tf);
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;

    this.reconnectAttempt++;
    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempt - 1),
      MAX_RECONNECT_DELAY
    );

    this.options.onReconnect?.(this.reconnectAttempt);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
