import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CandleMap, DataStatus, MarketBias, MarketScenario, Symbol, TrendContext, TrendLayer, Trendline } from "../types";
import { analyzeWithGemini, getCachedAnalysis, type GeminiAnalysis } from "../engine/gemini";
import { TF_WEIGHTS } from "../engine/scoring";

type TabId = "signals" | "analysis" | "trendlines" | "entries";

type Props = {
  scenario: MarketScenario;
  trendContext: TrendContext;
  marketBias: MarketBias;
  dataStatus: DataStatus;
  candleMap: CandleMap;
  symbol: Symbol;
  geminiApiKey: string;
  groqApiKey: string;
};

export default function ChartTabs({ scenario, trendContext, marketBias, dataStatus, candleMap, symbol, geminiApiKey, groqApiKey }: Props) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>("signals");
  const activeTrendlines = useMemo(
    () => scenario.trendlines.filter((trendline) => trendline.active),
    [scenario.trendlines],
  );

  return (
    <>
      <div className="chart-tabs" role="tablist">
        <button
          className={`chart-tab ${activeTab === "signals" ? "active" : ""}`}
          onClick={() => setActiveTab("signals")}
          role="tab"
          aria-selected={activeTab === "signals"}
        >
          <span className="chart-tab-icon" aria-hidden="true">●</span>
          <span>{t("tabs.signals")}</span>
        </button>
        <button
          className={`chart-tab ${activeTab === "analysis" ? "active" : ""}`}
          onClick={() => setActiveTab("analysis")}
          role="tab"
          aria-selected={activeTab === "analysis"}
        >
          <span className="chart-tab-icon" aria-hidden="true">AI</span>
          <span>{t("tabs.analysis")}</span>
        </button>
        <button
          className={`chart-tab ${activeTab === "trendlines" ? "active" : ""}`}
          onClick={() => setActiveTab("trendlines")}
          role="tab"
          aria-selected={activeTab === "trendlines"}
        >
          <span className="chart-tab-icon" aria-hidden="true">TL</span>
          <span>{t("tabs.trendlines")}</span>
          <span className="trend-count">{activeTrendlines.length}</span>
        </button>
        <button
          className={`chart-tab ${activeTab === "entries" ? "active" : ""}`}
          onClick={() => setActiveTab("entries")}
          role="tab"
          aria-selected={activeTab === "entries"}
        >
          <span className="chart-tab-icon" aria-hidden="true">E</span>
          <span>{t("tabs.entries")}</span>
        </button>
      </div>

      <div className="tab-content" role="tabpanel">
        {activeTab === "signals" && <SignalsTab scenario={scenario} />}
        {activeTab === "analysis" && (
          <AnalysisTab
            scenario={scenario}
            trendContext={trendContext}
            marketBias={marketBias}
            dataStatus={dataStatus}
            candleMap={candleMap}
            symbol={symbol}
            geminiApiKey={geminiApiKey}
            groqApiKey={groqApiKey}
          />
        )}
        {activeTab === "trendlines" && <TrendlinesTab trendlines={activeTrendlines} />}
        {activeTab === "entries" && <EntriesTab scenario={scenario} />}
      </div>
    </>
  );
}

