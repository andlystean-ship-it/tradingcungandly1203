import { useState } from "react";
import type { MarketScenario, Trendline } from "../types";

type TabId = "signals" | "analysis" | "trendlines";

type Props = {
  scenario: MarketScenario;
};

export default function ChartTabs({ scenario }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("signals");
  const activeTrendlines = scenario.trendlines.filter((t) => t.active);

  return (
    <>
      <div className="chart-tabs">
        <button
          className={`chart-tab ${activeTab === "signals" ? "active" : ""}`}
          onClick={() => setActiveTab("signals")}
        >
          <span className="live-dot" />
          Tín hiệu Live
        </button>
        <button
          className={`chart-tab ${activeTab === "analysis" ? "active" : ""}`}
          onClick={() => setActiveTab("analysis")}
        >
          Phân tích thị trường
        </button>
        <button
          className={`chart-tab ${activeTab === "trendlines" ? "active" : ""}`}
          onClick={() => setActiveTab("trendlines")}
        >
          Đường xu hướng ({activeTrendlines.length})
        </button>
      </div>

      <div className="tab-content">
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
  const fmt = (n: number) => (n >= 10000 ? n.toFixed(0) : n.toFixed(2));
  return (
    <div className="signal-grid">
      <div className="signal-card long">
        <div className="signal-card-header">↑ Đặt Lệnh Chờ Long</div>
        <div className="signal-card-price">{fmt(scenario.pendingLong)}</div>
        <div className="signal-card-label">Entry Long tự động</div>
      </div>
      <div className="signal-card short">
        <div className="signal-card-header">↓ Đặt Lệnh Chờ Short</div>
        <div className="signal-card-price">{fmt(scenario.pendingShort)}</div>
        <div className="signal-card-label">Entry Short tự động</div>
      </div>
      <div className="signal-card target">
        <div className="signal-card-header">🎯 Giá Thị Trường Sẽ Hướng Tới</div>
        <div className="signal-card-price">{fmt(scenario.targetPrice)}</div>
        <div className="signal-card-label">
          Hiện tại: {fmt(scenario.currentPrice)} &nbsp;|&nbsp; Pivot:{" "}
          {fmt(scenario.pivot)}
        </div>
      </div>
    </div>
  );
}

function AnalysisTab({ scenario }: { scenario: MarketScenario }) {
  const isAbovePivot = scenario.currentPrice >= scenario.pivot;
  const items = [
    {
      dot: "cyan",
      text: `Giá hiện tại ${scenario.currentPrice.toFixed(2)} đang ở phía ${isAbovePivot ? "trên" : "dưới"} Pivot Point ${scenario.pivot.toFixed(2)}`,
    },
    {
      dot: isAbovePivot ? "green" : "red",
      text: `Xu hướng ${isAbovePivot ? "nghiêng lên, hướng về Resistance R1" : "nghiêng xuống, hướng về Support S1"} — target gần nhất ${scenario.targetPrice.toFixed(2)}`,
    },
    {
      dot: "green",
      text: `Kịch bản Long: canh entry tại ${scenario.pendingLong.toFixed(2)} khi giá xác nhận hỗ trợ`,
    },
    {
      dot: "red",
      text: `Kịch bản Short: canh entry tại ${scenario.pendingShort.toFixed(2)} khi giá xác nhận kháng cự`,
    },
    {
      dot: "yellow",
      text: `${scenario.trendlines.filter((t) => t.active).length} đường xu hướng đang active — theo dõi breakout / rejection`,
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
  if (trendlines.length === 0) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 11, padding: "8px 0" }}>
        Không có đường xu hướng active.
      </div>
    );
  }
  return (
    <div className="trendline-list">
      {trendlines.map((t) => (
        <div key={t.id} className="trendline-item">
          <div className="trendline-icon">
            {t.kind === "ascending" ? "↗" : "↘"}
          </div>
          <div className="trendline-info">
            <div className={`trendline-kind ${t.kind === "ascending" ? "asc" : "desc"}`}>
              {t.kind === "ascending" ? "Xu hướng tăng" : "Xu hướng giảm"}
            </div>
            <div className="trendline-range">
              {t.y1.toFixed(2)} → {t.y2.toFixed(2)}
            </div>
          </div>
          <div className="trendline-badge">Active</div>
        </div>
      ))}
    </div>
  );
}
