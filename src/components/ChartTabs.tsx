import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MarketScenario, Trendline } from "../types";

type TabId = "signals" | "analysis" | "trendlines";

type Props = {
  scenario: MarketScenario;
};

export default function ChartTabs({ scenario }: Props) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>("signals");
  const activeTrendlines = scenario.trendlines.filter((t) => t.active);

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
        {activeTab === "analysis" && <AnalysisTab scenario={scenario} />}
        {activeTab === "trendlines" && (
          <TrendlinesTab trendlines={activeTrendlines} scenario={scenario} />
        )}
      </div>
    </>
  );
}

function SignalsTab({ scenario }: { scenario: MarketScenario }) {
  const { t } = useTranslation();
  const fmt = (n: number) => (n >= 10000 ? n.toFixed(0) : n.toFixed(2));
  return (
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
          {t("signals.current")}: {fmt(scenario.currentPrice)} &nbsp;|&nbsp; {t("signals.pivot")}:{" "}
          {fmt(scenario.pivot)}
        </div>
      </div>
    </div>
  );
}

function AnalysisTab({ scenario }: { scenario: MarketScenario }) {
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
        count: scenario.trendlines.filter((tl) => tl.active).length,
      }),
    },
  ];
  return (
    <div className="analysis-list">
      {items.map((item, i) => (
        <div key={i} className="analysis-item">
          <div className={`analysis-dot ${item.dot}`} />
          <div className="analysis-text">{item.text}</div>
        </div>
      ))}
    </div>
  );
}

function TrendlinesTab({
  trendlines,
}: {
  trendlines: Trendline[];
  scenario: MarketScenario;
}) {
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
      {trendlines.map((tl) => (
        <div key={tl.id} className="trendline-item">
          <div className="trendline-icon">
            {tl.kind === "ascending" ? "↗" : "↘"}
          </div>
          <div className="trendline-info">
            <div className={`trendline-kind ${tl.kind === "ascending" ? "asc" : "desc"}`}>
              {tl.kind === "ascending" ? t("trendlinePanel.ascending") : t("trendlinePanel.descending")}
            </div>
            <div className="trendline-range">
              {tl.y1.toFixed(2)} → {tl.y2.toFixed(2)}
            </div>
          </div>
          <div className="trendline-badge">{t("trendlinePanel.active")}</div>
        </div>
      ))}
    </div>
  );
}
