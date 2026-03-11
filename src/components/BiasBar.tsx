import type { MarketBias } from "../types";

type Props = {
  bias: MarketBias;
};

export default function BiasBar({ bias }: Props) {
  return (
    <div className="bias-section">
      <div className="bias-label-row">
        <span className="bias-label">
          <span className="live-dot" />
          Chỉ số thị trường
        </span>
        <div style={{ display: "flex", gap: "10px" }}>
          <span className="bias-pct bull">{bias.bullishPercent}%</span>
          <span className="bias-pct bear">{bias.bearishPercent}%</span>
        </div>
      </div>

      <div className="bias-bar-track">
        <div
          className="bias-bar-fill"
          style={{ width: `${bias.bullishPercent}%` }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
        <span
          className={`bias-direction-badge ${bias.dominantSide === "long" ? "bull" : "bear"}`}
        >
          {bias.dominantSide === "long" ? "▲ Ưu tiên LONG" : "▼ Ưu tiên SHORT"}
        </span>
        <span
          className="bias-direction-badge"
          style={
            bias.dominantSide === "long"
              ? {
                  background: "rgba(0,255,136,0.12)",
                  color: "var(--text-green)",
                  border: "1px solid rgba(0,255,136,0.3)",
                }
              : {
                  background: "rgba(255,51,102,0.12)",
                  color: "var(--text-red)",
                  border: "1px solid rgba(255,51,102,0.3)",
                }
          }
        >
          Long {bias.bullishPercent}% / Short {bias.bearishPercent}%
        </span>
      </div>
    </div>
  );
}
