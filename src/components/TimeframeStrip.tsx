import { useTranslation } from "react-i18next";
import type { TimeframeSignal, TimeframeEntry } from "../types";

type Props = {
  signals: TimeframeSignal[];
  entriesByTF?: TimeframeEntry[];
};

function formatNum(n: number) {
  return n >= 10000 ? n.toFixed(0) : n.toFixed(2);
}

export default function TimeframeStrip({ signals, entriesByTF }: Props) {
  const { t } = useTranslation();

  // Index entries by TF for quick lookup
  const entryMap = new Map<string, TimeframeEntry>();
  if (entriesByTF) {
    for (const e of entriesByTF) entryMap.set(e.tf, e);
  }

  return (
    <div className="tf-strip" role="region" aria-label={t("timeframe.confluence")}>
      <div className="tf-strip-label">{t("timeframe.confluence")}</div>
      <div className="tf-cards">
        {signals.map((s) => {
          const entry = entryMap.get(s.timeframe);
          const reasoning = (s.reasoningTags ?? []).slice(0, 3).join(", ");
          const tooltip = entry
            ? `Long: ${formatNum(entry.longEntry)} | Short: ${formatNum(entry.shortEntry)}\nTarget: ${formatNum(entry.target)} | Inv: ${formatNum(entry.invalidation)}\n${reasoning}`
            : reasoning || undefined;
          return (
            <div
              key={s.timeframe}
              className={`tf-card ${s.bias}${entry ? " has-entry" : ""}`}
              role="listitem"
              aria-label={`${s.timeframe}: ${s.bias}`}
              title={tooltip}
            >
              <div className="tf-label">{s.timeframe}</div>
              <div className="tf-bull">▲ {formatNum(s.bullishLevel)}</div>
              <div className="tf-bear">▼ {formatNum(s.bearishLevel)}</div>
              {entry && (
                <div className="tf-entry-row">
                  <span className="tf-long-entry">L:{formatNum(entry.longEntry)}</span>
                  <span className="tf-short-entry">S:{formatNum(entry.shortEntry)}</span>
                </div>
              )}
              {!!entry?.qualityScore && (
                <div className="tf-entry-row">
                  <span className="tf-long-entry">Q:{entry.qualityScore}</span>
                  <span className="tf-short-entry">{entry.actionable ? "ready" : "wait"}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