function SignalsTab({ scenario }: { scenario: MarketScenario }) {
  const { t } = useTranslation();
  const fmt = (n: number) => (n >= 10000 ? n.toFixed(0) : n.toFixed(2));

  return (
    <div>
      <div className="signal-grid">
        <div className="signal-card long">
          <div className="signal-card-header">{t("signals.longEntry")}</div>
          <div className="signal-card-price">{fmt(scenario.pendingLong)}</div>
          <div className="signal-card-label">{t("signals.longAuto")}</div>
        </div>
        <div className="signal-card short">
          <div className="signal-card-header">{t("signals.shortEntry")}</div>
          <div className="signal-card-price">{fmt(scenario.pendingShort)}</div>
          <div className="signal-card-label">{t("signals.shortAuto")}</div>
        </div>
        <div className="signal-card target">
          <div className="signal-card-header">{t("signals.target")}</div>
          <div className="signal-card-price">{fmt(scenario.targetPrice)}</div>
          <div className="signal-card-label">
            {t("signals.current")}: {fmt(scenario.currentPrice)} &nbsp;|&nbsp; {t("signals.pivot")}: {fmt(scenario.pivot)}
          </div>
        </div>
      </div>

      {!!scenario.stepByStepSignal?.length && (
        <div className="analysis-list mt-sig">
          {scenario.stepByStepSignal.map((step, index) => (
            <div key={`${index}-${step}`} className="analysis-item">
              <div className="analysis-dot cyan" />
              <div className="analysis-text">{step}</div>
            </div>
          ))}
        </div>
      )}

      {!!scenario.candlePatterns?.length && (
        <div className="analysis-list mt-sig">
          {scenario.candlePatterns.slice(0, 4).map((pattern) => (
            <div key={`${pattern.timeframe}-${pattern.candleIndex}-${pattern.name}`} className="analysis-item">
              <div className={`analysis-dot ${pattern.direction === "bullish" ? "green" : pattern.direction === "bearish" ? "red" : "yellow"}`} />
              <div className="analysis-text">{pattern.label} | reliability {pattern.reliability}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalysisTab({
  scenario,
  trendContext,
  marketBias,
  dataStatus,
  candleMap,
  symbol,
  geminiApiKey,
  groqApiKey,
}: {
  scenario: MarketScenario;
  trendContext: TrendContext;
  marketBias: MarketBias;
  dataStatus: DataStatus;
  candleMap: CandleMap;
  symbol: Symbol;
  geminiApiKey: string;
  groqApiKey: string;
}) {
  const { t, i18n } = useTranslation();
  const [aiAnalysis, setAiAnalysis] = useState<GeminiAnalysis | null>(() => getCachedAnalysis());
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const hasAnyKey = !!(geminiApiKey || groqApiKey);

  const handleAskAI = useCallback(async () => {
    if (!hasAnyKey) {
      setAiError(t("ai.noKey"));
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await analyzeWithGemini(
        geminiApiKey,
        symbol,
        candleMap,
        scenario.currentPrice,
        i18n.language,
        groqApiKey,
      );
      setAiAnalysis(result);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAiLoading(false);
    }
  }, [hasAnyKey, geminiApiKey, groqApiKey, symbol, candleMap, scenario.currentPrice, i18n.language, t]);

  const isAbovePivot = scenario.currentPrice >= scenario.pivot;
  const items = [
    {
      dot: "cyan",
      text: t("analysis.pricePosition", {
        price: scenario.currentPrice.toFixed(2),
        side: isAbovePivot ? t("analysis.above") : t("analysis.below"),
        pivot: scenario.pivot.toFixed(2),
      }),
    },
    {
      dot: isAbovePivot ? "green" : "red",
      text: t(isAbovePivot ? "analysis.trendUp" : "analysis.trendDown", {
        target: scenario.targetPrice.toFixed(2),
      }),
    },
    {
      dot: "green",
      text: t("analysis.longScenario", { entry: scenario.pendingLong.toFixed(2) }),
    },
    {
      dot: "red",
      text: t("analysis.shortScenario", { entry: scenario.pendingShort.toFixed(2) }),
    },
    {
      dot: "yellow",
      text: t("analysis.trendlineCount", {
        count: scenario.trendlines.filter((trendline) => trendline.active).length,
      }),
    },
    ...((scenario.srZones ?? []).slice(0, 4).map((zone) => ({
      dot: zone.kind === "support" ? "green" : "red",
      text: `${zone.timeframe} ${zone.kind} ${zone.center.toFixed(2)} | strength ${zone.strengthScore}`,
    }))),
  ];

  return (
    <div>
      <div className="analysis-list">
        {items.map((item, index) => (
          <div key={index} className="analysis-item">
            <div className={`analysis-dot ${item.dot}`} />
            <div className="analysis-text">{item.text}</div>
          </div>
        ))}
      </div>

      <div className="ai-analysis-section">
        <div className="ai-analysis-header">
          <span className="ai-analysis-title">🤖 Gemini AI</span>
          <button
            className="ai-ask-btn"
            onClick={handleAskAI}
            disabled={aiLoading}
          >
            {aiLoading ? t("ai.loading") : t("ai.ask")}
          </button>
        </div>

        {aiError && (
          <div className="ai-error">{aiError}</div>
        )}

        {aiAnalysis && (
          <div className="ai-response">
            <div className="ai-response-text">{aiAnalysis.summary}</div>
            <div className="ai-response-meta">
              {aiAnalysis.model} · {new Date(aiAnalysis.timestamp).toLocaleTimeString()}
            </div>
          </div>
        )}

        {!aiAnalysis && !aiError && !aiLoading && (
          <div className="ai-placeholder">{t("ai.placeholder")}</div>
        )}
      </div>

      <EngineDebugPanel
        trendContext={trendContext}
        marketBias={marketBias}
        dataStatus={dataStatus}
      />
    </div>
  );
}

function EngineDebugPanel({
  trendContext,
  marketBias,
  dataStatus,
}: {
  trendContext: TrendContext;
  marketBias: MarketBias;
  dataStatus: DataStatus;
}) {
  const { t } = useTranslation();
  const htfAgreement = marketBias.htfAgreement ?? 50;
  const conflictFlags = marketBias.conflictFlags?.length
    ? marketBias.conflictFlags.join(" | ")
    : "none";
  const missingTf = dataStatus.missingTimeframes?.length
    ? dataStatus.missingTimeframes.join(", ")
    : "none";

  return (
    <div className="engine-debug-panel">
      <div className="engine-debug-header">
        <div className="engine-debug-title">{t("debug.title")}</div>
        <div className="engine-debug-badge">{dataStatus.sourceMode.toUpperCase()}</div>
      </div>

      <div className="engine-debug-grid">
        <DebugMetric label={t("debug.alignment")} value={trendContext.alignment} />
        <DebugMetric label={t("debug.htfAgreement")} value={`${htfAgreement}%`} />
        <DebugMetric label={t("debug.pressure")} value={`${trendContext.pressure?.dominantPressureDirection ?? "neutral"} | ${trendContext.pressure?.pressureStrength ?? 0}`} />
        <DebugMetric label={t("debug.completeness")} value={`${dataStatus.timeframeCompleteness ?? 100}%`} />
      </div>

      <div className="engine-debug-note">{t("debug.conflictFlags")} {conflictFlags}</div>
      <div className="engine-debug-note">{t("debug.missingTF")} {missingTf}</div>
      <div className="engine-debug-note">{t("debug.pressureReason")} {trendContext.pressure?.pressureReason ?? "n/a"}</div>

      <div className="engine-debug-layers">
        <LayerCard title={t("debug.layerShort")} layer={trendContext.shortTerm} />
        <LayerCard title={t("debug.layerMedium")} layer={trendContext.mediumTerm} />
        <LayerCard title={t("debug.layerHTF")} layer={trendContext.higherTimeframe} />
      </div>
    </div>
  );
}

function DebugMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="engine-debug-metric">
      <div className="engine-debug-label">{label}</div>
      <div className="engine-debug-value">{value}</div>
    </div>
  );
}

function LayerCard({ title, layer }: { title: string; layer: TrendLayer }) {
  const { t } = useTranslation();
  const rationale = layer.rationale?.length ? layer.rationale.join(" | ") : "n/a";

  return (
    <div className="engine-layer-card">
      <div className="engine-layer-title">{title}</div>
      <div className="engine-layer-row">
        <span>{t("debug.dir")}: {layer.direction}</span>
        <span>{t("debug.strength")}: {layer.strength}</span>
      </div>
      <div className="engine-layer-row">
        <span>{t("debug.structure")}: {layer.structureState ?? "n/a"}</span>
        <span>{t("debug.ema")}: {layer.emaState ?? "n/a"}</span>
      </div>
      <div className="engine-layer-row">
        <span>{t("debug.trendline")}: {layer.trendlineState ?? "n/a"}</span>
        <span>{t("debug.pressureLabel")}: {layer.pressureState ?? "n/a"}</span>
      </div>
      <div className="engine-layer-note">{rationale}</div>
    </div>
  );
}

function EntriesTab({ scenario }: { scenario: MarketScenario }) {
  const { t } = useTranslation();
  const entries = scenario.entriesByTF ?? [];

  const weighted = entries.reduce(
    (acc, e) => {
      const w = TF_WEIGHTS[e.tf] ?? 1;
      acc.weightSum += w;
      acc.scoreSum += (e.qualityScore ?? 50) * w;
      return acc;
    },
    { weightSum: 0, scoreSum: 0 },
  );

  const overall = weighted.weightSum > 0 ? Math.round(weighted.scoreSum / weighted.weightSum) : 0;

  if (entries.length === 0) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "8px 0" }}>
        {t("signalHistory.noHistory")}
      </div>
    );
  }

  return (
    <div>
      <div className="analysis-list" style={{ marginBottom: 8 }}>
        <div className="analysis-item">
          <div className="analysis-dot cyan" />
          <div className="analysis-text">{t("tabs.entries")} · {t("analysis.trendlineCount", { count: entries.length })} · Overall Score: {overall}</div>
        </div>
      </div>

      <div className="analysis-list">
        {entries.map((e) => (
          <div key={`${e.tf}-${e.preferredSide}-${e.longEntry}-${e.shortEntry}`} className="analysis-item">
            <div className={`analysis-dot ${e.preferredSide === "long" ? "green" : e.preferredSide === "short" ? "red" : "yellow"}`} />
            <div className="analysis-text">
              <strong>{e.tf}</strong> — {e.preferredSide?.toUpperCase() ?? "NEUTRAL"} · Entry: {((e.preferredSide === "short") ? e.shortEntry : e.longEntry)?.toFixed(2)} · Quality: {e.qualityScore ?? "n/a"} {e.actionable ? "· Actionable" : ""}
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{(e.reasons ?? []).slice(0, 5).join(" · ")}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendlinesTab({ trendlines }: { trendlines: Trendline[] }) {
  const { t } = useTranslation();
  if (trendlines.length === 0) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 11, padding: "8px 0" }}>
        {t("trendlinePanel.noActive")}
      </div>
    );
  }

  return (
    <div className="trendline-list">
      {trendlines.map((trendline) => (
        <div key={trendline.id} className="trendline-item">
          <div className="trendline-icon">
            {trendline.kind === "ascending" ? "↗" : "↘"}
          </div>
          <div className="trendline-info">
            <div className={`trendline-kind ${trendline.kind === "ascending" ? "asc" : "desc"}`}>
              {trendline.kind === "ascending" ? t("trendlinePanel.ascending") : t("trendlinePanel.descending")}
            </div>
            <div className="trendline-range">
              {trendline.y1.toFixed(2)} → {trendline.y2.toFixed(2)}
            </div>
          </div>
          <div className="trendline-badge">{t("trendlinePanel.active")}</div>
        </div>
      ))}
    </div>
  );
}
