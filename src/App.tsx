import { useState, useMemo } from "react";
import "./App.css";
import type { Symbol, Direction } from "./types";
import { runEngine, getNews, getChartCandles } from "./engine/index";
import Header from "./components/Header";
import BiasBar from "./components/BiasBar";
import TimeframeStrip from "./components/TimeframeStrip";
import MainChart from "./components/MainChart";
import ChartTabs from "./components/ChartTabs";
import NewsPanel from "./components/NewsPanel";

export default function App() {
  const [symbol, setSymbol] = useState<Symbol>("XAU/USDT");
  const [direction, setDirection] = useState<Direction>("long");

  // Engine runs once per symbol change — deterministic, no re-render drift
  const engine = useMemo(() => runEngine(symbol), [symbol]);
  const chartCandles = useMemo(() => getChartCandles(symbol), [symbol]);
  const news = useMemo(() => getNews(symbol), [symbol]);

  return (
    <div className="app">
      <Header
        direction={direction}
        symbol={symbol}
        onDirectionChange={setDirection}
        onSymbolChange={setSymbol}
      />
      <BiasBar bias={engine.marketBias} />
      <TimeframeStrip signals={engine.timeframeSignals} />
      <MainChart candles={chartCandles} scenario={engine.marketScenario} />
      <ChartTabs scenario={engine.marketScenario} />
      <NewsPanel news={news} symbol={symbol} />
    </div>
  );
}
