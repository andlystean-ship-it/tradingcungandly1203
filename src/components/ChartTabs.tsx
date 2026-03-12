import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DataStatus, MarketBias, MarketScenario, TrendContext, TrendLayer, Trendline } from "../types";

type TabId = "signals" | "analysis" | "trendlines";

type Props = {
  scenario: MarketScenario;
  trendContext: TrendContext;
  marketBias: MarketBias;
  dataStatus: DataStatus;
};

export default function ChartTabs({ scenario, trendContext, marketBias, dataStatus }: Props) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>("signals");
  const activeTrendlines = scenario.trendlines.filter((trendline) => trendline.active);

  return (
    <>
      <div className="chart-tabs" role="tablist">
        <button
          className={`chart-tab ${activeTab === "signals" ? "active" : ""}`}
          onClick={() => setActiveTab("signals")}
          role="tab"
          aria-selected={activeTab === "signals"}
        >
          <span className="live-dot" aria-hidden="true" />
          {t("tabs.signals")}
        </button>
        <button
          className={`chart-tab ${activeTab === "analysis" ? "active" : ""}`}
          onClick={() => setActiveTab("analysis")}
          role="tab"
          aria-selected={activeTab === "analysis"}
        >
          {t("tabs.analysis")}
        </button>
        <button
          className={`chart-tab ${activeTab === "trendlines" ? "active" : ""}`}
          onClick={() => setActiveTab("trendlines")}
          role="tab"
          aria-selected={activeTab === "trendlines"}
        >
          {t("tabs.trendlines")} ({activeTrendlines.length})
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
          />
        )}
        {activeTab === "trendlines" && <TrendlinesTab trendlines={activeTrendlines} />}
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
        <div className="analysis-list" style={{ marginTop: 12 }}>
          {scenario.stepByStepSignal.map((step, index) => (
            <div key={`${index}-${step}`} className="analysis-item">
              <div className="analysis-dot cyan" />
              <div className="analysis-text">{step}</div>
            </div>
          ))}
        </div>
      )}

      {!!scenario.candlePatterns?.length && (
        <div className="analysis-list" style={{ marginTop: 12 }}>
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
}: {
  scenario: MarketScenario;
  trendContext: TrendContext;
  marketBias: MarketBias;
  dataStatus: DataStatus;
}) {
  const { t } = useTranslation();
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
        <div className="engine-debug-title">Engine Debug</div>
        <div className="engine-debug-badge">{dataStatus.sourceMode.toUpperCase()}</div>
      </div>

      <div className="engine-debug-grid">
        <DebugMetric label="Alignment" value={trendContext.alignment} />
        <DebugMetric label="HTF agreement" value={`${htfAgreement}%`} />
        <DebugMetric label="Pressure" value={`${trendContext.pressure?.dominantPressureDirection ?? "neutral"} | ${trendContext.pressure?.pressureStrength ?? 0}`} />
        <DebugMetric label="Completeness" value={`${dataStatus.timeframeCompleteness ?? 100}%`} />
      </div>

      <div className="engine-debug-note">Conflict flags: {conflictFlags}</div>
      <div className="engine-debug-note">Missing TF: {missingTf}</div>
      <div className="engine-debug-note">Pressure reason: {trendContext.pressure?.pressureReason ?? "n/a"}</div>

      <div className="engine-debug-layers">
        <LayerCard title="Short 1H" layer={trendContext.shortTerm} />
        <LayerCard title="Medium 4H" layer={trendContext.mediumTerm} />
        <LayerCard title="HTF 12H/1D/1W" layer={trendContext.higherTimeframe} />
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
  const rationale = layer.rationale?.length ? layer.rationale.join(" | ") : "n/a";

  return (
    <div className="engine-layer-card">
      <div className="engine-layer-title">{title}</div>
      <div className="engine-layer-row">
        <span>dir: {layer.direction}</span>
        <span>strength: {layer.strength}</span>
      </div>
      <div className="engine-layer-row">
        <span>structure: {layer.structureState ?? "n/a"}</span>
        <span>ema: {layer.emaState ?? "n/a"}</span>
      </div>
      <div className="engine-layer-row">
        <span>trendline: {layer.trendlineState ?? "n/a"}</span>
        <span>pressure: {layer.pressureState ?? "n/a"}</span>
      </div>
      <div className="engine-layer-note">{rationale}</div>
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
