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
        <div className="bias-pct-row">
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

      <div className="bias-badge-row">
        <span
          className={`bias-direction-badge ${bias.dominantSide === "long" ? "bull" : bias.dominantSide === "short" ? "bear" : "neutral"}`}
        >
          {bias.dominantSide === "long" ? t("bias.priorityLong") : bias.dominantSide === "short" ? t("bias.priorityShort") : t("bias.neutral")}
        </span>
        <span className="bias-confidence-badge">
          {bias.confidence}%
        </span>
      </div>
    </div>
  );
}
