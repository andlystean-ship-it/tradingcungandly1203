import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import "./App.css";
import type { Symbol, Direction, NewsItem } from "./types";
import { getNews, getNewsAsync } from "./engine/index";
import { useEngine } from "./hooks/useEngine";
import { useSettings } from "./hooks/useSettings";
import { useAlerts } from "./hooks/useAlerts";
import Header from "./components/Header";
import BiasBar from "./components/BiasBar";
import TimeframeStrip from "./components/TimeframeStrip";
import MainChart from "./components/MainChart";
import ChartTabs from "./components/ChartTabs";
import NewsPanel from "./components/NewsPanel";
import DataSourceBadge from "./components/DataSourceBadge";
import SettingsPanel from "./components/SettingsPanel";
import SignalHistoryPanel from "./components/SignalHistoryPanel";

export default function App() {
  const { t } = useTranslation();
  const {
    settings,
    setTheme,
    setLanguage,
    setLastSymbol,
    setEngineConfig,
    addAlert,
    removeAlert,
    triggerAlert,
  } = useSettings();

  const [symbol, setSymbol] = useState<Symbol>(settings.lastSymbol);
  const [direction, setDirection] = useState<Direction>("long");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [news, setNews] = useState<NewsItem[]>(() => getNews(symbol));

  const { output: engine, loading, initializing, error, isStale } = useEngine(symbol, {
    refreshIntervalSec: settings.engineConfig.refreshIntervalSec,
    minSwingDistance: settings.engineConfig.minSwingDistance,
    minPriceSeparationPct: settings.engineConfig.minPriceSeparationPct,
  });

  // Sync symbol to settings
  const handleSymbolChange = (s: Symbol) => {
    setSymbol(s);
    setLastSymbol(s);
  };

  // Fetch live news with a short-lived honest fallback when no verified feed is available.
  useEffect(() => {
    let cancelled = false;
    getNewsAsync(symbol).then((items) => {
      if (!cancelled) setNews(items);
    });
    return () => { cancelled = true; };
  }, [symbol]);

  // Price alert monitoring
  useAlerts(
    symbol,
    engine?.marketScenario.currentPrice,
    settings.alerts,
    { triggerAlert },
  );

  // Show a minimal skeleton while the very first fetch resolves
  if (initializing) {
    return (
      <div className="app">
        <Header
          direction={direction}
          symbol={symbol}
          onDirectionChange={setDirection}
          onSymbolChange={handleSymbolChange}
          onSettingsOpen={() => setSettingsOpen(true)}
        />
        <div className="loading-screen">
          <div className="loading-spinner" />
          <div className="loading-text">{t("loading.market")}</div>
        </div>
      </div>
    );
  }

  if (!engine) {
    return (
      <div className="app">
        <Header
          direction={direction}
          symbol={symbol}
          onDirectionChange={setDirection}
          onSymbolChange={handleSymbolChange}
          onSettingsOpen={() => setSettingsOpen(true)}
        />
        <div className="loading-screen loading-error-screen">
          <div className="loading-text loading-error-title">{t("loading.errorTitle")}</div>
          <div className="loading-text loading-error-body">
            {error ?? t("loading.errorBody")}
          </div>
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
        onSymbolChange={handleSymbolChange}
        onSettingsOpen={() => setSettingsOpen(true)}
      />
      <DataSourceBadge
        source={engine.dataStatus.sourceStatus}
        sourceMode={engine.dataStatus.sourceMode}
        loading={loading}
        lastUpdated={engine.dataStatus.lastUpdated}
        warning={isStale ? t("dataSource.staleWarning") : engine.dataStatus.warning}
        provider={engine.dataStatus.provider}
        proxyWarning={engine.dataStatus.proxyWarning}
      />
      <BiasBar bias={engine.marketBias} />
      <TimeframeStrip signals={engine.timeframeSignals} entriesByTF={engine.marketScenario.entriesByTF} />
      <MainChart
        candleMap={engine.candleMap}
        scenario={engine.marketScenario}
        theme={settings.theme}
      />
      <ChartTabs
        scenario={engine.marketScenario}
        trendContext={engine.trendContext}
        marketBias={engine.marketBias}
        dataStatus={engine.dataStatus}
      />
      <SignalHistoryPanel symbol={symbol} />
      <NewsPanel news={news} symbol={symbol} />
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={settings.theme}
        language={settings.language}
        symbol={symbol}
        alerts={settings.alerts}
        engineConfig={settings.engineConfig}
        onThemeChange={setTheme}
        onLanguageChange={setLanguage}
        onAddAlert={addAlert}
        onRemoveAlert={removeAlert}
        onEngineConfigChange={setEngineConfig}
      />
    </div>
  );
}
