import { useState, useMemo } from "react";
import "./App.css";
import type { Symbol, Direction } from "./types";
import {
  generateCandles,
  computeTimeframeSignals,
  computeBias,
  buildScenario,
  generateNews,
} from "./engine";
import Header from "./components/Header";
import BiasBar from "./components/BiasBar";
import TimeframeStrip from "./components/TimeframeStrip";
import MainChart from "./components/MainChart";
import ChartTabs from "./components/ChartTabs";
import NewsPanel from "./components/NewsPanel";

export default function App() {
  const [symbol, setSymbol] = useState<Symbol>("XAU/USDT");
  const [direction, setDirection] = useState<Direction>("long");

  const candles = useMemo(() => generateCandles(symbol), [symbol]);
  const signals = useMemo(
    () => computeTimeframeSignals(candles, symbol),
    [candles, symbol]
  );
  const bias = useMemo(() => computeBias(signals), [signals]);
  const scenario = useMemo(
    () => buildScenario(candles, symbol),
    [candles, symbol]
  );
  const news = useMemo(() => generateNews(symbol), [symbol]);

  return (
    <div className="app">
      <Header
        direction={direction}
        symbol={symbol}
        onDirectionChange={setDirection}
        onSymbolChange={setSymbol}
      />
      <BiasBar bias={bias} />
      <TimeframeStrip signals={signals} />
      <MainChart candles={candles} scenario={scenario} />
      <ChartTabs scenario={scenario} />
      <NewsPanel news={news} symbol={symbol} />
    </div>
  );
}
