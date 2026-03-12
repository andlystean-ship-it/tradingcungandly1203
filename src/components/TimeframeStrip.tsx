import { useTranslation } from "react-i18next";
import type { TimeframeSignal } from "../types";

type Props = {
  signals: TimeframeSignal[];
};

function formatNum(n: number) {
  return n >= 10000 ? n.toFixed(0) : n.toFixed(2);
}

export default function TimeframeStrip({ signals }: Props) {
  const { t } = useTranslation();

  return (
    <div className="tf-strip" role="region" aria-label={t("timeframe.confluence")}>
      <div className="tf-strip-label">{t("timeframe.confluence")}</div>
      <div className="tf-cards">
        {signals.map((s) => (
          <div key={s.timeframe} className={`tf-card ${s.bias}`} role="listitem" aria-label={`${s.timeframe}: ${s.bias}`}>
            <div className="tf-label">{s.timeframe}</div>
            <div className="tf-bull">▲ {formatNum(s.bullishLevel)}</div>
            <div className="tf-bear">▼ {formatNum(s.bearishLevel)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
