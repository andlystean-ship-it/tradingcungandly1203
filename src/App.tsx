import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import "./App.css";
import type { Symbol, Direction, NewsItem } from "./types";
import { getNews, getNewsAsync } from "./engine/index";
import { fetchGeminiNews, isNewsCacheStale, getCachedNews } from "./engine/gemini";
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
    setGeminiApiKey,
    setGroqApiKey,
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

  // Fetch news: use AI providers if keys are set, otherwise fallback to CryptoPanic/NewsAPI
  const geminiKey = settings.geminiApiKey;
  const groqKey = settings.groqApiKey;
  const langRef = useRef(settings.language);
  useEffect(() => {
    langRef.current = settings.language;
  }, [settings.language]);

  const fetchNews = useCallback(async () => {
    if (geminiKey || groqKey) {
      // Only fetch from AI if cache is stale
      if (isNewsCacheStale(symbol)) {
        const items = await fetchGeminiNews(geminiKey, symbol, langRef.current, groqKey);
        if (items.length > 0) {
          setNews(items);
          return;
        }
      } else {
        const cached = getCachedNews();
        if (cached.length > 0) {
          setNews(cached);
          return;
        }
      }
    }
    // Fallback to existing providers
    const items = await getNewsAsync(symbol);
    setNews(items);
  }, [geminiKey, groqKey, symbol]);

  useEffect(() => {
    let cancelled = false;
    fetchNews().then(() => {
      if (cancelled) return;
    });

    // Auto-refresh every 10 minutes
    const interval = setInterval(() => {
      if (!cancelled) fetchNews();
    }, 10 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchNews]);

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
        engineConfig={settings.engineConfig}
        geminiApiKey={settings.geminiApiKey}
        groqApiKey={settings.groqApiKey}
        symbol={symbol}
      />
      <ChartTabs
        scenario={engine.marketScenario}
        trendContext={engine.trendContext}
        marketBias={engine.marketBias}
        dataStatus={engine.dataStatus}
        candleMap={engine.candleMap}
        symbol={symbol}
        geminiApiKey={settings.geminiApiKey}
        groqApiKey={settings.groqApiKey}
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
        geminiApiKey={settings.geminiApiKey}
        groqApiKey={settings.groqApiKey}
        onThemeChange={setTheme}
        onLanguageChange={setLanguage}
        onAddAlert={addAlert}
        onRemoveAlert={removeAlert}
        onEngineConfigChange={setEngineConfig}
        onGeminiApiKeyChange={setGeminiApiKey}
        onGroqApiKeyChange={setGroqApiKey}
      />
    </div>
  );
}
