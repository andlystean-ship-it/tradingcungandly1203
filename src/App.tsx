import { useState } from "react";
import "./App.css";
import type { Symbol, Direction } from "./types";
import { getNews } from "./engine/index";
import { useEngine } from "./hooks/useEngine";
import Header from "./components/Header";
import BiasBar from "./components/BiasBar";
import TimeframeStrip from "./components/TimeframeStrip";
import MainChart from "./components/MainChart";
import ChartTabs from "./components/ChartTabs";
import NewsPanel from "./components/NewsPanel";
import DataSourceBadge from "./components/DataSourceBadge";

export default function App() {
  const [symbol, setSymbol] = useState<Symbol>("XAU/USDT");
  const [direction, setDirection] = useState<Direction>("long");

  const { output: engine, loading, initializing } = useEngine(symbol);
  const news = getNews(symbol);

  // Show a minimal skeleton while the very first fetch resolves
  if (initializing) {
    return (
      <div className="app">
        <Header
          direction={direction}
          symbol={symbol}
          onDirectionChange={setDirection}
          onSymbolChange={setSymbol}
        />
        <div className="loading-screen">
          <div className="loading-spinner" />
          <div className="loading-text">Đang tải dữ liệu thị trường…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        direction={direction}
        symbol={symbol}
        onDirectionChange={setDirection}
        onSymbolChange={setSymbol}
      />
      <DataSourceBadge
        source={engine.dataStatus.sourceStatus}
        loading={loading}
        lastUpdated={engine.dataStatus.lastUpdated}
        warning={engine.dataStatus.warning}
      />
      <BiasBar bias={engine.marketBias} />
      <TimeframeStrip signals={engine.timeframeSignals} />
      <MainChart candleMap={engine.candleMap} scenario={engine.marketScenario} />
      <ChartTabs scenario={engine.marketScenario} />
      <NewsPanel news={news} symbol={symbol} />
    </div>
  );
}
