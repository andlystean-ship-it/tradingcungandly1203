import { useTranslation } from "react-i18next";
import type { MarketBias } from "../types";

type Props = {
  bias: MarketBias;
};

export default function BiasBar({ bias }: Props) {
  const { t } = useTranslation();

  return (
    <div className="bias-section" role="region" aria-label={t("bias.marketIndex")}>
      <div className="bias-label-row">
        <span className="bias-label">
          <span className="live-dot" />
          {t("bias.marketIndex")}
        </span>
        <div style={{ display: "flex", gap: "10px" }}>
          <span className="bias-pct bull">{bias.bullishPercent}%</span>
          <span className="bias-pct bear">{bias.bearishPercent}%</span>
        </div>
      </div>

      <div className="bias-bar-track" role="progressbar" aria-valuenow={bias.bullishPercent} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="bias-bar-fill"
          style={{ width: `${bias.bullishPercent}%` }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
        <span
          className={`bias-direction-badge ${bias.dominantSide === "long" ? "bull" : bias.dominantSide === "short" ? "bear" : "neutral"}`}
        >
          {bias.dominantSide === "long" ? t("bias.priorityLong") : bias.dominantSide === "short" ? t("bias.priorityShort") : t("bias.neutral")}
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
              : bias.dominantSide === "short"
              ? {
                  background: "rgba(255,51,102,0.12)",
                  color: "var(--text-red)",
                  border: "1px solid rgba(255,51,102,0.3)",
                }
              : {
                  background: "rgba(180,180,180,0.12)",
                  color: "var(--text-muted, #888)",
                  border: "1px solid rgba(180,180,180,0.3)",
                }
          }
        >
          Long {bias.bullishPercent}% / Short {bias.bearishPercent}%
        </span>
      </div>
    </div>
  );
}
